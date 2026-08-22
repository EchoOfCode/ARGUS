"""
Persistent Personal Memory & Knowledge Base for ARGUS ("Second Brain").
Stores and retrieves user facts, notes, credentials hints, and preferences in SQLite.
"""

import logging
import os
import sqlite3
from typing import Any, Dict, List, Optional

logger = logging.getLogger("argus.memory")

DB_PATH = os.path.join(os.path.dirname(__file__), "argus_memory.db")


def init_memory_db():
    """Initialize SQLite memory database."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fact_text TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'general',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_text ON memories(fact_text)")
        conn.commit()


# Initialize on import
init_memory_db()


def save_memory(fact: str, category: str = "general") -> Dict[str, Any]:
    """Store a fact in memory."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO memories (fact_text, category) VALUES (?, ?)",
            (fact.strip(), category),
        )
        conn.commit()
        memory_id = cursor.lastrowid
        return {"id": memory_id, "fact_text": fact.strip(), "category": category}


def recall_memories(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Search stored memories by query terms."""
    words = [w.strip().lower() for w in query.split() if len(w.strip()) > 2]
    if not words:
        # Fallback to returning recent memories
        return list_recent_memories(limit=limit)

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Build search query matching any significant keyword
        clauses = ["LOWER(fact_text) LIKE ?" for _ in words]
        params = [f"%{w}%" for w in words]

        sql = f"""
            SELECT id, fact_text, category, created_at
            FROM memories
            WHERE {' OR '.join(clauses)}
            ORDER BY id DESC
            LIMIT ?
        """
        params.append(limit)
        rows = cursor.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


def list_recent_memories(limit: int = 10) -> List[Dict[str, Any]]:
    """List recent memories."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        rows = cursor.execute(
            "SELECT id, fact_text, category, created_at FROM memories ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def delete_memory(memory_id: int) -> bool:
    """Delete a memory by its ID."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        conn.commit()
        return cursor.rowcount > 0
