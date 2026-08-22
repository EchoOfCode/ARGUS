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

    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at, status);
    CREATE INDEX IF NOT EXISTS idx_todos_chat ON todos(chat_jid, completed);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON message_log(chat_jid, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_text ON message_log(message_text);
    CREATE INDEX IF NOT EXISTS idx_pending_events_status ON pending_events(status);
  `);

  // Run migrations safely for new columns if table existed
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

  // Update chat directory
  if (chatName) {
    getDb()
      .prepare(
        `INSERT INTO chat_directory (jid, name, is_group, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(jid) DO UPDATE SET name = excluded.name, updated_at = datetime('now')`
      )
      .run(chatJid, chatName, chatJid.endsWith("@g.us") ? 1 : 0);
  }
}

export function getRecentMessages(chatJid: string, limit = 30): LoggedMessage[] {
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

export function findChatByNameOrQuery(query: string): { jid: string; name: string } | null {
  const q = query.trim().toLowerCase();
  const match = getDb()
    .prepare(
      `SELECT jid, name FROM chat_directory
       WHERE LOWER(name) LIKE ? OR LOWER(jid) LIKE ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(`%${q}%`, `%${q}%`) as { jid: string; name: string } | undefined;

  if (match) return match;

  // Fallback: search in message_log chat_name
  const logMatch = getDb()
    .prepare(
      `SELECT chat_jid as jid, chat_name as name FROM message_log
       WHERE LOWER(chat_name) LIKE ?
       ORDER BY timestamp DESC
       LIMIT 1`
    )
    .get(`%${q}%`) as { jid: string; name: string } | undefined;

  return logMatch || null;
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
