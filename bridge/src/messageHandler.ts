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
  isChatExempted,
  getDb,
  saveChatDirectory,
  getActiveAutopilotRule,
  incrementAutopilotCount,
} from "./db.js";
import {
  sendText,
  sendEventConfirmation,
  sendEventAdded,
  sendError,
  isBotSentMessage,
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

function normalizeJid(jid: string): string {
  if (!jid) return "";
  const base = jid.split(":")[0];
  const user = base.split("@")[0];
  const server = jid.includes("@g.us") ? "g.us" : "s.whatsapp.net";
  return `${user}@${server}`;
}

function extractRawMessage(msg: WAMessage): any {
  let m: any = msg.message;
  if (!m) return null;

  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;

  return m;
}

function getMessageText(msg: WAMessage): string | null {
  const m = extractRawMessage(msg);
  if (!m) return null;

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.templateButtonReplyMessage?.selectedId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    null
  );
}

function getSenderName(msg: WAMessage): string | null {
  return msg.pushName || null;
}

function shouldScanChat(jid: string, config: Config): boolean {
  if (jid === "status@broadcast") return false;

  if (config.listenMode === "allowlist") {
    const norm = normalizeJid(jid);
    return config.allowedJids.some((a) => normalizeJid(a) === norm);
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

const groupMetaCache = new Map<string, string>();

async function resolveChatName(
  sock: WASocket,
  chatJid: string,
  senderName: string | null
): Promise<string> {
  if (chatJid.endsWith("@g.us")) {
    if (groupMetaCache.has(chatJid)) {
      return groupMetaCache.get(chatJid)!;
    }
    try {
      const row = getDb()
        .prepare("SELECT name FROM chat_directory WHERE jid = ?")
        .get(chatJid) as { name: string } | undefined;
      if (row && row.name) {
        groupMetaCache.set(chatJid, row.name);
        return row.name;
      }
    } catch {
      // ignore
    }
    try {
      const meta = await sock.groupMetadata(chatJid);
      if (meta && meta.subject) {
        groupMetaCache.set(chatJid, meta.subject);
        return meta.subject;
      }
    } catch {
      // ignore
    }
    return senderName ? `Group (${senderName})` : "Group Chat";
  }
  return senderName || "Contact";
}

/**
 * Checks if a chat is a dedicated ARGUS command center (Self-Chat or Group named ARGUS).
 */
export function isDedicatedCommandChat(
  chatJid: string,
  chatName: string,
  config: Config
): boolean {
  const normChat = normalizeJid(chatJid);
  const normMy = normalizeJid(config.myJid);

  // Self-chat match
  if (normChat === normMy) return true;

  // Group name match
  const cleanName = chatName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const targetName = config.dedicatedGroupName.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (cleanName.includes(targetName) || cleanName === "argus" || cleanName === "argusai") {
    return true;
  }

  return false;
}

/**
 * Handle voice notes / audio messages sent in command chat.
 */
async function handleVoiceNote(
  sock: WASocket,
  msg: WAMessage,
  chatJid: string,
  config: Config
): Promise<void> {
  try {
    console.log(`🎙️ Voice note detected in ${chatJid}, downloading...`);
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
      console.log(`🎙️ Transcribed: "${text}"`);
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
  // ─── Loop Prevention 1: Ignore messages sent by ARGUS itself ───
  if (msg.key.id && isBotSentMessage(msg.key.id)) {
    return;
  }

  const chatJid = msg.key.remoteJid;
  if (!chatJid) return;

  const isFromMe = msg.key.fromMe || false;
  const senderJid = isFromMe ? config.myJid : msg.key.participant || chatJid;
  const senderName = getSenderName(msg);
  const timestamp = new Date((msg.messageTimestamp as number) * 1000).toISOString();

  // Derive chat name / group name
  const chatName = await resolveChatName(sock, chatJid, senderName);
  const isCommandChat = isDedicatedCommandChat(chatJid, chatName, config);
  const isGroup = chatJid.endsWith("@g.us");

  const rawMsg = extractRawMessage(msg);

  // ─── Voice Note in Command Chat (Self-Chat or Dedicated ARGUS Group) ───
  if (isCommandChat && rawMsg?.audioMessage) {
    await handleVoiceNote(sock, msg, chatJid, config);
    return;
  }

  const text = getMessageText(msg);
  if (!text) return;

  // ─── Loop Prevention 2: Ignore bot formatted output prefixes ───
  const botPrefixes = [
    "🤖", "⚠️", "✅", "📝", "⏰", "🔔", "📬", "💬", "🧠", "🌐", "🗓️", "🎙️",
    "No pending event", "Could not compile", "Something went wrong"
  ];
  if (botPrefixes.some((p) => text.trim().startsWith(p))) {
    return;
  }

  // ─── Check Chat Exemption (ignore exempted chats) ──────────
  if (!isCommandChat && isChatExempted(chatJid)) {
    return;
  }

  console.log(`📩 [${chatName || chatJid}] ${senderName || (isFromMe ? "Me" : "Contact")}: "${text}"`);

  // Auto-index active sender into directory if pushName is present
  if (senderJid && senderName && !senderJid.endsWith("@g.us")) {
    saveChatDirectory(senderJid, senderName, false);
  }

  // Log message in local SQLite database for history & catch-up
  logMessage(chatJid, chatName, senderJid, senderName, text, timestamp, isFromMe);

  // Explicit Command Keyword Check
  const isExplicitCommand =
    isCommandChat ||
    /^\s*(help|\/help|email|emails|mail|mails|inbox|summarize|summ[ae]ri[zs]e|catchup|catch\s*up|recap|todos?|add\s+|remind\s+|briefing|agenda|remember\s+|recall\s+|what\s+is\s+my|where\s+is\s+my|search\s+|google\s+|web\s+|exempt|unexempt)\b/i.test(text);

  // ─── Command Mode: Self-Chat OR Dedicated ARGUS Group OR Explicit Command ───
  if (isCommandChat || (isFromMe && isExplicitCommand)) {
    console.log(`⚡ Processing ARGUS Command in [${chatName || chatJid}]: "${text}"`);
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

  // ─── Check Auto-Pilot Persona Auto-Responder for 1-on-1 DMs ───
  if (!isGroup && !isFromMe && senderJid) {
    const autopilotRule = getActiveAutopilotRule(senderJid);
    if (autopilotRule && autopilotRule.status === "active") {
      console.log(`🤖 [Auto-Pilot] Triggered for ${senderName || senderJid} (${autopilotRule.name})`);

      try {
        // 1. Simulate human typing presence & natural typing delay (2.5s)
        await sock.sendPresenceUpdate("composing", senderJid).catch(() => {});
        await new Promise((r) => setTimeout(r, 2500));

        // 2. Fetch last 6 messages from this conversation for authentic tone matching
        const recentHistory = getDb()
          .prepare(
            "SELECT message_text as text, is_from_me, timestamp FROM message_log WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT 6"
          )
          .all(chatJid) as any[];
        recentHistory.reverse();

        // 3. Generate personalized response acting as Yusuf
        const personaRes = await callBrain(config, "/autopilot/generate-reply", {
          chat_jid: chatJid,
          sender_name: senderName || autopilotRule.name || "Friend",
          incoming_message: text,
          recent_chat_history: recentHistory,
          custom_instruction: autopilotRule.custom_prompt,
        });

        if (personaRes && personaRes.reply_text) {
          // 4. Send response to sender
          await sendText(sock, senderJid, personaRes.reply_text, config);
          incrementAutopilotCount(senderJid);

          // 5. Mirror transparent confirmation card back to dedicated ARGUS command group
          const mirrorMsg = [
            `🤖 *[Auto-Pilot Active]* Replied to *${senderName || autopilotRule.name}* as you:`,
            `📩 *Incoming:* "${text}"`,
            `💬 *Reply Sent:* "${personaRes.reply_text}"`,
          ].join("\n");
          await sendText(sock, config.myJid, mirrorMsg, config);

          console.log(`🚀 [Auto-Pilot] Sent reply to ${senderName || senderJid}: "${personaRes.reply_text}"`);
          return;
        }
      } catch (autoErr) {
        logger.error({ autoErr, senderJid }, "Error in Auto-Pilot persona response");
      } finally {
        await sock.sendPresenceUpdate("paused", senderJid).catch(() => {});
      }
    }
  }

  // ─── Incoming messages from others (passive scan) ───────────
  if (!config.enablePassiveAlerts || !shouldScanChat(chatJid, config)) {
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

        // Send confirmation prompt to your self-chat or dedicated group
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

        console.log(`🗓️ Event detected from [${chatName}]: "${data.title}" on ${data.date}`);
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
