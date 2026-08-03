"""
ARGUS AI Brain — FastAPI server for all AI capabilities.

Endpoints:
  POST /process-message  — Intent classification
  POST /extract-event    — Calendar event extraction
  POST /parse-reminder   — Natural language reminder parsing
  POST /summarize        — Conversation summarization
  POST /ask              — General Q&A
  GET  /health           — Health check

Usage:
    uvicorn main:app --host <tailscale-ip> --port 8000 --reload
"""

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException

from groq_client import extract_event, summarize_messages, answer_question
from intent_classifier import classify_intent
from reminder_parser import parse_reminder
from models import (
    ExtractRequest,
    ExtractResponse,
    ProcessMessageRequest,
    ProcessMessageResponse,
    ReminderRequest,
    ReminderResponse,
    SummarizeRequest,
    SummarizeResponse,
    AskRequest,
    AskResponse,
)

# Load .env before anything else
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("argus.api")

app = FastAPI(
    title="ARGUS AI Brain",
    description="Multi-capability AI backend: intent classification, event extraction, reminders, Q&A, summarization",
    version="2.0.0",
)

# Load the shared secret once at startup
ARGUS_SECRET = os.getenv("ARGUS_SECRET", "")
if not ARGUS_SECRET:
    logger.warning(
        "ARGUS_SECRET is not set! All requests will be rejected with 401. "
        "Set it in your .env file."
    )


def verify_secret(x_argus_secret: str | None) -> None:
    """Validate the X-Argus-Secret header."""
    if not ARGUS_SECRET or x_argus_secret != ARGUS_SECRET:
        raise HTTPException(
            status_code=401, detail="Missing or invalid X-Argus-Secret header"
        )


# ─── Intent Classification ──────────────────────────────────────

@app.post(
    "/process-message",
    response_model=ProcessMessageResponse,
    responses={401: {}, 502: {}},
)
async def process_message_endpoint(
    request: ProcessMessageRequest,
    x_argus_secret: str | None = Header(None),
) -> ProcessMessageResponse:
    """
    Classify the intent of a WhatsApp message.

    Returns the detected intent (event, reminder, todo, question, summarize, none)
    along with intent-specific extracted data.
    """
    verify_secret(x_argus_secret)

    logger.info(
        "Intent classification — chat=%s, self_chat=%s, text=%s",
        request.chat_jid,
        request.is_self_chat,
        request.message_text[:80],
    )

    try:
        result = classify_intent(
            message_text=request.message_text,
            is_self_chat=request.is_self_chat,
            timestamp=request.timestamp,
        )

        # If intent is "event", do a full extraction in one shot
        if result.get("intent") == "event" and result.get("should_respond", False):
            try:
                event_data = extract_event(
                    notification_text=request.message_text,
                    received_at=request.timestamp,
                    source_app="whatsapp",
                )
                if event_data.is_event:
                    result["extract_data"] = {
                        "title": event_data.title,
                        "date": event_data.date,
                        "time": event_data.time,
                        "confidence": event_data.confidence,
                    }
            except Exception as e:
                logger.error("Event extraction failed during intent processing: %s", e)
                # Keep the intent result, just without extract_data

        return ProcessMessageResponse(**result)

    except Exception as e:
        logger.error("Intent classification error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


# ─── Event Extraction ───────────────────────────────────────────

@app.post(
    "/extract-event",
    response_model=ExtractResponse,
    responses={401: {}, 422: {}, 502: {}},
)
async def extract_event_endpoint(
    request: ExtractRequest,
    x_argus_secret: str | None = Header(None),
) -> ExtractResponse:
    """Extract a calendar event from notification/message text using Groq LLM."""
    verify_secret(x_argus_secret)

    logger.info(
        "Extraction request — source=%s, text=%s",
        request.source_app,
        request.notification_text[:80],
    )

    try:
        result = extract_event(
            notification_text=request.notification_text,
            received_at=request.received_at,
            source_app=request.source_app,
        )
    except ValueError as e:
        logger.error("Groq parse error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error("Groq API error: %s", e)
        raise HTTPException(status_code=502, detail=f"Groq API call failed: {e}")

    logger.info(
        "Extraction result — is_event=%s, title=%s, confidence=%s",
        result.is_event,
        result.title,
        result.confidence,
    )

    return result


# ─── Reminder Parsing ───────────────────────────────────────────

@app.post(
    "/parse-reminder",
    response_model=ReminderResponse,
    responses={401: {}, 502: {}},
)
async def parse_reminder_endpoint(
    request: ReminderRequest,
    x_argus_secret: str | None = Header(None),
) -> ReminderResponse:
    """Parse a natural language reminder into structured datetime + text."""
    verify_secret(x_argus_secret)

    logger.info("Reminder parse — text=%s", request.message_text[:80])

    try:
        result = parse_reminder(
            message_text=request.message_text,
            reference_timestamp=request.reference_timestamp,
        )
        return ReminderResponse(**result)
    except ValueError as e:
        logger.error("Reminder parse error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error("Reminder parse error: %s", e)
        raise HTTPException(status_code=502, detail=f"Groq API call failed: {e}")


# ─── Summarization ──────────────────────────────────────────────

@app.post(
    "/summarize",
    response_model=SummarizeResponse,
    responses={401: {}, 502: {}},
)
async def summarize_endpoint(
    request: SummarizeRequest,
    x_argus_secret: str | None = Header(None),
) -> SummarizeResponse:
    """Summarize a list of chat messages."""
    verify_secret(x_argus_secret)

    logger.info("Summarize — %d messages", len(request.messages))

    try:
        messages_dicts = [m.model_dump() for m in request.messages]
        summary = summarize_messages(messages_dicts, request.instruction)
        return SummarizeResponse(summary=summary)
    except Exception as e:
        logger.error("Summarization error: %s", e)
        raise HTTPException(status_code=502, detail=f"Summarization failed: {e}")


# ─── Q&A ────────────────────────────────────────────────────────

@app.post(
    "/ask",
    response_model=AskResponse,
    responses={401: {}, 502: {}},
)
async def ask_endpoint(
    request: AskRequest,
    x_argus_secret: str | None = Header(None),
) -> AskResponse:
    """Answer a general question using Groq LLM."""
    verify_secret(x_argus_secret)

    logger.info("Q&A — question=%s", request.question[:80])

    try:
        answer = answer_question(request.question)
        return AskResponse(answer=answer)
    except Exception as e:
        logger.error("Q&A error: %s", e)
        raise HTTPException(status_code=502, detail=f"Q&A failed: {e}")


# ─── Health Check ───────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {
        "status": "ok",
        "service": "argus-brain",
        "version": "2.0.0",
        "endpoints": [
            "/process-message",
            "/extract-event",
            "/parse-reminder",
            "/summarize",
            "/ask",
        ],
    }


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("ARGUS_HOST", "127.0.0.1")
    port = int(os.getenv("ARGUS_PORT", "8000"))

    logger.info("Starting ARGUS AI Brain on %s:%d", host, port)
    uvicorn.run(app, host=host, port=port)
