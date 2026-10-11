"""
ARGUS Brain — UI API Router for Web Application (Phase 3).
Provides secure, single-owner endpoints for Chat, Approvals Inbox, Contacts & Autonomy,
Memory (Zero Credential Leakage), Ledger, Activity Log, and System Status.
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import verify_ui_auth
from db import (
    get_db,
    get_kill_switch_status,
    set_kill_switch_status,
)
from memory import DB_PATH as MEMORY_DB_PATH
from memory import delete_memory, save_memory

logger = logging.getLogger("argus.api_ui")

ui_router = APIRouter(prefix="/api/ui", tags=["ui"])


# ─── AUTHENTICATION DEPENDENCY ───────────────────────────────────

async def require_ui_owner_auth(
    authorization: Optional[str] = Header(None),
    x_argus_web_key: Optional[str] = Header(None),
    x_argus_secret: Optional[str] = Header(None),
) -> None:
    """Enforce owner authentication on every UI API route."""
    verify_ui_auth(
        authorization=authorization,
        x_argus_web_key=x_argus_web_key,
        x_argus_secret=x_argus_secret,
    )


# ─── MODELS ──────────────────────────────────────────────────────

class AuthVerifyRequest(BaseModel):
    key: str


class ChatStreamRequest(BaseModel):
    message: str = Field(..., min_length=1)
    history: Optional[List[Dict[str, Any]]] = None


class ApprovalActionRequest(BaseModel):
    action: str = Field(..., pattern="^(approve|edit|decline)$")
    edited_text: Optional[str] = None


class ContactTierUpdateRequest(BaseModel):
    tier: int = Field(..., ge=0, le=2)
    status: Optional[str] = Field("active", pattern="^(active|disabled)$")


class ContactCreateRequest(BaseModel):
    name: str = Field(..., min_length=1)
    phone: str = Field(..., min_length=3)
    tier: Optional[int] = Field(0, ge=0, le=2)


class ContactImportItem(BaseModel):
    name: str = Field(..., min_length=1)
    phone: str = Field(..., min_length=3)
    tier: Optional[int] = Field(0, ge=0, le=2)


class ContactBatchImportRequest(BaseModel):
    contacts: List[ContactImportItem]


class KillSwitchRequest(BaseModel):
    active: bool


class MemoryCreateRequest(BaseModel):
    fact_text: str = Field(..., min_length=1)
    category: Optional[str] = "general"
    entities: Optional[List[str]] = None


# ─── 1. AUTH VERIFICATION ────────────────────────────────────────

@ui_router.post("/auth/verify")
async def verify_auth_token(payload: AuthVerifyRequest) -> Dict[str, Any]:
    """Validate owner access key for client login."""
    try:
        verify_ui_auth(x_argus_web_key=payload.key)
        return {"authenticated": True, "status": "ok"}
    except HTTPException as e:
        raise HTTPException(status_code=401, detail="Invalid access key") from e


# ─── 2. CHAT STREAMING (AG-UI SSE SPECIFICATION) ─────────────────

async def generate_ag_ui_events(prompt: str, history: Optional[List[Dict[str, Any]]]) -> AsyncGenerator[str, None]:
    """
    Generate Server-Sent Events conforming to the AG-UI specification:
    RUN_STARTED -> TOOL_CALL_START -> TOOL_CALL_RESULT -> TEXT_MESSAGE_CHUNK -> RUN_FINISHED
    """
    run_id = f"run_{int(time.time()*1000)}"
    start_payload = {
        "event": "RUN_STARTED",
        "run_id": run_id,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    yield f"event: RUN_STARTED\ndata: {json.dumps(start_payload)}\n\n"

    try:
        from agent_core import run_autonomous_agent

        # Run agent loop in thread to keep FastAPI event loop responsive
        # In test mode or when Groq API key is mock, returns clean response
        loop = asyncio.get_running_loop()
        agent_response = await loop.run_in_executor(
            None,
            lambda: run_autonomous_agent(user_prompt=prompt, recent_history=history, is_untrusted=False),
        )

        # Stream response chunks to demonstrate live streaming
        chunk_size = 24
        for i in range(0, len(agent_response), chunk_size):
            chunk = agent_response[i:i + chunk_size]
            chunk_payload = {
                "event": "TEXT_MESSAGE_CHUNK",
                "run_id": run_id,
                "content": chunk,
            }
            yield f"event: TEXT_MESSAGE_CHUNK\ndata: {json.dumps(chunk_payload)}\n\n"
            await asyncio.sleep(0.01)

        finish_payload = {
            "event": "RUN_FINISHED",
            "run_id": run_id,
            "status": "completed",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        yield f"event: RUN_FINISHED\ndata: {json.dumps(finish_payload)}\n\n"

    except asyncio.CancelledError:
        logger.info("Chat stream aborted by client: run_id=%s", run_id)
        error_payload = {"event": "RUN_ERROR", "run_id": run_id, "error": "Client cancelled run"}
        yield f"event: RUN_ERROR\ndata: {json.dumps(error_payload)}\n\n"
    except Exception as e:
        logger.error("Error during AG-UI chat stream: %s", e)
        error_payload = {"event": "RUN_ERROR", "run_id": run_id, "error": str(e)}
        yield f"event: RUN_ERROR\ndata: {json.dumps(error_payload)}\n\n"


@ui_router.post("/chat/stream", dependencies=[Depends(require_ui_owner_auth)])
async def chat_stream_endpoint(payload: ChatStreamRequest) -> StreamingResponse:
    """Stream chat responses with AG-UI SSE protocol."""
    return StreamingResponse(
        generate_ag_ui_events(payload.message, payload.history),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── 3. APPROVALS INBOX ──────────────────────────────────────────

@ui_router.get("/approvals", dependencies=[Depends(require_ui_owner_auth)])
async def list_approvals(status: str = Query("pending")) -> List[Dict[str, Any]]:
    """List approval drafts (pending, approved, edited, declined)."""
    with get_db() as conn:
        cursor = conn.cursor()
        if status == "all":
            cursor.execute(
                """
                SELECT pa.id, pa.target_jid, pa.draft_text, pa.content_sha256, 
                       pa.trigger_type, pa.created_at, pa.expires_at, pa.status,
                       COALESCE(cd.name, pa.target_jid) as contact_name
                FROM pending_approvals pa
                LEFT JOIN chat_directory cd ON pa.target_jid = cd.jid
                ORDER BY pa.created_at DESC LIMIT 100
                """
            )
        else:
            cursor.execute(
                """
                SELECT pa.id, pa.target_jid, pa.draft_text, pa.content_sha256, 
                       pa.trigger_type, pa.created_at, pa.expires_at, pa.status,
                       COALESCE(cd.name, pa.target_jid) as contact_name
                FROM pending_approvals pa
                LEFT JOIN chat_directory cd ON pa.target_jid = cd.jid
                WHERE pa.status = ?
                ORDER BY pa.created_at DESC LIMIT 100
                """,
                (status,),
            )
        return [dict(row) for row in cursor.fetchall()]


@ui_router.post("/approvals/{approval_id}/action", dependencies=[Depends(require_ui_owner_auth)])
async def act_on_approval(approval_id: str, payload: ApprovalActionRequest) -> Dict[str, Any]:
    """Approve, edit, or decline an outbound draft and log to append-only audit trail."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pending_approvals WHERE id = ?", (approval_id,))
        record = cursor.fetchone()

        if not record:
            raise HTTPException(status_code=404, detail="Approval draft not found")

        current_status = record["status"]
        if current_status not in ("pending", "requires_approval"):
            raise HTTPException(status_code=400, detail=f"Approval draft already processed as {current_status}")

        target_jid = record["target_jid"]
        trigger_type = record["trigger_type"]
        final_text = payload.edited_text if payload.action == "edit" and payload.edited_text else record["draft_text"]
        new_hash = hashlib.sha256(final_text.encode("utf-8")).hexdigest()

        if payload.action == "approve":
            cursor.execute("UPDATE pending_approvals SET status = 'approved' WHERE id = ?", (approval_id,))
            verdict = "approved"
        elif payload.action == "edit":
            if not payload.edited_text:
                raise HTTPException(status_code=400, detail="Edited text cannot be empty for edit action")
            cursor.execute(
                "UPDATE pending_approvals SET status = 'approved', draft_text = ?, content_sha256 = ? WHERE id = ?",
                (payload.edited_text, new_hash, approval_id),
            )
            verdict = "edited_approved"
        elif payload.action == "decline":
            cursor.execute("UPDATE pending_approvals SET status = 'declined' WHERE id = ?", (approval_id,))
            verdict = "declined"
        else:
            raise HTTPException(status_code=400, detail="Invalid action")

        # Record human-in-the-loop decision to immutable outbound_audit_log
        cursor.execute(
            """
            INSERT INTO outbound_audit_log (timestamp, target_jid, trigger_type, tier, content_sha256, latency_ms, verdict, rejection_reason)
            VALUES (datetime('now'), ?, ?, 1, ?, 0, ?, ?)
            """,
            (target_jid, f"{trigger_type}:ui_owner", new_hash, verdict, "Owner web UI decision"),
        )

        return {
            "success": True,
            "id": approval_id,
            "verdict": verdict,
            "target_jid": target_jid,
            "final_text": final_text,
        }


