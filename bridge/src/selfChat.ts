import type { WASocket } from "@whiskeysockets/baileys";
import pino from "pino";
import { Config } from "./config.js";
import {
  addTodo,
  getTodos,
  completeTodo,
  deleteTodo,
  getRecentMessages,
  addReminder,
  addPendingEvent,
  findChatByNameOrQuery,
  getTodayReminders,
  getTodayConfirmedEvents,
  getRecentActiveChats,
  exemptChat,
  unexemptChat,
  getExemptedChats,
  addPendingOutbox,
  getLatestPendingOutbox,
  markOutboxSent,
  cancelPendingOutbox,
  updatePendingOutboxText,
  saveChatDirectory,
  getDb,
  getUpcomingConfirmedEvents,
  deleteConfirmedEvent,
  confirmEvent,
  enableAutopilot,
  disableAutopilot,
  disableAllAutopilot,
  listAutopilotRules,
} from "./db.js";
import {
  sendText,
  sendTodoList,
  sendReminderSet,
  sendError,
  sendEventConfirmation,
  sendEventAdded,
  sendEmailList,
  sendEmailSummary,
  sendCatchupSummary,
  sendMemoryResponse,
  sendSearchResults,
} from "./replySender.js";
import { generateGoogleCalendarUrl } from "./calendarHelper.js";
import { callBrain } from "./brainClient.js";

const logger = pino({ name: "argus:selfchat" });

// In-memory cache for recent email listing so user can say "summarize email 1"
let cachedEmails: Array<{ id: string; subject: string; sender: string; date: string; snippet: string; body?: string }> = [];

/**
 * Handles messages sent to self-chat (your own JID).
 * This is the command mode where you talk directly to ARGUS.
 */
interface ConversationSession {
  action:
    | "awaiting_message_text"      // user said "text Harshith" → waiting for the message body
    | "awaiting_draft_details";    // user said "frame a message" → waiting for recipient/purpose/tone
  targetJid?: string;
  targetName?: string;
  draftText?: string;
  expiresAt: number;
}

let activeSession: ConversationSession | null = null;

// In-memory store for the last AI-generated draft (covers Q&A-generated drafts too)
let lastGeneratedDraft: {
  text: string;
  targetName?: string;
  targetJid?: string;
  createdAt: number;
} | null = null;

