# ADR 0001: Single Database Owner (Brain-Owned SQLite & Ingestion API)

## Status
**Proposed** (Awaiting approval before implementation)

## Context

In the current implementation of ARGUS:
1. Both `apps/bridge` (Node.js / TypeScript via `better-sqlite3`) and `apps/brain` (Python via standard `sqlite3`) open and write to `argus.db`.
2. Both runtimes execute direct `INSERT`, `UPDATE`, and `DELETE` statements across shared tables.
3. Business logic is duplicated: expense parsing and ledger calculations exist in both `apps/bridge/src/db.ts` and `apps/brain/agent_core.py`.
4. While SQLite supports WAL mode, concurrent multi-process writes across two runtimes (Node and Python) can cause `SQLITE_BUSY` database lock contention, race conditions, and uncoordinated transactional state.

### Full Inventory of Tables and Operations

| Table | Current Writers | Current Readers | Target Owner & Architecture |
| :--- | :--- | :--- | :--- |
| **`message_log`** | Bridge (`logMessage`) | Bridge (`getRecentMessages`, `searchMessages`), Brain (`search_chat_history`, `stylometry`) | **Brain owned.** Bridge streams events via idempotent `POST /api/ingest/message`. Brain writes. Bridge reads eliminated. |
| **`chat_directory`** | Bridge (`updateChatDirectory`), Brain (`dashboard.py` VCF upload) | Bridge (`searchContacts`, `getAllChats`), Brain (`list_contacts`, `dashboard.py`) | **Brain owned.** Bridge notifies Brain via `POST /api/contacts/sync`. Brain maintains directory and search indices. |
| **`reminders`** | Bridge (`addReminder`, `markReminderSent`), Brain (`agent_core.py` tool) | Bridge (`getDueReminders`, `getTodayReminders`), Brain (`agent_core.py`) | **Brain owned.** Brain owns scheduling and storage. Bridge queries due items via `GET /api/reminders/due` and acks via `POST /api/reminders/:id/ack`. |
| **`todos`** | Bridge (`addTodo`, `completeTodo`, `deleteTodo`), Brain (`agent_core.py` tool) | Bridge (`getTodos`), Brain (`agent_core.py`) | **Brain owned.** Consolidated in Brain. Bridge sends user todo actions over authenticated API. |
| **`pending_events`** | Bridge (`addPendingEvent`, `updateEventStatus`), Brain (`agent_core.py` schedule) | Bridge (`getPendingEvents`), Brain (`get_agenda`, `dashboard.py`) | **Brain owned.** Meeting candidate extraction and confirmation handled via Brain API. |
| **`exempted_chats`** | Bridge (`addExemptedChat`, `removeExemptedChat`) | Bridge (`isChatExempted`) | **Brain owned.** Ingestion filter rules synced from Brain at bridge startup. |
| **`pending_outbox`** | Bridge (`addToOutbox`, `updateOutboxStatus`), Brain (`agent_core.py` draft) | Bridge (`getPendingOutbox`), Brain (`agent_core.py`) | **Brain owned.** Replaced by Outbound Policy approval records (ADR 0003). |
| **`pending_proposals`**| Bridge (`addProposal`, `updateProposalStatus`) | Bridge (`getProposal`) | **Brain owned.** Meeting proposals stored in Brain. |
| **`tracked_followups`**| Bridge (`trackFollowup`, `markFollowupReplied`) | Bridge (`getWaitingFollowups`), Brain (`dashboard.py`) | **Brain owned.** Follow-up calculations owned by Brain. |
| **`expenses`** | Bridge (`addExpense`), Brain (`agent_core.py` tool) | Bridge (`getExpenses`, `getDebts`), Brain (`get_financial_summary`) | **Brain owned.** Duplicate TypeScript financial logic deleted; Brain owns single ledger implementation. |
| **`autopilot_rules`** | Bridge (`setAutopilotRule`, `incrementAutopilotReplyCount`), Brain (`dashboard.py`) | Bridge (`getAutopilotRule`, `getAllAutopilotRules`), Brain (`dashboard.py`) | **Brain owned.** Governed by Brain policy engine (ADR 0003). |
| **`memories`** *(in `argus_memory.db`)* | Brain (`memory.py`, `dashboard.py`) | Brain (`memory.py`, `dashboard.py`) | **Brain owned.** Second Brain vault remains private to Brain. |

