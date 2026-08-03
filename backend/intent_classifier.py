"""Intent classifier — determines what the user wants from a message."""

import json
import logging
import os

from groq import Groq

logger = logging.getLogger("argus.intent")

INTENT_SYSTEM_PROMPT = """\
You are an intent classifier for a personal AI assistant called ARGUS that lives in WhatsApp.

Given a message, classify the user's intent into ONE of these categories:
- "event" — the message mentions a meeting, appointment, call, or event with a date/time
- "reminder" — the user wants to be reminded about something later
- "todo" — the user wants to add, view, or manage a todo/task list
- "question" — the user is asking a factual question or wants AI help
- "summarize" — the user wants a summary of messages or a conversation
- "none" — regular conversation, greeting, or message that doesn't need any action

RULES:
1. Return ONLY valid JSON — no prose, no markdown fences.
2. The JSON must match this schema:
   {
     "intent": "event" | "reminder" | "todo" | "question" | "summarize" | "none",
     "confidence": float 0.0-1.0,
     "should_respond": boolean,
     "extract_data": object or null
   }
3. For "event" intent, include extract_data with: title, date, time, confidence
4. For "reminder" intent, include extract_data with: text (what to remember), time_hint (raw time reference)
5. For "todo" intent, include extract_data with: text (the todo item), action (add/list/complete)
6. For "none" intent, set should_respond to false
7. Be CONSERVATIVE — only classify as "event" if there's a clear date/time reference.
   Casual messages like "let's hang out sometime" are "none", not "event".
8. For self-chat messages (is_self_chat=true), be more liberal — the user is
   explicitly talking to the assistant, so most messages should have an intent.
"""


def classify_intent(
    message_text: str,
    is_self_chat: bool,
    timestamp: str,
) -> dict:
    """
    Classify the intent of a message using Groq.

    Returns a dict with: intent, confidence, should_respond, extract_data
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set")

    client = Groq(api_key=api_key)

    user_prompt = (
        f"is_self_chat: {is_self_chat}\n"
        f"reference_timestamp: {timestamp}\n"
        f"message: {message_text}"
    )

    logger.info(
        "Classifying intent — self_chat=%s, text_length=%d",
        is_self_chat,
        len(message_text),
    )

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": INTENT_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        max_tokens=256,
        temperature=0.1,
    )

    raw = completion.choices[0].message.content
    if not raw:
        return {"intent": "none", "confidence": 0.0, "should_respond": False, "extract_data": None}

    # Clean up markdown fences if present
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    try:
        result = json.loads(cleaned)
        logger.info(
            "Intent classified: %s (confidence=%.2f)",
            result.get("intent", "unknown"),
            result.get("confidence", 0),
        )
        return result
    except json.JSONDecodeError:
        logger.error("Failed to parse intent response: %s", raw)
        return {"intent": "none", "confidence": 0.0, "should_respond": False, "extract_data": None}
