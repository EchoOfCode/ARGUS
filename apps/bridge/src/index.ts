// ─── Filter internal libsignal Bad MAC logs on background packets ───
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: any, encoding?: any, callback?: any) => {
  const str = chunk ? chunk.toString() : "";
  if (
    str.includes("Bad MAC") ||
    str.includes("Session error") ||
    str.includes("SessionCipher") ||
    str.includes("verifyMAC") ||
    str.includes("Failed to decrypt message with any known session")
  ) {
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  }
  return originalStderrWrite(chunk, encoding, callback);
}) as any;

const originalConsoleError = console.error.bind(console);
console.error = (...args: any[]) => {
  const str = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  if (
    str.includes("Bad MAC") ||
    str.includes("Session error") ||
    str.includes("Failed to decrypt message with any known session")
  ) {
    return;
  }
  originalConsoleError(...args);
};

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} from "@whiskeysockets/baileys";
import type { WASocket } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import path from "path";

import { loadConfig, Config } from "./config.js";
import { initJournal, startJournalWorker } from "./journal.js";
import { deriveOwnerIdentity } from "./authority.js";
import { callBrain } from "./brainClient.js";
import { handleMessage } from "./messageHandler.js";
import { startReminderWorker } from "./reminderWorker.js";
import { syncAutopilotRulesFromBrain, saveChatDirectory } from "./db.js";

const logger = pino({ level: "info", name: "argus:bridge" });

let sock: WASocket | null = null;
let config: Config;

const msgRetryCounterCache = {
  store: new Map<string, number>(),
  get<T = any>(key: string): T | undefined {
    return this.store.get(key) as any;
  },
  set(key: string, value: any) {
    this.store.set(key, value);
  },
  del(key: string) {
    this.store.delete(key);
  },
  flushAll() {
    this.store.clear();
  },
};

const rawMessageStore = new Map<string, any>();

