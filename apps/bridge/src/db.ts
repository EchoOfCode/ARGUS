/**
 * ARGUS Bridge State & Data Gateway (ADR 0001: Single Database Owner).
 *
 * NOTE: The Bridge has NO direct read or write access to argus.db.
 * Brain (apps/brain) is the single owner and writer of argus.db.
 *
 * Durable message ingestion is recorded to apps/bridge/data/ingest_journal.db
 * via recordToJournal(), and synced to Brain over authenticated REST endpoints.
 * Command-turn multi-session context is maintained in an ephemeral in-memory ring buffer.
 */

import pino from "pino";
import { recordToJournal } from "./journal.js";

const logger = pino({ name: "argus:bridge-state" });

export function initDatabase(dbPath?: string): any {
  logger.info({ dbPath }, "Bridge data gateway initialized (ADR 0001: Single Writer in Brain)");
  return null;
}

export function getDb(): any {
  // Legacy stub — direct SQLite writes from bridge are prohibited by ADR 0001
  return {
    prepare: () => ({
      run: () => ({ lastInsertRowid: 1, changes: 1 }),
      get: () => null,
      all: () => [],
    }),
    exec: () => {},
    pragma: () => {},
  };
}

// ─── Reminder types & state ───────────────────────────────────

export interface Reminder {
  id: number;
  chat_jid: string;
  reminder_text: string;
  due_at: string;
  status: string;
  created_at: string;
  sent_at: string | null;
}

const memoryReminders: Reminder[] = [];
let nextReminderId = 1;

export function addReminder(chatJid: string, text: string, dueAt: string): Reminder {
  const reminder: Reminder = {
    id: nextReminderId++,
    chat_jid: chatJid,
    reminder_text: text,
    due_at: dueAt,
    status: "pending",
    created_at: new Date().toISOString(),
    sent_at: null,
  };
  memoryReminders.push(reminder);
  return reminder;
}

export function getDueReminders(): Reminder[] {
  const now = new Date().toISOString();
  return memoryReminders.filter((r) => r.status === "pending" && r.due_at <= now);
}

export function getTodayReminders(chatJid: string): Reminder[] {
  const today = new Date().toISOString().split("T")[0];
  return memoryReminders.filter(
    (r) => r.chat_jid === chatJid && r.status === "pending" && r.due_at.startsWith(today)
  );
}

export function markReminderSent(id: number): void {
  const r = memoryReminders.find((item) => item.id === id);
  if (r) {
    r.status = "sent";
    r.sent_at = new Date().toISOString();
  }
}

// ─── Todo types & in-memory cache ─────────────────────────────

export interface Todo {
  id: number;
  chat_jid: string;
  text: string;
  completed: number;
  created_at: string;
  completed_at: string | null;
}

const memoryTodos: Todo[] = [];
let nextTodoId = 1;

