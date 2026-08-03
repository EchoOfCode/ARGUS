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

    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at, status);
    CREATE INDEX IF NOT EXISTS idx_todos_chat ON todos(chat_jid, completed);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON message_log(chat_jid, timestamp);
    CREATE INDEX IF NOT EXISTS idx_pending_events_status ON pending_events(status);
  `);

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
  const result = getDb().prepare("DELETE FROM todos WHERE id = ?").run(id);
  return result.changes > 0;
}

// ─── Message log operations ───────────────────────────────────

export function logMessage(
  chatJid: string,
  senderJid: string,
  senderName: string | null,
  text: string,
  timestamp: string,
  isFromMe: boolean
): void {
  getDb()
    .prepare(
      `INSERT INTO message_log (chat_jid, sender_jid, sender_name, message_text, timestamp, is_from_me)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(chatJid, senderJid, senderName, text, timestamp, isFromMe ? 1 : 0);
}

export function getRecentMessages(
  chatJid: string,
  limit = 50
): Array<{
  sender_name: string | null;
  message_text: string;
  timestamp: string;
  is_from_me: number;
}> {
  return getDb()
    .prepare(
      `SELECT sender_name, message_text, timestamp, is_from_me
       FROM message_log
       WHERE chat_jid = ?
       ORDER BY timestamp DESC
       LIMIT ?`
    )
    .all(chatJid, limit) as any[];
}

// ─── Pending event operations ──────────────────────────────────

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
  title: string | null,
  eventDate: string | null,
  eventTime: string | null,
  confidence: number | null
): PendingEvent {
  const stmt = getDb().prepare(
    `INSERT INTO pending_events (chat_jid, sender_jid, original_text, title, event_date, event_time, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    chatJid,
    senderJid,
    originalText,
    title,
    eventDate,
    eventTime,
    confidence
  );
  return getDb()
    .prepare("SELECT * FROM pending_events WHERE id = ?")
    .get(result.lastInsertRowid) as PendingEvent;
}

export function getLatestPendingEvent(chatJid: string): PendingEvent | undefined {
  return getDb()
    .prepare(
      "SELECT * FROM pending_events WHERE chat_jid = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
    )
    .get(chatJid) as PendingEvent | undefined;
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
    .prepare("UPDATE pending_events SET status = 'ignored' WHERE id = ?")
    .run(id);
}
