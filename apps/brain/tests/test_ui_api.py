"""
Tests for ARGUS Web UI API Endpoints (Phase 3).
Verifies:
1. Strict authentication enforcement across all UI endpoints.
2. Outbound draft approvals inbox (Approve, Edit, Decline) with append-only audit trail logging.
3. Zero credential leakage: credentials and vault secrets are NEVER rendered or returned.
4. Contacts autonomy tier updates (0, 1, 2) and global kill switch.
5. Ledger financial aggregation and debt balance calculations.
6. AG-UI Server-Sent Events chat streaming specification.
"""

import os
import sqlite3

import pytest
from fastapi.testclient import TestClient

# Configure test mode
os.environ["ARGUS_TEST_MODE"] = "1"
os.environ["ARGUS_SECRET"] = "test_secret_32_bytes_long_minimum_value!"
os.environ["ARGUS_WEB_ACCESS_KEY"] = "test_owner_web_key_32_bytes_super_secure!"

from db import get_db, init_schema
from main import app
from memory import DB_PATH as MEMORY_DB_PATH
from memory import init_memory_db, save_memory
from vault import store_credential

client = TestClient(app)
AUTH_HEADERS = {"X-Argus-Web-Key": "test_owner_web_key_32_bytes_super_secure!"}


@pytest.fixture(autouse=True)
def setup_test_dbs(tmp_path, monkeypatch):
    """Set up isolated databases for UI tests."""
    db_file = str(tmp_path / "test_argus_ui.db")
    mem_file = str(tmp_path / "test_memory_ui.db")

    monkeypatch.setenv("BRIDGE_DB_PATH", db_file)
    monkeypatch.setattr("memory.DB_PATH", mem_file)
    monkeypatch.setattr("api_ui.MEMORY_DB_PATH", mem_file)

    init_schema(db_file)
    init_memory_db()

    # Pre-populate sample contacts
    with get_db(db_file) as conn:
        conn.execute("INSERT OR REPLACE INTO chat_directory (jid, name, is_group) VALUES ('12345@s.whatsapp.net', 'Alice Smith', 0)")
        conn.execute("INSERT OR REPLACE INTO chat_directory (jid, name, is_group) VALUES ('67890@s.whatsapp.net', 'Bob Jones', 0)")

    yield db_file


def test_auth_enforcement_on_all_ui_routes():
    """All UI endpoints must reject unauthenticated requests with 401."""
    unauthed_routes = [
        ("GET", "/api/ui/approvals"),
        ("POST", "/api/ui/approvals/test_id/action", {"action": "approve"}),
        ("GET", "/api/ui/contacts"),
        ("PATCH", "/api/ui/contacts/12345@s.whatsapp.net/tier", {"tier": 1}),
        ("GET", "/api/ui/killswitch"),
        ("POST", "/api/ui/killswitch", {"active": True}),
        ("GET", "/api/ui/memory"),
        ("POST", "/api/ui/memory", {"fact_text": "Alice likes coffee"}),
        ("GET", "/api/ui/ledger"),
        ("GET", "/api/ui/activity"),
        ("GET", "/api/ui/status"),
        ("POST", "/api/ui/chat/stream", {"message": "Hello"}),
    ]

    for item in unauthed_routes:
        method = item[0]
        url = item[1]
        data = item[2] if len(item) > 2 else None

        if method == "GET":
            resp = client.get(url)
        elif method == "POST":
            resp = client.post(url, json=data)
        elif method == "PATCH":
            resp = client.patch(url, json=data)

        assert resp.status_code == 401, f"Route {method} {url} allowed unauthenticated access! Status: {resp.status_code}"


def test_auth_verify_endpoint():
    """POST /api/ui/auth/verify validates owner access key."""
    # Invalid key
    resp = client.post("/api/ui/auth/verify", json={"key": "wrong_key"})
    assert resp.status_code == 401

    # Valid key
    resp = client.post("/api/ui/auth/verify", json={"key": "test_owner_web_key_32_bytes_super_secure!"})
    assert resp.status_code == 200
    assert resp.json()["authenticated"] is True


