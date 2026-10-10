"""
Universal Audio Transcriber for ARGUS.
Transcribes voice notes and audio clips sent over WhatsApp in real-time.
Supports Groq Whisper-large-v3, OpenAI Whisper-1, or custom endpoints.
"""

import io
import logging
import os
from typing import Optional

from rate_limiter import rate_limited

logger = logging.getLogger("argus.audio")


def _get_audio_client():
    """Get an audio transcription client (Groq or OpenAI)."""
    # 1. Groq Whisper (Ultrafast, Free)
    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key:
        from groq import Groq
        return Groq(api_key=groq_key), "whisper-large-v3"

    # 2. OpenAI Whisper
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        from openai import OpenAI
        return OpenAI(api_key=openai_key), "whisper-1"

    # 3. Custom / OpenRouter fallback
    custom_key = os.getenv("LLM_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    custom_base = os.getenv("LLM_BASE_URL")
    if custom_key and custom_base:
        from openai import OpenAI
        return OpenAI(api_key=custom_key, base_url=custom_base), os.getenv("WHISPER_MODEL", "whisper-1")

    raise RuntimeError(
        "No audio transcription provider configured. Set GROQ_API_KEY or OPENAI_API_KEY in backend/.env for voice notes."
    )


@rate_limited()
def transcribe_audio_bytes(
    audio_bytes: bytes,
    filename: str = "voice_note.ogg",
    language: Optional[str] = None,
    prompt: Optional[str] = "Voice message to personal assistant ARGUS.",
) -> str:
    """
    Transcribe audio bytes using Groq Whisper or OpenAI Whisper.

    Returns the transcribed text string.
    """
    client, default_model = _get_audio_client()
    model = os.getenv("WHISPER_MODEL", default_model)

    file_obj = (filename, io.BytesIO(audio_bytes))

    kwargs = {
        "file": file_obj,
        "model": model,
        "response_format": "text",
        "temperature": 0.0,
    }

    if language:
        kwargs["language"] = language
    if prompt:
        kwargs["prompt"] = prompt

    logger.info("Transcribing audio (%d bytes, model=%s)", len(audio_bytes), model)
    transcription = client.audio.transcriptions.create(**kwargs)

    if isinstance(transcription, str):
        return transcription.strip()
    return getattr(transcription, "text", str(transcription)).strip()
