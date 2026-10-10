# API Contract — Laptop Backend

## POST /extract-event

### Auth
Header required on every request:
```
X-Argus-Secret: <shared secret from .env, matched exactly on the backend>
```
Requests without a matching header return `401`.

### Request body
```json
{
  "source_app": "com.whatsapp",
  "notification_text": "hey are we still on for tuesday at 3pm?",
  "received_at": "2026-07-31T14:02:00+05:30"
}
```
- `source_app`: Android package name of the notifying app
- `notification_text`: raw captured text (title + body concatenated is fine)
- `received_at`: ISO 8601 timestamp, phone-local time — needed so the model can resolve relative dates ("tomorrow", "next tuesday") correctly

### Response body
```json
{
  "is_event": true,
  "title": "Meeting",
  "date": "2026-08-04",
  "time": "15:00",
  "confidence": 0.82,
  "raw_text": "hey are we still on for tuesday at 3pm?"
}
```
- `is_event`: false if no event/meeting detected — other fields null in that case
- `title`: short, human-usable event title (infer something reasonable like "Meeting" or "Call with [name if present]," not just an echo of the raw text)
- `date`: `YYYY-MM-DD`, resolved to an absolute date using `received_at` as the reference point
- `time`: `HH:MM` 24-hour, null if no time was mentioned (all-day event)
- `confidence`: 0.0–1.0, model's self-assessed confidence this is a real, correctly-extracted event
- `raw_text`: echoed back so the Android app can display it on the "Edit" screen

### System prompt contract (backend → Groq)
The backend must instruct the model to:
- Return **only** valid JSON matching the schema above — no prose, no markdown code fences
- Use `received_at` as the reference "now" for resolving relative dates
- Set `is_event: false` (not a guess) when the text is ambiguous or clearly not a scheduling message
- Never fabricate a date/time that isn't reasonably inferable from the text

### Error responses
| Code | Meaning |
|---|---|
| 401 | Missing/invalid `X-Argus-Secret` header |
| 422 | Malformed request body |
| 502 | Groq API call failed or returned unparseable output — Android should treat this as "retry later," not as `is_event: false` |
