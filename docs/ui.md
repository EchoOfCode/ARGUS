# ARGUS Web Control Plane — UI & Operator Guide

The ARGUS Web Control Plane (`apps/web`) is a modern single-owner cockpit built with **Next.js 14+ (App Router)**, **TypeScript**, and **Tailwind CSS**, communicating with the FastAPI AI Brain via the standardized **AG-UI Server-Sent Events (SSE)** protocol and authenticated REST endpoints.

---

## 1. Authentication & Security Gate (`/login`)

Every page and API route is protected by Edge-native middleware and constant-time token verification.

```
┌────────────────────────────────────────────────────────┐
│                   [🛡️ ARGUS SHIELD]                    │
│                  ARGUS Control Plane                   │
│         Single-Owner AI Chief of Staff Firewall        │
├────────────────────────────────────────────────────────┤
│ OWNER ACCESS KEY                                       │
│ [ •••••••••••••••••••••••••••••••••••••••• ] [👁️]     │
│ Configured in your backend .env file                   │
│                                                        │
│ [           Access Control Plane  →         ]          │
├────────────────────────────────────────────────────────┤
│ 🔒 Constant-time HMAC verification & IP rate-limiting  │
└────────────────────────────────────────────────────────┘
```

- **Credential:** Set via `ARGUS_WEB_ACCESS_KEY` (or `ARGUS_SECRET` fallback).
- **Session Cookie:** `argus_session` (httpOnly, SameSite=Lax, Secure in production, 7-day expiration).
- **Rate Limiting:** Max 5 failed attempts per 5-minute window per IP. Excess attempts are locked out with HTTP 429.

---

## 2. Executive Chat (`/chat`)

Real-time streaming agent loop using the native AG-UI Server-Sent Events (SSE) protocol.

```
┌────────────────────────────────────────────────────────────────────────┐
│ [🤖] ARGUS Executive Interface                     [■ Stop Generating] │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│ [👤 User]                                                              │
│ Schedule a sync with Dr. Evelyn tomorrow at 3pm and check who owes me. │
│                                                                        │
│ [🤖 ARGUS]                                                             │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ 🔧 tool: search_contacts   {"query": "Evelyn"}          ✓ executed │ │
│ │ 🔧 tool: get_financial_summary                          ✓ executed │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ I found Dr. Evelyn Reed (+91 98765 43210). A meeting proposal has been │
│ drafted for tomorrow at 3:00 PM.                                       │
│                                                                        │
│ Regarding debts: Bob owes you ₹1,200 for the dinner split, while you   │
│ owe Charlie ₹400 for books (Net balance: +₹800).                       │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│ [ 📅 Today's reminders ] [ 💰 Debt summary ] [ 📥 Approvals inbox ]   │
│ [ Type instruction for ARGUS...                                ] [➤]   │
└────────────────────────────────────────────────────────────────────────┘
```

- **Protocol Events:** Emits `RUN_STARTED`, `TEXT_MESSAGE_CHUNK`, `TOOL_CALL_START`, `TOOL_CALL_RESULT`, `RUN_FINISHED`, and `RUN_ERROR`.
- **Interactivity:** Tool invocations render live status badges and parameter snippets.
- **Cancellation:** The "Stop Generating" button sends an abort signal to terminate the streaming generator.

---

## 3. Outbound Approvals Inbox (`/approvals`)

Human-in-the-loop review queue for assistant-generated messages (ADR 0003 & ADR 0004).

```
┌────────────────────────────────────────────────────────────────────────┐
│ 📥 Outbound Approvals Inbox              [Pending Review] [Audit (All)]│
├────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ [👤] Dr. Evelyn Reed (+91 98765 43210)         [PENDING] [AUTOPILOT]│ │
│ │ 🕒 Created 2m ago • SHA-256: 7f8b9a1...                            │ │
│ │                                                                    │ │
│ │ "Confirmed for the 3pm sync tomorrow at the café."                 │ │
│ │                                                                    │ │
│ │                     [✕ Decline] [✏️ Edit Draft] [✓ Approve Send]   │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

- **Approve:** Updates status to `approved`, dispatches message, and records decision in the append-only `outbound_audit_log`.
- **Edit & Approve:** Opens an inline editor allowing the owner to modify text; recalculates SHA-256 hash and records `edited_approved` in audit log.
- **Decline:** Cancels the draft and logs `declined` verdict.

---

## 4. Contacts & Autonomy (`/contacts`)

Granular policy control over assistant autonomy levels.

| Tier | Policy Name | Behavior |
| :--- | :--- | :--- |
| **Tier 0** | **Draft Only** | Default safe mode. Never sends directly; drafts into Approvals Inbox. |
| **Tier 1** | **Supervised** | Issues 15-minute approval token; requires owner confirmation before sending. |
| **Tier 2** | **Autonomous** | High trust; sends immediately with an 8-second undo grace period. |

### Global Emergency Kill Switch:
A single toggle button across the entire UI. When activated:
- Overrides all Tier 1 and Tier 2 rules.
- Instantly quarantines all outgoing activity to Tier 0 (Draft Only).
- Logs `kill_switch_engaged` in the audit trail.

---

## 5. Second Brain Memory (`/memory`)

Personal knowledge repository for facts, user preferences, and relationship context.

### 🛡️ Zero-Credential Security Guarantee
- Credentials, passwords, API tokens, and vault items are **strictly excluded** from this interface.
- Raw values in the encrypted Fernet vault (`vault.py`) cannot be queried or rendered by the web client.
- The UI strictly filters out categories (`credentials`, `password`, `secret`, `keys`, `vault`).

---

## 6. Financial Ledger (`/ledger`)

Expense aggregation and debt reconciliation.

- **KPI Cards:** Personal Expenses Total, Owed To Me, I Owe Others, and Net Debt Balance.
- **Who Owes Whom:** Card-based breakdown of debtors (receivables) and creditors (payables).
- **Category Distribution:** Visual progress bars displaying spending breakdown.
- **Recent Transactions:** Log of last 50 transactions with timestamp and currency.

---

## 7. System Status (`/status`)

Diagnostics and remote linking.

- **WhatsApp Connection:** Live state of `@whiskeysockets/baileys` connection and last message received timestamp.
- **QR Code Pairing:** Visual ASCII/monospace block rendering of pairing QR code when unlinked.
- **Brain Health:** Active LLM provider (Groq / Ollama / OpenRouter), active model, and SQLite single-writer WAL status.
- **Inventory Metrics:** Live counts for pending approvals, contacts, memory facts, and expenses.

---

## 8. Deployment & Remote Access Packaging

The Web Control Plane is packaged into a multi-stage standalone Next.js Docker image (`apps/web/Dockerfile`) and reverse-proxied via **Caddy**:

```yaml
# docker-compose.yml excerpt
caddy-proxy:
  image: caddy:2-alpine
  ports:
    - "127.0.0.1:3000:3000"  # Bound strictly to localhost
```

### Accessing Remotely:
1. **Via Tailscale (Recommended):**
   ```bash
   tailscale serve http://127.0.0.1:3000
   ```
   Access securely from any device on your Tailnet at `https://<node-name>.<tailnet>.ts.net`.
2. **Via SSH Tunnel:**
   ```bash
   ssh -N -L 3000:127.0.0.1:3000 user@your-server-ip
   ```
   Then open `http://localhost:3000` in your local browser.
