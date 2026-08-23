import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI
from models import ExtractResponse
from rate_limiter import rate_limited

logger = logging.getLogger("argus.llm")

# ─── Universal LLM Provider Configuration ───────────────────────

def _get_provider_config() -> Tuple[str, str, Optional[str], Dict[str, str], str]:
    """
    Resolve (provider_name, api_key, base_url, default_headers, default_model)
    based on environment variables.
    """
    provider = os.getenv("LLM_PROVIDER", "").strip().lower()

    # 1. OpenRouter
    if provider == "openrouter" or (not provider and os.getenv("OPENROUTER_API_KEY")):
        api_key = os.getenv("OPENROUTER_API_KEY") or os.getenv("LLM_API_KEY") or ""
        base_url = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
        headers = {
            "HTTP-Referer": "https://get-argus.vercel.app",
            "X-Title": "ARGUS AI Executive Assistant",
        }
        model = (
            os.getenv("OPENROUTER_MODEL")
            or os.getenv("LLM_MODEL")
            or "meta-llama/llama-3.3-70b-instruct"
        )
        return "openrouter", api_key, base_url, headers, model

    # 2. OpenAI Direct
    if provider == "openai" or (not provider and os.getenv("OPENAI_API_KEY")):
        api_key = os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY") or ""
        base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
        model = os.getenv("OPENAI_MODEL") or os.getenv("LLM_MODEL") or "gpt-4o-mini"
        return "openai", api_key, base_url, {}, model

    # 3. Ollama / Local LLM
    if provider in {"ollama", "local"}:
        base_url = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
        api_key = os.getenv("LLM_API_KEY", "ollama")
        model = os.getenv("LLM_MODEL", "llama3.3")
        return "ollama", api_key, base_url, {}, model

    # 4. Custom Generic OpenAI-Compatible (Together, DeepSeek, Mistral, vLLM, LM Studio)
    if provider == "custom" or (not provider and os.getenv("LLM_BASE_URL")):
        api_key = os.getenv("LLM_API_KEY") or os.getenv("CUSTOM_API_KEY") or "dummy-key"
        base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
        model = os.getenv("LLM_MODEL") or "gpt-4o-mini"
        return "custom", api_key, base_url, {}, model

    # 5. Default / Groq
    api_key = os.getenv("GROQ_API_KEY") or os.getenv("LLM_API_KEY") or ""
    base_url = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
    model = (
        os.getenv("GROQ_MODEL")
        or os.getenv("LLM_MODEL")
        or "llama-3.3-70b-versatile"
    )
    return "groq", api_key, base_url, {}, model


def _get_client() -> OpenAI:
    """Get an OpenAI-compatible client configured for the selected provider."""
    provider, api_key, base_url, headers, _ = _get_provider_config()

    if not api_key and provider != "ollama":
        raise RuntimeError(
            f"No API key configured for provider '{provider}'. "
            "Please set OPENROUTER_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, or LLM_API_KEY in backend/.env"
        )

    return OpenAI(
        api_key=api_key or "dummy",
        base_url=base_url,
        default_headers=headers if headers else None,
    )


def _get_model() -> str:
    """Get configured model for the active provider."""
    _, _, _, _, model = _get_provider_config()
    return model


# ─── System Prompts ─────────────────────────────────────────────

