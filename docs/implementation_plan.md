# ARGUS v2 — Full Personal AI Assistant (WhatsApp + Android)

## What Changed

The original ARGUS was a notification reader → calendar writer. The new ARGUS is a **full personal AI assistant** that lives in your WhatsApp and does everything: calendar events, reminders, Q&A, summaries, todo lists — and messages you back directly in WhatsApp.

## New Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  YOUR LAPTOP (always-on)                                        │
│                                                                 │
│  ┌──────────────────────┐     ┌──────────────────────────────┐ │
│  │  WhatsApp Bridge      │     │  AI Brain (FastAPI)          │ │
│  │  (Node.js + Baileys)  │────▶│                              │ │
│  │                       │◀────│  POST /process-message       │ │
│  │  • Reads ALL messages │     │  POST /extract-event         │ │
│  │  • Sends replies      │     │  POST /set-reminder          │ │
│  │  • Linked device      │     │  POST /summarize             │ │
│  │  • Rate-limited       │     │  POST /ask                   │ │
│  │  • QR code auth       │     │  POST /todo                  │ │
│  └──────────────────────┘     │                              │ │
│                                │  Groq API (LLM) ◀───────────│ │
│                                │  SQLite (reminders, todos)   │ │
│                                │  node-cron (scheduler)       │ │
│                                └──────────────────────────────┘ │
│                                         │                       │
│                           Tailscale     │                       │
└─────────────────────────────────────────│───────────────────────┘
                                          │
┌─────────────────────────────────────────│───────────────────────┐
│  YOUR ANDROID PHONE                     │                       │
│                                         ▼                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ARGUS Companion App                                      │   │
│  │  • NotificationListenerService (fallback if bridge down)  │   │
│  │  • CalendarContract writes (events → phone calendar)      │   │
│  │  • Settings / debug screen                                │   │
│  │  • WorkManager (retry queue)                              │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## How It Works — User Experience

You chat normally in WhatsApp. ARGUS watches all your conversations (via the Baileys linked device) and does two things:

### 1. Passive Mode (always listening)
ARGUS silently scans every incoming message for calendar events. When it detects one (e.g., "let's meet tuesday at 3pm"), it **messages you in WhatsApp**:

```
🗓️ Event detected in chat with Rahul:
   "Meeting" — Tue, Aug 5 at 3:00 PM

Reply:  ✅ Yes  |  ✏️ Edit  |  ❌ Ignore
```

You reply `yes` → ARGUS tells the Android app to write it to your calendar, then confirms:
```
✅ Added to calendar: Meeting — Tue, Aug 5 at 3:00 PM
```

### 2. Active Mode (you talk to ARGUS)
You can message ARGUS directly (it responds in a special chat — your own number, or a designated chat). Commands like:

| You say | ARGUS does |
|---|---|
| `remind me to call mom at 5pm` | Sets a reminder, WhatsApp messages you at 5pm: "🔔 Reminder: Call mom" |
| `what did rahul and i talk about today?` | Summarizes your recent chat with Rahul |
| `add buy groceries to my list` | Adds to your todo list |
| `show my todos` | Sends your todo list |
| `what's the capital of France?` | Quick AI answer via Groq |
| `summarize my unread messages` | Summarizes messages you haven't read |

### 3. Reminders
Reminders are stored in SQLite on the laptop. A `node-cron` job checks every minute and sends WhatsApp messages when they're due:
```
🔔 Reminder: Call mom
(Set 3 hours ago)
```

---

## Proposed Changes

### Component 1 — WhatsApp Bridge (Node.js + Baileys)

> [!NOTE]
> This is the new core of ARGUS. It replaces notification capture as the primary message source. The Android `NotificationListenerService` becomes a fallback for when the laptop is off.

##### [NEW] `bridge/package.json`
- Dependencies: `baileys` (v7), `qrcode-terminal`, `pino` (logger), `better-sqlite3`, `node-cron`, `axios`

