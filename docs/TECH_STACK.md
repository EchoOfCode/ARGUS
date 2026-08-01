# Tech Stack

## Android app
- **Package name:** `com.yusuf.argus`
- **Language:** Kotlin
- **Min SDK:** 26+ (Doze/battery APIs assume this; adjust down only if a specific older-device need arises)
- **NotificationListenerService** — Android framework, no library needed
- **CalendarContract** — Android framework, no library needed
- **Room** (or plain SQLite via `SQLiteOpenHelper`) — local action queue
- **WorkManager** — retry queued candidates when the backend is unreachable
- **Retrofit + OkHttp** — HTTP client for calling the laptop backend
- **Jetpack Compose** — confirmation/edit UI (plain XML Views is functionally fine too, if preferred)
- Build tool: **Android Studio** (free), Gradle

## Laptop backend
- **Python 3.11+**
- **FastAPI** — HTTP server
- **uvicorn** — ASGI server to run FastAPI
- **groq** (official Python SDK) — Groq API calls
- **python-dotenv** — loads `GROQ_API_KEY` and the shared secret from a local `.env` file (never committed)
- **SQLite** — only if the backend needs to log requests for debugging; not required for core function since state lives on-device

## Networking
- **Tailscale** — free tier, private mesh VPN between laptop and phone

## Dev/ops
- **Git** — version control (`.env` in `.gitignore` from commit #1)
- **Android Studio Logcat** / FastAPI's built-in `--reload` dev server — local debugging, both free

## Explicitly avoid
- Any paid STT/TTS API (not needed for this feature — no voice component here)
- ngrok, or any tunnel that assigns a random public URL — inconsistent with the always-private design
- Google Calendar API — not needed unless the user later wants cross-device calendar sync
