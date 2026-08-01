# ARGUS — Notification-to-Calendar Assistant

## What this is
A personal Android app that reads incoming message notifications (WhatsApp, SMS, Telegram, etc.), detects when a message contains a meeting/event, extracts the date/time/title via an LLM (Groq API), and — after the user's confirmation — adds it to the phone's calendar.

This is a **personal, single-user, sideloaded app**. It is not intended for the Play Store and does not need to be.

## Hard constraints — do not violate these
- **Budget: $0.** Free tiers only. Groq API free tier, Tailscale free tier, no paid hosting, no paid APIs.
- **Confirm-first is mandatory in v1.** The app NEVER writes to the calendar without an explicit user tap. Auto-write (Phase 4) is a future opt-in setting, gated on measured extraction accuracy — do not implement it early even if it seems like a trivial flag to add.
- **NotificationListenerService, not AccessibilityService, for v1.** Do not reach for AccessibilityService "to get more context" unless Phases 1–3 are complete and notification previews are proven insufficient. AccessibilityService is heavier, drains more battery, and requires a much scarier permission grant.
- **API key lives only on the laptop backend.** Never embed the Groq API key in the Android app. Never commit it to git.
- **CalendarContract, not Google Calendar API**, for writing events — no OAuth needed, local device calendar only.

## Package contents
| File | Purpose |
|---|---|
| `ARCHITECTURE.md` | System design, data flow, component responsibilities, and why each decision was made |
| `TECH_STACK.md` | Exact libraries/tools per component |
| `ROADMAP.md` | Phased build order with acceptance criteria — build in this order, don't skip ahead |
| `API_SPEC.md` | Backend endpoint contract + exact JSON schemas |
| `SECURITY.md` | Key handling, permissions, network security requirements |

## Build order for the agent
1. Read `ARCHITECTURE.md` fully before writing any code.
2. Implement `ROADMAP.md` Phase 1 completely, and confirm it works, before starting Phase 2. Each phase has an acceptance criterion — treat it as a gate, not a suggestion.
3. Backend endpoints must match `API_SPEC.md` exactly — the Android client is written against that exact shape.
4. Apply `SECURITY.md` requirements from Phase 1 onward, not retrofitted at the end.

## Definition of done for v1 (Phases 1–3)
- Android app captures notification text from at least WhatsApp + SMS.
- On-device pre-filter discards non-event notifications without any network call.
- Plausible candidates are sent to the laptop backend, which calls Groq and returns structured JSON.
- High-confidence results push an Android notification with Yes / Edit / Ignore actions.
- Tapping "Yes" writes a real event to the Android calendar via `CalendarContract`.
- No event is ever written without the user tapping "Yes" or "Edit → Save."

## Explicitly out of scope for v1
- iOS support
- Multi-user support / accounts
- Auto-write without confirmation
- AccessibilityService / full-screen reading
- Anything requiring a paid API or paid hosting tier

If an implementation detail in the roadmap conflicts with a constraint in this file, this file wins.