# ─── 4. CONTACTS & AUTONOMY ──────────────────────────────────────

@ui_router.get("/contacts", dependencies=[Depends(require_ui_owner_auth)])
async def list_contacts_and_tiers() -> List[Dict[str, Any]]:
    """List contacts with their configured autonomy tier and autopilot status."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT cd.jid, cd.name, cd.is_group,
                   COALESCE(ar.tier, 0) as tier,
                   COALESCE(ar.status, 'disabled') as status,
                   COALESCE(ar.auto_reply_count, 0) as auto_reply_count,
                   ar.last_replied_at
            FROM chat_directory cd
            LEFT JOIN autopilot_rules ar ON cd.jid = ar.jid
            WHERE cd.is_group = 0
            ORDER BY cd.name ASC
            """
        )
        return [dict(row) for row in cursor.fetchall()]


@ui_router.patch("/contacts/{jid}/tier", dependencies=[Depends(require_ui_owner_auth)])
async def update_contact_tier(jid: str, payload: ContactTierUpdateRequest) -> Dict[str, Any]:
    """Configure contact autonomy tier (0=Draft Only, 1=Supervised, 2=Autonomous)."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM chat_directory WHERE jid = ?", (jid,))
        contact = cursor.fetchone()
        contact_name = contact["name"] if contact else jid

        cursor.execute(
            """
            INSERT INTO autopilot_rules (jid, name, status, tier, created_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(jid) DO UPDATE SET tier = excluded.tier, status = excluded.status
            """,
            (jid, contact_name, payload.status or "active", payload.tier),
        )
        return {"jid": jid, "tier": payload.tier, "status": payload.status}


def normalize_whatsapp_jid(phone_or_jid: str) -> str:
    cleaned = phone_or_jid.strip().lower()
    if cleaned.endswith("@s.whatsapp.net") or cleaned.endswith("@g.us"):
        return cleaned
    digits = re.sub(r"[^0-9]", "", cleaned)
    if len(digits) == 10:
        digits = f"91{digits}"
    return f"{digits}@s.whatsapp.net"


@ui_router.post("/contacts", dependencies=[Depends(require_ui_owner_auth)])
async def create_contact(payload: ContactCreateRequest) -> Dict[str, Any]:
    """Manually add or update a contact in the WhatsApp directory."""
    jid = normalize_whatsapp_jid(payload.phone)
    name = payload.name.strip()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO chat_directory (jid, name, is_group, last_message_at)
            VALUES (?, ?, 0, datetime('now'))
            ON CONFLICT(jid) DO UPDATE SET name = excluded.name
            """,
            (jid, name),
        )
        cursor.execute(
            """
            INSERT INTO autopilot_rules (jid, name, status, tier, created_at)
            VALUES (?, ?, 'active', ?, datetime('now'))
            ON CONFLICT(jid) DO UPDATE SET name = excluded.name, tier = excluded.tier
            """,
            (jid, name, payload.tier or 0),
        )
        return {"success": True, "jid": jid, "name": name, "tier": payload.tier or 0}


