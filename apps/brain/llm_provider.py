"""
LLM Provider Abstraction & Log Redaction (Phase 2 Task 7).
Supports Groq (default cloud), Ollama (local open-source), and Mock (for deterministic testing & CI).
Redacts message content in logs unless ARGUS_DEBUG_LOG_CONTENT=1.
"""

import abc
import json
import logging
import os
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger("argus.llm")


def redact_log_content(content: str) -> str:
    """
    Redact message content from logs unless ARGUS_DEBUG_LOG_CONTENT=1.
    """
    if os.getenv("ARGUS_DEBUG_LOG_CONTENT") == "1":
        return content
    if not content:
        return "[EMPTY]"
    return f"[CONTENT_REDACTED len={len(content)}]"


class BaseLLMProvider(abc.ABC):
    """Abstract interface for LLM backends."""

    @abc.abstractmethod
    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 1000,
        tools: Optional[List[Dict[str, Any]]] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> Any:
        pass

    @abc.abstractmethod
    def transcribe(self, audio_bytes: bytes, filename: str = "audio.ogg") -> str:
        pass


class MockCompletions:
    def __init__(self, provider: "MockLLMProvider"):
        self.provider = provider

    def create(self, **kwargs: Any) -> Any:
        messages = kwargs.get("messages", [])
        return self.provider.chat_completion(messages, **kwargs)


class MockChat:
    def __init__(self, provider: "MockLLMProvider"):
        self.completions = MockCompletions(provider)


class MockLLMProvider(BaseLLMProvider):
    """
    Mock LLM provider for deterministic offline testing and CI.
    Never calls external network APIs.
    """

    def __init__(self):
        self.chat = MockChat(self)

    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 1000,
        tools: Optional[List[Dict[str, Any]]] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> Any:
        logger.info(f"MockLLM completion called with {len(messages)} messages (log redacted)")
        user_msg = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user_msg = str(m.get("content", ""))
                break

        # Check for JSON request format
        if response_format and response_format.get("type") == "json_object":
            content = json.dumps({"intent": "general", "reply": "Mock deterministic response", "confidence": 0.99})
        elif "summarize" in user_msg.lower():
            content = "Summary: Key discussion points noted."
        elif "draft" in user_msg.lower() or "text" in user_msg.lower():
            content = "Hey Alex, see you there tomorrow!"
        else:
            content = "Mock LLM deterministic response."

        class MockChoice:
            def __init__(self, c: str):
                class MockMsg:
                    def __init__(self, text: str):
                        self.content = text
                        self.tool_calls = None
                self.message = MockMsg(c)

        class MockResponse:
            def __init__(self, c: str):
                self.choices = [MockChoice(c)]

        return MockResponse(content)

    def transcribe(self, audio_bytes: bytes, filename: str = "audio.ogg") -> str:
        logger.info(f"MockLLM transcription called for {len(audio_bytes)} bytes")
        return "Deterministic transcribed text from mock provider."


class GroqProvider(BaseLLMProvider):
    """Groq Cloud LLM & Whisper provider."""

    def __init__(self):
        from groq import Groq
        api_key = os.getenv("GROQ_API_KEY")
        self.client = Groq(api_key=api_key)
        self.default_model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 1000,
        tools: Optional[List[Dict[str, Any]]] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> Any:
        active_model = model or self.default_model
        logger.info(f"Dispatching completion to Groq model={active_model} message_count={len(messages)}")

        kwargs: Dict[str, Any] = {
            "model": active_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        if response_format:
            kwargs["response_format"] = response_format

        return self.client.chat.completions.create(**kwargs)

    def transcribe(self, audio_bytes: bytes, filename: str = "audio.ogg") -> str:
        logger.info(f"Dispatching transcription to Groq Whisper size={len(audio_bytes)} bytes")
        res = self.client.audio.transcriptions.create(
            file=(filename, audio_bytes),
            model="whisper-large-v3",
            response_format="text",
            temperature=0.0,
        )
        return str(res).strip()


class OllamaProvider(BaseLLMProvider):
    """Local Ollama LLM provider (offline/open-source)."""

    def __init__(self):
        self.host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
        self.model = os.getenv("OLLAMA_MODEL", "llama3")

    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 1000,
        tools: Optional[List[Dict[str, Any]]] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> Any:
        active_model = model or self.model
        logger.info(f"Dispatching completion to local Ollama model={active_model}")

        url = f"{self.host}/api/chat"
        payload: Dict[str, Any] = {
            "model": active_model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        if response_format and response_format.get("type") == "json_object":
            payload["format"] = "json"

        resp = requests.post(url, json=payload, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        content = data.get("message", {}).get("content", "")

        class MockChoice:
            def __init__(self, c: str):
                class MockMsg:
                    def __init__(self, text: str):
                        self.content = text
                        self.tool_calls = None
                self.message = MockMsg(c)

        class MockResponse:
            def __init__(self, c: str):
                self.choices = [MockChoice(c)]

        return MockResponse(content)

    def transcribe(self, audio_bytes: bytes, filename: str = "audio.ogg") -> str:
        # Fallback to local whisper or whisper.cpp if available
        logger.info("Local Ollama does not host Whisper; routing to Groq fallback or mock")
        if os.getenv("GROQ_API_KEY"):
            return GroqProvider().transcribe(audio_bytes, filename)
        return "Local audio transcription unavailable."


def get_llm_provider() -> BaseLLMProvider:
    """
    Factory function returning the active LLM provider based on LLM_PROVIDER env variable.
    Options: 'groq' (default), 'ollama', 'mock'.
    """
    provider_name = os.getenv("LLM_PROVIDER", "groq").lower().strip()
    if provider_name == "mock" or os.getenv("ARGUS_TEST_MODE") == "1":
        return MockLLMProvider()
    if provider_name == "ollama":
        return OllamaProvider()
    return GroqProvider()