EVENT_EXTRACTION_PROMPT = """\
You are a structured-data extraction assistant for ARGUS. Your ONLY job is to determine \
whether a message describes one or more calendar events (meeting, call, \
appointment, webinar, session, etc.) and, if so, extract the event details.

RULES:
1. Return ONLY valid JSON — no prose, no markdown code fences, no explanation.
2. The JSON must match this exact schema:
   {
     "is_event": bool,
     "title": string or null,
     "date": "YYYY-MM-DD" or null,
     "time": "HH:MM" (24-hour) or null,
     "confidence": float 0.0-1.0,
     "raw_text": string,
     "events": [
       {
         "title": string,
         "date": "YYYY-MM-DD",
         "time": "HH:MM" or null
       }
     ]
   }
3. If there is 1 event, include it both at the root level ("title", "date", "time") and in the "events" array.
4. If there are multiple events in the message (e.g. "meeting at 7pm with sih and at 9pm with nothing but team"), include each event as an object in the "events" array, and put the first event in the root level fields.
5. Use the provided reference_timestamp as "now" to resolve relative dates \
   (e.g., "today", "tomorrow", "next tuesday", "this friday").
6. Set is_event to false (with other fields null except raw_text and confidence=0.0) \
   when the text is ambiguous or clearly not a scheduling message.
7. Never fabricate a date or time that isn't reasonably inferable from the text.
8. For "title", infer something concise and human-useful like "Meeting with SIH", \
   "Meeting with Nothing But. Team", "Dentist Appointment".
9. If a time is mentioned, always convert to 24-hour HH:MM format (e.g. 7 pm -> 19:00, 9 pm -> 21:00).
10. If no specific time is mentioned but there IS an event, set time to null.
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

def _get_owner_info() -> tuple[str, str, str]:
    """Retrieve configurable owner persona settings dynamically from environment variables."""
    name = os.getenv("OWNER_NAME", "").strip() or "the User"
    bio = os.getenv("OWNER_BIO", "").strip()
    tone = os.getenv("OWNER_TONE", "").strip() or "casual, friendly, concise, authentic WhatsApp texting style"
    return name, bio, tone


def _get_qa_prompt() -> str:
    """Generate dynamic system prompt for ARGUS based on repository owner config."""
    owner_name, owner_bio, _ = _get_owner_info()
    bio_desc = f" ({owner_bio})" if owner_bio else ""
    return f"""\
You are ARGUS (Autonomous Real-time General Utility System), the dedicated personal AI executive assistant and Second Brain for {owner_name}{bio_desc}, running directly on their local machine.

IDENTITY & MISSION:
• Role: You are {owner_name}'s personal cognitive operating system — seamlessly orchestrating WhatsApp communications, inbox triage, task management, calendar scheduling, web intelligence, and long-term memory.
• Personality: Sharp, loyal, ultra-efficient, highly organized, and proactive with a polished executive demeanor.

CAPABILITIES:
• Direct local integration with WhatsApp (Baileys bridge), IMAP Gmail inbox, SQLite knowledge memory graph, Google Calendar sync, and real-time DuckDuckGo web search.

RULES:
1. When asked who you are or who made you, state proudly and clearly that you are ARGUS, the personal AI executive assistant and cognitive OS for {owner_name}.
2. NEVER claim you cannot access WhatsApp, group chats, or emails. You ARE ARGUS and you HAVE direct access to local data.
3. If the user asks to summarize a chat or group, tell them: "I can summarize any group or chat! Type 'catchup [group name]' or 'summarize group'."
4. If the user asks for emails, tell them: "Type 'emails' to view your unread inbox, or 'summarize email #1' for a breakdown."
5. Keep answers direct, sharp, and concise (1-3 sentences for simple questions).
6. Return clean plain text formatted cleanly for WhatsApp without code blocks.
7. NEVER use robotic, generic chatbot pleasantries like "How can I help you today?" or "How can I assist you?". You are an elite AI Chief of Staff talking directly to your owner. If given punctuation or brief greetings like "?" or "yo", reply crisply (e.g. "Online and standing by. What's on your mind?").
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


def _clean_json_response(raw: str) -> str:
    """Strip reasoning/think tags and markdown fences from LLM response if present."""
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
        max_tokens=1024,
        temperature=0.1,
    )

    raw = completion.choices[0].message.content or "{}"
    try:
        parsed = json.loads(_clean_json_response(raw))
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Groq event response: %s", raw)
        parsed = {"is_event": False}

    if not isinstance(parsed, dict):
        parsed = {"is_event": False}

    if "is_event" not in parsed:
        parsed["is_event"] = bool(parsed.get("title") or parsed.get("date") or parsed.get("time"))

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
            {"role": "system", "content": _get_qa_prompt()},
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
            max_tokens=800,
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


