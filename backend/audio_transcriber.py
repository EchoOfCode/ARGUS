"""
Groq Whisper Audio Transcriber for ARGUS.
Transcribes voice notes and audio clips sent over WhatsApp in real-time.
"""

import io
import logging
import os
from typing import Optional

from groq import Groq
from rate_limiter import rate_limited

logger = logging.getLogger("argus.audio")


def _get_client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set in environment")
    return Groq(api_key=api_key)


@rate_limited()
def transcribe_audio_bytes(
    audio_bytes: bytes,
    filename: str = "voice_note.ogg",
    language: Optional[str] = None,
    prompt: Optional[str] = "Voice message to personal assistant ARGUS.",
) -> str:
    """
    Transcribe audio bytes using Groq Whisper-large-v3.

    Returns the transcribed text string.
    """
    client = _get_client()

    file_obj = (filename, io.BytesIO(audio_bytes))

    kwargs = {
        "file": file_obj,
        "model": "whisper-large-v3",
        "response_format": "text",
        "temperature": 0.0,
    }

    if language:
        kwargs["language"] = language
    if prompt:
        kwargs["prompt"] = prompt

    logger.info("Transcribing audio (%d bytes, file=%s)", len(audio_bytes), filename)
    transcription = client.audio.transcriptions.create(**kwargs)

    # If response_format is "text", transcription is a str; otherwise object
    if isinstance(transcription, str):
        return transcription.strip()
    return getattr(transcription, "text", str(transcription)).strip()
