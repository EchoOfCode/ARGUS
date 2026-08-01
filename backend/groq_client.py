"""Groq API client for structured event extraction."""

import json
import logging
import os

from groq import Groq

from models import ExtractResponse

logger = logging.getLogger("argus.groq")

# The system prompt instructs the model to return ONLY valid JSON
# matching the ExtractResponse schema. No prose, no markdown fences.
SYSTEM_PROMPT = """\
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


def build_user_prompt(notification_text: str, received_at: str, source_app: str) -> str:
    """Build the user message for the Groq call."""
    return (
        f"reference_timestamp: {received_at}\n"
        f"source_app: {source_app}\n"
        f"notification_text: {notification_text}"
    )


def extract_event(
    notification_text: str,
    received_at: str,
    source_app: str,
) -> ExtractResponse:
    """
    Call Groq to extract event details from notification text.

    Raises:
        ValueError: If the Groq response can't be parsed as valid JSON.
        Exception: If the Groq API call itself fails.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set in environment")

    client = Groq(api_key=api_key)

    user_prompt = build_user_prompt(notification_text, received_at, source_app)

    logger.info("Calling Groq for extraction — source=%s, text_length=%d", source_app, len(notification_text))

    chat_completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        max_tokens=256,
        temperature=0.1,  # Low temperature for deterministic extraction
    )

    raw_response = chat_completion.choices[0].message.content
    if not raw_response:
        raise ValueError("Groq returned an empty response")

    logger.debug("Groq raw response: %s", raw_response)

    # Strip markdown fences if the model disobeys the system prompt
    cleaned = raw_response.strip()
    if cleaned.startswith("```"):
        # Remove opening fence (possibly ```json)
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Groq response as JSON: %s", raw_response)
        raise ValueError(f"Groq returned unparseable JSON: {e}") from e

    # Ensure raw_text is echoed back
    parsed["raw_text"] = notification_text

    return ExtractResponse(**parsed)
