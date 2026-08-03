"""Pydantic models for the ARGUS AI Brain API."""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal


# ─── Event Extraction (original) ────────────────────────────────

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


# ─── Intent Classification (new) ────────────────────────────────

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
        description="Detected intent: event, reminder, todo, question, summarize, none",
    )
    confidence: float = Field(..., ge=0.0, le=1.0)
    should_respond: bool = Field(..., description="Whether ARGUS should respond to this message")
    extract_data: Optional[dict] = Field(
        None,
        description="Intent-specific extracted data",
    )


# ─── Reminder Parsing (new) ─────────────────────────────────────

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


# ─── Summarize (new) ────────────────────────────────────────────

class ChatMessage(BaseModel):
    """A single message in a conversation."""

    sender: str
    text: str
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


# ─── Ask (Q&A) (new) ────────────────────────────────────────────

class AskRequest(BaseModel):
    """Request body for POST /ask."""

    question: str = Field(..., description="The question to answer")


class AskResponse(BaseModel):
    """Response body for POST /ask."""

    answer: str


# ─── Todo (new) ─────────────────────────────────────────────────

class TodoRequest(BaseModel):
    """Request body for POST /todo."""

    action: Literal["add", "list", "complete", "delete"] = Field(
        ..., description="The action to perform"
    )
    text: Optional[str] = Field(None, description="Todo text (for add)")
    todo_id: Optional[int] = Field(None, description="Todo ID (for complete/delete)")


class TodoItem(BaseModel):
    """A single todo item."""

    id: int
    text: str
    completed: bool
    created_at: str


class TodoResponse(BaseModel):
    """Response body for POST /todo."""

    todos: List[TodoItem] = []
    message: str
