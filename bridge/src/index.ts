import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
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
    printQRInTerminal: false, // We'll handle QR manually for better display
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
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

      // Start the reminder cron worker
      startReminderWorker(sock!, config);
    }
  });

  // Save credentials when they update
  sock.ev.on("creds.update", saveCreds);

  // ─── Message events ─────────────────────────────────────────

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // Only process new messages, not history sync
    if (type !== "notify") return;

    for (const msg of messages) {
      // Skip status broadcasts
      if (msg.key.remoteJid === "status@broadcast") continue;

      // Skip protocol messages (reactions, receipts, etc.)
      if (!msg.message) continue;

      // Skip messages that are too old (more than 2 minutes)
      const msgTimestamp = (msg.messageTimestamp as number) * 1000;
      const age = Date.now() - msgTimestamp;
      if (age > 120_000) {
        logger.debug(
          { age: Math.round(age / 1000), key: msg.key },
          "Skipping old message"
        );
        continue;
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
