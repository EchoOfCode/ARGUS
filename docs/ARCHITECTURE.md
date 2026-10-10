# ARGUS: Architecture, System Design & Tech Stack

> **Autonomous Real-time General Utility System (ARGUS)**  
> *A self-hosted, local-first AI Chief of Staff and personal cognitive operating system integrated directly with WhatsApp, Second Brain memory, Calendar, Document Vision, and Financial Ledgers.*

---

## Table of Contents
1. [System Overview](#system-overview)
2. [Complete Tech Stack](#complete-tech-stack)
3. [High-Level Architecture & Data Flow](#high-level-architecture--data-flow)
4. [Core Subsystems & Implementation Details](#core-subsystems--implementation-details)
5. [Database Schema & Multi-Process Concurrency](#database-schema--multi-process-concurrency)
6. [Repository Manifest](#repository-manifest)
7. [Installation & Setup](#installation--setup)

---

## System Overview

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
                                │ SQLite Reads/Writes        │ HTTP / Multipart + HMAC
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
                                                  │ (http://127.0.0.1:8000)│
                                                  └────────────────────────┘
```

---

## Complete Tech Stack

### 1. WhatsApp Bridge Gateway (`apps/bridge`)
| Technology | Role | Details |
| :--- | :--- | :--- |
| **Node.js 20+** | Runtime | Asynchronous runtime powering the bridge daemon |
| **TypeScript 5.x** | Language | Type-safe Baileys event handling and message pipeline |
| **`@whiskeysockets/baileys`** | WhatsApp Protocol | Reverse-engineered Multi-Device WhatsApp Web WebSocket protocol with QR code authentication and full E2EE handling |
| **`better-sqlite3`** | Storage Engine | High-performance synchronous SQLite driver configured in WAL mode |
| **`axios` & `form-data`** | HTTP Client | Streaming multipart file uploads and JSON payload dispatch to FastAPI |
| **`zod`** | Validation | Runtime environment variable validation and fail-fast startup checks |
| **`pino`** | Logging | Structured JSON logger for high-throughput observability |

### 2. AI Brain & Agent Backend (`apps/brain`)
| Technology | Role | Details |
| :--- | :--- | :--- |
| **Python 3.10+** | Runtime | High-level execution runtime for AI agent loops and parsing |
| **FastAPI** | ASGI Framework | Non-blocking async API layer serving inference, dashboard endpoints, and webhooks |
| **Uvicorn** | Web Server | Production ASGI web server running on `127.0.0.1:8000` |
| **Pydantic v2 & Settings** | Data Validation | Strict data contracts, JSON schema definitions, and fail-fast startup validation |
| **Groq Python SDK** | LLM Engine | Fast inference with Llama 3.3 70B, DeepSeek R1, and Whisper Large v3 |
| **Multi-Provider Client** | Fallback Support | Unified OpenAI-compatible interface supporting OpenRouter, OpenAI, and Ollama |
| **`pypdf`** | PDF Intelligence | Binary stream text and structure extraction from academic and corporate PDFs |
| **`ddgs`** | Live Web Grounding | Real-time live web searches with anti-blocking headers |

### 3. Web Cockpit Dashboard
| Technology | Role | Details |
| :--- | :--- | :--- |
| **HTML5 & Semantic CSS3** | UI Shell | Glassmorphic dark-mode dashboard with responsive grid design |
| **Vanilla JavaScript (ES6+)** | Frontend Logic | Zero-dependency, framework-free reactive UI (sub-millisecond load time) |
| **Fetch API & REST** | Data Sync | Real-time telemetry, toggle controls, and interactive Agent Chat studio |

---

## Core Subsystems & Implementation Details

### 1. Autonomous ReAct Tool-Calling Engine
* **Location:** [`apps/brain/agent_core.py`](file:///e:/ARGUS/apps/brain/agent_core.py)
* **Architecture:** Implements a multi-turn ReAct (Reasoning + Acting) loop where the LLM can dynamically inspect its environment, invoke local tools, observe real SQLite database output, and composite multiple actions in one step.
* **Integrated Native Tools:**
  1. `list_contacts`: Real SQLite search across WhatsApp contacts.
  2. `search_chat_history`: Cross-chat keyword and semantic search.
  3. `search_links_and_files`: Cross-conversation link aggregator (Zoom, Meet, Docs).
  4. `get_agenda` & `schedule_event`: Queries confirmed calendar events and adds new items.
  5. `create_reminder` & `create_todo`: Logs time-based reminders and task items.
  6. `record_expense` & `get_financial_summary`: Logs expenses, debts, and balance sheets.
  7. `draft_whatsapp_message`: Drafts dispatchable WhatsApp messages.
  8. `manage_memory`: Second Brain query, store, and category recall.
  9. `web_search`: Live real-time internet search via DuckDuckGo.

### 2. Dynamic Stylometry & Adaptive Persona
* **Location:** [`apps/brain/stylometry.py`](file:///e:/ARGUS/apps/brain/stylometry.py) & [`apps/brain/groq_client.py`](file:///e:/ARGUS/apps/brain/groq_client.py)
* **Mechanism:**
  * Analyzes the owner's authentic past sent messages from SQLite (`message_log`).
  * Calculates real average sentence length, casing habits, punctuation patterns, and vocabulary slang.
  * Injects real few-shot examples of typing style directly into generation prompts.
  * Ensures auto-pilot replies mirror natural conversational cadence rather than generic AI phrasing.

### 3. WhatsApp Baileys Bridge Gateway
* **Location:** [`apps/bridge/src/messageHandler.ts`](file:///e:/ARGUS/apps/bridge/src/messageHandler.ts) & [`apps/bridge/src/selfChat.ts`](file:///e:/ARGUS/apps/bridge/src/selfChat.ts)
* **Key Capabilities:**
  * **Dedicated Command Room:** Operates inside a private group named `ARGUS` where user commands, document drops, and status mirror cards are routed.
  * **Fast-Path Local Routing:** Common operations (mute, unmute, help, status) resolve in < 1ms locally without waiting for LLM roundtrips.
  * **Multi-Turn Context Buffer:** Retains recent message context to handle conversational follow-ups.
  * **`@lid` & Fuzzy Contact Resolution:** Handles WhatsApp Linked Identity JIDs and maps contact names.

### 4. Multimodal Document & Vision Intelligence
* **Location:** [`apps/brain/vision_doc_analyzer.py`](file:///e:/ARGUS/apps/brain/vision_doc_analyzer.py)
* Extracts syllabus deadlines, exam dates, invoice costs, and meeting notes from PDF documents and image attachments.

---

## Database Schema & Multi-Process Concurrency

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

-- Tracked Message Follow-Ups
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

## Repository Manifest

```
ARGUS/
├── apps/
│   ├── brain/                  # FastAPI Python Cognitive Engine & Memory
│   │   ├── agent_core.py       # Autonomous ReAct Agent Loop
│   │   ├── config.py           # Pydantic Settings Validation
│   │   ├── stylometry.py       # Linguistic Persona Learning Engine
│   │   ├── dashboard.py        # Web Cockpit Studio & REST API
│   │   ├── main.py             # FastAPI App & HMAC Auth Middleware
│   │   └── requirements.txt    # Python Dependencies
│   └── bridge/                 # Node.js TypeScript WhatsApp Bridge
│       ├── src/
│       │   ├── index.ts        # Baileys Socket Lifecycle & Auth Manager
│       │   ├── messageHandler.ts # Message Ingestion & Media Pipeline
│       │   ├── selfChat.ts     # Command Processor & Fast-Path Router
│       │   ├── config.ts       # Zod Runtime Configuration Validator
│       │   └── db.ts           # SQLite Database Access Layer
│       └── package.json        # Node.js Dependencies
├── deploy/                     # Production & Development Docker Compose configurations
├── docs/                       # Architecture & Security Incident documentation
├── scripts/                    # Convenience setup and launch scripts
├── Makefile                    # Standard developer automation commands
└── justfile                    # Just runner configuration
```
