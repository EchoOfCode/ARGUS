"""
LLM Provider Abstraction & Log Redaction (Phase 2 Task 7).
Supports Groq (default cloud), Ollama (local open-source), and Mock (for deterministic testing & CI).
Redacts message content in logs unless ARGUS_DEBUG_LOG_CONTENT=1.
"""

import abc
import json
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import httpx

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
            role = m.get("role") if isinstance(m, dict) else getattr(m, "role", None)
            if role == "user":
                content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
                user_msg = str(content)
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

        resp = httpx.post(url, json=payload, timeout=60)
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


class GeminiProvider(BaseLLMProvider):
    """Google Gemini LLM provider via OpenAI-compatible endpoint."""

    def __init__(self):
        from openai import OpenAI
        self.api_key = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY") or ""
        self.client = OpenAI(
            api_key=self.api_key or "dummy",
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
        self.default_model = os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")

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
        logger.info(f"Dispatching completion to Gemini model={active_model} message_count={len(messages)}")

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
        if os.getenv("GROQ_API_KEY"):
            return GroqProvider().transcribe(audio_bytes, filename)
        return "Audio transcription requires Groq Whisper or OpenAI."


def classify_route_target(messages: List[Dict[str, Any]]) -> Tuple[str, str]:
    """
    Intelligently select between 'gemini' and 'groq' based on:
    1. Explicit user directive (@gemini vs @groq)
    2. Query complexity, reasoning requirements, coding indicators
    3. Casual conversation, speed-sensitive requests
    """
    user_text = ""
    for m in reversed(messages):
        role = m.get("role") if isinstance(m, dict) else getattr(m, "role", None)
        if role == "user":
            content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
            if isinstance(content, str):
                user_text = content
            elif isinstance(content, list):
                # Multimodal or complex content structure -> Gemini
                return "gemini", os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")
            break

    lower = user_text.lower()

    # 1. Explicit user override
    if "@gemini" in lower or "use gemini" in lower or "/gemini" in lower:
        return "gemini", os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")
    if "@groq" in lower or "use groq" in lower or "/groq" in lower:
        return "groq", os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")

    # 2. Code, programming, algorithms, deep debugging -> Gemini
    code_indicators = (
        "def ", "class ", "function ", "import ", "const ", "let ", "var ",
        "```", "python", "typescript", "javascript", "sql", "html", "css",
        "algorithm", "debug", "refactor", "exception", "traceback", "regex",
        "dockerfile", "yaml", "json schema", "bug in my code", "write a script"
    )
    if any(ind in lower for ind in code_indicators):
        return "gemini", os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")

    # 3. Deep reasoning, research, complex analysis, long queries (>100 words) -> Gemini
    reasoning_indicators = (
        "step by step", "deep dive", "in detail", "analyze", "analysis",
        "pros and cons", "compare and contrast", "write an essay", "proof",
        "mathematical", "calculate", "solve the equation", "comprehensive guide"
    )
    if any(ind in lower for ind in reasoning_indicators) or len(user_text.split()) > 100:
        return "gemini", os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")

    # 4. Fast responses, casual chat, quick Q&A, greetings, formatting -> Groq
    return "groq", os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")


class RouterLLMProvider(BaseLLMProvider):
    """
    Intelligent Model Router:
    Routes incoming prompts to Groq (for speed & low-latency dialogue) or
    Gemini (for deep reasoning, code generation, long context, and analysis).
    Includes automatic failover if the primary provider hits rate limits or errors.
    """

    def __init__(self):
        self.groq_available = bool(os.getenv("GROQ_API_KEY"))
        self.gemini_available = bool(os.getenv("GEMINI_API_KEY"))
        self.groq_model = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
        self.groq_fallback_model = os.getenv("GROQ_FALLBACK_MODEL", "openai/gpt-oss-20b")
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")
        self._groq_provider: Optional[GroqProvider] = GroqProvider() if self.groq_available else None
        self._gemini_provider: Optional[GeminiProvider] = GeminiProvider() if self.gemini_available else None

    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 1000,
        tools: Optional[List[Dict[str, Any]]] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> Any:
        target, _ = classify_route_target(messages)

        if target == "gemini" and self._gemini_provider:
            primary = ("gemini", self._gemini_provider, self.gemini_model)
            secondary = ("groq", self._groq_provider, self.groq_model) if self._groq_provider else None
        elif self._groq_provider:
            primary = ("groq", self._groq_provider, self.groq_model)
            secondary = ("gemini", self._gemini_provider, self.gemini_model) if self._gemini_provider else None
        elif self._gemini_provider:
            primary = ("gemini", self._gemini_provider, self.gemini_model)
            secondary = None
        else:
            raise RuntimeError("RouterLLMProvider requires at least GROQ_API_KEY or GEMINI_API_KEY")

        logger.info(f"[ROUTER] Directing completion to provider '{primary[0]}' (model: {primary[2]})")

        try:
            return primary[1].chat_completion(
                messages=messages,
                model=primary[2],
                temperature=temperature,
                max_tokens=max_tokens,
                tools=tools,
                response_format=response_format,
            )
        except Exception as e:
            if primary[0] == "groq" and self._groq_provider and primary[2] != self.groq_fallback_model:
                try:
                    logger.warning(
                        f"[ROUTER] Groq primary model '{primary[2]}' failed ({e}). "
                        f"Attempting intra-provider fallback to Groq '{self.groq_fallback_model}'..."
                    )
                    return self._groq_provider.chat_completion(
                        messages=messages,
                        model=self.groq_fallback_model,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        tools=tools,
                        response_format=response_format,
                    )
                except Exception as intra_e:
                    logger.warning(f"[ROUTER] Groq intra-fallback model '{self.groq_fallback_model}' also failed ({intra_e}).")

            if secondary:
                logger.warning(
                    f"[ROUTER] Primary provider '{primary[0]}' failed ({e}). Auto-failing over to '{secondary[0]}'..."
                )
                return secondary[1].chat_completion(
                    messages=messages,
                    model=secondary[2],
                    temperature=temperature,
                    max_tokens=max_tokens,
                    tools=tools,
                    response_format=response_format,
                )
            raise e

    def transcribe(self, audio_bytes: bytes, filename: str = "audio.ogg") -> str:
        if self._groq_provider:
            return self._groq_provider.transcribe(audio_bytes, filename)
        return "Audio transcription requires Groq Whisper."


def get_llm_provider() -> BaseLLMProvider:
    """
    Factory function returning the active LLM provider based on LLM_PROVIDER env variable.
    Options: 'router' (dynamic Groq/Gemini routing), 'groq', 'gemini', 'ollama', 'mock'.
    """
    provider_name = os.getenv("LLM_PROVIDER", "groq").lower().strip()
    if provider_name == "mock" or os.getenv("ARGUS_TEST_MODE") == "1":
        return MockLLMProvider()
    if provider_name == "router":
        return RouterLLMProvider()
    if provider_name == "gemini":
        return GeminiProvider()
    if provider_name == "ollama":
        return OllamaProvider()
    return GroqProvider()
