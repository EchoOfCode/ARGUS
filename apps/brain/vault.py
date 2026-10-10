"""
Encrypted Credentials Vault for ARGUS (Phase 2 Task 6).
Provides zero-knowledge encrypted credential storage using cryptography.Fernet.
Credentials are NEVER sent to the LLM or exposed in memories.
"""

import base64
import hashlib
import logging
import os
import sqlite3
from typing import Any, Dict, List, Optional

from cryptography.fernet import Fernet

from db import get_sqlite_connection as get_db_connection

logger = logging.getLogger("argus.vault")


def _get_fernet_key() -> bytes:
    """
    Derive a 32-byte urlsafe base64-encoded Fernet key from ARGUS_VAULT_KEY or ARGUS_SECRET.
    """
    raw_key = os.getenv("ARGUS_VAULT_KEY") or os.getenv("ARGUS_SECRET") or "default_fallback_secret_at_least_32_bytes_long_12345"
    digest = hashlib.sha256(raw_key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _get_fernet() -> Fernet:
    return Fernet(_get_fernet_key())


def init_vault_db(conn: Optional[sqlite3.Connection] = None) -> None:
    """Initialize encrypted_vault table with strict schemas."""
    should_close = False
    if conn is None:
        conn = get_db_connection()
        should_close = True

    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS encrypted_vault (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                encrypted_value TEXT NOT NULL,
                hint TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vault_name ON encrypted_vault(name);")
        conn.commit()
    finally:
        if should_close:
            conn.close()


def store_credential(name: str, value: str, hint: Optional[str] = None) -> Dict[str, Any]:
    """
    Store an encrypted credential in the vault.
    NEVER logs or exposes the plaintext value.
    """
    init_vault_db()
    clean_name = name.strip().lower()
    clean_value = value.strip()
    clean_hint = hint.strip() if hint else None

    fernet = _get_fernet()
    encrypted_bytes = fernet.encrypt(clean_value.encode("utf-8"))
    encrypted_str = encrypted_bytes.decode("utf-8")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO encrypted_vault (name, encrypted_value, hint, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(name) DO UPDATE SET
                encrypted_value = excluded.encrypted_value,
                hint = excluded.hint,
                updated_at = CURRENT_TIMESTAMP
        """, (clean_name, encrypted_str, clean_hint))
        conn.commit()
        logger.info(f"Stored encrypted credential: '{clean_name}' [VALUE_REDACTED]")
        return {"name": clean_name, "hint": clean_hint, "status": "stored"}
    finally:
        conn.close()


def reveal_credential(name: str, is_authenticated_owner: bool) -> Optional[str]:
    """
    Reveal a plaintext credential value ONLY if the caller is the verified owner.
    Raises PermissionError if called without owner authentication.
    """
    if not is_authenticated_owner:
        logger.warning(f"Unauthorized attempt to reveal credential '{name}'")
        raise PermissionError("Owner authentication is required to access credential vault")

    init_vault_db()
    clean_name = name.strip().lower()

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT encrypted_value FROM encrypted_vault WHERE name = ?", (clean_name,))
        row = cursor.fetchone()
        if not row:
            return None

        fernet = _get_fernet()
        decrypted_bytes = fernet.decrypt(row["encrypted_value"].encode("utf-8"))
        return decrypted_bytes.decode("utf-8")
    finally:
        conn.close()


def list_vault_keys() -> List[Dict[str, Any]]:
    """
    List names and hints of stored credentials. Plaintext values are NEVER included.
    """
    init_vault_db()
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name, hint, created_at, updated_at FROM encrypted_vault ORDER BY name ASC")
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


def delete_credential(name: str, is_authenticated_owner: bool) -> bool:
    """Delete a credential from the vault."""
    if not is_authenticated_owner:
        raise PermissionError("Owner authentication is required to delete credentials")

    init_vault_db()
    clean_name = name.strip().lower()
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM encrypted_vault WHERE name = ?", (clean_name,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def migrate_credentials_from_memory(dry_run: bool = False) -> Dict[str, Any]:
    """
    Migrate credentials stored in the legacy memory database into the encrypted vault.
    Deletes the plaintext entries from memory upon successful migration.
    Reports count only; never prints or logs values.
    """
    init_vault_db()
    from memory import DB_PATH as MEMORY_DB_PATH

    if not os.path.exists(MEMORY_DB_PATH):
        return {"scanned": 0, "migrated": 0, "dry_run": dry_run}

    sensitive_categories = {"credentials", "credential", "password", "secret", "keys", "tokens"}
    migrated_count = 0
    scanned_count = 0

    with sqlite3.connect(MEMORY_DB_PATH) as mconn:
        mconn.row_factory = sqlite3.Row
        mcursor = mconn.cursor()
        mcursor.execute("SELECT id, fact_text, category FROM memories")
        rows = mcursor.fetchall()
        scanned_count = len(rows)

        to_migrate = []
        for r in rows:
            cat = (r["category"] or "").lower()
            text = r["fact_text"] or ""
            if cat in sensitive_categories or "password:" in text.lower() or "api_key:" in text.lower() or "secret:" in text.lower():
                to_migrate.append(r)

        if dry_run:
            logger.info(f"Credential migration dry-run: {len(to_migrate)} entries would be migrated to encrypted vault")
            return {"scanned": scanned_count, "would_migrate": len(to_migrate), "dry_run": True}

        for r in to_migrate:
            key_name = f"migrated_mem_{r['id']}"
            store_credential(key_name, r["fact_text"], hint=f"Migrated from {r['category']}")
            mcursor.execute("DELETE FROM memories WHERE id = ?", (r["id"],))
            migrated_count += 1

        mconn.commit()

    logger.info(f"Credential migration complete: {migrated_count} entries migrated to encrypted vault")
    return {"scanned": scanned_count, "migrated": migrated_count, "dry_run": False}
