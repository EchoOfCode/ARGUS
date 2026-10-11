"""
ARGUS Brain — Configuration & Environment Validation via pydantic-settings.
Enforces fail-fast startup checks to ensure security and valid credentials.
"""

import os
import sys
from typing import Literal, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

FORBIDDEN_SECRET_PLACEHOLDERS = {
    "change-me-generate-with-openssl-rand-hex-32",
    "your_32_byte_hex_secret_here",
    "your_generated_secret_here",
    "dummy_secret",
}


class BrainSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ─── Security Settings ──────────────────────────────────────
    argus_secret: str = Field(
        default="",
        alias="ARGUS_SECRET",
        description="Shared HMAC authentication secret between Bridge and Brain",
    )
    argus_host: str = Field(default="127.0.0.1", alias="ARGUS_HOST")
    argus_port: int = Field(default=8000, alias="ARGUS_PORT")

    # ─── LLM Provider Settings ─────────────────────────────────
    llm_provider: Literal["router", "groq", "gemini", "openrouter", "openai", "ollama", "custom", "mock"] = Field(
        default="groq",
        alias="LLM_PROVIDER",
    )
    groq_api_key: Optional[str] = Field(default=None, alias="GROQ_API_KEY")
    groq_model: str = Field(default="qwen/qwen3.8-27b", alias="GROQ_MODEL")
    groq_fallback_model: str = Field(default="openai/gpt-oss-20b", alias="GROQ_FALLBACK_MODEL")
    gemini_api_key: Optional[str] = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-flash-lite-latest", alias="GEMINI_MODEL")
    openrouter_api_key: Optional[str] = Field(default=None, alias="OPENROUTER_API_KEY")
    openrouter_model: Optional[str] = Field(default=None, alias="OPENROUTER_MODEL")
    openai_api_key: Optional[str] = Field(default=None, alias="OPENAI_API_KEY")
    openai_model: Optional[str] = Field(default=None, alias="OPENAI_MODEL")
    llm_api_key: Optional[str] = Field(default=None, alias="LLM_API_KEY")
    llm_model: Optional[str] = Field(default=None, alias="LLM_MODEL")
    llm_base_url: Optional[str] = Field(default=None, alias="LLM_BASE_URL")

    # ─── Email Settings (IMAP) ──────────────────────────────────
    email_user: Optional[str] = Field(default=None, alias="EMAIL_USER")
    email_pass: Optional[str] = Field(default=None, alias="EMAIL_PASS")
    email_host: str = Field(default="imap.gmail.com", alias="EMAIL_HOST")
    email_port: int = Field(default=993, alias="EMAIL_PORT")

    # ─── Owner Profile Settings ─────────────────────────────────
    my_jid: Optional[str] = Field(default=None, alias="MY_JID")
    owner_name: str = Field(default="User", alias="OWNER_NAME")
    owner_bio: str = Field(default="", alias="OWNER_BIO")
    owner_tone: str = Field(
        default="casual, friendly, concise, authentic WhatsApp texting style",
        alias="OWNER_TONE",
    )

    # ─── Custom DB Paths ────────────────────────────────────────
    bridge_db_path: Optional[str] = Field(default=None, alias="BRIDGE_DB_PATH")

    @field_validator("argus_secret")
    @classmethod
    def validate_argus_secret(cls, v: str) -> str:
        # In test environments, allow test bypass only if explicitly set
        if os.getenv("ARGUS_TEST_MODE") == "1":
            return v

        v = (v or "").strip()
        if not v:
            raise ValueError(
                "ARGUS_SECRET is required! Set it in your backend/.env file."
            )
        if v in FORBIDDEN_SECRET_PLACEHOLDERS or v.startswith("change-me"):
            raise ValueError(
                "ARGUS_SECRET is set to an unconfigured placeholder! "
                "Please generate a secure 32-byte secret (e.g. `openssl rand -hex 32` or "
                "`python -c \"import secrets; print(secrets.token_hex(32))\"`)."
            )
        if len(v) < 32:
            raise ValueError(
                f"ARGUS_SECRET must be at least 32 characters long (received {len(v)} chars). "
                "Generate a fresh secret with: openssl rand -hex 32"
            )
        return v

    @field_validator("argus_host")
    @classmethod
    def validate_host(cls, v: str) -> str:
        if v not in ("127.0.0.1", "localhost", "0.0.0.0"):
            # Warn on non-localhost bindings
            pass
        return v


_settings_instance: Optional[BrainSettings] = None


def get_settings() -> BrainSettings:
    """Retrieve validated settings or fail fast."""
    global _settings_instance
    if _settings_instance is None:
        try:
            _settings_instance = BrainSettings()
        except Exception as e:
            sys.stderr.write(f"\n❌ [ARGUS CONFIG ERROR] Startup validation failed:\n{e}\n\n")
            raise e
    return _settings_instance


def reset_settings() -> None:
    """Reset cached settings instance (useful for unit testing)."""
    global _settings_instance
    _settings_instance = None
