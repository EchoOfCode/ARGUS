import Database from "better-sqlite3";
import path from "path";

let db: Database.Database;

export function initDatabase(dbPath: string): Database.Database {
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      reminder_text TEXT NOT NULL,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      text TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS message_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      chat_name TEXT,
      sender_jid TEXT NOT NULL,
      sender_name TEXT,
      message_text TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      is_from_me INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      sender_jid TEXT NOT NULL,
      original_text TEXT NOT NULL,
      title TEXT,
      event_date TEXT,
      event_time TEXT,
      confidence REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_directory (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_group INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS exempted_chats (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_jid TEXT NOT NULL,
      target_name TEXT NOT NULL,
      message_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS autopilot_rules (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      custom_prompt TEXT,
      auto_reply_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_replied_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at, status);
    CREATE INDEX IF NOT EXISTS idx_todos_chat ON todos(chat_jid, completed);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON message_log(chat_jid, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_text ON message_log(message_text);
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON pending_outbox(status);
    CREATE INDEX IF NOT EXISTS idx_pending_events_status ON pending_events(status);
    CREATE INDEX IF NOT EXISTS idx_autopilot_status ON autopilot_rules(status);
  `);

  try {
    db.exec("ALTER TABLE message_log ADD COLUMN chat_name TEXT;");
  } catch {
    // Column already exists
  }

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

// ─── Reminder operations ───────────────────────────────────────

export interface Reminder {
  id: number;
  chat_jid: string;
  reminder_text: string;
  due_at: string;
  status: string;
  created_at: string;
  sent_at: string | null;
}

export function addReminder(chatJid: string, text: string, dueAt: string): Reminder {
  const stmt = getDb().prepare(
    "INSERT INTO reminders (chat_jid, reminder_text, due_at) VALUES (?, ?, ?)"
  );
  const result = stmt.run(chatJid, text, dueAt);
  return getDb()
    .prepare("SELECT * FROM reminders WHERE id = ?")
    .get(result.lastInsertRowid) as Reminder;
}

export function getDueReminders(): Reminder[] {
  return getDb()
    .prepare(
      "SELECT * FROM reminders WHERE status = 'pending' AND due_at <= datetime('now')"
    )
    .all() as Reminder[];
}

export function getTodayReminders(chatJid: string): Reminder[] {
  return getDb()
    .prepare(
      "SELECT * FROM reminders WHERE chat_jid = ? AND status = 'pending' AND date(due_at) = date('now') ORDER BY due_at ASC"
    )
    .all(chatJid) as Reminder[];
}

export function markReminderSent(id: number): void {
  getDb()
    .prepare(
      "UPDATE reminders SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
    )
    .run(id);
}

// ─── Todo operations ───────────────────────────────────────────

export interface Todo {
  id: number;
  chat_jid: string;
  text: string;
  completed: number;
  created_at: string;
  completed_at: string | null;
}

export function addTodo(chatJid: string, text: string): Todo {
  const stmt = getDb().prepare(
    "INSERT INTO todos (chat_jid, text) VALUES (?, ?)"
  );
  const result = stmt.run(chatJid, text);
  return getDb()
    .prepare("SELECT * FROM todos WHERE id = ?")
    .get(result.lastInsertRowid) as Todo;
}

export function getTodos(chatJid: string, includeCompleted = false): Todo[] {
  if (includeCompleted) {
    return getDb()
      .prepare("SELECT * FROM todos WHERE chat_jid = ? ORDER BY created_at DESC")
      .all(chatJid) as Todo[];
  }
  return getDb()
    .prepare(
      "SELECT * FROM todos WHERE chat_jid = ? AND completed = 0 ORDER BY created_at DESC"
    )
    .all(chatJid) as Todo[];
}

export function completeTodo(id: number): boolean {
  const result = getDb()
    .prepare(
      "UPDATE todos SET completed = 1, completed_at = datetime('now') WHERE id = ? AND completed = 0"
    )
    .run(id);
  return result.changes > 0;
}

export function deleteTodo(id: number): boolean {
  const result = getDb()
    .prepare("DELETE FROM todos WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

// ─── Message logging & search ──────────────────────────────────

export interface LoggedMessage {
  id: number;
  chat_jid: string;
  chat_name: string | null;
  sender_jid: string;
  sender_name: string | null;
  message_text: string;
  timestamp: string;
  is_from_me: number;
}

export function saveChatDirectory(jid: string, name: string, isGroup: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO chat_directory (jid, name, is_group, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(jid) DO UPDATE SET name = excluded.name, updated_at = datetime('now')`
    )
    .run(jid, name, isGroup ? 1 : 0);
}

export function logMessage(
  chatJid: string,
  chatName: string | null,
  senderJid: string,
  senderName: string | null,
  messageText: string,
  timestamp: string,
  isFromMe: boolean
): void {
  getDb()
    .prepare(
      `INSERT INTO message_log (chat_jid, chat_name, sender_jid, sender_name, message_text, timestamp, is_from_me)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(chatJid, chatName, senderJid, senderName, messageText, timestamp, isFromMe ? 1 : 0);

  if (chatName && chatName !== "Group Chat" && chatName !== "Contact") {
    saveChatDirectory(chatJid, chatName, chatJid.endsWith("@g.us"));
  }
}

export function getRecentMessages(chatJid: string, limit = 40): LoggedMessage[] {
  return getDb()
    .prepare(
      `SELECT * FROM message_log
       WHERE chat_jid = ?
       ORDER BY timestamp DESC
       LIMIT ?`
    )
    .all(chatJid, limit)
    .reverse() as LoggedMessage[];
}

export function getRecentActiveChats(limit = 5): Array<{ jid: string; name: string; is_group: number; message_count: number }> {
  return getDb()
    .prepare(
      `SELECT m.chat_jid as jid, 
              COALESCE(d.name, m.chat_name, m.chat_jid) as name, 
              COALESCE(d.is_group, CASE WHEN m.chat_jid LIKE '%@g.us' THEN 1 ELSE 0 END) as is_group,
              COUNT(m.id) as message_count
       FROM message_log m
       LEFT JOIN chat_directory d ON m.chat_jid = d.jid
       WHERE m.chat_jid NOT LIKE '%status@broadcast%'
       GROUP BY m.chat_jid
       ORDER BY MAX(m.timestamp) DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ jid: string; name: string; is_group: number; message_count: number }>;
}

export function findChatByNameOrQuery(query: string): { jid: string; name: string } | null {
  const rawQ = query.trim().toLowerCase();
  const cleanedQ = rawQ
    .replace(/\b(group|chat|the|my|with|for|in|about|messages|recent)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

  if (!cleanedQ || cleanedQ.length < 2) return null;

  // 1. Direct and ranked matching against chat_directory
  const allChats = getDb()
    .prepare("SELECT jid, name FROM chat_directory")
    .all() as Array<{ jid: string; name: string }>;

  // Priority 1: Exact match
  for (const c of allChats) {
    const cClean = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cClean && cClean === cleanedQ) {
      return c;
    }
  }

  // Priority 2: Word startsWith
  for (const c of allChats) {
    const cClean = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cClean && cClean.startsWith(cleanedQ)) {
      return c;
    }
  }

  // Priority 3: Substring contains (only if query >= 3 chars)
  if (cleanedQ.length >= 3) {
    for (const c of allChats) {
      const cClean = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (cClean && cClean.length >= 2 && cClean.includes(cleanedQ)) {
        return c;
      }
    }
  }

  // 2. Matching against message_log sender_name and chat_name
  const logChats = getDb()
    .prepare(
      `SELECT DISTINCT chat_jid as jid, COALESCE(chat_name, sender_name, chat_jid) as name 
       FROM message_log 
       WHERE chat_name IS NOT NULL OR sender_name IS NOT NULL`
    )
    .all() as Array<{ jid: string; name: string }>;

  // Log exact or startsWith
  for (const c of logChats) {
    const cClean = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cClean && (cClean === cleanedQ || cClean.startsWith(cleanedQ))) {
      return c;
    }
  }

  if (cleanedQ.length >= 3) {
    for (const c of logChats) {
      const cClean = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (cClean && cClean.length >= 2 && cClean.includes(cleanedQ)) {
        return c;
      }
    }
  }

  return null;
}

