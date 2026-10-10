"""
ARGUS AI Brain — Bridge Gateway REST Endpoints.
Single-writer API layer handling message ingestion, state queries, financial ledger, and outbound policy.
"""

import hashlib
import logging
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("argus.api_bridge")

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from auth import verify_request_auth
from db import (
    get_db,
    get_financial_summary,
    ingest_message,
    record_bill_split,
    record_expense,
    settle_debt,
)

bridge_router = APIRouter(prefix="/api", tags=["bridge_gateway"])


async def _authenticate_request(
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> None:
    """Helper to verify request authentication."""
    body_bytes = await request.body()
    verify_request_auth(
        body_bytes=body_bytes,
        signature_header=x_argus_signature,
        timestamp_header=x_argus_timestamp,
        legacy_secret_header=x_argus_secret,
    )


# ─── MODELS ─────────────────────────────────────────────────────

class IngestMessageRequest(BaseModel):
    chat_jid: str
    chat_name: Optional[str] = None
    sender_jid: str
    sender_name: Optional[str] = None
    message_text: str
    timestamp: str
    is_from_me: bool = False
    message_id: Optional[str] = None


class ContactSyncItem(BaseModel):
    jid: str
    name: str
    is_group: bool = False


class ContactSyncRequest(BaseModel):
    contacts: List[ContactSyncItem]


class TodoCreateRequest(BaseModel):
    chat_jid: str
    text: str


class ExpenseRecordRequest(BaseModel):
    amount: float = Field(gt=0)
    description: str
    person: Optional[str] = None
    category: str = "General"
    is_debt: int = 0
    chat_jid: str = "self"


class BillSplitRequest(BaseModel):
    total_amount: float = Field(gt=0)
    description: str
    paid_by_me: bool = True
    participants: List[str]
    chat_jid: str = "self"


class SettleDebtRequest(BaseModel):
    person: str
    amount: Optional[float] = None


class PolicyEvaluateRequest(BaseModel):
    target_jid: str
    message_text: str
    trigger_type: str  # 'owner_command', 'autopilot_reply', 'reminder_alert'
    is_group: bool = False


class PolicyApproveRequest(BaseModel):
    approval_id: str
    message_text: str


# ─── INGESTION ──────────────────────────────────────────────────

@bridge_router.post("/ingest/message")
async def ingest_message_endpoint(
    data: IngestMessageRequest,
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Idempotently ingest an incoming/outgoing WhatsApp message."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)

    is_new, record_id = ingest_message(
        chat_jid=data.chat_jid,
        chat_name=data.chat_name,
        sender_jid=data.sender_jid,
        sender_name=data.sender_name,
        message_text=data.message_text,
        timestamp=data.timestamp,
        is_from_me=data.is_from_me,
        message_id=data.message_id,
    )
    return {"success": True, "is_new": is_new, "id": record_id}


# ─── REMINDERS ──────────────────────────────────────────────────

@bridge_router.get("/reminders/due")
async def get_due_reminders_endpoint(
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Fetch pending reminders that are due for delivery."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM reminders WHERE status = 'pending' AND due_at <= datetime('now')")
        reminders = [dict(r) for r in cursor.fetchall()]
        return {"reminders": reminders}


@bridge_router.post("/reminders/{reminder_id}/ack")
async def ack_reminder_endpoint(
    reminder_id: int,
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Mark a reminder as dispatched."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE reminders SET status = 'sent', sent_at = datetime('now') WHERE id = ?", (reminder_id,))
        return {"success": cursor.rowcount > 0}


# ─── CONTACTS ───────────────────────────────────────────────────

@bridge_router.post("/contacts/sync")
async def sync_contacts_endpoint(
    data: ContactSyncRequest,
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Sync contact directory metadata."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    with get_db() as conn:
        cursor = conn.cursor()
        for c in data.contacts:
            cursor.execute(
                """
                INSERT INTO chat_directory (jid, name, is_group, updated_at)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(jid) DO UPDATE SET
                    name = excluded.name,
                    is_group = excluded.is_group,
                    updated_at = datetime('now')
                """,
                (c.jid, c.name, 1 if c.is_group else 0),
            )
        return {"success": True, "count": len(data.contacts)}


# ─── TODOS ──────────────────────────────────────────────────────

@bridge_router.get("/todos")
async def get_todos_endpoint(
    chat_jid: str,
    request: Request,
    include_completed: bool = False,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Fetch todos for a given chat."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    with get_db() as conn:
        cursor = conn.cursor()
        if include_completed:
            cursor.execute("SELECT * FROM todos WHERE chat_jid = ? ORDER BY created_at DESC", (chat_jid,))
        else:
            cursor.execute("SELECT * FROM todos WHERE chat_jid = ? AND completed = 0 ORDER BY created_at DESC", (chat_jid,))
        return {"todos": [dict(r) for r in cursor.fetchall()]}


@bridge_router.post("/todos")
async def add_todo_endpoint(
    data: TodoCreateRequest,
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Create a new todo item."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO todos (chat_jid, text) VALUES (?, ?)", (data.chat_jid, data.text.strip()))
        return {"success": True, "id": cursor.lastrowid}


@bridge_router.post("/todos/{todo_id}/complete")
async def complete_todo_endpoint(
    todo_id: int,
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Mark a todo as completed."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE todos SET completed = 1, completed_at = datetime('now') WHERE id = ?", (todo_id,))
        return {"success": cursor.rowcount > 0}


# ─── EXPENSES ───────────────────────────────────────────────────

@bridge_router.post("/expenses")
async def record_expense_endpoint(
    data: ExpenseRecordRequest,
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Record an expense or debt."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    row = record_expense(
        amount=data.amount,
        description=data.description,
        person=data.person,
        category=data.category,
        is_debt=data.is_debt,
        chat_jid=data.chat_jid,
    )
    return {"success": True, "expense": row}


@bridge_router.get("/expenses/summary")
async def get_expense_summary_endpoint(
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Get financial summary and net balance."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    summary = get_financial_summary()
    return {"summary": summary}


@bridge_router.post("/expenses/split")
async def record_bill_split_endpoint(
    data: BillSplitRequest,
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Record a bill split with exact rounding."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    res = record_bill_split(
        total_amount=data.total_amount,
        description=data.description,
        paid_by_me=data.paid_by_me,
        participants=data.participants,
        chat_jid=data.chat_jid,
    )
    return {"success": True, "split": res}


@bridge_router.post("/expenses/settle")
async def settle_debt_endpoint(
    data: SettleDebtRequest,
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Settle debt with a person."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    res = settle_debt(person=data.person, amount=data.amount)
    return {"success": True, "result": res}


# ─── OUTBOUND POLICY ENGINE (ADR 0003) ──────────────────────────

def _hash_content(text: str) -> str:
    """Compute deterministic SHA-256 hash of message content."""
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


@bridge_router.post("/policy/evaluate")
async def policy_evaluate_endpoint(
    data: PolicyEvaluateRequest,
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """
    Mandatory single choke point policy evaluation before sending messages to WhatsApp.
    Enforces fail-closed semantics, contact tiers, rate limits, and audit logging.
    """
    start_time = time.time()
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)

    content_hash = _hash_content(data.message_text)

    # 1. Check Global Emergency Killswitch
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM autopilot_rules WHERE jid = 'GLOBAL_KILLSWITCH'")
        killswitch_row = cursor.fetchone()
        if killswitch_row and killswitch_row["status"] == "active":
            latency = int((time.time() - start_time) * 1000)
            _log_audit(data.target_jid, data.trigger_type, 0, content_hash, latency, "rejected", "Global killswitch active")
            return {"verdict": "rejected", "reason": "Global emergency killswitch is active", "tier": 0}

    # 2. Check Global Hourly Cap (max 10 autonomous messages/hour)
    if data.trigger_type == "autopilot_reply":
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT COUNT(*) as cnt FROM outbound_audit_log
                WHERE trigger_type = 'autopilot_reply' AND verdict = 'approved'
                AND timestamp >= datetime('now', '-1 hour')
                """
            )
            count_hour = cursor.fetchone()["cnt"]
            if count_hour >= 10:
                latency = int((time.time() - start_time) * 1000)
                _log_audit(data.target_jid, data.trigger_type, 0, content_hash, latency, "rejected", "Global hourly cap reached")
                return {"verdict": "rejected", "reason": "Global hourly autonomous cap reached (10/hr)", "tier": 0}

    # 3. Check Per-Contact Rate Limit (max 3 autonomous messages / 10 min)
    if data.trigger_type == "autopilot_reply":
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT COUNT(*) as cnt FROM outbound_audit_log
                WHERE target_jid = ? AND trigger_type = 'autopilot_reply' AND verdict = 'approved'
                AND timestamp >= datetime('now', '-10 minutes')
                """,
                (data.target_jid,),
            )
            count_contact = cursor.fetchone()["cnt"]
            if count_contact >= 3:
                latency = int((time.time() - start_time) * 1000)
                _log_audit(data.target_jid, data.trigger_type, 0, content_hash, latency, "rejected", "Per-contact rate limit exceeded")
                return {"verdict": "rejected", "reason": "Contact rate limit exceeded (max 3 per 10m)", "tier": 0}

    # 4. Loop Detection: Check if contact and assistant alternated >= 3 times in 2 minutes
    if data.trigger_type == "autopilot_reply":
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT COUNT(*) as cnt FROM outbound_audit_log
                WHERE target_jid = ? AND verdict = 'approved' AND timestamp >= datetime('now', '-2 minutes')
                """,
                (data.target_jid,),
            )
            recent_exchanges = cursor.fetchone()["cnt"]
            if recent_exchanges >= 3:
                # Quarantine to Tier 0
                cursor.execute(
                    "UPDATE autopilot_rules SET tier = 0, status = 'quarantined' WHERE jid = ?",
                    (data.target_jid,),
                )
                latency = int((time.time() - start_time) * 1000)
                _log_audit(data.target_jid, data.trigger_type, 0, content_hash, latency, "rejected", "Loop detected; contact quarantined to Tier 0")
                return {"verdict": "rejected", "reason": "Conversational loop detected; quarantined to Tier 0", "tier": 0}

    # 5. Handle Owner-Initiated Send
    if data.trigger_type in ["owner_command", "reminder_alert"]:
        latency = int((time.time() - start_time) * 1000)
        _log_audit(data.target_jid, data.trigger_type, 0, content_hash, latency, "approved", None)
        return {"verdict": "approved", "tier": 0, "undo_delay_s": 0}

    # 6. Handle Assistant-Initiated Reply (Evaluate Tiers)
    # Tier 2 is prohibited in group chats in v1
    if data.is_group:
        latency = int((time.time() - start_time) * 1000)
        _log_audit(data.target_jid, data.trigger_type, 0, content_hash, latency, "draft_only", "Group chats restricted to Tier 0")
        return {"verdict": "draft_only", "reason": "Group autonomous replies prohibited in v1", "tier": 0}

    # Fetch rule for contact
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT tier, status FROM autopilot_rules WHERE jid = ?", (data.target_jid,))
        rule = cursor.fetchone()
        from db import get_kill_switch_status
        if get_kill_switch_status():
            latency = int((time.time() - start_time) * 1000)
            _log_audit(data.target_jid, data.trigger_type, 0, content_hash, latency, "kill_switch_engaged", "Global kill switch active")
            return {"verdict": "draft_only", "reason": "Global autonomy kill switch is engaged", "tier": 0}

        tier = rule["tier"] if rule and rule["status"] == "active" else 0

        if tier == 2:
            latency = int((time.time() - start_time) * 1000)
            _log_audit(data.target_jid, data.trigger_type, 2, content_hash, latency, "approved", None)
            return {"verdict": "approved", "tier": 2, "undo_delay_s": 8}

        if tier == 1:
            # Create server-side approval token bound to hash and 15-min expiry
            approval_id = f"appr_{int(time.time()*1000)}_{content_hash[:8]}"
            cursor.execute(
                """
                INSERT INTO pending_approvals (id, target_jid, draft_text, content_sha256, trigger_type, expires_at, status)
                VALUES (?, ?, ?, ?, ?, datetime('now', '+15 minutes'), 'pending')
                """,
                (approval_id, data.target_jid, data.message_text, content_hash, data.trigger_type),
            )
            latency = int((time.time() - start_time) * 1000)
            _log_audit(data.target_jid, data.trigger_type, 1, content_hash, latency, "requires_approval", None)
            return {
                "verdict": "requires_approval",
                "tier": 1,
                "approval_id": approval_id,
                "content_hash": content_hash,
                "expires_in_seconds": 900,
            }

        # Default: Tier 0 (Draft Only - saved to inbox for human-in-the-loop review)
        draft_id = f"draft_{int(time.time()*1000)}_{content_hash[:8]}"
        cursor.execute(
            """
            INSERT INTO pending_approvals (id, target_jid, draft_text, content_sha256, trigger_type, expires_at, status)
            VALUES (?, ?, ?, ?, ?, datetime('now', '+24 hours'), 'pending')
            """,
            (draft_id, data.target_jid, data.message_text, content_hash, data.trigger_type),
        )
        latency = int((time.time() - start_time) * 1000)
        _log_audit(data.target_jid, data.trigger_type, 0, content_hash, latency, "draft_only", "Default Tier 0")
        return {
            "verdict": "draft_only",
            "reason": "Contact is configured as Tier 0 (Draft Only)",
            "tier": 0,
            "draft_id": draft_id,
        }


@bridge_router.post("/policy/approve")
async def policy_approve_endpoint(
    data: PolicyApproveRequest,
    request: Request,
    x_argus_signature: Optional[str] = Header(None),
    x_argus_timestamp: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Approve a time-bound approval token."""
    await _authenticate_request(request, x_argus_signature, x_argus_timestamp, x_argus_secret)
    content_hash = _hash_content(data.message_text)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pending_approvals WHERE id = ?", (data.approval_id,))
        record = cursor.fetchone()

        if not record:
            raise HTTPException(status_code=404, detail="Approval record not found")
        if record["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Approval record is already {record['status']}")
        if record["content_sha256"] != content_hash:
            raise HTTPException(status_code=400, detail="Message content hash mismatch; message was altered")

        cursor.execute("UPDATE pending_approvals SET status = 'approved' WHERE id = ?", (data.approval_id,))
        return {"approved": True, "target_jid": record["target_jid"]}


def _log_audit(
    target_jid: str,
    trigger_type: str,
    tier: int,
    content_hash: str,
    latency_ms: int,
    verdict: str,
    rejection_reason: Optional[str],
) -> None:
    """Helper to record immutable audit log entries (zero message bodies stored)."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO outbound_audit_log (target_jid, trigger_type, tier, content_sha256, latency_ms, verdict, rejection_reason)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (target_jid, trigger_type, tier, content_hash, latency_ms, verdict, rejection_reason),
            )
    except Exception as err:
        logger.error("Failed to append to audit log: %s", err)
