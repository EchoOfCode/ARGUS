"""
Autonomous ReAct Tool-Calling Agent Engine for ARGUS ("OpenClaw" Architecture).
Provides complete agentic superpowers:
1. Multi-turn Conversational Memory with Co-reference Resolution
2. Multi-Action Composite Execution in a single text (Draft + Schedule + Remind)
3. Deep Cross-Chat Knowledge & Link Search
4. Autonomous Relationship & Preference Learning
"""

import json
import logging
import os
import re
import sqlite3
from datetime import datetime
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


# ─── REAL GROUND-TRUTH DATABASE TOOLS ───────────────────────────

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


def tool_search_chat_history(query: Optional[str] = None, chat_name: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
    """Search actual message logs across WhatsApp chats and groups."""
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


def tool_search_links_and_files(chat_name: Optional[str] = None, query: Optional[str] = None, limit: int = 15) -> List[Dict[str, Any]]:
    """Search specifically for URLs, links, meet invites, and documents shared across chats."""
    conn = get_bridge_db()
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        link_pattern = "%http%"
        if chat_name:
            cursor.execute(
                """
                SELECT chat_name, sender_name, message_text, timestamp 
                FROM message_log 
                WHERE (chat_name LIKE ? OR chat_jid LIKE ?) AND (message_text LIKE ? OR message_text LIKE '%zoom%' OR message_text LIKE '%meet%')
                ORDER BY timestamp DESC LIMIT ?
                """,
                (f"%{chat_name}%", f"%{chat_name}%", link_pattern, limit),
            )
        else:
            cursor.execute(
                """
                SELECT chat_name, sender_name, message_text, timestamp 
                FROM message_log 
                WHERE message_text LIKE ? OR message_text LIKE '%zoom%' OR message_text LIKE '%meet%'
                ORDER BY timestamp DESC LIMIT ?
                """,
                (link_pattern, limit),
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


def tool_schedule_event(title: str, date: str, time: Optional[str] = None, location: Optional[str] = None) -> Dict[str, Any]:
    """Directly schedule a confirmed calendar event."""
    conn = get_bridge_db()
    if not conn:
        return {"success": False, "error": "Database unavailable"}
    try:
        cursor = conn.cursor()
        loc_str = f" @ {location}" if location else ""
        full_title = f"{title}{loc_str}"
        cursor.execute(
            """
            INSERT INTO pending_events (chat_jid, sender_jid, original_text, title, event_date, event_time, confidence, status, confirmed_at)
            VALUES ('self', 'self', ?, ?, ?, ?, 1.0, 'confirmed', datetime('now'))
            """,
            (f"Manual schedule: {full_title}", full_title, date, time),
        )
        conn.commit()
        return {"success": True, "event_id": cursor.lastrowid, "title": full_title, "date": date, "time": time}
    finally:
        conn.close()


def tool_create_reminder(reminder_text: str, due_at: str) -> Dict[str, Any]:
    """Directly create a pending reminder."""
    conn = get_bridge_db()
    if not conn:
        return {"success": False, "error": "Database unavailable"}
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO reminders (chat_jid, reminder_text, due_at, status) VALUES ('self', ?, ?, 'pending')",
            (reminder_text, due_at),
        )
        conn.commit()
        return {"success": True, "reminder_id": cursor.lastrowid, "reminder_text": reminder_text, "due_at": due_at}
    finally:
        conn.close()


def tool_create_todo(text: str) -> Dict[str, Any]:
    """Add a new task to the todo list."""
    conn = get_bridge_db()
    if not conn:
        return {"success": False, "error": "Database unavailable"}
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO todos (chat_jid, text, completed) VALUES ('self', ?, 0)", (text,))
        conn.commit()
        return {"success": True, "todo_id": cursor.lastrowid, "text": text}
    finally:
        conn.close()


def tool_draft_whatsapp_message(recipient_name: str, message_text: str) -> Dict[str, Any]:
    """Draft a WhatsApp message to a contact ready for 1-tap dispatch."""
    conn = get_bridge_db()
    if not conn:
        return {"success": False, "error": "Database unavailable"}
    try:
        cursor = conn.cursor()
        # Find recipient JID
        cursor.execute(
            "SELECT jid, name FROM chat_directory WHERE name LIKE ? ORDER BY name ASC LIMIT 1",
            (f"%{recipient_name}%",),
        )
        row = cursor.fetchone()
        if not row:
            return {"success": False, "error": f"Contact '{recipient_name}' not found in address book."}

        target_jid = row["jid"]
        target_name = row["name"]
        cursor.execute(
            "INSERT INTO pending_outbox (target_jid, target_name, message_text, status) VALUES (?, ?, ?, 'pending')",
            (target_jid, target_name, message_text),
        )
        conn.commit()
        return {"success": True, "draft_id": cursor.lastrowid, "recipient": target_name, "message": message_text}
    finally:
        conn.close()


def tool_get_todos_and_reminders() -> Dict[str, Any]:
    """Fetch active todos and pending reminders."""
    conn = get_bridge_db()
    if not conn:
        return {"todos": [], "reminders": []}
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, text, created_at FROM todos WHERE completed = 0 ORDER BY id DESC")
        todos = [dict(r) for r in cursor.fetchall()]

        cursor.execute("SELECT id, reminder_text, due_at FROM reminders WHERE status = 'pending' ORDER BY due_at ASC")
        reminders = [dict(r) for r in cursor.fetchall()]
        return {"todos": todos, "reminders": reminders}
    finally:
        conn.close()


def tool_manage_memory(action: str, fact: Optional[str] = None, category: Optional[str] = "General", query: Optional[str] = None) -> Dict[str, Any]:
    """Save, recall, or search facts in Second Brain memory."""
    if action == "save" and fact:
        mem = save_memory(fact_text=fact, category=category or "General", importance=3)
        return {"success": True, "saved": fact, "id": mem.get("id")}
    elif action == "recall" and query:
        results = recall_memories(query=query, limit=10)
        return {"success": True, "memories": results}
    elif action == "list_all":
        results = recall_memories(query="all facts", limit=30)
        return {"success": True, "memories": results}
    return {"success": False, "error": "Invalid action"}


def tool_record_expense(
    amount: float,
    description: str,
    person: Optional[str] = None,
    category: Optional[str] = "General",
    is_debt: int = 0,
) -> Dict[str, Any]:
    """Record an expense, lending, or debt in the financial ledger."""
    conn = get_bridge_db()
    if not conn:
        return {"success": False, "error": "Database unavailable"}
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO expenses (chat_jid, amount, currency, category, description, person, is_debt, created_at)
            VALUES ('self', ?, 'INR', ?, ?, ?, ?, datetime('now'))
            """,
            (amount, category or "General", description, person, is_debt),
        )
        conn.commit()
        return {
            "success": True,
            "id": cursor.lastrowid,
            "amount": amount,
            "description": description,
            "person": person,
            "type": "lent" if is_debt == 1 else "borrowed" if is_debt == 2 else "expense",
        }
    finally:
        conn.close()


def tool_get_financial_summary(type: str = "all") -> Dict[str, Any]:
    """Fetch financial breakdown of expenses and debts."""
    conn = get_bridge_db()
    if not conn:
        return {"total_expenses": 0, "debts_owed_to_me": [], "i_owe": []}
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM expenses WHERE is_debt = 0 ORDER BY created_at DESC LIMIT 30")
        expenses = [dict(r) for r in cursor.fetchall()]
        total_spent = sum(e["amount"] for e in expenses)

        cursor.execute("SELECT * FROM expenses WHERE is_debt = 1 ORDER BY created_at DESC LIMIT 30")
        owed_to_me = [dict(r) for r in cursor.fetchall()]

        cursor.execute("SELECT * FROM expenses WHERE is_debt = 2 ORDER BY created_at DESC LIMIT 30")
        i_owe = [dict(r) for r in cursor.fetchall()]

        return {
            "total_spent_recent": total_spent,
            "recent_expenses": expenses[:10],
            "money_owed_to_you": owed_to_me,
            "money_you_owe": i_owe,
        }
    finally:
        conn.close()


def tool_web_search(query: str) -> List[Dict[str, Any]]:
    """Live web search."""
    from web_search import search_web
    return search_web(query, max_results=5)


# ─── COMPLETE AGENT TOOL DEFINITIONS ────────────────────────────

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_contacts",
            "description": "Fetch real contacts from the user's WhatsApp Address Book. Filter by starting letter/prefix or search query.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prefix": {"type": "string", "description": "Starting letter, e.g. 'b' or 'm'"},
                    "search": {"type": "string", "description": "Name search substring, e.g. 'harshith'"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_chat_history",
            "description": "Search past WhatsApp message logs across chats and groups to find what was said, assignment notes, or discussions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Keyword to search in messages"},
                    "chat_name": {"type": "string", "description": "Name of contact or group chat (optional)"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_links_and_files",
            "description": "Search specifically for Google Meet links, Zoom links, website URLs, and files shared in chats.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chat_name": {"type": "string", "description": "Specific group or contact name (optional)"},
                    "query": {"type": "string", "description": "Search keyword (optional)"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_agenda",
            "description": "Fetch upcoming confirmed calendar events, meetings, and classes.",
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
            "name": "schedule_event",
            "description": "Schedule a new confirmed calendar event or meeting.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Event title"},
                    "date": {"type": "string", "description": "Date in YYYY-MM-DD format"},
                    "time": {"type": "string", "description": "Time in HH:MM format, e.g. 17:00"},
                    "location": {"type": "string", "description": "Location (optional)"},
                },
                "required": ["title", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_reminder",
            "description": "Create a new reminder with a due timestamp.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reminder_text": {"type": "string", "description": "What to remind the user about"},
                    "due_at": {"type": "string", "description": "ISO timestamp or YYYY-MM-DD HH:MM"},
                },
                "required": ["reminder_text", "due_at"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_todo",
            "description": "Add a task to the user's todo list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Task description"},
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "draft_whatsapp_message",
            "description": "Draft a WhatsApp message to a contact ready for sending.",
            "parameters": {
                "type": "object",
                "properties": {
                    "recipient_name": {"type": "string", "description": "Name of contact to message"},
                    "message_text": {"type": "string", "description": "Message content to send"},
                },
                "required": ["recipient_name", "message_text"],
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
            "name": "record_expense",
            "description": "Log an expense, lending, or borrowed money in the ledger. E.g. 'Paid 450 for lunch' or 'Harshith owes me 200 for uber'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "Amount in INR"},
                    "description": {"type": "string", "description": "What the expense was for"},
                    "person": {"type": "string", "description": "Name of person involved (if any)"},
                    "category": {"type": "string", "description": "Category (Food, Travel, College, Bills, Misc)"},
                    "is_debt": {"type": "integer", "enum": [0, 1, 2], "description": "0=personal expense, 1=they owe me, 2=I owe them"},
                },
                "required": ["amount", "description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_financial_summary",
            "description": "Get a summary of recent expenses, spending, and who owes money.",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["all", "expenses", "debts"]},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_memory",
            "description": "Save personal facts, relationships, credentials, or recall details from Second Brain.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["save", "recall", "list_all"]},
                    "fact": {"type": "string", "description": "Fact to save"},
                    "category": {"type": "string", "enum": ["Academics", "Work", "People", "Preferences", "Credentials", "General"]},
                    "query": {"type": "string", "description": "Query to search memory"},
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search live web for real-time news, current events, or documentation.",
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


# ─── AGENT REACT MULTI-STEP EXECUTION LOOP ───────────────────────

@rate_limited()
def run_autonomous_agent(
    user_prompt: str,
    recent_history: Optional[List[Dict[str, Any]]] = None,
    current_time_str: Optional[str] = None,
) -> str:
    """
    Run autonomous tool-calling agent with multi-step reasoning.
    Can execute multiple tools in sequence (e.g. Draft message + Schedule event).
    """
    client = _get_client()
    model = _get_model()
    owner_name, owner_bio, owner_tone = _get_owner_info()

    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    system_prompt = f"""\
You are ARGUS, the elite, autonomous AI Chief of Staff and personal assistant for {owner_name}.
You have direct, real-time access to the user's WhatsApp contacts database, cross-chat history, calendar agenda, \
Second Brain memory vault, todos, reminders, and live web search.

CORE CAPABILITIES & AGI PERSONALITY:
1. MULTI-ACTION COMPOSITE EXECUTION: If the user gives multi-part requests (e.g. "tell Harshith I'll be there and schedule our sync tomorrow at 5pm and remind me to bring laptop"), \
   YOU MUST EXECUTE ALL TOOLS in sequence (draft_whatsapp_message + schedule_event + create_reminder) and present a clean unified summary.
2. GROUND-TRUTH ONLY: NEVER hallucinate contacts, messages, or schedules. Always query SQLite tools.
3. CONVERSATIONAL CONTINUITY: Understand follow-up requests (e.g. "starting with b", "what about him?", "reschedule that") using conversation history.
4. DYNAMIC HUMAN TONE: {owner_tone}. Be sharp, organic, proactive, concise, and ultra-competent. Never sound like a scripted bot. Speak with natural intelligence and executive flow.
Current Reference Time: {now_iso}
"""

    messages = [
        {"role": "system", "content": system_prompt},
    ]

    if current_time_str:
        messages.append({"role": "system", "content": f"Current Date/Time: {current_time_str}"})

    if recent_history:
        for msg in recent_history[-8:]:
            role = "assistant" if msg.get("is_from_me") else "user"
            content = msg.get("text") or msg.get("message_text") or ""
            if content:
                messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_prompt})

    # Execute up to 3 turns of tool calling loop
    for step in range(3):
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

            if not tool_calls:
                return response_message.content or "How can I assist you, boss?"

            messages.append(response_message)

            for tc in tool_calls:
                fn_name = tc.function.name
                fn_args = json.loads(tc.function.arguments or "{}")
                tool_output: Any = None

                logger.info("Agent executing tool [%d]: %s with args: %s", step + 1, fn_name, fn_args)

                if fn_name == "list_contacts":
                    tool_output = tool_list_contacts(prefix=fn_args.get("prefix"), search=fn_args.get("search"))
                elif fn_name == "search_chat_history":
                    tool_output = tool_search_chat_history(query=fn_args.get("query"), chat_name=fn_args.get("chat_name"))
                elif fn_name == "search_links_and_files":
                    tool_output = tool_search_links_and_files(chat_name=fn_args.get("chat_name"), query=fn_args.get("query"))
                elif fn_name == "get_agenda":
                    tool_output = tool_get_agenda(date=fn_args.get("date"))
                elif fn_name == "schedule_event":
                    tool_output = tool_schedule_event(
                        title=fn_args.get("title", "Meeting"),
                        date=fn_args.get("date", datetime.now().strftime("%Y-%m-%d")),
                        time=fn_args.get("time"),
                        location=fn_args.get("location"),
                    )
                elif fn_name == "create_reminder":
                    tool_output = tool_create_reminder(
                        reminder_text=fn_args.get("reminder_text", "Reminder"),
                        due_at=fn_args.get("due_at", datetime.now().strftime("%Y-%m-%d %H:%M")),
                    )
                elif fn_name == "create_todo":
                    tool_output = tool_create_todo(text=fn_args.get("text", "Task"))
                elif fn_name == "draft_whatsapp_message":
                    tool_output = tool_draft_whatsapp_message(
                        recipient_name=fn_args.get("recipient_name", ""),
                        message_text=fn_args.get("message_text", ""),
                    )
                elif fn_name == "record_expense":
                    tool_output = tool_record_expense(
                        amount=float(fn_args.get("amount", 0)),
                        description=fn_args.get("description", "Expense"),
                        person=fn_args.get("person"),
                        category=fn_args.get("category", "General"),
                        is_debt=int(fn_args.get("is_debt", 0)),
                    )
                elif fn_name == "get_financial_summary":
                    tool_output = tool_get_financial_summary(type=fn_args.get("type", "all"))
                elif fn_name == "manage_memory":
                    tool_output = tool_manage_memory(
                        action=fn_args.get("action", "recall"),
                        fact=fn_args.get("fact"),
                        category=fn_args.get("category", "General"),
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

        except Exception as e:
            logger.error("Agent loop error: %s", e, exc_info=True)
            return f"I encountered an error executing that: {e}"

    return "Done, boss."


# ─── AUTONOMOUS BACKGROUND EPISODIC MEMORY HARVESTER ────────────

AUTO_MEMORY_PROMPT = """\
You are an autonomous relationship & episodic memory extractor for ARGUS Second Brain.
Analyze the message text and extract IMPORTANT personal facts, preferences, relationships, \
project roles, family details, or schedules.

EXAMPLES OF FACTS TO EXTRACT:
- "Harshith is my teammate for SIH" -> category: "People", fact: "Harshith is on Yusuf's SIH team"
- "I have DSA class on Mondays" -> category: "Academics", fact: "Has DSA class on Mondays"
- "Prefers evening calls after 6pm" -> category: "Preferences", fact: "Prefers calls after 6pm"
- "My sister's birthday is Oct 14" -> category: "People", fact: "Sister's birthday is October 14"

RULES:
1. ONLY extract lasting, meaningful facts. Ignore fleeting chatter.
2. Return ONLY valid JSON:
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
