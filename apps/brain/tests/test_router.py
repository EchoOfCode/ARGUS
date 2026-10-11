"""
Unit tests for the Intelligent LLM Router (Groq <-> Gemini) and dynamic routing heuristics.
"""

import os
from unittest.mock import MagicMock, patch

from llm_provider import (
    RouterLLMProvider,
    classify_route_target,
)


def test_classify_route_code_to_gemini():
    """Verify that coding, syntax, and debugging questions route to Gemini."""
    msgs = [{"role": "user", "content": "How do I write a python function to parse json: def parse(): pass"}]
    target, _ = classify_route_target(msgs)
    assert target == "gemini"


def test_classify_route_deep_reasoning_to_gemini():
    """Verify that complex step-by-step reasoning questions route to Gemini."""
    msgs = [{"role": "user", "content": "Analyze the pros and cons of microservices vs monolith step by step in detail."}]
    target, _ = classify_route_target(msgs)
    assert target == "gemini"


def test_classify_route_explicit_gemini_directive():
    """Verify that explicit user prefix @gemini forces Gemini."""
    msgs = [{"role": "user", "content": "@gemini what is quantum computing?"}]
    target, _ = classify_route_target(msgs)
    assert target == "gemini"


def test_classify_route_explicit_groq_directive():
    """Verify that explicit user prefix @groq forces Groq."""
    msgs = [{"role": "user", "content": "@groq write a quick python def test(): pass"}]
    target, _ = classify_route_target(msgs)
    assert target == "groq"


def test_classify_route_casual_chat_to_groq():
    """Verify that fast casual chat, greetings, and short texts route to Groq for speed."""
    msgs = [{"role": "user", "content": "Hey, what are you doing?"}]
    target, _ = classify_route_target(msgs)
    assert target == "groq"


def test_router_provider_instantiation():
    """Verify RouterLLMProvider initializes gracefully with configured keys."""
    with patch.dict(os.environ, {"GROQ_API_KEY": "dummy_groq", "GEMINI_API_KEY": "dummy_gemini"}):
        router = RouterLLMProvider()
        assert router.groq_available is True
        assert router.gemini_available is True


def test_router_failover_mechanism():
    """Verify that if the primary routed model fails, the router fails over to secondary."""
    router = RouterLLMProvider()
    mock_groq = MagicMock()
    mock_gemini = MagicMock()

    # Groq fails with an error
    mock_groq.chat_completion.side_effect = Exception("Groq 429 Rate Limit Exceeded")
    mock_gemini.chat_completion.return_value = "Fallback response from Gemini"

    router._groq_provider = mock_groq
    router._gemini_provider = mock_gemini
    router.groq_available = True
    router.gemini_available = True

    # Casual chat routes to Groq primarily, should failover to Gemini
    messages = [{"role": "user", "content": "Hello there"}]
    result = router.chat_completion(messages)

    assert result == "Fallback response from Gemini"
    # Called first with primary model, then with intra-provider fallback model
    assert mock_groq.chat_completion.call_count == 2
    mock_gemini.chat_completion.assert_called_once()


def test_router_groq_intra_model_fallback():
    """Verify that if Groq primary model fails, it tries Groq intra-provider fallback before Gemini."""
    router = RouterLLMProvider()
    mock_groq = MagicMock()
    mock_gemini = MagicMock()

    # First call (qwen) fails, second call (openai/gpt-oss-20b) succeeds
    mock_groq.chat_completion.side_effect = [
        Exception("Groq 429 Rate Limit on qwen"),
        "Success from Groq fallback model",
    ]

    router._groq_provider = mock_groq
    router._gemini_provider = mock_gemini
    router.groq_available = True
    router.gemini_available = True

    messages = [{"role": "user", "content": "Hello there"}]
    result = router.chat_completion(messages)

    assert result == "Success from Groq fallback model"
    assert mock_groq.chat_completion.call_count == 2
    mock_gemini.chat_completion.assert_not_called()
