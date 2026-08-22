import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from groq import Groq
from models import ExtractResponse
from rate_limiter import rate_limited

logger = logging.getLogger("argus.groq")

# ─── System Prompts ─────────────────────────────────────────────

EVENT_EXTRACTION_PROMPT = """\
You are a structured-data extraction assistant. Your ONLY job is to determine \
whether a message describes a real calendar event (meeting, call, \
appointment, webinar, flight, etc.) and, if so, extract the event details.

RULES:
1. Return ONLY valid JSON — no prose, no markdown code fences, no explanation.
2. The JSON must match this exact schema:
   {
     "is_event": bool,
     "title": string or null,
     "date": "YYYY-MM-DD" or null,
     "time": "HH:MM" (24-hour) or null,
     "confidence": float 0.0-1.0,
     "raw_text": string
   }
3. Use the provided reference_timestamp as "now" to resolve relative dates \
   (e.g., "tomorrow", "next tuesday", "this friday").
4. Set is_event to false (with other fields null except raw_text and confidence=0.0) \
   when the text is ambiguous or clearly not a scheduling message.
5. Never fabricate a date or time that isn't reasonably inferable from the text.
6. For "title", infer something concise and human-useful like "Meeting", \
   "Call with [name]", "Dentist Appointment" — do NOT just echo the raw text.
7. If a time is mentioned, always convert to 24-hour HH:MM format.
8. If no specific time is mentioned but there IS an event, set time to null \
   (this will become an all-day event).
"""

SUMMARIZE_PROMPT = """\
You are an executive conversation summarizer for ARGUS. Given a list of messages from a WhatsApp chat/group, provide a high-yield, beautifully formatted summary.

STRUCTURE:
📌 *Key Discussions & Announcements:*
• (1-3 bullets on what was discussed or decided, attributing names where useful)

🔗 *Links, Resources & Questions:*
• (Any shared links, files, or important questions asked)

⚡ *Action Items & Deadlines:*
• (Any commitments, tasks, exam dates, or deadlines mentioned; if none, omit this section)

RULES:
1. Be concise, sharp, and easy to skim on mobile.
2. Return clean plain text formatted for WhatsApp without markdown code fences.
"""

QA_PROMPT = """\
You are ARGUS (Autonomous Real-time General Utility System), the user's dedicated personal AI executive assistant and Second Brain, running directly on their local machine.

IDENTITY & ORIGIN:
• Creator: You were designed, engineered, and built by Yusuf.
• Born / Created: February 2026 (PES University, Bangalore).
• Mission: To be Yusuf's all-in-one cognitive operating system — seamlessly orchestrating WhatsApp communications, inbox triage, task management, calendar scheduling, web intelligence, and long-term memory.
• Personality: Sharp, loyal, ultra-efficient, highly organized, and proactive with a polished executive demeanor.

CAPABILITIES:
• Direct local integration with WhatsApp (Baileys bridge), IMAP Gmail inbox, SQLite knowledge memory graph, Google Calendar sync, and real-time DuckDuckGo web search.

RULES:
1. When asked who you are, who made you, or when you were born, state proudly and clearly that you are ARGUS, engineered by Yusuf in February 2026 as his personal AI executive assistant and Second Brain.
2. NEVER claim you cannot access WhatsApp, group chats, or emails. You ARE ARGUS and you HAVE direct access to their local data.
3. If the user asks to summarize a chat or group, tell them: "I can summarize any group or chat! Type 'catchup [group name]' or 'summarize group'."
4. If the user asks for emails, tell them: "Type 'emails' to view your unread inbox, or 'summarize email #1' for a breakdown."
5. Keep answers direct, friendly, and concise (1-3 sentences for simple questions).
6. Return clean plain text formatted cleanly for WhatsApp without code blocks.
"""

EMAIL_SUMMARY_PROMPT = """\
You are an executive email summarizer for ARGUS.
Given the subject, sender, and body of an email, create a crisp executive summary.

RULES:
1. Summary format:
   - 🎯 *Core Purpose / TL;DR* (1 sentence)
   - 📌 *Key Points / Action Items* (1-3 bullet points)
   - ⏳ *Deadlines / Next Steps* (if any)
2. Be extremely concise. Keep it under 150 words.
3. Return plain text formatted for WhatsApp.
"""

