"""
ARGUS AI Brain — Database Engine & Single-Writer Persistence Layer.
Owns all SQLite connections, schema initialization, PRAGMAs, and business logic.
"""

import logging
import os
import sqlite3
from contextlib import contextmanager
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, Generator, List, Optional, Tuple

logger = logging.getLogger("argus.db")


def resolve_db_path() -> str:
    """Resolve absolute path to the primary SQLite database (argus.db)."""
    if os.getenv("ARGUS_DB_PATH"):
        return os.path.abspath(os.environ["ARGUS_DB_PATH"])
    if os.getenv("BRIDGE_DB_PATH"):
        return os.path.abspath(os.environ["BRIDGE_DB_PATH"])

    # Look for persistent /app/data in Docker container
    if os.path.exists("/app/data"):
        return "/app/data/argus.db"

    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    data_dir = os.path.join(repo_root, "data")
    if os.path.exists(data_dir):
        return os.path.join(data_dir, "argus.db")

    monorepo_path = os.path.join(repo_root, "apps", "brain", "data", "argus.db")
    return monorepo_path


DB_PATH = resolve_db_path()


def get_sqlite_connection(db_path: Optional[str] = None) -> sqlite3.Connection:
    """Create a raw SQLite connection with mandatory concurrency PRAGMAs."""
    target_path = db_path or resolve_db_path()
    os.makedirs(os.path.dirname(target_path), exist_ok=True)

    conn = sqlite3.connect(target_path, timeout=15.0)
    conn.row_factory = sqlite3.Row

    # Apply strict SQLite performance and concurrency pragmas (ADR 0001)
    cursor = conn.cursor()
    cursor.execute("PRAGMA journal_mode = WAL;")
    cursor.execute("PRAGMA busy_timeout = 15000;")
    cursor.execute("PRAGMA foreign_keys = ON;")
    cursor.execute("PRAGMA synchronous = NORMAL;")
    cursor.close()

    return conn


