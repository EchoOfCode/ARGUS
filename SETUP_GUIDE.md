# ARGUS v2.1 — Setup & Run Guide

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│               WhatsApp Bridge (Node.js)                │
│  • Reads & logs ALL WhatsApp messages directly         │
│  • Voice note audio downloader (Groq Whisper)          │
│  • Zero-cost regex pre-filtering for rate protection   │
│  • Background scheduler: Reminders & Daily Briefing    │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP POST (X-Argus-Secret)
                           ▼
┌────────────────────────────────────────────────────────┐
│               AI Brain (Python/FastAPI)                │
│  • Token Bucket Rate Limiter & Retry Handler           │
│  • Universal IMAP Email Reader & Summarizer            │
│  • Groq Whisper-large-v3 Voice Transcriber             │
│  • Groq LLM (openai/gpt-oss-120b)                      │
│  • "Second Brain" SQLite Memory & Live Web Search      │
└────────────────────────────────────────────────────────┘
```

---

## Prerequisites

| Tool | Version | Check | Install |
|---|---|---|---|
| **Node.js** | 20+ | `node --version` | [nodejs.org](https://nodejs.org) |
| **Python** | 3.10+ | `python --version` | [python.org](https://python.org) |
| **Git** | Any | `git --version` | [git-scm.com](https://git-scm.com) |

---

## Step 1: Groq API Key & Shared Secret

1. Get your free API key at [console.groq.com](https://console.groq.com).
2. Generate a 32-byte secret (or use the one already in your `.env` files).

---

## Step 2: Configure AI Brain (`backend/.env`)

Edit `backend/.env`:

```env
GROQ_API_KEY=gsk_your_actual_key_here
GROQ_MODEL=openai/gpt-oss-120b
ARGUS_SECRET=your_generated_secret_here
ARGUS_HOST=127.0.0.1
ARGUS_PORT=8000

# (Optional) Direct Email Integration (IMAP)
# For Gmail: Use a 16-character Google App Password (myaccount.google.com/apppasswords)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_16_char_app_password
EMAIL_HOST=imap.gmail.com
EMAIL_PORT=993
```

---

## Step 3: Configure WhatsApp Bridge (`bridge/.env`)

Edit `bridge/.env`:

```env
MY_JID=918088421593@s.whatsapp.net
AI_BRAIN_URL=http://127.0.0.1:8000
ARGUS_SECRET=your_generated_secret_here
LISTEN_MODE=all
SEND_DELAY_MS=1500

# Daily Briefing
ENABLE_DAILY_BRIEFING=true
BRIEFING_HOUR=8
BRIEFING_MINUTE=0
```

---

## Step 4: Starting ARGUS

Run the launch script from root:

```cmd
start.bat
```

Or run manually in two terminals:

```powershell
# Terminal 1: Brain
cd e:\ARGUS\backend
py -3.10 -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2: Bridge
cd e:\ARGUS\bridge
npm run dev
```

---

## 📱 Complete WhatsApp Command Guide

Message your own number on WhatsApp (self-chat) to command ARGUS:

### 📬 Direct Email Reader
| Command | Action |
|---|---|
| `emails` / `unread` | Lists recent unread emails with sender & snippet |
| `summarize email #1` | Generates a crisp executive summary of email #1 |
| `search email invoice` | Searches inbox for specific keywords or senders |

### 💬 All-Chats Ingestion & Catch-up
| Command | Action |
|---|---|
| `catchup [Group Name]` | Summarizes missed conversations, decisions & action items |
| `catchup [Contact Name]` | Catches you up on a specific direct chat |

### 🎙️ Voice Notes (Whisper)
* Send **any voice note / audio message** directly to your WhatsApp self-chat.
* ARGUS transcribes it in < 1s with Groq Whisper and immediately executes your command!

### 🌅 Executive Briefing
| Command | Action |
|---|---|
| `briefing` / `agenda` | Instant daily executive overview combining events, unread emails, and todos |
| *Auto Scheduled* | Sent automatically every morning at 8:00 AM |

### 🧠 Second Brain (Long-Term Memory)
| Command | Action |
|---|---|
| `remember my WiFi password is Secret123` | Stores fact persistently in memory |
| `what is my WiFi password?` / `recall WiFi` | Retrieves answer from memory |

### 🌐 Live Web Search
| Command | Action |
|---|---|
| `search latest SpaceX launch` | Real-time web search with sourced links |
| `web what was yesterday's score?` | Live answer synthesis |

### 📅 Events & Reminders
| Command | Action |
|---|---|
| `Meeting with Alex tomorrow at 3pm` | Detected & queued for calendar confirmation |
| `remind me to call Mom in 20 minutes` | Background timer alerts you when due |

### 📝 Todos & Tasks
| Command | Action |
|---|---|
| `todos` / `list` | View active task list |
| `add buy groceries` | Add item |
| `done #1` | Complete item |
| `delete #1` | Remove item |