BRIEFING_PROMPT = """\
You are ARGUS crafting the user's executive Daily Briefing message for WhatsApp.
Given their pending tasks, scheduled events, reminders, and unread priority emails, format a beautiful, motivating, and highly readable daily agenda.

RULES:
1. Organize with clean sections and emojis:
   🌅 *ARGUS DAILY EXECUTIVE BRIEFING*
   📅 *Today's Schedule & Events*
   ⏰ *Reminders*
   📝 *Pending Todos*
   📧 *Priority Unread Emails*
2. Keep items crisp and actionable.
3. If a section is empty, note "None scheduled" or skip gracefully.
4. End with a short, energizing quote or greeting.
"""


def _get_client() -> Groq:
    """Get a configured Groq client."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set in environment")
    return Groq(api_key=api_key)


def _get_model() -> str:
    """Get the configured Groq model."""
    return os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")


def _clean_json_response(raw: str) -> str:
    """Strip reasoning/think tags and markdown fences from LLM response if present."""
    import re
    cleaned = raw.strip()
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL).strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


# ─── Event Extraction ───────────────────────────────────────────

@rate_limited()
def extract_event(
    notification_text: str,
    received_at: str,
    source_app: str,
) -> ExtractResponse:
    """Extract event details from message text using Groq."""
    client = _get_client()

    user_prompt = (
        f"reference_timestamp: {received_at}\n"
        f"source_app: {source_app}\n"
        f"notification_text: {notification_text}"
    )

    logger.info("Extracting event — source=%s, text_len=%d", source_app, len(notification_text))

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": EVENT_EXTRACTION_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=256,
        temperature=0.1,
    )

    raw = completion.choices[0].message.content or "{}"
    try:
        parsed = json.loads(_clean_json_response(raw))
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Groq event response: %s", raw)
        raise ValueError(f"Groq returned unparseable JSON: {e}") from e

    parsed["raw_text"] = notification_text
    return ExtractResponse(**parsed)


# ─── Summarization ──────────────────────────────────────────────

@rate_limited()
def summarize_messages(
    messages: List[dict],
    instruction: str = "Summarize the key points, decisions, and action items.",
) -> str:
    """Summarize a list of chat messages."""
    client = _get_client()

    formatted_lines = []
    for m in messages:
        sender = m.get("sender_name") or m.get("sender_jid", "Unknown")
        text = m.get("message_text", "")
        formatted_lines.append(f"[{sender}]: {text}")

    chat_text = "\n".join(formatted_lines)
    user_prompt = f"Instruction: {instruction}\n\nChat history:\n{chat_text}"

    logger.info("Summarizing %d messages (length: %d chars)", len(messages), len(chat_text))

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": SUMMARIZE_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=500,
        temperature=0.3,
    )

    return (completion.choices[0].message.content or "No summary generated.").strip()


# ─── Q&A and Conversational Answering ───────────────────────────

@rate_limited()
def answer_question(
    question: str,
    context: Optional[str] = None,
    memory_context: Optional[str] = None,
    web_context: Optional[str] = None,
) -> str:
    """Answer a user question with optional context from memory and live web search."""
    client = _get_client()

    prompt_parts = []
    if memory_context:
        prompt_parts.append(f"Relevant facts from user's memory:\n{memory_context}")
    if web_context:
        prompt_parts.append(f"Live Web Search Results:\n{web_context}")
    if context:
        prompt_parts.append(f"Additional Context:\n{context}")

    prompt_parts.append(f"User Question: {question}")
    user_prompt = "\n\n".join(prompt_parts)

    logger.info("Answering question: %s", question[:80])

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": QA_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=500,
        temperature=0.4,
    )

    return (completion.choices[0].message.content or "I couldn't process an answer.").strip()


# ─── Email Summarization ────────────────────────────────────────

@rate_limited()
def summarize_email(
    subject: str,
    sender: str,
    date: str,
    body: str,
) -> str:
    """Generate an executive summary for an email."""
    client = _get_client()

    user_prompt = (
        f"Sender: {sender}\n"
        f"Date: {date}\n"
        f"Subject: {subject}\n\n"
        f"Email Body:\n{body[:3500]}"
    )

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": EMAIL_SUMMARY_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=350,
        temperature=0.2,
    )

    return (completion.choices[0].message.content or "Could not summarize email.").strip()


# ─── Daily Executive Briefing ───────────────────────────────────

@rate_limited()
def generate_briefing(
    todos: List[dict],
    reminders: List[dict],
    events: List[dict],
    emails: List[dict],
) -> str:
    """Generate a cohesive morning/evening executive briefing."""
    client = _get_client()

    todos_text = "\n".join([f"- [#{t.get('id')}] {t.get('text')}" for t in todos]) or "No pending todos"
    reminders_text = "\n".join([f"- at {r.get('due_at')}: {r.get('reminder_text')}" for r in reminders]) or "No pending reminders"
    events_text = "\n".join([f"- {e.get('title')} ({e.get('event_date')} {e.get('event_time', '')})" for e in events]) or "No events today"
    emails_text = "\n".join([f"- From: {em.get('sender')} | Subject: {em.get('subject')} ({em.get('snippet', '')[:80]})" for em in emails]) or "No unread priority emails"

    user_prompt = (
        f"Today's data:\n\n"
        f"TODOS:\n{todos_text}\n\n"
        f"REMINDERS:\n{reminders_text}\n\n"
        f"SCHEDULED EVENTS:\n{events_text}\n\n"
        f"UNREAD EMAILS:\n{emails_text}"
    )

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": BRIEFING_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=600,
        temperature=0.3,
    )

    return (completion.choices[0].message.content or "No briefing generated.").strip()


# ─── Second Brain: Auto-Tagging & Synthesis ─────────────────────

MEMORY_TAGGER_PROMPT = """\
You are an intelligent knowledge base classifier for ARGUS Second Brain.
Given a user fact or note, classify its category and extract 2-5 entity keywords.