@rate_limited()
def generate_autopilot_persona_reply(
    incoming_message: str,
    sender_name: str = "Friend",
    chat_name: Optional[str] = None,
    is_group: bool = False,
    recent_history: Optional[List[Dict[str, Any]]] = None,
    personal_memories: Optional[List[Dict[str, Any]]] = None,
    custom_instruction: Optional[str] = None,
    current_time_str: Optional[str] = None,
    user_style_samples: Optional[List[str]] = None,
) -> str:
    """Generate an authentic, grounded, and hyper-realistic WhatsApp reply acting as the owner."""
    client = _get_client()
    model = _get_model()
    owner_name, owner_bio, owner_tone = _get_owner_info()

    bio_str = f" ({owner_bio})" if owner_bio else ""
    
    system_prompt = f"""\
You are an autonomous AI clone acting and speaking DIRECTLY as {owner_name}{bio_str}.
You are responding to an incoming WhatsApp message from a friend, classmate, or colleague.

YOUR PERSONA & SPEAKING STYLE:
• You ARE {owner_name}. NEVER refer to yourself in the third person or say "as an AI" or "ARGUS".
• Tone: {owner_tone}.
• Style: Short, conversational, friendly. Text like a real human on WhatsApp (e.g. "hey", "yeah", "sounds good", "give me a sec", "got it").
• Avoid robotic pleasantries: Don't say "I hope this message finds you well" or "How can I assist you today?".
• Anti-Repetition: If recent messages show you already said hello or asked what's up, do NOT repeat "Hey" or "Hi" again—jump straight to the point.

🔒 STRICT PRIVACY & ZERO-KNOWLEDGE FIREWALL:
• NEVER REVEAL YOUR DAY PLAN OR FULL SCHEDULE: If someone asks "what's your plan today?", "what are you doing today?", or "are you free?", NEVER recite your calendar agenda or specific schedule items. Give a natural, casual, evasive response: (e.g. "a bit caught up with college work and projects today, what's up?", "mostly busy with stuff today bro, what's happening?").
• NEVER REVEAL YOUR CONTACTS OR FRIENDS LIST: If someone asks "who are your friends?", "who do you talk to?", or "tell me about your circle", deflect casually without revealing names: (e.g. "just the usual college and project folks haha, why ask? 😂", "regular friends from campus").
• NEVER LEAK MEMORIES, PASSWORDS, OR SECRETS: Never disclose Second Brain notes, debts, balances, credentials, or private details to other people.
• Security & Financial Guardrail: If someone asks for OTPs, passwords, bank transfers, or PINs, deflect immediately: "can't send on text, call me later".

RULES:
1. Return ONLY the exact text message to be sent via WhatsApp.
2. Do not include quotes, prefixes like "{owner_name}:", or markdown code fences.
3. Keep it crisp (1-2 short sentences max, like a real WhatsApp text).
"""

    context_parts = []
    if current_time_str:
        context_parts.append(f"Current Date & Time: {current_time_str}")

    if is_group and chat_name:
        context_parts.append(f"Location: WhatsApp Group \"{chat_name}\"")
        context_parts.append(f"Message Sent By Group Member: {sender_name}")
    elif sender_name:
        context_parts.append(f"Sender Name: {sender_name}")

    if custom_instruction:
        context_parts.append(f"Your Current Activity / Note: {custom_instruction}")

    if user_style_samples:
        samples_text = "\n".join(f"• \"{s}\"" for s in user_style_samples[:4])
        context_parts.append(f"Examples of Your Real Texting Style:\n{samples_text}")

    if recent_history:
        history_lines = []
        for msg in recent_history[-8:]:
            sender_label = f"You ({owner_name})" if msg.get("is_from_me") else sender_name
            history_lines.append(f"{sender_label}: {msg.get('text') or msg.get('message_text')}")
        context_parts.append("Recent Chat History:\n" + "\n".join(history_lines))

    context_parts.append(f"Incoming Message to reply to from {sender_name}:\n\"{incoming_message}\"")
    user_prompt = "\n\n".join(context_parts)

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.6,
            max_tokens=800,
        )
        raw = response.choices[0].message.content or ""
        cleaned = raw.strip()
        cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL).strip()
        if cleaned.startswith('"') and cleaned.endswith('"'):
            cleaned = cleaned[1:-1].strip()
        if cleaned.startswith(f"{owner_name}:"):
            cleaned = cleaned[len(owner_name) + 1:].strip()
        return cleaned
    except Exception as e:
        logger.error(f"Failed to generate autopilot reply: {e}", exc_info=True)
        if custom_instruction:
            return f"Hey, I'm {custom_instruction.lower()} right now! Will get back to you shortly."
        return "Hey! Tied up with something right now, will text you back in a bit."


