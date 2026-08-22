"""
ARGUS AI Brain — FastAPI server for all AI capabilities.

Endpoints:
  POST /process-message    — Intent classification & smart routing
  POST /extract-event      — Calendar event extraction
  POST /parse-reminder     — Natural language reminder parsing
  POST /summarize          — Conversation & chat catchup summarization
  POST /ask                — General Q&A with live web search & memory integration
  POST /emails/unread      — Direct IMAP unread email retrieval
  POST /emails/summarize   — AI executive summary of email
  POST /emails/search      — Direct IMAP email search
  POST /memory/save        — Save facts to long-term memory ("Second Brain")
  POST /memory/recall      — Query facts from memory
  POST /search             — Real-time DuckDuckGo web search
  POST /briefing           — Generate complete daily executive briefing
  POST /transcribe-audio   — Groq Whisper audio / voice note transcription
  GET  /health             — Health check
"""

import logging
import os
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, Header, HTTPException, UploadFile

from audio_transcriber import transcribe_audio_bytes
from email_reader import email_reader
from groq_client import (
    answer_question,
    classify_and_tag_memory,
    extract_event,
    generate_autopilot_persona_reply,
    generate_briefing,
    summarize_email,
    summarize_messages,
    synthesize_memory_answer,
)
from intent_classifier import classify_intent
from memory import (
    delete_memory,
    delete_memory_by_query,
    get_memories_by_category,
    recall_memories,
    save_memory,
)
from models import (
    AskRequest,
    AskResponse,
    AutopilotReplyRequest,
    AutopilotReplyResponse,
    BriefingRequest,
    BriefingResponse,
    EmailItem,
    EmailListResponse,
    EmailSearchRequest,
    EmailSummaryRequest,
    EmailSummaryResponse,
    ExtractRequest,
    ExtractResponse,
    MemoryDeleteRequest,
    MemoryDeleteResponse,
    MemoryListResponse,
    MemoryRecallRequest,
    MemoryRecallResponse,
    MemorySaveRequest,
    MemorySaveResponse,
    ProcessMessageRequest,
    ProcessMessageResponse,
    ReminderRequest,
    ReminderResponse,
    SummarizeRequest,
    SummarizeResponse,
    TranscribeAudioResponse,
    WebSearchRequest,
    WebSearchResponse,
)
from reminder_parser import parse_reminder
from web_search import search_web

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
    description="Multi-capability executive AI assistant backend",
    version="2.1.0",
)

# Load shared secret
ARGUS_SECRET = os.getenv("ARGUS_SECRET", "")
if not ARGUS_SECRET:
    logger.warning("ARGUS_SECRET is not set! Set it in your .env file.")


def verify_secret(x_argus_secret: str | None) -> None:
    """Validate the X-Argus-Secret header."""
    if not ARGUS_SECRET or x_argus_secret != ARGUS_SECRET:
        raise HTTPException(
            status_code=401, detail="Missing or invalid X-Argus-Secret header"
        )


# ─── Intent Classification ──────────────────────────────────────

