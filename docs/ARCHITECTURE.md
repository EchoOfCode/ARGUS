# Architecture

## System diagram

```
Android Phone
 ├─ NotificationListenerService (always running)
 │    → captures (app_package, notification_text, posted_at) for every new notification
 │
 ├─ On-device pre-filter (pure Kotlin, no network call)
 │    → regex/keyword check: does text plausibly reference a date, time, or meeting?
 │    → ~90%+ of notifications are discarded here (likes, promos, unrelated chats)
 │
 ├─ (only for plausible candidates) HTTP POST over Tailscale ──────► Laptop backend
 │
 ├─ Local action queue (Room/SQLite) — stores pending candidates + extraction results
 │
 ├─ Confirmation notification (Yes / Edit / Ignore actions)
 │
 └─ CalendarContract.Events write (on user confirmation only)

Laptop (always-on while in use; phone queues if laptop is offline)
 ├─ FastAPI server, reachable only via Tailscale (no public port)
 ├─ POST /extract-event endpoint (see API_SPEC.md)
 ├─ Groq API call with a strict extraction prompt
 └─ Returns structured JSON: is_event, title, date, time, confidence

Groq API
 └─ LLM inference only. Receives a text snippet + extraction instructions, nothing else.
```

## Component responsibilities

### 1. NotificationListenerService (Android)
- Registers as a system notification listener (`android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`).
- On `onNotificationPosted`, extract `packageName`, notification title/text, and timestamp.
- Maintain an allowlist of app packages (WhatsApp, Messages/SMS, Telegram, etc.) — don't process everything by default. Reduces noise and battery use.
- Must survive Doze mode: request battery optimization exemption from the user on first run (standard Android intent, not a hack) — this is a personal app the user installs deliberately.

### 2. On-device pre-filter
- Pure text heuristics, zero network calls, runs in milliseconds.
- Looks for: day names, relative date words (tomorrow, next week), time patterns (3pm, 15:00, 3:30), and meeting-indicating words (meet, call, appointment, sync, catch up).
- Purpose: protect the Groq free-tier rate limit and the user's battery — most notifications never leave the phone.

### 3. Local action queue
- SQLite/Room table: candidate text, source app, extraction result (once returned), status (pending/confirmed/ignored), timestamps.
- If the laptop backend is unreachable, candidates queue locally and retry (e.g., via WorkManager) rather than being dropped silently.

### 4. Confirmation UI
- A local Android notification with three actions: Yes (write as-is), Edit (open a small edit screen, then save), Ignore (discard, mark as ignored so it's not re-prompted).
- This is the trust-building layer. Do not remove it in v1 regardless of how confident extraction seems.

### 5. Calendar write
- Uses `CalendarContract.Events` content provider directly — requires `WRITE_CALENDAR` permission, no OAuth, no internet call needed for this step.
- Writes to the device's default local calendar unless the user configures otherwise.

### 6. Laptop backend (FastAPI)
- Single responsibility: receive text, call Groq with a structured-extraction prompt, return structured JSON. Stateless per request — the queue/history lives on the phone, not the backend. Keeps the backend simple and avoids two-way state sync.
- Bound to the Tailscale interface, not `0.0.0.0` on the public interface — should not be reachable outside the private tailnet.
- Requires a shared-secret header on every request (see SECURITY.md) — Tailscale network membership is not, by itself, request authentication.

### 7. Groq call
- One call per candidate, using a fixed system prompt (exact contract in API_SPEC.md) instructing the model to return **only** JSON — no prose, no markdown fences.
- Low `max_tokens` — this is a short structured extraction, not a conversation. Keeps responses fast and free-tier-efficient.

## Why these specific decisions

| Decision | Alternative considered | Why this one |
|---|---|---|
| NotificationListenerService | AccessibilityService | Lighter weight, less invasive permission, sufficient for v1 |
| CalendarContract (local) | Google Calendar API | No OAuth setup, no internet dependency for the write itself |
| Confirm-first | Full auto-write | Extraction will make mistakes; auto-write with no accuracy data erodes trust fast |
| Laptop as backend | On-phone LLM call | Keeps Groq key off the phone; backend can be reused for a broader assistant later |
| Tailscale | ngrok / public port | Free, private, stable hostname, no exposed attack surface |
| On-device pre-filter | Send everything to Groq | Protects free-tier rate limits and battery |
