import type { WASocket } from "@whiskeysockets/baileys";
import pino from "pino";
import { Config } from "./config.js";

const logger = pino({ name: "argus:reply" });

/**
 * Rate-limited WhatsApp message sender.
 *
 * Enforces a minimum delay between sends to avoid WhatsApp detection.
 * All outgoing messages should go through this module.
 */

let lastSendTime = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedSend(
  sock: WASocket,
  jid: string,
  content: { text: string },
  config: Config
): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastSendTime;
  const delay = config.sendDelayMs;

  if (elapsed < delay) {
    await sleep(delay - elapsed);
  }

  try {
    await sock.sendMessage(jid, content);
    lastSendTime = Date.now();
    logger.info({ to: jid, length: content.text.length }, "Message sent");
  } catch (err) {
    logger.error({ err, to: jid }, "Failed to send message");
    throw err;
  }
}

/**
 * Send a plain text message.
 */
export async function sendText(
  sock: WASocket,
  jid: string,
  text: string,
  config: Config
): Promise<void> {
  await rateLimitedSend(sock, jid, { text }, config);
}

/**
 * Send an event confirmation prompt.
 */
export async function sendEventConfirmation(
  sock: WASocket,
  jid: string,
  eventId: number,
  title: string,
  date: string,
  time: string | null,
  senderName: string | null,
  config: Config
): Promise<void> {
  const timeStr = time ? ` at ${formatTime(time)}` : " (all day)";
  const sourceStr = senderName ? ` in chat with ${senderName}` : "";

  const message = [
    `🗓️ *Event detected${sourceStr}:*`,
    `   *${title}* — ${formatDate(date)}${timeStr}`,
    ``,
    `Reply to confirm:`,
    `   ✅ *yes* — Add to calendar`,
    `   ✏️ *edit* — Modify details`,
    `   ❌ *ignore* — Skip this one`,
    ``,
    `_(Event #${eventId})_`,
  ].join("\n");

  await sendText(sock, jid, message, config);
}

/**
 * Send a reminder notification.
 */
export async function sendReminder(
  sock: WASocket,
  jid: string,
  reminderText: string,
  config: Config
): Promise<void> {
  const message = `🔔 *Reminder:* ${reminderText}`;
  await sendText(sock, jid, message, config);
}

/**
 * Send confirmation that an event was added.
 */
export async function sendEventAdded(
  sock: WASocket,
  jid: string,
  title: string,
  date: string,
  time: string | null,
  config: Config
): Promise<void> {
  const timeStr = time ? ` at ${formatTime(time)}` : " (all day)";
  const message = `✅ *Added to calendar:* ${title} — ${formatDate(date)}${timeStr}`;
  await sendText(sock, jid, message, config);
}

/**
 * Send a reminder confirmation.
 */
export async function sendReminderSet(
  sock: WASocket,
  jid: string,
  reminderText: string,
  dueAt: string,
  config: Config
): Promise<void> {
  const message = `⏰ *Reminder set:* ${reminderText}\n📅 Due: ${dueAt}`;
  await sendText(sock, jid, message, config);
}

/**
 * Send a todo list.
 */
export async function sendTodoList(
  sock: WASocket,
  jid: string,
  todos: Array<{ id: number; text: string; completed: number }>,
  config: Config
): Promise<void> {
  if (todos.length === 0) {
    await sendText(sock, jid, "📝 Your todo list is empty!", config);
    return;
  }

  const lines = todos.map((t) => {
    const check = t.completed ? "✅" : "⬜";
    return `${check} *#${t.id}* — ${t.text}`;
  });

  const message = `📝 *Your Todos:*\n\n${lines.join("\n")}\n\n_Reply "done #id" to complete, "delete #id" to remove_`;
  await sendText(sock, jid, message, config);
}

/**
 * Send an error message.
 */
export async function sendError(
  sock: WASocket,
  jid: string,
  errorText: string,
  config: Config
): Promise<void> {
  const message = `⚠️ ${errorText}`;
  await sendText(sock, jid, message, config);
}

// ─── Formatting helpers ────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-IN", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string): string {
  try {
    const [hours, minutes] = timeStr.split(":").map(Number);
    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}`;
  } catch {
    return timeStr;
  }
}
