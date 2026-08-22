"""
Persistent Personal Memory & Knowledge Base for ARGUS ("Second Brain").
Stores and retrieves user facts, notes, credentials hints, and preferences in SQLite.
"""

import json
import logging
import os
import sqlite3
from typing import Any, Dict, List, Optional

logger = logging.getLogger("argus.memory")

DB_PATH = os.path.join(os.path.dirname(__file__), "argus_memory.db")


def init_memory_db():
    """Initialize SQLite memory database with entity indexing."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fact_text TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'general',
                entities TEXT DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Schema migration: ensure 'entities' and 'updated_at' columns exist
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(memories)")
        columns = [c[1] for c in cursor.fetchall()]
        if "entities" not in columns:
            cursor.execute("ALTER TABLE memories ADD COLUMN entities TEXT DEFAULT '[]'")
        if "updated_at" not in columns:
            cursor.execute("ALTER TABLE memories ADD COLUMN updated_at TIMESTAMP")

        conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_text ON memories(fact_text)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_cat ON memories(category)")
        conn.commit()


# Initialize on import
init_memory_db()


def save_memory(fact: str, category: str = "general", entities: Optional[List[str]] = None) -> Dict[str, Any]:
    """Store a fact with category and entity tags in memory."""
    entities_json = json.dumps(entities or [])
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO memories (fact_text, category, entities, updated_at) 
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)""",
            (fact.strip(), category.lower(), entities_json),
        )
        conn.commit()
        memory_id = cursor.lastrowid
        return {
            "id": memory_id,
            "fact_text": fact.strip(),
            "category": category.lower(),
            "entities": entities or [],
        }


def recall_memories(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    """Ranked search across fact text, categories, and entities."""
    raw_words = [w.strip().lower() for w in query.split() if len(w.strip()) > 1]
    # Filter common question stop words
    stop_words = {"what", "is", "my", "the", "where", "who", "did", "put", "have", "are", "tell", "me", "about", "recall"}
    words = [w for w in raw_words if w not in stop_words]
    if not words:
        words = raw_words

    if not words:
        return list_recent_memories(limit=limit)

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Build search query matching fact_text, category, or entities
        clauses = []
        params = []
        for w in words:
            clauses.append("(LOWER(fact_text) LIKE ? OR LOWER(category) LIKE ? OR LOWER(entities) LIKE ?)")
            p = f"%{w}%"
            params.extend([p, p, p])

        sql = f"""
            SELECT id, fact_text, category, entities, created_at
            FROM memories
            WHERE {' OR '.join(clauses)}
            ORDER BY id DESC
            LIMIT ?
        """
        params.append(limit)
        rows = cursor.execute(sql, params).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            try:
                d["entities"] = json.loads(d.get("entities") or "[]")
            except Exception:
                d["entities"] = []
            results.append(d)
        return results


def list_recent_memories(limit: int = 15) -> List[Dict[str, Any]]:
    """List recent memories."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        rows = cursor.execute(
            "SELECT id, fact_text, category, entities, created_at FROM memories ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            try:
                d["entities"] = json.loads(d.get("entities") or "[]")
            except Exception:
                d["entities"] = []
            results.append(d)
        return results


def get_memories_by_category() -> Dict[str, List[Dict[str, Any]]]:
    """Get all stored memories grouped by category for the Second Brain viewer."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        rows = cursor.execute(
            "SELECT id, fact_text, category, entities, created_at FROM memories ORDER BY category ASC, id DESC"
        ).fetchall()

        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for r in rows:
            d = dict(r)
            try:
                d["entities"] = json.loads(d.get("entities") or "[]")
            except Exception:
                d["entities"] = []
            cat = d.get("category", "general")
            grouped.setdefault(cat, []).append(d)
        return grouped


def delete_memory(memory_id: int) -> bool:
    """Delete a memory by its ID."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        conn.commit()
        return cursor.rowcount > 0


def delete_memory_by_query(query: str) -> int:
    """Delete memories matching a query keyword."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM memories WHERE LOWER(fact_text) LIKE ? OR LOWER(category) LIKE ?",
            (f"%{query.lower()}%", f"%{query.lower()}%"),
        )
        conn.commit()
        return cursor.rowcount
