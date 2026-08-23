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
            ORDER BY event_date ASC, event_time ASC LIMIT 50
            """
        )
        return [dict(r) for r in cursor.fetchall()]
    finally:
        bridge_db.close()


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
      <button class="tab-btn active" onclick="switchTab('contacts')">📇 Address Book & Sync</button>
      <button class="tab-btn" onclick="switchTab('autopilot')">🤖 Auto-Pilot Rules</button>
      <button class="tab-btn" onclick="switchTab('memories')">🧠 Second Brain Vault</button>
      <button class="tab-btn" onclick="switchTab('calendar')">📅 Upcoming Calendar</button>
    </div>

    <!-- Panel 1: Contacts & Address Book -->
    <div id="panel-contacts" class="panel active">
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

    <!-- Panel 2: Auto-Pilot -->
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

    <!-- Panel 3: Second Brain -->
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

    <!-- Panel 4: Calendar -->
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

      if (tabId === 'contacts') loadContacts();
      if (tabId === 'autopilot') loadAutopilot();
      if (tabId === 'memories') loadMemories();
      if (tabId === 'calendar') loadEvents();
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