export function addTodo(chatJid: string, text: string): Todo {
  const todo: Todo = {
    id: nextTodoId++,
    chat_jid: chatJid,
    text,
    completed: 0,
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  memoryTodos.push(todo);
  return todo;
}

export function getTodos(chatJid: string, includeCompleted = false): Todo[] {
  return memoryTodos
    .filter((t) => t.chat_jid === chatJid && (includeCompleted || t.completed === 0))
    .slice()
    .reverse();
}

export function completeTodo(id: number): boolean {
  const t = memoryTodos.find((item) => item.id === id && item.completed === 0);
  if (t) {
    t.completed = 1;
    t.completed_at = new Date().toISOString();
    return true;
  }
  return false;
}

export function deleteTodo(id: number): boolean {
  const idx = memoryTodos.findIndex((item) => item.id === id);
  if (idx !== -1) {
    memoryTodos.splice(idx, 1);
    return true;
  }
  return false;
}

// ─── Ephemeral In-Memory Ring Buffer & Directory (ADR 0001) ───

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

const ringBuffer: LoggedMessage[] = [];
const RING_BUFFER_MAX = 50;
let nextMessageId = 1;

export const chatDirectory = new Map<string, { jid: string; name: string; is_group: boolean }>();

export function saveChatDirectory(jid: string, name: string, isGroup: boolean): void {
  chatDirectory.set(jid, { jid, name, is_group: isGroup });
}

export function logMessage(
  chatJid: string,
  chatName: string | null,
  senderJid: string,
  senderName: string | null,
  messageText: string,
  timestamp: string,
  isFromMe: boolean,
  messageId?: string
): void {
  // 1. Write to durable append-only journal (ADR 0001)
  recordToJournal({
    message_id: messageId,
    chat_jid: chatJid,
    chat_name: chatName,
    sender_jid: senderJid,
    sender_name: senderName,
    message_text: messageText,
    timestamp,
    is_from_me: isFromMe,
  });

  // 2. Add to ephemeral in-memory ring buffer for sub-second command turn context
  const entry: LoggedMessage = {
    id: nextMessageId++,
    chat_jid: chatJid,
    chat_name: chatName,
    sender_jid: senderJid,
    sender_name: senderName,
    message_text: messageText,
    timestamp,
    is_from_me: isFromMe ? 1 : 0,
  };

  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_MAX) {
    ringBuffer.shift();
  }

  if (chatName && chatName !== "Group Chat" && chatName !== "Contact") {
    saveChatDirectory(chatJid, chatName, chatJid.endsWith("@g.us"));
  }
}

export function getRecentMessages(chatJid: string, limit = 40): LoggedMessage[] {
  return ringBuffer.filter((m) => m.chat_jid === chatJid).slice(-limit);
}

export function getRecentActiveChats(limit = 5): Array<{ jid: string; name: string; is_group: number; message_count: number }> {
  const counts = new Map<string, { jid: string; name: string; is_group: number; message_count: number }>();
  for (const m of ringBuffer) {
    const existing = counts.get(m.chat_jid);
    const dir = chatDirectory.get(m.chat_jid);
    const isGroup = m.chat_jid.endsWith("@g.us") ? 1 : 0;
    const name = dir?.name || m.chat_name || m.chat_jid;
    if (existing) {
      existing.message_count++;
    } else {
      counts.set(m.chat_jid, { jid: m.chat_jid, name, is_group: isGroup, message_count: 1 });
    }
  }
  return Array.from(counts.values()).slice(-limit);
}

export function searchMessages(query: string, limit = 10): LoggedMessage[] {
  const q = query.toLowerCase();
  return ringBuffer.filter((m) => m.message_text.toLowerCase().includes(q)).slice(-limit);
}

export function findChatByNameOrQuery(query: string): { jid: string; name: string } | null {
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) return null;

  for (const [jid, data] of chatDirectory.entries()) {
    if (data.name.toLowerCase().includes(cleaned) || jid.includes(cleaned)) {
      return { jid, name: data.name };
    }
  }
  return null;
}

// ─── 1-Second vCard / Contacts (.vcf) Importer ──────────────────

export function importVCardText(vcardText: string): { imported: number; contacts: Array<{ name: string; jid: string }> } {
  const lines = vcardText.split(/\r?\n/);
  const importedContacts: Array<{ name: string; jid: string }> = [];

  let currentName: string | null = null;
  let currentPhone: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("BEGIN:VCARD")) {
      currentName = null;
      currentPhone = null;
      continue;
    }

    if (line.startsWith("FN:") || line.startsWith("FN;")) {
      currentName = line.replace(/^FN[^:]*:/i, "").trim();
    } else if (!currentName && (line.startsWith("N:") || line.startsWith("N;"))) {
      const parts = line.replace(/^N[^:]*:/i, "").split(";").map((p) => p.trim()).filter(Boolean);
      currentName = parts.reverse().join(" ");
    }

    if (line.startsWith("TEL") || line.includes("TEL;")) {
      const numRaw = line.replace(/^[^:]*:/i, "").trim();
      const cleanNum = numRaw.replace(/[^0-9]/g, "");
      if (cleanNum && cleanNum.length >= 7) {
        currentPhone = cleanNum;
      }
    }

    if (line.startsWith("END:VCARD")) {
      if (currentName && currentPhone) {
        let cleanJid = currentPhone;
        if (cleanJid.length === 10) {
          cleanJid = "91" + cleanJid;
        }
        const finalJid = `${cleanJid}@s.whatsapp.net`;
        saveChatDirectory(finalJid, currentName, false);
        importedContacts.push({ name: currentName, jid: finalJid });
      }
      currentName = null;
      currentPhone = null;
    }
  }

  return { imported: importedContacts.length, contacts: importedContacts };
}

