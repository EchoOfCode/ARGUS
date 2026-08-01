# Roadmap

Build strictly in this order. Do not start a phase until the previous phase's acceptance criteria are met.

## Phase 1 — Notification capture (no LLM yet)
- [ ] Create Android project (Kotlin, min SDK 26+)
- [ ] Implement `NotificationListenerService`, request the listener permission via the system settings intent
- [ ] Maintain an allowlist of app packages to listen to (start with WhatsApp + default SMS app)
- [ ] Log captured notifications (app package, text, timestamp) to a local Room/SQLite table — no network calls yet
- [ ] Request battery optimization exemption on first run

**Acceptance criteria:** sending yourself a WhatsApp/SMS message with a date/time reference results in a row in the local database, visible via a debug screen or Logcat.

## Phase 2 — Pre-filter + backend extraction
- [ ] Implement the on-device regex/keyword pre-filter (day names, time patterns, meeting keywords)
- [ ] Stand up the FastAPI backend on the laptop with `POST /extract-event` (see API_SPEC.md)
- [ ] Wire the Groq SDK call inside that endpoint, matching the exact prompt/response contract in API_SPEC.md
- [ ] Set up Tailscale on both laptop and phone, confirm they can reach each other
- [ ] Android: on a pre-filter match, POST the candidate to the backend over Tailscale; store the returned result against the queue row

**Acceptance criteria:** a real message like "let's meet tuesday at 3pm" produces a backend response with `is_event: true`, a plausible title, date, and time, visible in the local queue table.

## Phase 3 — Confirm-first calendar write
- [ ] On high-confidence extraction (hardcode an initial threshold, e.g. confidence ≥ 0.7 — tune later, don't guess once and leave it forever), push an Android notification with Yes / Edit / Ignore actions
- [ ] "Yes" → write directly to `CalendarContract.Events`
- [ ] "Edit" → open a minimal edit screen (title/date/time fields, pre-filled), then write on save
- [ ] "Ignore" → mark the queue row as ignored, no further prompts for that item
- [ ] Handle the backend-unreachable case: queue the candidate via WorkManager, retry later, don't drop it silently

**Acceptance criteria:** end-to-end — send yourself a real meeting message, get a confirmation notification, tap Yes, see the event appear in your phone's calendar app.

## Phase 4 — Auto-add tuning (only after Phases 1–3 have real usage, for at least a couple weeks)
- [ ] Track actual accuracy: how often "Yes" was tapped unedited vs. "Edit" vs. "Ignore," per confidence bucket
- [ ] Only if a confidence bucket shows consistently correct extraction, offer an opt-in setting: "auto-add events above X% confidence, still confirm below that"
- [ ] Never remove the fallback to confirm-first

**Acceptance criteria:** you have real usage data before this phase starts, not a guess.
