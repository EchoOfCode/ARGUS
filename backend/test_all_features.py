"""
End-to-End Verification Test for ARGUS AI Brain backend.
"""

import os
from dotenv import load_dotenv

load_dotenv()

from fastapi.testclient import TestClient
from main import app
from rate_limiter import groq_rate_limiter
from memory import save_memory, recall_memories
from web_search import search_web

client = TestClient(app)
SECRET = os.getenv("ARGUS_SECRET", "")
HEADERS = {"X-Argus-Secret": SECRET}


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "whisper-voice-notes" in data["capabilities"]
    print("✅ /health check passed")


def test_memory():
    # Save
    saved = save_memory("My home WiFi password is SecretArgusPass42", category="credentials")
    assert saved["id"] is not None

    # Recall
    recalled = recall_memories("WiFi password")
    assert len(recalled) > 0
    assert "SecretArgusPass42" in recalled[0]["fact_text"]
    print("✅ Memory save and recall passed")


def test_web_search():
    results = search_web("Python programming language", max_results=2)
    assert len(results) > 0
    assert "Python" in results[0]["title"] or "Python" in results[0]["body"]
    print(f"✅ Web search passed (found {len(results)} results)")


def test_intent_classification():
    # Fast rule test: email
    res = client.post(
        "/process-message",
        json={
            "sender_jid": "918088421593@s.whatsapp.net",
            "message_text": "unread emails",
            "chat_jid": "918088421593@s.whatsapp.net",
            "timestamp": "2026-08-22T10:00:00Z",
            "is_self_chat": True,
        },
        headers=HEADERS,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["intent"] == "email_list"
    assert data["should_respond"] is True

    # Fast rule test: passive background noise without scheduling keywords
    res_passive = client.post(
        "/process-message",
        json={
            "sender_jid": "someone@s.whatsapp.net",
            "message_text": "haha that was funny lol",
            "chat_jid": "group@g.us",
            "timestamp": "2026-08-22T10:00:00Z",
            "is_self_chat": False,
        },
        headers=HEADERS,
    )
    assert res_passive.status_code == 200
    assert res_passive.json()["should_respond"] is False
    print("✅ Intent classification & rate-saving pre-filtering passed")


def test_ask_endpoint():
    res = client.post(
        "/ask",
        json={"question": "What is the capital of France?", "use_web_search": False},
        headers=HEADERS,
    )
    assert res.status_code == 200
    answer = res.json()["answer"]
    assert "Paris" in answer
    print(f"✅ /ask passed: {answer}")


def test_email_endpoint_graceful():
    res = client.post("/emails/unread", headers=HEADERS)
    assert res.status_code == 200
    data = res.json()
    print(f"✅ /emails/unread graceful response: count={data['count']}, configured={data['is_configured']}")


def test_autopilot_endpoint():
    res = client.post(
        "/autopilot/generate-reply",
        json={
            "chat_jid": "918088421593@s.whatsapp.net",
            "sender_name": "Harshith",
            "incoming_message": "Hey bro, are you coming to college today?",
            "custom_instruction": "busy working on project demo",
        },
        headers=HEADERS,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["reply_text"] is not None and len(data["reply_text"]) > 0
    print(f"✅ /autopilot/generate-reply passed: \"{data['reply_text']}\"")


if __name__ == "__main__":
    print("🚀 Running ARGUS Backend Verification Tests...")
    test_health()
    test_memory()
    test_web_search()
    test_intent_classification()
    test_ask_endpoint()
    test_email_endpoint_graceful()
    test_autopilot_endpoint()
    print("\n🎉 ALL TESTS PASSED SUCCESSFULLY!")
