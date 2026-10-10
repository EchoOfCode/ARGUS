# ADR 0002: Strict Owner Authentication for Assistant Commands

## Status
**Proposed** (Awaiting approval before implementation)

## Context
1. In the initial design, ARGUS processed user commands whenever a message was received in a group named `ARGUS` (or in self-chat).
2. WhatsApp group names are client-side metadata and grant no cryptographic security:
   - Anyone added to the `ARGUS` group can send messages.
   - Any group can be renamed to `ARGUS`.
   - Contact display names and push names can be trivially spoofed by other WhatsApp users.
3. If an unprivileged user triggers commands, they could execute tools, read unread emails, query confidential Second Brain facts, or alter calendar schedules.
4. Modern WhatsApp uses two JID schemes:
   - Phone Number JIDs: `<country_code><phone>@s.whatsapp.net` (e.g. `919876543210@s.whatsapp.net`).
   - Linked Identity JIDs (LID): `<lid>@lid` (used internally by WhatsApp Web / Multi-Device for user identity).

## Decision
1. **Cryptographic Sender JID Verification:**
   - A command or instruction will only be executed if the **authenticated sender JID** matches the configured owner JID (`MY_JID`).
   - Group name alone (`DEDICATED_GROUP_NAME`) will **never** confer authorization.
2. **JID Normalization:**
   - Strip multi-device device specifiers (e.g., `919876543210:2@s.whatsapp.net` -> `919876543210@s.whatsapp.net`) before comparison.
   - Cache the owner's primary LID during initial Baileys pairing handshake, mapping both `owner_phone@s.whatsapp.net` and `owner_lid@lid` to authorized status.
3. **Ignore Non-Owner Commands:**
   - Messages from non-owners in the `ARGUS` group will be ignored for command processing and will never trigger any tool execution, LLM synthesis, or memory query.
   - Display names, contact names, and push names are strictly treated as untrusted metadata and never used for authentication decisions.
4. **Automated Verification:**
   - Add test fixtures asserting:
     - Messages sent by a non-owner in the `ARGUS` group return no-op.
     - Spoofed display names (e.g., a non-owner naming themselves after the owner) are rejected.
     - Valid normalized owner JIDs succeed.

## Consequences
### Positive
- **Guaranteed Isolation:** Non-owners cannot trigger actions or access private data regardless of group membership.
- **Resistant to Name Spoofing:** Relies strictly on cryptographic WhatsApp JIDs verified by WhatsApp servers.

### Negative / Trade-offs
- The owner must configure `MY_JID` accurately in `.env`.
- Requires mapping between owner's phone JID and LID during Baileys authentication initialization.