@contextmanager
def get_db(db_path: Optional[str] = None) -> Generator[sqlite3.Connection, None, None]:
    """Context manager yielding a thread-safe connection with auto-commit/rollback."""
    conn = get_sqlite_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_schema(db_path: Optional[str] = None) -> None:
    """Initialize all core tables, indices, and append-only audit triggers."""
    with get_db(db_path) as conn:
        cursor = conn.cursor()
        cursor.executescript("""
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_jid TEXT NOT NULL,
                reminder_text TEXT NOT NULL,
                due_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                sent_at TEXT
            );

            CREATE TABLE IF NOT EXISTS todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_jid TEXT NOT NULL,
                text TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS message_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_jid TEXT NOT NULL,
                chat_name TEXT,
                sender_jid TEXT NOT NULL,
                sender_name TEXT,
                message_text TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                is_from_me INTEGER NOT NULL DEFAULT 0,
                message_id TEXT UNIQUE,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS pending_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_jid TEXT NOT NULL,
                sender_jid TEXT NOT NULL,
                original_text TEXT NOT NULL,
                title TEXT,
                event_date TEXT,
                event_time TEXT,
                confidence REAL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                confirmed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS chat_directory (
                jid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_group INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS exempted_chats (
                jid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS pending_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_jid TEXT NOT NULL,
                target_name TEXT NOT NULL,
                message_text TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                sent_at TEXT
            );

            CREATE TABLE IF NOT EXISTS pending_proposals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_jid TEXT NOT NULL,
                chat_jid TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                chat_name TEXT,
                proposed_title TEXT NOT NULL,
                proposed_date TEXT,
                proposed_time TEXT,
                proposed_location TEXT,
                raw_message TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                resolved_at TEXT
            );

            CREATE TABLE IF NOT EXISTS tracked_followups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_jid TEXT NOT NULL,
                contact_name TEXT NOT NULL,
                last_sent_text TEXT NOT NULL,
                sent_at TEXT NOT NULL DEFAULT (datetime('now')),
                status TEXT NOT NULL DEFAULT 'waiting',
                last_nudged_at TEXT
            );

            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_jid TEXT NOT NULL DEFAULT 'self',
                amount REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'INR',
                category TEXT NOT NULL DEFAULT 'General',
                description TEXT NOT NULL,
                person TEXT,
                is_debt INTEGER NOT NULL DEFAULT 0, -- 0=expense, 1=owed to me, 2=i owe
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS autopilot_rules (
                jid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'disabled',
                tier INTEGER NOT NULL DEFAULT 0,
                custom_prompt TEXT,
                auto_reply_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_replied_at TEXT
            );

            -- ADR 0003 & ADR 0004: Server-side approval tokens bound to SHA-256 hash and draft content
            CREATE TABLE IF NOT EXISTS pending_approvals (
                id TEXT PRIMARY KEY,
                target_jid TEXT NOT NULL,
                draft_text TEXT DEFAULT '',
                content_sha256 TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending'
            );

            -- System settings (e.g. global kill switch)
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- ADR 0003: Append-only audit log with DB triggers
            CREATE TABLE IF NOT EXISTS outbound_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                target_jid TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                tier INTEGER NOT NULL,
                content_sha256 TEXT NOT NULL,
                latency_ms INTEGER NOT NULL,
                verdict TEXT NOT NULL,
                rejection_reason TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at, status);
            CREATE INDEX IF NOT EXISTS idx_todos_chat ON todos(chat_jid, completed);
            CREATE INDEX IF NOT EXISTS idx_messages_chat ON message_log(chat_jid, timestamp);
            CREATE INDEX IF NOT EXISTS idx_messages_id ON message_log(message_id);
            CREATE INDEX IF NOT EXISTS idx_expenses_person ON expenses(person, is_debt);
            CREATE INDEX IF NOT EXISTS idx_audit_time ON outbound_audit_log(timestamp);
            CREATE INDEX IF NOT EXISTS idx_approvals_expiry ON pending_approvals(expires_at, status);
        """)

        # Migration: ensure draft_text column exists on pending_approvals if created in earlier schema
        cursor.execute("PRAGMA table_info(pending_approvals)")
        pa_cols = [c[1] for c in cursor.fetchall()]
        if "draft_text" not in pa_cols and pa_cols:
            cursor.execute("ALTER TABLE pending_approvals ADD COLUMN draft_text TEXT DEFAULT ''")

        # Install append-only triggers on outbound_audit_log
        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS prevent_audit_log_update
            BEFORE UPDATE ON outbound_audit_log
            BEGIN
                SELECT RAISE(ABORT, 'Audit log is append-only and cannot be modified');
            END;
        """)
        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS prevent_audit_log_delete
            BEFORE DELETE ON outbound_audit_log
            BEGIN
                SELECT RAISE(ABORT, 'Audit log is append-only and cannot be deleted');
            END;
        """)