CATEGORIES:
- academics (SRN, roll number, college, courses, exams, assignments, timetable)
- credentials (WiFi passwords, server IPs, locker codes, account IDs, license keys)
- people (friends, family, colleagues, birthdays, contact info, relationship notes)
- personal (preferences, health, allergy, shoe size, coffee, habits, routines)
- projects (work projects, code architecture, hackathons, repositories)
- general (miscellaneous notes, thoughts, ideas)

RULES:
1. Return ONLY valid JSON:
   {
     "category": "academics|credentials|people|personal|projects|general",
     "entities": ["keyword1", "keyword2"]
   }
2. No explanation or code blocks.
"""

MEMORY_SYNTHESIS_PROMPT = """\
You are ARGUS, the user's personal Second Brain.
Answer the user's question directly using ONLY their stored personal memories.

RULES:
1. Be direct, natural, and concise. Bold the exact facts/answers (e.g. "**PES1UG25CS001**", "**Harshith**").
2. If multiple facts are relevant, combine them smoothly.
3. If the stored memories do not contain the answer, say politely: "I don't have that stored in my memory yet. Tell me 'remember [fact]' and I'll keep track of it!"
4. Return clean plain text formatted for WhatsApp without markdown code fences.
"""


@rate_limited()
def classify_and_tag_memory(fact: str) -> Tuple[str, List[str]]:
    """Classify category and extract entity keywords for a memory fact."""
    client = _get_client()
    try:
        completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": MEMORY_TAGGER_PROMPT},
                {"role": "user", "content": f"Fact: {fact}"},
            ],
            model=_get_model(),
            max_tokens=150,
            temperature=0.1,
        )
        raw = completion.choices[0].message.content or "{}"
        cleaned = raw.strip()
        cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL).strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        data = json.loads(cleaned.strip())
        cat = data.get("category", "general").lower()
        if cat not in {"academics", "credentials", "people", "personal", "projects", "general"}:
            cat = "general"
        entities = data.get("entities", [])
        return cat, entities
    except Exception as e:
        logger.warning("Memory tagging fallback: %s", e)
        return "general", []


@rate_limited()
def synthesize_memory_answer(question: str, memories: List[Dict[str, Any]]) -> str:
    """Synthesize a direct, natural answer using stored memory facts."""
    if not memories:
        return "I don't have that stored in my memory yet. Tell me *remember [fact]* and I'll keep track of it!"

    client = _get_client()
    memories_text = "\n".join([f"- [{m.get('category', 'general')}]: {m.get('fact_text')}" for m in memories])

    user_prompt = f"Stored Memories:\n{memories_text}\n\nUser Question: {question}"

    completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": MEMORY_SYNTHESIS_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=_get_model(),
        max_tokens=300,
        temperature=0.2,
    )

    return (completion.choices[0].message.content or "").strip()


def _get_owner_info() -> tuple[str, str, str]:
    """Retrieve configurable owner persona settings."""
    name = os.getenv("OWNER_NAME", "Yusuf").strip()
    bio = os.getenv("OWNER_BIO", "Computer Science student at PES University").strip()
    tone = os.getenv("OWNER_TONE", "casual, friendly, concise, authentic WhatsApp texting style").strip()
    return name, bio, tone


@rate_limited()
def generate_autopilot_persona_reply(
    incoming_message: str,
    sender_name: str = "Friend",
    recent_history: Optional[List[Dict[str, Any]]] = None,
    personal_memories: Optional[List[Dict[str, Any]]] = None,
    custom_instruction: Optional[str] = None,
) -> str:
    """Generate an authentic WhatsApp reply acting dynamically as the repository owner."""
    client = _get_client()
    model = _get_model()
    owner_name, owner_bio, owner_tone = _get_owner_info()

    bio_str = f" ({owner_bio})" if owner_bio else ""
    system_prompt = f"""\
