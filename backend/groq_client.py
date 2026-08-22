"""Groq API client for all ARGUS AI capabilities with rate limiting and retry protection."""

import json
import logging
import os
from typing import Any, Dict, List, Optional

from groq import Groq
from models import ExtractResponse
from rate_limiter import rate_limited

logger = logging.getLogger("argus.groq")

# ─── System Prompts ─────────────────────────────────────────────

EVENT_EXTRACTION_PROMPT = """\
You are a structured-data extraction assistant. Your ONLY job is to determine \
whether a message describes a real calendar event (meeting, call, \
appointment, webinar, flight, etc.) and, if so, extract the event details.

RULES:
1. Return ONLY valid JSON — no prose, no markdown code fences, no explanation.
2. The JSON must match this exact schema:
   {
     "is_event": bool,
     "title": string or null,
     "date": "YYYY-MM-DD" or null,
     "time": "HH:MM" (24-hour) or null,
     "confidence": float 0.0-1.0,
     "raw_text": string
   }
3. Use the provided reference_timestamp as "now" to resolve relative dates \
   (e.g., "tomorrow", "next tuesday", "this friday").
4. Set is_event to false (with other fields null except raw_text and confidence=0.0) \
   when the text is ambiguous or clearly not a scheduling message.
5. Never fabricate a date or time that isn't reasonably inferable from the text.
6. For "title", infer something concise and human-useful like "Meeting", \
   "Call with [name]", "Dentist Appointment" — do NOT just echo the raw text.
7. If a time is mentioned, always convert to 24-hour HH:MM format.
8. If no specific time is mentioned but there IS an event, set time to null \
   (this will become an all-day event).
"""

SUMMARIZE_PROMPT = """\
You are a concise conversation summarizer. Given a list of messages from a WhatsApp chat, \
provide a clear and helpful summary.

RULES:
1. Be concise — aim for 2-5 bullet points.
2. Highlight key decisions, plans, action items, questions, and important links/info.
3. Use the sender names to attribute key points.
4. If the user gives specific instructions (like "what did we decide?"), focus on that.
5. Return plain text — no JSON, no markdown fences.
"""

QA_PROMPT = """\
You are ARGUS, a high-intelligence, polite, and concise personal AI assistant residing in WhatsApp.

RULES:
1. Keep answers direct and concise — 1-3 sentences for simple questions.
2. For complex questions or lists, use clear bullet points with relevant emojis.
3. If web search results or personal memory context are provided, use them accurately.
4. Return plain text suitable for WhatsApp — no markdown fences, no raw JSON.
"""

EMAIL_SUMMARY_PROMPT = """\
You are an executive email summarizer for ARGUS.
Given the subject, sender, and body of an email, create a crisp executive summary.

RULES:
1. Summary format:
   - 🎯 *Core Purpose / TL;DR* (1 sentence)
   - 📌 *Key Points / Action Items* (1-3 bullet points)
   - ⏳ *Deadlines / Next Steps* (if any)
2. Be extremely concise. Keep it under 150 words.
3. Return plain text formatted for WhatsApp.
"""

BRIEFING_PROMPT = """\
You are ARGUS crafting the user's executive Daily Briefing message for WhatsApp.
Given their pending tasks, scheduled events, reminders, and unread priority emails, format a beautiful, motivating, and highly readable daily agenda.

RULES:
1. Organize with clean sections and emojis:
   🌅 *ARGUS DAILY EXECUTIVE BRIEFING*
   📅 *Today's Schedule & Events*
   ⏰ *Reminders*
   📝 *Pending Todos*
   📧 *Priority Unread Emails*
2. Keep items crisp and actionable.
3. If a section is empty, note "None scheduled" or skip gracefully.
4. End with a short, energizing quote or greeting.
"""