export function searchMessages(query: string, limit = 10): LoggedMessage[] {
  return getDb()
    .prepare(
      `SELECT * FROM message_log
       WHERE LOWER(message_text) LIKE ?
       ORDER BY timestamp DESC
       LIMIT ?`
    )
    .all(`%${query.toLowerCase()}%`, limit) as LoggedMessage[];
}

// ─── Pending events ────────────────────────────────────────────

export interface PendingEvent {
  id: number;
  chat_jid: string;
  sender_jid: string;
  original_text: string;
  title: string | null;
  event_date: string | null;
  event_time: string | null;
  confidence: number | null;
  status: string;
  created_at: string;
  confirmed_at: string | null;
}

export function addPendingEvent(
  chatJid: string,
  senderJid: string,
  originalText: string,
  title?: string | null,
  eventDate?: string | null,
  eventTime?: string | null,
  confidence?: number | null
): PendingEvent {
  const stmt = getDb().prepare(
    `INSERT INTO pending_events
     (chat_jid, sender_jid, original_text, title, event_date, event_time, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    chatJid,
    senderJid,
    originalText,
    title || null,
    eventDate || null,
    eventTime || null,
    confidence || null
  );
  return getDb()
    .prepare("SELECT * FROM pending_events WHERE id = ?")
    .get(result.lastInsertRowid) as PendingEvent;
}

export function getLatestPendingEvent(chatJid: string): PendingEvent | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM pending_events
         WHERE chat_jid = ? AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(chatJid) as PendingEvent | undefined) || null
  );
}

export function getTodayConfirmedEvents(): PendingEvent[] {
  return getDb()
    .prepare(
      `SELECT * FROM pending_events
       WHERE status = 'confirmed' AND (event_date = date('now') OR event_date IS NULL)
       ORDER BY event_time ASC`
    )
    .all() as PendingEvent[];
}

export function getUpcomingConfirmedEvents(limit = 15): PendingEvent[] {
  return getDb()
    .prepare(
      `SELECT * FROM pending_events
       WHERE status = 'confirmed' AND (event_date >= date('now') OR event_date IS NULL)
       ORDER BY event_date ASC, event_time ASC
       LIMIT ?`
    )
    .all(limit) as PendingEvent[];
}

export function deleteConfirmedEvent(id: number): boolean {
  const res = getDb()
    .prepare("DELETE FROM pending_events WHERE id = ?")
    .run(id);
  return res.changes > 0;
}

export function confirmEvent(id: number): void {
  getDb()
    .prepare(
      "UPDATE pending_events SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?"
    )
    .run(id);
}

export function ignoreEvent(id: number): void {
  getDb()
    .prepare(
      "UPDATE pending_events SET status = 'ignored' WHERE id = ?"
    )
    .run(id);
}

// ─── Exempted / Ignored Chats ─────────────────────────────────

export function exemptChat(jid: string, name: string): void {
  getDb()
    .prepare(
      `INSERT INTO exempted_chats (jid, name, created_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(jid) DO UPDATE SET name = excluded.name`
    )
    .run(jid, name);
}

export function unexemptChat(query: string): boolean {
  const q = query.trim().toLowerCase();
  const result = getDb()
    .prepare(
      `DELETE FROM exempted_chats
       WHERE LOWER(name) LIKE ? OR LOWER(jid) LIKE ?`
    )
    .run(`%${q}%`, `%${q}%`);
  return result.changes > 0;
}

export function isChatExempted(jid: string): boolean {
  const row = getDb()
    .prepare("SELECT jid FROM exempted_chats WHERE jid = ?")
    .get(jid);
  return Boolean(row);
}

export function getExemptedChats(): Array<{ jid: string; name: string }> {
  return getDb()
    .prepare("SELECT jid, name FROM exempted_chats ORDER BY created_at DESC")
    .all() as Array<{ jid: string; name: string }>;
}

// ─── Pending Outbox (Sending messages to groups/contacts) ─────

export interface PendingOutbox {
  id: number;
  target_jid: string;
  target_name: string;
  message_text: string;
  status: string;
  created_at: string;
  sent_at: string | null;
}

export function addPendingOutbox(
  targetJid: string,
  targetName: string,
  messageText: string
): PendingOutbox {
  const stmt = getDb().prepare(
    `INSERT INTO pending_outbox (target_jid, target_name, message_text, status)
     VALUES (?, ?, ?, 'pending')`
  );
  const result = stmt.run(targetJid, targetName, messageText);
  return getDb()
    .prepare("SELECT * FROM pending_outbox WHERE id = ?")
    .get(result.lastInsertRowid) as PendingOutbox;
}

export function getLatestPendingOutbox(): PendingOutbox | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM pending_outbox
         WHERE status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get() as PendingOutbox | undefined) || null
  );
}

export function markOutboxSent(id: number): void {
  getDb()
    .prepare(
      "UPDATE pending_outbox SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
    )
    .run(id);
}

export function updatePendingOutboxText(id: number, newText: string): void {
  getDb()
    .prepare(
      "UPDATE pending_outbox SET message_text = ? WHERE id = ?"
    )
    .run(newText, id);
}

export function cancelPendingOutbox(id: number): void {
  getDb()
    .prepare(
      "UPDATE pending_outbox SET status = 'cancelled' WHERE id = ?"
    )
    .run(id);
}

// ─── Auto-Pilot Rules ──────────────────────────────────────────

export interface AutopilotRule {
  jid: string;
  name: string;
  status: string;
  custom_prompt: string | null;
  auto_reply_count: number;
  created_at: string;
  last_replied_at: string | null;
}

export function enableAutopilot(jid: string, name: string, customPrompt?: string): void {
  getDb()
    .prepare(
      `INSERT INTO autopilot_rules (jid, name, status, custom_prompt, last_replied_at)
       VALUES (?, ?, 'active', ?, datetime('now'))
       ON CONFLICT(jid) DO UPDATE SET
         status = 'active',
         name = excluded.name,
         custom_prompt = excluded.custom_prompt,
         last_replied_at = datetime('now')`
    )
    .run(jid, name, customPrompt || null);
}

export function disableAutopilot(jid: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM autopilot_rules WHERE jid = ? OR jid = 'GLOBAL'")
    .run(jid);
  return result.changes > 0;
}

export function disableAllAutopilot(): boolean {
  const result = getDb().prepare("DELETE FROM autopilot_rules").run();
  return result.changes > 0;
}

export function getActiveAutopilotRule(jid: string): AutopilotRule | null {
  // Check specific contact rule first, then fallback to GLOBAL rule
  const specific = getDb()
    .prepare("SELECT * FROM autopilot_rules WHERE jid = ? AND status = 'active'")
    .get(jid) as AutopilotRule | undefined;
  if (specific) return specific;

  const global = getDb()
    .prepare("SELECT * FROM autopilot_rules WHERE jid = 'GLOBAL' AND status = 'active'")
    .get() as AutopilotRule | undefined;
  return global || null;
}

export function listAutopilotRules(): AutopilotRule[] {
  return getDb()
    .prepare("SELECT * FROM autopilot_rules ORDER BY created_at DESC")
    .all() as AutopilotRule[];
}

export function incrementAutopilotCount(jid: string): void {
  getDb()
    .prepare(
      "UPDATE autopilot_rules SET auto_reply_count = auto_reply_count + 1, last_replied_at = datetime('now') WHERE jid = ? OR jid = 'GLOBAL'"
    )
    .run(jid);
}

