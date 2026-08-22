"""Intent classifier — fast rule-based pre-classifier with Groq LLM fallback."""

import json
import logging
import os
import re
from typing import Any, Dict

from groq import Groq
from rate_limiter import rate_limited

logger = logging.getLogger("argus.intent")

INTENT_SYSTEM_PROMPT = """\
You are an intent classifier for a personal AI executive assistant called ARGUS that lives in WhatsApp.
ARGUS has direct access to local WhatsApp SQLite database (for chats & groups), IMAP emails, todos, reminders, and web search.

Given a message, classify the user's intent into ONE of these categories:
- "event" — mentions a meeting, appointment, call, or event with a date/time
- "reminder" — the user wants to be reminded about something later
- "todo" — add, view, or manage a todo/task
- "email_list" — user wants to view, read, or check their unread emails/inbox
- "email_summary" — user wants to summarize or read a specific email
- "email_search" — user wants to search emails
- "catchup" — summarize recent messages or catch up on a chat/group
- "memory_save" — remember a fact or note
- "memory_recall" — recall a remembered item or credential hint
- "search" — search the live web for real-time information, news, current events
- "briefing" — daily agenda, morning briefing, schedule overview
- "question" — general knowledge question or conversational request
- "none" — regular conversation, greeting, or background message

RULES:
1. Return ONLY valid JSON:
   {
     "intent": string,
     "confidence": float 0.0-1.0,
     "should_respond": boolean,
     "extract_data": object or null
   }
2. Be CONSERVATIVE on passive messages (is_self_chat=false) — only classify as "event" if there is a concrete date/time.
3. For self-chat messages (is_self_chat=true), categorize accurately so ARGUS can execute the action.
"""

# Common event cues for fast heuristic detection
SCHEDULING_REGEX = re.compile(
    r"\b(meet|meeting|call|appointment|sync|interview|zoom|google meet|webinar|flight|"
    r"tomorrow|yesterday|today|tonight|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)|at\s+\d{1,2}|on\s+\d{1,2}(st|nd|rd|th)?)\b",
    re.IGNORECASE,
)


def has_scheduling_cue(text: str) -> bool:
    """Fast check for date/time/meeting keywords."""
    return bool(SCHEDULING_REGEX.search(text))


def classify_intent_rules(message_text: str, is_self_chat: bool) -> Dict[str, Any] | None:
    """Fast rule-based intent classification to save Groq API tokens."""
    text = message_text.strip()
    lower = text.lower()

    if is_self_chat:
        # 1. Email rules
        if re.search(r"\b(email|emails|mail|mails|inbox|unread)\b", lower):
            if re.search(r"\b(summarize|read|breakdown)\s+email", lower):
                arg = re.sub(r".*?\b(summarize|read|breakdown)\s+email\s*#?", "", lower).strip()
                return {"intent": "email_summary", "confidence": 1.0, "should_respond": True, "extract_data": {"query": arg}}
            if re.search(r"\b(search|find)\s+email", lower):
                query = re.sub(r".*?\b(search|find)\s+email\s*", "", text, flags=re.IGNORECASE).strip()
                return {"intent": "email_search", "confidence": 1.0, "should_respond": True, "extract_data": {"query": query}}
            return {"intent": "email_list", "confidence": 1.0, "should_respond": True, "extract_data": None}

        # 2. Chat & Group Summarization / Catch-up rules
        if re.search(r"\b(summarize|summary|catchup|catch\s*up|recap|what happened in|what did they say in)\b", lower):
            target = re.sub(
                r".*?\b(summarize|summary|catchup|catch\s*up|recap|what happened in|what did they say in)\s*(the|a|my)?\s*(group\s*chat|group|chat|conversation|messages)?\s*(on|with|for|in|about)?\s*",
                "",
                text,
                flags=re.IGNORECASE,
            ).strip()
            return {"intent": "catchup", "confidence": 1.0, "should_respond": True, "extract_data": {"target": target}}

        # 3. Briefing rule
        if re.search(r"\b(briefing|agenda|daily brief|morning brief|today'?s plan|overview of today)\b", lower):
            return {"intent": "briefing", "confidence": 1.0, "should_respond": True, "extract_data": None}

        # 4. Memory rules
        if lower.startswith("remember ") or lower.startswith("note that ") or lower.startswith("save note "):
            fact = re.sub(r"^(remember|note\s+that|save\s+note)\s*", "", text, flags=re.IGNORECASE).strip()
            return {"intent": "memory_save", "confidence": 1.0, "should_respond": True, "extract_data": {"fact": fact}}

        if lower.startswith("what is my ") or lower.startswith("where is my ") or lower.startswith("where did i put ") or lower.startswith("recall "):
            query = re.sub(r"^(recall|what\s+is\s+my|where\s+is\s+my|where\s+did\s+i\s+put)\s*", "", text, flags=re.IGNORECASE).strip()
            return {"intent": "memory_recall", "confidence": 0.95, "should_respond": True, "extract_data": {"query": query}}

        # 5. Web search rules
        if lower.startswith("search ") or lower.startswith("google ") or lower.startswith("web "):
            query = re.sub(r"^(search|google|web)\s*", "", text, flags=re.IGNORECASE).strip()
            return {"intent": "search", "confidence": 1.0, "should_respond": True, "extract_data": {"query": query}}

        # 6. Reminder rules
        if lower.startswith("remind me ") or lower.startswith("reminder "):
            return {"intent": "reminder", "confidence": 1.0, "should_respond": True, "extract_data": None}

    else:
        # Passive messages from other chats: if NO scheduling keywords, skip immediately!
        if not has_scheduling_cue(text):
            return {"intent": "none", "confidence": 1.0, "should_respond": False, "extract_data": None}

    return None


@rate_limited()
def classify_intent_llm(message_text: str, is_self_chat: bool, timestamp: str) -> Dict[str, Any]:
    """Call Groq LLM for ambiguous message intent classification."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set")

    client = Groq(api_key=api_key)

    user_prompt = (
        f"is_self_chat: {is_self_chat}\n"
        f"reference_timestamp: {timestamp}\n"
        f"message: {message_text}"
    )

    logger.info("Classifying intent with LLM — text_len=%d", len(message_text))

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": INTENT_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
        max_tokens=256,
        temperature=0.1,
    )

    raw = completion.choices[0].message.content or "{}"
    cleaned = raw.strip()
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL).strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    try:
        result = json.loads(cleaned)
        if not isinstance(result, dict):
            result = {}
        return {
            "intent": result.get("intent", "general_qa" if is_self_chat else "none"),
            "confidence": float(result.get("confidence", 0.8)),
            "should_respond": bool(result.get("should_respond", is_self_chat)),
            "extract_data": result.get("extract_data"),
        }
    except Exception:
        logger.error("Failed to parse intent response: %s", raw)
        return {
            "intent": "general_qa" if is_self_chat else "none",
            "confidence": 0.5,
            "should_respond": is_self_chat,
            "extract_data": None,
        }


def classify_intent(message_text: str, is_self_chat: bool, timestamp: str) -> Dict[str, Any]:
    """Main classifier: runs rule-based checks first, fallbacks to LLM if needed."""
    rule_result = classify_intent_rules(message_text, is_self_chat)
    if rule_result is not None:
        logger.info("Intent classified via fast rules: %s", rule_result.get("intent"))
        return rule_result

    return classify_intent_llm(message_text, is_self_chat, timestamp)
