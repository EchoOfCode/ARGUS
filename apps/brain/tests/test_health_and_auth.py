import os

from fastapi.testclient import TestClient

# Ensure test mode for predictable authentication testing
os.environ["ARGUS_TEST_MODE"] = "1"
os.environ["ARGUS_SECRET"] = "valid_test_secret_32_characters_long_hex_string_12345"

from main import app

client = TestClient(app)
VALID_SECRET = "valid_test_secret_32_characters_long_hex_string_12345"


def test_health_endpoint():
    """Verify /health responds with 200 and healthy status without authentication."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_auth_accepts_valid_secret():
    """Verify endpoint accepts request with valid X-Argus-Secret header."""
    response = client.post(
        "/ask",
        headers={"X-Argus-Secret": VALID_SECRET},
        json={"question": "What is 2 + 2?", "use_web_search": False},
    )
    # Status code is 200 (or acceptable if LLM returns mock answer)
    assert response.status_code == 200


def test_auth_rejects_missing_secret():
    """Verify endpoint rejects request when X-Argus-Secret header is missing."""
    response = client.post(
        "/ask",
        json={"question": "What is 2 + 2?"},
    )
    assert response.status_code == 401
    assert "Missing or invalid X-Argus-Secret header" in response.text


def test_auth_rejects_wrong_secret():
    """Verify endpoint rejects request when X-Argus-Secret header is incorrect."""
    response = client.post(
        "/ask",
        headers={"X-Argus-Secret": "incorrect_secret_token_value_000"},
        json={"question": "What is 2 + 2?"},
    )
    assert response.status_code == 401
    assert "Missing or invalid X-Argus-Secret header" in response.text