@ui_router.post("/contacts/import", dependencies=[Depends(require_ui_owner_auth)])
async def import_contacts(payload: ContactBatchImportRequest) -> Dict[str, Any]:
    """Batch import contacts (from vCard .vcf or CSV spreadsheet)."""
    imported_count = 0
    with get_db() as conn:
        cursor = conn.cursor()
        for item in payload.contacts:
            name = item.name.strip()
            if not name:
                continue
            jid = normalize_whatsapp_jid(item.phone)
            digits = re.sub(r"[^0-9]", "", jid.split("@")[0])
            if len(digits) >= 7:
                cursor.execute(
                    """
                    INSERT INTO chat_directory (jid, name, is_group, last_message_at)
                    VALUES (?, ?, 0, datetime('now'))
                    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
                    """,
                    (jid, name),
                )
                cursor.execute(
                    """
                    INSERT INTO autopilot_rules (jid, name, status, tier, created_at)
                    VALUES (?, ?, 'active', ?, datetime('now'))
                    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
                    """,
                    (jid, name, item.tier or 0),
                )
                imported_count += 1
    return {"success": True, "imported_count": imported_count}


@ui_router.post("/contacts/scan-history", dependencies=[Depends(require_ui_owner_auth)])
async def scan_history_for_contacts() -> Dict[str, Any]:
    """Scan message logs to automatically discover past contacts and sync to directory."""
    discovered = 0
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT sender_jid as jid, sender_name as name 
            FROM message_log 
            WHERE sender_jid LIKE '%@s.whatsapp.net' AND sender_jid != 'owner' AND sender_jid != ''
            UNION
            SELECT DISTINCT chat_jid as jid, chat_name as name 
            FROM message_log 
            WHERE chat_jid LIKE '%@s.whatsapp.net' AND chat_jid != ''
            """
        )
        rows = cursor.fetchall()
        for r in rows:
            jid = r["jid"]
            name = r["name"] or jid.split("@")[0]
            cursor.execute(
                """
                INSERT INTO chat_directory (jid, name, is_group, last_message_at)
                VALUES (?, ?, 0, datetime('now'))
                ON CONFLICT(jid) DO UPDATE SET name = COALESCE(NULLIF(chat_directory.name, ''), excluded.name)
                """,
                (jid, name),
            )
            discovered += 1
    return {"success": True, "discovered_count": discovered}


@ui_router.delete("/contacts/{jid}", dependencies=[Depends(require_ui_owner_auth)])
async def delete_contact(jid: str) -> Dict[str, Any]:
    """Delete a contact from chat directory and autopilot rules."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM chat_directory WHERE jid = ?", (jid,))
        cursor.execute("DELETE FROM autopilot_rules WHERE jid = ?", (jid,))
        return {"success": True, "deleted": jid}


