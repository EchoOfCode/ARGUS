"""
ARGUS Web Cockpit Dashboard.
Serves a high-aesthetic local web UI at http://localhost:8000/dashboard
"""

import os
import sqlite3
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

dashboard_router = APIRouter(tags=["dashboard"])

BRIDGE_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "bridge", "argus.db")
MEMORY_DB_PATH = os.path.join(os.path.dirname(__file__), "argus_memory.db")


def get_bridge_db():
    """Connect to the bridge's SQLite database."""
    if os.path.exists(BRIDGE_DB_PATH):
        conn = sqlite3.connect(BRIDGE_DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn
    return None


def get_memory_db():
    """Connect to the memory database."""
    if os.path.exists(MEMORY_DB_PATH):
        conn = sqlite3.connect(MEMORY_DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn
    return None


# ─── API Endpoints for Web Cockpit ──────────────────────────────

@dashboard_router.get("/api/dashboard/stats")
async def get_dashboard_stats() -> Dict[str, Any]:
    from groq_client import _get_model, _get_provider_config, _get_owner_info

    provider, _, _, _, default_model = _get_provider_config()
    model = _get_model()
    owner_name, owner_bio, owner_tone = _get_owner_info()

    mem_count = 0
    mem_db = get_memory_db()
    if mem_db:
        try:
            cursor = mem_db.cursor()
            cursor.execute("SELECT COUNT(*) FROM memories")
            mem_count = cursor.fetchone()[0]
        except Exception:
            pass
        finally:
            mem_db.close()

    contact_count = 0
    event_count = 0
    autopilot_count = 0
    bridge_db = get_bridge_db()
    if bridge_db:
        try:
            cursor = bridge_db.cursor()
            cursor.execute("SELECT COUNT(*) FROM chat_directory WHERE is_group = 0")
            contact_count = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM pending_events WHERE status = 'confirmed'")
            event_count = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM autopilot_rules WHERE status = 'active'")
            autopilot_count = cursor.fetchone()[0]
        except Exception:
            pass
        finally:
            bridge_db.close()

    return {
        "status": "online",
        "owner_name": owner_name,
        "owner_bio": owner_bio,
        "owner_tone": owner_tone,
        "llm_provider": provider.upper(),
        "llm_model": model,
        "total_memories": mem_count,
        "total_contacts": contact_count,
        "upcoming_events": event_count,
        "active_autopilot_rules": autopilot_count,
    }


@dashboard_router.get("/api/dashboard/contacts")
async def get_contacts(search: Optional[str] = None) -> List[Dict[str, Any]]:
    bridge_db = get_bridge_db()
    if not bridge_db:
        return []

    try:
        cursor = bridge_db.cursor()
        if search:
            q = f"%{search}%"
            cursor.execute(
                "SELECT jid, name, is_group, updated_at FROM chat_directory WHERE name LIKE ? ORDER BY name ASC LIMIT 100",
                (q,),
            )
        else:
            cursor.execute(
                "SELECT jid, name, is_group, updated_at FROM chat_directory ORDER BY is_group ASC, name ASC LIMIT 150"
            )
        rows = cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        bridge_db.close()


@dashboard_router.get("/api/dashboard/autopilot")
async def get_autopilot_rules() -> List[Dict[str, Any]]:
    bridge_db = get_bridge_db()
    if not bridge_db:
        return []

    try:
        cursor = bridge_db.cursor()
        cursor.execute("SELECT * FROM autopilot_rules ORDER BY created_at DESC")
        rows = cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        bridge_db.close()


@dashboard_router.post("/api/dashboard/autopilot/toggle")
async def toggle_autopilot_rule(data: Dict[str, Any]) -> Dict[str, Any]:
    jid = data.get("jid")
    if not jid:
        raise HTTPException(status_code=400, detail="JID required")

    bridge_db = get_bridge_db()
    if not bridge_db:
        raise HTTPException(status_code=500, detail="Database unavailable")

    try:
        cursor = bridge_db.cursor()
        cursor.execute("SELECT status FROM autopilot_rules WHERE jid = ?", (jid,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Rule not found")

        new_status = "inactive" if row["status"] == "active" else "active"
        cursor.execute("UPDATE autopilot_rules SET status = ? WHERE jid = ?", (new_status, jid))
        bridge_db.commit()
        return {"success": True, "jid": jid, "status": new_status}
    finally:
        bridge_db.close()


@dashboard_router.post("/api/dashboard/contacts/upload-vcf")
async def upload_vcf_file(request: Request) -> Dict[str, Any]:
    content = await request.body()
    text = content.decode("utf-8", errors="ignore")

    lines = text.splitlines()
    imported_count = 0
    bridge_db = get_bridge_db()
    if not bridge_db:
        raise HTTPException(status_code=500, detail="Bridge DB not found")

    try:
        cursor = bridge_db.cursor()
        current_name = None
        current_phone = None

        for line in lines:
            line_str = line.strip()
            if line_str.startswith("BEGIN:VCARD"):
                current_name = None
                current_phone = None
            elif line_str.startswith("FN:") or line_str.startswith("FN;"):
                current_name = line_str.split(":", 1)[-1].strip()
            elif not current_name and (line_str.startswith("N:") or line_str.startswith("N;")):
                parts = line_str.split(":", 1)[-1].split(";")
                current_name = " ".join(p.strip() for p in reversed(parts) if p.strip())
            elif line_str.startswith("TEL") or "TEL;" in line_str:
                raw_num = line_str.split(":", 1)[-1]
                clean = "".join(c for c in raw_num if c.isdigit())
                if len(clean) >= 7:
                    current_phone = clean
            elif line_str.startswith("END:VCARD"):
                if current_name and current_phone:
                    if len(current_phone) == 10:
                        current_phone = "91" + current_phone
                    jid = f"{current_phone}@s.whatsapp.net"
                    cursor.execute(
                        """
                        INSERT INTO chat_directory (jid, name, is_group, updated_at)
                        VALUES (?, ?, 0, datetime('now'))
                        ON CONFLICT(jid) DO UPDATE SET name = excluded.name, updated_at = datetime('now')
                        """,
                        (jid, current_name),
                    )
                    imported_count += 1
                current_name = None
                current_phone = None

        bridge_db.commit()
        return {"success": True, "imported": imported_count}
    finally:
        bridge_db.close()


@dashboard_router.get("/api/dashboard/events")
async def get_upcoming_events() -> List[Dict[str, Any]]:
    bridge_db = get_bridge_db()
    if not bridge_db:
        return []

    try:
        cursor = bridge_db.cursor()
        cursor.execute(
            """
            SELECT id, title, event_date, event_time, original_text, status, created_at 
            FROM pending_events 
            WHERE status = 'confirmed' 
            ORDER BY event_date ASC, event_time ASC 
            LIMIT 25
            """
        )
        return [dict(r) for r in cursor.fetchall()]
    finally:
        bridge_db.close()


@dashboard_router.get("/api/dashboard/finances")
async def get_dashboard_finances() -> Dict[str, Any]:
    bridge_db = get_bridge_db()
    if not bridge_db:
        return {"total_spent": 0, "expenses": [], "debts_owed_to_me": [], "i_owe": []}

    try:
        cursor = bridge_db.cursor()
        cursor.execute("SELECT * FROM expenses WHERE is_debt = 0 ORDER BY created_at DESC LIMIT 30")
        expenses = [dict(r) for r in cursor.fetchall()]
        total_spent = sum(e["amount"] for e in expenses)

        cursor.execute("SELECT * FROM expenses WHERE is_debt = 1 ORDER BY created_at DESC LIMIT 30")
        owed_to_me = [dict(r) for r in cursor.fetchall()]

        cursor.execute("SELECT * FROM expenses WHERE is_debt = 2 ORDER BY created_at DESC LIMIT 30")
        i_owe = [dict(r) for r in cursor.fetchall()]

        return {
            "total_spent": total_spent,
            "expenses": expenses,
            "debts_owed_to_me": owed_to_me,
            "i_owe": i_owe,
        }
    finally:
        bridge_db.close()


@dashboard_router.get("/api/dashboard/followups")
async def get_dashboard_followups() -> List[Dict[str, Any]]:
    bridge_db = get_bridge_db()
    if not bridge_db:
        return []

    try:
        cursor = bridge_db.cursor()
        cursor.execute(
            "SELECT * FROM tracked_followups WHERE status IN ('waiting', 'nudged') ORDER BY sent_at DESC LIMIT 20"
        )
        return [dict(r) for r in cursor.fetchall()]
    finally:
        bridge_db.close()


@dashboard_router.post("/api/dashboard/chat")
async def dashboard_chat(data: Dict[str, Any]) -> Dict[str, Any]:
    prompt = data.get("prompt", "")
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    from agent_core import run_autonomous_agent
    try:
        answer = run_autonomous_agent(user_prompt=prompt)
        return {"success": True, "answer": answer}
    except Exception as e:
        logger.error("Dashboard chat failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ─── Dashboard Web UI (HTML + CSS + JS) ─────────────────────────

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ARGUS Control Center — AI Chief of Staff</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #07090E;
      --bg-surface: #0E121B;
      --bg-card: rgba(18, 24, 38, 0.7);
      --bg-glass: rgba(255, 255, 255, 0.03);
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-glow: rgba(0, 240, 255, 0.25);
      --cyan: #00F0FF;
      --cyan-glow: rgba(0, 240, 255, 0.15);
      --violet: #8A2BE2;
      --violet-glow: rgba(138, 43, 226, 0.2);
      --emerald: #10B981;
      --rose: #F43F5E;
      --amber: #F59E0B;
      --text-main: #F8FAFC;
      --text-muted: #94A3B8;
      --text-dim: #64748B;
      --radius-lg: 16px;
      --radius-md: 12px;
      --radius-sm: 8px;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'Inter', sans-serif;
    }

    body {
      background-color: var(--bg-base);
      color: var(--text-main);
      min-height: 100vh;
      overflow-x: hidden;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(0, 240, 255, 0.04) 0%, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(138, 43, 226, 0.04) 0%, transparent 40%);
    }

    /* Top Navigation Bar */
    header {
      position: sticky;
      top: 0;
      z-index: 50;
      backdrop-filter: blur(20px);
      background: rgba(7, 9, 14, 0.85);
      border-bottom: 1px solid var(--border-subtle);
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-icon {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      background: linear-gradient(135deg, var(--cyan), var(--violet));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 20px var(--cyan-glow);
    }

    .brand-title h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 1px;
      background: linear-gradient(to right, #FFFFFF, var(--cyan));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .brand-title p {
      font-size: 11px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 1.5px;
      font-weight: 600;
    }

    .status-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      color: var(--emerald);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--emerald);
      box-shadow: 0 0 10px var(--emerald);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }

    /* Main Container & Layout */
    .container {
      max-width: 1380px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    /* Stat Cards Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 24px;
      backdrop-filter: blur(16px);
      transition: all 0.25s ease;
      position: relative;
      overflow: hidden;
    }

    .stat-card:hover {
      border-color: var(--border-glow);
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--cyan), transparent);
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .stat-card:hover::before {
      opacity: 1;
    }

    .stat-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .stat-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
    }

    .stat-icon {
      font-size: 18px;
    }

    .stat-value {
      font-family: 'Outfit', sans-serif;
      font-size: 32px;
      font-weight: 700;
      color: #FFF;
    }

    .stat-sub {
      font-size: 12px;
      color: var(--text-dim);
      margin-top: 4px;
    }

    /* Tabs Bar */
    .tabs-nav {
      display: flex;
      gap: 12px;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 16px;
      margin-bottom: 28px;
      overflow-x: auto;
    }

    .tab-btn {
      padding: 10px 20px;
      border-radius: var(--radius-md);
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .tab-btn:hover {
      color: #FFF;
      background: var(--bg-glass);
    }

    .tab-btn.active {
      color: #FFF;
      background: var(--bg-surface);
      border-color: var(--border-glow);
      box-shadow: 0 0 20px var(--cyan-glow);
    }

    /* Section Panels */
    .panel {
      display: none;
      animation: fadeIn 0.3s ease;
    }

    .panel.active {
      display: block;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Content Cards */
    .content-box {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 28px;
      backdrop-filter: blur(16px);
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .section-title {
      font-family: 'Outfit', sans-serif;
      font-size: 20px;
      font-weight: 700;
    }

    .search-input {
      padding: 10px 16px;
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-subtle);
      color: #FFF;
      font-size: 14px;
      outline: none;
      width: 280px;
      transition: all 0.2s ease;
    }

    .search-input:focus {
      border-color: var(--cyan);
      box-shadow: 0 0 15px var(--cyan-glow);
    }

    /* Contacts & Cards Grid */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
    }

    .item-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.2s ease;
    }

    .item-card:hover {
      border-color: var(--border-glow);
      background: rgba(255, 255, 255, 0.04);
    }

    .item-info h4 {
      font-size: 15px;
      font-weight: 600;
      color: #FFF;
      margin-bottom: 4px;
    }

    .item-info p {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* Toggle Switch */
    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(255, 255, 255, 0.1);
      transition: .3s;
      border-radius: 24px;
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s;
      border-radius: 50%;
    }

    input:checked + .slider {
      background-color: var(--cyan);
      box-shadow: 0 0 10px var(--cyan);
    }

    input:checked + .slider:before {
      transform: translateX(20px);
    }

    /* Drag & Drop Upload Zone */
    .dropzone {
      border: 2px dashed rgba(0, 240, 255, 0.3);
      border-radius: var(--radius-lg);
      padding: 36px;
      text-align: center;
      background: rgba(0, 240, 255, 0.02);
      cursor: pointer;
      transition: all 0.2s ease;
      margin-bottom: 24px;
    }

    .dropzone:hover {
      border-color: var(--cyan);
      background: rgba(0, 240, 255, 0.05);
    }

    .dropzone-icon {
      font-size: 36px;
      margin-bottom: 12px;
    }

    .dropzone-title {
      font-size: 16px;
      font-weight: 600;
      color: #FFF;
      margin-bottom: 6px;
    }

    .dropzone-sub {
      font-size: 13px;
      color: var(--text-dim);
    }
  </style>
</head>
<body>

  <!-- Top Header -->
  <header>
    <div class="brand">
      <div class="brand-icon">👁️</div>
      <div class="brand-title">
        <h1>ARGUS COCKPIT</h1>
        <p>Autonomous AI Chief of Staff</p>
      </div>
    </div>
    <div class="status-badge">
      <div class="status-dot"></div>
      <span id="provider-badge">AI Brain: Online</span>
    </div>
  </header>

  <div class="container">

    <!-- Overview Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-label">LLM Provider</span>
          <span class="stat-icon">🧠</span>
        </div>
        <div class="stat-value" id="stat-provider">GROQ</div>
        <div class="stat-sub" id="stat-model">llama-3.3-70b</div>
      </div>

      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-label">Active Auto-Pilot</span>
          <span class="stat-icon">🤖</span>
        </div>
        <div class="stat-value" id="stat-autopilot">0</div>
        <div class="stat-sub">Automated Persona Rules</div>
      </div>

      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-label">Second Brain Vault</span>
          <span class="stat-icon">💾</span>
        </div>
        <div class="stat-value" id="stat-memories">0</div>
        <div class="stat-sub">Persistent Fact Memories</div>
      </div>

      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-label">Synced Contacts</span>
          <span class="stat-icon">📇</span>
        </div>
        <div class="stat-value" id="stat-contacts">0</div>
        <div class="stat-sub">WhatsApp Address Book</div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-nav">
      <button class="tab-btn active" onclick="switchTab('chat')">💬 Live Agent Studio</button>
      <button class="tab-btn" onclick="switchTab('finances')">💸 Financial Ledger</button>
      <button class="tab-btn" onclick="switchTab('followups')">⏳ Follow-up Tracker</button>
      <button class="tab-btn" onclick="switchTab('contacts')">📇 Address Book & Sync</button>
      <button class="tab-btn" onclick="switchTab('autopilot')">🤖 Auto-Pilot Rules</button>
      <button class="tab-btn" onclick="switchTab('memories')">🧠 Second Brain Vault</button>
      <button class="tab-btn" onclick="switchTab('calendar')">📅 Upcoming Calendar</button>
    </div>

    <!-- Panel 0: Live Agent Studio -->
    <div id="panel-chat" class="panel active">
      <div class="content-box">
        <div class="section-header">
          <h3 class="section-title">💬 Live Autonomous Agent Cockpit</h3>
          <span style="font-size: 12px; color: var(--cyan);">✨ Real-Time Tool Calling & Memory</span>
        </div>
        
        <div id="chat-messages" style="min-height: 280px; max-height: 480px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
          <div style="background: rgba(0, 240, 255, 0.08); border-left: 3px solid var(--cyan); padding: 12px 16px; border-radius: 8px;">
            <strong>👁️ ARGUS Agent:</strong> Hello boss! I have direct access to your WhatsApp contacts, calendar, memories, debts, and web search. How can I assist you?
          </div>
        </div>

        <div style="display: flex; gap: 12px;">
          <input type="text" id="web-chat-input" placeholder="Ask ARGUS or give a command (e.g. 'contacts starting with b', 'schedule meeting tomorrow at 4pm')..." style="flex: 1; padding: 14px 18px; border-radius: var(--radius-md); background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle); color: #fff; outline: none; font-size: 14px;" onkeydown="if(event.key==='Enter') sendWebChat()">
          <button onclick="sendWebChat()" style="padding: 14px 24px; border-radius: var(--radius-md); background: linear-gradient(135deg, var(--cyan), var(--violet)); border: none; color: #fff; font-weight: 700; cursor: pointer;">Send ⚡</button>
        </div>
      </div>
    </div>

    <!-- Panel 1: Financial & Debt Ledger -->
    <div id="panel-finances" class="panel">
      <div class="content-box">
        <div class="section-header">
          <h3 class="section-title">💸 Conversational Financial & Split Ledger</h3>
          <span id="finances-total" style="font-weight: 700; color: var(--emerald); font-size: 16px;">Total Spent: ₹0</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 16px;">
          <div>
            <h4 style="color: var(--cyan); margin-bottom: 12px;">🟢 Money Owed to You (Debts)</h4>
            <div id="debts-owed-list" class="cards-grid" style="grid-template-columns: 1fr;"></div>
          </div>
          <div>
            <h4 style="color: var(--amber); margin-bottom: 12px;">🔴 Money You Owe</h4>
            <div id="debts-iowe-list" class="cards-grid" style="grid-template-columns: 1fr;"></div>
          </div>
        </div>
        <h4 style="color: #FFF; margin: 24px 0 12px;">📝 Recent Expense Logs</h4>
        <div id="expenses-list" class="cards-grid"></div>
      </div>
    </div>

    <!-- Panel 2: Follow-up & Ghosted Messages -->
    <div id="panel-followups" class="panel">
      <div class="content-box">
        <div class="section-header">
          <h3 class="section-title">⏳ Follow-up & Ghosted Message Tracker</h3>
        </div>
        <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">Tracks sent questions and proposals that haven't received a reply in 12+ hours.</p>
        <div id="followups-list" class="cards-grid"></div>
      </div>
    </div>

    <!-- Panel 3: Contacts & Address Book -->
    <div id="panel-contacts" class="panel">
      <div class="content-box">
        
        <!-- vCard Drag & Drop -->
        <div class="dropzone" onclick="document.getElementById('vcf-input').click()">
          <input type="file" id="vcf-input" accept=".vcf" style="display: none;" onchange="handleVcfUpload(this)">
          <div class="dropzone-icon">📥</div>
          <div class="dropzone-title">Drop your Contacts .vcf File Here</div>
          <div class="dropzone-sub">Export your phone contacts and drop them here for 1-second instant sync!</div>
        </div>

        <div class="section-header">
          <h3 class="section-title">WhatsApp Address Book Directory</h3>
          <input type="text" class="search-input" id="contact-search" placeholder="Search contacts..." oninput="loadContacts(this.value)">
        </div>

        <div class="cards-grid" id="contacts-list">
          <!-- Loaded dynamically -->
        </div>
      </div>
    </div>

    <!-- Panel 4: Auto-Pilot -->
    <div id="panel-autopilot" class="panel">
      <div class="content-box">
        <div class="section-header">
          <h3 class="section-title">Auto-Pilot Clone Persona Rules</h3>
        </div>
        <div class="cards-grid" id="autopilot-list">
          <!-- Loaded dynamically -->
        </div>
      </div>
    </div>

    <!-- Panel 5: Second Brain -->
    <div id="panel-memories" class="panel">
      <div class="content-box">
        <div class="section-header">
          <h3 class="section-title">Second Brain Memories</h3>
          <input type="text" class="search-input" id="memory-search" placeholder="Search memories..." oninput="loadMemories(this.value)">
        </div>
        <div class="cards-grid" id="memories-list">
          <!-- Loaded dynamically -->
        </div>
      </div>
    </div>

    <!-- Panel 6: Calendar -->
    <div id="panel-calendar" class="panel">
      <div class="content-box">
        <div class="section-header">
          <h3 class="section-title">Upcoming Confirmed Events</h3>
        </div>
        <div class="cards-grid" id="events-list">
          <!-- Loaded dynamically -->
        </div>
      </div>
    </div>

  </div>

  <script>
    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      
      event.target.classList.add('active');
      document.getElementById('panel-' + tabId).classList.add('active');

      if (tabId === 'finances') loadFinances();
      if (tabId === 'followups') loadFollowups();
      if (tabId === 'contacts') loadContacts();
      if (tabId === 'autopilot') loadAutopilot();
      if (tabId === 'memories') loadMemories();
      if (tabId === 'calendar') loadEvents();
    }

    async function sendWebChat() {
      const input = document.getElementById('web-chat-input');
      const text = input.value.trim();
      if (!text) return;

      const container = document.getElementById('chat-messages');
      container.innerHTML += `<div style="align-self: flex-end; background: rgba(139, 92, 246, 0.15); border-right: 3px solid var(--violet); padding: 10px 14px; border-radius: 8px; max-width: 80%;"><strong>You:</strong> ${text}</div>`;
      input.value = '';
      container.scrollTop = container.scrollHeight;

      const loadingId = 'loading-' + Date.now();
      container.innerHTML += `<div id="${loadingId}" style="background: rgba(0, 240, 255, 0.05); padding: 10px 14px; border-radius: 8px;"><em>⏳ ARGUS is thinking and checking tools...</em></div>`;
      container.scrollTop = container.scrollHeight;

      try {
        const res = await fetch('/api/dashboard/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: text })
        });
        const data = await res.json();
        document.getElementById(loadingId).remove();
        container.innerHTML += `<div style="background: rgba(0, 240, 255, 0.08); border-left: 3px solid var(--cyan); padding: 12px 16px; border-radius: 8px; white-space: pre-wrap;"><strong>👁️ ARGUS:</strong>\n${data.answer || 'Done.'}</div>`;
      } catch (err) {
        document.getElementById(loadingId).remove();
        container.innerHTML += `<div style="color: var(--rose); padding: 10px;">⚠️ Error: ${err.message}</div>`;
      }
      container.scrollTop = container.scrollHeight;
    }

    async function loadFinances() {
      try {
        const res = await fetch('/api/dashboard/finances');
        const data = await res.json();
        document.getElementById('finances-total').textContent = `Total Spent: ₹${data.total_spent || 0}`;

        const owedBox = document.getElementById('debts-owed-list');
        if (data.debts_owed_to_me && data.debts_owed_to_me.length > 0) {
          owedBox.innerHTML = data.debts_owed_to_me.map(d => `
            <div class="item-card">
              <div class="item-info">
                <h4>${d.person || 'Contact'} owes you ₹${d.amount}</h4>
                <p>${d.description} • ${new Date(d.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          `).join('');
        } else {
          owedBox.innerHTML = '<div style="color: var(--text-dim); padding: 12px;">No active debts owed to you.</div>';
        }

        const iOweBox = document.getElementById('debts-iowe-list');
        if (data.i_owe && data.i_owe.length > 0) {
          iOweBox.innerHTML = data.i_owe.map(d => `
            <div class="item-card">
              <div class="item-info">
                <h4>You owe ${d.person || 'Contact'} ₹${d.amount}</h4>
                <p>${d.description} • ${new Date(d.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          `).join('');
        } else {
          iOweBox.innerHTML = '<div style="color: var(--text-dim); padding: 12px;">You owe nothing! 🎉</div>';
        }

        const expBox = document.getElementById('expenses-list');
        if (data.expenses && data.expenses.length > 0) {
          expBox.innerHTML = data.expenses.map(e => `
            <div class="item-card">
              <div class="item-info">
                <h4>₹${e.amount} — ${e.description}</h4>
                <p>Category: ${e.category} • ${new Date(e.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          `).join('');
        } else {
          expBox.innerHTML = '<div style="color: var(--text-dim); padding: 12px;">No expenses recorded yet.</div>';
        }
      } catch (err) {
        console.error("Finances load error:", err);
      }
    }

    async function loadFollowups() {
      try {
        const res = await fetch('/api/dashboard/followups');
        const list = await res.json();
        const box = document.getElementById('followups-list');
        if (list.length === 0) {
          box.innerHTML = '<div style="color: var(--text-dim); padding: 12px;">✨ No pending follow-ups. All messages are fresh!</div>';
          return;
        }
        box.innerHTML = list.map(f => `
          <div class="item-card">
            <div class="item-info">
              <h4>👤 ${f.contact_name}</h4>
              <p style="font-style: italic; margin-top: 4px;">"${f.last_sent_text}"</p>
              <p style="color: var(--amber); margin-top: 4px;">Sent: ${new Date(f.sent_at).toLocaleString()}</p>
            </div>
          </div>
        `).join('');
      } catch (err) {
        console.error("Followups load error:", err);
      }
    }

    async function loadStats() {
      try {
        const res = await fetch('/api/dashboard/stats');
        const data = await res.json();
        document.getElementById('stat-provider').textContent = data.llm_provider || 'GROQ';
        document.getElementById('stat-model').textContent = data.llm_model || 'llama-3.3-70b';
        document.getElementById('stat-memories').textContent = data.total_memories || '0';
        document.getElementById('stat-contacts').textContent = data.total_contacts || '0';
        document.getElementById('stat-autopilot').textContent = data.active_autopilot_rules || '0';
        document.getElementById('provider-badge').textContent = `Brain: ${data.llm_provider} (${data.llm_model})`;
      } catch (err) {
        console.error("Stats load failed:", err);
      }
    }

    async function loadContacts(query = '') {
      try {
        const url = query ? `/api/dashboard/contacts?search=${encodeURIComponent(query)}` : '/api/dashboard/contacts';
        const res = await fetch(url);
        const contacts = await res.json();
        const container = document.getElementById('contacts-list');
        
        if (contacts.length === 0) {
          container.innerHTML = '<p style="color: var(--text-dim); grid-column: 1/-1;">No contacts found. Drop a .vcf file above to sync!</p>';
          return;
        }

        container.innerHTML = contacts.map(c => `
          <div class="item-card">
            <div class="item-info">
              <h4>${c.name}</h4>
              <p>${c.is_group ? '👥 WhatsApp Group' : '👤 ' + c.jid.replace('@s.whatsapp.net', '')}</p>
            </div>
            <span style="font-size: 18px;">${c.is_group ? '👥' : '💬'}</span>
          </div>
        `).join('');
      } catch (err) {
        console.error(err);
      }
    }

    async function handleVcfUpload(input) {
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/api/dashboard/contacts/upload-vcf', {
          method: 'POST',
          body: formData,
        });
        const result = await res.json();
        alert(`✅ Contact Sync Complete! Imported ${result.imported} contacts into ARGUS.`);
        loadStats();
        loadContacts();
      } catch (err) {
        alert('❌ Error uploading contacts file.');
      }
    }

    async function loadAutopilot() {
      try {
        const res = await fetch('/api/dashboard/autopilot');
        const rules = await res.json();
        const container = document.getElementById('autopilot-list');

        if (rules.length === 0) {
          container.innerHTML = '<p style="color: var(--text-dim); grid-column: 1/-1;">No auto-pilot rules configured. Text "autopilot on" on WhatsApp to create one!</p>';
          return;
        }

        container.innerHTML = rules.map(r => `
          <div class="item-card">
            <div class="item-info">
              <h4>${r.name}</h4>
              <p>${r.custom_prompt || 'Standard authentic persona reply'}</p>
              <p style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">Replies sent: ${r.auto_reply_count}</p>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" ${r.status === 'active' ? 'checked' : ''} onchange="toggleAutopilot('${r.jid}')">
              <span class="slider"></span>
            </label>
          </div>
        `).join('');
      } catch (err) {
        console.error(err);
      }
    }

    async function toggleAutopilot(jid) {
      try {
        await fetch('/api/dashboard/autopilot/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jid }),
        });
        loadStats();
      } catch (err) {
        console.error(err);
      }
    }

    async function loadMemories(query = '') {
      try {
        const res = await fetch('/memory/recall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query || 'all facts', limit: 30 }),
        });
        const data = await res.json();
        const container = document.getElementById('memories-list');

        if (!data.memories || data.memories.length === 0) {
          container.innerHTML = '<p style="color: var(--text-dim); grid-column: 1/-1;">No memories found.</p>';
          return;
        }

        container.innerHTML = data.memories.map(m => `
          <div class="item-card">
            <div class="item-info">
              <h4>${m.fact_text}</h4>
              <p>🏷️ ${m.category || 'General'}</p>
            </div>
          </div>
        `).join('');
      } catch (err) {
        console.error(err);
      }
    }

    async function loadEvents() {
      try {
        const res = await fetch('/api/dashboard/events');
        const events = await res.json();
        const container = document.getElementById('events-list');

        if (events.length === 0) {
          container.innerHTML = '<p style="color: var(--text-dim); grid-column: 1/-1;">No upcoming confirmed events.</p>';
          return;
        }

        container.innerHTML = events.map(e => `
          <div class="item-card">
            <div class="item-info">
              <h4>📌 ${e.title || 'Meeting'}</h4>
              <p>📅 ${e.event_date || 'TBD'} ${e.event_time ? 'at ' + e.event_time : ''}</p>
            </div>
          </div>
        `).join('');
      } catch (err) {
        console.error(err);
      }
    }

    // Initialize Dashboard
    loadStats();
    loadContacts();
  </script>
</body>
</html>
"""

@dashboard_router.get("/dashboard", response_class=HTMLResponse)
async def serve_dashboard() -> HTMLResponse:
    """Serve the local web control center dashboard."""
    return HTMLResponse(content=DASHBOARD_HTML)