// ─── Pending events (In-Memory buffer) ─────────────────────────

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

const memoryEvents: PendingEvent[] = [];
let nextEventId = 1;

export function addPendingEvent(
  chatJid: string,
  senderJid: string,
  originalText: string,
  title?: string | null,
  eventDate?: string | null,
  eventTime?: string | null,
  confidence?: number | null
): PendingEvent {
  const ev: PendingEvent = {
    id: nextEventId++,
    chat_jid: chatJid,
    sender_jid: senderJid,
    original_text: originalText,
    title: title || null,
    event_date: eventDate || null,
    event_time: eventTime || null,
    confidence: confidence || null,
    status: "pending",
    created_at: new Date().toISOString(),
    confirmed_at: null,
  };
  memoryEvents.push(ev);
  return ev;
}

export function getLatestPendingEvent(chatJid: string): PendingEvent | null {
  const matches = memoryEvents.filter((e) => e.chat_jid === chatJid && e.status === "pending");
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

export function getTodayConfirmedEvents(): PendingEvent[] {
  const today = new Date().toISOString().split("T")[0];
  return memoryEvents.filter((e) => e.status === "confirmed" && (e.event_date === today || !e.event_date));
}

export function getUpcomingConfirmedEvents(limit = 15): PendingEvent[] {
  return memoryEvents.filter((e) => e.status === "confirmed").slice(0, limit);
}

export function deleteConfirmedEvent(id: number): boolean {
  const idx = memoryEvents.findIndex((e) => e.id === id);
  if (idx !== -1) {
    memoryEvents.splice(idx, 1);
    return true;
  }
  return false;
}

export function confirmEvent(id: number): void {
  const ev = memoryEvents.find((e) => e.id === id);
  if (ev) {
    ev.status = "confirmed";
    ev.confirmed_at = new Date().toISOString();
  }
}

export function ignoreEvent(id: number): void {
  const ev = memoryEvents.find((e) => e.id === id);
  if (ev) {
    ev.status = "ignored";
  }
}

// ─── Exempted / Ignored Chats ─────────────────────────────────

const exemptedChatsMap = new Map<string, string>();

export function exemptChat(jid: string, name: string): void {
  exemptedChatsMap.set(jid, name);
}

export function unexemptChat(query: string): boolean {
  const q = query.toLowerCase();
  for (const [jid, name] of exemptedChatsMap.entries()) {
    if (jid.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
      exemptedChatsMap.delete(jid);
      return true;
    }
  }
  return false;
}

export function isChatExempted(jid: string): boolean {
  return exemptedChatsMap.has(jid);
}

export function getExemptedChats(): Array<{ jid: string; name: string }> {
  return Array.from(exemptedChatsMap.entries()).map(([jid, name]) => ({ jid, name }));
}

// ─── Pending Outbox ───────────────────────────────────────────

export interface PendingOutbox {
  id: number;
  target_jid: string;
  target_name: string;
  message_text: string;
  status: string;
  created_at: string;
  sent_at: string | null;
}

const memoryOutbox: PendingOutbox[] = [];
let nextOutboxId = 1;

export function addPendingOutbox(targetJid: string, targetName: string, messageText: string): PendingOutbox {
  const outbox: PendingOutbox = {
    id: nextOutboxId++,
    target_jid: targetJid,
    target_name: targetName,
    message_text: messageText,
    status: "pending",
    created_at: new Date().toISOString(),
    sent_at: null,
  };
  memoryOutbox.push(outbox);
  return outbox;
}

export function getLatestPendingOutbox(): PendingOutbox | null {
  const pending = memoryOutbox.filter((o) => o.status === "pending");
  return pending.length > 0 ? pending[pending.length - 1] : null;
}

export function markOutboxSent(id: number): void {
  const o = memoryOutbox.find((item) => item.id === id);
  if (o) {
    o.status = "sent";
    o.sent_at = new Date().toISOString();
  }
}

export function updatePendingOutboxText(id: number, newText: string): void {
  const o = memoryOutbox.find((item) => item.id === id);
  if (o) {
    o.message_text = newText;
  }
}

export function cancelPendingOutbox(id: number): void {
  const o = memoryOutbox.find((item) => item.id === id);
  if (o) {
    o.status = "cancelled";
  }
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

const memoryAutopilotRules = new Map<string, AutopilotRule>();

export function enableAutopilot(jid: string, name: string, customPrompt?: string): void {
  memoryAutopilotRules.set(jid, {
    jid,
    name,
    status: "active",
    custom_prompt: customPrompt || null,
    auto_reply_count: 0,
    created_at: new Date().toISOString(),
    last_replied_at: new Date().toISOString(),
  });
}

export function disableAutopilot(jid: string): boolean {
  return memoryAutopilotRules.delete(jid);
}

export function disableAllAutopilot(): boolean {
  const count = memoryAutopilotRules.size;
  memoryAutopilotRules.clear();
  return count > 0;
}

export function getActiveAutopilotRule(
  chatJid: string,
  senderJid?: string | null,
  senderName?: string | null,
  chatName?: string | null
): AutopilotRule | null {
  for (const rule of memoryAutopilotRules.values()) {
    if (rule.status === "active") {
      if (rule.jid === chatJid || rule.jid === senderJid || rule.jid === "GLOBAL") {
        return rule;
      }
    }
  }
  return null;
}

export function listAutopilotRules(): AutopilotRule[] {
  return Array.from(memoryAutopilotRules.values());
}

export function incrementAutopilotCount(jid: string): void {
  const r = memoryAutopilotRules.get(jid) || memoryAutopilotRules.get("GLOBAL");
  if (r) {
    r.auto_reply_count++;
    r.last_replied_at = new Date().toISOString();
  }
}

let cachedDedicatedGroupJid: string | null = null;

export function setDedicatedGroupJid(jid: string): void {
  if (jid && jid.endsWith("@g.us")) {
    cachedDedicatedGroupJid = jid;
  }
}

export function getDedicatedGroupJid(config: { dedicatedGroupName?: string; myJid: string; commandGroupJid?: string }): string {
  if (config.commandGroupJid && config.commandGroupJid.endsWith("@g.us")) {
    return config.commandGroupJid;
  }
  if (cachedDedicatedGroupJid && cachedDedicatedGroupJid.endsWith("@g.us")) {
    return cachedDedicatedGroupJid;
  }
  return config.myJid;
}

// ─── Meeting Proposal Negotiation Helper Functions ──────────────

export interface PendingProposal {
  id: number;
  sender_jid: string;
  chat_jid: string;
  sender_name: string;
  chat_name?: string;
  proposed_title: string;
  proposed_date?: string;
  proposed_time?: string;
  proposed_location?: string;
  raw_message: string;
  status: "pending" | "accepted" | "declined" | "countered";
  created_at: string;
  resolved_at?: string;
}

const memoryProposals: PendingProposal[] = [];
let nextProposalId = 1;

export function addPendingProposal(
  senderJid: string,
  chatJid: string,
  senderName: string,
  chatName: string | null,
  proposedTitle: string,
  proposedDate: string | null,
  proposedTime: string | null,
  proposedLocation: string | null,
  rawMessage: string
): PendingProposal {
  const proposal: PendingProposal = {
    id: nextProposalId++,
    sender_jid: senderJid,
    chat_jid: chatJid,
    sender_name: senderName,
    chat_name: chatName || undefined,
    proposed_title: proposedTitle,
    proposed_date: proposedDate || undefined,
    proposed_time: proposedTime || undefined,
    proposed_location: proposedLocation || undefined,
    raw_message: rawMessage,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  memoryProposals.push(proposal);
  return proposal;
}

export function getLatestPendingProposal(): PendingProposal | null {
  const pending = memoryProposals.filter((p) => p.status === "pending");
  return pending.length > 0 ? pending[pending.length - 1] : null;
}

export function getPendingProposalById(id: number): PendingProposal | null {
  return memoryProposals.find((p) => p.id === id) || null;
}

export function markProposalResolved(id: number, status: "accepted" | "declined" | "countered"): boolean {
  const p = memoryProposals.find((item) => item.id === id);
  if (p) {
    p.status = status;
    p.resolved_at = new Date().toISOString();
    return true;
  }
  return false;
}

// ─── Ghosted Message & Follow-up Tracker ────────────────────────

export interface TrackedFollowup {
  id: number;
  chat_jid: string;
  contact_name: string;
  last_sent_text: string;
  sent_at: string;
  status: "waiting" | "nudged" | "replied" | "dismissed";
  last_nudged_at?: string;
}

const memoryFollowups: TrackedFollowup[] = [];
let nextFollowupId = 1;

export function trackSentMessage(chatJid: string, contactName: string, text: string): void {
  if (chatJid.endsWith("@g.us") || chatJid.includes("status@broadcast")) return;
  memoryFollowups.push({
    id: nextFollowupId++,
    chat_jid: chatJid,
    contact_name: contactName,
    last_sent_text: text,
    sent_at: new Date().toISOString(),
    status: "waiting",
  });
}

export function getPendingFollowups(olderThanHours = 24): TrackedFollowup[] {
  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000).toISOString();
  return memoryFollowups.filter((f) => f.status === "waiting" && f.sent_at <= cutoff).slice(0, 10);
}

export function markFollowupReplied(chatJid: string): void {
  for (const f of memoryFollowups) {
    if (f.chat_jid === chatJid && (f.status === "waiting" || f.status === "nudged")) {
      f.status = "replied";
    }
  }
}

export function markFollowupNudged(id: number): void {
  const f = memoryFollowups.find((item) => item.id === id);
  if (f) {
    f.status = "nudged";
    f.last_nudged_at = new Date().toISOString();
  }
}

// ─── Conversational Expense & Split Ledger ───────────────────────

export interface ExpenseRecord {
  id: number;
  chat_jid: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  person?: string;
  is_debt: number; // 0 = expense, 1 = they owe me, 2 = I owe them
  created_at: string;
}

const memoryExpenses: ExpenseRecord[] = [];
let nextExpenseId = 1;

export function addExpense(
  amount: number,
  description: string,
  person: string | null = null,
  category = "General",
  isDebt = 0,
  chatJid = "self"
): ExpenseRecord {
  const exp: ExpenseRecord = {
    id: nextExpenseId++,
    chat_jid: chatJid,
    amount,
    currency: "INR",
    category,
    description,
    person: person || undefined,
    is_debt: isDebt,
    created_at: new Date().toISOString(),
  };
  memoryExpenses.push(exp);
  return exp;
}

export function getExpensesSummary(timeWindow = "month"): { total: number; expenses: ExpenseRecord[] } {
  const expenses = memoryExpenses.filter((e) => e.is_debt === 0);
  const total = expenses.reduce((sum, r) => sum + r.amount, 0);
  return { total, expenses };
}

export function getDebtsSummary(): { owedToMe: ExpenseRecord[]; iOwe: ExpenseRecord[] } {
  const owedToMe = memoryExpenses.filter((e) => e.is_debt === 1);
  const iOwe = memoryExpenses.filter((e) => e.is_debt === 2);
  return { owedToMe, iOwe };
}
