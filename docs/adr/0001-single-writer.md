# ADR 0001: Single Database Owner (Brain-Owned SQLite & Ingestion API)

## Status
**Proposed** (Awaiting approval before implementation)

## Context
In the current implementation of ARGUS:
1. Both `apps/bridge` (Node.js / TypeScript via `better-sqlite3`) and `apps/brain` (Python via standard `sqlite3`) open and write to `argus.db`.
2. Both processes execute direct `INSERT`, `UPDATE`, and `DELETE` statements across shared tables (`reminders`, `todos`, `expenses`, `pending_events`, `pending_outbox`, `tracked_followups`, `autopilot_rules`).
3. Business logic is duplicated: expense parsing and ledger calculations exist in both `apps/bridge/src/db.ts` and `apps/brain/agent_core.py`.
4. While SQLite supports WAL mode, concurrent multi-process writes across two runtimes (Node and Python) can cause `SQLITE_BUSY` database lock contention, race conditions, and inconsistent transactional state.

## Decision
1. **Designate `apps/brain` as the Sole Database Owner and Writer:**
   - `apps/brain` will manage all database connections, schema updates, and transactions for both `argus.db` and `argus_memory.db`.
   - The bridge (`apps/bridge`) will not execute direct writes or transactions on `argus.db`.
2. **Schema Migrations with Alembic:**
   - Introduce Alembic migrations in `apps/brain/alembic` to provide versioned, repeatable schema evolution.
3. **Optimized SQLite Concurrency Pragmas:**
   - Configure SQLite connection settings in `apps/brain`:
     - `PRAGMA journal_mode = WAL;`
     - `PRAGMA busy_timeout = 5000;`
     - `PRAGMA foreign_keys = ON;`
     - `PRAGMA synchronous = NORMAL;`
4. **Unified Business Logic:**
   - Unify expense ledger management, reminders scheduling, and todo tracking inside `apps/brain`. Remove duplicate implementations from the bridge.
5. **Authenticated Bridge Ingestion & State API:**
   - The bridge will communicate with the brain via authenticated HTTP endpoints (secured by `X-Argus-Secret` HMAC authentication):
     - `POST /api/ingest/message`: Bridge logs incoming/outgoing WhatsApp messages and updates contacts directory.
     - `GET /api/reminders/due`: Bridge reminder worker fetches due alerts.
     - `POST /api/reminders/:id/ack`: Bridge marks reminder as dispatched.
     - `POST /api/contacts/sync`: Bridge syncs contact metadata.
     - `GET /api/autopilot/rules`: Bridge retrieves active auto-reply rules.
     - `POST /api/events/propose`: Bridge notifies brain of meeting proposals.
6. **Bridge Resilience:**
   - If the brain is temporarily unreachable, `apps/bridge` will queue incoming ingestion events in an in-memory or append-only local journal and retry with exponential backoff.

## Consequences
### Positive
- **Zero Lock Collisions:** Eliminates dual-process database concurrency contention.
- **Single Source of Truth:** Business logic (expenses, balances, split calculations) is defined once.
- **Schema Safety:** Schema migrations are tracked and tested with Alembic.
- **Architectural Boundary:** Bridge focuses solely on WhatsApp protocol and I/O; Brain owns cognitive state and persistence.

### Negative / Trade-offs
- Bridge ingestion requires local HTTP calls to `127.0.0.1:8000` (or `http://argus-brain:8000` in Docker).
- Requires a lightweight queue in the bridge to handle temporary brain downtime gracefully.
