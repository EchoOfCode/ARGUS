"""
Authentication & Cryptographic Verification for ARGUS Brain API.
Implements HMAC-SHA256 request signatures, replay window enforcement, and constant-time comparison.
"""

import hashlib
import hmac
import os
import time
from typing import Optional

from fastapi import HTTPException


def get_secret() -> str:
    """Retrieve verified secret from environment or settings."""
    from config import get_settings
    try:
        return get_settings().argus_secret
    except Exception:
        return os.getenv("ARGUS_SECRET", "")


def verify_request_auth(
    body_bytes: bytes,
    signature_header: Optional[str] = None,
    timestamp_header: Optional[str] = None,
    legacy_secret_header: Optional[str] = None,
    secret_override: Optional[str] = None,
) -> None:
    """
    Validate incoming request authentication.
    Supports either:
    1. Cryptographic HMAC-SHA256 signature (X-Argus-Signature + X-Argus-Timestamp) with 5-minute replay window.
    2. Constant-time comparison of X-Argus-Secret header.
    """
    secret = secret_override or get_secret()
    if not secret:
        raise HTTPException(status_code=500, detail="Server secret is not configured")

    # 1. Cryptographically signed request (ADR 0001)
    if signature_header and timestamp_header:
        try:
            ts_ms = int(timestamp_header)
        except ValueError:
            raise HTTPException(status_code=401, detail="Invalid X-Argus-Timestamp header")

        now_ms = int(time.time() * 1000)
        # Replay tolerance window: 5 minutes (300,000 ms)
        if abs(now_ms - ts_ms) > 300_000:
            raise HTTPException(status_code=401, detail="Request timestamp outside replay tolerance window")

        payload = f"{ts_ms}.".encode("utf-8") + body_bytes
        computed_sig = "sha256=" + hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()

        if not hmac.compare_digest(signature_header, computed_sig):
            raise HTTPException(status_code=401, detail="Invalid X-Argus-Signature")
        return

    # 2. Legacy direct secret header (Constant-time comparison)
    if legacy_secret_header:
        if not hmac.compare_digest(legacy_secret_header, secret):
            raise HTTPException(status_code=401, detail="Missing or invalid X-Argus-Secret header")
        return

    raise HTTPException(status_code=401, detail="Missing or invalid X-Argus-Secret header")
