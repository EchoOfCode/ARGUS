# ARGUS — Technology Stack Specification

> Complete breakdown of runtime engines, libraries, design frameworks, and deployment tooling across all ARGUS subsystems.

---

## 1. WhatsApp Bridge Gateway (`apps/bridge`)

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | `20.x LTS` | High-throughput asynchronous event-driven daemon |
| **Language** | TypeScript | `5.7+` | Strict static typing and build-time safety |
| **Protocol Engine** | `@whiskeysockets/baileys` | `^6.7.9` | Reverse-engineered Multi-Device WhatsApp Web WebSocket protocol |
| **Local Storage** | `better-sqlite3` | `^11.0` | Synchronous, high-speed SQLite database engine (WAL mode) |
| **HTTP Client** | `axios` & `form-data` | `^1.7` | Multipart media streaming and HMAC payload dispatch to AI Brain |
| **Data Validation** | `zod` | `^3.23` | Fail-fast runtime schema validation for `.env` and payload parameters |
| **Logger** | `pino` & `pino-pretty` | `^9.0` | High-speed structured JSON telemetry and terminal formatter |
| **Task Scheduler** | `node-cron` | `^3.0` | Recurring reminder trigger worker (runs every 60s) |

---

## 2. AI Brain & Cognitive Engine (`apps/brain`)

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Runtime** | Python | `3.11+` | Execution environment for ReAct loops, NLP, and system engines |
| **Web Framework** | FastAPI | `^0.115` | Non-blocking async REST and AG-UI Server-Sent Events (SSE) server |
| **ASGI Server** | Uvicorn | `^0.30` | Production ASGI web server bound to `127.0.0.1:8000` |
| **Data Models** | Pydantic v2 | `^2.8` | Request/response data validation and JSON schema definitions |
| **Primary LLM** | Groq Python SDK | `^0.11` | Ultra-low latency reasoning (`llama-3.3-70b-versatile`, `qwen/qwen3.8-27b`) |
| **Reasoning & Code LLM** | Google Gemini (`OpenAI SDK`) | `^1.40` | Deep code, mathematics, multimodal, and long-query engine (`gemini-flash-lite-latest`) |
| **Audio Transcription** | Groq Whisper | `large-v3` | Automatic speech-to-text transcription of WhatsApp voice notes |
| **Local LLM Engine** | Ollama API | HTTP | Optional offline open-source inference (`llama3`, `mistral`) |
| **Document Vision** | `pypdf` | `^4.3` | Binary text and structure extraction from academic and corporate PDFs |
| **Live Web Grounding**| `ddgs` (duckduckgo-search) | `^6.2` | Real-time live web searches with anti-blocking headers |
| **Encryption** | `cryptography` (Fernet) | `^43.0` | AES-128 credential encryption in `argus_vault.db` |
| **System 1 Engine** | Custom Python Engine | In-house | Zero-token, sub-5ms deterministic regex/NLP local execution layer |

---

## 3. Web Control Plane (`apps/web`)

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Framework** | Next.js (App Router) | `14.2+` | Single-owner web application and server-rendered cockpit |
| **Runtime** | Node.js | `20.x LTS` | Execution environment for server components and actions |
| **Language** | TypeScript | `5.5+` | Strict end-to-end type safety |
| **Styling** | Tailwind CSS | `3.4+` | High-density dark-mode executive UI and responsive grids |
| **Icons** | Lucide React | `^0.440` | Modern SVG iconography |
| **Protocol** | AG-UI Server-Sent Events | Standard | Real-time token streaming and dynamic tool execution cards |

---

## 4. Networking, Infrastructure & Persistence

| Component | Technology | Details |
| :--- | :--- | :--- |
| **Reverse Proxy** | Caddy 2 | Automatic loopback reverse proxy (`http://127.0.0.1:3000`) with Tailscale support |
| **Containers** | Docker & Docker Compose v2 | Unprivileged, isolated non-root containers with internal private network |
| **Databases** | SQLite 3 (WAL Mode) | `argus.db` (Operational DB), `argus_memory.db` (Second Brain), `argus_vault.db` (Encrypted) |
| **Remote Access** | Tailscale | Private mesh VPN accessing Web Control Plane without port forwarding |

---

## 5. Quality Assurance & DevTooling

| Tool | Purpose |
| :--- | :--- |
| **`pytest` & `pytest-asyncio`** | Comprehensive backend test suite (unit tests, ReAct loops, policy engine) |
| **`vitest` / `ts-node`** | WhatsApp Bridge test suite and integration tests |
| **`ruff`** | Fast Python linter and code formatter |
| **`eslint` & `prettier`** | TypeScript formatting and lint rules |
| **GitHub Actions** | Automated CI pipeline running tests and static checks on every push |
