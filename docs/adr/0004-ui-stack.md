# ADR 0004: Web UI Stack & Streaming Agent Protocol (AG-UI / SSE)

## Status
**Proposed** (Awaiting owner approval before implementation)

---

## Context

1. ARGUS currently features a legacy monolithic dashboard mounted on FastAPI at `/dashboard` (`apps/brain/dashboard.py`).
2. The legacy dashboard is a static server-rendered HTML template with basic JavaScript:
   - It lacks streaming responses and tool-call visualization.
   - It has no real-time human-in-the-loop approvals workflow (Phase 2 policy engine drafts).
   - It has no contact autonomy management (Tiers 0/1/2, global kill switch).
   - It provides no QR code viewing for remote headless WhatsApp linking.
   - It has no CSRF protection, secure cookie auth, or rate-limited login.
3. Phase 3 requires replacing this dashboard with a modern single-owner web app (`apps/web`) built with:
   - **Next.js (App Router)** + **TypeScript** + **Tailwind CSS** + **shadcn/ui**.
   - Dark mode, responsive layout, accessible primitives (keyboard navigation, labels, contrast).
   - Single-owner authentication: access key from env, `httpOnly` secure session cookie, CSRF protection, and rate-limited login.
   - Seven distinct screens: **Chat**, **Approvals Inbox**, **Contacts & Autonomy**, **Memory**, **Ledger**, **Activity Log**, and **Status**.
4. We researched:
   - The **AG-UI (Agent-User Interaction)** protocol developed by CopilotKit.
   - The CopilotKit reference repositories: **OpenMuse** (personal agent with browser and integrations) and **OpenDots** (human-in-the-loop coworker agents with computer environments).

---

## What We Verified vs What We Could Not Verify

### What We Verified
1. **AG-UI Protocol Mechanics:**
   - AG-UI is an open, transport-agnostic, event-driven wire protocol standardizing communication between agent backends and user interfaces.
   - Its primary and official production transport is **Server-Sent Events (SSE)** (`text/event-stream`).
   - The protocol defines standardized event shapes:
     - Lifecycle: `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`.
     - Streaming text: `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CHUNK`, `TEXT_MESSAGE_END`.
     - Tool calls & Generative UI: `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT`.
     - State synchronization: `STATE_SNAPSHOT`, `STATE_DELTA`.
2. **OpenMuse & OpenDots Reference Patterns:**
   - Both templates use Next.js frontend clients consuming SSE event streams from an agent runtime.
   - Both templates implement human-in-the-loop approval cards where agents pause execution until the owner accepts, edits, or declines proposed actions.
3. **FastAPI Capabilities:**
   - FastAPI's native `StreamingResponse(stream_generator(), media_type="text/event-stream")` can stream AG-UI-compliant JSON events asynchronously with zero third-party framework overhead, full backpressure handling, and native cancelation detection.

### What We Could Not Verify
1. **CopilotKit Python SDK Flexibility:**
   - The official `copilotkit` Python PyPI package currently emphasizes opinionated adapters for `LangGraph` (`LangGraphAgent`) and `Agno` (`AGUIApp`). It does not provide first-class native support for lightweight custom ReAct agent loops without pulling in large external graph dependencies.
   - **Decision:** Rather than forcing unnecessary heavy LangGraph dependencies into ARGUS's lean FastAPI backend, the FastAPI Brain will natively stream AG-UI standard event shapes via Server-Sent Events (SSE).

---

## Decision

### 1. Backend Event Streaming: FastAPI Native SSE with AG-UI Event Shapes
FastAPI will expose an authenticated streaming endpoint:
```
POST /api/chat/stream
Headers: Authorization: Bearer <session_token> (or Cookie: argus_session=...)
Content-Type: application/json
Accept: text/event-stream
```

The endpoint emits standard AG-UI events as SSE frames (`data: JSON\n\n`):
```json
data: {"type": "RUN_STARTED", "run_id": "run_123", "timestamp": "2026-10-11T12:00:00Z"}

data: {"type": "TOOL_CALL_START", "tool_call_id": "call_abc", "tool_name": "get_agenda"}

data: {"type": "TOOL_CALL_RESULT", "tool_call_id": "call_abc", "result": [{"title": "Team Sync", "time": "15:00"}]}

data: {"type": "TEXT_MESSAGE_START", "message_id": "msg_001", "role": "assistant"}

data: {"type": "TEXT_MESSAGE_CHUNK", "message_id": "msg_001", "delta": "You have Team Sync at 3:00 PM today."}

data: {"type": "TEXT_MESSAGE_END", "message_id": "msg_001"}

data: {"type": "RUN_FINISHED", "run_id": "run_123"}
```

If the client cancels or disconnects mid-stream (e.g. user clicks Stop in UI), FastAPI catches `asyncio.CancelledError` and immediately stops model generation and tool execution.

### 2. Frontend Application Scaffold (`apps/web`)
- **Framework:** Next.js 14+ (App Router) with TypeScript.
- **Styling & Design System:** Tailwind CSS with modern dark mode default, tailored color tokens (HSL palette with sleek obsidian darks and subtle borders), Inter/Outfit typography, glassmorphism headers, and smooth micro-animations.
- **Component Primitives:** Radix UI / shadcn/ui primitives for dialogs, dropdowns, tabs, alerts, tooltips, and badges with full keyboard accessibility.