@app.post("/process-message", response_model=ProcessMessageResponse)
async def process_message_endpoint(
    request: ProcessMessageRequest,
    x_argus_secret: str | None = Header(None),
) -> ProcessMessageResponse:
    """Classify the intent of a WhatsApp message."""
    verify_secret(x_argus_secret)

    logger.info(
        "Intent check — chat=%s, self=%s, text=%s",
        request.chat_jid,
        request.is_self_chat,
        request.message_text[:60],
    )

    try:
        result = classify_intent(
            message_text=request.message_text,
            is_self_chat=request.is_self_chat,
            timestamp=request.timestamp,
        )

        # If intent is "event" and should_respond, extract event details
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

        return ProcessMessageResponse(**result)

    except Exception as e:
        logger.error("Intent classification error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


# ─── Event Extraction ───────────────────────────────────────────

@app.post("/extract-event", response_model=ExtractResponse)
async def extract_event_endpoint(
    request: ExtractRequest,
    x_argus_secret: str | None = Header(None),
) -> ExtractResponse:
    """Extract a calendar event from message text using Groq LLM."""
    verify_secret(x_argus_secret)

    try:
        return extract_event(
            notification_text=request.notification_text,
            received_at=request.received_at,
            source_app=request.source_app,
        )
    except Exception as e:
        logger.error("Extraction failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


# ─── Reminder Parsing ───────────────────────────────────────────

@app.post("/parse-reminder", response_model=ReminderResponse)
async def parse_reminder_endpoint(
    request: ReminderRequest,
    x_argus_secret: str | None = Header(None),
) -> ReminderResponse:
    """Parse natural language reminder times."""
    verify_secret(x_argus_secret)

    try:
        parsed = parse_reminder(
            text=request.message_text,
            reference_timestamp=request.reference_timestamp,
        )
        return ReminderResponse(**parsed)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Reminder parsing failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


# ─── Summarization ──────────────────────────────────────────────

@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_endpoint(
    request: SummarizeRequest,
    x_argus_secret: str | None = Header(None),
) -> SummarizeResponse:
    """Summarize a conversation thread or group chat."""
    verify_secret(x_argus_secret)

    try:
        messages_dicts = [m.model_dump() for m in request.messages]
        summary = summarize_messages(messages_dicts, request.instruction)
        return SummarizeResponse(summary=summary)
    except Exception as e:
        logger.error("Summarization failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


# ─── Q&A with Memory & Web Search ───────────────────────────────

@app.post("/ask", response_model=AskResponse)
async def ask_endpoint(
    request: AskRequest,
    x_argus_secret: str | None = Header(None),
) -> AskResponse:
    """Answer questions using Groq with optional memory and web search."""
    verify_secret(x_argus_secret)

    try:
        # Check memory context
        memories = recall_memories(request.question, limit=3)
        memory_context = "\n".join([f"- {m['fact_text']}" for m in memories]) if memories else None

        # Check live web search if requested or if memory didn't answer
        web_context = None
        sources = None
        if request.use_web_search:
            search_results = search_web(request.question, max_results=3)
            if search_results:
                web_context = "\n\n".join([f"[{r['title']}]: {r['body']}" for r in search_results])
                sources = [{"title": r["title"], "url": r["href"]} for r in search_results]

        answer = answer_question(
            question=request.question,
            memory_context=memory_context,
            web_context=web_context,
        )
        return AskResponse(answer=answer, sources=sources)
    except Exception as e:
        logger.error("Ask failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


# ─── Direct Email Integration ───────────────────────────────────

@app.post("/emails/unread", response_model=EmailListResponse)
async def get_unread_emails_endpoint(
    x_argus_secret: str | None = Header(None),
) -> EmailListResponse:
    """Fetch unread emails directly via IMAP."""
    verify_secret(x_argus_secret)

    if not email_reader.is_configured():
        return EmailListResponse(
            emails=[],
            count=0,
            is_configured=False,
            message="Email integration is not configured. Set EMAIL_USER and EMAIL_PASS in backend/.env.",
        )

    try:
        raw_emails = email_reader.fetch_unread(limit=5)
        email_items = [EmailItem(**e) for e in raw_emails]
        return EmailListResponse(emails=email_items, count=len(email_items), is_configured=True)
    except Exception as e:
        logger.error("Fetching unread emails failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch emails: {e}")


@app.post("/emails/summarize", response_model=EmailSummaryResponse)
async def summarize_email_endpoint(
    request: EmailSummaryRequest,
    x_argus_secret: str | None = Header(None),
) -> EmailSummaryResponse:
    """Summarize a specific email."""
    verify_secret(x_argus_secret)

    subject = request.subject or "Email"
    sender = request.sender or "Unknown"
    date = request.date or ""
    body = request.body or ""

    if request.email_id and not body:
        if email_reader.is_configured():
            email_data = email_reader.get_email_by_id(request.email_id)
            if email_data:
                subject = email_data["subject"]
                sender = email_data["sender"]
                date = email_data["date"]
                body = email_data["body"]

    if not body:
        raise HTTPException(status_code=400, detail="Email body or valid email_id required.")

    summary = summarize_email(subject, sender, date, body)
    return EmailSummaryResponse(email_id=request.email_id, subject=subject, summary=summary)


@app.post("/emails/search", response_model=EmailListResponse)
async def search_emails_endpoint(
    request: EmailSearchRequest,
    x_argus_secret: str | None = Header(None),
) -> EmailListResponse:
    """Search inbox directly via IMAP."""
    verify_secret(x_argus_secret)

    if not email_reader.is_configured():
        return EmailListResponse(
            emails=[],
            count=0,
            is_configured=False,
            message="Email integration is not configured.",
        )

    try:
        raw_emails = email_reader.search_emails(request.query, limit=request.limit)
        email_items = [EmailItem(**e) for e in raw_emails]
        return EmailListResponse(emails=email_items, count=len(email_items), is_configured=True)
    except Exception as e:
        logger.error("Searching emails failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


# ─── Long-Term Memory ("Second Brain") ──────────────────────────

@app.post("/memory/save", response_model=MemorySaveResponse)
async def save_memory_endpoint(
    request: MemorySaveRequest,
    x_argus_secret: str | None = Header(None),
) -> MemorySaveResponse:
    """Store a fact with AI auto-categorization and entity extraction."""
    verify_secret(x_argus_secret)

    category = request.category
    entities = request.entities

    # If category or entities not provided, auto-classify with Groq LLM
    if not category or category == "general" or entities is None:
        try:
            detected_cat, detected_entities = classify_and_tag_memory(request.fact)
            category = category if (category and category != "general") else detected_cat
            entities = entities if entities is not None else detected_entities
        except Exception as e:
            logger.warning("Auto-tagging memory failed: %s", e)
            category = category or "general"
            entities = entities or []

    saved = save_memory(request.fact, category=category, entities=entities)
    return MemorySaveResponse(
        id=saved["id"],
        fact=saved["fact_text"],
        category=saved["category"],
        entities=saved.get("entities", []),
        message="Stored in memory.",
    )


@app.post("/memory/recall", response_model=MemoryRecallResponse)
async def recall_memory_endpoint(
    request: MemoryRecallRequest,
    x_argus_secret: str | None = Header(None),
) -> MemoryRecallResponse:
    """Recall facts and synthesize natural conversational answer."""
    verify_secret(x_argus_secret)

    results = recall_memories(request.query, limit=request.limit)
    answer = None
    if results:
        try:
            answer = synthesize_memory_answer(request.query, results)
        except Exception as e:
            logger.warning("Memory synthesis failed: %s", e)
            mem_text = "\n".join([f"- {r['fact_text']}" for r in results])
            answer = mem_text

    return MemoryRecallResponse(memories=results, answer=answer)


@app.post("/memory/list", response_model=MemoryListResponse)
async def list_memories_endpoint(
    x_argus_secret: str | None = Header(None),
) -> MemoryListResponse:
    """Get full categorized Second Brain knowledge base."""
    verify_secret(x_argus_secret)

    grouped = get_memories_by_category()
    total = sum(len(items) for items in grouped.values())
    return MemoryListResponse(categories=grouped, total_count=total)


@app.post("/memory/delete", response_model=MemoryDeleteResponse)
async def delete_memory_endpoint(
    request: MemoryDeleteRequest,
    x_argus_secret: str | None = Header(None),
) -> MemoryDeleteResponse:
    """Delete memories by ID or keyword query."""
    verify_secret(x_argus_secret)

    count = 0
    if request.id is not None:
        success = delete_memory(request.id)
        count = 1 if success else 0
    elif request.query:
        count = delete_memory_by_query(request.query)

    return MemoryDeleteResponse(
        deleted_count=count,
        message=f"Deleted {count} memory item(s)." if count > 0 else "No matching memory found.",
    )


# ─── Live Web Search ────────────────────────────────────────────

@app.post("/search", response_model=WebSearchResponse)
async def web_search_endpoint(
    request: WebSearchRequest,
    x_argus_secret: str | None = Header(None),
) -> WebSearchResponse:
    """Perform real-time web search."""
    verify_secret(x_argus_secret)

    results = search_web(request.query, max_results=request.limit)
    return WebSearchResponse(query=request.query, results=results)


# ─── Daily Executive Briefing ───────────────────────────────────

@app.post("/briefing", response_model=BriefingResponse)
async def briefing_endpoint(
    request: BriefingRequest,
    x_argus_secret: str | None = Header(None),
) -> BriefingResponse:
    """Generate daily morning briefing."""
    verify_secret(x_argus_secret)

    emails = []
    if request.include_emails and email_reader.is_configured():
        try:
            emails = email_reader.fetch_unread(limit=3)
        except Exception as e:
            logger.warning("Could not fetch emails for briefing: %s", e)

    briefing_text = generate_briefing(
        todos=request.todos,
        reminders=request.reminders,
        events=request.events,
        emails=emails,
    )
    return BriefingResponse(briefing_text=briefing_text)


# ─── Audio / Voice Note Transcription (Groq Whisper) ────────────

@app.post("/transcribe-audio", response_model=TranscribeAudioResponse)
async def transcribe_audio_endpoint(
    file: UploadFile = File(...),
    x_argus_secret: str | None = Header(None),
) -> TranscribeAudioResponse:
    """Transcribe uploaded audio file using Groq Whisper-large-v3."""
    verify_secret(x_argus_secret)

    try:
        content = await file.read()
        transcription = transcribe_audio_bytes(content, filename=file.filename or "audio.ogg")
        return TranscribeAudioResponse(transcription=transcription, success=True)
    except Exception as e:
        logger.error("Audio transcription failed: %s", e)
        return TranscribeAudioResponse(transcription="", success=False, error=str(e))


# ─── Auto-Pilot Persona Auto-Responder ──────────────────────────

@app.post("/autopilot/generate-reply", response_model=AutopilotReplyResponse)
async def autopilot_reply_endpoint(
    request: AutopilotReplyRequest,
    x_argus_secret: str | None = Header(None),
) -> AutopilotReplyResponse:
    """Generate an authentic WhatsApp reply acting as Yusuf."""
    verify_secret(x_argus_secret)

    # 1. Fetch relevant memories from Second Brain based on the incoming message
    relevant_memories = recall_memories(request.incoming_message, limit=3)

    # 2. Generate persona reply
    reply_text = generate_autopilot_persona_reply(
        incoming_message=request.incoming_message,
        sender_name=request.sender_name or "Friend",
        recent_history=request.recent_chat_history,
        personal_memories=relevant_memories,
        custom_instruction=request.custom_instruction,
    )

    return AutopilotReplyResponse(
        reply_text=reply_text,
        confidence=0.95,
        should_send=True,
    )


# ─── Health Check ───────────────────────────────────────────────

@app.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "argus-brain",
        "version": "2.1.0",
        "email_configured": email_reader.is_configured(),
        "capabilities": [
            "intent-routing",
            "event-extraction",
            "reminders",
            "whisper-voice-notes",
            "email-reading",
            "memory-second-brain",
            "web-search",
            "executive-briefing",
            "summarization",
        ],
    }
