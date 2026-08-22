# ARGUS v2 — Setup & Run Guide

## Architecture Overview

```
┌──────────────────────────────────┐     ┌───────────────────────────┐
│  WhatsApp Bridge (Node.js)       │────▶│  AI Brain (Python/FastAPI) │
│  Reads messages, sends replies   │◀────│  Groq LLM processing      │
│  Port: N/A (WebSocket to WA)     │     │  Port: 8000               │
└──────────────────────────────────┘     └───────────────────────────┘
         │                                          │
         │              Tailscale                   │
         └──────────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │ Android App │ (fallback + calendar writes)
                    └─────────────┘
```

**You need to run 2 things on your laptop:**
1. The **AI Brain** (Python backend) — processes messages with Groq AI
2. The **WhatsApp Bridge** (Node.js) — connects to WhatsApp, routes messages

**The Android app** is optional (Phase 3) — for writing events to your phone calendar.

---

## Prerequisites

| Tool | Version | Check | Install |
|---|---|---|---|
| **Node.js** | 20+ | `node --version` | [nodejs.org](https://nodejs.org) |
| **Python** | 3.11+ | `python --version` | [python.org](https://python.org) |
| **JDK 17** | 17+ | `java --version` | Only needed for Android app |
| **Git** | Any | `git --version` | [git-scm.com](https://git-scm.com) |

---

## Step 1: Get a Groq API Key (Free)

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up / log in (Google, GitHub, or email)
3. Go to **API Keys** → **Create API Key**
4. Copy the key — it starts with `gsk_...`
5. Free tier gives ~30 requests/minute — more than enough for personal use

---

## Step 2: Generate a Shared Secret

This secret authenticates requests between the Bridge and the Brain. Generate one:

```powershell
# PowerShell (Windows)
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Minimum 0 -Maximum 256) })

# Or use Python
python -c "import secrets; print(secrets.token_hex(32))"
```

Copy the output — you'll use it in both `.env` files.

---

## Step 3: Find Your WhatsApp JID

Your JID is your phone number in WhatsApp format:
```
<country_code><phone_number>@s.whatsapp.net
```

**Examples:**
- India: `919876543210@s.whatsapp.net` (91 = country code)
- US: `14155551234@s.whatsapp.net` (1 = country code)

> [!IMPORTANT]
> No `+` sign, no spaces, no dashes. Just digits + `@s.whatsapp.net`

---

## Step 4: Set Up the AI Brain (Backend)

```powershell
# Navigate to backend
cd e:\ARGUS\backend

# Install Python dependencies (one-time)
pip install -r requirements.txt

# Create your .env file from the template
copy .env.example .env
```

Now edit [backend\.env](file:///e:/ARGUS/backend/.env.example) with your real values:

```env
GROQ_API_KEY=gsk_your_actual_key_here
GROQ_MODEL=llama-3.3-70b-versatile
ARGUS_SECRET=your_generated_secret_here
ARGUS_HOST=127.0.0.1
ARGUS_PORT=8000
```

**Start the backend:**

```powershell
cd e:\ARGUS\backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**Verify it's running:**

```powershell
# In a new terminal
curl http://127.0.0.1:8000/health
```

Expected output:
```json
{"status":"ok","service":"argus-brain","version":"2.0.0","endpoints":["/process-message","/extract-event","/parse-reminder","/summarize","/ask"]}
```

> [!TIP]
> If `uvicorn` is not found, try: `python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000`

---

## Step 5: Set Up the WhatsApp Bridge

```powershell
# Navigate to bridge
cd e:\ARGUS\bridge

# Install Node.js dependencies (one-time)
npm install

# Create your .env file from the template
copy .env.example .env
```

Now edit [bridge\.env](file:///e:/ARGUS/bridge/.env.example) with your real values:

```env
MY_JID=91XXXXXXXXXX@s.whatsapp.net
AI_BRAIN_URL=http://127.0.0.1:8000
ARGUS_SECRET=your_generated_secret_here
LISTEN_MODE=all
SEND_DELAY_MS=1500
```

> [!IMPORTANT]
> The `ARGUS_SECRET` must be **exactly the same** in both `backend/.env` and `bridge/.env`

**Start the bridge:**

```powershell
cd e:\ARGUS\bridge
npm run dev
```

### First Run — QR Code Pairing

On first run, you'll see a QR code in the terminal.

**To pair:**
1. Open **WhatsApp** on your phone
2. Go to **Settings → Linked Devices → Link a Device**
3. Point your camera at the QR code in the terminal
4. Wait for connection confirmation

Once connected:
```
╔══════════════════════════════════════════════╗
║  ✅ ARGUS is connected to WhatsApp!         ║
║                                              ║
║  • Listening for messages...                 ║
║  • Reminder worker active                    ║
║  • Send 'help' to yourself to get started    ║
╚══════════════════════════════════════════════╝
```

> [!NOTE]
> After the first pairing, credentials are saved in `bridge/auth_info/`. Future starts won't need the QR code again.

---

## Step 6: Test ARGUS

### Quick Test — Self-Chat Commands

Open WhatsApp on your phone and **message yourself** (your own number):

| You type | Expected response |
|---|---|
| `help` | Shows full command list with emoji |
| `what's the capital of France?` | `💡 The capital of France is Paris.` |
| `remind me to call mom at 5pm` | `⏰ Reminder set: Call mom` + fires at 5pm |
| `add buy groceries to my list` | `📝 Added: Buy groceries (Todo #1)` |
| `todos` | Shows your todo list |
| `done #1` | `✅ Todo #1 completed!` |
| `meeting with Rahul tomorrow at 3pm` | Event detection → confirmation prompt |

### Test — Passive Event Detection

Have someone send you a message mentioning a date/time:

> "hey let's catch up tomorrow at 4pm"

ARGUS will detect this and send you a confirmation **in your self-chat**:

```
🗓️ Event detected in chat with Rahul:
   Meeting — Mon, Aug 4 at 4:00 PM

Reply to confirm:
   ✅ yes — Add to calendar
   ✏️ edit — Modify details
   ❌ ignore — Skip this one
```

Reply `yes` to confirm, `ignore` to skip.

---

## Running Both Services Together

You need **2 terminal windows** running simultaneously:

### Terminal 1 — AI Brain
```powershell
cd e:\ARGUS\backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Terminal 2 — WhatsApp Bridge
```powershell
cd e:\ARGUS\bridge
npm run dev
```

> [!TIP]
> **Start order matters:** Start the AI Brain FIRST, then the Bridge.

### One-Click Start Script

Create `e:\ARGUS\start.bat`:

```batch
@echo off
echo Starting ARGUS...

start "ARGUS Brain" cmd /k "cd /d e:\ARGUS\backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000"

timeout /t 3 /nobreak > nul

start "ARGUS Bridge" cmd /k "cd /d e:\ARGUS\bridge && npm run dev"

echo.
echo ARGUS is starting up!
echo - Brain: http://127.0.0.1:8000/health
echo - Bridge: Check its terminal for QR code
```

---

## Android App (Optional — Phase 3)

The Android app is a **companion** for writing events to your phone calendar. Not required for the WhatsApp bot.

### Build the APK

```powershell
# Set JAVA_HOME (required on your system)
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.14.7-hotspot"

cd e:\ARGUS\android
.\gradlew.bat assembleDebug
```

APK output: `android\app\build\outputs\apk\debug\app-debug.apk`

### Install & Configure
1. Install via `adb install` or transfer the APK
2. Open ARGUS → **Settings** tab
3. Set **Backend URL** to your Tailscale IP (e.g., `http://100.x.x.x:8000`)
4. Set **Shared Secret** (same as `.env` files)
5. Tap **Test Connection** to verify
6. Grant **Notification Listener** permission when prompted

---

## Project File Reference

```
e:\ARGUS\
├── backend/                    ← AI Brain (Python/FastAPI)
│   ├── .env                    ← YOUR secrets (never committed)
│   ├── main.py                 ← FastAPI server (5 endpoints)
│   ├── models.py               ← Pydantic request/response models
│   ├── groq_client.py          ← Groq SDK — extraction, Q&A, summarize
│   ├── intent_classifier.py    ← Message intent detection
│   └── reminder_parser.py      ← NLP reminder parsing
│
├── bridge/                     ← WhatsApp Bridge (Node.js/TypeScript)
│   ├── .env                    ← YOUR secrets (never committed)
│   ├── auth_info/              ← WhatsApp creds (auto-created)
│   ├── argus.db                ← SQLite (reminders, todos, messages)
│   └── src/
│       ├── index.ts            ← Entry point (Baileys socket + QR)
│       ├── config.ts           ← Environment config
│       ├── db.ts               ← SQLite database layer
│       ├── messageHandler.ts   ← Message routing
│       ├── selfChat.ts         ← Command handling
│       ├── replySender.ts      ← Rate-limited WhatsApp sender
│       ├── brainClient.ts      ← HTTP client for AI Brain
│       └── reminderWorker.ts   ← Cron reminder scheduler (60s)
│
└── android/                    ← Companion App (Kotlin/Compose)
    └── (standard Android project structure)
```

---

## API Quick Reference

All POST endpoints require header: `X-Argus-Secret: <your_secret>`

| Endpoint | Purpose | Key Fields |
|---|---|---|
| `GET /health` | Health check | — |
| `POST /process-message` | Intent classification | `message_text`, `is_self_chat` |
| `POST /extract-event` | Event extraction | `notification_text`, `received_at` |
| `POST /parse-reminder` | Reminder parsing | `message_text`, `reference_timestamp` |
| `POST /summarize` | Chat summary | `messages[]`, `instruction` |
| `POST /ask` | General Q&A | `question` |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `GROQ_API_KEY not set` | Create `backend/.env` with your Groq key |
| `Missing required: MY_JID` | Create `bridge/.env` with your WhatsApp JID |
| `AI Brain unreachable` | Start backend first: `uvicorn main:app --reload` |
| QR code won't scan | Use WhatsApp → **Linked Devices** → **Link** |
| `Logged out` error | Delete `bridge/auth_info/` and restart to re-pair |
| `JAVA_HOME invalid` | `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.14.7-hotspot"` |
| Groq rate limit errors | Switch to `LISTEN_MODE=allowlist` in bridge `.env` |
| Bridge reconnects often | Normal — Baileys auto-reconnects after sleep/network changes |

---

## Security

- All secrets in `.env` files, never committed (`.gitignore`)
- Backend binds to `127.0.0.1` (localhost only) by default
- Messages stored in local SQLite only — never uploaded
- WhatsApp session in `auth_info/` — never committed
- Rate limiting built in (1.5s between sends)

> [!WARNING]
> **Baileys is unofficial.** WhatsApp could flag your account. Mitigations: rate limiting, single-user personal use. If uncomfortable, use the Android NotificationListenerService as the primary path instead.
