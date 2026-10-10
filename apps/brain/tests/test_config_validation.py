"""
Unit tests for fail-fast configuration validation in apps/brain.
"""

import os

import pytest
from pydantic import ValidationError

from config import BrainSettings


def test_config_rejects_empty_secret():
    """Verify that an empty secret is rejected."""
    # Temporarily unset ARGUS_TEST_MODE to test production validation
    old_test_mode = os.environ.pop("ARGUS_TEST_MODE", None)
    try:
        with pytest.raises((ValidationError, ValueError)) as exc:
            BrainSettings(ARGUS_SECRET="")
        assert "ARGUS_SECRET is required" in str(exc.value)
    finally:
        if old_test_mode:
            os.environ["ARGUS_TEST_MODE"] = old_test_mode


def test_config_rejects_placeholder_secret():
    """Verify that default placeholder secrets are rejected."""
    old_test_mode = os.environ.pop("ARGUS_TEST_MODE", None)
    try:
        with pytest.raises((ValidationError, ValueError)) as exc:
            BrainSettings(ARGUS_SECRET="change-me-generate-with-openssl-rand-hex-32")
        assert "placeholder" in str(exc.value).lower()
    finally:
        if old_test_mode:
            os.environ["ARGUS_TEST_MODE"] = old_test_mode


def test_config_rejects_short_secret():
    """Verify that secrets shorter than 32 characters are rejected."""
    old_test_mode = os.environ.pop("ARGUS_TEST_MODE", None)
    try:
        with pytest.raises((ValidationError, ValueError)) as exc:
            BrainSettings(ARGUS_SECRET="too_short_secret_123")
        assert "at least 32 characters" in str(exc.value)
    finally:
        if old_test_mode:
            os.environ["ARGUS_TEST_MODE"] = old_test_mode


def test_config_accepts_valid_32_char_secret():
    """Verify that a valid 32+ character secret succeeds."""
    old_test_mode = os.environ.pop("ARGUS_TEST_MODE", None)
    try:
        settings = BrainSettings(ARGUS_SECRET="0123456789abcdef0123456789abcdef")
        assert settings.argus_secret == "0123456789abcdef0123456789abcdef"
    finally:
        if old_test_mode:
            os.environ["ARGUS_TEST_MODE"] = old_test_mode
