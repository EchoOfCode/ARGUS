"""Reminder parser — extracts datetime and text from natural language reminders with multi-provider LLM support."""

import json
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Optional

from groq_client import _get_client, _get_model, _clean_json_response
from rate_limiter import rate_limited

logger = logging.getLogger("argus.reminder")

REMINDER_SYSTEM_PROMPT = """\
You are an expert reminder parser for ARGUS AI. Given a natural language message about setting a reminder, \
extract the clean reminder text and calculate the exact ISO 8601 datetime when it should fire.

RULES:
1. Return ONLY valid JSON:
   {
     "reminder_text": "concise reminder action",
     "due_at": "YYYY-MM-DDTHH:MM:SS",
     "confidence": float 0.0-1.0
   }
2. Use the reference_timestamp as current "now" to resolve relative times:
   - "after classes" / "evening" → today at 17:00 (5:00 PM) or 18:00 (6:00 PM)
   - "at 5pm" → today at 17:00 (or tomorrow if 17:00 has passed)
   - "tomorrow morning" → tomorrow at 09:00 AM
   - "in 30 mins" / "in an hour" → reference_timestamp + offset
   - "tonight" → today at 20:00 (8:00 PM)
3. If no specific time of day is mentioned (e.g. "remind me to buy milk"), default to 3 hours from now or today at 18:00.
4. Clean the reminder_text: "Meeting with SIH IRL", NOT "okay remind me about meeting with sih irl".
"""


@rate_limited()
def parse_reminder(
    message_text: Optional[str] = None,
    reference_timestamp: Optional[str] = None,
    text: Optional[str] = None,
) -> dict:
    """
    Parse a natural language reminder using multi-provider LLM.
    Returns: { reminder_text, due_at, confidence }
    """
    actual_text = message_text or text or ""
    if not actual_text:
        raise ValueError("No message text provided for reminder parsing")

    ref_ts = reference_timestamp or datetime.now().isoformat()
    client = _get_client()
    model = _get_model()

    user_prompt = f"reference_timestamp: {ref_ts}\nmessage: {actual_text}"

    logger.info("Parsing reminder with model %s: %s", model, actual_text[:80])

    try:
        completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": REMINDER_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            model=model,
            max_tokens=300,
            temperature=0.1,
        )

        raw = completion.choices[0].message.content or ""
        cleaned = _clean_json_response(raw)
        result = json.loads(cleaned)

        if not result.get("due_at"):
            # Fallback to 2 hours from now
            fallback_dt = datetime.now() + timedelta(hours=2)
            result["due_at"] = fallback_dt.isoformat()

        if not result.get("reminder_text"):
            clean_text = re.sub(r"^(okay\s+|please\s+)?(remind\s+me\s+(to|about)\s+)", "", actual_text, flags=re.IGNORECASE).strip()
            result["reminder_text"] = clean_text or actual_text

        logger.info("Reminder parsed successfully: text='%s', due='%s'", result.get("reminder_text"), result.get("due_at"))
        return result

    except Exception as e:
        logger.error("LLM reminder parsing error: %s. Using heuristic fallback.", e)
        # Robust heuristic fallback
        clean_text = re.sub(r"^(okay\s+|please\s+)?(remind\s+me\s+(to|about)\s+)", "", actual_text, flags=re.IGNORECASE).strip()
        due_dt = datetime.now() + timedelta(hours=2)
        if "evening" in actual_text.lower() or "class" in actual_text.lower():
            due_dt = datetime.now().replace(hour=17, minute=0, second=0, microsecond=0)
            if due_dt < datetime.now():
                due_dt += timedelta(days=1)

        return {
            "reminder_text": clean_text or actual_text,
            "due_at": due_dt.isoformat(),
            "confidence": 0.8,
        }
