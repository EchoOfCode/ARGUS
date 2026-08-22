import type { WASocket } from "@whiskeysockets/baileys";
import pino from "pino";
import cron from "node-cron";
import { Config } from "./config.js";
import { getDueReminders, markReminderSent } from "./db.js";
import { sendReminder } from "./replySender.js";
import { handleDailyBriefing } from "./selfChat.js";

const logger = pino({ name: "argus:worker" });

let lastBriefingDate = "";

/**
 * Start the background worker for:
 * 1. Minute-by-minute due reminders
 * 2. Daily morning executive briefing
 */
export function startReminderWorker(sock: WASocket, config: Config): void {
  logger.info("Starting background worker (reminders & daily briefing)");

  cron.schedule("* * * * *", async () => {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    // ─── 1. Due Reminders ──────────────────────────────────────
    try {
      const dueReminders = getDueReminders();

      if (dueReminders.length > 0) {
        logger.info({ count: dueReminders.length }, "Due reminders found");

        for (const reminder of dueReminders) {
          try {
            await sendReminder(sock, reminder.chat_jid, reminder.reminder_text, config);
            markReminderSent(reminder.id);
            logger.info({ id: reminder.id, text: reminder.reminder_text }, "Reminder sent");
          } catch (err) {
            logger.error({ err, id: reminder.id }, "Failed to send reminder, will retry next cycle");
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Reminder worker error");
    }

    // ─── 2. Daily Executive Briefing ───────────────────────────
    if (config.enableDailyBriefing) {
      if (
        now.getHours() === config.briefingHour &&
        now.getMinutes() === config.briefingMinute &&
        lastBriefingDate !== todayStr
      ) {
        logger.info("Triggering scheduled daily executive briefing...");
        lastBriefingDate = todayStr;
        try {
          await handleDailyBriefing(sock, config.myJid, config);
        } catch (err) {
          logger.error({ err }, "Daily briefing worker error");
        }
      }
    }
  });
}