##### [NEW] `bridge/src/index.ts`
- Main entry point
- Initializes Baileys socket with `useMultiFileAuthState`
- QR code display in terminal for initial pairing
- Reconnection handling with exponential backoff
- Event listeners: `connection.update`, `messages.upsert`

##### [NEW] `bridge/src/messageHandler.ts`
- Receives every incoming message from Baileys
- Filters: skip status broadcasts, skip own messages (except self-chat commands)
- For each message:
  1. **Intent classification** — POST to AI Brain `/process-message` to determine if it's a command, an event, or just a regular message
  2. **Route** — based on intent: event extraction, reminder set, todo add, Q&A, summarize, or ignore
- Rate limiting: 1.5s delay between automated sends to avoid WhatsApp flags

##### [NEW] `bridge/src/selfChat.ts`
- Handles messages sent to your own number (self-chat = command mode)
- Parses commands: remind, todo, ask, summarize, help
- Routes to appropriate AI Brain endpoint

##### [NEW] `bridge/src/replySender.ts`
- Wrapper around `sock.sendMessage()` with rate limiting
- Formats responses with emoji and structure
- Handles message types: text, buttons (if supported), reactions

##### [NEW] `bridge/src/reminderWorker.ts`
- `node-cron` job running every 60 seconds
- Queries SQLite for reminders where `due_at <= now() AND status = 'pending'`
- Sends WhatsApp message for each due reminder
- Marks reminder as `sent`

##### [NEW] `bridge/src/db.ts`
- `better-sqlite3` database with tables:
  - `reminders`: id, chat_jid, text, due_at, status (pending/sent/cancelled), created_at
  - `todos`: id, chat_jid, text, completed, created_at
  - `message_log`: id, chat_jid, sender, text, timestamp (for summarization context)

##### [NEW] `bridge/src/config.ts`
- Loads from `.env`: `AI_BRAIN_URL`, `ARGUS_SECRET`, `MY_JID` (your WhatsApp number), `LISTEN_MODE` (all/allowlist)
- Allowlist of JIDs to scan for events (optional — default scans all)

---

### Component 2 — AI Brain (Python/FastAPI + Groq)

> [!IMPORTANT]
> The backend expands from a single extraction endpoint to a multi-capability AI brain. Still stateless per request — state lives in the bridge's SQLite.

##### [MODIFY] `backend/main.py`
- Add new endpoints (see API below)
- Keep existing `/extract-event` endpoint

##### [NEW] `backend/intent_classifier.py`
- Uses Groq to classify message intent:
  - `event` — contains a meeting/event/appointment
  - `reminder` — user wants to set a reminder
  - `todo` — user wants to add/view/complete a todo
  - `question` — user is asking a question
  - `summarize` — user wants a summary
  - `none` — regular conversation, ignore
- Returns intent + confidence

##### [MODIFY] `backend/groq_client.py`
- Add new prompt templates for each intent type
- Add conversation summarization capability
- Add general Q&A capability

##### [NEW] `backend/models.py` (expanded)
- `ProcessMessageRequest/Response` — intent classification
- `ReminderRequest/Response` — reminder parsing (extract time + text)
- `SummarizeRequest/Response` — conversation summarization
- `AskRequest/Response` — general Q&A
- `TodoRequest/Response` — todo management

##### [NEW] `backend/reminder_parser.py`
- Uses Groq to parse natural language reminders:
  - "remind me to call mom at 5pm" → `{ text: "Call mom", due_at: "2026-08-02T17:00:00+05:30" }`
  - "remind me tomorrow morning to buy milk" → `{ text: "Buy milk", due_at: "2026-08-03T09:00:00+05:30" }`

---

### Component 3 — Android Companion App (simplified role)

> [!NOTE]
> The Android app is now a **companion**, not the primary brain. Its main jobs: write events to the phone calendar when the bridge tells it to, and act as a fallback notification listener when the laptop is off.

