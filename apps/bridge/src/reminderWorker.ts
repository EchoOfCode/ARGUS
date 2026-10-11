import type { WASocket } from "@whiskeysockets/baileys";
import pino from "pino";
import cron from "node-cron";
import { Config } from "./config.js";
import { callBrain } from "./brainClient.js";
import { sendReminder } from "./replySender.js";
import { handleDailyBriefing } from "./selfChat.js";
import { syncAutopilotRulesFromBrain } from "./db.js";

const logger = pino({ name: "argus:worker" });

let lastBriefingDate = "";

/**
 * Start the background worker for:
 * 1. Minute-by-minute due reminders (queried from Brain via authenticated API)
 * 2. Daily morning executive briefing
 */
export function startReminderWorker(sock: WASocket, config: Config): void {
  logger.info("Starting background worker (reminders & daily briefing)");

  cron.schedule("* * * * *", async () => {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    // ─── 1. Due Reminders ──────────────────────────────────────
    try {
      const res = await callBrain(config, "/api/reminders/due", {}, "GET").catch((err) => {
        logger.warn({ error: err.message }, "Could not fetch due reminders from brain");
        return null;
      });

      const dueReminders = res?.reminders || [];

      if (dueReminders.length > 0) {
        logger.info({ count: dueReminders.length }, "Due reminders found");

        for (const reminder of dueReminders) {
          try {
            const destJid = reminder.chat_jid && reminder.chat_jid.includes("@")
              ? reminder.chat_jid
              : (config.commandGroupJid || config.myJid);
            await sendReminder(sock, destJid, reminder.reminder_text, config);
            await callBrain(config, `/api/reminders/${reminder.id}/ack`, {}, "POST");
            logger.info({ id: reminder.id, text: reminder.reminder_text }, "Reminder sent and acknowledged");
          } catch (err) {
            try {
              const fallbackJid = config.commandGroupJid || config.myJid;
              await sendReminder(sock, fallbackJid, reminder.reminder_text, config);
              await callBrain(config, `/api/reminders/${reminder.id}/ack`, {}, "POST");
              logger.info({ id: reminder.id }, "Reminder sent via command group fallback");
            } catch (fallbackErr) {
              logger.error({ err, id: reminder.id }, "Failed to send reminder, will retry next cycle");
            }
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Reminder worker error");
    }

    // ─── 2. Background Autopilot Rules Sync ────────────────────
    try {
      await syncAutopilotRulesFromBrain(config);
    } catch {
      // background sync warning already handled inside db.ts
    }

    // ─── 3. Daily Executive Briefing ───────────────────────────
    if (config.enableDailyBriefing) {
      if (
        now.getHours() === config.briefingHour &&
        now.getMinutes() === config.briefingMinute &&
        lastBriefingDate !== todayStr
      ) {
        logger.info("Triggering scheduled daily executive briefing...");
        lastBriefingDate = todayStr;
        try {
          const destJid = config.commandGroupJid || config.myJid;
          await handleDailyBriefing(sock, destJid, config);
        } catch (err) {
          logger.error({ err }, "Daily briefing worker error");
        }
      }
    }
  });
}