You are an autonomous AI clone acting and speaking DIRECTLY as {owner_name}{bio_str}.
You are responding to an incoming WhatsApp message from a friend, classmate, or colleague.

YOUR PERSONA & SPEAKING STYLE:
• You ARE {owner_name}. Never refer to yourself in the third person or say "as an AI assistant" or "ARGUS".
• Tone: {owner_tone}.
• Style: Short, conversational, friendly. Use natural phrasing (e.g. "hey", "yeah", "sounds good", "give me a sec", "got it"). Avoid overly formal corporate speak or robotic greetings.
• Ground-truth Knowledge: Use the provided Second Brain facts and personal schedule to give accurate answers. Never make up commitments or facts.
• Context Instruction: If a custom situation is provided (e.g. "studying for exams", "busy in meeting"), naturally reflect that.

RULES:
1. Return ONLY the exact text message to be sent via WhatsApp.
2. Do not include markdown code fences, prefixes like "{owner_name}:", or quotes around the reply.
3. Keep it brief (1-3 sentences max, like a real WhatsApp text).
"""

    context_parts = []
    if sender_name:
        context_parts.append(f"Sender Name: {sender_name}")

    if custom_instruction:
        context_parts.append(f"Your Current Situation/Note: {custom_instruction}")

    if personal_memories:
        facts = "\n".join(f"- {m.get('fact_text')}" for m in personal_memories)
        context_parts.append(f"Your Second Brain Context / Facts:\n{facts}")

    if recent_history:
        history_lines = []
        for msg in recent_history[-6:]:
            sender_label = f"You ({owner_name})" if msg.get("is_from_me") else sender_name
            history_lines.append(f"{sender_label}: {msg.get('text') or msg.get('message_text')}")
        context_parts.append("Recent Chat History:\n" + "\n".join(history_lines))

    context_parts.append(f"Latest Incoming Message from {sender_name}:\n{incoming_message}")
    user_prompt = "\n\n".join(context_parts)

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=200,
        )
        raw = response.choices[0].message.content or ""
        cleaned = raw.strip()
        cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL).strip()
        if cleaned.startswith('"') and cleaned.endswith('"'):
            cleaned = cleaned[1:-1].strip()
        return cleaned
    except Exception as e:
        logger.error(f"Failed to generate autopilot reply: {e}", exc_info=True)
        if custom_instruction:
            return f"Hey, I'm {custom_instruction.lower()} right now! Will get back to you shortly."
        return "Hey! Tied up with something right now, will text you back in a bit."