@ui_router.get("/killswitch", dependencies=[Depends(require_ui_owner_auth)])
async def get_kill_switch() -> Dict[str, bool]:
    """Get global autonomous reply kill switch status."""
    return {"active": get_kill_switch_status()}


@ui_router.post("/killswitch", dependencies=[Depends(require_ui_owner_auth)])
async def toggle_kill_switch(payload: KillSwitchRequest) -> Dict[str, bool]:
    """Engage or disengage global autonomous reply kill switch."""
    set_kill_switch_status(payload.active)
    logger.warning("Global autonomy kill switch toggled: active=%s", payload.active)
    return {"active": payload.active}


# ─── 5. MEMORY (ZERO-CREDENTIAL LEAKAGE) ─────────────────────────

SENSITIVE_CATEGORIES = ("credentials", "credential", "password", "secret", "keys", "tokens", "vault")

@ui_router.get("/memory", dependencies=[Depends(require_ui_owner_auth)])
async def list_memories() -> List[Dict[str, Any]]:
    """
    List user memories.
    CRITICAL SECURITY GUARANTEE: Never renders or returns credentials or vault entries.
    """
    if not os.path.exists(MEMORY_DB_PATH):
        return []

    import sqlite3
    with sqlite3.connect(MEMORY_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        # Strictly exclude any sensitive or vault category
        cursor.execute(
            """
            SELECT id, fact_text, category, entities, created_at, updated_at
            FROM memories
            WHERE LOWER(category) NOT IN ('credentials', 'credential', 'password', 'secret', 'keys', 'tokens', 'vault')
            ORDER BY id DESC
            LIMIT 200
            """
        )
        rows = cursor.fetchall()
        results = []
        for r in rows:
            entities = []
            try:
                entities = json.loads(r["entities"] or "[]")
            except Exception:
                pass
            results.append({
                "id": r["id"],
                "fact_text": r["fact_text"],
                "category": r["category"],
                "entities": entities,
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            })
        return results


@ui_router.post("/memory", dependencies=[Depends(require_ui_owner_auth)])
async def create_memory(payload: MemoryCreateRequest) -> Dict[str, Any]:
    """Create a new fact in the second brain."""
    clean_cat = (payload.category or "general").strip().lower()
    if clean_cat in SENSITIVE_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail="Credentials cannot be stored as memories. Use the encrypted vault CLI."
        )
    result = save_memory(
        fact=payload.fact_text,
        category=payload.category or "general",
        entities=payload.entities or [],
    )
    return result


