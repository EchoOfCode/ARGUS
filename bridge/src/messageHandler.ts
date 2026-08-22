import { downloadMediaMessage, type WASocket, type WAMessage } from "@whiskeysockets/baileys";
import FormData from "form-data";
import pino from "pino";
import { Config } from "./config.js";
import {
  logMessage,
  addPendingEvent,
  getLatestPendingEvent,
  confirmEvent,
  ignoreEvent,
} from "./db.js";
import {
  sendText,
  sendEventConfirmation,
  sendEventAdded,
  sendError,
} from "./replySender.js";
import { handleSelfChatMessage } from "./selfChat.js";
import { callBrain, callBrainMultipart } from "./brainClient.js";

const logger = pino({ name: "argus:handler" });

// Fast regex pre-filter to protect Groq free-tier rate limits
const SCHEDULING_REGEX =
  /\b(meet|meeting|call|appointment|sync|interview|zoom|google meet|webinar|flight|tomorrow|yesterday|today|tonight|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)|at\s+\d{1,2}|on\s+\d{1,2}(st|nd|rd|th)?)\b/i;

function hasSchedulingCue(text: string): boolean {
  return SCHEDULING_REGEX.test(text);
}

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

function getSenderName(msg: WAMessage): string | null {
  return msg.pushName || null;
}

function shouldScanChat(jid: string, config: Config): boolean {
  if (jid === "status@broadcast") return false;

  if (config.listenMode === "allowlist") {
    return config.allowedJids.includes(jid);
  }

  return true;
}

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
 * Handle voice notes / audio messages sent in self-chat.
 */
async function handleVoiceNote(
  sock: WASocket,
  msg: WAMessage,
  chatJid: string,
  config: Config
): Promise<void> {
  try {
    logger.info("Voice note detected in self-chat, downloading audio buffer...");
    const buffer = (await downloadMediaMessage(msg, "buffer", {})) as Buffer;

    if (!buffer || buffer.length === 0) {
      logger.error("Failed to download voice note buffer");
      return;
    }

    const formData = new FormData();
    formData.append("file", buffer, {
      filename: "voice_note.ogg",
      contentType: "audio/ogg",
    });

    const transcriptionRes = await callBrainMultipart(
      config,
      "/transcribe-audio",
      formData
    );

    if (transcriptionRes && transcriptionRes.success && transcriptionRes.transcription) {
      const text = transcriptionRes.transcription.trim();
      logger.info({ transcription: text }, "Voice note transcribed successfully");
      await sendText(sock, chatJid, `🎙️ _"${text}"_`, config);
      await handleSelfChatMessage(sock, text, chatJid, config);
    } else {
      await sendError(sock, chatJid, "Could not transcribe audio note.", config);
    }
  } catch (err: any) {
    logger.error({ err }, "Error processing voice note");
    await sendError(sock, chatJid, "Error processing audio voice note.", config);
  }
}

/**
 * Main message handler. Called for every incoming message.
 */
export async function handleMessage(
  sock: WASocket,
  msg: WAMessage,
  config: Config
): Promise<void> {
  const chatJid = msg.key.remoteJid;
  if (!chatJid) return;

  const isFromMe = msg.key.fromMe || false;
  const senderJid = isFromMe ? config.myJid : msg.key.participant || chatJid;
  const senderName = getSenderName(msg);
  const timestamp = new Date((msg.messageTimestamp as number) * 1000).toISOString();

  // ─── Voice Note in Self-Chat ─────────────────────────────────
  if (chatJid === config.myJid && msg.message?.audioMessage) {
    await handleVoiceNote(sock, msg, chatJid, config);
    return;
  }

  const text = getMessageText(msg);
  if (!text) return;

  // Derive chat name / group name
  const chatName = chatJid.endsWith("@g.us")
    ? (msg as any).groupMetadata?.subject || senderName || "Group Chat"
    : senderName || "Contact";

  // Log message in local SQLite database for history & catch-up
  logMessage(chatJid, chatName, senderJid, senderName, text, timestamp, isFromMe);

  logger.debug(
    { chat: chatJid, from: senderName || senderJid, isFromMe, text: text.substring(0, 80) },
    "Message logged"
  );

  // ─── Self-chat: command mode ─────────────────────────────────
  if (chatJid === config.myJid && isFromMe) {
    await handleSelfChatMessage(sock, text, chatJid, config);
    return;
  }

  // ─── Messages FROM you in other chats: check for confirmation replies ───
  if (isFromMe) {
    const action = parseConfirmationReply(text);
    if (action) {
      await handleConfirmationAction(sock, chatJid, action, config);
      return;
    }
    return;
  }

  // ─── Incoming messages from others ─────────────────────────
  if (!shouldScanChat(chatJid, config)) {
    return;
  }

  // Zero-cost pre-filtering: only call Groq if text has scheduling cues!
  if (!hasSchedulingCue(text)) {
    return;
  }

  // Send to AI Brain for event detection
  try {
    const result = await callBrain(config, "/process-message", {
      sender_jid: senderJid,
      message_text: text,
      chat_jid: chatJid,
      timestamp,
      is_self_chat: false,
    });

    if (!result || !result.should_respond) {
      return;
    }

    if (result.intent === "event" && result.extract_data) {
      const data = result.extract_data;

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

        // Send confirmation prompt to your self-chat
        await sendEventConfirmation(
          sock,
          config.myJid,
          pending.id,
          data.title || "Event",
          data.date || "TBD",
          data.time,
          senderName || chatName,
          config
        );

        logger.info(
          { eventId: pending.id, title: data.title, date: data.date },
          "Event detected and confirmation sent"
        );
      }
    }
  } catch (err) {
    logger.error({ err, chat: chatJid }, "Error processing background message");
  }
}

async function handleConfirmationAction(
  sock: WASocket,
  chatJid: string,
  action: "yes" | "ignore" | "edit",
  config: Config
): Promise<void> {
  const pending = getLatestPendingEvent(config.myJid);

  if (!pending) {
    await sendText(sock, config.myJid, "No pending event to confirm.", config);
    return;
  }

  switch (action) {
    case "yes": {
      confirmEvent(pending.id);
      await sendEventAdded(
        sock,
        config.myJid,
        pending.title || "Event",
        pending.event_date || "TBD",
        pending.event_time,
        config
      );
      break;
    }

    case "ignore": {
      ignoreEvent(pending.id);
      await sendText(sock, config.myJid, "❌ Event ignored.", config);
      break;
    }

    case "edit": {
      await sendText(
        sock,
        config.myJid,
        `✏️ *Edit event:*\n\nTitle: ${pending.title}\nDate: ${pending.event_date}\nTime: ${pending.event_time}\n\n_Reply "yes" to add as-is, or "ignore" to skip._`,
        config
      );
      break;
    }
  }
}
