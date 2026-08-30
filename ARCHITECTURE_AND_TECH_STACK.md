# 🏛️ ARGUS: Architecture, System Design & Tech Stack

> **Autonomous Real-time General Utility System (ARGUS)**  
> *A self-hosted, local-first AI Chief of Staff and personal cognitive operating system integrated directly with WhatsApp, Second Brain memory, Calendar, Document Vision, and Financial Ledgers.*

---

## 📑 Table of Contents
1. [System Overview](#-system-overview)
2. [Complete Tech Stack](#-complete-tech-stack)
3. [High-Level Architecture & Data Flow](#-high-level-architecture--data-flow)
4. [Core Subsystems & Implementation Details](#-core-subsystems--implementation-details)
   - [1. Autonomous ReAct Tool-Calling Engine ("OpenClaw" Architecture)](#1-autonomous-react-tool-calling-engine)
   - [2. Dynamic Stylometry & Adaptive AGI Persona](#2-dynamic-stylometry--adaptive-agi-persona)
   - [3. WhatsApp Baileys Bridge Gateway](#3-whatsapp-baileys-bridge-gateway)
   - [4. Multimodal Document & Vision Intelligence](#4-multimodal-document--vision-intelligence)
   - [5. Zero-Knowledge Privacy Firewall](#5-zero-knowledge-privacy-firewall)
   - [6. "Ghosted" Follow-Up Tracker & Financial Split Ledger](#6-ghosted-follow-up-tracker--financial-split-ledger)
   - [7. Web Cockpit Dashboard](#7-web-cockpit-dashboard)
5. [Database Schema & Multi-Process Concurrency](#-database-schema--multi-process-concurrency)
6. [Repository Manifest](#-repository-manifest)
7. [Installation & Setup](#-installation--setup)

---

## 🌟 System Overview

ARGUS transforms personal WhatsApp into an executive AI control center. Rather than acting as a standard conversational chatbot, ARGUS runs as an **Autonomous Agentic Operating System** on the user's local machine with direct read/write access to local SQLite databases, message logs, contacts, calendar agendas, and web tools.

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 USER'S WHATSAPP CLIENT                 │
                  │   (Dedicated ARGUS Group  /  1-on-1 Direct Chats)      │
                  └───────────────────────────┬────────────────────────────┘
                                              │ WebSocket (E2EE)
                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │          WHATSAPP BRIDGE (Node.js + TypeScript)        │
                  │   • Baileys Protocol Handler  • Multi-Device Auth       │
                  │   • Local Fast-Path Dispatch  • Media Downloader       │
                  └─────────────┬────────────────────────────┬─────────────┘
                                │ SQLite Reads/Writes        │ HTTP / Multipart
                                ▼                            ▼
     ┌──────────────────────────────────────┐     ┌────────────────────────┐
     │       LOCAL SQLITE DATABASES         │     │     AI BRAIN BACKEND   │
     │   • argus.db (WAL Mode)              │◄────┤     (Python FastAPI)   │
     │     - message_log                    │     │   • ReAct Agent Loop   │
     │     - chat_directory                 │     │   • Tool Execution     │
     │     - autopilot_rules                │     │   • Stylometry Engine  │
     │     - tracked_followups              │     │   • Vision Intelligence│
     │     - expenses                       │     │   • Groq / OpenRouter  │
     │   • argus_memory.db (Second Brain)   │     └───────────┬────────────┘
     └──────────────────────────────────────┘                 │
                                                              ▼
                                                  ┌────────────────────────┐
                                                  │   WEB COCKPIT STUDIO   │
                                                  │ (http://localhost:8000)│
                                                  └────────────────────────┘
```

---

## 🛠️ Complete Tech Stack

### 1. WhatsApp Bridge Gateway (Ingestion & Communication Layer)
| Technology | Role | Details |
| :--- | :--- | :--- |
| **Node.js 20+** | Runtime | Asynchronous runtime powering the bridge daemon |
| **TypeScript 5.x** | Language | Type-safe Baileys event handling and message pipeline |
| **`@whiskeysockets/baileys`** | WhatsApp Protocol | Reverse-engineered Multi-Device WhatsApp Web WebSocket protocol with QR code authentication and full E2EE handling |
| **`better-sqlite3`** | Storage Engine | High-performance synchronous SQLite driver configured in WAL mode |
| **`axios` & `form-data`** | HTTP Client | Streaming multipart file uploads and JSON payload dispatch to FastAPI |
| **`pino`** | Logging | Structured JSON logger for high-throughput observability |

### 2. AI Brain & Agent Backend (Cognitive & Execution Layer)
| Technology | Role | Details |
| :--- | :--- | :--- |
| **Python 3.10+** | Runtime | High-level execution runtime for AI agent loops and parsing |
| **FastAPI** | ASGI Framework | Non-blocking async API layer serving inference, dashboard endpoints, and webhooks |
| **Uvicorn** | Web Server | Production ASGI web server running on `127.0.0.1:8000` with auto-reloading |
| **Pydantic v2** | Data Validation | Strict data contracts and JSON schema definitions for requests/responses |
| **Groq Python SDK** | LLM Engine | Ultra-fast inference with Llama 3.3 70B, DeepSeek R1, and Whisper Large v3 |
| **Multi-Provider Client** | Fallback Support | Unified OpenAI-compatible interface supporting OpenRouter, OpenAI, and Ollama |
| **`pypdf`** | PDF Intelligence | Binary stream text and structure extraction from academic and corporate PDFs |
| **`duckduckgo-search`** | Live Web Grounding | Real-time live web searches with anti-blocking headers |

### 3. Web Cockpit Dashboard (Control & Management Layer)
| Technology | Role | Details |
| :--- | :--- | :--- |
| **HTML5 & Semantic CSS3** | UI Shell | Glassmorphic dark-mode dashboard with responsive grid design |
| **Vanilla JavaScript (ES6+)** | Frontend Logic | Zero-dependency, framework-free reactive UI (sub-millisecond load time) |
| **Fetch API & REST** | Data Sync | Real-time telemetry, toggle controls, and interactive Agent Chat studio |

---

## 🧠 Core Subsystems & Implementation Details

### 1. Autonomous ReAct Tool-Calling Engine
* **Location:** [`backend/agent_core.py`](file:///e:/ARGUS/backend/agent_core.py)
* **Architecture:** Implements a multi-turn ReAct (Reasoning + Acting) loop where the LLM can dynamically inspect its environment, invoke local tools, observe real SQLite database output, and composite multiple actions in one step.
* **Integrated Native Tools:**
  1. `list_contacts`: Real SQLite search across 280+ WhatsApp contacts.
  2. `search_chat_history`: Cross-chat keyword and semantic search.
  3. `search_links_and_files`: Cross-conversation link aggregator (Zoom, Meet, Docs).
  4. `get_agenda` & `schedule_event`: Queries confirmed calendar events and adds new items.
  5. `create_reminder` & `create_todo`: Logs time-based reminders and task items.
  6. `record_expense` & `get_financial_summary`: Logs expenses, debts, and generates balance sheets.
  7. `draft_whatsapp_message`: Drafts 1-tap dispatchable WhatsApp messages.
  8. `manage_memory`: Second Brain query, store, and category recall.
  9. `web_search`: Live real-time internet search via DuckDuckGo.

### 2. Dynamic Stylometry & Adaptive AGI Persona
* **Location:** [`backend/stylometry.py`](file:///e:/ARGUS/backend/stylometry.py) & [`backend/groq_client.py`](file:///e:/ARGUS/backend/groq_client.py)
* **Mechanism:**
  * Analyzes the user's authentic past sent messages from SQLite (`message_log`).
  * Calculates real average sentence length, casing habits (`lowercase casual`), punctuation patterns (`!`, `??`, minimal periods), and vocabulary slang (`bro`, `macha`, `yaar`, `ha`, `sorted`).
  * Injects real few-shot examples of the user's typing style directly into the generation prompt.
  * Ensures Auto-Pilot replies sound 100% human and completely eliminates generic AI phrases (*"Sure! I would be happy to assist you"*).

### 3. WhatsApp Baileys Bridge Gateway
* **Location:** [`bridge/src/messageHandler.ts`](file:///e:/ARGUS/bridge/src/messageHandler.ts) & [`bridge/src/selfChat.ts`](file:///e:/ARGUS/bridge/src/selfChat.ts)
* **Key Capabilities:**
  * **Dedicated Command Room:** Operates inside a private group named **`ARGUS`** where all user commands, document drops, and status mirror cards are routed.
  * **Fast-Path Local Routing:** Common operations (mute, unmute, help, status) resolve in < 1ms locally without waiting for LLM roundtrips.
  * **Multi-Turn Context Buffer:** Retains the last 8 messages of conversation history to handle conversational follow-ups (e.g. *"starting with b"*, *"tell him that"*).
  * **`@lid` & Fuzzy Contact Resolution:** Handles modern WhatsApp Linked Identity JIDs (`186221745680633@lid`) and maps full contact names (e.g., *"Harshith"* matches *"Harshith Nadella"*).

### 4. Multimodal Document & Vision Intelligence
* **Location:** [`backend/vision_doc_analyzer.py`](file:///e:/ARGUS/backend/vision_doc_analyzer.py)
* **Features:**
  * Drag-and-drop or send any PDF or image in WhatsApp.
  * Extracts syllabus deadlines, exam dates, invoice costs, and meeting notes.
  * Automatically schedules discovered deadlines directly into the local Calendar DB.

### 5. Zero-Knowledge Privacy Firewall
* **Protection Boundary:**
  * External contacts texting the user on WhatsApp **never** get access to private Second Brain notes, passwords, debts, or full day plans.
  * If an external contact asks *"What's your plan today?"*, Auto-Pilot replies with a natural, casual deflection (*"A bit caught up with college work and projects today, what's up?"*) without leaking confidential agenda items.

### 6. "Ghosted" Follow-Up Tracker & Financial Split Ledger
* **Follow-up Tracker:** Tracks 1-on-1 outgoing messages and flags contacts who have not replied after 12–24 hours. Provides `nudge [contact]` for 1-tap pings.
* **Financial Split Ledger:** Conversational expense logging (*"Paid 450 for lunch with Chinmay"* / *"Harshith owes me 200 for uber"*). Provides `expenses` and `who owes me` balance sheets.

### 7. Web Cockpit Dashboard
* **Location:** [`backend/dashboard.py`](file:///e:/ARGUS/backend/dashboard.py) (Running at `http://localhost:8000/dashboard`)
* **Modules:**
  * 💬 **Live Agent Studio:** Interactive browser-based chat with real-time tool execution cards.
  * 💸 **Financial Ledger:** Visual cards showing total monthly spending and money owed.
  * ⏳ **Follow-up Tracker:** Pending list of unresponsive contacts.
  * 📇 **Address Book & VCF Sync:** 1-second drag-and-drop `.vcf` contact sync.
  * 🤖 **Auto-Pilot Rules:** Visual toggle switches to enable/disable persona auto-replies.
  * 🧠 **Second Brain Vault:** Searchable knowledge graph of remembered facts.

---

## 🗄️ Database Schema & Multi-Process Concurrency

ARGUS uses SQLite with **Write-Ahead Logging (WAL)** mode enabled. This allows the Node.js TypeScript bridge and the Python FastAPI backend to read and write concurrently without locking collisions.

```sql
-- Contacts & Groups Directory
CREATE TABLE chat_directory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT UNIQUE,
  name TEXT,
  is_group INTEGER DEFAULT 0,
  last_seen TEXT
);

-- Full Message Log & Stylometry Training Data
CREATE TABLE message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT,
  sender_jid TEXT,
  sender_name TEXT,
  chat_name TEXT,
  message_text TEXT,
  is_from_me INTEGER DEFAULT 0,
  timestamp TEXT
);

-- Auto-Pilot Persona Rules
CREATE TABLE autopilot_rules (
  jid TEXT PRIMARY KEY,
  name TEXT,
  status TEXT DEFAULT 'active',
  custom_prompt TEXT,
  auto_reply_count INTEGER DEFAULT 0,
  created_at TEXT,
  last_replied_at TEXT
);

-- "Ghosted" Message Follow-Up Tracker
CREATE TABLE tracked_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT,
  recipient_name TEXT,
  last_message_text TEXT,
  sent_at TEXT,
  status TEXT DEFAULT 'pending'
);

-- Conversational Expense & Split Ledger
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL,
  category TEXT DEFAULT 'general',
  description TEXT,
  person TEXT,
  is_debt INTEGER DEFAULT 0, -- 0 = expense, 1 = money owed to user, 2 = user owes
  logged_at TEXT
);
```

---

## 📁 Repository Manifest

```
ARGUS/
├── backend/
│   ├── agent_core.py           # Autonomous ReAct Tool-Calling Agent Loop ("OpenClaw")
│   ├── stylometry.py           # Dynamic Linguistic Pattern & DNA Learning Engine
│   ├── vision_doc_analyzer.py  # PDF & Image Multimodal Analyzer
│   ├── groq_client.py          # Unified Multi-Provider LLM Client
│   ├── dashboard.py            # Glassmorphic Web Cockpit Studio & REST API
│   ├── main.py                 # FastAPI Application & Endpoints
│   ├── models.py               # Pydantic Schema Contracts
│   ├── reminder_parser.py      # Context-Aware Relative Datetime Parser
│   ├── rate_limiter.py         # Token Bucket API Rate Limiter
│   ├── web_search.py           # DuckDuckGo Grounding Engine
│   └── requirements.txt        # Python Dependencies
├── bridge/
│   ├── src/
│   │   ├── index.ts            # Baileys Socket Lifecycle & Auth Manager
│   │   ├── messageHandler.ts   # Message Ingestion & Media Pipeline
│   │   ├── selfChat.ts         # Fast-Path Command Processor & Router
│   │   ├── db.ts               # SQLite Database Access & Multi-Tier Matcher
│   │   ├── brainClient.ts      # HTTP & Multipart Bridge Client
│   │   ├── config.ts           # Environment & Credentials Manager
│   │   └── reminderWorker.ts   # Background Cron Reminder Dispatcher
│   ├── package.json            # Node.js Dependencies
│   └── tsconfig.json           # TypeScript Compiler Configuration
├── start.bat                   # 1-Click Dual Launch Script
├── setup.bat                   # Interactive Configuration Wizard
└── ARCHITECTURE_AND_TECH_STACK.md # System Architecture & Tech Stack Reference
```

---

## 🚀 Installation & Setup

1. **Clone & Configure:**
   ```bash
   git clone https://github.com/EchoOfCode/ARGUS.git
   cd ARGUS
   setup.bat
   ```
2. **Launch System:**
   ```bash
   start.bat
   ```
3. **Scan WhatsApp QR Code:** Scan the terminal QR code in WhatsApp on your phone (`Linked Devices` ➔ `Link a Device`).
4. **Open Web Cockpit:** Navigate to **`http://localhost:8000/dashboard`**.