# ─── Human-in-the-Loop Meeting Proposal Negotiation ───────────

PROPOSAL_DETECTION_PROMPT = """\
You are an intelligent scheduling agent for ARGUS.
Your job is to determine whether an incoming WhatsApp message is proposing a meeting, call, \
hangout, session, coffee, or plan that requires the owner's confirmation.

RULES:
1. Return ONLY valid JSON:
   {
     "is_proposal": bool,
     "title": string or null,
     "date": "YYYY-MM-DD" or null,
     "time": "HH:MM" or null,
     "location": string or null,
     "buffer_reply": string or null,
     "confidence": float 0.0-1.0
   }
2. "buffer_reply" MUST be a short, natural WhatsApp text in the owner's casual voice telling the contact \
   that they are checking their schedule / calendar and will get back to them in a moment. \
   Examples: "give me a sec, checking my schedule and will text u back", "let me check my calendar and let u know in a bit bro".
3. Use the provided reference_timestamp to resolve relative dates like "today", "tomorrow", "this friday".
4. Set is_proposal to false for general questions, jokes, or non-scheduling chatter.
"""

@rate_limited()
def detect_meeting_proposal(
    incoming_message: str,
    sender_name: str = "Friend",
    chat_name: Optional[str] = None,
    is_group: bool = False,
    reference_timestamp: Optional[str] = None,
) -> Dict[str, Any]:
    """Detect if an incoming message is asking to meet/call and generate buffer reply."""
    client = _get_client()
    owner_name, _, owner_tone = _get_owner_info()

    user_prompt = (
        f"Owner Name: {owner_name}\n"
        f"Owner Texting Tone: {owner_tone}\n"
        f"Reference Timestamp: {reference_timestamp or ''}\n"
        f"Sender: {sender_name}\n"
        f"Chat: {chat_name or 'Direct Chat'} (is_group={is_group})\n"
        f"Message: \"{incoming_message}\""
    )

    try:
        completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": PROPOSAL_DETECTION_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            model=_get_model(),
            max_tokens=600,
            temperature=0.1,
        )
        raw = completion.choices[0].message.content or "{}"
        cleaned = _clean_json_response(raw)
        data = json.loads(cleaned)
        if not isinstance(data, dict):
            return {"is_proposal": False, "confidence": 0.0}
        return data
    except Exception as e:
        logger.error("Proposal detection failed: %s", e)
        return {"is_proposal": False, "confidence": 0.0}


