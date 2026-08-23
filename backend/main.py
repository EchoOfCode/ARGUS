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
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, Header, HTTPException, UploadFile

from agent_core import run_autonomous_agent, auto_harvest_memories
from audio_transcriber import transcribe_audio_bytes
from vision_doc_analyzer import analyze_document_or_image
from email_reader import email_reader
from groq_client import (
    answer_question,
    classify_and_tag_memory,
    detect_commitments,
    detect_meeting_proposal,
    extract_event,
    generate_autopilot_persona_reply,
    generate_briefing,
    resolve_meeting_proposal,
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
    CommitmentDetectRequest,
    CommitmentDetectResponse,
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
    ProposalDetectRequest,
    ProposalDetectResponse,
    ProposalResolveRequest,
    ProposalResolveResponse,
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

from dashboard import dashboard_router

app = FastAPI(
    title="ARGUS AI Brain",
    description="Multi-capability executive AI assistant backend",
    version="2.1.0",
)

app.include_router(dashboard_router)

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

        # Autonomous background episodic memory harvester
        try:
            auto_harvest_memories(request.message_text, sender_name=request.sender_jid)
        except Exception:
            pass

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
            message_text=request.message_text,
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


# ─── Q&A with Autonomous Agent ("OpenClaw" Core) ────────────────

@app.post("/ask", response_model=AskResponse)
async def ask_endpoint(
    request: AskRequest,
    x_argus_secret: str | None = Header(None),
) -> AskResponse:
    """Answer questions using Autonomous Tool-Calling Agent Engine."""
    verify_secret(x_argus_secret)

    try:
        answer = run_autonomous_agent(
            user_prompt=request.question,
            recent_history=request.recent_history,
        )
        return AskResponse(answer=answer, sources=None)
    except Exception as e:
        logger.error("Agent ask failed: %s", e)
        # Fallback to direct Groq Q&A
        try:
            answer = answer_question(question=request.question)
            return AskResponse(answer=answer, sources=None)
        except Exception:
            raise HTTPException(status_code=502, detail=str(e))


@app.post("/agent/run")
async def run_agent_endpoint(
    request: Dict[str, Any],
    x_argus_secret: str | None = Header(None),
) -> Dict[str, Any]:
    """Run autonomous tool-calling agent directly."""
    verify_secret(x_argus_secret)
    prompt = request.get("prompt", "")
    history = request.get("recent_history")
    time_str = request.get("current_time_str")

    res = run_autonomous_agent(
        user_prompt=prompt,
        recent_history=history,
        current_time_str=time_str,
    )
    return {"result": res, "success": True}


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
        chat_name=request.chat_name,
        is_group=request.is_group,
        recent_history=request.recent_chat_history,
        personal_memories=relevant_memories,
        custom_instruction=request.custom_instruction,
        current_time_str=request.current_time_str,
        user_style_samples=request.user_style_samples,
    )

    return AutopilotReplyResponse(
        reply_text=reply_text,
        confidence=0.95,
        should_send=True,
    )


# ─── Human-in-the-Loop Meeting Proposal Negotiation ───────────

@app.post("/autopilot/detect-proposal", response_model=ProposalDetectResponse)
async def detect_proposal_endpoint(
    request: ProposalDetectRequest,
    x_argus_secret: str | None = Header(None),
) -> ProposalDetectResponse:
    """Detect if an incoming message is proposing a meeting/plan."""
    verify_secret(x_argus_secret)

    res = detect_meeting_proposal(
        incoming_message=request.incoming_message,
        sender_name=request.sender_name or "Friend",
        chat_name=request.chat_name,
        is_group=request.is_group,
        reference_timestamp=request.reference_timestamp,
    )
    return ProposalDetectResponse(**res)


@app.post("/autopilot/resolve-proposal", response_model=ProposalResolveResponse)
async def resolve_proposal_endpoint(
    request: ProposalResolveRequest,
    x_argus_secret: str | None = Header(None),
) -> ProposalResolveResponse:
    """Generate authentic message to accept, decline, or counter-propose a meeting."""
    verify_secret(x_argus_secret)

    reply_text = resolve_meeting_proposal(
        action=request.action,
        sender_name=request.sender_name or "Friend",
        chat_name=request.chat_name,
        is_group=request.is_group,
        proposed_title=request.proposed_title,
        proposed_date=request.proposed_date,
        proposed_time=request.proposed_time,
        proposed_location=request.proposed_location,
        user_note=request.user_note,
        counter_time=request.counter_time,
    )

    return ProposalResolveResponse(
        reply_text=reply_text,
        event_title=request.proposed_title,
        event_date=request.proposed_date,
        event_time=request.proposed_time if request.action == "accept" else request.counter_time,
    )


# ─── Commitment & Promise Detection ─────────────────────────────

@app.post("/commitments/detect", response_model=CommitmentDetectResponse)
async def detect_commitments_endpoint(
    request: CommitmentDetectRequest,
    x_argus_secret: str | None = Header(None),
) -> CommitmentDetectResponse:
    """Detect promises and commitments made in a chat message."""
    verify_secret(x_argus_secret)

    res = detect_commitments(
        message_text=request.message_text,
        sender_name=request.sender_name or "Contact",
        is_from_me=request.is_from_me,
        reference_timestamp=request.reference_timestamp,
    )
    return CommitmentDetectResponse(**res)


# ─── Document, PDF & Vision Intelligence ────────────────────────

@app.post("/documents/analyze")
async def analyze_document_endpoint(
    file: UploadFile = File(...),
    prompt: Optional[str] = None,
    x_argus_secret: str | None = Header(None),
) -> Dict[str, Any]:
    """Analyze PDF document, syllabus, or screenshot image."""
    verify_secret(x_argus_secret)

    content = await file.read()
    filename = file.filename or "document.pdf"
    mime_type = file.content_type or "application/pdf"

    res = analyze_document_or_image(
        file_bytes=content,
        filename=filename,
        mime_type=mime_type,
        user_prompt=prompt,
    )
    return res


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
