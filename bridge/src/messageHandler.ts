import { downloadMediaMessage, type WASocket, type WAMessage } from "@whiskeysockets/baileys";
import FormData from "form-data";
import axios from "axios";
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
  getDedicatedGroupJid,
  setDedicatedGroupJid,
  addPendingProposal,
  importVCardText,
  markFollowupReplied,
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

  if (isCommandChat && isGroup) {
    setDedicatedGroupJid(chatJid);
    saveChatDirectory(chatJid, "ARGUS", true);
  }

  const rawMsg = extractRawMessage(msg);

  // ─── Voice Note in Command Chat (Self-Chat or Dedicated ARGUS Group) ───
  if (isCommandChat && rawMsg?.audioMessage) {
    await handleVoiceNote(sock, msg, chatJid, config);
    return;
  }

  // ─── 1-Second Contact Sync (.vcf Document / Contact Card / Contacts Array) ───
  if (isCommandChat) {
    // 1. Single Contact Card
    if (rawMsg?.contactMessage?.vcard) {
      const res = importVCardText(rawMsg.contactMessage.vcard);
      if (res.imported > 0) {
        const c = res.contacts[0];
        await sendText(
          sock,
          chatJid,
          `📇 *Contact Synced!* Added *${c.name}* (${c.jid.replace("@s.whatsapp.net", "")}) to your ARGUS Address Book! ✨`,
          config
        );
        return;
      }
    }

    // 2. Multiple Contact Cards
    if (rawMsg?.contactsArrayMessage?.contacts) {
      let total = 0;
      for (const c of rawMsg.contactsArrayMessage.contacts) {
        if (c.vcard) {
          const res = importVCardText(c.vcard);
          total += res.imported;
        }
      }
      if (total > 0) {
        await sendText(
          sock,
          chatJid,
          `📇 *Contact Sync Complete!* Added *${total}* contacts to your ARGUS Address Book! ✨`,
          config
        );
        return;
      }
    }

    // 3. .vcf Document File Drop
    if (
      rawMsg?.documentMessage &&
      (rawMsg.documentMessage.fileName?.toLowerCase().endsWith(".vcf") ||
        rawMsg.documentMessage.mimetype?.includes("vcard") ||
        rawMsg.documentMessage.mimetype?.includes("text/x-vcard"))
    ) {
      try {
        console.log(`📇 .vcf Contact file detected in ${chatJid}, downloading...`);
        const buffer = (await downloadMediaMessage(msg, "buffer", {})) as Buffer;
        const vcfContent = buffer.toString("utf-8");
        const res = importVCardText(vcfContent);
        await sendText(
          sock,
          chatJid,
          [
            `📇 *Contact Address Book Synced!*`,
            `────────────────────────────`,
            `✅ Successfully imported *${res.imported}* contacts into ARGUS!`,
            `💡 You can now text or message any of them directly by name (e.g. _"tell Harshith I am on my way"_).`,
          ].join("\n"),
          config
        );
        return;
      } catch (docErr) {
        logger.error({ docErr }, "Failed to import .vcf document");
        await sendText(sock, chatJid, "⚠️ Could not parse .vcf contacts file.", config);
        return;
      }
    }

    // 4. PDF Document Drop for Intelligence & Deadlines
    if (rawMsg?.documentMessage?.mimetype?.includes("pdf") || rawMsg?.documentMessage?.fileName?.toLowerCase().endsWith(".pdf")) {
      try {
        const filename = rawMsg?.documentMessage?.fileName || "document.pdf";
        const caption = rawMsg?.documentMessage?.caption || "";

        await sendText(sock, chatJid, `📄 *Analyzing PDF Document:* _"${filename}"_...`, config);
        const buffer = (await downloadMediaMessage(msg, "buffer", {})) as Buffer;

        const formData = new FormData();
        const blob = new Blob([buffer], { type: "application/pdf" });
        formData.append("file", blob, filename);
        if (caption) formData.append("prompt", caption);

        const res = await axios.post(`${config.aiBrainUrl}/documents/analyze`, formData, {
          headers: {
            "X-Argus-Secret": config.argusSecret,
          },
          timeout: 60000,
        });

        const data = res.data;
        let reply = `📄 *Document Analysis (${filename}):*\n────────────────────────────\n${data.summary || "Analysis complete."}`;

        if (data.events && data.events.length > 0) {
          reply += `\n\n📅 *Extracted Deadlines & Events:*`;
          for (const ev of data.events) {
            reply += `\n• *${ev.title}* (${ev.date || "TBD"}${ev.time ? " " + ev.time : ""})`;
            if (ev.date && ev.title) {
              addPendingEvent(chatJid, senderJid || "self", `PDF: ${ev.title}`, ev.title, ev.date, ev.time, 1.0);
            }
          }
        }

        await sendText(sock, chatJid, reply, config);
        return;
      } catch (err: any) {
        logger.error({ err }, "Failed to analyze PDF document");
        await sendText(sock, chatJid, "⚠️ Failed to process PDF document.", config);
        return;
      }
    }

    // 5. Screenshot / Image Vision Drop
    if (rawMsg?.imageMessage) {
      try {
        const caption = rawMsg?.imageMessage?.caption || "";
        await sendText(sock, chatJid, "🔍 *Analyzing Image & Extracting Details...*", config);
        const buffer = (await downloadMediaMessage(msg, "buffer", {})) as Buffer;

        const formData = new FormData();
        const blob = new Blob([buffer], { type: rawMsg?.imageMessage?.mimetype || "image/jpeg" });
        formData.append("file", blob, "image.jpg");
        if (caption) formData.append("prompt", caption);

        const res = await axios.post(`${config.aiBrainUrl}/documents/analyze`, formData, {
          headers: {
            "X-Argus-Secret": config.argusSecret,
          },
          timeout: 60000,
        });

        const data = res.data;
        let reply = `🖼️ *Visual Intelligence:* \n────────────────────────────\n${data.summary || "Analysis complete."}`;

        if (data.events && data.events.length > 0) {
          reply += `\n\n📅 *Detected Dates/Events:*`;
          for (const ev of data.events) {
            reply += `\n• *${ev.title}* (${ev.date || "TBD"}${ev.time ? " " + ev.time : ""})`;
          }
        }

        await sendText(sock, chatJid, reply, config);
        return;
      } catch (err: any) {
        logger.error({ err }, "Failed to analyze image");
        await sendText(sock, chatJid, "⚠️ Failed to process image.", config);
        return;
      }
    }
  }

  const text = getMessageText(msg);
  if (!text) return;

  // Mark pending follow-up as replied if contact texts back in private chat
  if (!isFromMe && !isGroup) {
    markFollowupReplied(chatJid);
  }

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
    /^\s*(help|\/help|email|emails|mail|mails|inbox|autopilot|summarize|summ[ae]ri[zs]e|catchup|catch\s*up|recap|todos?|add\s+|remind\s+|briefing|agenda|remember\s+|recall\s+|what\s+is\s+my|where\s+is\s+my|search\s+|google\s+|web\s+|exempt|unexempt)\b/i.test(text);

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

  // ─── Check Auto-Pilot Persona Auto-Responder (1-on-1 DMs & Groups) ───
  if (!isFromMe && (senderJid || chatJid)) {
    const autopilotRule = getActiveAutopilotRule(chatJid, senderJid);
    if (autopilotRule && autopilotRule.status === "active") {
      // Don't auto-reply to commands or inside the dedicated ARGUS command group
      if (!isCommandChat) {
        // If it's a GLOBAL busy mode rule and this is an unmentioned group chat, skip passive group chatter
        const isSpecificRule = autopilotRule.jid !== "GLOBAL";
        const isMentioned = text.toLowerCase().includes("@") || text.toLowerCase().includes(config.ownerName?.toLowerCase() || "yusuf");

        if (isSpecificRule || !isGroup || isMentioned) {
          console.log(`🤖 [Auto-Pilot] Triggered for [${chatName || chatJid}] from ${senderName || senderJid} (${autopilotRule.name})`);

          try {
            // 1. Fetch user's real past sent messages to learn genuine typing style
            const mySentSamples = (getDb()
              .prepare(
                "SELECT message_text FROM message_log WHERE is_from_me = 1 AND LENGTH(message_text) BETWEEN 4 AND 80 ORDER BY id DESC LIMIT 5"
              )
              .all() as Array<{ message_text: string }>).map((r) => r.message_text);

            // 2. Format current time string (e.g. "Saturday 4:20 PM")
            const now = new Date();
            const currentTimeStr = now.toLocaleDateString("en-US", { weekday: "long" }) + " " + now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

            // 3. Start realistic human typing presence indicator
            await sock.sendPresenceUpdate("composing", chatJid).catch(() => { });
            const startTime = Date.now();

            // 4. Fetch last 8 messages from this conversation for multi-turn continuity
            const recentHistory = getDb()
              .prepare(
                "SELECT message_text as text, is_from_me, timestamp FROM message_log WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT 8"
              )
              .all(chatJid) as any[];
            recentHistory.reverse();

            // 4. Check if the message contains a meeting / call / plan proposal
            try {
              const proposalRes = await callBrain(config, "/autopilot/detect-proposal", {
                incoming_message: text,
                sender_name: senderName || autopilotRule.name || "Friend",
                chat_name: chatName || undefined,
                is_group: isGroup,
                reference_timestamp: new Date().toISOString(),
              });

              if (proposalRes && proposalRes.is_proposal && proposalRes.confidence >= 0.6) {
                console.log(`🤝 [Meeting Proposal Detected] from ${senderName || chatJid}: "${proposalRes.title}"`);

                // 1. Send natural buffer reply to contact
                const bufferReply = proposalRes.buffer_reply || "give me a sec, checking my schedule and will text u back 👍";
                await sendText(sock, chatJid, bufferReply, config);
                incrementAutopilotCount(autopilotRule.jid);

                // 2. Add to pending proposals DB
                addPendingProposal(
                  senderJid,
                  chatJid,
                  senderName || autopilotRule.name || "Friend",
                  chatName || null,
                  proposalRes.title || "Meeting",
                  proposalRes.date || null,
                  proposalRes.time || null,
                  proposalRes.location || null,
                  text
                );

                // 3. Send interactive Approval Card to dedicated ARGUS group
                const whenStr = (proposalRes.date || proposalRes.time)
                  ? `\n📅 *When:* ${proposalRes.date || "TBD"}${proposalRes.time ? ` at ${proposalRes.time}` : ""}`
                  : "";
                const whereStr = proposalRes.location ? `\n📍 *Where:* ${proposalRes.location}` : "";
                const fromStr = isGroup ? `*${senderName}* in *${chatName}*` : `*${senderName || autopilotRule.name}*`;

                const approvalCard = [
                  `🤝 *Meeting / Plan Proposal from ${fromStr}:*`,
                  `────────────────────────────`,
                  `📌 *Topic:* ${proposalRes.title || "Meeting"}${whenStr}${whereStr}`,
                  `💬 *Original Message:* "${text}"`,
                  `────────────────────────────`,
                  `_Auto-replied with buffer:_ "${bufferReply}"`,
                  ``,
                  `*Choose your action:*`,
                  `  ✅ *accept* (or *yes*) — Auto-confirms & adds to Google Calendar`,
                  `  🔄 *suggest [time]* (e.g. *suggest 6pm*) — Proposes alternate time`,
                  `  ❌ *decline [reason]* — Politely declines`,
                ].join("\n");

                const dedicatedJid = getDedicatedGroupJid(config);
                await sendText(sock, dedicatedJid, approvalCard, config);
                return;
              }
            } catch (proposalErr) {
              logger.warn({ proposalErr }, "Proposal detection check skipped");
            }

            // 5. Generate personalized response acting as the owner (immediate execution)
            const personaRes = await callBrain(config, "/autopilot/generate-reply", {
              chat_jid: chatJid,
              chat_name: chatName || undefined,
              is_group: isGroup,
              sender_name: senderName || autopilotRule.name || "Friend",
              incoming_message: text,
              recent_chat_history: recentHistory,
              custom_instruction: autopilotRule.custom_prompt,
              current_time_str: currentTimeStr,
              user_style_samples: mySentSamples,
            });

            // Ensure natural human delay (minimum 1.5s typing feel if LLM answered super fast)
            const elapsed = Date.now() - startTime;
            const targetDelay = Math.min(3500, Math.max(1500, text.length * 30));
            if (elapsed < targetDelay) {
              await new Promise((r) => setTimeout(r, targetDelay - elapsed));
            }

            if (personaRes && personaRes.reply_text) {
              // 6. Send response directly to the chat/group
              await sendText(sock, chatJid, personaRes.reply_text, config);
              incrementAutopilotCount(autopilotRule.jid);

              // 7. Mirror transparent confirmation card back to dedicated ARGUS command group
              const targetLabel = isGroup ? `Group *${chatName || chatJid}*` : `*${senderName || autopilotRule.name}*`;
              const mirrorMsg = [
                `🤖 *[Auto-Pilot Active]* Replied in ${targetLabel} as you:`,
                `📩 *Incoming:* "${text}"`,
                `💬 *Reply Sent:* "${personaRes.reply_text}"`,
              ].join("\n");
              const dedicatedJid = getDedicatedGroupJid(config);
              await sendText(sock, dedicatedJid, mirrorMsg, config);

              console.log(`🚀 [Auto-Pilot] Sent reply in ${chatName || chatJid}: "${personaRes.reply_text}"`);
              return;
            }
          } catch (autoErr) {
            logger.error({ autoErr, chatJid }, "Error in Auto-Pilot persona response");
          } finally {
            await sock.sendPresenceUpdate("paused", chatJid).catch(() => { });
          }
        }
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

        // Send confirmation prompt to your dedicated ARGUS group
        const dedicatedJid = getDedicatedGroupJid(config);
        await sendEventConfirmation(
          sock,
          dedicatedJid,
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
  const dedicatedJid = getDedicatedGroupJid(config);
  const pending = getLatestPendingEvent(dedicatedJid) || getLatestPendingEvent(config.myJid);

  if (!pending) {
    await sendText(sock, dedicatedJid, "No pending event to confirm.", config);
    return;
  }

  switch (action) {
    case "yes": {
      confirmEvent(pending.id);
      await sendEventAdded(
        sock,
        dedicatedJid,
        pending.title || "Event",
        pending.event_date || "TBD",
        pending.event_time,
        config
      );
      break;
    }

    case "ignore": {
      ignoreEvent(pending.id);
      await sendText(sock, dedicatedJid, "❌ Event ignored.", config);
      break;
    }

    case "edit": {
      await sendText(
        sock,
        dedicatedJid,
        `✏️ *Edit event:*\n\nTitle: ${pending.title}\nDate: ${pending.event_date}\nTime: ${pending.event_time}\n\n_Reply "yes" to add as-is, or "ignore" to skip._`,
        config
      );
      break;
    }
  }
}
