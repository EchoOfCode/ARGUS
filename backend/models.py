"""Pydantic models for the ARGUS AI Brain API."""

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


# ─── Event Extraction ───────────────────────────────────────────

class ExtractRequest(BaseModel):
    """Request body for POST /extract-event."""

    source_app: str = Field(
        ...,
        description="Android package name or source identifier",
        examples=["com.whatsapp", "self-chat"],
    )
    notification_text: str = Field(
        ...,
        description="Raw captured text",
        examples=["hey are we still on for tuesday at 3pm?"],
    )
    received_at: str = Field(
        ...,
        description="ISO 8601 timestamp, phone-local time",
        examples=["2026-07-31T14:02:00+05:30"],
    )


class ExtractResponse(BaseModel):
    """Response body for POST /extract-event."""

    is_event: bool
    title: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    raw_text: Optional[str] = None


# ─── Intent Classification ──────────────────────────────────────

class ProcessMessageRequest(BaseModel):
    """Request body for POST /process-message."""

    sender_jid: str = Field(..., description="WhatsApp JID of the sender")
    message_text: str = Field(..., description="The message text")
    chat_jid: str = Field(..., description="WhatsApp JID of the chat")
    timestamp: str = Field(..., description="ISO 8601 timestamp")
    is_self_chat: bool = Field(False, description="Whether this is from self-chat (command mode)")


class ProcessMessageResponse(BaseModel):
    """Response body for POST /process-message."""

    intent: str = Field(
        ...,
        description="Detected intent: event, reminder, todo, question, summarize, email_list, email_summary, email_search, catchup, memory_save, memory_recall, search, briefing, none",
    )
    confidence: float = Field(..., ge=0.0, le=1.0)
    should_respond: bool = Field(..., description="Whether ARGUS should respond to this message")
    extract_data: Optional[dict] = Field(
        None,
        description="Intent-specific extracted data",
    )


# ─── Reminder Parsing ───────────────────────────────────────────

class ReminderRequest(BaseModel):
    """Request body for POST /parse-reminder."""

    message_text: str = Field(..., description="Natural language reminder text")
    reference_timestamp: str = Field(
        ..., description="ISO 8601 timestamp as reference 'now'"
    )


class ReminderResponse(BaseModel):
    """Response body for POST /parse-reminder."""

    reminder_text: str = Field(..., description="Clean reminder text")
    due_at: str = Field(..., description="ISO 8601 datetime when the reminder is due")
    confidence: float = Field(..., ge=0.0, le=1.0)


# ─── Summarize ──────────────────────────────────────────────────

class ChatMessage(BaseModel):
    """A single message in a conversation."""

    sender_name: Optional[str] = None
    sender_jid: Optional[str] = None
    message_text: str
    timestamp: str


class SummarizeRequest(BaseModel):
    """Request body for POST /summarize."""

    messages: List[ChatMessage] = Field(..., description="List of messages to summarize")
    instruction: str = Field(
        "summarize this conversation",
        description="User's instruction for summarization",
    )


class SummarizeResponse(BaseModel):
    """Response body for POST /summarize."""

    summary: str


# ─── Ask (Q&A) ──────────────────────────────────────────────────

class AskRequest(BaseModel):
    """Request body for POST /ask."""

    question: str = Field(..., description="The question to answer")
    use_web_search: bool = Field(False, description="Whether to include live web search results")


class AskResponse(BaseModel):
    """Response body for POST /ask."""

    answer: str
    sources: Optional[List[Dict[str, str]]] = None


# ─── Email Models ───────────────────────────────────────────────

class EmailItem(BaseModel):
    """Representation of an email."""

    id: str
    subject: str
    sender: str
    date: str
    snippet: str
    body: Optional[str] = None


class EmailListResponse(BaseModel):
    """Response for listing unread/searched emails."""

    emails: List[EmailItem]
    count: int
    is_configured: bool = True
    message: Optional[str] = None


class EmailSummaryRequest(BaseModel):
    """Request body to summarize an email."""

    email_id: Optional[str] = None
    subject: Optional[str] = None
    sender: Optional[str] = None
    date: Optional[str] = None
    body: Optional[str] = None


class EmailSummaryResponse(BaseModel):
    """Response body for email summary."""

    email_id: Optional[str] = None
    subject: str
    summary: str


class EmailSearchRequest(BaseModel):
    """Request body to search emails."""

    query: str
    limit: int = 5


# ─── Memory Models ("Second Brain") ─────────────────────────────

class MemorySaveRequest(BaseModel):
    """Request to save a memory fact."""

    fact: str
    category: str = "general"


class MemorySaveResponse(BaseModel):
    """Response for memory save."""

    id: int
    fact: str
    category: str
    message: str


class MemoryRecallRequest(BaseModel):
    """Request to search memory."""

    query: str
    limit: int = 5


class MemoryRecallResponse(BaseModel):
    """Response for memory query."""

    memories: List[Dict[str, Any]]
    answer: Optional[str] = None


# ─── Web Search ─────────────────────────────────────────────────

class WebSearchRequest(BaseModel):
    """Request body for web search."""

    query: str
    limit: int = 5


class WebSearchResponse(BaseModel):
    """Response body for web search."""

    query: str
    results: List[Dict[str, Any]]


# ─── Daily Briefing ─────────────────────────────────────────────

class BriefingRequest(BaseModel):
    """Request to compile a daily briefing."""

    todos: List[Dict[str, Any]] = []
    reminders: List[Dict[str, Any]] = []
    events: List[Dict[str, Any]] = []
    include_emails: bool = True


class BriefingResponse(BaseModel):
    """Response for daily briefing."""

    briefing_text: str


# ─── Audio / Voice Note Transcription ───────────────────────────

class TranscribeAudioResponse(BaseModel):
    """Response from Groq Whisper audio transcription."""

    transcription: str
    success: bool
    error: Optional[str] = None