---

## Decision

### 1. Designate `apps/brain` as Sole Database Owner & Writer
- `apps/brain` (FastAPI + SQLAlchemy Core / SQLite) is the **sole process permitted to open `argus.db` and `argus_memory.db`**.
- The bridge (`apps/bridge`) will have **no direct connection, no write access, and NO direct read access (default: none)** to the SQLite databases.
- All bridge data ingress, lookups, and state mutations must flow through authenticated Brain REST endpoints.

### 2. Durable Ingestion Journal in Bridge (Offline Resilience)
- To prevent message loss when the Brain is offline, updating, or restarting, `apps/bridge` will **not** rely on a volatile in-memory array.
- Instead, the bridge writes incoming message events to a local, append-only SQLite journal (`apps/bridge/data/ingest_journal.db` configured in WAL mode).
- A background draining worker in the bridge flushes journal entries to `POST /api/ingest/message` with exponential backoff and purges acknowledged entries only after receiving HTTP 200 OK.

### 3. Idempotency on WhatsApp Message ID
- Every WhatsApp message has a unique identifier assigned by WhatsApp servers (`key.id` / `stanzaId`).
- `POST /api/ingest/message` requires `message_id` and enforces database-level idempotency (`INSERT OR IGNORE` or `ON CONFLICT (message_id) DO NOTHING`). Duplicate deliveries across Baileys reconnects or journal retries become idempotent no-ops.

### 4. Bridge Multi-Turn State Handling
- Persistent conversation history is strictly queried from Brain endpoints.
- To maintain sub-second responsiveness for interactive fast-path command follow-ups (e.g. typing `yes`, `cancel`, `edit ...`), `apps/bridge` maintains a lightweight, ephemeral **in-memory ring buffer of the last 8 messages** strictly for the command channel session. Persistent history and stylometry analysis remain solely on the Brain.

### 5. Cryptographically Signed Requests & Replay Protection
- All Bridge-to-Brain HTTP requests must include two cryptographic authentication headers:
  1. `X-Argus-Timestamp`: Current UTC epoch milliseconds.
  2. `X-Argus-Signature`: `sha256=` + `HMAC-SHA256(ARGUS_SECRET, timestamp + "." + body)`.
- **Replay Protection:** Brain middleware rejects requests where `|now - timestamp| > 300_000ms` (5-minute tolerance window).
- **Constant-Time Verification:** Signatures are compared using constant-time comparison (`hmac.compare_digest` in Python, `crypto.timingSafeEqual` in Node) to prevent timing side-channel attacks.

### 6. SQLite Concurrency Pragmas
The Brain connection pool initializes SQLite with strict concurrency settings:
```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
```

### 7. Alembic Migrations: Batch Mode & Backup-Before-Migrate
- Alembic will manage all migrations in `apps/brain/alembic`.
- **Batch Mode:** SQLite does not natively support column dropping or table alteration without recreation. All Alembic operations must use `render_as_batch=True`:
  ```python
  with context.begin_transaction():
      context.run_migrations(render_as_batch=True)
  ```
- **Baseline Stamp:** A baseline revision stamps existing tables without recreating them (`alembic stamp head`).
- **Backup-Before-Migrate:** In Alembic's `env.py`, an automated pre-migration hook copies `argus.db` to `argus.db.bak.<timestamp>` before applying any schema modification.

---

## Consequences

### Positive
- **Elimination of Lock Contention:** Single writer completely eliminates `SQLITE_BUSY` deadlocks.
- **Unified Business Logic:** Expense calculations, debt ledgers, and reminders exist in only one codebase (Python).
- **Crash Resilience:** The bridge append-only journal guarantees zero message loss during brain downtime.
- **Migration Safety:** Alembic batch mode and automated file backups prevent data loss during schema evolution.

### Negative / Trade-offs
- Ingestion introduces local HTTP loopback latency (~2–5ms).
- Bridge requires disk space for its append-only ingestion journal.
