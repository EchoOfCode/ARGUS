"""Reminder parser — extracts datetime and text from natural language reminders."""

import json
import logging
import os
from typing import Optional

from groq import Groq

logger = logging.getLogger("argus.reminder")

REMINDER_SYSTEM_PROMPT = """\
You are a reminder parser. Given a natural language message about setting a reminder, \
extract the reminder text and the exact datetime when it should fire.

RULES:
1. Return ONLY valid JSON — no prose, no markdown fences.
2. The JSON must match this schema:
   {
     "reminder_text": "clean, concise reminder text",
     "due_at": "ISO 8601 datetime with timezone",
     "confidence": float 0.0-1.0
   }
3. Use the reference_timestamp as "now" to resolve relative times:
   - "at 5pm" → today at 5pm (or tomorrow if 5pm has passed)
   - "tomorrow morning" → tomorrow at 9:00 AM
   - "in 30 minutes" → reference_timestamp + 30 minutes
   - "next Monday at 10am" → the next Monday at 10am
4. "morning" = 9:00 AM, "afternoon" = 2:00 PM, "evening" = 6:00 PM, "night" = 9:00 PM
5. Make the reminder_text concise but clear — "Call mom", not "remind me to call mom"
6. Preserve the timezone from reference_timestamp
"""


def parse_reminder(
    message_text: Optional[str] = None,
    reference_timestamp: Optional[str] = None,
    text: Optional[str] = None,
) -> dict:
    """
    Parse a natural language reminder using Groq.

    Returns: { reminder_text, due_at, confidence }
    """
    actual_text = message_text or text or ""
    if not actual_text:
        raise ValueError("No message text provided for reminder parsing")
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set")

    client = Groq(api_key=api_key)

    user_prompt = (
        f"reference_timestamp: {reference_timestamp}\n"
        f"message: {message_text}"
    )

    logger.info("Parsing reminder: %s", message_text[:80])

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": REMINDER_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        max_tokens=200,
        temperature=0.1,
    )

    raw = completion.choices[0].message.content
    if not raw:
        raise ValueError("Groq returned empty response for reminder parsing")

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    try:
        result = json.loads(cleaned)
        logger.info(
            "Reminder parsed: text='%s', due='%s'",
            result.get("reminder_text"),
            result.get("due_at"),
        )
        return result
    except json.JSONDecodeError:
        logger.error("Failed to parse reminder response: %s", raw)
        raise ValueError(f"Groq returned unparseable reminder: {raw}")