### 3. Authentication & Security Model
- **Single Owner Auth:**
  - Login requires `ARGUS_WEB_ACCESS_KEY` configured in `.env`.
  - On successful password verification, server sets an `httpOnly`, `SameSite=Lax`, `Secure` (in production) cookie (`argus_session`) containing an HMAC-SHA256 signed JWT/token with 24-hour expiration.
  - Login attempts are rate-limited (max 5 failed attempts per 5 minutes per IP).
  - Middleware in Next.js protects all pages (`/`, `/chat`, `/approvals`, `/contacts`, `/memory`, `/ledger`, `/activity`, `/status`) and redirects unauthenticated users to `/login`.
  - Zero secrets in client-side bundles (no API keys or HMAC secrets exposed to browser).
  - All API data fetching routes through authenticated Next.js server actions or proxy routes to FastAPI.

### 4. Screen Implementations

| Screen | Route | Key Features |
| :--- | :--- | :--- |
| **Chat** | `/` or `/chat` | Real-time AG-UI SSE streaming, tool-call visualization cards (contacts, calendar, todos, email search), stop/cancel button, quick prompt suggestions. |
| **Approvals Inbox** | `/approvals` | Pending outbound messages from Phase 2 Outbound Policy Engine (`pending_approvals`). Cards display Target Contact, Tier, Original Draft, and 3 actions: **Approve** (immediate send), **Edit & Approve** (edit text in modal then send), **Decline** (discard). Every action records to `outbound_audit_log`. |
| **Contacts & Autonomy** | `/contacts` | Contact directory table with autonomy tier selectors (Tier 0: Draft Only, Tier 1: Supervised Approval, Tier 2: Autonomous with undo window). Global Emergency Kill Switch (`autopilot off all`) prominently accessible in navbar and page header. |
| **Memory** | `/memory` | Second Brain fact browser. Category filters, semantic search, add memory modal, and delete fact. **Strict Zero-Leakage Guarantee:** `credentials` category is excluded and never rendered. |
| **Ledger** | `/ledger` | Visual financial overview: Total Expenses, Recent Transactions, Debts Owed to Me, and Debts I Owe. Quick actions to log an expense, split a bill, or settle a debt. |
| **Activity Log** | `/activity` | Tamper-proof audit trail of all outbound messages, policy verdicts (approved, rejected, draft_only), and auto-pilot reply activity. |
| **Status** | `/status` | Real-time system health cards: WhatsApp connection state, QR code display for initial or re-linking, Brain health (`/health`), and active LLM Provider (Groq / Ollama / Mock). |

### 5. Backend Endpoints for Web UI (`apps/brain/api_ui.py`)
All UI backend endpoints will be mounted under `/api/ui` on the FastAPI Brain and protected by owner session token validation:
- `POST /api/ui/auth/login` — Login with access key.
- `POST /api/ui/auth/logout` — Clear session cookie.
- `GET /api/ui/auth/me` — Verify session status.
- `POST /api/ui/chat/stream` — Streaming AG-UI agent turn.
- `GET /api/ui/approvals/pending` — List pending drafts.
- `POST /api/ui/approvals/{id}/action` — Approve, edit, or decline draft.
- `GET /api/ui/contacts` — List contacts with autonomy tiers.
- `POST /api/ui/contacts/{jid}/tier` — Update autonomy tier.
- `POST /api/ui/autonomy/kill-switch` — Global kill switch toggle.
- `GET /api/ui/memories` — List safe Second Brain facts.
- `POST /api/ui/memories` — Add new memory.
- `DELETE /api/ui/memories/{id}` — Delete memory.
- `GET /api/ui/ledger` — Complete financial summary.
- `GET /api/ui/activity/audit-log` — Paginated outbound audit log.
- `GET /api/ui/status` — WhatsApp status, QR code (from bridge), brain health.

### 6. Deployment & Reverse Proxy (`deploy/`)
- Add a `web` service to `docker-compose.yml`.
- Placed behind a reverse proxy (Caddy) bound to `127.0.0.1:3000` (host-only).
- Secure remote access documented via Tailscale or Cloudflare Tunnel with Zero Trust authentication.
- Never exposed directly to public `0.0.0.0` by default.

---

## Consequences

### Positive
- **Standardized Agent Streaming:** AG-UI SSE protocol decouples the backend agent loop from frontend UI components with typed events.
- **Human-in-the-Loop Control:** Direct web approvals for outbound drafts with instant audit logging.
- **Zero Secret Leakage:** No credentials rendered in memory screens; all secrets stay on server.
- **Fail-Safe Security:** Every route requires authentication; rate-limited brute-force protection.
- **Accessible & Aesthetic:** Professional, responsive dark-mode UI with keyboard navigation and Radix UI primitives.

### Negative / Trade-offs
- Adding `apps/web` introduces a Next.js service to the repository build and deployment pipeline.
- Requires building and maintaining mock SSE test endpoints for Playwright tests.
