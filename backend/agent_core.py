"""
Autonomous ReAct Tool-Calling Agent Engine for ARGUS ("OpenClaw" Architecture).
Provides full agentic capabilities with real tool execution against SQLite databases,
automatic memory extraction, and zero-hallucination grounded responses.
"""

import json
import logging
import os
import sqlite3
from typing import Any, Dict, List, Optional

from groq_client import _get_client, _get_model, _get_owner_info, _clean_json_response
from memory import save_memory, recall_memories, get_memories_by_category, delete_memory
from rate_limiter import rate_limited

logger = logging.getLogger("argus.agent")

BRIDGE_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "bridge", "argus.db")


def get_bridge_db():
    if os.path.exists(BRIDGE_DB_PATH):
        conn = sqlite3.connect(BRIDGE_DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn
    return None


# ─── REAL GROUND-TRUTH TOOLS ────────────────────────────────────

def tool_list_contacts(prefix: Optional[str] = None, search: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """Query real contacts from the WhatsApp directory database."""
    conn = get_bridge_db()
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        if prefix:
            cursor.execute(
                "SELECT jid, name, is_group FROM chat_directory WHERE is_group = 0 AND (name LIKE ? OR name LIKE ?) ORDER BY name ASC LIMIT ?",
                (f"{prefix}%", f"#{prefix}%", limit),
            )
        elif search:
            cursor.execute(
                "SELECT jid, name, is_group FROM chat_directory WHERE name LIKE ? ORDER BY name ASC LIMIT ?",
                (f"%{search}%", limit),
            )
        else:
            cursor.execute(
                "SELECT jid, name, is_group FROM chat_directory ORDER BY is_group ASC, name ASC LIMIT ?",
                (limit,),
            )
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


def tool_search_chat_history(query: Optional[str] = None, chat_name: Optional[str] = None, limit: int = 15) -> List[Dict[str, Any]]:
    """Search actual message logs across WhatsApp chats."""
    conn = get_bridge_db()
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        if chat_name and query:
            cursor.execute(
                """
                SELECT chat_name, sender_name, message_text, timestamp, is_from_me 
                FROM message_log 
                WHERE (chat_name LIKE ? OR chat_jid LIKE ?) AND message_text LIKE ? 
                ORDER BY timestamp DESC LIMIT ?
                """,
                (f"%{chat_name}%", f"%{chat_name}%", f"%{query}%", limit),
            )
        elif chat_name:
            cursor.execute(
                """
                SELECT chat_name, sender_name, message_text, timestamp, is_from_me 
                FROM message_log 
                WHERE chat_name LIKE ? OR chat_jid LIKE ? 
                ORDER BY timestamp DESC LIMIT ?
                """,
                (f"%{chat_name}%", f"%{chat_name}%", limit),
            )
        elif query:
            cursor.execute(
                """
                SELECT chat_name, sender_name, message_text, timestamp, is_from_me 
                FROM message_log 
                WHERE message_text LIKE ? 
                ORDER BY timestamp DESC LIMIT ?
                """,
                (f"%{query}%", limit),
            )
        else:
            cursor.execute(
                "SELECT chat_name, sender_name, message_text, timestamp, is_from_me FROM message_log ORDER BY timestamp DESC LIMIT ?",
                (limit,),
            )
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


def tool_get_agenda(date: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch confirmed calendar events from the database."""
    conn = get_bridge_db()
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        if date:
            cursor.execute(
                "SELECT id, title, event_date, event_time, original_text FROM pending_events WHERE status = 'confirmed' AND event_date = ? ORDER BY event_time ASC",
                (date,),
            )
        else:
            cursor.execute(
                "SELECT id, title, event_date, event_time, original_text FROM pending_events WHERE status = 'confirmed' ORDER BY event_date ASC, event_time ASC LIMIT 30"
            )
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


def tool_get_todos() -> List[Dict[str, Any]]:
    """Fetch uncompleted todo tasks from database."""
    conn = get_bridge_db()
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, text, created_at FROM todos WHERE completed = 0 ORDER BY id DESC")
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


def tool_get_reminders() -> List[Dict[str, Any]]:
    """Fetch pending reminders from database."""
    conn = get_bridge_db()
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, reminder_text, due_at FROM reminders WHERE status = 'pending' ORDER BY due_at ASC")
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


def tool_manage_memory(action: str, fact: Optional[str] = None, query: Optional[str] = None) -> Dict[str, Any]:
    """Save or recall facts from Second Brain memory."""
    if action == "save" and fact:
        mem = save_memory(fact_text=fact, category="General", importance=3)
        return {"success": True, "saved": fact, "id": mem.get("id")}
    elif action == "recall" and query:
        results = recall_memories(query=query, limit=10)
        return {"success": True, "memories": results}
    elif action == "list_all":
        results = recall_memories(query="all facts", limit=30)
        return {"success": True, "memories": results}
    return {"success": False, "error": "Invalid action"}


def tool_web_search(query: str) -> List[Dict[str, Any]]:
    """Live web search."""
    from web_search import search_web
    return search_web(query, max_results=5)


# ─── TOOL DEFINITIONS FOR LLM ───────────────────────────────────

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_contacts",
            "description": "Fetch real contacts from the user's synced WhatsApp Address Book. Use prefix (e.g. 'b', 'har') or search query.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prefix": {"type": "string", "description": "Starting letter or prefix, e.g. 'b' or 'a'"},
                    "search": {"type": "string", "description": "Name search substring, e.g. 'harshith' or 'dad'"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_chat_history",
            "description": "Search past WhatsApp message logs to find what people said, links shared, or conversation details.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Keyword to search in messages"},
                    "chat_name": {"type": "string", "description": "Name of contact or group chat to inspect"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_agenda",
            "description": "Fetch upcoming confirmed calendar events and meetings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "Date in YYYY-MM-DD format (optional)"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_todos_and_reminders",
            "description": "Fetch active todo items and pending reminders.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_memory",
            "description": "Save a new personal fact or recall facts from the Second Brain memory vault.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["save", "recall", "list_all"]},
                    "fact": {"type": "string", "description": "Fact to save"},
                    "query": {"type": "string", "description": "Topic to recall"},
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search live web for real-time news, current info, or documentation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                },
                "required": ["query"],
            },
        },
    },
]


# ─── AGENT REACT EXECUTION LOOP ─────────────────────────────────

@rate_limited()
def run_autonomous_agent(
    user_prompt: str,
    recent_history: Optional[List[Dict[str, Any]]] = None,
    current_time_str: Optional[str] = None,
) -> str:
    """
    Run autonomous tool-calling agent with multi-step reasoning.
    Executes real database tools and returns grounded answer.
    """
    client = _get_client()
    model = _get_model()
    owner_name, owner_bio, owner_tone = _get_owner_info()

    system_prompt = f"""\
You are ARGUS, the autonomous, hyper-competent AI Chief of Staff and personal agent for {owner_name}.
You have direct, real-time access to the user's WhatsApp contacts database, chat history, calendar agenda, \
Second Brain memory vault, todos, and live web search.

CRITICAL PRINCIPLES:
1. GROUND-TRUTH ONLY: NEVER invent, hallucinate, or guess contacts, phone numbers, messages, or calendar events.
   Always call the appropriate tool (e.g. `list_contacts`, `get_agenda`, `manage_memory`) to retrieve real data.
2. If the user asks for contacts (e.g. "contacts starting with b", "who is in my directory?"), YOU MUST call `list_contacts`.
3. If the user asks what was said or discussed, call `search_chat_history`.
4. Tone: {owner_tone}. Be sharp, concise, proactive, respectful, and ultra-helpful like an elite Chief of Staff.
5. If no items match, state clearly and factually that none were found.
"""

    messages = [
        {"role": "system", "content": system_prompt},
    ]

    if current_time_str:
        messages.append({"role": "system", "content": f"Current Date/Time: {current_time_str}"})

    if recent_history:
        for msg in recent_history[-6:]:
            role = "assistant" if msg.get("is_from_me") else "user"
            content = msg.get("text") or msg.get("message_text") or ""
            if content:
                messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_prompt})

    # Step 1: Initial model completion with tool capabilities
    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=AGENT_TOOLS,
            tool_choice="auto",
            temperature=0.2,
            max_tokens=1000,
        )

        response_message = response.choices[0].message
        tool_calls = getattr(response_message, "tool_calls", None)

        # Step 2: If the agent decides to invoke tools, execute them against SQLite
        if tool_calls:
            messages.append(response_message)

            for tc in tool_calls:
                fn_name = tc.function.name
                fn_args = json.loads(tc.function.arguments or "{}")
                tool_output: Any = None

                logger.info("Agent executing tool: %s with args: %s", fn_name, fn_args)

                if fn_name == "list_contacts":
                    tool_output = tool_list_contacts(
                        prefix=fn_args.get("prefix"),
                        search=fn_args.get("search"),
                    )
                elif fn_name == "search_chat_history":
                    tool_output = tool_search_chat_history(
                        query=fn_args.get("query"),
                        chat_name=fn_args.get("chat_name"),
                    )
                elif fn_name == "get_agenda":
                    tool_output = tool_get_agenda(date=fn_args.get("date"))
                elif fn_name == "get_todos_and_reminders":
                    tool_output = {
                        "todos": tool_get_todos(),
                        "reminders": tool_get_reminders(),
                    }
                elif fn_name == "manage_memory":
                    tool_output = tool_manage_memory(
                        action=fn_args.get("action", "recall"),
                        fact=fn_args.get("fact"),
                        query=fn_args.get("query"),
                    )
                elif fn_name == "web_search":
                    tool_output = tool_web_search(query=fn_args.get("query", ""))
                else:
                    tool_output = {"error": f"Unknown tool {fn_name}"}

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": fn_name,
                    "content": json.dumps(tool_output),
                })

            # Step 3: Second completion with real tool outputs
            second_response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.3,
                max_tokens=1000,
            )
            return second_response.choices[0].message.content or "Done."

        # If no tool was needed, return direct text
        return response_message.content or "How can I assist you, boss?"

    except Exception as e:
        logger.error("Agent execution error: %s", e, exc_info=True)
        # Fallback to direct answer if tool calling fails
        return f"I ran into an issue accessing your local databases: {e}"


# ─── AUTONOMOUS BACKGROUND MEMORY HARVESTER ─────────────────────

AUTO_MEMORY_PROMPT = """\
You are an autonomous episodic memory extractor for ARGUS Second Brain.
Analyze the message text and determine if the user or contact revealed any IMPORTANT personal facts, \
preferences, relationships, project details, credentials, or schedules that should be permanently remembered.

RULES:
1. ONLY extract meaningful, persistent facts (e.g. "User studies CS at PES", "Harshith is working on a drone project", "User prefers evening meetings", "Mom's birthday is March 12").
2. DO NOT extract casual chatter, greetings, jokes, or ephemeral remarks.
3. Return ONLY valid JSON:
   {
     "should_remember": bool,
     "facts": [
       {
         "fact_text": string,
         "category": "Academics" | "Work" | "People" | "Preferences" | "Credentials" | "General"
       }
     ]
   }
"""

def auto_harvest_memories(message_text: str, sender_name: str = "User") -> List[Dict[str, Any]]:
    """Silently extract and store personal facts into Second Brain."""
    if len(message_text.strip()) < 10:
        return []

    client = _get_client()
    try:
        res = client.chat.completions.create(
            model=_get_model(),
            messages=[
                {"role": "system", "content": AUTO_MEMORY_PROMPT},
                {"role": "user", "content": f"Speaker: {sender_name}\nText: \"{message_text}\""},
            ],
            temperature=0.1,
            max_tokens=400,
        )
        raw = res.choices[0].message.content or "{}"
        cleaned = _clean_json_response(raw)
        data = json.loads(cleaned)
        if data.get("should_remember") and data.get("facts"):
            saved = []
            for item in data["facts"]:
                mem = save_memory(
                    fact_text=item["fact_text"],
                    category=item.get("category", "General"),
                    importance=3,
                )
                saved.append(mem)
                logger.info("🧠 [Auto-Memory Saved] %s (%s)", item["fact_text"], item.get("category"))
            return saved
    except Exception as e:
        logger.debug("Auto-memory extraction skipped: %s", e)
    return []
