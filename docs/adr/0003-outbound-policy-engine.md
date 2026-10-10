# ADR 0003: Mandatory Outbound Policy Engine and Multi-Tier Autonomy

## Status
**Proposed** (Awaiting approval before implementation)

## Context

1. In the legacy implementation, multiple disconnected components could trigger WhatsApp messages directly:
   - Auto-pilot replies (`replySender.ts`)
   - Outbox draft confirmations
   - Reminder workers (`reminderWorker.ts`)
   - ReAct tools (`draft_whatsapp_message`)
2. Without a centralized policy gatekeeper:
   - A hallucinating model or prompt injection could trigger unauthorized outbound messages.
   - Runaway loops could spam contacts without rate limits.
   - There was no single place to enforce user approval, apply rate limiting, or audit outgoing transmissions.

---

## Decision

### 1. Separation of Flows: Owner-Initiated Sends vs. Assistant-Initiated Replies
We separate outbound message dispatch into two distinct architectural pipelines:

#### A. Owner-Initiated Sends (e.g. `tell Alex I'm running late`)
- **Trigger:** Authenticated owner command in the pinned command channel.
- **Workflow:** Brain drafts message -> presents preview card to owner in command channel -> owner confirms with `yes` or button.
- **Policy Check:** Bypasses auto-pilot contact tiers, but is verified against the server-side approval record, recipient rate limits, and logged to the audit log.

#### B. Assistant-Initiated Replies (Reactive / Auto-Pilot)
- **Trigger:** Inbound message received from an external contact.
- **Governed strictly by Contact Autonomy Tiers** (Tiers 0, 1, 2).

---

### 2. Contact Autonomy Tiers (Assistant-Initiated)

- **Tier 0 (Draft Only — Global Default):**
  - Assistant generates draft reply and delivers a preview card to the owner's command channel.
  - **No message is sent to the contact without explicit owner confirmation (`yes`).**
  - Default for all contacts upon new install and upon migration from legacy versions.
- **Tier 1 (Supervised Approval):**
  - Assistant drafts a suggested reply. Brain generates a time-bound server approval record.
  - Owner receives an interactive card with `Approve` / `Edit` / `Decline`.
  - Upon approval, the message is dispatched.
- **Tier 2 (Autonomous Auto-Send — 1:1 Only):**
  - Assistant may automatically send replies, **strictly limited to**:
    1. Contacts on an explicit **Contact Allowlist**.
    2. **Strictly 1-on-1 chats** (`isJidGroup() === false`). Autonomous replies in group chats are strictly prohibited in v1.
    3. **Configurable Undo Window:** Bridge imposes an 8-second delay before dispatch, notifying the owner channel (`"Sending reply to Alex in 8s... [Cancel]"`). If the owner sends `cancel`, dispatch is aborted.
- *(Note: Topic allowlists are dropped for v1 to avoid non-deterministic prompt classification risks).*

---

### 3. Fail-Closed Policy Enforcement
All outbound WhatsApp sends across the entire codebase must flow through a single gateway function: `dispatchOutboundMessage()`.
- Before invoking Baileys `sock.sendMessage()`, `dispatchOutboundMessage()` calls Brain endpoint `POST /api/policy/evaluate`.
- **Fail-Closed Rule:** If the Brain is unreachable, returns an error (HTTP 4xx/5xx), or fails to respond within a **3000ms timeout**, the policy engine **FAILS CLOSED**. Zero bytes are transmitted to WhatsApp.

---

### 4. Architectural Enforcement: ESLint Rule & CI Test
To mathematically guarantee that no developer or subsystem can bypass the policy engine:
1. **ESLint Rule:** A custom AST rule (or `no-restricted-syntax`) flags any direct call to `sock.sendMessage()` or `sendMessage` outside `apps/bridge/src/policy/dispatcher.ts`.
2. **CI Pipeline Verification:** The `test-bridge` CI job checks that `dispatchOutboundMessage` is the only symbol across the bridge codebase calling Baileys `sendMessage`.

---

### 5. Server-Side Approval Records (Bound to Text Hash & Expiry)
For Tier 1 and owner-initiated drafts, approvals do not rely on fragile client-side string matches.
1. Brain creates an approval record in SQLite:
   ```sql
   CREATE TABLE pending_approvals (
     id TEXT PRIMARY KEY,
     target_jid TEXT NOT NULL,
     content_sha256 TEXT NOT NULL,
     trigger_type TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     expires_at TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending'
   );
   ```
2. When the owner confirms, the bridge transmits the `approval_id` and message text to `POST /api/policy/approve`.
3. The Brain validates:
   - Record exists and `status == 'pending'`.
   - `datetime('now') <= expires_at` (default TTL: 15 minutes).
   - `sha256(message_text) === content_sha256` (guarantees content was not tampered with or desynchronized).

---

### 6. Server-Derived Triggers
The trigger type (`owner_command`, `autopilot_reply`, `reminder_alert`) cannot be spoofed by a client payload. The Brain derives and validates trigger state from verified server-side session context before issuing an approval token.

---

### 7. Global Cap, Circuit Breakers & Loop Detection
To prevent runaway messaging storms:
1. **Global Hourly Cap:** Maximum 10 autonomous messages per hour across all contacts combined. Once exceeded, auto-pilot immediately halts globally and alerts the owner.
2. **Per-Contact Rate Limit:** Maximum 3 autonomous messages per 10 minutes for any single contact.
3. **Loop Detection:** If an external contact and ARGUS alternate >= 3 consecutive messages within 2 minutes without owner intervention, the contact is automatically quarantined to Tier 0, and an alert is sent to the command group.
4. **Global Emergency Kill-Switch:** Owner command `autopilot off all` or `killswitch on` immediately flips a persistent flag that blocks all autonomous messages.

---

### 8. Immutable Append-Only Audit Log
Every outbound dispatch decision is recorded in `outbound_audit_log`:
```sql
CREATE TABLE outbound_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  target_jid TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  tier INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  verdict TEXT NOT NULL, -- 'approved', 'rejected', 'timed_out'
  rejection_reason TEXT
);

-- Enforce append-only immutability at SQLite engine level
CREATE TRIGGER prevent_audit_log_update
BEFORE UPDATE ON outbound_audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log is append-only and cannot be modified');
END;

CREATE TRIGGER prevent_audit_log_delete
BEFORE DELETE ON outbound_audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log is append-only and cannot be deleted');
END;
```
- **Privacy Assurance:** Message bodies are **never** logged in the audit log; only cryptographic `content_sha256` hashes are recorded.

---

### 9. Migration of Existing Auto-Pilot Rules
During Alembic migration, all existing records in `autopilot_rules` are updated:
```sql
UPDATE autopilot_rules SET status = 'disabled', tier = 0;
```
Auto-pilot and autonomous sending are strictly opt-in post-migration.

---

## Consequences

### Positive
- **Guaranteed Gatekeeping:** Impossible for any tool, prompt injection, or background job to dispatch messages without policy approval.
- **Fail-Safe Defaults:** System fails closed on timeout or crash; Tier 0 is default everywhere.
- **Auditable & Tamper-Proof:** Trigger-enforced SQLite immutability ensures an exact, non-repudiable audit trail.
- **Anti-Spam & Anti-Loop:** Built-in loop detection and global caps prevent conversational runaways.

### Negative / Trade-offs
- Adds a 3–15ms policy check roundtrip prior to each send.
- Autonomous sending in v1 is restricted strictly to 1:1 chats for allowlisted contacts.