async function connectToWhatsApp(): Promise<void> {
  config = loadConfig();

  // Initialize durable append-only journal and start drain worker (ADR 0001)
  initJournal();
  startJournalWorker(config);
  logger.info("Durable append-only journal initialized and worker started");

  // Load or create auth state
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  logger.info({ authDir: config.authDir }, "Auth state loaded");

  // Get latest Baileys version
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info({ version, isLatest }, "Baileys version");

  // Create the socket
  sock = makeWASocket({
    version,
    logger: pino({ level: "info" }) as any, // Baileys internal logs enabled for diagnostics
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "warn" }) as any),
    },
    browser: Browsers.windows("Desktop"),
    msgRetryCounterCache,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    getMessage: async (key) => {
      if (key.id && rawMessageStore.has(key.id)) {
        return rawMessageStore.get(key.id);
      }
      return undefined;
    },
    patchMessageBeforeSending: (message) => message,
  });

  // ─── Connection events ──────────────────────────────────────

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n");
      console.log("╔══════════════════════════════════════════════╗");
      console.log("║  🔗 Scan this QR code with WhatsApp Mobile  ║");
      console.log("║     Settings → Linked Devices → Link        ║");
      console.log("╚══════════════════════════════════════════════╝");
      console.log("");
      qrcode.generate(qr, { small: true });
      console.log("");
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      const errorCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      logger.warn(
        { errorCode, shouldReconnect },
        "Connection closed"
      );

      if (shouldReconnect) {
        console.log("🔄 Reconnecting in 5 seconds...");
        await new Promise((r) => setTimeout(r, 5000));
        await connectToWhatsApp();
      } else {
        console.log("❌ Logged out. Delete auth_info/ folder and restart to re-link.");
        process.exit(1);
      }
    }

    if (connection === "open") {
      console.log("\n");
      console.log("╔══════════════════════════════════════════════╗");
      console.log("║  ✅ ARGUS is connected to WhatsApp!         ║");
      console.log("║                                              ║");
      console.log("║  • Listening for messages...                 ║");
      console.log("║  • Reminder worker active                    ║");
      console.log("║  • Send 'help' to yourself to get started    ║");
      console.log("╚══════════════════════════════════════════════╝");
      console.log("");

      logger.info("WhatsApp connection established");

      // Verify owner identity matches paired session credentials (ADR 0002)
      try {
        const identity = deriveOwnerIdentity(sock!.user, config.myJid);
        logger.info(identity, "Verified owner identity from WhatsApp credentials");
      } catch (err: any) {
        logger.fatal({ error: err.message }, "Halting bridge due to identity mismatch assertion failure");
        process.exit(1);
      }

      // Sync participating groups to Brain chat directory via REST API
      try {
        const groups = await sock!.groupFetchAllParticipating();
        const contactList = Object.entries(groups)
          .filter(([_, meta]) => meta && meta.subject)
          .map(([jid, meta]) => ({ jid, name: meta.subject, is_group: true }));

        if (contactList.length > 0) {
          await callBrain(config, "/api/contacts/sync", { contacts: contactList }).catch(() => {});
        }
        logger.info({ groupCount: contactList.length }, "Synced WhatsApp groups into Brain directory");

        // Auto-pin command group JID if not explicitly configured (ADR 0002)
        if (!config.commandGroupJid && config.dedicatedGroupName) {
          const matchedGroup = Object.entries(groups).find(
            ([_, meta]) => meta && meta.subject && meta.subject.trim().toLowerCase() === config.dedicatedGroupName.toLowerCase()
          );
          if (matchedGroup) {
            config.commandGroupJid = matchedGroup[0];
            logger.info({ groupJid: matchedGroup[0], groupName: config.dedicatedGroupName }, "Auto-pinned WhatsApp command group JID from group name");
          }
        }
      } catch (err) {
        logger.warn({ err }, "Could not auto-fetch group directory");
      }

      // Log metadata and participants of command group
      if (config.commandGroupJid) {
        try {
          const cmdGroupMeta = await sock!.groupMetadata(config.commandGroupJid);
          logger.info({
            groupJid: config.commandGroupJid,
            subject: cmdGroupMeta.subject,
            participantsCount: cmdGroupMeta.participants?.length,
            participants: cmdGroupMeta.participants?.map((p: any) => p.id),
          }, "Command Group Metadata & Participants");
        } catch (cgErr: any) {
          logger.warn({ error: cgErr.message, commandGroupJid: config.commandGroupJid }, "Could not fetch command group metadata");
        }
      }

      // Sync active autopilot rules from Brain central database (ADR 0001)
      try {
        await syncAutopilotRulesFromBrain(config);
      } catch (err) {
        logger.warn({ err }, "Could not initial-sync autopilot rules from Brain");
      }

      // Sync known contacts from Brain directory into bridge memory (ADR 0001)
      try {
        const contactsRes = await callBrain(config, "/api/contacts", {}, "GET");
        if (contactsRes?.contacts && Array.isArray(contactsRes.contacts)) {
          for (const c of contactsRes.contacts) {
            if (c.jid && c.name) {
              saveChatDirectory(c.jid, c.name, Boolean(c.is_group));
            }
          }
          logger.info({ count: contactsRes.contacts.length }, "Loaded known contacts from Brain directory");
        }
      } catch (err) {
        logger.warn({ err }, "Could not sync contacts from Brain");
      }

      // Start the reminder cron worker
      startReminderWorker(sock!, config);
    }
  });

  // ─── Contact Address Book Synchronization via Brain API ───────
  sock.ev.on("messaging-history.set", async ({ chats, contacts }: any) => {
    const contactList: Array<{ jid: string; name: string; is_group: boolean }> = [];
    if (contacts && Array.isArray(contacts)) {
      for (const c of contacts) {
        if (c.id && c.id !== config.myJid && !c.id.endsWith("@lid") && !c.id.includes("@broadcast") && (c.name || c.notify || c.verifiedName)) {
          contactList.push({
            jid: c.id,
            name: c.name || c.notify || c.verifiedName,
            is_group: c.id.endsWith("@g.us"),
          });
        }
      }
    }
    if (chats && Array.isArray(chats)) {
      for (const ch of chats) {
        if (ch.id && ch.id !== config.myJid && !ch.id.endsWith("@lid") && !ch.id.includes("@broadcast") && (ch.name || ch.subject)) {
          contactList.push({
            jid: ch.id,
            name: ch.name || ch.subject || ch.id.split("@")[0],
            is_group: ch.id.endsWith("@g.us"),
          });
        }
      }
    }
    if (contactList.length > 0) {
      logger.info({ count: contactList.length }, "Synced messaging history contacts/chats into Brain directory");
      callBrain(config, "/api/contacts/sync", { contacts: contactList }).catch(() => {});
    }
  });

  sock.ev.on("chats.upsert", async (chats: any[]) => {
    const contactList = chats
      .filter((c) => c.id && c.id !== config.myJid && !c.id.endsWith("@lid") && !c.id.includes("@broadcast") && (c.name || c.subject))
      .map((c) => ({
        jid: c.id,
        name: c.name || c.subject,
        is_group: c.id.endsWith("@g.us"),
      }));
    if (contactList.length > 0) {
      callBrain(config, "/api/contacts/sync", { contacts: contactList }).catch(() => {});
    }
  });

  sock.ev.on("contacts.upsert", async (contacts: any[]) => {
    const contactList = contacts
      .filter((c) => c.id && c.id !== config.myJid && !c.id.endsWith("@lid") && !c.id.includes("@broadcast") && (c.name || c.notify || c.verifiedName))
      .map((c) => ({
        jid: c.id,
        name: c.name || c.notify || c.verifiedName,
        is_group: c.id.endsWith("@g.us"),
      }));
    if (contactList.length > 0) {
      callBrain(config, "/api/contacts/sync", { contacts: contactList }).catch(() => {});
    }
  });

  sock.ev.on("contacts.update", async (updates: any[]) => {
    const contactList = updates
      .filter((c) => c.id && c.id !== config.myJid && !c.id.endsWith("@lid") && !c.id.includes("@broadcast") && (c.name || c.notify || c.verifiedName))
      .map((c) => ({
        jid: c.id,
        name: c.name || c.notify || c.verifiedName,
        is_group: c.id.endsWith("@g.us"),
      }));
    if (contactList.length > 0) {
      callBrain(config, "/api/contacts/sync", { contacts: contactList }).catch(() => {});
    }
  });

  // Save credentials when they update
  sock.ev.on("creds.update", saveCreds);

  // ─── Message events ─────────────────────────────────────────

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const msg of messages) {
      // Skip status broadcasts
      if (msg.key.remoteJid === "status@broadcast") continue;

      // Skip empty protocol messages (like key distribution, receipts)
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid || "";
      const isFromMe = Boolean(msg.key.fromMe);
      const participant = msg.key.participant || "";
      logger.info({ remoteJid, isFromMe, participant, type }, "Incoming WhatsApp message upsert");

      if (msg.key.id && msg.message) {
        rawMessageStore.set(msg.key.id, msg.message);
        if (rawMessageStore.size > 2000) {
          const first = rawMessageStore.keys().next().value;
          if (first) rawMessageStore.delete(first);
        }
      }

      try {
        await handleMessage(sock!, msg, config);
      } catch (err) {
        logger.error({ err, key: msg.key }, "Error handling message");
      }
    }
  });

  sock.ev.on("messages.update", (updates) => {
    logger.debug({ count: updates.length }, "messages.update event");
  });

  sock.ev.on("message-receipt.update", (receipts) => {
    logger.debug({ count: receipts.length }, "message-receipt.update event");
  });
}

// ─── Entry point ───────────────────────────────────────────────

console.log("");
console.log("╔══════════════════════════════════════════════╗");
console.log("║  🤖 ARGUS — Personal AI Assistant           ║");
console.log("║     WhatsApp Bridge v1.0.0                   ║");
console.log("╚══════════════════════════════════════════════╝");
console.log("");

connectToWhatsApp().catch((err) => {
  logger.fatal({ err }, "Fatal error starting ARGUS bridge");
  process.exit(1);
});

process.on("unhandledRejection", (err: any) => {
  if (err?.message?.includes("Bad MAC")) {
    logger.debug("Signal session key retry handled (Bad MAC).");
    return;
  }
  logger.warn({ err }, "Unhandled promise warning");
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down ARGUS bridge...");
  sock?.end(undefined);
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n👋 Shutting down ARGUS bridge...");
  sock?.end(undefined);
  process.exit(0);
});