##### Same files as before, but with these changes:
- `NotificationListenerService` — now a **fallback** (only active when bridge is disconnected)
- `CalendarWriter` — receives events from the bridge via Tailscale and writes to CalendarContract
- New endpoint on the app: listens for push from the bridge (or polls) to write calendar events
- Settings screen: bridge URL, toggle fallback mode, view recent events

---

## Revised API Spec

### POST /process-message (NEW — intent classification)
```json
// Request
{
  "sender_jid": "919876543210@s.whatsapp.net",
  "message_text": "let's meet tuesday at 3pm",
  "chat_jid": "919876543210@s.whatsapp.net",
  "timestamp": "2026-08-02T14:02:00+05:30",
  "is_self_chat": false
}

// Response
{
  "intent": "event",        // event | reminder | todo | question | summarize | none
  "confidence": 0.91,
  "should_respond": true,   // false for "none" intent
  "extract_data": { ... }   // intent-specific payload (event details, reminder details, etc.)
}
```

### POST /extract-event (unchanged from original)
Same as [API_SPEC.md](file:///e:/ARGUS/API_SPEC.md)

### POST /parse-reminder (NEW)
```json
// Request
{
  "message_text": "remind me to call mom at 5pm",
  "reference_timestamp": "2026-08-02T14:02:00+05:30"
}

// Response
{
  "reminder_text": "Call mom",
  "due_at": "2026-08-02T17:00:00+05:30",
  "confidence": 0.95
}
```

### POST /summarize (NEW)
```json
// Request
{
  "messages": [
    { "sender": "Rahul", "text": "hey are we meeting?", "timestamp": "..." },
    { "sender": "You", "text": "yeah tuesday works", "timestamp": "..." }
  ],
  "instruction": "summarize this conversation"
}

// Response
{
  "summary": "You and Rahul confirmed a meeting for Tuesday."
}
```

### POST /ask (NEW)
```json
// Request
{ "question": "what's the capital of France?" }

// Response
{ "answer": "The capital of France is Paris." }
```

### POST /todo (NEW)
```json
// Request
{
  "action": "add",           // add | list | complete | delete
  "text": "buy groceries",   // for add
  "todo_id": null             // for complete/delete
}

// Response
{
  "todos": [
    { "id": 1, "text": "Buy groceries", "completed": false, "created_at": "..." }
  ],
  "message": "Added: Buy groceries"
}
```

---

## Revised Build Order

### Phase 1 — WhatsApp Bridge + Basic AI Brain
- [ ] Set up Node.js project with Baileys v7
- [ ] QR code pairing, persistent auth, reconnection
- [ ] Message listener — log all incoming messages
- [ ] AI Brain: `/process-message` (intent classification)
- [ ] AI Brain: `/extract-event` (calendar extraction)
- [ ] Bridge → Brain: detect events → reply in WhatsApp with confirmation
- [ ] Handle Yes/Ignore replies in WhatsApp

**Acceptance:** Send yourself a message with a date/time → ARGUS replies in WhatsApp with event details → reply "yes" → confirmed

### Phase 2 — Reminders + Todos + Q&A
- [ ] AI Brain: `/parse-reminder` endpoint
- [ ] Bridge: reminder SQLite storage + `node-cron` scheduler
- [ ] AI Brain: `/todo` endpoint
- [ ] Bridge: todo CRUD via self-chat commands
- [ ] AI Brain: `/ask` endpoint (general Q&A)
- [ ] AI Brain: `/summarize` endpoint
- [ ] Bridge: summarize recent messages from a chat

**Acceptance:** "remind me at 5pm to call mom" → reminder fires at 5pm in WhatsApp. "add buy milk to my list" → todo added. "what's 2+2?" → AI answers.

### Phase 3 — Android Companion + Calendar Write
- [ ] Android app: CalendarWriter receives events from bridge
- [ ] Bridge sends confirmed events to Android via Tailscale
- [ ] NotificationListenerService as fallback
- [ ] Settings screen on Android
- [ ] End-to-end: event confirmed in WhatsApp → appears in phone calendar

**Acceptance:** Full flow — WhatsApp message → ARGUS detects → you confirm in WhatsApp → event in phone calendar

### Phase 4 — Polish + Intelligence
- [ ] Conversation context (remember recent messages for better responses)
- [ ] Smart event detection (detect events even in ambiguous messages)
- [ ] Auto-confirm high-confidence events (opt-in, with accuracy tracking)
- [ ] Recurring reminders ("remind me every Monday at 9am")

---

## Security (carried forward + expanded)

- `GROQ_API_KEY` and `ARGUS_SECRET` in `.env`, never committed
- `.env` in `.gitignore` from commit #1
- Backend binds to Tailscale interface only
- `X-Argus-Secret` on all backend requests
- WhatsApp session credentials (`auth_info/`) in `.gitignore` — these are your login
- Message log is local SQLite only — never uploaded anywhere
- Rate limit all WhatsApp sends (1.5s minimum gap)

> [!WARNING]
> **Baileys is unofficial.** Your WhatsApp account could theoretically be flagged. Mitigations: use rate limiting, don't bulk-message, this is personal single-user use only. If you're uncomfortable with the risk, we can make the NotificationListenerService the primary path instead.

---

## Tech Stack (revised)

| Component | Tech |
|---|---|
| WhatsApp Bridge | Node.js + TypeScript, Baileys v7, better-sqlite3, node-cron, axios |
| AI Brain | Python 3.11+, FastAPI, uvicorn, Groq SDK, python-dotenv, SQLite |
| Android App | Kotlin, Jetpack Compose, Room, Retrofit, WorkManager, CalendarContract |
| Networking | Tailscale (free tier) |
| Process management | PM2 (keeps bridge alive) |

---

## Project Structure (revised)

```
e:\ARGUS\
├── README.md, ARCHITECTURE.md, etc.
├── .gitignore
│
├── bridge/                          ← NEW: WhatsApp Bridge
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── .gitignore                   (auth_info/, node_modules/, .env)
│   └── src/
│       ├── index.ts                 (entry point, Baileys socket)
│       ├── messageHandler.ts        (message routing)
│       ├── selfChat.ts              (command parsing)
│       ├── replySender.ts           (rate-limited sender)
│       ├── reminderWorker.ts        (cron scheduler)
│       ├── db.ts                    (SQLite: reminders, todos, message log)
│       └── config.ts               (env config)
│
├── backend/                         ← Expanded: AI Brain
│   ├── .env.example
│   ├── .gitignore
│   ├── requirements.txt
│   ├── main.py                      (FastAPI — all endpoints)
│   ├── models.py                    (Pydantic models)
│   ├── groq_client.py               (Groq SDK — all prompt types)
│   ├── intent_classifier.py         (message intent detection)
│   └── reminder_parser.py           (natural language → datetime)
│
└── android/                         ← Simplified: Companion app
    └── (standard Android project)
```

---

## Open Questions

> [!IMPORTANT]
> **Your WhatsApp number:** The bridge needs to know your JID (WhatsApp ID) so it knows which messages are "yours" vs incoming. What number should ARGUS be linked to?

> [!IMPORTANT]
> **Self-chat or separate number?** For talking TO ARGUS, do you want to:
> - **Self-chat:** Message yourself in WhatsApp → ARGUS responds there (cleanest, no extra number needed)
> - **Separate chat:** ARGUS messages you from a different linked context (less common)

> [!IMPORTANT]
> **Groq model:** Recommend `llama-3.3-70b-versatile` for intent classification + extraction quality. Free tier gives ~30 req/min which is plenty for personal use.

> [!NOTE]
> **Event detection scope:** Should ARGUS scan ALL your WhatsApp chats for events, or only specific contacts/groups? Scanning all is more useful but processes more messages against Groq's rate limit.