def _get_client() -> Groq:
    """Get a configured Groq client."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set in environment")
    return Groq(api_key=api_key)


def _get_model() -> str:
    """Get the configured Groq model."""
    return os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")


def _clean_json_response(raw: str) -> str:
    """Strip reasoning/think tags and markdown fences from LLM response if present."""
    import re
    cleaned = raw.strip()
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL).strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


# ─── Event Extraction ───────────────────────────────────────────

@rate_limited()
def extract_event(
    notification_text: str,
    received_at: str,
    source_app: str,
) -> ExtractResponse:
    """Extract event details from message text using Groq."""
    client = _get_client()

    user_prompt = (
        f"reference_timestamp: {received_at}\n"
        f"source_app: {source_app}\n"
        f"notification_text: {notification_text}"
    )

    logger.info("Extracting event — source=%s, text_len=%d", source_app, len(notification_text))

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": EVENT_EXTRACTION_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=256,
        temperature=0.1,
    )

    raw = completion.choices[0].message.content or "{}"
    try:
        parsed = json.loads(_clean_json_response(raw))
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Groq event response: %s", raw)
        raise ValueError(f"Groq returned unparseable JSON: {e}") from e

    parsed["raw_text"] = notification_text
    return ExtractResponse(**parsed)


# ─── Summarization ──────────────────────────────────────────────

@rate_limited()
def summarize_messages(
    messages: List[dict],
    instruction: str = "Summarize the key points, decisions, and action items.",
) -> str:
    """Summarize a list of chat messages."""
    client = _get_client()

    formatted_lines = []
    for m in messages:
        sender = m.get("sender_name") or m.get("sender_jid", "Unknown")
        text = m.get("message_text", "")
        formatted_lines.append(f"[{sender}]: {text}")

    chat_text = "\n".join(formatted_lines)
    user_prompt = f"Instruction: {instruction}\n\nChat history:\n{chat_text}"

    logger.info("Summarizing %d messages (length: %d chars)", len(messages), len(chat_text))

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": SUMMARIZE_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=500,
        temperature=0.3,
    )

    return (completion.choices[0].message.content or "No summary generated.").strip()


# ─── Q&A and Conversational Answering ───────────────────────────

@rate_limited()
def answer_question(
    question: str,
    context: Optional[str] = None,
    memory_context: Optional[str] = None,
    web_context: Optional[str] = None,
) -> str:
    """Answer a user question with optional context from memory and live web search."""
    client = _get_client()

    prompt_parts = []
    if memory_context:
        prompt_parts.append(f"Relevant facts from user's memory:\n{memory_context}")
    if web_context:
        prompt_parts.append(f"Live Web Search Results:\n{web_context}")
    if context:
        prompt_parts.append(f"Additional Context:\n{context}")

    prompt_parts.append(f"User Question: {question}")
    user_prompt = "\n\n".join(prompt_parts)

    logger.info("Answering question: %s", question[:80])

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": QA_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=500,
        temperature=0.4,
    )

    return (completion.choices[0].message.content or "I couldn't process an answer.").strip()


# ─── Email Summarization ────────────────────────────────────────

@rate_limited()
def summarize_email(
    subject: str,
    sender: str,
    date: str,
    body: str,
) -> str:
    """Generate an executive summary for an email."""
    client = _get_client()

    user_prompt = (
        f"Sender: {sender}\n"
        f"Date: {date}\n"
        f"Subject: {subject}\n\n"
        f"Email Body:\n{body[:3500]}"
    )

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": EMAIL_SUMMARY_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=350,
        temperature=0.2,
    )

    return (completion.choices[0].message.content or "Could not summarize email.").strip()


# ─── Daily Executive Briefing ───────────────────────────────────

@rate_limited()
def generate_briefing(
    todos: List[dict],
    reminders: List[dict],
    events: List[dict],
    emails: List[dict],
) -> str:
    """Generate a cohesive morning/evening executive briefing."""
    client = _get_client()

    todos_text = "\n".join([f"- [#{t.get('id')}] {t.get('text')}" for t in todos]) or "No pending todos"
    reminders_text = "\n".join([f"- at {r.get('due_at')}: {r.get('reminder_text')}" for r in reminders]) or "No pending reminders"
    events_text = "\n".join([f"- {e.get('title')} ({e.get('event_date')} {e.get('event_time', '')})" for e in events]) or "No events today"
    emails_text = "\n".join([f"- From: {em.get('sender')} | Subject: {em.get('subject')} ({em.get('snippet', '')[:80]})" for em in emails]) or "No unread priority emails"

    user_prompt = (
        f"Today's data:\n\n"
        f"TODOS:\n{todos_text}\n\n"
        f"REMINDERS:\n{reminders_text}\n\n"
        f"SCHEDULED EVENTS:\n{events_text}\n\n"
        f"UNREAD EMAILS:\n{emails_text}"
    )

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": BRIEFING_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=600,
        temperature=0.3,
    )

    return (completion.choices[0].message.content or "No briefing generated.").strip()