def test_approvals_inbox_lifecycle(setup_test_dbs):
    """Outbound drafts can be approved, edited, and declined, with audit log recording each action."""
    db_file = setup_test_dbs

    # Seed a pending draft
    draft_id = "draft_test_101"
    with get_db(db_file) as conn:
        conn.execute(
            """
            INSERT INTO pending_approvals (id, target_jid, draft_text, content_sha256, trigger_type, expires_at, status)
            VALUES (?, '12345@s.whatsapp.net', 'Hey Alice, are you free tomorrow?', 'hash101', 'autopilot', datetime('now', '+1 hour'), 'pending')
            """,
            (draft_id,),
        )

    # 1. Fetch pending approvals list
    list_resp = client.get("/api/ui/approvals", headers=AUTH_HEADERS)
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert len(items) == 1
    assert items[0]["id"] == draft_id
    assert items[0]["contact_name"] == "Alice Smith"
    assert "Hey Alice" in items[0]["draft_text"]

    # 2. Action: Edit & Approve
    edit_resp = client.post(
        f"/api/ui/approvals/{draft_id}/action",
        headers=AUTH_HEADERS,
        json={"action": "edit", "edited_text": "Hey Alice, let us meet tomorrow at 4pm instead."},
    )
    assert edit_resp.status_code == 200
    assert edit_resp.json()["verdict"] == "edited_approved"

    # Verify audit log recorded the edit and approval
    with get_db(db_file) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM outbound_audit_log WHERE target_jid = '12345@s.whatsapp.net'")
        audit = cursor.fetchone()
        assert audit is not None
        assert audit["verdict"] == "edited_approved"

        # Verify draft status updated
        cursor.execute("SELECT status, draft_text FROM pending_approvals WHERE id = ?", (draft_id,))
        updated = cursor.fetchone()
        assert updated["status"] == "approved"
        assert updated["draft_text"] == "Hey Alice, let us meet tomorrow at 4pm instead."

    # 3. Seed another draft and decline it
    draft_id_2 = "draft_test_102"
    with get_db(db_file) as conn:
        conn.execute(
            """
            INSERT INTO pending_approvals (id, target_jid, draft_text, content_sha256, trigger_type, expires_at, status)
            VALUES (?, '67890@s.whatsapp.net', 'Hey Bob, sending invoice.', 'hash102', 'autopilot', datetime('now', '+1 hour'), 'pending')
            """,
            (draft_id_2,),
        )

    decline_resp = client.post(
        f"/api/ui/approvals/{draft_id_2}/action",
        headers=AUTH_HEADERS,
        json={"action": "decline"},
    )
    assert decline_resp.status_code == 200
    assert decline_resp.json()["verdict"] == "declined"

    with get_db(db_file) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM pending_approvals WHERE id = ?", (draft_id_2,))
        assert cursor.fetchone()["status"] == "declined"