@ui_router.delete("/memory/{memory_id}", dependencies=[Depends(require_ui_owner_auth)])
async def remove_memory(memory_id: int) -> Dict[str, Any]:
    """Delete a memory fact by ID."""
    success = delete_memory(memory_id)
    return {"id": memory_id, "deleted": success}


# ─── 6. LEDGER / FINANCES ────────────────────────────────────────

@ui_router.get("/ledger", dependencies=[Depends(require_ui_owner_auth)])
async def get_ledger_summary() -> Dict[str, Any]:
    """Get financial overview, debt tracking (who owes whom), and recent expenses."""
    with get_db() as conn:
        cursor = conn.cursor()

        # Total personal expense
        cursor.execute("SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE is_debt = 0")
        total_spent = cursor.fetchone()["total"]

        # Total owed to me
        cursor.execute("SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE is_debt = 1")
        owed_to_me = cursor.fetchone()["total"]

        # Total I owe
        cursor.execute("SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE is_debt = 2")
        i_owe = cursor.fetchone()["total"]

        # Summary by category
        cursor.execute(
            """
            SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
            FROM expenses
            WHERE is_debt = 0
            GROUP BY category
            ORDER BY total DESC
            """
        )
        by_category = [dict(r) for r in cursor.fetchall()]

        # Debts / Credits list
        cursor.execute(
            """
            SELECT id, person, amount, currency, description, is_debt, created_at
            FROM expenses
            WHERE is_debt IN (1, 2)
            ORDER BY created_at DESC
            """
        )
        debts = [dict(r) for r in cursor.fetchall()]

        # Recent transactions
        cursor.execute(
            """
            SELECT id, amount, currency, category, description, person, is_debt, created_at
            FROM expenses
            ORDER BY created_at DESC LIMIT 50
            """
        )
        recent = [dict(r) for r in cursor.fetchall()]

        return {
            "total_spent": total_spent,
            "owed_to_me": owed_to_me,
            "i_owe": i_owe,
            "net_debt_balance": owed_to_me - i_owe,
            "by_category": by_category,
            "debts": debts,
            "recent": recent,
        }


