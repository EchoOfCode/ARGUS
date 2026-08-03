import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import pino from "pino";
import { Config } from "./config.js";
import { logMessage, addPendingEvent, getLatestPendingEvent, confirmEvent, ignoreEvent } from "./db.js";
import { sendText, sendEventConfirmation, sendEventAdded, sendError } from "./replySender.js";
import { handleSelfChatMessage } from "./selfChat.js";
import { callBrain } from "./brainClient.js";

const logger = pino({ name: "argus:handler" });

/**
 * Extract the text content from a WAMessage.
 */
function getMessageText(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    null
  );
}

/**
 * Get the sender's push name (display name) from the message.
 */
function getSenderName(msg: WAMessage): string | null {
  return msg.pushName || null;
}

/**
 * Determine if a JID should be scanned for events.
 */
function shouldScanChat(jid: string, config: Config): boolean {
  // Never scan status broadcasts or groups (for now — group support can be added later)
  if (jid === "status@broadcast") return false;

  // In allowlist mode, only scan allowed JIDs
  if (config.listenMode === "allowlist") {
    return config.allowedJids.includes(jid);
  }

  // In "all" mode, scan everything (except status)
  return true;
}

/**
 * Check if a message is a response to an event confirmation prompt.
 * Returns the action (yes/ignore/edit) or null if not a confirmation response.
 */
function parseConfirmationReply(text: string): "yes" | "ignore" | "edit" | null {
  const normalized = text.trim().toLowerCase();

  if (["yes", "y", "✅", "confirm", "add", "ok", "okay"].includes(normalized)) {
    return "yes";
  }
  if (["no", "n", "❌", "ignore", "skip", "nope", "nah"].includes(normalized)) {
    return "ignore";
  }
  if (["edit", "✏️", "change", "modify"].includes(normalized)) {
    return "edit";
  }

  return null;
}

/**
 * Main message handler. Called for every incoming message.
 */
export async function handleMessage(
  sock: WASocket,
  msg: WAMessage,
  config: Config
): Promise<void> {
  const text = getMessageText(msg);
  if (!text) return; // Skip non-text messages (images, stickers, etc.)

  const chatJid = msg.key.remoteJid;
  if (!chatJid) return;

  const isFromMe = msg.key.fromMe || false;
  const senderJid = isFromMe ? config.myJid : (msg.key.participant || chatJid);
  const senderName = getSenderName(msg);
  const timestamp = new Date(
    (msg.messageTimestamp as number) * 1000
  ).toISOString();

  // Log every message for summarization context
  logMessage(chatJid, senderJid, senderName, text, timestamp, isFromMe);

  logger.info(
    {
      chat: chatJid,
      from: senderName || senderJid,
      isFromMe,
      text: text.substring(0, 100),
    },
    "Message received"
  );

  // ─── Self-chat: command mode ─────────────────────────────────
  // Messages FROM you TO yourself = commands to ARGUS
  if (chatJid === config.myJid && isFromMe) {
    await handleSelfChatMessage(sock, text, chatJid, config);
    return;
  }

  // ─── Messages FROM you in other chats: check for confirmation replies ───
  if (isFromMe) {
    // Check if this is a reply to our event confirmation
    const action = parseConfirmationReply(text);
    if (action) {
      await handleConfirmationAction(sock, chatJid, action, config);
      return;
    }
    // Otherwise, ignore our own messages in other chats
    return;
  }

  // ─── Incoming messages from others ─────────────────────────
  if (!shouldScanChat(chatJid, config)) {
    logger.debug({ chat: chatJid }, "Chat not in scan scope, skipping");
    return;
  }

  // Check if this is a confirmation reply from the user in the ARGUS chat
  // (ARGUS sends confirmations to your self-chat, so check there)
  // This is handled above in the self-chat section

  // Send to AI Brain for passive event detection
  try {
    const result = await callBrain(config, "/process-message", {
      sender_jid: senderJid,
      message_text: text,
      chat_jid: chatJid,
      timestamp,
      is_self_chat: false,
    });

    if (!result || !result.should_respond) {
      logger.debug({ chat: chatJid }, "No action needed for this message");
      return;
    }

    if (result.intent === "event" && result.extract_data) {
      const data = result.extract_data;

      // Only proceed if confidence is reasonable
      if (data.confidence && data.confidence >= 0.6) {
        const pending = addPendingEvent(
          chatJid,
          senderJid,
          text,
          data.title,
          data.date,
          data.time,
          data.confidence
        );

        // Send confirmation to YOUR self-chat (not the sender's chat!)
        await sendEventConfirmation(
          sock,
          config.myJid,
          pending.id,
          data.title || "Event",
          data.date || "TBD",
          data.time,
          senderName,
          config
        );

        logger.info(
          {
            eventId: pending.id,
            title: data.title,
            date: data.date,
            confidence: data.confidence,
          },
          "Event detected, confirmation sent to self-chat"
        );
      }
    }
  } catch (err) {
    logger.error({ err, chat: chatJid }, "Error processing message");
    // Don't crash — just log and continue
  }
}

/**
 * Handle a confirmation action (yes/ignore/edit) for a pending event.
 */
async function handleConfirmationAction(
  sock: WASocket,
  chatJid: string,
  action: "yes" | "ignore" | "edit",
  config: Config
): Promise<void> {
  // Find the latest pending event for this chat (self-chat for now)
  const pending = getLatestPendingEvent(config.myJid);

  if (!pending) {
    await sendText(sock, config.myJid, "No pending event to confirm.", config);
    return;
  }

  switch (action) {
    case "yes": {
      confirmEvent(pending.id);

      // TODO: In Phase 3, send to Android companion to write to CalendarContract
      // For now, just confirm in WhatsApp
      await sendEventAdded(
        sock,
        config.myJid,
        pending.title || "Event",
        pending.event_date || "TBD",
        pending.event_time,
        config
      );

      logger.info({ eventId: pending.id }, "Event confirmed");
      break;
    }

    case "ignore": {
      ignoreEvent(pending.id);
      await sendText(sock, config.myJid, "❌ Event ignored.", config);
      logger.info({ eventId: pending.id }, "Event ignored");
      break;
    }

    case "edit": {
      // TODO: In Phase 3, send to Android companion for edit UI
      await sendText(
        sock,
        config.myJid,
        `✏️ *Edit event:*\n\nTitle: ${pending.title}\nDate: ${pending.event_date}\nTime: ${pending.event_time}\n\n_Edit feature coming in Phase 3 — reply "yes" to add as-is, or "ignore" to skip._`,
        config
      );
      break;
    }
  }
}
