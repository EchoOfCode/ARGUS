import type { WASocket } from "@whiskeysockets/baileys";
import pino from "pino";
import cron from "node-cron";
import { Config } from "./config.js";
import { getDueReminders, markReminderSent } from "./db.js";
import { sendReminder } from "./replySender.js";

const logger = pino({ name: "argus:reminders" });

/**
 * Start the reminder worker.
 * Runs every 60 seconds, checks for due reminders, sends WhatsApp messages.
 */
export function startReminderWorker(sock: WASocket, config: Config): void {
  logger.info("Starting reminder worker (every 60 seconds)");

  cron.schedule("* * * * *", async () => {
    try {
      const dueReminders = getDueReminders();

      if (dueReminders.length === 0) return;

      logger.info({ count: dueReminders.length }, "Due reminders found");

      for (const reminder of dueReminders) {
        try {
          await sendReminder(sock, reminder.chat_jid, reminder.reminder_text, config);
          markReminderSent(reminder.id);
          logger.info(
            { id: reminder.id, text: reminder.reminder_text },
            "Reminder sent"
          );
        } catch (err) {
          logger.error(
            { err, id: reminder.id },
            "Failed to send reminder, will retry next cycle"
          );
          // Don't mark as sent — it'll be picked up again next minute
        }
      }
    } catch (err) {
      logger.error({ err }, "Reminder worker error");
    }
  });
}
