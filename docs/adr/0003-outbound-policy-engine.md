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
   - There is no single place to enforce user approval or audit outgoing transmissions.

## Decision
1. **Mandatory Choke Point for All Outbound Communication:**
   - All WhatsApp sends across the entire bridge codebase must route through a single function: `dispatchOutboundMessage()`.
   - Before calling Baileys `sendMessage()`, `dispatchOutboundMessage()` calls the brain's policy engine (`POST /api/policy/evaluate`) with:
     - Recipient JID (`target_jid`)
     - Candidate message text
     - Trigger reason (e.g. `autopilot`, `reminder`, `direct_draft`)
   - If policy evaluation returns `rejected` or `requires_confirmation`, the message will not be sent.
2. **Contact Autonomy Tiers:**
   - **Tier 0 (Draft Only - Default):** Assistant generates drafts and preview cards. No message is sent without explicit owner confirmation (`yes`). Global default for all contacts upon install and upgrade.
   - **Tier 1 (Supervised Approval):** Assistant drafts a suggested reply and sends an interactive preview card to the owner's command channel. Owner confirms with 1 tap or text reply.
   - **Tier 2 (Autonomous Send):** Assistant is permitted to automatically send responses without prior review, but **only** for explicitly allowlisted contacts and allowed topics, within strict rate limits.
   - Autonomy tier changes require authenticated owner commands. Auto-pilot is **off by default**.
3. **Safety Controls & Kill-Switch:**
   - **Global Emergency Kill-Switch:** A persistent flag (`killswitch_active`) which immediately drops all autonomous outbound messages across all contacts when activated via `autopilot off all` or `killswitch on`.
   - **Sliding-Window Rate Limits:** Maximum 3 autonomous messages per 10 minutes per recipient to prevent loop explosions.
   - **Immutable Outbound Audit Log:** Record every evaluation into `outbound_audit_log` (timestamp, target JID, trigger type, policy verdict, rationale). No secret tokens or credentials recorded.

## Consequences
### Positive
- **Architectural Guarantee:** Impossible for any tool, prompt injection, or background process to send a message without passing the policy engine.
- **Fail-Safe Defaults:** New installations and upgrades default to Tier 0 (Draft Only).
- **Total Visibility:** Complete audit trail of every outbound decision.

### Negative / Trade-offs
- Slight latency overhead (local HTTP roundtrip for policy evaluation) prior to each send.
- The owner must explicitly configure Tier 2 for contacts they wish to automate.