def test_zero_credential_leakage_in_memory_ui():
    """Credentials and vault items must NEVER be rendered or returned in GET /api/ui/memory."""
    # 1. Store a standard public fact
    save_memory("Favorite coffee is Ethiopian Yirgacheffe", category="preferences")

    # 2. Store sensitive credentials via vault
    store_credential(name="aws_secret_key", value="AKIA_SUPER_SECRET_KEY_12345", hint="AWS production root key")

    # 3. Attempt to store a credential fact via memory (which automatically routes to vault)
    save_memory("my_bank_pin is 9876", category="credentials")

    # 4. Directly inject into memory DB under sensitive categories to test filtering robustness
    with sqlite3.connect(MEMORY_DB_PATH) as conn:
        conn.execute("INSERT INTO memories (fact_text, category) VALUES ('leaked_api_token=xyz999', 'password')")
        conn.execute("INSERT INTO memories (fact_text, category) VALUES ('secret_db_pass=root123', 'secret')")
        conn.execute("INSERT INTO memories (fact_text, category) VALUES ('vault_master_key=abcdef', 'vault')")

    # Query UI memory endpoint
    resp = client.get("/api/ui/memory", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    memories = resp.json()

    # The preferences memory should be present
    fact_texts = [m["fact_text"] for m in memories]
    assert any("Ethiopian Yirgacheffe" in f for f in fact_texts)

    # NONE of the sensitive secrets or credentials should appear anywhere in the response
    raw_response_text = resp.text
    forbidden_tokens = [
        "AKIA_SUPER_SECRET_KEY_12345",
        "9876",
        "xyz999",
        "root123",
        "abcdef",
        "password",
        "vault",
    ]
    for token in forbidden_tokens:
        assert token not in raw_response_text, f"CRITICAL SECURITY LEAK: Token '{token}' was rendered in UI memory API!"


def test_contacts_tier_and_kill_switch(setup_test_dbs):
    """Configure contact autonomy tiers and verify global kill switch."""
    db_file = setup_test_dbs

    # 1. Fetch contacts list
    resp = client.get("/api/ui/contacts", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    contacts = resp.json()
    assert len(contacts) >= 2

    # 2. Update Alice to Tier 2 (Autonomous)
    patch_resp = client.patch(
        "/api/ui/contacts/12345@s.whatsapp.net/tier",
        headers=AUTH_HEADERS,
        json={"tier": 2, "status": "active"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["tier"] == 2

    # Verify updated in DB
    with get_db(db_file) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT tier, status FROM autopilot_rules WHERE jid = '12345@s.whatsapp.net'")
        rule = cursor.fetchone()
        assert rule["tier"] == 2
        assert rule["status"] == "active"

    # 3. Test Kill Switch
    ks_get = client.get("/api/ui/killswitch", headers=AUTH_HEADERS)
    assert ks_get.status_code == 200
    assert ks_get.json()["active"] is False

    ks_toggle = client.post("/api/ui/killswitch", headers=AUTH_HEADERS, json={"active": True})
    assert ks_toggle.status_code == 200
    assert ks_toggle.json()["active"] is True

    # Check status endpoint reflects kill switch
    status_resp = client.get("/api/ui/status", headers=AUTH_HEADERS)
    assert status_resp.status_code == 200
    assert status_resp.json()["kill_switch_active"] is True


def test_ledger_summary_and_debts(setup_test_dbs):
    """GET /api/ui/ledger calculates expenses, debt balances, and category breakdowns."""
    db_file = setup_test_dbs

    with get_db(db_file) as conn:
        # Personal expense: 500 Food
        conn.execute("INSERT INTO expenses (amount, currency, category, description, is_debt) VALUES (500, 'INR', 'Food', 'Groceries', 0)")
        # Personal expense: 300 Transport
        conn.execute("INSERT INTO expenses (amount, currency, category, description, is_debt) VALUES (300, 'INR', 'Transport', 'Taxi', 0)")
        # Owed to me (debtor): Bob owes 1200
        conn.execute("INSERT INTO expenses (amount, currency, category, description, person, is_debt) VALUES (1200, 'INR', 'Loan', 'Dinner split', 'Bob', 1)")
        # I owe (creditor): I owe Charlie 400
        conn.execute("INSERT INTO expenses (amount, currency, category, description, person, is_debt) VALUES (400, 'INR', 'Loan', 'Book purchase', 'Charlie', 2)")

    resp = client.get("/api/ui/ledger", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    data = resp.json()

    assert data["total_spent"] == 800
    assert data["owed_to_me"] == 1200
    assert data["i_owe"] == 400
    assert data["net_debt_balance"] == 800  # 1200 - 400
    assert len(data["debts"]) == 2
    assert len(data["recent"]) == 4


def test_ag_ui_chat_stream(monkeypatch):
    """POST /api/ui/chat/stream emits AG-UI Server-Sent Events."""
    # Mock agent loop to return deterministic string without hitting live API
    monkeypatch.setattr("agent_core.run_autonomous_agent", lambda **kwargs: "Hello! I am ARGUS. How can I assist you?")

    resp = client.post(
        "/api/ui/chat/stream",
        headers=AUTH_HEADERS,
        json={"message": "Hey ARGUS"},
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    body = resp.text
    assert "event: RUN_STARTED" in body
    assert "event: TEXT_MESSAGE_CHUNK" in body
    assert "event: RUN_FINISHED" in body
    assert "Hello! I am ARGUS." in body
