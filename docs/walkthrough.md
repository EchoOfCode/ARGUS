# ARGUS Developer Walkthrough & Verification Guide

> Operational verification, testing workflows, and local developer guide for ARGUS.

---

## 🛠️ Repository Architecture

ARGUS is structured as a monorepo containing three core applications:

| Path | Role | Technology |
| :--- | :--- | :--- |
| [`apps/bridge`](file:///e:/ARGUS/apps/bridge) | WhatsApp Gateway & Policy Dispatcher | Node.js 20+, TypeScript 5.7+, Baileys v6.7, better-sqlite3 |
| [`apps/brain`](file:///e:/ARGUS/apps/brain) | AI Brain, System 1 Engine & ReAct Loop | Python 3.11+, FastAPI, Groq SDK, Gemini API, SQLite WAL |
| [`apps/web`](file:///e:/ARGUS/apps/web) | Single-Owner Web Control Plane | Next.js 14+ (App Router), TypeScript, Tailwind CSS, AG-UI SSE |
| [`deploy`](file:///e:/ARGUS/deploy) | Production Caddy & Docker configurations | Caddyfile, Docker Compose |

---

## 🧪 Verification & Test Suites

### 1. Brain Backend Test Suite (Python)
The backend test suite covers System 1 fast paths, offline mode, multi-model router failovers, outbound policy evaluation, and database concurrency.

```bash
cd apps/brain
pytest -v
```

**Verified Test Coverage:**
- `tests/test_system_one.py`: Validates System 1 zero-token execution, task CRUD, reminder parsing, ledger balance summaries, and online/offline toggling.
- `tests/test_llm_provider.py`: Validates router classification, Groq intra-model fallback (`openai/gpt-oss-20b`), Gemini failover, and log redaction.
- `tests/test_policy_engine.py`: Validates Tier 0, Tier 1, and Tier 2 outbound evaluations, contact name substring matching, and group chat isolation.
- `tests/test_agent_core.py`: Validates multi-turn ReAct loops and native tool execution.

### 2. Bridge Gateway Test Suite (Node.js)
```bash
cd apps/bridge
npm test
```

**Verified Test Coverage:**
- Outbound policy dispatcher timeout safety and 1-on-1 DM gating.
- Fast-path slash command parser (`/s`, `/todo`, `/remind`, `/mode`, `/autopilot`).
- HMAC-SHA256 request signature verification.

---

## 🚀 Running ARGUS Locally (Dev Mode)

### Step 1: Environment Files
Configure `.env` in each application directory:
```bash
cp apps/brain/.env.example apps/brain/.env
cp apps/bridge/.env.example apps/bridge/.env
```

Set `ARGUS_SECRET` to an identical 32-byte hexadecimal string in both `.env` files:
```bash
# Generate secret:
python -c "import secrets; print(secrets.token_hex(32))"
```

In `apps/brain/.env`:
- Provide `GROQ_API_KEY` (and optionally `GEMINI_API_KEY`).
- Set `LLM_PROVIDER=router`.

In `apps/bridge/.env`:
- Set `MY_JID` to your WhatsApp phone number (e.g. `919876543210@s.whatsapp.net`).
- Set `AI_BRAIN_URL=http://127.0.0.1:8000`.

### Step 2: Start Services
Using Makefile or scripts:
```bash
# Start all dev services
make dev

# Or launch independently:
# Terminal 1 (Brain):
cd apps/brain && uvicorn main:app --host 127.0.0.1 --port 8000

# Terminal 2 (Bridge):
cd apps/bridge && npm run dev

# Terminal 3 (Web Control Plane):
cd apps/web && npm run dev
```

---

## 📱 Testing Features Inside WhatsApp

After scanning the QR code in `apps/bridge`:

1. **System 1 Zero-Token Commands:**
   - Text: `/status` → Instant system status card (< 5ms, 0 tokens).
   - Text: `add buy milk` → Creates task `[#1]`.
   - Text: `/todos` → Lists pending tasks.
   - Text: `done #1` → Marks task completed.
   - Text: `remind me in 30 minutes to stretch` → Schedules reminder for current time + 30m.
   - Text: `spent 50 on coffee` → Logs ₹50 expense.
   - Text: `/ledger` → Displays monthly breakdown and active debts.

2. **Operating Modes:**
   - Text: `/offline` → Switches to 100% offline local-only mode (zero cloud tokens).
   - Text: `/mode` → Shows current mode status.
   - Text: `/online` → Re-enables Cloud AI reasoning alongside local fast-path.

3. **Autopilot & Outbound Policy:**
   - Text: `/autopilot on Alex` → Whitelists contact for auto-replies in 1-on-1 DMs.
   - Text: `/autopilot off for all` → Emergency bulk disable of all autopilot rules.
   - Text: `/killswitch on` → Instantly silences all outbound messages.
