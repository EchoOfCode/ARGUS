<div align="center">

# 🤖 ARGUS
### **Autonomous Real-time General Utility System**
*A self-hosted personal AI executive assistant, second brain & communication hub inside WhatsApp.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/EchoOfCode/ARGUS/actions/workflows/ci.yml/badge.svg)](https://github.com/EchoOfCode/ARGUS/actions/workflows/ci.yml)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Baileys](https://img.shields.io/badge/WhatsApp-Baileys%20v6.7-25D366.svg?logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Groq](https://img.shields.io/badge/AI%20Inference-Groq%20Cloud-F55036.svg)](https://groq.com)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](https://docker.com)

[Overview](#-overview) • [Honest Risks](#-honest-risks--limitations) • [Architecture](#-architecture) • [Quickstart](#-quickstart-docker-first) • [Configuration](#-configuration-reference) • [Command Cheatsheet](#-command-cheatsheet) • [Troubleshooting](#-troubleshooting)

</div>

---

## 🌟 Overview

**ARGUS** is an executive personal AI assistant that lives inside your own WhatsApp account. Designed as a self-hosted "second brain" and digital Chief of Staff, ARGUS reads your incoming chats, prioritizes emails, manages reminders, schedules events, tracks shared expenses, and transcribes voice notes.

### What ARGUS Does
- **🧠 Second Brain:** Automatically stores, categorizes, and recalls personal notes, facts, and preferences.
- **💬 Group Catch-up:** Generates structured 3-tier summaries (Key Points, Links, Action Items) for active chats.
- **📬 Email Triage (IMAP):** Checks unread inbox messages and performs executive deep-dive breakdowns.
- **📅 Calendar Scheduling:** Generates 1-tap Google Calendar links from natural language or document dates.
- **🎙️ Voice Note Transcription:** Transcribes WhatsApp voice memos using Groq Whisper.
- **💸 Expense Ledger:** Tracks shared expenses, debts, and balances via conversational commands.
- **📤 Message Drafter & Auto-Pilot:** Drafts polish messages for contacts and provides supervised or autonomous persona auto-replies.

---

## ⚠️ Honest Risks & Limitations

Before running ARGUS, understand the actual architecture and trade-offs:

1. **Unofficial WhatsApp Client:** ARGUS uses [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp Web reverse-engineered client. Using unofficial clients carries a potential risk of account suspension or ban by WhatsApp. ARGUS incorporates human-like typing delays, but use is entirely at your own risk.
2. **Cloud AI Inference:** ARGUS is self-hosted, but **it is not zero-cloud**. Conversation snippets, email excerpts, and audio notes are sent over TLS to cloud inference APIs (Groq Cloud by default, or OpenAI/OpenRouter if configured).
3. **Prompt Injection Risk:** When ARGUS processes messages from other contacts or group chats, external text reaches the model prompt. Never allow untrusted contacts to trigger sensitive tools without human oversight.
4. **Credential Security:** Plaintext passwords, API keys, and sensitive financial secrets should never be saved in memory commands (`remember ...`). Memory vaults are indexed and retrieved directly by the LLM.
5. **Multi-Writer Concurrency:** Both the Node.js bridge and Python brain interact with local SQLite databases. SQLite Write-Ahead Logging (WAL) is enabled to handle concurrent reads.

---

## 🏛️ Architecture

For the complete technical specification, data schemas, and design decisions, see [**`docs/architecture.md`**](docs/architecture.md).

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
                     │    TypeScript / SQLite / Cron Worker    │
                     └────────────────────┬────────────────────┘
                                          │  HTTP + HMAC Auth (argus-network)
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                    ARGUS AI BRAIN                                      │
│                              (apps/brain: Python 3.11)                                 │
├────────────────────┬────────────────────┬─────────────────────┬────────────────────────┤
│ 🧠 Second Brain    │ 📬 Gmail IMAP      │ 📅 Google Calendar  │ 🎙️ Groq Whisper        │
│ Auto-Categorizer   │ Direct Reader      │ 1-Tap Link Engine   │ Voice Transcriber      │
├────────────────────┼────────────────────┼─────────────────────┼────────────────────────┤
│ ⚡ Intent Router   │ 💬 3-Tier Catch-up │ 📤 Outbox Drafter   │ 🌐 Live Search         │
│ & Fast Pre-Filters │ Conversation AI    │ Interactive Preview │ Grounding Engine       │
└────────────────────┴────────────────────┴─────────────────────┴────────────────────────┘
```

---

## 🚀 Quickstart (Docker First)

Running with Docker is the recommended production deployment. Containers run unprivileged as non-root users with isolated network boundaries.

### Prerequisites
- Docker Engine 24+ and Docker Compose v2+
- A free **Groq API Key** ([console.groq.com](https://console.groq.com))
- *(Optional)* A Gmail App Password for email triage

---

### Step 1: Clone Repository & Configure Environment

```bash
git clone https://github.com/EchoOfCode/ARGUS.git
cd ARGUS
```

Generate a secure 32-byte shared secret:
```bash
# On Linux / macOS:
openssl rand -hex 32

# On Windows PowerShell:
python -c "import secrets; print(secrets.token_hex(32))"
```

Initialize environment files:
```bash
cp apps/brain/.env.example apps/brain/.env
cp apps/bridge/.env.example apps/bridge/.env
```

Edit both `.env` files:
- Set `ARGUS_SECRET` to the generated 32-byte hexadecimal string in both `.env` files.
- In `apps/brain/.env`, add your `GROQ_API_KEY`.
- In `apps/bridge/.env`, set `MY_JID` to your WhatsApp phone number formatted as `919876543210@s.whatsapp.net`.

---

### Step 2: Start Containers

```bash
# Build and start background containers
docker compose up --build -d
```

> **Security Note:** In production, the brain container does **not** publish port `8000` to the host network. All bridge-to-brain traffic occurs over the private internal Docker network.

---

### Step 3: Link WhatsApp via QR Code

Display the container logs to view the WhatsApp Web QR code:
```bash
docker compose logs -f argus-bridge
```
1. Open WhatsApp on your phone.
2. Go to **Settings → Linked Devices → Link a Device**.
3. Scan the terminal QR code.
4. Create a WhatsApp group named **`ARGUS`** (or text your own number in self-chat).
5. Send `help` to begin!

---

### Local Development Alternative (Without Docker)

If you prefer running directly on your host machine:

#### 1. Setup Dependencies
```bash
make setup
# OR on Windows:
.\scripts\setup.bat
```

#### 2. Start Services
```bash
make dev
# OR on Windows:
.\scripts\start.bat
```
- Brain runs at `http://127.0.0.1:8000` (Web Cockpit available at `/dashboard`).
- Bridge logs into WhatsApp and displays the terminal QR code.

---

## ⚙️ Configuration Reference

### Brain (`apps/brain/.env`)
| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `ARGUS_SECRET` | **Yes** | — | HMAC shared secret (min 32 chars, cannot be placeholder). |
| `GROQ_API_KEY` | **Yes** | — | API key from Groq Cloud Console. |
| `GROQ_MODEL` | No | `llama-3.3-70b-versatile` | Primary reasoning model. |
| `EMAIL_USER` | No | — | Gmail address for IMAP inbox triage. |
| `EMAIL_PASS` | No | — | Gmail 16-character App Password. |
| `HOST` | No | `127.0.0.1` | Local bind address (bound to localhost for security). |
| `PORT` | No | `8000` | Port for the FastAPI ASGI server. |

### Bridge (`apps/bridge/.env`)
| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MY_JID` | **Yes** | — | Owner WhatsApp JID (e.g. `919876543210@s.whatsapp.net`). |
| `ARGUS_SECRET` | **Yes** | — | Must match `ARGUS_SECRET` in brain configuration. |
| `AI_BRAIN_URL` | No | `http://127.0.0.1:8000` | URL for brain service (`http://argus-brain:8000` in Docker). |
| `LISTEN_MODE` | No | `all` | `all` to ingest all chats, or `allowlist` for restricted chats. |
| `ALLOWED_JIDS` | No | — | Comma-separated list of allowed JIDs when in allowlist mode. |
| `SEND_DELAY_MS` | No | `1500` | Natural typing delay between outgoing messages. |
| `DEDICATED_GROUP_NAME` | No | `ARGUS` | WhatsApp group name for dedicated command channel. |

---

## 📖 Command Cheatsheet

*(All examples use synthetic demonstration data)*

| Category | Example Command | What ARGUS Does |
| :--- | :--- | :--- |
| **🧠 Second Brain** | `remember office parking spot is B-12` | Categorizes and stores note into memory vault. |
| | `where is my parking spot?` | Synthesizes instant answer from memory. |
| | `memories` | Displays full categorized knowledge graph. |
| | `forget parking` | Deletes outdated memory entries. |
| **💬 Chat Catch-up** | `catchup Project Alpha` | Generates 3-tier summary of recent group discussion. |
| | `summarize chat` | Summarizes most recent active conversation. |
| **📬 Email Reader** | `read my emails` | Fetches unread email headers and senders. |
| | `summarize email #1` | Deep executive breakdown of specific message. |
| **📅 Calendar** | `schedule Project Sync tomorrow at 4pm` | Produces 1-tap Google Calendar event creation link. |
| | `events` / `calendar` | Shows upcoming schedule from local database. |
| **📝 Reminders** | `remind me to send budget report in 45 minutes` | Sends scheduled alert back into WhatsApp. |
| | `todos` / `add buy printer ink` | Manages personal todo checklist. |
| **💸 Split Ledger** | `paid 450 for lunch with Alex` | Logs shared expense entry. |
| | `who owes me` / `expenses` | Shows net debt and balance breakdown. |
| **🤖 Persona Auto-Pilot**| `autopilot on for Alex` | Automatically replies to contact in owner's writing style. |
| | `autopilot off` | Disables auto-pilot responses. |
| **🚫 Exemptions** | `exempt Family Group` | Stops message logging for spammy group chats. |

---

## 🛠️ Troubleshooting

### 1. "ARGUS_SECRET must be at least 32 characters" or "cannot be placeholder"
- **Cause:** Startup validation detected an empty, default placeholder, or short secret.
- **Fix:** Generate a 32-byte secret (`openssl rand -hex 32`) and paste the exact value into both `apps/brain/.env` and `apps/bridge/.env`.

### 2. WhatsApp QR Code Disappears or Times Out
- **Fix:** Restart the bridge service or attach to the container:
  ```bash
  docker compose restart argus-bridge
  docker compose logs -f argus-bridge
  ```
- To completely reset WhatsApp authentication credentials:
  ```bash
  # Local:
  rm -rf apps/bridge/auth_info
  # Docker:
  docker volume rm argus_whatsapp_auth
  ```

### 3. Backing Up Persistent Data
Persistent data is isolated in Docker volumes:
- `argus_whatsapp_auth`: WhatsApp Web encryption keys and pairing state.
- `argus_brain_memory`: Second Brain memory database (`argus_memory.db`).
- `argus_bridge_data`: Message log and contact cache (`argus.db`).

To back up databases:
```bash
docker run --rm -v argus_bridge_data:/data -v $(pwd):/backup alpine cp /data/argus.db /backup/
docker run --rm -v argus_brain_memory:/data -v $(pwd):/backup alpine cp /data/argus_memory.db /backup/
```

---

## 🔒 Security & Community

- **Security Vulnerabilities:** Review our policy in [**`SECURITY.md`**](SECURITY.md).
- **Contributing:** Guidelines, setup steps, and coding conventions are in [**`CONTRIBUTING.md`**](CONTRIBUTING.md).
- **Code of Conduct:** Standards of engagement are in [**`CODE_OF_CONDUCT.md`**](CODE_OF_CONDUCT.md).
- **Changelog:** Project evolution is tracked in [**`CHANGELOG.md`**](CHANGELOG.md).

---

## 📜 License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Mohammed Yusuf Ahmed.
