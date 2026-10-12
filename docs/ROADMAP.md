# ARGUS Development Roadmap & Milestones

> Phased architectural roadmap documenting completed phases and future engineering goals.

---

## ✅ Completed Phases

### Phase 1 — Foundation, Gateway & Ingestion
- [x] Node.js 20+ WhatsApp bridge daemon using `@whiskeysockets/baileys` Multi-Device WebSockets.
- [x] QR code terminal pairing and persistent encrypted session management (`auth_info/`).
- [x] Inter-service HMAC-SHA256 request signing (`X-Argus-Signature` & `X-Argus-Timestamp`).
- [x] SQLite Write-Ahead Logging (WAL) message journaling and chat directory indexing.
- [x] Dedicated private command channel (`ARGUS` group) and self-chat routing.
- [x] Cron-based reminder worker with automated WhatsApp dispatch.

### Phase 2 — Cognitive Brain & Autonomous ReAct Engine
- [x] FastAPI ASGI backend with Pydantic v2 data contracts.
- [x] Multi-turn ReAct (Reasoning + Acting) loop in `agent_core.py`.
- [x] Native tool-calling ecosystem:
  - Task & Todo management (`create_todo`, `list_todos`, `complete_todo`, `delete_todo`).
  - Time-based reminders (`create_reminder`, `cancel_reminder`).
  - Google Calendar event link generation (`schedule_event`, `get_agenda`).
  - Financial expense and split-bill ledger (`record_expense`, `get_financial_summary`, `settle_debt`).
  - Second Brain memory vault with automatic categorization (`manage_memory`).
  - Live internet search grounding via DuckDuckGo (`web_search`).
- [x] IMAP email inbox reader with executive triage summaries.
- [x] Groq Whisper voice note transcription for incoming audio memos.
- [x] Multimodal document and syllabus analyzer for PDFs and images.

### Phase 3 — Next.js Control Plane & Outbound Policy Engine
- [x] Single-owner Web Control Plane built with **Next.js 14+ (App Router)**, **TypeScript**, and **Tailwind CSS**.
- [x] Streaming AI Chat using native **AG-UI Server-Sent Events (SSE)** with interactive tool invocation cards.
- [x] **Outbound Policy Engine (ADR 0003):** Choke point verifying every outgoing message against autonomy rules.
- [x] **3-Tier Autonomy System:** Tier 0 (Draft Only), Tier 1 (Supervised with 15-min token), Tier 2 (Autonomous with 8s delay).
- [x] **Approvals Inbox (`/approvals`):** Human-in-the-loop review queue to approve, edit, or reject outbound drafts.
- [x] **Zero-Credential Exposure Guarantee:** Fernet-encrypted vault (`argus_vault.db`) isolated from web UI and LLM queries.
- [x] Automated localhost Caddy reverse proxy at `http://127.0.0.1:3000` with Tailscale remote access support.

### Phase 4 — System 1 Engine & Multi-Model Resilience (Latest Release)
- [x] **System 1 Zero-Token Decision Engine (`system_one.py`):** Non-autoregressive fast path executing tasks, reminders, expenses, status, and acknowledgments in **< 5ms** with **0 cloud tokens**.
- [x] **Strict Offline Mode Toggle (`/offline`, `/online`, `/mode`):** Complete zero-token guard running 100% locally from SQLite; pauses cloud AI inference.
- [x] **Multi-Model LLM Router (`llm_provider.py`):**
  - Dynamic routing between Groq (low-latency dialogue) and Google Gemini (deep code, reasoning, long queries).
  - Intra-provider failover: Groq primary model (`qwen/qwen3.8-27b`) automatically falls back to secondary (`openai/gpt-oss-20b`) on rate limits.
  - Cross-provider failover: Seamless fallback between Groq and Gemini.
- [x] **Strict Group Chat Isolation:** Enforced rule prohibiting autonomous replies in WhatsApp group chats.
- [x] **Contact Substring Matching:** Resolves contact names and substring rules in policy checks.
- [x] **Bulk Emergency Killswitch:** `/autopilot off for all` instantly silences all automated replies system-wide.
- [x] Modern slash command engine (`/s`, `/status`, `/todo`, `/remind`, `/ledger`, `/mode`, `/help`).

---

## 🔮 Future Roadmap (Phase 5+)

### Phase 5 — Edge AI & Local Inference
- [ ] **Local Whisper STT:** Host `faster-whisper` or `whisper.cpp` locally on homelab GPU for zero-cloud voice transcription.
- [ ] **Local LLM Tool Calling:** Extend local Ollama support with native function-calling for 100% offline agentic ReAct loops.
- [ ] **Context Window Compression:** Automatic semantic summarization of long multi-turn conversations to reduce token consumption.

### Phase 6 — Proactive Assistant Capabilities
- [ ] **Calendar Conflict Detection:** Proactively alert when new message invites collide with existing calendar events.
- [ ] **Smart Daily Executive Briefing:** Scheduled morning WhatsApp dispatch synthesizing unread VIP emails, pending tasks, today's schedule, and weather.
- [ ] **Push Notification Bridge:** Direct push alerts to phone via Gotify / ntfy when human approval is required.
