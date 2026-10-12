# ARGUS Documentation & Technical Specifications

> **Autonomous Real-time General Utility System (ARGUS)**  
> *A self-hosted, local-first personal AI Chief of Staff and cognitive operating system inside WhatsApp.*

---

## 📚 Documentation Index

| Document | Purpose |
| :--- | :--- |
| [**ARCHITECTURE.md**](file:///e:/ARGUS/docs/ARCHITECTURE.md) | In-depth technical architecture, data flows, subsystem designs, SQLite concurrency, and execution diagrams. |
| [**API_SPEC.md**](file:///e:/ARGUS/docs/API_SPEC.md) | Complete REST and Server-Sent Events (SSE) API contract for the FastAPI AI Brain backend. |
| [**TECH_STACK.md**](file:///e:/ARGUS/docs/TECH_STACK.md) | Exact runtime environments, libraries, frameworks, and deployment components across the stack. |
| [**ROADMAP.md**](file:///e:/ARGUS/docs/ROADMAP.md) | Milestones, completed phases (Phases 1–4), and future technical roadmap. |
| [**SECURITY.md**](file:///e:/ARGUS/docs/SECURITY.md) | Security model, threat boundaries, network isolation, and credential handling. |
| [**SECURITY_INCIDENT_RUNBOOK.md**](file:///e:/ARGUS/docs/SECURITY_INCIDENT_RUNBOOK.md) | Operational runbook for credential rotation, breach response, and container forensics. |
| [**ui.md**](file:///e:/ARGUS/docs/ui.md) | Operator guide and interface specifications for the Next.js 14 Web Control Plane. |
| [**walkthrough.md**](file:///e:/ARGUS/docs/walkthrough.md) | Developer build verification and testing walkthrough. |
| [**adr/**](file:///e:/ARGUS/docs/adr/) | Architecture Decision Records (ADRs) covering single-writer SQLite, HMAC auth, and policy dispatching. |

---

## 🏛️ System Architecture At a Glance

ARGUS operates as a distributed, self-hosted system composed of three core services running inside Docker containers or on the local host:

```
                      ┌─────────────────────────────────────────┐
                      │          WhatsApp User Interface        │
                      │   (Self-Chat / Dedicated ARGUS Group)   │
                      └────────────────────┬────────────────────┘
                                           │  Baileys (WebSockets)
                                           ▼
                      ┌─────────────────────────────────────────┐
                      │          ARGUS WhatsApp Bridge          │
                      │       (apps/bridge: Node.js 20+)        │
                      │    Single Sender Policy Choke Point     │
                      └────────────────────┬────────────────────┘
                                           │  HTTP + HMAC Signed Body (ADR 0001)
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              ARGUS AI BRAIN (FastAPI)                                  │
│   • System 1: Zero-Token Local Decision Engine   • ReAct Agent Tool Execution          │
│   • Multi-Model Router (Groq & Gemini)           • Encrypted Fernet Vault (AES-128)    │
│   • Outbound Policy Engine (ADR 0003)            • Native AG-UI SSE Stream             │
│   • Online / Offline Mode Guard                  • Central SQLite Writer (WAL)         │
└─────────────────────────────────┬──────────────────────────────────┬───────────────────┘
                                  │ Single-Writer SQLite             │ AG-UI SSE + REST (Key Auth)
                                  ▼                                  ▼
┌──────────────────────────────────────────────────┐ ┌───────────────────────────────────┐
│              PERSISTENCE STORE                   │ │        ARGUS WEB CONTROL PLANE    │
│  • argus.db (Single DB Owner)                    │ │       (apps/web: Next.js 14+)     │
│    - outbound_audit_log (Append-Only)            │ │   • Real-Time Chat (AG-UI SSE)    │
│    - pending_approvals (Human-in-Loop)           │ │   • Approvals Inbox (Approve/Edit)│
│    - message_log / chat_directory / expenses     │ │   • Contacts & Autonomy (Tiers)   │
│  • argus_memory.db (Second Brain Facts)          │ │   • Second Brain (Zero Credentials│
│  • argus_vault.db (Encrypted Credentials)        │ │   • Ledger & System Status        │
└──────────────────────────────────────────────────┘ └─────────────────┬─────────────────┘
                                                                       │ Host Loopback Only
                                                                       ▼
                                                     ┌───────────────────────────────────┐
                                                     │    CADDY REVERSE PROXY (Localhost)│
                                                     │    http://127.0.0.1:3000          │
                                                     │ (Tailscale / VPN for Remote Access)│
                                                     └───────────────────────────────────┘
```

---

## ⚡ Core Subsystems & Innovations

### 1. System 1: Zero-Token Local Decision Engine
- **Location:** [`apps/brain/system_one.py`](file:///e:/ARGUS/apps/brain/system_one.py)
- **Philosophy:** Non-autoregressive, deterministic execution layer.
- **Latency & Cost:** Executes common owner commands in **< 5ms** with **0 cloud tokens** and no network overhead.
- **Handled Intents:**
  - **Task & Todo CRUD:** `/todo`, `add <task>`, `done #<id>`, `delete #<id>`
  - **Reminders:** Natural language time extraction (`remind me in 30 mins to...`, `remind me tomorrow morning...`), `/reminders`, cancellation.
  - **Ledger & Debts:** Expense logging (`spent 50 on coffee`), split balances, debt queries (`/ledger`, `/expenses`, `/debts`).
  - **System Telemetry:** `/status`, `/s`, `/ping`, `/health`.
  - **Context Maintenance:** `clean up`, `clear context`.
  - **Quick Greetings & Acknowledgment:** Deterministic instant replies.

### 2. Online vs. Offline Mode Guard
- **WhatsApp Commands:** `/offline`, `/offline mode`, `/online`, `/online mode`, `/mode`.
- **Zero-Token Offline Guard:** When switched to Offline Mode, the system strictly pauses all calls to external LLMs (Groq and Gemini). All tasks, reminders, expenses, status checks, and local notes run 100% locally from SQLite. Non-local queries return an informative offline banner rather than consuming cloud tokens.

### 3. Multi-Model Cloud AI Router with Auto-Failover
- **Location:** [`apps/brain/llm_provider.py`](file:///e:/ARGUS/apps/brain/llm_provider.py)
- **Routing Engine (`LLM_PROVIDER=router`):**
  - **Groq Primary:** Low-latency conversational dialogue, fast summaries, Q&A (`llama-3.3-70b-versatile` or `qwen/qwen3.8-27b`).
  - **Gemini Primary:** Complex code analysis, deep reasoning, long context queries (>100 words), and multimodal inputs (`gemini-flash-lite-latest`).
  - **Direct User Overrides:** Explicit `@gemini` or `@groq` directives.
- **Failover Mechanisms:**
  - **Intra-Provider Failover:** Automatic fallback from primary Groq model to secondary model (`openai/gpt-oss-20b`) on rate limits or errors.
  - **Cross-Provider Failover:** Automatic failover between Groq and Gemini if either provider is unavailable.

### 4. Outbound Policy Engine & Autopilot (ADR 0003)
- **Location:** [`apps/bridge/src/policy/dispatcher.ts`](file:///e:/ARGUS/apps/bridge/src/policy/dispatcher.ts) & [`apps/brain/api_bridge.py`](file:///e:/ARGUS/apps/brain/api_bridge.py)
- **Strict 1-on-1 DM Isolation:** Autopilot is strictly disabled in group chats. Auto-replies are only evaluated in direct 1-on-1 messages with registered contacts.
- **3-Tier Autonomy:**
  - **Tier 0 (Draft Only):** Generated replies are staged in the Approvals Inbox for owner confirmation.
  - **Tier 1 (Supervised):** Requires an active approval token or manual review.
  - **Tier 2 (Autonomous):** Direct reply sent after typing delay with an 8-second undo window.
- **Emergency Controls:**
  - `/autopilot off for all`: Instant emergency bulk disable across all contacts.
  - `/killswitch on` / `/killswitch off`: Instant master mute switch.
  - WhatsApp approval: `/approve <id>` and `/reject <id>`.

---

## 🛡️ Security & Privacy Guardrails

1. **HMAC-SHA256 Inter-Service Authentication:** Every request between the WhatsApp Bridge and FastAPI Brain is cryptographically signed using `ARGUS_SECRET`.
2. **Loopback & Network Isolation:** In Docker, the Brain does not publish port `8000` to the host. The Web Control Plane is bound strictly to `127.0.0.1:3000` behind Caddy.
3. **Log Redaction:** Sensitive conversation content is masked in production logs (`[CONTENT_REDACTED len=N]`) unless explicitly toggled via `ARGUS_DEBUG_LOG_CONTENT=1`.
4. **Zero-Credential UI Memory:** Credentials in `argus_vault.db` are encrypted using Fernet (AES-128) and excluded from web and LLM search surfaces.
