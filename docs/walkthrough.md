# ARGUS v2 — Build Walkthrough

## What's Built

Phase 1 of ARGUS v2 is fully scaffolded. Both the **WhatsApp Bridge** and **AI Brain** are complete and compiling. Here's what was created:

---

### WhatsApp Bridge (`bridge/`)
**7 TypeScript source files** — compiles with 0 errors

| File | Role |
|---|---|
| [index.ts](file:///e:/ARGUS/bridge/src/index.ts) | Entry point — Baileys socket, QR auth, reconnection, message event listener |
| [config.ts](file:///e:/ARGUS/bridge/src/config.ts) | Loads `.env` config (JID, brain URL, secrets, rate limits) |
| [db.ts](file:///e:/ARGUS/bridge/src/db.ts) | SQLite database — tables for reminders, todos, message_log, pending_events |
| [messageHandler.ts](file:///e:/ARGUS/bridge/src/messageHandler.ts) | Core router — self-chat commands, confirmation replies, passive event detection |
| [selfChat.ts](file:///e:/ARGUS/bridge/src/selfChat.ts) | Command mode — help, todos, done/delete, AI-routed intents |
| [replySender.ts](file:///e:/ARGUS/bridge/src/replySender.ts) | Rate-limited WhatsApp sender with formatted templates |
| [brainClient.ts](file:///e:/ARGUS/bridge/src/brainClient.ts) | HTTP client for calling the AI Brain with auth headers |
| [reminderWorker.ts](file:///e:/ARGUS/bridge/src/reminderWorker.ts) | Cron job (every 60s) — sends due reminders via WhatsApp |

---

### AI Brain Backend (`backend/`)
**5 Python source files** — all imports verified

| File | Role |
|---|---|
| [main.py](file:///e:/ARGUS/backend/main.py) | FastAPI server — 5 AI endpoints + health check |
| [models.py](file:///e:/ARGUS/backend/models.py) | Pydantic models for all request/response schemas |
| [groq_client.py](file:///e:/ARGUS/backend/groq_client.py) | Groq SDK calls — event extraction, summarization, Q&A |
| [intent_classifier.py](file:///e:/ARGUS/backend/intent_classifier.py) | Message intent detection (event/reminder/todo/question/summarize/none) |
| [reminder_parser.py](file:///e:/ARGUS/backend/reminder_parser.py) | Natural language → datetime parsing for reminders |

**Endpoints:**
- `POST /process-message` — Intent classification (with auto event extraction)
- `POST /extract-event` — Calendar event extraction
- `POST /parse-reminder` — Reminder NLP parsing
- `POST /summarize` — Conversation summarization
- `POST /ask` — General Q&A
- `GET /health` — Health check

---

### Android App (`android/`)
Project scaffolded with correct dependencies (Room, Retrofit, WorkManager, Compose). Package updated to `com.yusuf.argus`, manifest configured with NotificationListenerService and permissions. Full implementation deferred to Phase 3.

---

## Verification Results

| Check | Status |
|---|---|
| Bridge TypeScript compilation (`tsc --noEmit`) | ✅ 0 errors |
| Bridge npm dependencies installed | ✅ 139 packages |
| Backend Python imports | ✅ All modules load |
| Backend pip dependencies installed | ✅ fastapi, groq, etc. |

---

## To Start Using ARGUS

### Step 1: Configure secrets
```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env — set GROQ_API_KEY and ARGUS_SECRET

# Bridge
cp bridge/.env.example bridge/.env
# Edit bridge/.env — set MY_JID, ARGUS_SECRET (same value), AI_BRAIN_URL
```

### Step 2: Start the AI Brain
```bash
cd backend
uvicorn main:app --reload
```

### Step 3: Start the WhatsApp Bridge
```bash
cd bridge
npm run dev
```
Scan the QR code with WhatsApp → Linked Devices → Link a Device

### Step 4: Test it
- Send yourself a message: `help` → see the command list
- Send: `remind me to call mom at 5pm` → reminder set
- Send: `meeting with Rahul tomorrow at 3pm` → event detected, confirm with `yes`
- Send: `what's the capital of France?` → AI answer
