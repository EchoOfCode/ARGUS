"""
Dynamic Stylometry & Adaptive Behavioral Learning Engine for ARGUS ("AGI Persona").
Extracts relational intimacy, vocabulary patterns, slang, punctuation styles,
and conversational dynamics directly from SQLite chat history to generate hyper-realistic,
non-generic, context-adaptive responses.
"""

import logging
import os
import re
import sqlite3
from typing import Any, Dict, List, Optional

logger = logging.getLogger("argus.stylometry")

BRIDGE_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "bridge", "argus.db")


def get_bridge_db():
    if os.path.exists(BRIDGE_DB_PATH):
        conn = sqlite3.connect(BRIDGE_DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn
    return None


def extract_linguistic_fingerprint(chat_jid: Optional[str] = None) -> Dict[str, Any]:
    """
    Analyze past sent messages from the owner to extract their authentic linguistic patterns:
    slang, capitalization, punctuation, humor, and relationship tone.
    """
    conn = get_bridge_db()
    if not conn:
        return {
            "casing": "mostly lowercase",
            "avg_words": 6,
            "frequent_slang": ["bro", "yeah", "cool"],
            "punctuation": "minimal punctuation, occasional emojis",
            "relationship_vibe": "casual peer",
            "recent_samples": [],
        }

    try:
        cursor = conn.cursor()
        
        # 1. Fetch recent messages sent by the user in this specific chat
        specific_samples = []
        if chat_jid:
            cursor.execute(
                """
                SELECT message_text 
                FROM message_log 
                WHERE chat_jid = ? AND is_from_me = 1 AND LENGTH(message_text) BETWEEN 3 AND 120
                ORDER BY timestamp DESC LIMIT 10
                """,
                (chat_jid,),
            )
            specific_samples = [r["message_text"] for r in cursor.fetchall()]

        # 2. Fetch global sent messages across all chats
        cursor.execute(
            """
            SELECT message_text 
            FROM message_log 
            WHERE is_from_me = 1 AND LENGTH(message_text) BETWEEN 3 AND 100
            ORDER BY timestamp DESC LIMIT 25
            """
        )
        global_samples = [r["message_text"] for r in cursor.fetchall()]

        samples = specific_samples if len(specific_samples) >= 3 else global_samples

        if not samples:
            return {
                "casing": "casual lowercase",
                "avg_words": 5,
                "frequent_slang": ["bro", "yeah", "got it", "nice"],
                "punctuation": "natural WhatsApp style",
                "relationship_vibe": "casual friend",
                "recent_samples": [],
            }

        # Analyze casing
        lowercase_count = sum(1 for s in samples if s.islower() or (s[0].islower() if s else False))
        casing = "lowercase casual" if lowercase_count / len(samples) > 0.4 else "natural sentence case"

        # Analyze average word length
        words_lens = [len(s.split()) for s in samples if s.strip()]
        avg_words = int(sum(words_lens) / max(1, len(words_lens)))

        # Detect characteristic vernacular / slang
        combined_text = " " + " ".join(samples).lower() + " "
        slang_candidates = [
            "macha", "bro", "dude", "yaar", "dei", "boss", "bhai", "cool", "scene", 
            "pakka", "ha", "haan", "nope", "yep", "lol", "lmao", "gg", "done", "sorted",
            "wait", "chill", "nah", "tbh", "idk", "asap", "lmk", "bet", "real"
        ]
        found_slang = [w for w in slang_candidates if re.search(rf"\b{w}\b", combined_text)]

        # Check punctuation habits
        has_exclamation = "!" in combined_text
        has_double_q = "??" in combined_text
        has_dots = "..." in combined_text

        punctuation_notes = []
        if has_exclamation:
            punctuation_notes.append("uses enthusiastic '!'")
        if has_double_q:
            punctuation_notes.append("uses '??' for questions")
        if has_dots:
            punctuation_notes.append("uses '...' for pauses")
        if not punctuation_notes:
            punctuation_notes.append("concise and low-friction, rarely ends with periods")

        return {
            "casing": casing,
            "avg_words": avg_words,
            "frequent_slang": found_slang[:6] if found_slang else ["bro", "cool", "ha"],
            "punctuation": ", ".join(punctuation_notes),
            "recent_samples": samples[:5],
        }

    except Exception as e:
        logger.error("Stylometry analysis failed: %s", e)
        return {
            "casing": "casual lowercase",
            "avg_words": 6,
            "frequent_slang": ["bro", "got it"],
            "punctuation": "natural WhatsApp texting",
            "recent_samples": [],
        }
    finally:
        conn.close()


def generate_dynamic_persona_guidance(chat_jid: Optional[str] = None, sender_name: Optional[str] = None) -> str:
    """Generate dynamic AGI persona injection block for LLM prompts."""
    fp = extract_linguistic_fingerprint(chat_jid)
    
    samples_str = ""
    if fp.get("recent_samples"):
        samples_str = "ACTUAL EXAMPLES OF HOW THE USER TEXTS IN REAL LIFE:\n" + "\n".join(f'• "{s}"' for s in fp["recent_samples"])

    slang_str = ", ".join(fp["frequent_slang"]) if fp.get("frequent_slang") else "bro, haan, got it"

    return f"""\
🌟 ADVANCED DYNAMIC STYLOMETRY & PATTERN ADAPTATION:
• Your Target Length: {fp.get('avg_words', 6)} to {fp.get('avg_words', 6) * 2} words per message.
• Your Casing Style: {fp.get('casing', 'casual')}.
• Your Natural Slang / Fillers: [{slang_str}]. Use them naturally where appropriate without forcing.
• Your Punctuation Patterns: {fp.get('punctuation', 'natural WhatsApp flow')}.
• ANTI-ROBOTIC DIRECTIVE: Never sound like a generic AI assistant or scripted customer support.
  Never say "Sure, I can help with that!", "Understood!", or "As an AI...".
  Respond with organic, dynamic, human emotion, wit, or casual indifference matching the conversation.

{samples_str}
"""
