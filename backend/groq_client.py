"""Groq API client for all ARGUS AI capabilities."""

import json
import logging
import os
from typing import List

from groq import Groq

from models import ExtractResponse

logger = logging.getLogger("argus.groq")

# ─── System Prompts ─────────────────────────────────────────────

EVENT_EXTRACTION_PROMPT = """\
You are a structured-data extraction assistant. Your ONLY job is to determine \
whether a notification message describes a real calendar event (meeting, call, \
appointment, etc.) and, if so, extract the event details.

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
   "Call with [name]", "Doctor's appointment" — do NOT just echo the raw text.
7. If a time is mentioned, always convert to 24-hour HH:MM format.
8. If no specific time is mentioned but there IS an event, set time to null \
   (this will become an all-day event).
"""

SUMMARIZE_PROMPT = """\
You are a concise conversation summarizer. Given a list of messages from a WhatsApp chat, \
provide a clear and helpful summary.

RULES:
1. Be concise — aim for 2-5 sentences.
2. Highlight key decisions, plans, action items, and important information.
3. Use the sender names to attribute key points.
4. If the user gives specific instructions (like "what did we decide?"), focus on that.
5. Return plain text — no JSON, no markdown fences.
"""

QA_PROMPT = """\
You are a helpful, concise personal AI assistant. Answer the user's question clearly and accurately.

RULES:
1. Keep answers concise — 1-3 sentences for simple questions.
2. For complex questions, use brief bullet points.
3. If you're unsure, say so honestly.
4. Return plain text — no JSON, no markdown fences.
5. Be friendly and conversational — this is a WhatsApp chat, not a formal document.
"""


def _get_client() -> Groq:
    """Get a configured Groq client."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set in environment")
    return Groq(api_key=api_key)


def _get_model() -> str:
    """Get the configured Groq model."""
    return os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")


def _clean_json_response(raw: str) -> str:
    """Strip markdown fences from LLM response if present."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


# ─── Event Extraction ───────────────────────────────────────────

def extract_event(
    notification_text: str,
    received_at: str,
    source_app: str,
) -> ExtractResponse:
    """
    Call Groq to extract event details from notification text.

    Raises:
        ValueError: If the Groq response can't be parsed.
        Exception: If the Groq API call itself fails.
    """
    client = _get_client()

    user_prompt = (
        f"reference_timestamp: {received_at}\n"
        f"source_app: {source_app}\n"
        f"notification_text: {notification_text}"
    )

    logger.info("Extracting event — source=%s, text_length=%d", source_app, len(notification_text))

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": EVENT_EXTRACTION_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=256,
        temperature=0.1,
    )

    raw = completion.choices[0].message.content
    if not raw:
        raise ValueError("Groq returned an empty response")

    logger.debug("Groq raw response: %s", raw)

    try:
        parsed = json.loads(_clean_json_response(raw))
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Groq response: %s", raw)
        raise ValueError(f"Groq returned unparseable JSON: {e}") from e

    parsed["raw_text"] = notification_text
    return ExtractResponse(**parsed)


# ─── Summarization ──────────────────────────────────────────────

def summarize_messages(
    messages: List[dict],
    instruction: str,
) -> str:
    """
    Summarize a list of chat messages.

    Args:
        messages: List of { sender, text, timestamp } dicts
        instruction: User's summarization instruction

    Returns:
        Summary string
    """
    client = _get_client()

    # Format messages for the prompt
    formatted = "\n".join(
        f"[{m.get('timestamp', '')}] {m['sender']}: {m['text']}"
        for m in messages
    )

    user_prompt = f"Instruction: {instruction}\n\nMessages:\n{formatted}"

    logger.info("Summarizing %d messages", len(messages))

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": SUMMARIZE_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=500,
        temperature=0.3,
    )

    result = completion.choices[0].message.content
    return result.strip() if result else "Could not generate summary."


# ─── Question Answering ─────────────────────────────────────────

def answer_question(question: str) -> str:
    """
    Answer a general question using Groq.

    Args:
        question: The user's question

    Returns:
        Answer string
    """
    client = _get_client()

    logger.info("Answering question: %s", question[:80])

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": QA_PROMPT},
            {"role": "user", "content": question},
        ],
        model=_get_model(),
        max_tokens=500,
        temperature=0.5,
    )

    result = completion.choices[0].message.content
    return result.strip() if result else "I'm not sure how to answer that."
