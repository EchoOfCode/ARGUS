"""
Tests for Brain Database Engine & Unified Expense Ledger.
Verifies PRAGMAs, idempotent ingestion, split calculations, debts, rounding, and audit log immutability.
"""

import os
import sqlite3
import tempfile

import pytest

from db import (
    get_financial_summary,
    get_sqlite_connection,
    ingest_message,
    init_schema,
    record_bill_split,
    record_expense,
    settle_debt,
)


@pytest.fixture
def temp_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    init_schema(path)
    yield path
    try:
        os.remove(path)
        wal = f"{path}-wal"
        shm = f"{path}-shm"
        if os.path.exists(wal):
            os.remove(wal)
        if os.path.exists(shm):
            os.remove(shm)
    except OSError:
        pass


def test_sqlite_pragmas(temp_db):
    conn = get_sqlite_connection(temp_db)
    cursor = conn.cursor()

    cursor.execute("PRAGMA journal_mode;")
    journal_mode = cursor.fetchone()[0]
    assert journal_mode.lower() == "wal"

    cursor.execute("PRAGMA foreign_keys;")
    foreign_keys = cursor.fetchone()[0]
    assert foreign_keys == 1

    cursor.execute("PRAGMA busy_timeout;")
    busy_timeout = cursor.fetchone()[0]
    assert busy_timeout == 5000

    conn.close()


def test_idempotent_message_ingestion(temp_db):
    is_new, id1 = ingest_message(
        chat_jid="919876543210@s.whatsapp.net",
        chat_name="Alex",
        sender_jid="919876543210@s.whatsapp.net",
        sender_name="Alex",
        message_text="Meeting at 5pm",
        timestamp="2026-10-11T10:00:00Z",
        message_id="MSG_STANZA_1001",
        db_path=temp_db,
    )
    assert is_new is True
    assert id1 is not None

    # Ingest the exact same message_id again (reconnect delivery)
    is_new2, id2 = ingest_message(
        chat_jid="919876543210@s.whatsapp.net",
        chat_name="Alex",
        sender_jid="919876543210@s.whatsapp.net",
        sender_name="Alex",
        message_text="Meeting at 5pm",
        timestamp="2026-10-11T10:00:00Z",
        message_id="MSG_STANZA_1001",
        db_path=temp_db,
    )
    assert is_new2 is False
    assert id2 == id1


def test_record_expense_positive_and_negative_rejection(temp_db):
    rec = record_expense(
        amount=450.50,
        description="Dinner at diner",
        category="Food",
        db_path=temp_db,
    )
    assert rec["amount"] == 450.50
    assert rec["category"] == "Food"

    # Negative amount should raise ValueError
    with pytest.raises(ValueError, match="non-negative"):
        record_expense(
            amount=-50.0,
            description="Invalid negative expense",
            db_path=temp_db,
        )


def test_record_bill_split_and_rounding(temp_db):
    # Total 100 split across owner + 2 participants (3 people total)
    # 100 / 3 = 33.33 each with remainder cent
    split = record_bill_split(
        total_amount=100.0,
        description="Lunch split",
        paid_by_me=True,
        participants=["Alex", "Jordan"],
        db_path=temp_db,
    )

    assert split["other_shares"]["Alex"] == 33.33
    assert split["other_shares"]["Jordan"] == 33.33
    assert split["owner_share"] == 33.34
    assert round(split["owner_share"] + 33.33 + 33.33, 2) == 100.00

    summary = get_financial_summary(temp_db)
    assert summary["total_spent"] == 33.34
    assert summary["total_owed_to_me"] == 66.66
    assert summary["net_balance"] == 66.66


def test_settle_debt(temp_db):
    record_expense(
        amount=200.0,
        description="Taxi ride",
        person="Alex",
        is_debt=1,  # Alex owes me
        db_path=temp_db,
    )

    summary_before = get_financial_summary(temp_db)
    assert summary_before["total_owed_to_me"] == 200.0

    # Partial settle
    res = settle_debt(person="Alex", amount=50.0, db_path=temp_db)
    assert res["settled"] is True

    summary_mid = get_financial_summary(temp_db)
    assert summary_mid["total_owed_to_me"] == 150.0

    # Full settle
    res2 = settle_debt(person="Alex", amount=None, db_path=temp_db)
    assert res2["settled"] is True
    assert res2["fully_cleared"] is True

    summary_after = get_financial_summary(temp_db)
    assert summary_after["total_owed_to_me"] == 0.0


def test_audit_log_append_only_triggers(temp_db):
    conn = get_sqlite_connection(temp_db)
    cursor = conn.cursor()

    cursor.execute(
        """
        INSERT INTO outbound_audit_log (target_jid, trigger_type, tier, content_sha256, latency_ms, verdict)
        VALUES ('919876543210@s.whatsapp.net', 'owner_command', 0, 'abcd1234hash', 12, 'approved')
        """
    )
    conn.commit()
    record_id = cursor.lastrowid

    # Attempting to UPDATE must fail via trigger
    with pytest.raises(sqlite3.IntegrityError, match="Audit log is append-only"):
        cursor.execute("UPDATE outbound_audit_log SET verdict = 'tampered' WHERE id = ?", (record_id,))

    # Attempting to DELETE must fail via trigger
    with pytest.raises(sqlite3.IntegrityError, match="Audit log is append-only"):
        cursor.execute("DELETE FROM outbound_audit_log WHERE id = ?", (record_id,))

    conn.close()
