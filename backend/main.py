"""
ARGUS Backend — FastAPI server for notification-to-event extraction.

Receives notification text from the Android app, calls Groq for structured
event extraction, and returns the result. Stateless per request — all
persistent state lives on the phone.

Usage:
    uvicorn main:app --host <tailscale-ip> --port 8000 --reload
"""

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from groq_client import extract_event
from models import ExtractRequest, ExtractResponse

# Load .env before anything else
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("argus.api")

app = FastAPI(
    title="ARGUS Backend",
    description="Notification-to-calendar event extraction via Groq LLM",
    version="0.1.0",
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
        raise HTTPException(status_code=401, detail="Missing or invalid X-Argus-Secret header")


@app.post(
    "/extract-event",
    response_model=ExtractResponse,
    responses={
        401: {"description": "Missing/invalid X-Argus-Secret header"},
        422: {"description": "Malformed request body"},
        502: {"description": "Groq API call failed or returned unparseable output"},
    },
)
async def extract_event_endpoint(
    request: ExtractRequest,
    x_argus_secret: str | None = Header(None),
) -> ExtractResponse:
    """
    Extract a calendar event from notification text using Groq LLM.

    The Android client sends captured notification text here. The backend
    calls Groq with a structured extraction prompt and returns JSON matching
    the ExtractResponse schema.
    """
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
        # Groq returned unparseable output
        logger.error("Groq parse error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        # Groq API call itself failed
        logger.error("Groq API error: %s", e)
        raise HTTPException(status_code=502, detail=f"Groq API call failed: {e}")

    logger.info(
        "Extraction result — is_event=%s, title=%s, confidence=%s",
        result.is_event,
        result.title,
        result.confidence,
    )

    return result


@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok", "service": "argus-backend"}


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("ARGUS_HOST", "127.0.0.1")
    port = int(os.getenv("ARGUS_PORT", "8000"))

    logger.info("Starting ARGUS backend on %s:%d", host, port)
    uvicorn.run(app, host=host, port=port)