def get_system_setting(key: str, default: str = "", db_path: Optional[str] = None) -> str:
    """Retrieve a system setting value safely."""
    try:
        with get_db(db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM system_settings WHERE key = ?", (key,))
            row = cursor.fetchone()
            return row["value"] if row else default
    except sqlite3.OperationalError:
        return default


def set_system_setting(key: str, value: str, db_path: Optional[str] = None) -> None:
    """Upsert a system setting value."""
    init_schema(db_path)
    with get_db(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO system_settings (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, str(value)),
        )


def get_kill_switch_status(db_path: Optional[str] = None) -> bool:
    """Check if the global autonomous kill switch is active."""
    return get_system_setting("kill_switch", "0", db_path) == "1"


def set_kill_switch_status(active: bool, db_path: Optional[str] = None) -> None:
    """Set the global autonomous kill switch status."""
    set_system_setting("kill_switch", "1" if active else "0", db_path)


def get_offline_mode(db_path: Optional[str] = None) -> bool:
    """Check if offline-only mode (System 1 Zero-Token) is active."""
    return get_system_setting("offline_mode", "0", db_path) == "1"


def set_offline_mode(active: bool, db_path: Optional[str] = None) -> None:
    """Set offline-only mode (True=System 1 only, False=Online System 1 + System 2)."""
    set_system_setting("offline_mode", "1" if active else "0", db_path)


# ─── MESSAGE INGESTION (IDEMPOTENT) ─────────────────────────────

def ingest_message(
    chat_jid: str,
    chat_name: Optional[str],
    sender_jid: str,
    sender_name: Optional[str],
    message_text: str,
    timestamp: str,
    is_from_me: bool = False,
    message_id: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Tuple[bool, Optional[int]]:
    """
    Ingest a WhatsApp message into message_log idempotently based on message_id.
    Returns (is_new, record_id).
    """
    with get_db(db_path) as conn:
        cursor = conn.cursor()
        if message_id:
            cursor.execute("SELECT id FROM message_log WHERE message_id = ?", (message_id,))
            existing = cursor.fetchone()
            if existing:
                return False, existing["id"]

        cursor.execute(
            """
            INSERT INTO message_log (chat_jid, chat_name, sender_jid, sender_name, message_text, timestamp, is_from_me, message_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (chat_jid, chat_name, sender_jid, sender_name, message_text, timestamp, 1 if is_from_me else 0, message_id),
        )
        record_id = cursor.lastrowid

        # Update chat directory
        contact_name = chat_name if chat_jid.endswith("@g.us") else (sender_name or chat_jid.split("@")[0])
        cursor.execute(
            """
            INSERT INTO chat_directory (jid, name, is_group, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(jid) DO UPDATE SET
                name = excluded.name,
                updated_at = datetime('now')
            """,
            (chat_jid, contact_name, 1 if chat_jid.endswith("@g.us") else 0),
        )

        return True, record_id


# ─── UNIFIED EXPENSE & DEBT LEDGER ──────────────────────────────

def _to_decimal(val: Any) -> Decimal:
    """Helper to convert float/int/str to 2-decimal rounded Decimal."""
    return Decimal(str(val)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def record_expense(
    amount: float,
    description: str,
    person: Optional[str] = None,
    category: str = "General",
    is_debt: int = 0,
    chat_jid: str = "self",
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Record an expense or debt into the ledger.
    Negative amounts are rejected to enforce clean ledger accounting.
    """
    if amount < 0:
        raise ValueError("Expense amounts must be non-negative. For refunds or repayments, use settle_debt.")

    dec_amount = _to_decimal(amount)
    float_amount = float(dec_amount)

    with get_db(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO expenses (chat_jid, amount, currency, category, description, person, is_debt, created_at)
            VALUES (?, ?, 'INR', ?, ?, ?, ?, datetime('now'))
            """,
            (chat_jid, float_amount, category, description.strip(), person.strip() if person else None, is_debt),
        )
        expense_id = cursor.lastrowid
        cursor.execute("SELECT * FROM expenses WHERE id = ?", (expense_id,))
        row = dict(cursor.fetchone())
        return row


def record_bill_split(
    total_amount: float,
    description: str,
    paid_by_me: bool,
    participants: List[str],
    chat_jid: str = "self",
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Record a shared bill split with exact cent rounding.
    If paid by me: records total expense for my share, and debts owed to me for other participants.
    """
    if total_amount <= 0:
        raise ValueError("Total amount must be greater than zero.")
    if not participants:
        raise ValueError("Participants list cannot be empty.")

    cleaned_participants = [p.strip() for p in participants if p.strip()]
    num_people = len(cleaned_participants) + 1  # includes owner

    total_dec = _to_decimal(total_amount)
    base_split = (total_dec / Decimal(num_people)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    # Calculate remainder cents to avoid rounding drift
    remainder = total_dec - (base_split * Decimal(num_people))
    owner_share = float(base_split + remainder)
    other_share = float(base_split)

    results = {"owner_share": owner_share, "other_shares": {}}

    with get_db(db_path) as conn:
        cursor = conn.cursor()
        if paid_by_me:
            # 1. Record owner's actual consumed expense
            cursor.execute(
                """
                INSERT INTO expenses (chat_jid, amount, currency, category, description, is_debt)
                VALUES (?, ?, 'INR', 'Food/Shared', ?, 0)
                """,
                (chat_jid, owner_share, f"{description} (My share)"),
            )
            # 2. Record debts owed to owner by each participant
            for person in cleaned_participants:
                cursor.execute(
                    """
                    INSERT INTO expenses (chat_jid, amount, currency, category, description, person, is_debt)
                    VALUES (?, ?, 'INR', 'Shared Split', ?, ?, 1)
                    """,
                    (chat_jid, other_share, f"{description} split", person),
                )
                results["other_shares"][person] = other_share
        else:
            # Someone else paid; owner owes payer their share
            primary_payer = cleaned_participants[0]
            cursor.execute(
                """
                INSERT INTO expenses (chat_jid, amount, currency, category, description, person, is_debt)
                VALUES (?, ?, 'INR', 'Shared Split', ?, ?, 2)
                """,
                (chat_jid, owner_share, f"{description} split owed to {primary_payer}", primary_payer),
            )
            results["other_shares"][primary_payer] = -owner_share

    return results


def get_financial_summary(db_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Compute comprehensive balance sheet: total recent spending, debts owed to me, debts I owe,
    and net balance with high-precision rounding.
    """
    with get_db(db_path) as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM expenses WHERE is_debt = 0 ORDER BY created_at DESC LIMIT 50")
        expenses = [dict(r) for r in cursor.fetchall()]
        total_spent = sum(_to_decimal(e["amount"]) for e in expenses)

        cursor.execute("SELECT * FROM expenses WHERE is_debt = 1 ORDER BY created_at DESC")
        owed_to_me = [dict(r) for r in cursor.fetchall()]
        total_owed_to_me = sum(_to_decimal(e["amount"]) for e in owed_to_me)

        cursor.execute("SELECT * FROM expenses WHERE is_debt = 2 ORDER BY created_at DESC")
        i_owe = [dict(r) for r in cursor.fetchall()]
        total_i_owe = sum(_to_decimal(e["amount"]) for e in i_owe)

        net_balance = total_owed_to_me - total_i_owe

        return {
            "total_spent": float(total_spent),
            "total_owed_to_me": float(total_owed_to_me),
            "total_i_owe": float(total_i_owe),
            "net_balance": float(net_balance),
            "recent_expenses": expenses[:15],
            "debts_owed_to_me": owed_to_me,
            "debts_i_owe": i_owe,
        }


def settle_debt(person: str, amount: Optional[float] = None, db_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Settle or reduce debts with a specific person.
    If amount is None, settles all outstanding debts with that person.
    """
    clean_person = person.strip().lower()
    with get_db(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM expenses WHERE LOWER(person) = ? AND is_debt IN (1, 2) ORDER BY created_at ASC",
            (clean_person,),
        )
        debts = [dict(r) for r in cursor.fetchall()]

        if not debts:
            return {"settled": False, "message": f"No active debts found for {person}."}

        settled_ids = []
        if amount is None:
            for d in debts:
                cursor.execute("DELETE FROM expenses WHERE id = ?", (d["id"],))
                settled_ids.append(d["id"])
            return {"settled": True, "fully_cleared": True, "settled_records": settled_ids}

        # Partial settlement
        remaining = _to_decimal(amount)
        for d in debts:
            debt_amt = _to_decimal(d["amount"])
            if remaining >= debt_amt:
                cursor.execute("DELETE FROM expenses WHERE id = ?", (d["id"],))
                remaining -= debt_amt
                settled_ids.append(d["id"])
            else:
                new_amt = float(debt_amt - remaining)
                cursor.execute("UPDATE expenses SET amount = ? WHERE id = ?", (new_amt, d["id"]))
                remaining = Decimal("0.00")
                settled_ids.append(d["id"])
                break

        return {"settled": True, "remaining_unapplied": float(remaining), "settled_records": settled_ids}
