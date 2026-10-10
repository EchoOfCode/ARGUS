"""
Tests for Bridge API Gateway and Outbound Policy Engine (ADR 0001, ADR 0003).
Verifies HMAC request signatures, replay window checks, policy tiers, rate limits, and approval workflows.
"""

import hashlib
import hmac
import os
import time

from fastapi.testclient import TestClient

os.environ["ARGUS_TEST_MODE"] = "1"
os.environ["ARGUS_SECRET"] = "valid_test_secret_32_characters_long_hex_string_12345"

from main import app

client = TestClient(app)
SECRET = "valid_test_secret_32_characters_long_hex_string_12345"


def sign_request(body_bytes: bytes, offset_ms: int = 0) -> dict:
    """Generate X-Argus-Timestamp and X-Argus-Signature headers."""
    ts = int(time.time() * 1000) + offset_ms
    payload = f"{ts}.".encode("utf-8") + body_bytes
    sig = "sha256=" + hmac.new(SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return {
        "X-Argus-Timestamp": str(ts),
        "X-Argus-Signature": sig,
    }


def test_signed_request_accepted():
    body = b'{"chat_jid":"919876543210@s.whatsapp.net","sender_jid":"919876543210@s.whatsapp.net","message_text":"hello","timestamp":"2026-10-11T12:00:00Z","message_id":"M1"}'
    headers = sign_request(body)
    headers["Content-Type"] = "application/json"
    res = client.post("/api/ingest/message", content=body, headers=headers)
    assert res.status_code == 200
    assert res.json()["success"] is True


def test_signed_request_rejected_on_replay_window():
    # 6 minutes old timestamp
    body = b'{"chat_jid":"test","sender_jid":"test","message_text":"old","timestamp":"2026-10-11T12:00:00Z"}'
    headers = sign_request(body, offset_ms=-360_000)
    headers["Content-Type"] = "application/json"
    res = client.post("/api/ingest/message", content=body, headers=headers)
    assert res.status_code == 401
    assert "replay tolerance window" in res.text


def test_signed_request_rejected_on_tampered_payload():
    body = b'{"chat_jid":"test","sender_jid":"test","message_text":"valid","timestamp":"2026-10-11T12:00:00Z"}'
    headers = sign_request(body)
    headers["Content-Type"] = "application/json"
    # Tamper payload
    tampered_body = b'{"chat_jid":"test","sender_jid":"test","message_text":"TAMPERED","timestamp":"2026-10-11T12:00:00Z"}'
    res = client.post("/api/ingest/message", content=tampered_body, headers=headers)
    assert res.status_code == 401
    assert "Invalid X-Argus-Signature" in res.text


def test_policy_owner_command_approved():
    body = b'{"target_jid":"919876543210@s.whatsapp.net","message_text":"meeting starting","trigger_type":"owner_command"}'
    headers = sign_request(body)
    headers["Content-Type"] = "application/json"
    res = client.post("/api/policy/evaluate", content=body, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["verdict"] == "approved"
    assert data["tier"] == 0


def test_policy_assistant_reply_unconfigured_contact_is_draft_only():
    body = b'{"target_jid":"919999999999@s.whatsapp.net","message_text":"sure thing","trigger_type":"autopilot_reply","is_group":false}'
    headers = sign_request(body)
    headers["Content-Type"] = "application/json"
    res = client.post("/api/policy/evaluate", content=body, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["verdict"] == "draft_only"
    assert data["tier"] == 0


def test_policy_group_reply_prohibited():
    body = b'{"target_jid":"120363028888888888@g.us","message_text":"group message","trigger_type":"autopilot_reply","is_group":true}'
    headers = sign_request(body)
    headers["Content-Type"] = "application/json"
    res = client.post("/api/policy/evaluate", content=body, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["verdict"] == "draft_only"
    assert "Group autonomous replies prohibited" in data["reason"]


def test_policy_approve_token_verification():
    from db import get_db
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT OR REPLACE INTO autopilot_rules (jid, name, status, tier) VALUES ('919888888888@s.whatsapp.net', 'Taylor', 'active', 1)")

    # 1. Evaluate for Tier 1 contact -> returns requires_approval with approval_id
    text = "Yes, let's catch up tomorrow at 4"
    import json
    eval_payload = json.dumps({
        "target_jid": "919888888888@s.whatsapp.net",
        "message_text": text,
        "trigger_type": "autopilot_reply",
        "is_group": False,
    }).encode("utf-8")

    eval_headers = sign_request(eval_payload)
    eval_headers["Content-Type"] = "application/json"
    res = client.post("/api/policy/evaluate", content=eval_payload, headers=eval_headers)
    assert res.status_code == 200
    eval_data = res.json()
    assert eval_data["verdict"] == "requires_approval"
    approval_id = eval_data["approval_id"]

    # 2. Approve with altered text -> must be rejected (hash mismatch)
    bad_approve_payload = json.dumps({"approval_id": approval_id, "message_text": "Altered message text"}).encode("utf-8")
    bad_headers = sign_request(bad_approve_payload)
    bad_headers["Content-Type"] = "application/json"
    res_bad = client.post("/api/policy/approve", content=bad_approve_payload, headers=bad_headers)
    assert res_bad.status_code == 400
    assert "hash mismatch" in res_bad.text

    # 3. Approve with exact text -> accepted
    good_approve_payload = json.dumps({"approval_id": approval_id, "message_text": text}).encode("utf-8")
    good_headers = sign_request(good_approve_payload)
    good_headers["Content-Type"] = "application/json"
    res_good = client.post("/api/policy/approve", content=good_approve_payload, headers=good_headers)
    assert res_good.status_code == 200
    assert res_good.json()["approved"] is True
