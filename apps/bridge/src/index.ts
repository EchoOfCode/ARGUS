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
import { initDatabase } from "./db.js";
import { handleMessage } from "./messageHandler.js";
import { startReminderWorker } from "./reminderWorker.js";

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

  // Initialize SQLite
  initDatabase(config.dbPath);
  logger.info({ dbPath: config.dbPath }, "Database initialized");

  // Load or create auth state
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  logger.info({ authDir: config.authDir }, "Auth state loaded");

  // Get latest Baileys version
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info({ version, isLatest }, "Baileys version");

  // Create the socket
  sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }) as any, // Silence internal Baileys logs
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }) as any),
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

      // Sync participating groups to chat directory
      try {
        const groups = await sock!.groupFetchAllParticipating();
        for (const [jid, metadata] of Object.entries(groups)) {
          if (metadata && metadata.subject) {
            initDatabase(config.dbPath);
            const { saveChatDirectory } = await import("./db.js");
            saveChatDirectory(jid, metadata.subject, true);
          }
        }
        logger.info({ groupCount: Object.keys(groups).length }, "Synced WhatsApp groups into directory");
      } catch (err) {
        logger.warn({ err }, "Could not auto-fetch group directory");
      }

      // Start the reminder cron worker
      startReminderWorker(sock!, config);
    }
  });

  // ─── Contact Address Book Synchronization ───────────────────
  sock.ev.on("contacts.upsert", async (contacts: any[]) => {
    const { saveChatDirectory } = await import("./db.js");
    for (const c of contacts) {
      const name = c.name || c.notify || c.verifiedName;
      if (c.id && name) {
        saveChatDirectory(c.id, name, false);
      }
    }
  });

  sock.ev.on("contacts.update", async (updates: any[]) => {
    const { saveChatDirectory } = await import("./db.js");
    for (const c of updates) {
      const name = c.name || c.notify || c.verifiedName;
      if (c.id && name) {
        saveChatDirectory(c.id, name, false);
      }
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
