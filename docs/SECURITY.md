# Security & Privacy Requirements

These are requirements, not suggestions — apply from Phase 1 onward.

## API key handling
- `GROQ_API_KEY` lives only in a `.env` file on the laptop, loaded via `python-dotenv`.
- `.env` is in `.gitignore` from the first commit — verify this before the first `git add`.
- The key is never sent to, stored on, or logged by the Android app.

## Backend network exposure
- FastAPI binds to the Tailscale interface address, not `0.0.0.0` on the public network interface.
- No port forwarding on the home router. If the backend ever needs to be reachable outside the tailnet, that's a deliberate future decision, not a default.

## Request authentication
- Tailscale network membership alone is not authentication — anyone who later joins the tailnet (e.g., a shared device) could otherwise reach the endpoint.
- Every request to `/extract-event` requires the `X-Argus-Secret` header, checked against a value in the backend's `.env`. Generate this secret with something like `openssl rand -hex 32` and store it in both the backend `.env` and the Android app's local config (inject at build/config time or store in Android's `EncryptedSharedPreferences` — never hardcode it in source).

## Local data on Android
- Notification text and extraction results are stored in local Room/SQLite — not uploaded anywhere except the single Groq extraction call per candidate.
- If the user later wants cloud backup, only encrypted archives should be synced — never the raw `.env`/secret files. Be explicit with the user that notification content would be included in that backup.

## Permissions the app requests, and why (for the user's own informed consent)
| Permission | Why | Risk if misused |
|---|---|---|
| Notification access (`BIND_NOTIFICATION_LISTENER_SERVICE`) | Read notification text to detect events | Could read ANY notification content — the allowlist restricts this in practice, but the OS grants broad access |
| Write Calendar | Add extracted events | Low risk — write-only use, no calendar reading planned |
| Battery optimization exemption | Keep the listener alive in Doze mode | Slightly higher battery use — expected and disclosed |

## Groq API data handling
- Only the notification text snippet and a timestamp are sent to Groq — no other phone data, no contacts, no broader message history.
- Treat this like any third-party API call: don't send more than the minimum needed for extraction.