export async function handleSelfChatMessage(
  sock: WASocket,
  text: string,
  chatJid: string,
  config: Config
): Promise<void> {
  const normalized = text.trim().toLowerCase();

  // ─── Multi-Turn Context Session Continuity ───────────────────
  if (activeSession && Date.now() < activeSession.expiresAt) {

    // --- State: Waiting for the message body (user already picked a target) ---
    if (activeSession.action === "awaiting_message_text" && activeSession.targetJid && activeSession.targetName) {
      if (["cancel", "abort", "no", "stop", "n"].includes(normalized)) {
        activeSession = null;
        await sendText(sock, chatJid, "❌ *Cancelled.*", config);
        return;
      }

      let content = text
        .replace(/^(send|text|dm|msg|message)\s+/i, "")
        .replace(/^["']|["']$/g, "")
        .trim();

      content = content.replace(new RegExp(`\\s+to\\s+${activeSession.targetName}$`, "i"), "").trim();

      if (content) {
        const targetJid = activeSession.targetJid;
        const targetName = activeSession.targetName;
        activeSession = null;

        let finalDraft = content;
        if (content.length > 25 || /\b(about|explain|explaining|ask|asking|inform|informing|apologize|regarding|meeting|cubbon|park)\b/i.test(content)) {
          try {
            const askRes = await callBrain(config, "/ask", {
              question: `Draft a concise, natural, polite WhatsApp message to "${targetName}" regarding: "${content}". Write ONLY the drafted message text itself with no disclaimers, quotes, or placeholders.`,
            });
            if (askRes && askRes.answer) {
              finalDraft = askRes.answer.replace(/^["']|["']$/g, "").trim();
            }
          } catch {
            finalDraft = content;
          }
        }

        addPendingOutbox(targetJid, targetName, finalDraft);
        lastGeneratedDraft = { text: finalDraft, targetName, targetJid, createdAt: Date.now() };
        await sendText(
          sock,
          chatJid,
          [
            `📝 *Draft for ${targetName}:*`,
            `────────────────────────────`,
            `"${finalDraft}"`,
            `────────────────────────────`,
            `Reply:`,
            `  ✅ *yes* or *send it* — Send now`,
            `  ✏️ *edit [new text]* — Modify draft`,
            `  ❌ *cancel* — Discard`,
          ].join("\n"),
          config
        );
        return;
      }
    }

    // --- State: Waiting for recipient + purpose + tone ("frame a message" flow) ---
    if (activeSession.action === "awaiting_draft_details") {
      if (["cancel", "abort", "no", "stop", "n"].includes(normalized)) {
        activeSession = null;
        await sendText(sock, chatJid, "❌ *Cancelled.*", config);
        return;
      }

      // Parse the multi-line or single-line details.
      // User might say: "harshith\npurpose is to meet tmr at cubbon park\ntone is Humour"
      // Or: "harshith about meeting at cubbon park tomorrow, humorous tone"
      const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

      let recipientStr = "";
      let purposeStr = "";
      let toneStr = "";

      if (lines.length >= 2) {
        // Multi-line format
        recipientStr = lines[0].replace(/^(recipient|to|contact|name)[:\s]*/i, "").trim();
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (/^(purpose|about|regarding|message|topic)[:\s]+/i.test(line)) {
            purposeStr = line.replace(/^(purpose|about|regarding|message|topic)[:\s]+/i, "").trim();
          } else if (/^(tone|style|vibe)[:\s]+/i.test(line)) {
            toneStr = line.replace(/^(tone|style|vibe)[:\s]+/i, "").trim();
          } else if (!purposeStr) {
            purposeStr = line;
          } else if (!toneStr) {
            toneStr = line;
          }
        }
      } else {
        // Single-line: try to parse "harshith about meeting at cubbon park"
        const singleLine = text.trim();
        const aboutMatch = singleLine.match(/^(.+?)\s+(about|regarding|for|that)\s+(.+)$/i);
        if (aboutMatch) {
          recipientStr = aboutMatch[1].trim();
          purposeStr = aboutMatch[3].trim();
        } else {
          recipientStr = singleLine;
        }
      }

      if (!recipientStr) {
        await sendText(sock, chatJid, "Who should I send this to? Give me a name or group.", config);
        return;
      }

      const foundRecipient = findChatByNameOrQuery(recipientStr);
      if (!foundRecipient) {
        await sendText(
          sock,
          chatJid,
          `🔍 Could not find *${recipientStr}* in your contacts.\n\nTry a different name or type *cancel* to abort.`,
          config
        );
        return;
      }

      // If we don't have a purpose yet, ask for it
      if (!purposeStr) {
        activeSession = {
          action: "awaiting_message_text",
          targetJid: foundRecipient.jid,
          targetName: foundRecipient.name,
          expiresAt: Date.now() + 300000,
        };
        await sendText(
          sock,
          chatJid,
          `📝 What message would you like to send to *${foundRecipient.name}*?\n_(Just type the message or describe what it should be about)_`,
          config
        );
        return;
      }

      // We have recipient + purpose → generate the draft
      activeSession = null;
      const draftPrompt = toneStr
        ? `Draft a concise, natural WhatsApp message to "${foundRecipient.name}" regarding: "${purposeStr}". Use a ${toneStr} tone. Write ONLY the message text itself with no disclaimers, quotes, labels, or placeholders.`
        : `Draft a concise, natural, polite WhatsApp message to "${foundRecipient.name}" regarding: "${purposeStr}". Write ONLY the message text itself with no disclaimers, quotes, labels, or placeholders.`;

      let finalDraft = purposeStr;
      try {
        const askRes = await callBrain(config, "/ask", { question: draftPrompt });
        if (askRes && askRes.answer) {
          finalDraft = askRes.answer.replace(/^["']|["']$/g, "").trim();
        }
      } catch {
        // fallback
      }

      addPendingOutbox(foundRecipient.jid, foundRecipient.name, finalDraft);
      lastGeneratedDraft = { text: finalDraft, targetName: foundRecipient.name, targetJid: foundRecipient.jid, createdAt: Date.now() };
      await sendText(
        sock,
        chatJid,
        [
          `📝 *Draft for ${foundRecipient.name}:*`,
          `────────────────────────────`,
          `"${finalDraft}"`,
          `────────────────────────────`,
          `Reply:`,
          `  ✅ *yes* or *send it* — Send now`,
          `  ✏️ *edit [new text]* — Modify draft`,
          `  ❌ *cancel* — Discard`,
        ].join("\n"),
        config
      );
      return;
    }
  }

  // ─── "send it" / "send it to [contact]" — Dispatch Pending Outbox ───
  const sendItToMatch = normalized.match(
    /^(?:send|forward|dispatch)\s+(?:it|this|that|the\s+message|the\s+draft)\s+(?:to\s+)?(.+)$/i
  );
  if (sendItToMatch) {
    const pendingOutbox = getLatestPendingOutbox();
    const draftToUse = pendingOutbox
      ? pendingOutbox.message_text
      : lastGeneratedDraft && Date.now() - lastGeneratedDraft.createdAt < 300000
        ? lastGeneratedDraft.text
        : null;

    if (draftToUse) {
      const recipientName = sendItToMatch[1].trim();
      const found = findChatByNameOrQuery(recipientName);
      if (found) {
        await sock.sendMessage(found.jid, { text: draftToUse });
        if (pendingOutbox) markOutboxSent(pendingOutbox.id);
        lastGeneratedDraft = null;
        await sendText(sock, chatJid, `✅ *Message sent to ${found.name}!*`, config);
        return;
      } else {
        await sendText(
          sock,
          chatJid,
          `🔍 Could not find *${recipientName}* in your contacts.`,
          config
        );
        return;
      }
    }
    // no draft available — fall through
  }

  // ─── Check Pending Outbox Confirmation ("yes" / "send" / "send it" / "confirm") ───
  if (
    ["yes", "send", "send it", "send now", "confirm", "y", "✅", "do it", "shoot", "ok send it", "please send", "yes send it", "go ahead"].includes(normalized) ||
    /^(yes|send\s*it|send\s*now|do\s+it|please\s+send)\s*$/i.test(normalized)
  ) {
    const pendingOutbox = getLatestPendingOutbox();
    if (pendingOutbox) {
      await sock.sendMessage(pendingOutbox.target_jid, { text: pendingOutbox.message_text });
      markOutboxSent(pendingOutbox.id);
      lastGeneratedDraft = null;
      await sendText(
        sock,
        chatJid,
        `✅ *Message sent to ${pendingOutbox.target_name}!*`,
        config
      );
      return;
    }
  }

  if (normalized.startsWith("edit ") || normalized.startsWith("change ")) {
    const pendingOutbox = getLatestPendingOutbox();
    if (pendingOutbox) {
      const newText = text.replace(/^(edit|change)\s+/i, "").trim();
      if (newText) {
        updatePendingOutboxText(pendingOutbox.id, newText);
        await sendText(
          sock,
          chatJid,
          [
            `✏️ *Updated Draft for ${pendingOutbox.target_name}:*`,
            `────────────────────────────`,
            `"${newText}"`,
            `────────────────────────────`,
            `Reply:`,
            `  ✅ *yes* — Send now`,
            `  ✏️ *edit [new text]* — Modify`,
            `  ❌ *cancel* — Discard`,
          ].join("\n"),
          config
        );
        return;
      }
    }
  }

  if (["cancel", "no", "abort", "n", "❌", "skip"].includes(normalized)) {
    const pendingOutbox = getLatestPendingOutbox();
    if (pendingOutbox) {
      cancelPendingOutbox(pendingOutbox.id);
      lastGeneratedDraft = null;
      await sendText(
        sock,
        chatJid,
        `❌ *Cancelled draft to ${pendingOutbox.target_name}.*`,
        config
      );
      return;
    }
  }

  // ─── Help Command ───────────────────────────────────────────
  if (normalized === "help" || normalized === "/help") {
    await sendHelpMessage(sock, chatJid, config);
    return;
  }

  // ─── Contacts & Address Book Commands ───────────────────────
  if (
    ["contacts", "contact list", "contacts list", "list contacts", "show contacts", "directory", "chats", "my contacts", "my chats"].includes(normalized) ||
    /\b(contacts?|directory)\s*(list)?$/i.test(normalized)
  ) {
    await handleListContacts(sock, chatJid, config);
    return;
  }

  if (normalized.startsWith("save contact ") || normalized.startsWith("add contact ")) {
    const raw = text.replace(/^(save|add)\s+contact\s+/i, "").trim();
    await handleSaveContact(sock, chatJid, raw, config);
    return;
  }

  // ─── Todo Commands ──────────────────────────────────────────
  if (["todos", "show todos", "my todos", "list", "todo"].includes(normalized)) {
    const todos = getTodos(chatJid);
    await sendTodoList(sock, chatJid, todos, config);
    return;
  }

  if (normalized.startsWith("done #") || normalized.startsWith("complete #")) {
    const idStr = normalized.replace(/^(done|complete)\s*#/, "").trim();
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      await sendError(sock, chatJid, "Invalid todo ID. Example: done #1", config);
      return;
    }
    const success = completeTodo(id);
    if (success) {
      await sendText(sock, chatJid, `✅ Todo #${id} marked completed!`, config);
    } else {
      await sendError(sock, chatJid, `Todo #${id} not found or already completed.`, config);
    }
    return;
  }

  if (normalized.startsWith("delete #") || normalized.startsWith("remove #")) {
    const idStr = normalized.replace(/^(delete|remove)\s*#/, "").trim();
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      await sendError(sock, chatJid, "Invalid todo ID. Example: delete #1", config);
      return;
    }
    const success = deleteTodo(id);
    if (success) {
      await sendText(sock, chatJid, `🗑️ Todo #${id} deleted.`, config);
    } else {
      await sendError(sock, chatJid, `Todo #${id} not found.`, config);
    }
    return;
  }

  // ─── Daily Briefing Command ─────────────────────────────────
  if (
    /^(briefing|daily briefing|morning briefing|agenda|today'?s agenda|today agenda)$/i.test(normalized) ||
    /\b(daily briefing|morning briefing|today'?s agenda|show agenda|my agenda)\b/i.test(normalized)
  ) {
    await handleDailyBriefing(sock, chatJid, config);
    return;
  }

  // ─── Calendar & Events Commands ─────────────────────────────
  if (["events", "calendar", "my events", "my calendar", "upcoming events", "schedule list"].includes(normalized)) {
    await handleListEvents(sock, chatJid, config);
    return;
  }

  if (
    /^(schedule|add|create|book|new)\s+(an?\s+)?(event|meeting|call|session|appointment)s?\b/i.test(normalized) ||
    normalized.startsWith("schedule ") ||
    normalized.startsWith("add event ") ||
    normalized.startsWith("add a event ") ||
    normalized.startsWith("add an event ") ||
    normalized.startsWith("create event ") ||
    normalized.startsWith("create an event ")
  ) {
    const raw = text.replace(/^(schedule|add|create|book|new)\s+(an?\s+)?(event|meeting|call|session|appointment)s?\s*(for|on|at|:)?\s*/i, "").trim();
    await handleScheduleEvent(sock, chatJid, raw.length > 0 ? raw : text, config);
    return;
  }

  if (normalized.startsWith("delete event #") || normalized.startsWith("cancel event #") || normalized.startsWith("remove event #")) {
    const idStr = normalized.replace(/^(delete|cancel|remove)\s+event\s*#/, "").trim();
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      await sendError(sock, chatJid, "Invalid event ID. Example: cancel event #1", config);
      return;
    }
    const success = deleteConfirmedEvent(id);
    if (success) {
      await sendText(sock, chatJid, `🗑️ Event #${id} removed from calendar.`, config);
    } else {
      await sendError(sock, chatJid, `Event #${id} not found.`, config);
    }
    return;
  }

  // ─── Auto-Pilot Persona Commands ────────────────────────────
  if (normalized === "autopilot" || normalized === "autopilot status" || normalized === "autopilot list") {
    await handleAutopilotStatus(sock, chatJid, config);
    return;
  }

  if (normalized.startsWith("autopilot on") || normalized.startsWith("enable autopilot")) {
    const raw = text.replace(/^(autopilot\s+on|enable\s+autopilot)\s*:?\s*/i, "").trim();
    await handleEnableAutopilot(sock, chatJid, raw, config);
    return;
  }

  if (normalized.startsWith("autopilot off") || normalized.startsWith("disable autopilot") || normalized === "stop autopilot") {
    const raw = text.replace(/^(autopilot\s+off|disable\s+autopilot|stop\s+autopilot)\s*/i, "").trim();
    await handleDisableAutopilot(sock, chatJid, raw, config);
    return;
  }

  // ─── Email Commands ─────────────────────────────────────────
  if (/\b(email|emails|mail|mails|inbox|unread)\b/i.test(normalized)) {
    // Specific email breakdown: "summarize email 1" or "read email #2"
    if (
      /\b(summarize|breakdown)\s+email/i.test(normalized) ||
      /\b(read|open)\s+email\s*#?\d+/i.test(normalized)
    ) {
      const query = normalized.replace(/.*?\b(summarize|breakdown|read|open)\s+email\s*#?/i, "").trim();
      await handleSummarizeEmail(sock, chatJid, query, config);
      return;
    }
    // Search inbox: "search email invoice"
    if (/\b(search|find)\s+email/i.test(normalized)) {
      const query = text.replace(/.*?\b(search|find)\s+email\s*/i, "").trim();
      await handleSearchEmails(sock, chatJid, query, config);
      return;
    }
    // General inbox listing: "read my emails", "read emails", "check emails", "emails", "inbox"
    await handleFetchUnreadEmails(sock, chatJid, config);
    return;
  }

  // ─── Catch-up / Group Summarization ─────────────────────────
  if (/\b(summ[ae]ri[zs]e|summary|catchup|catch\s*up|recap|what happened in|what did they say in)\b/i.test(normalized)) {
    const target = text.replace(
      /.*?\b(summ[ae]ri[zs]e|summary|catchup|catch\s*up|recap|what happened in|what did they say in)\s*(the|a|my)?\s*(group\s*chat|group|chat|conversation|messages)?\s*(on|with|for|in|about)?\s*/i,
      ""
    ).trim();
    await handleChatCatchup(sock, chatJid, target, config);
    return;
  }

  // ─── Memory Commands ("Second Brain") ───────────────────────
  if (
    normalized.startsWith("remember ") ||
    normalized.startsWith("note that ") ||
    normalized.startsWith("save note ") ||
    normalized.startsWith("save memory ")
  ) {
    const fact = text.replace(/^(remember|note\s+that|save\s+note|save\s+memory)\s*/i, "").trim();
    await handleSaveMemory(sock, chatJid, fact, config);
    return;
  }

  if (
    ["memories", "show memories", "list memories", "my memories", "brain", "my brain", "second brain", "knowledge base"].includes(normalized)
  ) {
    await handleListMemories(sock, chatJid, config);
    return;
  }

  if (normalized.startsWith("forget ") || normalized.startsWith("delete memory ") || normalized.startsWith("delete note ")) {
    const raw = text.replace(/^(forget|delete\s+memory|delete\s+note)\s*/i, "").trim();
    await handleForgetMemory(sock, chatJid, raw, config);
    return;
  }

  if (
    normalized.startsWith("recall ") ||
    normalized.startsWith("what is my ") ||
    normalized.startsWith("what are my ") ||
    normalized.startsWith("who is ") ||
    normalized.startsWith("where is my ") ||
    normalized.startsWith("where did i put ") ||
    normalized.startsWith("do i have ") ||
    normalized.startsWith("tell me about my ")
  ) {
    await handleRecallMemory(sock, chatJid, text, config);
    return;
  }

  // ─── Chat Exemption Commands ─────────────────────────────────
  if (normalized.startsWith("exempt ") || normalized.startsWith("ignore chat ") || normalized.startsWith("mute chat ")) {
    const target = text.replace(/^(exempt|ignore\s*chat|mute\s*chat)\s*/i, "").trim();
    await handleExemptChat(sock, chatJid, target, config);
    return;
  }

  if (normalized.startsWith("unexempt ") || normalized.startsWith("unignore chat ") || normalized.startsWith("unmute chat ")) {
    const target = text.replace(/^(unexempt|unignore\s*chat|unmute\s*chat)\s*/i, "").trim();
    await handleUnexemptChat(sock, chatJid, target, config);
    return;
  }

  if (["exempted", "exempted chats", "list exempted", "ignored chats", "list ignored"].includes(normalized)) {
    await handleListExemptedChats(sock, chatJid, config);
    return;
  }

  // ─── Outbound Message Commands ("frame a message to...", "can u send message to...", "tell [group] [msg]") ───
  if (
    !/^tell\s+(me|us|a\s+|about\s+|why\s+|how\s+|what\s+|where\s+|who\s+|when\s+)/i.test(normalized) &&
    /^(can\s+u|can\s+you|please|could\s+you|i\s+wanna|i\s+want\s+to|i\s+need\s+to)?\s*(frame|compose|write|create|prepare|draft|send|tell|message|text|dm)\s+/i.test(normalized)
  ) {
    const handled = await handleOutgoingMessageCommand(sock, text, chatJid, config);
    if (handled) return;
  }

  // ─── AI Intent Classification & Execution ───────────────────
  try {
    const result = await callBrain(config, "/process-message", {
      sender_jid: chatJid,
      message_text: text,
      chat_jid: chatJid,
      timestamp: new Date().toISOString(),
      is_self_chat: true,
    });

    if (!result || !result.intent) {
      await sendText(sock, chatJid, "🤔 I didn't catch that. Type *help* for available commands.", config);
      return;
    }

    switch (result.intent) {
      case "reminder": {
        const reminderResult = await callBrain(config, "/parse-reminder", {
          message_text: text,
          reference_timestamp: new Date().toISOString(),
        });

        if (reminderResult && reminderResult.due_at) {
          addReminder(chatJid, reminderResult.reminder_text, reminderResult.due_at);
          await sendReminderSet(
            sock,
            chatJid,
            reminderResult.reminder_text,
            reminderResult.due_at,
            config
          );
        } else {
          await sendError(
            sock,
            chatJid,
            "Could not determine when to remind you. Try: 'remind me to call mom at 5pm'",
            config
          );
        }
        break;
      }

      case "todo": {
        const data = result.extract_data;
        if (data && data.text) {
          const todo = addTodo(chatJid, data.text);
          await sendText(sock, chatJid, `📝 Added: *${todo.text}* (Todo #${todo.id})`, config);
        } else {
          const cleanText = text.replace(/^(add|todo|task)\s+(to\s+my\s+list\s+)?/i, "").trim();
          if (cleanText) {
            const todo = addTodo(chatJid, cleanText);
            await sendText(sock, chatJid, `📝 Added: *${todo.text}* (Todo #${todo.id})`, config);
          } else {
            await sendError(sock, chatJid, "What would you like to add to your todo list?", config);
          }
        }
        break;
      }

      case "event": {
        await handleScheduleEvent(sock, chatJid, text, config);
        break;
      }

      case "email_list":
        await handleFetchUnreadEmails(sock, chatJid, config);
        break;

      case "email_summary":
        await handleSummarizeEmail(sock, chatJid, result.extract_data?.query || "1", config);
        break;

      case "email_search":
        await handleSearchEmails(sock, chatJid, result.extract_data?.query || "", config);
        break;

      case "catchup":
        await handleChatCatchup(sock, chatJid, result.extract_data?.target || "", config);
        break;

      case "briefing":
        await handleDailyBriefing(sock, chatJid, config);
        break;

      case "memory_save":
        await handleSaveMemory(sock, chatJid, result.extract_data?.fact || text, config);
        break;

      case "memory_recall":
        await handleRecallMemory(sock, chatJid, result.extract_data?.query || text, config);
        break;

      case "search":
        await handleWebSearch(sock, chatJid, result.extract_data?.query || text, config);
        break;

      case "question":
      default: {
        const askResult = await callBrain(config, "/ask", { question: text, use_web_search: false });
        if (askResult && askResult.answer) {
          await sendText(sock, chatJid, askResult.answer, config);
        } else {
          await sendError(sock, chatJid, "Could not generate an answer right now.", config);
        }
        break;
      }
    }
  } catch (err: any) {
    logger.error({ err, text }, "Error handling self-chat message");
    await sendError(sock, chatJid, "Something went wrong while processing your request.", config);
  }
}

// ─── Sub-Handlers ──────────────────────────────────────────────

async function handleFetchUnreadEmails(sock: WASocket, chatJid: string, config: Config) {
  try {
    const res = await callBrain(config, "/emails/unread", {});
    if (!res.is_configured) {
      await sendText(
        sock,
        chatJid,
        [
          `📬 *Email Setup Needed:*`,
          ``,
          `To enable ARGUS to read your emails:`,
          `1. Open *backend/.env* file`,
          `2. Set your email & Google App Password:`,
          `   EMAIL_USER=your_email@gmail.com`,
          `   EMAIL_PASS=your_16_char_app_password`,
          ``,
          `_Get your App Password at: myaccount.google.com/apppasswords_`,
        ].join("\n"),
        config
      );
      return;
    }
    cachedEmails = res.emails || [];
    await sendEmailList(sock, chatJid, cachedEmails, config);
  } catch (err: any) {
    await sendError(sock, chatJid, "Could not fetch emails. Check your email credentials.", config);
  }
}

async function handleSummarizeEmail(sock: WASocket, chatJid: string, query: string, config: Config) {
  const indexMatch = query.match(/^#?(\d+)$/);
  if (indexMatch && cachedEmails.length > 0) {
    const idx = parseInt(indexMatch[1], 10) - 1;
    if (idx >= 0 && idx < cachedEmails.length) {
      const email = cachedEmails[idx];
      try {
        const res = await callBrain(config, "/emails/summarize", {
          email_id: email.id,
          subject: email.subject,
          sender: email.sender,
          date: email.date,
          body: email.body || email.snippet,
        });
        await sendEmailSummary(sock, chatJid, email.subject, res.summary, config);
        return;
      } catch (err) {
        await sendError(sock, chatJid, "Failed to summarize selected email.", config);
        return;
      }
    }
  }

  try {
    const res = await callBrain(config, "/emails/summarize", { email_id: query, subject: query });
    await sendEmailSummary(sock, chatJid, res.subject, res.summary, config);
  } catch (err) {
    await sendError(sock, chatJid, "Could not find or summarize that email.", config);
  }
}

async function handleSearchEmails(sock: WASocket, chatJid: string, query: string, config: Config) {
  if (!query) {
    await sendError(sock, chatJid, "Please provide a search term. Example: search email flight", config);
    return;
  }
  try {
    const res = await callBrain(config, "/emails/search", { query, limit: 5 });
    if (!res.is_configured) {
      await sendText(sock, chatJid, "Email integration is not configured in backend/.env.", config);
      return;
    }
    cachedEmails = res.emails || [];
    await sendEmailList(sock, chatJid, cachedEmails, config, `🔍 *Email Search Results for "${query}":*`);
  } catch (err) {
    await sendError(sock, chatJid, `Failed to search emails for "${query}".`, config);
  }
}

export async function handleDailyBriefing(sock: WASocket, chatJid: string, config: Config) {
  try {
    const todos = getTodos(chatJid);
    const reminders = getTodayReminders(chatJid);
    const events = getTodayConfirmedEvents();

    const res = await callBrain(config, "/briefing", {
      todos,
      reminders,
      events,
      include_emails: true,
    });

    if (res && res.briefing_text) {
      await sendText(sock, chatJid, res.briefing_text, config);
    }
  } catch (err) {
    logger.error({ err }, "Briefing error");
    await sendError(sock, chatJid, "Could not compile daily briefing.", config);
  }
}

async function handleChatCatchup(sock: WASocket, chatJid: string, target: string, config: Config) {
  let targetJid = "";
  let targetName = "";

  const activeChats = getRecentActiveChats(5);

  if (target && target.trim().length > 0) {
    const found = findChatByNameOrQuery(target);
    if (found) {
      targetJid = found.jid;
      targetName = found.name;
    } else {
      await sendText(
        sock,
        chatJid,
        `🔍 Could not find any group or contact matching "*${target}*".\n\n_Tip: Type "catchup noclue" or "catchup College"._`,
        config
      );
      return;
    }
  } else {
    // If no specific match, pick the most active non-ARGUS chat
    const nonArgusActive = activeChats.filter(
      (c) => !c.name.toLowerCase().includes("argus")
    );
    if (nonArgusActive.length > 0) {
      targetJid = nonArgusActive[0].jid;
      targetName = nonArgusActive[0].name;
    }
  }

  if (!targetJid) {
    await sendText(
      sock,
      chatJid,
      "💬 No chat messages logged yet! Once messages arrive in your WhatsApp groups or chats, type *catchup [group name]* to summarize them.",
      config
    );
    return;
  }

  const messages = getRecentMessages(targetJid, 50);
  if (messages.length === 0) {
    await sendText(
      sock,
      chatJid,
      `💬 Found group *${targetName}*, but no messages have arrived in it since ARGUS connected.\n\n_Once someone sends a message in *${targetName}*, ARGUS will be able to summarize it!_`,
      config
    );
    return;
  }

  try {
    const payload = {
      messages: messages.map((m) => ({
        sender_name: m.sender_name || (m.is_from_me ? "Me" : "Contact"),
        sender_jid: m.sender_jid,
        message_text: m.message_text,
        timestamp: m.timestamp,
      })),
      instruction: `Provide an executive catch-up summary of what was discussed in ${targetName}. Highlight key decisions, questions, links, and action items.`,
    };

    const res = await callBrain(config, "/summarize", payload);

    let summaryText = res.summary;
    if (activeChats.length > 1) {
      const otherNames = activeChats
        .filter((c) => c.jid !== targetJid)
        .map((c) => `• _${c.name}_`)
        .slice(0, 3)
        .join("\n");
      if (otherNames) {
        summaryText += `\n\n_Other active chats you can catch up on:_\n${otherNames}\n_Use: catchup [name]_`;
      }
    }

    await sendCatchupSummary(sock, chatJid, targetName, summaryText, config);
  } catch (err) {
    await sendError(sock, chatJid, `Could not summarize chat ${targetName}.`, config);
  }
}

async function handleSaveMemory(sock: WASocket, chatJid: string, fact: string, config: Config) {
  if (!fact) {
    await sendError(sock, chatJid, "What fact would you like me to remember? Example: *remember my SRN is PES1UG25CS001*", config);
    return;
  }
  try {
    const res = await callBrain(config, "/memory/save", { fact });
    const tags = Array.isArray(res.entities) && res.entities.length > 0 ? res.entities.map((t: string) => `#${t}`).join(" ") : `#${res.category}`;
    await sendText(
      sock,
      chatJid,
      [
        `🧠 *Saved to Second Brain:*`,
        `────────────────────────────`,
        `"${res.fact}"`,
        `📁 *Category:* #${res.category}`,
        `🏷️ *Tags:* ${tags}`,
      ].join("\n"),
      config
    );
  } catch (err) {
    await sendError(sock, chatJid, "Failed to save to memory.", config);
  }
}

async function handleRecallMemory(sock: WASocket, chatJid: string, query: string, config: Config) {
  try {
    const res = await callBrain(config, "/memory/recall", { query, limit: 8 });
    if (res.answer) {
      await sendMemoryResponse(sock, chatJid, res.answer, config);
    } else if (res.memories && res.memories.length > 0) {
      const items = res.memories.map((m: any) => `• ${m.fact_text}`).join("\n");
      await sendMemoryResponse(sock, chatJid, items, config);
    } else {
      await sendMemoryResponse(sock, chatJid, `I don't have any saved facts matching "${query}".`, config);
    }
  } catch (err) {
    await sendError(sock, chatJid, "Failed to query memory.", config);
  }
}

async function handleListMemories(sock: WASocket, chatJid: string, config: Config) {
  try {
    const res = await callBrain(config, "/memory/list", {});
    if (!res.categories || res.total_count === 0) {
      await sendText(
        sock,
        chatJid,
        "🧠 *Your Second Brain is currently empty.*\n\n_To store facts, simply type:_ *remember [fact]* (e.g. *remember my SRN is PES1UG25CS001*)",
        config
      );
      return;
    }

    const catEmojis: Record<string, string> = {
      academics: "🎓",
      credentials: "🔐",
      people: "👥",
      personal: "👤",
      projects: "💻",
      general: "📌",
    };

    const sections: string[] = [];
    for (const [cat, items] of Object.entries(res.categories as Record<string, any[]>)) {
      if (!items || items.length === 0) continue;
      const emoji = catEmojis[cat.toLowerCase()] || "📌";
      const lines = items.map((m) => `  • (#${m.id}) ${m.fact_text}`);
      sections.push(`${emoji} *${cat.toUpperCase()}:*\n${lines.join("\n")}`);
    }

    await sendText(
      sock,
      chatJid,
      [
        `🧠 *ARGUS Second Brain Knowledge Base (${res.total_count} facts):*`,
        `────────────────────────────`,
        sections.join("\n\n"),
        `────────────────────────────`,
        `_Ask: "what is my [topic]?" | Delete: "forget #[id]"_`,
      ].join("\n"),
      config
    );
  } catch (err) {
    await sendError(sock, chatJid, "Could not retrieve memories.", config);
  }
}

async function handleForgetMemory(sock: WASocket, chatJid: string, raw: string, config: Config) {
  const idMatch = raw.match(/^#?(\d+)$/);
  const payload: any = {};
  if (idMatch) {
    payload.id = parseInt(idMatch[1], 10);
  } else {
    payload.query = raw;
  }

  try {
    const res = await callBrain(config, "/memory/delete", payload);
    if (res.deleted_count > 0) {
      await sendText(sock, chatJid, `🗑️ *${res.message}*`, config);
    } else {
      await sendError(sock, chatJid, `No memory matching "${raw}" found.`, config);
    }
  } catch (err) {
    await sendError(sock, chatJid, "Failed to delete memory.", config);
  }
}

async function handleWebSearch(sock: WASocket, chatJid: string, query: string, config: Config) {
  if (!query) {
    await sendError(sock, chatJid, "What would you like to search? Example: search latest SpaceX launch", config);
    return;
  }
  try {
    const res = await callBrain(config, "/ask", { question: query, use_web_search: true });
    if (res && res.answer) {
      await sendText(sock, chatJid, `🌐 *Web Answer:*\n\n${res.answer}`, config);
    }
  } catch (err) {
    await sendError(sock, chatJid, `Web search failed for "${query}".`, config);
  }
}

async function handleExemptChat(sock: WASocket, chatJid: string, target: string, config: Config) {
  if (!target) {
    await sendError(sock, chatJid, "Which chat or group would you like to exempt? Example: exempt College Group", config);
    return;
  }

  const found = findChatByNameOrQuery(target);
  if (found) {
    exemptChat(found.jid, found.name);
    await sendText(sock, chatJid, `🚫 *Exempted:* Chat *${found.name}* is now ignored. ARGUS will not read or log its messages.`, config);
  } else {
    // Save as general target query
    exemptChat(target, target);
    await sendText(sock, chatJid, `🚫 *Exempted:* *${target}* is now added to the ignore list.`, config);
  }
}

async function handleUnexemptChat(sock: WASocket, chatJid: string, target: string, config: Config) {
  if (!target) {
    await sendError(sock, chatJid, "Which chat would you like to unexempt? Example: unexempt College Group", config);
    return;
  }

  const removed = unexemptChat(target);
  if (removed) {
    await sendText(sock, chatJid, `✅ *Unexempted:* *${target}* is no longer ignored.`, config);
  } else {
    await sendError(sock, chatJid, `Could not find "*${target}*" in your exempted chats list.`, config);
  }
}

async function handleListExemptedChats(sock: WASocket, chatJid: string, config: Config) {
  const list = getExemptedChats();
  if (list.length === 0) {
    await sendText(sock, chatJid, "📋 You have no exempted chats. ARGUS is listening to all non-command chats.", config);
    return;
  }

  const lines = list.map((c, i) => `${i + 1}. 🚫 *${c.name}*`);
  await sendText(
    sock,
    chatJid,
    `🚫 *Exempted Chats (Ignored):*\n\n${lines.join("\n")}\n\n_To remove from ignore list: type "unexempt [name]"_`,
    config
  );
}

async function handleOutgoingMessageCommand(
  sock: WASocket,
  text: string,
  chatJid: string,
  config: Config
): Promise<boolean> {
  const normalized = text.trim().toLowerCase();

  // Block "send it/this/that to X" — these are handled by the sendItToMatch interceptor above
  if (/^(?:send|forward|dispatch)\s+(?:it|this|that|the\s+message|the\s+draft)\s+/i.test(normalized)) {
    return false; // let the interceptor handle it
  }

  let target = "";
  let rawContent = "";

  // 1. Pattern: "send [message] to [target]" (e.g. `send "hello" to Harshith`)
  const sendMsgToTargetMatch = text.match(/^(?:can\s+u\s+|please\s+)?(?:send|text|dm|msg|message)\s+(?:["']([^"']+)["']|(.+?))\s+to\s+([a-zA-Z0-9_\-\.\s]+)$/i);
  if (sendMsgToTargetMatch) {
    rawContent = (sendMsgToTargetMatch[1] || sendMsgToTargetMatch[2]).trim();
    target = sendMsgToTargetMatch[3].trim();
  } else {
    // 2. Strip leading polite prefixes
    const cleanCmd = text.replace(
      /^(can\s+u|can\s+you|please|could\s+you|i\s+wanna|i\s+want\s+to|i\s+need\s+to)?\s*(frame|compose|write|create|prepare|draft|send|tell|message|text|dm)\s+(a\s+)?(message\s+to\s+|msg\s+to\s+|text\s+to\s+|to\s+|message\s+|msg\s+|text\s+|)/i,
      ""
    ).trim();

    // If cleanCmd is empty or just a filler word → enter multi-turn draft session
    if (!cleanCmd || /^(message|msg|text|it|a|the)$/i.test(cleanCmd)) {
      activeSession = {
        action: "awaiting_draft_details",
        expiresAt: Date.now() + 300000,
      };
      await sendText(
        sock,
        chatJid,
        `📝 *Draft Mode*\n\nWho's the recipient, what's the purpose, and what tone?\n\n_Example:_\nHarshith\npurpose is to meet tmr at cubbon park\ntone is humour\n\n_Or type *cancel* to abort._`,
        config
      );
      return true;
    }

    // If user only typed contact name e.g. "I wanna text Harshith" or "text Harshith"
    const singleContact = findChatByNameOrQuery(cleanCmd);
    if (singleContact && !cleanCmd.includes(":") && cleanCmd.split(" ").length <= 2) {
      activeSession = {
        action: "awaiting_message_text",
        targetJid: singleContact.jid,
        targetName: singleContact.name,
        expiresAt: Date.now() + 300000,
      };
      await sendText(
        sock,
        chatJid,
        `📝 What message would you like to send to *${singleContact.name}*?\n_(Just text your message here directly)_`,
        config
      );
      return true;
    }

    // If there's a colon or hyphen e.g. "Harshith: let's meet at 7"
    const colonOrDashMatch = cleanCmd.match(/^([a-zA-Z0-9_\.\s]{1,30}?)\s*[:\-–—]\s*(.+)$/);
    if (colonOrDashMatch) {
      target = colonOrDashMatch[1].trim();
      rawContent = colonOrDashMatch[2].trim();
    } else {
      // Look for split words: "regarding", "about", "that", etc.
      const splitMatch = cleanCmd.match(/^([a-zA-Z0-9_\-\.\s]{1,35}?)\s+(regarding|about|that|saying|asking|to|explaining|for)\s+(.*)$/i);
      if (splitMatch) {
        target = splitMatch[1].trim();
        rawContent = splitMatch[3].trim();
      } else {
        const words = cleanCmd.split(" ");
        target = words[0];
        rawContent = words.slice(1).join(" ");
      }
    }
  }

  if (!target && !rawContent) {
    return false;
  }

  // If user only gave a target contact (e.g. "Harshith" with no content)
  if (target && !rawContent) {
    const foundTarget = findChatByNameOrQuery(target);
    if (foundTarget) {
      activeSession = {
        action: "awaiting_message_text",
        targetJid: foundTarget.jid,
        targetName: foundTarget.name,
        expiresAt: Date.now() + 300000,
      };
      await sendText(
        sock,
        chatJid,
        `📝 What message would you like to send to *${foundTarget.name}*?\n_(Just text your message here directly)_`,
        config
      );
      return true;
    }
    return false;
  }

  const found = findChatByNameOrQuery(target);
  if (!found) {
    await sendText(
      sock,
      chatJid,
      `🔍 Could not find *${target}* in your WhatsApp contacts directory.\n\n_To add them, type:_ \`save contact ${target} [phone number]\`\n_Example:_ \`save contact ${target} 919876543210\``,
      config
    );
    return true;
  }

  let finalDraft = rawContent;

  // Always AI-draft for explicit framing commands, or if the content is descriptive
  if (rawContent.length > 25 || /\b(about|explain|explaining|ask|asking|inform|informing|apologize|apologizing|tell them|moving|rescheduling|meeting|regarding|cubbon|park)\b/i.test(rawContent)) {
    try {
      const askRes = await callBrain(config, "/ask", {
        question: `Draft a concise, natural, polite WhatsApp message to "${found.name}" regarding: "${rawContent}". Write ONLY the drafted message text itself with no disclaimers, quotes, or placeholders.`,
      });
      if (askRes && askRes.answer) {
        finalDraft = askRes.answer.replace(/^["']|["']$/g, "").trim();
      }
    } catch {
      finalDraft = rawContent;
    }
  }

  addPendingOutbox(found.jid, found.name, finalDraft);
  lastGeneratedDraft = { text: finalDraft, targetName: found.name, targetJid: found.jid, createdAt: Date.now() };

  await sendText(
    sock,
    chatJid,
    [
      `📝 *Draft for ${found.name}:*`,
      `────────────────────────────`,
      `"${finalDraft}"`,
      `────────────────────────────`,
      `Reply:`,
      `  ✅ *yes* or *send it* — Send to ${found.name}`,
      `  ✏️ *edit [new text]* — Modify draft`,
      `  ❌ *cancel* — Discard`,
    ].join("\n"),
    config
  );
  return true;
}

async function handleListContacts(sock: WASocket, chatJid: string, config: Config): Promise<void> {
  const rows = getDb()
    .prepare("SELECT jid, name, is_group FROM chat_directory ORDER BY is_group ASC, name ASC LIMIT 40")
    .all() as Array<{ jid: string; name: string; is_group: number }>;

  const contacts = rows.filter((r) => r.is_group === 0);
  const groups = rows.filter((r) => r.is_group === 1);

  const sections: string[] = [];

  if (contacts.length > 0) {
    const lines = contacts.map((c) => `👤 *${c.name}*`);
    sections.push(`👤 *Saved Contacts:*\n${lines.join("\n")}`);
  } else {
    sections.push(`👤 *Saved Contacts:*\n_None yet. To save a contact: type "save contact Harshith +919876543210"_`);
  }

  if (groups.length > 0) {
    const lines = groups.slice(0, 10).map((g) => `👥 *${g.name}*`);
    sections.push(`👥 *WhatsApp Groups (${groups.length} synced):*\n${lines.join("\n")}\n_...and ${Math.max(0, groups.length - 10)} more_`);
  }

  await sendText(sock, chatJid, `📱 *Your WhatsApp Directory:*\n\n${sections.join("\n\n")}`, config);
}

async function handleSaveContact(sock: WASocket, chatJid: string, raw: string, config: Config): Promise<void> {
  const clean = raw.trim();
  const match = clean.match(/^([a-zA-Z\s]+)\s+([\+\d\s\-]{8,20})$/);

  if (!match) {
    await sendError(
      sock,
      chatJid,
      "Format: *save contact [Name] [Phone]*\nExample: *save contact Harshith 919876543210*",
      config
    );
    return;
  }

  const name = match[1].trim();
  const digits = match[2].replace(/[^0-9]/g, "");
  const formattedJid =
    (digits.startsWith("91") && digits.length === 12
      ? digits
      : digits.length === 10
      ? `91${digits}`
      : digits) + "@s.whatsapp.net";

  saveChatDirectory(formattedJid, name, false);

  await sendText(
    sock,
    chatJid,
    `✅ *Contact Saved!*\n👤 *Name:* ${name}\n📱 *Recipient:* ${formattedJid}\n\n_You can now say:_ *tell ${name} [message]*`,
    config
  );
}

async function handleListEvents(sock: WASocket, chatJid: string, config: Config): Promise<void> {
  const events = getUpcomingConfirmedEvents(15);
  if (events.length === 0) {
    await sendText(
      sock,
      chatJid,
      "📅 *No upcoming calendar events scheduled.*\n\n_To add one:_ *schedule [event] on [date] at [time]*\n_Example:_ *schedule Project Review tomorrow at 4pm*",
      config
    );
    return;
  }

  const lines = events.map((e) => {
    const timeStr = e.event_time ? ` at ${e.event_time}` : " (all day)";
    const gcalUrl = generateGoogleCalendarUrl(e.title || "Event", e.event_date || "", e.event_time);
    return [
      `📌 *#${e.id}* — *${e.title || "Event"}*`,
      `📅 ${e.event_date || "TBD"}${timeStr}`,
      `🔗 ${gcalUrl}`,
    ].join("\n");
  });

  await sendText(
    sock,
    chatJid,
    [
      `📅 *Your Upcoming Calendar Events (${events.length}):*`,
      `────────────────────────────`,
      lines.join("\n\n"),
      `────────────────────────────`,
      `_Tap any link above to add directly to Google Calendar!_`,
    ].join("\n"),
    config
  );
}

async function handleScheduleEvent(sock: WASocket, chatJid: string, raw: string, config: Config): Promise<void> {
  try {
    const extractRes = await callBrain(config, "/extract-event", {
      notification_text: raw,
      received_at: new Date().toISOString(),
      source_app: "whatsapp",
    });

    if (extractRes && extractRes.is_event) {
      const eventList: Array<{ title: string; date: string; time: string | null }> = [];
      if (Array.isArray(extractRes.events) && extractRes.events.length > 0) {
        for (const ev of extractRes.events) {
          if (ev.title && ev.date) {
            eventList.push({ title: ev.title, date: ev.date, time: ev.time || null });
          }
        }
      }
      if (eventList.length === 0 && extractRes.date) {
        eventList.push({
          title: extractRes.title || raw,
          date: extractRes.date,
          time: extractRes.time || null,
        });
      }

      if (eventList.length === 1) {
        const ev = eventList[0];
        const added = addPendingEvent(
          chatJid,
          chatJid,
          raw,
          ev.title,
          ev.date,
          ev.time,
          extractRes.confidence || 0.95
        );
        confirmEvent(added.id);
        await sendEventAdded(sock, chatJid, ev.title, ev.date, ev.time, config);
        return;
      }

      if (eventList.length > 1) {
        const cards: string[] = [];
        for (const ev of eventList) {
          const added = addPendingEvent(
            chatJid,
            chatJid,
            raw,
            ev.title,
            ev.date,
            ev.time,
            extractRes.confidence || 0.95
          );
          confirmEvent(added.id);
          const timeStr = ev.time ? ` at ${ev.time}` : " (all day)";
          const gcalUrl = generateGoogleCalendarUrl(ev.title, ev.date, ev.time);
          cards.push(`📌 *${ev.title}*\n📅 ${ev.date}${timeStr}\n🔗 ${gcalUrl}`);
        }

        await sendText(
          sock,
          chatJid,
          [
            `📅 *${eventList.length} Events Scheduled & Added to Calendar!*`,
            `────────────────────────────`,
            cards.join("\n\n"),
            `────────────────────────────`,
            `_Tap any link above to add directly to Google Calendar!_`,
          ].join("\n"),
          config
        );
        return;
      }
    }

    await sendError(
      sock,
      chatJid,
      "Could not parse event date or time.\nExample: *schedule Meeting with Harshith tomorrow at 4pm*",
      config
    );
  } catch (err) {
    logger.error({ err }, "Failed to schedule event");
    await sendError(sock, chatJid, "Failed to schedule event.", config);
  }
}

async function handleAutopilotStatus(sock: WASocket, chatJid: string, config: Config): Promise<void> {
  const rules = listAutopilotRules();
  if (rules.length === 0) {
    const msg = [
      `🤖 *ARGUS Auto-Pilot Persona is currently OFF.*`,
      ``,
      `*How to enable:*`,
      `• *autopilot on for [Contact]* — Auto-replies as you to that person`,
      `  _Example:_ *autopilot on for Harshith*`,
      `• *autopilot on: [reason]* — Global busy mode for all 1-on-1 DMs`,
      `  _Example:_ *autopilot on: studying for exams, reply casually*`,
    ].join("\n");
    await sendText(sock, chatJid, msg, config);
    return;
  }

  const lines = rules.map((r) => {
    const promptStr = r.custom_prompt ? `\n   📝 _Context:_ "${r.custom_prompt}"` : "";
    return `👤 *${r.name}* (${r.jid})\n   ⚡ _Replies Sent:_ ${r.auto_reply_count}${promptStr}`;
  });

  const msg = [
    `🤖 *Active Auto-Pilot Persona Rules (${rules.length}):*`,
    `────────────────────────────`,
    lines.join("\n\n"),
    `────────────────────────────`,
    `_To disable:_ *autopilot off [Person]* or *autopilot off all*`,
  ].join("\n");

  await sendText(sock, chatJid, msg, config);
}

async function handleEnableAutopilot(sock: WASocket, chatJid: string, raw: string, config: Config): Promise<void> {
  // Check if "for [Contact]" or "for [Contact]: [prompt]"
  const forMatch = raw.match(/^for\s+([^:]+)(?::\s*(.*))?$/i);
  if (forMatch) {
    const targetQuery = forMatch[1].trim();
    const customPrompt = forMatch[2] ? forMatch[2].trim() : undefined;

    let chat = findChatByNameOrQuery(targetQuery);
    if (!chat) {
      const cleanPhone = targetQuery.replace(/[^0-9]/g, "");
      if (cleanPhone.length >= 7) {
        chat = { jid: `${cleanPhone}@s.whatsapp.net`, name: targetQuery };
        saveChatDirectory(chat.jid, chat.name, false);
      } else {
        chat = { jid: targetQuery.toLowerCase(), name: targetQuery };
      }
    }

    enableAutopilot(chat.jid, chat.name, customPrompt);
    const promptStr = customPrompt ? `\n📝 *Custom Context:* "${customPrompt}"` : "";
    await sendText(
      sock,
      chatJid,
      `🤖 *Auto-Pilot ENABLED for ${chat.name}!*\nARGUS will now autonomously reply to incoming DMs from ${chat.name} as you in your personal voice.${promptStr}\n\n_To turn off:_ *autopilot off for ${chat.name}*`,
      config
    );
    return;
  }

  // Global busy mode: "autopilot on: studying for exams"
  const globalPrompt = raw.replace(/^on\s*:?\s*/i, "").trim() || "busy right now";
  enableAutopilot("GLOBAL", "Global Busy Mode", globalPrompt);
  await sendText(
    sock,
    chatJid,
    `🤖 *Global Auto-Pilot Busy Mode ENABLED!*\nARGUS will autonomously answer any incoming 1-on-1 DMs as you in your personal voice.\n📝 *Context:* "${globalPrompt}"\n\n_To turn off:_ *autopilot off*`,
    config
  );
}

async function handleDisableAutopilot(sock: WASocket, chatJid: string, raw: string, config: Config): Promise<void> {
  if (!raw || raw.toLowerCase() === "all" || raw.toLowerCase() === "global") {
    disableAllAutopilot();
    await sendText(sock, chatJid, "🛑 *Auto-Pilot disabled for all contacts.*", config);
    return;
  }

  const targetQuery = raw.replace(/^for\s+/i, "").trim();
  const chat = findChatByNameOrQuery(targetQuery);
  const targetJid = chat ? chat.jid : targetQuery;
  const targetName = chat ? chat.name : targetQuery;

  const success = disableAutopilot(targetJid);
  if (success) {
    await sendText(sock, chatJid, `🛑 *Auto-Pilot disabled for ${targetName}.*`, config);
  } else {
    disableAllAutopilot();
    await sendText(sock, chatJid, `🛑 *Auto-Pilot disabled.*`, config);
  }
}

async function sendHelpMessage(sock: WASocket, jid: string, config: Config): Promise<void> {
  const help = [
    `🤖 *ARGUS Executive Assistant — Capabilities:*`,
    ``,
    `🤖 *Auto-Pilot Digital Clone Persona:*`,
    `• "autopilot on for [Person]" — Auto-replies to their incoming DMs as you`,
    `• "autopilot on: [busy reason]" — Global busy auto-responder`,
    `• "autopilot off" — Stops auto-pilot`,
    `• "autopilot status" — View active auto-pilot rules`,
    ``,
    `📅 *Google Calendar Sync:*`,
    `• "schedule [event] tomorrow at 3pm" — Adds event & gives 1-tap Google Calendar link`,
    `• "events" / "calendar" — View upcoming schedule with Google Calendar links`,
    `• "cancel event #1" — Removes event from calendar`,
    ``,
    `📤 *Send & Draft Messages to Any Chat/Group:*`,
    `• "tell [group / contact] [message]" — Prepares & sends message with confirmation`,
    `• "can u send message to [name] about [topic]" — AI drafts & prepares send`,
    `• "save contact [name] [phone]" — Saves person to your directory`,
    `• "contacts" — View all your synced groups and contacts`,
    ``,
    `🧠 *Second Brain Knowledge Base:*`,
    `• "remember [fact]" — Auto-categorizes & tags personal notes`,
    `• "what is my [item]?" / "who is [person]?" — Direct synthesized answers`,
    `• "memories" — Categorized Second Brain dashboard`,
    `• "forget #[id]" — Delete outdated note`,
    ``,
    `💬 *All-Chats & Group Catch-up:*`,
    `• "summarize group" / "catchup" — Summarizes your most active group`,
    `• "catchup [Group / Person Name]" — 3-tier structured executive summary`,
    ``,
    `📬 *Direct Emails (IMAP):*`,
    `• "read my emails" / "emails" — View unread inbox`,
    `• "summarize email #1" — Deep executive email breakdown`,
    `• "search email invoice" — Search inbox`,
    ``,
    `🌅 *Executive Briefing:*`,
    `• "briefing" / "agenda" — Instant daily overview`,
    ``,
    `🎙️ *Voice Notes:*`,
    `• Send voice notes to this chat for instant Whisper execution!`,
    ``,
    `📝 *Todos & Reminders:*`,
    `• "todos" / "add buy groceries" / "done #1"`,
    `• "remind me to call Mom in 20 minutes"`,
  ].join("\n");

  await sendText(sock, jid, help, config);
}