@rate_limited()
def resolve_meeting_proposal(
    action: str,
    sender_name: str = "Friend",
    chat_name: Optional[str] = None,
    is_group: bool = False,
    proposed_title: str = "Meeting",
    proposed_date: Optional[str] = None,
    proposed_time: Optional[str] = None,
    proposed_location: Optional[str] = None,
    user_note: Optional[str] = None,
    counter_time: Optional[str] = None,
) -> str:
    """Generate an authentic WhatsApp reply confirming, declining, or counter-proposing a meeting."""
    client = _get_client()
    owner_name, _, owner_tone = _get_owner_info()

    system_prompt = f"""\
You are an autonomous AI clone speaking DIRECTLY as {owner_name}.
You are responding to {sender_name} regarding their meeting proposal: "{proposed_title}" ({proposed_date} at {proposed_time}, location: {proposed_location or 'TBD'}).

ACTION REQUIRED:
- If action is "accept": Confirm enthusiastically and casually in WhatsApp style (e.g. "yeah 4pm works bro, see u at Cubbon Park!", "sounds good, let's do it!").
- If action is "decline": Politely decline with casual tone (e.g. "ah can't make it then bro, tied up with something", or using user note if given: "{user_note}").
- If action is "counter": Propose the new time "{counter_time}" naturally (e.g. "4pm is a bit tight, can we do {counter_time} instead?").

RULES:
1. Tone: {owner_tone}.
2. Keep it crisp (1 short WhatsApp sentence).
3. Return ONLY the message text to be sent. No quotes, no markdown fences.
"""

    user_prompt = (
        f"Action: {action}\n"
        f"Proposed: {proposed_title} on {proposed_date} at {proposed_time}\n"
        f"Location: {proposed_location}\n"
        f"Counter Time: {counter_time}\n"
        f"User Note: {user_note}"
    )

    try:
        response = client.chat.completions.create(
            model=_get_model(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.5,
            max_tokens=300,
        )
        reply = (response.choices[0].message.content or "").strip()
        cleaned = re.sub(r"<think>.*?</think>", "", reply, flags=re.DOTALL).strip()
        if cleaned.startswith('"') and cleaned.endswith('"'):
            cleaned = cleaned[1:-1].strip()
        return cleaned
    except Exception as e:
        logger.error("Failed to resolve meeting proposal: %s", e)
        if action == "accept":
            return f"Yeah sounds good, let's meet then!"
        elif action == "counter" and counter_time:
            return f"Can we do {counter_time} instead?"
        return "Hey, won't be able to make it then!"


# ─── Commitment & Promise Detection ─────────────────────────────

COMMITMENT_PROMPT = """\
You are a commitment & promise extractor for ARGUS Second Brain.
Determine if the message contains a promise or commitment (e.g., "I will send the code tomorrow", \
"will submit PPT by Sunday", "I will pay you back", "remind me to share the doc").

RULES:
1. Return ONLY valid JSON:
   {
     "has_commitment": bool,
     "commitments": [
       {
         "actor": "user" or "contact",
         "promise": string,
         "deadline": string or null,
         "due_date": "YYYY-MM-DD" or null,
         "confidence": float 0.0-1.0
       }
     ]
   }
2. Use reference_timestamp to resolve due_date if relative days are mentioned.
"""

@rate_limited()
def detect_commitments(
    message_text: str,
    sender_name: str = "Contact",
    is_from_me: bool = False,
    reference_timestamp: Optional[str] = None,
) -> Dict[str, Any]:
    """Detect promises and commitments made in conversation."""
    client = _get_client()

    user_prompt = (
        f"Sender: {sender_name} (is_from_me={is_from_me})\n"
        f"Reference Timestamp: {reference_timestamp or ''}\n"
        f"Message: \"{message_text}\""
    )

    try:
        completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": COMMITMENT_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            model=_get_model(),
            max_tokens=500,
            temperature=0.1,
        )
        raw = completion.choices[0].message.content or "{}"
        cleaned = _clean_json_response(raw)
        data = json.loads(cleaned)
        if not isinstance(data, dict):
            return {"has_commitment": False, "commitments": []}
        return data
    except Exception as e:
        logger.error("Commitment detection error: %s", e)
        return {"has_commitment": False, "commitments": []}


