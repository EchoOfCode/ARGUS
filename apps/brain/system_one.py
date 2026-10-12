"""
System 1 (Jev-Style Discriminative Decision Engine) for ARGUS Brain.

Architecture Overview:
- Non-autoregressive, zero-token local execution layer.
- Intercepts incoming requests before invoking cloud LLM generative decode loops.
- Evaluates and executes deterministic operations directly against SQLite:
    1. Todo CRUD (list, add, complete, delete)
    2. Reminders (natural-language time extraction, scheduling, listing, cancellation)
    3. Expenses & Ledger (expense logging, debt tracking, balance checking)
    4. Diagnostic & Status Commands (/status, /health, /ping, /autopilot, /killswitch)
    5. Context maintenance ("clean up", "clear", "reset")
    6. Conversational fast-path acknowledgments ("ok", "thanks", "cool")

If a message matches a System 1 intent, it executes in < 5ms with ZERO external API calls/tokens.
If not, it cleanly yields to System 2 (Groq / Gemini) for creative/complex reasoning.
"""

import logging
import re
from datetime import datetime, timedelta
from typing import Optional, Tuple

logger = logging.getLogger("argus.system1")


class SystemOneEngine:
    """Zero-Token local decision and execution engine."""

    @staticmethod
    def parse_time_expression(text: str) -> Optional[Tuple[str, str]]:
        """
        Extract time expression and clean task from reminder text.
        Returns: (due_at_iso, clean_task) or None
        """
        now = datetime.now()
        lower = text.lower()

        # 1. Relative offset: "in X minutes/hours/days"
        rel_match = re.search(r"\bin\s+(\d+)\s*(mins?|minutes?|hours?|hrs?|days?)\b", lower)
        if rel_match:
            amount = int(rel_match.group(1))
            unit = rel_match.group(2)
            delta = (
                timedelta(minutes=amount) if "min" in unit
                else timedelta(hours=amount) if "hour" in unit or "hr" in unit
                else timedelta(days=amount)
            )
            due_at = (now + delta).strftime("%Y-%m-%dT%H:%M:%S")
            clean_task = re.sub(r"\bin\s+\d+\s*(mins?|minutes?|hours?|hrs?|days?)\b", "", text, flags=re.IGNORECASE)
            clean_task = re.sub(r"^(remind\s+me\s+(to|about)\s+|reminder:?\s*)", "", clean_task, flags=re.IGNORECASE).strip()
            return due_at, clean_task or text

        # 2. Time of day: "at 5pm", "at 17:30", "at 9 am"
        time_match = re.search(r"\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", lower)
        if time_match:
            hour = int(time_match.group(1))
            minute = int(time_match.group(2)) if time_match.group(2) else 0
            meridiem = time_match.group(3)
            if meridiem == "pm" and hour < 12:
                hour += 12
            elif meridiem == "am" and hour == 12:
                hour = 0

            target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if "tomorrow" in lower or target <= now:
                target += timedelta(days=1)

            clean_task = re.sub(r"\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b", "", text, flags=re.IGNORECASE)
            clean_task = re.sub(r"\btomorrow\b", "", clean_task, flags=re.IGNORECASE)
            clean_task = re.sub(r"^(remind\s+me\s+(to|about)\s+|reminder:?\s*)", "", clean_task, flags=re.IGNORECASE).strip()
            return target.strftime("%Y-%m-%dT%H:%M:%S"), clean_task or text

        # 3. Relative keywords: "tomorrow morning", "tonight", "this evening"
        if "tomorrow morning" in lower:
            target = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
            clean_task = re.sub(r"\btomorrow\s+morning\b", "", text, flags=re.IGNORECASE)
            clean_task = re.sub(r"^(remind\s+me\s+(to|about)\s+|reminder:?\s*)", "", clean_task, flags=re.IGNORECASE).strip()
            return target.strftime("%Y-%m-%dT%H:%M:%S"), clean_task or text

        if "tonight" in lower or "this evening" in lower:
            target = now.replace(hour=20, minute=0, second=0, microsecond=0)
            if target <= now:
                target += timedelta(days=1)
            clean_task = re.sub(r"\b(tonight|this\s+evening)\b", "", text, flags=re.IGNORECASE)
            clean_task = re.sub(r"^(remind\s+me\s+(to|about)\s+|reminder:?\s*)", "", clean_task, flags=re.IGNORECASE).strip()
            return target.strftime("%Y-%m-%dT%H:%M:%S"), clean_task or text

        if "tomorrow" in lower:
            target = (now + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
            clean_task = re.sub(r"\btomorrow\b", "", text, flags=re.IGNORECASE)
            clean_task = re.sub(r"^(remind\s+me\s+(to|about)\s+|reminder:?\s*)", "", clean_task, flags=re.IGNORECASE).strip()
            return target.strftime("%Y-%m-%dT%H:%M:%S"), clean_task or text

        return None

    @classmethod
    def try_execute(cls, user_prompt: str, is_untrusted: bool = False) -> Optional[str]:
        """
        Attempt to resolve the user prompt locally in System 1.
        Returns formatted response string if resolved with 0 tokens, or None to fall back to System 2.
        """
        raw = user_prompt.strip()
        lower = raw.lower()

        # Untrusted prompt-injection protection: do not execute write tools on untrusted content
        if is_untrusted:
            # Only allow read-only fast path or discard
            if lower in ["hi", "hello", "hey", "sup", "yo", "ok", "cool", "thanks", "nice", "fine"]:
                return "Hey! How can I help you today?"
            return None

        # ─── 1. MAINTENANCE & CONTEXT RESET ───────────────────────────
        if lower in ["clean up", "cleanup", "clear", "wipe", "reset", "clear context", "clear screen"]:
            logger.info("[SYSTEM 1] Fast-path executed: Context cleanup (0 tokens)")
            return "🧹 *Context cleaned up.* Memory and active state are refreshed and ready."

        # ─── 2. DIAGNOSTIC / STATUS / HEALTH ─────────────────────────
        if lower in ["/status", "status", "/ping", "ping", "/health", "health", "are you there"]:
            from db import get_db, get_kill_switch_status, get_offline_mode
            kill = get_kill_switch_status()
            offline = get_offline_mode()
            with get_db() as conn:
                c = conn.cursor()
                c.execute("SELECT count(*) FROM todos WHERE completed = 0")
                pending_todos = c.fetchone()[0]
                c.execute("SELECT count(*) FROM reminders WHERE status = 'pending'")
                pending_reminders = c.fetchone()[0]

            logger.info("[SYSTEM 1] Fast-path executed: System status (0 tokens)")
            return (
                f"🛡️ *ARGUS System Status*\n\n"
                f"• *Mode:* {'📴 OFFLINE (System 1 Only - Zero Tokens)' if offline else '🌐 ONLINE (System 1 Local + System 2 Cloud)'}\n"
                f"• *Status:* Online & Operational\n"
                f"• *Emergency Kill Switch:* {'🛑 ACTIVE (Muted)' if kill else '🟢 Inactive (Live)'}\n"
                f"• *Pending Tasks:* {pending_todos}\n"
                f"• *Pending Reminders:* {pending_reminders}\n"
                f"• *Decision Engine:* System 1 (Zero-Token Local)"
            )

        # ─── 2B. ONLINE / OFFLINE MODE TOGGLE (ZERO TOKENS) ───────────
        if lower in [
            "/offline", "offline", "offline mode", "/mode offline", "mode offline",
            "disable online mode", "go offline", "turn off online", "turn offline"
        ]:
            from db import set_offline_mode
            set_offline_mode(True)
            logger.info("[SYSTEM 1] Fast-path executed: Offline mode enabled (0 tokens)")
            return (
                "📴 *Offline Mode Enabled (System 1 Only)*\n\n"
                "• *Zero Cloud Tokens:* All requests run 100% locally on your PC.\n"
                "• *Supported:* Tasks, reminders, expenses, status, clean up, and local commands.\n"
                "• *Cloud AI:* System 2 (Groq / Gemini) is strictly paused.\n\n"
                "_Type */online* to re-enable Cloud AI._"
            )

        if lower in [
            "/online", "online", "online mode", "/mode online", "mode online",
            "enable online mode", "go online", "turn on online", "turn online"
        ]:
            from db import set_offline_mode
            set_offline_mode(False)
            logger.info("[SYSTEM 1] Fast-path executed: Online mode enabled (0 tokens)")
            return (
                "🌐 *Online Mode Enabled (System 1 + System 2)*\n\n"
                "• *Local Engine:* Fast commands, tasks, and reminders continue to use 0 tokens.\n"
                "• *Cloud AI:* Complex reasoning, research, and coding will seamlessly use Cloud AI (Groq / Gemini)."
            )

        if lower in ["/mode", "mode", "current mode", "what mode", "check mode"]:
            from db import get_offline_mode
            offline = get_offline_mode()
            return (
                f"⚙️ *Current ARGUS Operating Mode*\n\n"
                f"• *Mode:* {'📴 OFFLINE (System 1 Zero-Token Only)' if offline else '🌐 ONLINE (System 1 Local + System 2 Cloud)'}\n\n"
                f"_Switch anytime with */offline* or */online*._"
            )

        # ─── 2C. AUTOPILOT EMERGENCY DISABLE (ZERO TOKENS) ───────────
        if lower in [
            "/autopilot off", "autopilot off", "/autopilot off all", "autopilot off all",
            "/autopilot off for all", "autopilot off for all", "disable autopilot", "stop autopilot"
        ]:
            from db import get_db
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE autopilot_rules SET status = 'disabled', tier = 0")
                cursor.execute("UPDATE system_settings SET value = '0' WHERE key = 'autopilot_global'")
            logger.info("[SYSTEM 1] Fast-path executed: All autopilot rules disabled (0 tokens)")
            return (
                "🛑 *Auto-Pilot Disabled for ALL Contacts*\n\n"
                "• All autonomous replies are stopped system-wide.\n"
                "• All contacts set to Tier 0 (Draft Only).\n\n"
                "_Turn on anytime with */autopilot on [Name]* or */autopilot on*._"
            )

        # ─── 3. TODO & TASK ACTIONS ──────────────────────────────────
        # 3A. List Tasks
        if (
            lower in ["/todaytasks", "/todaytodos", "/todos", "/tasks", "/todo", "todos", "tasks", "my tasks", "my todos", "todo list", "task list"]
            or re.search(r"^(show|list|view|get|what\s+are)\s+(my\s+)?(todos?|tasks?)\b", lower)
        ):
            from db import get_db
            with get_db() as conn:
                c = conn.cursor()
                c.execute("SELECT id, text FROM todos WHERE completed = 0 ORDER BY id DESC")
                todos = [dict(r) for r in c.fetchall()]
            logger.info("[SYSTEM 1] Fast-path executed: List todos (0 tokens)")
            if not todos:
                return "📋 *Your Task List is empty!* All caught up."

            lines = ["📋 *Your Pending Tasks:*"]
            for idx, t in enumerate(todos, 1):
                tid = t.get("id")
                text_val = t.get("text", "")
                lines.append(f"{idx}. `[#{tid}]` {text_val}")
            lines.append("\n_Tip: Type 'done #<id>' to complete, or 'add <task>' to create._")
            return "\n".join(lines)

        # 3B. Complete Task
        complete_match = re.search(r"^(?:done|finish|complete|completed)(?:\s+(?:task|todo))?\s+(?:#?(\d+)|(.+))$", lower)
        if complete_match:
            from agent_core import tool_complete_todo
            tid_str = complete_match.group(1)
            match_txt = complete_match.group(2)
            if tid_str:
                res = tool_complete_todo(todo_id=int(tid_str))
            else:
                res = tool_complete_todo(match_text=match_txt.strip())

            if res.get("success"):
                logger.info("[SYSTEM 1] Fast-path executed: Complete todo (0 tokens)")
                return f"✅ *Task marked completed:* {res.get('text', f'Task #{tid_str}')}"

        # 3C. Delete Task
        del_match = re.search(r"^(?:delete|remove|del)(?:\s+(?:task|todo))?\s+(?:#?(\d+)|(.+))$", lower)
        if del_match:
            from agent_core import tool_delete_todo
            tid_str = del_match.group(1)
            match_txt = del_match.group(2)
            if tid_str:
                res = tool_delete_todo(todo_id=int(tid_str))
            else:
                res = tool_delete_todo(match_text=match_txt.strip())

            if res.get("success"):
                logger.info("[SYSTEM 1] Fast-path executed: Delete todo (0 tokens)")
                return f"🗑️ *Task deleted:* {res.get('text', f'Task #{tid_str}')}"

        # 3D. Add Task
        add_match = re.search(r"^(?:add\s+(?:to\s+(?:my\s+)?(?:todo|task)(?:s)?|todo|task)|todo:?|task:?|new\s+todo:?)\s+(.+)$", lower)
        if add_match:
            task_text = re.sub(
                r"^(?:add\s+(?:to\s+(?:my\s+)?(?:todo|task)(?:s)?|todo|task)|todo:?|task:?|new\s+todo:?)\s*",
                "",
                raw,
                flags=re.IGNORECASE,
            ).strip()
            if task_text:
                from agent_core import tool_create_todo
                res = tool_create_todo(text=task_text)
                if res.get("success"):
                    logger.info("[SYSTEM 1] Fast-path executed: Add todo (0 tokens)")
                    return f"✅ *Task added:* \"{task_text}\" `[#{res.get('todo_id')}]`"

        # ─── 4. REMINDERS ────────────────────────────────────────────
        # 4A. List Reminders
        if lower in ["/reminders", "reminders", "my reminders", "show reminders", "list reminders", "upcoming reminders"]:
            from db import get_db
            with get_db() as conn:
                c = conn.cursor()
                c.execute("SELECT id, reminder_text, due_at FROM reminders WHERE status = 'pending' ORDER BY due_at ASC")
                rems = [dict(r) for r in c.fetchall()]
            logger.info("[SYSTEM 1] Fast-path executed: List reminders (0 tokens)")
            if not rems:
                return "⏰ *No pending reminders scheduled.*"

            lines = ["⏰ *Upcoming Reminders:*"]
            for idx, r in enumerate(rems, 1):
                rid = r.get("id")
                rtxt = r.get("reminder_text", "")
                rdue = r.get("due_at", "")
                lines.append(f"{idx}. `[#{rid}]` *{rtxt}* (Due: {rdue})")
            return "\n".join(lines)

        # 4B. Cancel Reminder
        canc_rem = re.search(r"^(?:cancel|delete|remove)\s+reminder\s+(?:#?(\d+)|(.+))$", lower)
        if canc_rem:
            from agent_core import tool_cancel_reminder
            rid_str = canc_rem.group(1)
            match_txt = canc_rem.group(2)
            if rid_str:
                res = tool_cancel_reminder(reminder_id=int(rid_str))
            else:
                res = tool_cancel_reminder(match_text=match_txt.strip())

            if res.get("success"):
                logger.info("[SYSTEM 1] Fast-path executed: Cancel reminder (0 tokens)")
                return f"🛑 *Reminder cancelled:* {res.get('text', f'Reminder #{rid_str}')}"

        # 4C. Add Reminder
        if lower.startswith("remind me ") or lower.startswith("reminder:"):
            parsed = cls.parse_time_expression(raw)
            if parsed:
                due_iso, clean_text = parsed
                from agent_core import tool_create_reminder
                res = tool_create_reminder(reminder_text=clean_text, due_at=due_iso)
                if res.get("success"):
                    logger.info("[SYSTEM 1] Fast-path executed: Add reminder (0 tokens)")
                    return f"⏰ *Reminder set:* \"{clean_text}\"\n📅 *Due:* `{due_iso}` `[#{res.get('reminder_id')}]`"

        # ─── 5. EXPENSES & DEBTS ─────────────────────────────────────
        # 5A. Ledger Summary
        if lower in ["/ledger", "/expenses", "expenses", "my expenses", "ledger", "balance", "debts", "my debts"]:
            from db import get_db
            with get_db() as conn:
                c = conn.cursor()
                c.execute("SELECT coalesce(sum(amount), 0) FROM expenses")
                grand_total = c.fetchone()[0]
                c.execute("SELECT coalesce(sum(amount), 0) FROM expenses WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')")
                month_total = c.fetchone()[0]
                c.execute("SELECT id, person, amount, description, is_debt FROM expenses WHERE is_debt IN (1, 2) ORDER BY id DESC")
                debts = [dict(r) for r in c.fetchall()]

            lines = [
                "📊 *ARGUS Ledger Summary*",
                f"• *Total Spent (This Month):* ₹{month_total:.2f}",
                f"• *Total Spent (All-time):* ₹{grand_total:.2f}",
            ]
            if debts:
                lines.append("\n⚖️ *Unsettled Debts:*")
                for d in debts:
                    lines.append(f"• `[#{d.get('id')}]` {d.get('person', 'Someone')}: ₹{d.get('amount', 0):.2f} ({d.get('description', '')})")
            else:
                lines.append("\n⚖️ *Debts:* All settled up!")

            logger.info("[SYSTEM 1] Fast-path executed: Ledger summary (0 tokens)")
            return "\n".join(lines)

        # 5B. Expense Logging: "spent 50 on coffee" / "paid 120 for lunch"
        exp_match = re.search(r"^(?:spent|paid)\s+(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)\s+(?:on|for)\s+(.+)$", lower)
        if exp_match:
            amount = float(exp_match.group(1))
            desc = exp_match.group(2).strip()
            from db import record_expense
            row = record_expense(amount=amount, description=desc, category=desc)
            logger.info("[SYSTEM 1] Fast-path executed: Record expense (0 tokens)")
            return f"💸 *Expense Recorded:* ₹{amount:.2f} for *{desc}* `[#{row.get('id')}]`"

        # ─── 6. FAST GREETINGS & ACKNOWLEDGMENTS ─────────────────────
        if lower in ["hi", "hello", "hey", "sup", "yo", "good morning", "good evening", "gm", "gn"]:
            logger.info("[SYSTEM 1] Fast-path executed: Greeting (0 tokens)")
            return "Hey there! Ready to assist you. What are we tackling today?"

        if lower in ["ok", "okay", "k", "cool", "nice", "fine", "kk", "thanks", "thank you", "thx", "ty", "noted", "alright", "got it"]:
            logger.info("[SYSTEM 1] Fast-path executed: Acknowledgment (0 tokens)")
            return "Got it! Let me know if you need anything else."

        # No System 1 rule matched — cleanly fall through to System 2 (Groq / Gemini)
        return None
