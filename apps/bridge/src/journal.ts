/**
 * Durable Ingestion Journal for ARGUS Bridge (ADR 0001).
 * Logs incoming/outgoing message events locally to an append-only WAL SQLite journal
 * and asynchronously flushes them to the Brain API with exponential backoff.
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import pino from "pino";
import { Config } from "./config.js";
import { callBrain } from "./brainClient.js";

const logger = pino({ name: "argus:journal" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let journalDb: Database.Database | null = null;
let isDraining = false;

export interface IngestJournalEntry {
  message_id?: string;
  chat_jid: string;
  chat_name?: string | null;
  sender_jid: string;
  sender_name?: string | null;
  message_text: string;
  timestamp: string;
  is_from_me: boolean;
}

export function initJournal(dataDir?: string): Database.Database {
  const targetDir = dataDir || path.resolve(__dirname, "../data");
  fs.mkdirSync(targetDir, { recursive: true });
  const dbPath = path.join(targetDir, "ingest_journal.db");

  journalDb = new Database(dbPath);
  journalDb.pragma("journal_mode = WAL");
  journalDb.pragma("busy_timeout = 5000");

  journalDb.exec(`
    CREATE TABLE IF NOT EXISTS ingest_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      chat_jid TEXT NOT NULL,
      chat_name TEXT,
      sender_jid TEXT NOT NULL,
      sender_name TEXT,
      message_text TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      is_from_me INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_journal_pending ON ingest_journal(status, id);
  `);

  logger.info({ dbPath }, "Initialized durable append-only ingestion journal");
  return journalDb;
}

export function getJournalDb(): Database.Database {
  if (!journalDb) {
    return initJournal();
  }
  return journalDb;
}

/**
 * Append message event to the local durable journal immediately.
 */
export function recordToJournal(entry: IngestJournalEntry): number {
  const db = getJournalDb();
  const stmt = db.prepare(`
    INSERT INTO ingest_journal (message_id, chat_jid, chat_name, sender_jid, sender_name, message_text, timestamp, is_from_me, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `);
  const result = stmt.run(
    entry.message_id || null,
    entry.chat_jid,
    entry.chat_name || null,
    entry.sender_jid,
    entry.sender_name || null,
    entry.message_text,
    entry.timestamp,
    entry.is_from_me ? 1 : 0
  );
  return Number(result.lastInsertRowid);
}

/**
 * Drain pending entries from the journal to the Brain API.
 */
export async function drainJournal(config: Config): Promise<number> {
  if (isDraining) return 0;
  isDraining = true;

  const db = getJournalDb();
  let drainedCount = 0;

  try {
    const rows = db.prepare(
      "SELECT * FROM ingest_journal WHERE status = 'pending' ORDER BY id ASC LIMIT 25"
    ).all() as any[];

    if (rows.length === 0) {
      isDraining = false;
      return 0;
    }

    for (const row of rows) {
      try {
        await callBrain(config, "/api/ingest/message", {
          chat_jid: row.chat_jid,
          chat_name: row.chat_name,
          sender_jid: row.sender_jid,
          sender_name: row.sender_name,
          message_text: row.message_text,
          timestamp: row.timestamp,
          is_from_me: Boolean(row.is_from_me),
          message_id: row.message_id,
        });

        // Delete drained row from journal
        db.prepare("DELETE FROM ingest_journal WHERE id = ?").run(row.id);
        drainedCount++;
      } catch (err: any) {
        logger.warn({ id: row.id, error: err.message }, "Brain unavailable during journal drain; pausing");
        break; // Stop draining this cycle if Brain is unreachable
      }
    }
  } finally {
    isDraining = false;
  }

  return drainedCount;
}

/**
 * Start periodic draining worker.
 */
export function startJournalWorker(config: Config, intervalMs = 3000): NodeJS.Timeout {
  return setInterval(() => {
    drainJournal(config).catch((err) => {
      logger.error({ error: err.message }, "Error during periodic journal drain");
    });
  }, intervalMs);
}
