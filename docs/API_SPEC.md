# ARGUS AI Brain — API Specification & Contract

> **Service:** ARGUS Cognitive Engine (`apps/brain`)  
> **Default Port:** `8000` (Localhost Loopback / Docker Private Network)  
> **Auth Mechanisms:** HMAC-SHA256 (`X-Argus-Signature` & `X-Argus-Timestamp`) or Bearer Key (`ARGUS_WEB_ACCESS_KEY` / `ARGUS_SECRET`)

---

## 🔒 Authentication & Headers

### 1. Inter-Service HMAC Authentication (Bridge ↔ Brain)
Every request from the WhatsApp Bridge to the FastAPI Brain is authenticated using SHA-256 HMAC:
- `X-Argus-Signature`: Hex-encoded HMAC-SHA256 of `<timestamp>.<request_body>` using `ARGUS_SECRET`.
- `X-Argus-Timestamp`: Unix epoch millisecond timestamp (requests older than 300 seconds are rejected).
- `X-Argus-Secret`: *(Legacy fallback)* Raw secret string matched via constant-time comparison.

### 2. Web Client Authentication (Web Control Plane ↔ Brain)
- `X-Argus-Key`: Single-owner access key matched against `ARGUS_WEB_ACCESS_KEY` (or `ARGUS_SECRET`).
- `Authorization`: `Bearer <token>`

---

## 🧠 Core Agent & Cognitive Endpoints

### `POST /ask`
Single-turn conversational interface. Intercepted by **System 1 (Zero-Token Local Engine)** for deterministic commands before falling back to System 2 (Groq / Gemini).

#### Request Body
```json
{
  "question": "spent 50 on coffee",
  "chat_jid": "919876543210@s.whatsapp.net",
  "use_web_search": false
}
```

#### Response (System 1 Fast Path — < 5ms, 0 Tokens)
```json
{
  "answer": "💸 *Expense Recorded:* ₹50.00 for *coffee* `[#14]`",
  "system": 1,
  "intent": "expense"
}
```

---

### `POST /chat` (AG-UI Server-Sent Events Stream)
Real-time streaming agent loop for the Next.js Web Control Plane (`apps/web`). Emits standardized AG-UI Server-Sent Events for text tokens, tool execution cards, and lifecycle states.

#### Event Stream Protocol
```text
event: run_start
data: {"run_id": "run_01j...", "timestamp": 1728741000}

event: tool_call_start
data: {"tool_name": "get_financial_summary", "arguments": {}}

event: tool_call_result
data: {"tool_name": "get_financial_summary", "result": {"total_spent": 1250.0, "net_debt": 0}}

event: message_delta
data: {"delta": "You have spent ₹1,250 this month."}

event: run_finish
data: {"status": "completed"}
```

---

### `POST /documents/analyze`
Extracts schedules, deadlines, invoices, and structured notes from PDF and image uploads using Multimodal Vision & OCR.

#### Multipart Form Data
- `file`: Uploaded PDF or image (`multipart/form-data`)
- `context`: (Optional) User question or instruction text

#### Response
```json
{
  "success": true,
  "summary": "Midterm Examination Schedule",
  "extracted_events": [
    {
      "title": "Computer Networks Exam",
      "date": "2026-11-15",
      "time": "10:00"
    }
  ],
  "raw_text": "..."
}
```

---

## 🛡️ Outbound Policy & Autopilot Endpoints

### `POST /api/policy/evaluate`
Choke point evaluated before any outbound message is transmitted over WhatsApp (ADR 0003).

#### Request Body
```json
{
  "target_jid": "919876543210@s.whatsapp.net",
  "sender_name": "Alex Smith",
  "message_text": "Hey Alex, see you tomorrow at 4pm!",
  "trigger_type": "autopilot_reply",
  "is_group": false
}
```

#### Response (Approved — Tier 2 Autonomous)
```json
{
  "approved": true,
  "tier": 2,
  "undo_window_seconds": 8,
  "reason": "Whitelisted Tier 2 contact"
}
```

#### Response (Requires Confirmation — Tier 0 Draft)
```json
{
  "approved": false,
  "tier": 0,
  "approval_id": "appr_98234",
  "reason": "Contact set to Tier 0: Draft queued for human review"
}
```

---

### `POST /api/policy/approve`
Approves and releases a queued outbound message draft.

#### Request Body
```json
{
  "approval_id": "appr_98234",
  "message_text": "Hey Alex, see you tomorrow at 4pm!"
}
```

#### Response
```json
{
  "success": true,
  "released": true,
  "target_jid": "919876543210@s.whatsapp.net"
}
```

---

### `POST /api/autopilot/toggle`
Enables, disables, or sets autonomy tiers for contacts, or triggers the **Global Bulk Killswitch**.

#### Request Body (Bulk Emergency Killswitch)
```json
{
  "global_disable": true
}
```

#### Request Body (Per-Contact Tier Update)
```json
{
  "jid": "919876543210@s.whatsapp.net",
  "name": "Alex",
  "status": "active",
  "tier": 2
}
```

---

## ⚙️ Operating Mode & System Settings

### `GET /api/mode`
Returns whether ARGUS is currently in **Online** or **Offline** mode.

#### Response
```json
{
  "offline_mode": false,
  "label": "Online (System 1 Local + System 2 Cloud)",
  "cloud_ai_active": true
}
```

### `POST /api/mode`
Switches operating mode.

#### Request Body
```json
{
  "offline_mode": true
}
```

#### Response
```json
{
  "success": true,
  "offline_mode": true,
  "message": "Offline Mode Enabled (System 1 Only — 0 Cloud Tokens)"
}
```

---

## 📋 Task & Ledger Endpoints

### `GET /api/todos`
Lists pending and completed todos.

### `POST /api/todos`
```json
{
  "chat_jid": "self",
  "text": "Buy groceries"
}
```

### `DELETE /api/todos/{id}`
Deletes or marks completed a todo item.

---

### `GET /api/ledger`
Returns monthly spending, all-time totals, category breakdowns, and active debts.

#### Response
```json
{
  "monthly_total": 450.0,
  "all_time_total": 3200.0,
  "debts": [
    {
      "id": 1,
      "person": "Alex",
      "amount": 225.0,
      "is_debt": 1,
      "description": "Lunch split"
    }
  ]
}
```

---

## 🩺 System Health

### `GET /health`
```json
{
  "status": "healthy",
  "version": "2.4.0",
  "database": "connected",
  "offline_mode": false,
  "killswitch_active": false,
  "timestamp": "2026-10-12T20:30:00Z"
}
```