# ─── 7. ACTIVITY LOG ─────────────────────────────────────────────

@ui_router.get("/activity", dependencies=[Depends(require_ui_owner_auth)])
async def get_activity_log() -> Dict[str, Any]:
    """Get audit decisions from outbound_audit_log and recent WhatsApp messages."""
    with get_db() as conn:
        cursor = conn.cursor()

        # Recent policy audit records
        cursor.execute(
            """
            SELECT al.id, al.timestamp, al.target_jid, al.trigger_type, 
                   al.tier, al.content_sha256, al.latency_ms, al.verdict, al.rejection_reason,
                   COALESCE(cd.name, al.target_jid) as contact_name
            FROM outbound_audit_log al
            LEFT JOIN chat_directory cd ON al.target_jid = cd.jid
            ORDER BY al.id DESC LIMIT 50
            """
        )
        audit_log = [dict(r) for r in cursor.fetchall()]

        # Recent WhatsApp messages
        cursor.execute(
            """
            SELECT id, chat_jid, chat_name, sender_jid, sender_name, 
                   message_text, timestamp, is_from_me, created_at
            FROM message_log
            ORDER BY id DESC LIMIT 50
            """
        )
        messages = [dict(r) for r in cursor.fetchall()]

        return {
            "audit_log": audit_log,
            "messages": messages,
        }


# ─── 8. SYSTEM STATUS & HEALTH ───────────────────────────────────

@ui_router.get("/status", dependencies=[Depends(require_ui_owner_auth)])
async def get_system_status() -> Dict[str, Any]:
    """Get health status, WhatsApp connection state, QR code if unlinked, and active model."""
    from config import get_settings

    settings = get_settings()
    llm_provider = settings.llm_provider
    model_name = settings.groq_model if llm_provider == "groq" else (settings.llm_model or "default")

    with get_db() as conn:
        cursor = conn.cursor()

        # Check bridge connection activity in last 5 minutes
        cursor.execute("SELECT MAX(created_at) as last_msg FROM message_log")
        last_msg = cursor.fetchone()["last_msg"]

        cursor.execute("SELECT COUNT(*) as count FROM pending_approvals WHERE status = 'pending'")
        pending_count = cursor.fetchone()["count"]

        cursor.execute("SELECT COUNT(*) as count FROM chat_directory WHERE is_group = 0")
        contacts_count = cursor.fetchone()["count"]

        cursor.execute("SELECT COUNT(*) as count FROM expenses")
        expenses_count = cursor.fetchone()["count"]

    # Check memory count
    memories_count = 0
    if os.path.exists(MEMORY_DB_PATH):
        import sqlite3
        with sqlite3.connect(MEMORY_DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM memories WHERE LOWER(category) NOT IN ('credentials', 'credential', 'password', 'secret', 'keys', 'tokens', 'vault')")
            memories_count = cursor.fetchone()[0]

    # Read QR code if bridge has written one for pairing
    qr_code = None
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    qr_path = os.path.join(repo_root, "apps", "bridge", "auth_info", "qr.txt")
    if os.path.exists(qr_path):
        try:
            with open(qr_path, "r", encoding="utf-8") as f:
                qr_code = f.read().strip()
        except Exception:
            pass

    return {
        "brain_healthy": True,
        "whatsapp_connected": bool(last_msg),
        "last_message_at": last_msg,
        "qr_code": qr_code,
        "llm_provider": llm_provider,
        "llm_model": model_name,
        "kill_switch_active": get_kill_switch_status(),
        "stats": {
            "pending_approvals": pending_count,
            "contacts": contacts_count,
            "memories": memories_count,
            "expenses": expenses_count,
        },
    }
