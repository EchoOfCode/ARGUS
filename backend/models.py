"""Pydantic models for the ARGUS backend API."""

from pydantic import BaseModel, Field
from typing import Optional


class ExtractRequest(BaseModel):
    """Request body for POST /extract-event."""

    source_app: str = Field(
        ...,
        description="Android package name of the notifying app",
        examples=["com.whatsapp"],
    )
    notification_text: str = Field(
        ...,
        description="Raw captured text (title + body concatenated)",
        examples=["hey are we still on for tuesday at 3pm?"],
    )
    received_at: str = Field(
        ...,
        description="ISO 8601 timestamp, phone-local time",
        examples=["2026-07-31T14:02:00+05:30"],
    )


class ExtractResponse(BaseModel):
    """Response body for POST /extract-event."""

    is_event: bool = Field(
        ...,
        description="Whether an event/meeting was detected",
    )
    title: Optional[str] = Field(
        None,
        description="Short, human-usable event title",
    )
    date: Optional[str] = Field(
        None,
        description="YYYY-MM-DD, resolved to an absolute date",
    )
    time: Optional[str] = Field(
        None,
        description="HH:MM 24-hour, null if no time mentioned (all-day event)",
    )
    confidence: Optional[float] = Field(
        None,
        description="0.0–1.0, model's self-assessed confidence",
        ge=0.0,
        le=1.0,
    )
    raw_text: Optional[str] = Field(
        None,
        description="Echoed back so the Android app can display it on the Edit screen",
    )
