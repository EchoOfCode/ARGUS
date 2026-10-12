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
  getLatestPendingProposal,
  markProposalResolved,
  trackSentMessage,
  getPendingFollowups,
  getExpensesSummary,
  getDebtsSummary,
  type TrackedFollowup,
  type ExpenseRecord,
} from "./db.js";
import {
  sendText,
  sendTodoList,
  sendReminderSet,
  sendReminderList,
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
    | "awaiting_message_text"      // user said "text Alex" → waiting for the message body
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
      // User might say: "alex\npurpose is to meet tmr at central park\ntone is Humour"
      // Or: "alex about meeting at central park tomorrow, humorous tone"
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
        // Single-line: try to parse "alex about meeting at central park"
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
        await sendText(sock, found.jid, draftToUse, config);
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
  }

  // ─── Check Pending Meeting Proposal Resolution (accept, decline, suggest [time]) ───
  const pendingProposal = getLatestPendingProposal();
  if (pendingProposal) {
    // 1. Accept Proposal ("accept", "yes", "confirm", "accept meeting")
    if (
      ["accept", "yes", "confirm", "accept meeting", "agree", "y", "✅", "ok", "sure", "sounds good"].includes(normalized) ||
      /^accept(\s+meeting)?$/i.test(normalized)
    ) {
      try {
        const resolveRes = await callBrain(config, "/autopilot/resolve-proposal", {
          action: "accept",
          sender_name: pendingProposal.sender_name,
          chat_name: pendingProposal.chat_name,
          proposed_title: pendingProposal.proposed_title,
          proposed_date: pendingProposal.proposed_date,
          proposed_time: pendingProposal.proposed_time,
          proposed_location: pendingProposal.proposed_location,
        });

        if (resolveRes && resolveRes.reply_text) {
          // Send natural acceptance reply to contact/group
          await sendText(sock, pendingProposal.chat_jid, resolveRes.reply_text, config);
          markProposalResolved(pendingProposal.id, "accepted");

          // Add to calendar
          if (pendingProposal.proposed_date || resolveRes.event_date) {
            const evDate = pendingProposal.proposed_date || resolveRes.event_date || new Date().toISOString().split("T")[0];
            const added = addPendingEvent(
              pendingProposal.chat_jid,
              config.myJid,
              pendingProposal.raw_message,
              pendingProposal.proposed_title,
              evDate,
              pendingProposal.proposed_time || resolveRes.event_time,
              0.99
            );
            confirmEvent(added.id);

            const gcalUrl = generateGoogleCalendarUrl(
              pendingProposal.proposed_title,
              evDate,
              pendingProposal.proposed_time || resolveRes.event_time
            );

            await sendText(
              sock,
              chatJid,
              [
                `✅ *Meeting Confirmed with ${pendingProposal.sender_name}!*`,
                `────────────────────────────`,
                `💬 *Sent:* "${resolveRes.reply_text}"`,
                `📅 *Added to Calendar:* ${pendingProposal.proposed_title} (${evDate}${pendingProposal.proposed_time ? ` at ${pendingProposal.proposed_time}` : ""})`,
                `🔗 ${gcalUrl}`,
                `────────────────────────────`,
                `_Tap link above to sync directly to Google Calendar!_`,
              ].join("\n"),
              config
            );
          } else {
            await sendText(
              sock,
              chatJid,
              `✅ *Meeting Confirmed with ${pendingProposal.sender_name}!*\n💬 *Sent:* "${resolveRes.reply_text}"`,
              config
            );
          }
          return;
        }
      } catch (resErr) {
        logger.error({ resErr }, "Failed to accept meeting proposal");
      }
    }

    // 2. Suggest / Counter Proposal ("suggest 6pm", "reschedule to 5pm", "counter 7pm")
    if (
      normalized.startsWith("suggest ") ||
      normalized.startsWith("counter ") ||
      normalized.startsWith("reschedule ") ||
      normalized.startsWith("can we do ")
    ) {
      const counterTime = text.replace(/^(suggest|counter|reschedule|can\s+we\s+do)\s+(to\s+)?/i, "").trim();
      try {
        const resolveRes = await callBrain(config, "/autopilot/resolve-proposal", {
          action: "counter",
          sender_name: pendingProposal.sender_name,
          chat_name: pendingProposal.chat_name,
          proposed_title: pendingProposal.proposed_title,
          proposed_date: pendingProposal.proposed_date,
          proposed_time: pendingProposal.proposed_time,
          proposed_location: pendingProposal.proposed_location,
          counter_time: counterTime,
        });

        if (resolveRes && resolveRes.reply_text) {
          await sendText(sock, pendingProposal.chat_jid, resolveRes.reply_text, config);
          markProposalResolved(pendingProposal.id, "countered");

          await sendText(
            sock,
            chatJid,
            `🔄 *Counter-offer sent to ${pendingProposal.sender_name}!* (${counterTime})\n💬 *Sent:* "${resolveRes.reply_text}"`,
            config
          );
          return;
        }
      } catch (resErr) {
        logger.error({ resErr }, "Failed to counter meeting proposal");
      }
    }

    // 3. Decline Proposal ("decline", "decline busy with exam", "reject")
    if (
      normalized.startsWith("decline") ||
      normalized.startsWith("reject") ||
      normalized === "no" ||
      normalized === "can't make it"
    ) {
      const userReason = text.replace(/^(decline|reject)\s*/i, "").trim() || undefined;
      try {
        const resolveRes = await callBrain(config, "/autopilot/resolve-proposal", {
          action: "decline",
          sender_name: pendingProposal.sender_name,
          chat_name: pendingProposal.chat_name,
          proposed_title: pendingProposal.proposed_title,
          proposed_date: pendingProposal.proposed_date,
          proposed_time: pendingProposal.proposed_time,
          proposed_location: pendingProposal.proposed_location,
          user_note: userReason,
        });

        if (resolveRes && resolveRes.reply_text) {
          await sendText(sock, pendingProposal.chat_jid, resolveRes.reply_text, config);
          markProposalResolved(pendingProposal.id, "declined");

          await sendText(
            sock,
            chatJid,
            `❌ *Declined meeting with ${pendingProposal.sender_name}.*\n💬 *Sent:* "${resolveRes.reply_text}"`,
            config
          );
          return;
        }
      } catch (resErr) {
        logger.error({ resErr }, "Failed to decline meeting proposal");
      }
    }
  }

  // ─── Check Pending Outbox Confirmation ("yes" / "send" / "send it" / "confirm") ───
  if (
    ["yes", "send", "send it", "send now", "confirm", "y", "✅", "do it", "shoot", "ok send it", "please send", "yes send it", "go ahead"].includes(normalized) ||
    /^(yes|send\s*it|send\s*now|do\s+it|please\s+send)\s*$/i.test(normalized)
  ) {
    const pendingOutbox = getLatestPendingOutbox();
    if (pendingOutbox) {
      await sendText(sock, pendingOutbox.target_jid, pendingOutbox.message_text, config);
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

  // ─── Deterministic Slash Commands Engine (Zero LLM Overhead) ───
  if (text.startsWith("/")) {
    const rawCmd = text.substring(1).trim();
    const parts = rawCmd.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || "";
    const args = parts.slice(1).join(" ").trim();

    switch (cmd) {
      case "help":
      case "start": {
        await sendHelpMessage(sock, chatJid, config);
        return;
      }

      case "todo":
      case "todos":
      case "task":
      case "tasks":
      case "todaytasks":
      case "todaytodos":
      case "mytasks":
      case "mytodos": {
        if (!args || args === "list" || args === "show" || cmd === "todaytasks" || cmd === "todaytodos" || cmd === "mytasks" || cmd === "mytodos") {
          await handleListTodos(sock, chatJid, config);
          return;
        }
        if (args.startsWith("add ")) {
          const item = args.substring(4).trim();
          if (item) {
            const t = addTodo(chatJid, item);
            callBrain(config, "/api/todos", { chat_jid: chatJid, text: item }).catch(() => {});
            await sendText(sock, chatJid, `📝 Added: *${t.text}* (Todo #${t.id})`, config);
            return;
          }
        }
        if (args.startsWith("done ") || args.startsWith("complete ")) {
          const id = parseInt(args.replace(/^(done|complete)\s*#?/, "").trim(), 10);
          if (!isNaN(id)) {
            const success = completeTodo(id);
            if (success) {
              await sendText(sock, chatJid, `✅ Todo #${id} marked completed!`, config);
            } else {
              await sendError(sock, chatJid, `Todo #${id} not found.`, config);
            }
            return;
          }
        }
        if (args.startsWith("delete ") || args.startsWith("remove ")) {
          const id = parseInt(args.replace(/^(delete|remove)\s*#?/, "").trim(), 10);
          if (!isNaN(id)) {
            const success = deleteTodo(id);
            if (success) {
              await sendText(sock, chatJid, `🗑️ Todo #${id} deleted.`, config);
            } else {
              await sendError(sock, chatJid, `Todo #${id} not found.`, config);
            }
            return;
          }
        }
        const t = addTodo(chatJid, args);
        callBrain(config, "/api/todos", { chat_jid: chatJid, text: args }).catch(() => {});
        await sendText(sock, chatJid, `📝 Added: *${t.text}* (Todo #${t.id})`, config);
        return;
      }

      case "reminder":
      case "reminders": {
        if (!args || args === "list" || args === "show") {
          await handleListReminders(sock, chatJid, config);
          return;
        }
        const reminderResult = await callBrain(config, "/parse-reminder", {
          message_text: args,
          reference_timestamp: new Date().toISOString(),
        });
        if (reminderResult && reminderResult.due_at) {
          addReminder(chatJid, reminderResult.reminder_text, reminderResult.due_at);
          await sendReminderSet(sock, chatJid, reminderResult.reminder_text, reminderResult.due_at, config);
        } else {
          await sendError(sock, chatJid, "Could not determine reminder time. Example: /reminder sync with Alex tomorrow at 5pm", config);
        }
        return;
      }

      case "autopilot": {
        if (!args || args === "status") {
          await handleAutopilotStatus(sock, chatJid, config);
          return;
        }
        if (args.startsWith("on")) {
          const target = args.replace(/^on\s*:?\s*/i, "").trim();
          await handleEnableAutopilot(sock, chatJid, target, config);
          return;
        }
        if (args.startsWith("off")) {
          const target = args.replace(/^off\s*:?\s*/i, "").trim();
          await handleDisableAutopilot(sock, chatJid, target, config);
          return;
        }
        await handleAutopilotStatus(sock, chatJid, config);
        return;
      }

      case "killswitch": {
        if (args === "on" || args === "engage") {
          await handleEmergencyKillSwitch(sock, chatJid, true, config);
          return;
        }
        if (args === "off" || args === "disengage") {
          await handleEmergencyKillSwitch(sock, chatJid, false, config);
          return;
        }
        await handleAutopilotStatus(sock, chatJid, config);
        return;
      }

      case "briefing":
      case "agenda": {
        await handleDailyBriefing(sock, chatJid, config);
        return;
      }

      case "expenses":
      case "spending": {
        await handleShowExpenses(sock, chatJid, config);
        return;
      }

      case "debts":
      case "splits": {
        await handleShowDebts(sock, chatJid, config);
        return;
      }

      case "contacts": {
        await handleListContacts(sock, chatJid, config);
        return;
      }

      case "ask": {
        if (args) {
          const askRes = await callBrain(config, "/ask", { question: args, use_web_search: true });
          if (askRes && askRes.answer) {
            await sendText(sock, chatJid, askRes.answer, config);
            return;
          }
        }
        await sendError(sock, chatJid, "Usage: /ask [question]", config);
        return;
      }

      case "offline": {
        const askResult = await callBrain(config, "/ask", { question: "/offline" });
        if (askResult && askResult.answer) {
          await sendText(sock, chatJid, askResult.answer, config);
        }
        return;
      }

      case "online": {
        const askResult = await callBrain(config, "/ask", { question: "/online" });
        if (askResult && askResult.answer) {
          await sendText(sock, chatJid, askResult.answer, config);
        }
        return;
      }

      case "mode": {
        const askResult = await callBrain(config, "/ask", { question: "/mode" });
        if (askResult && askResult.answer) {
          await sendText(sock, chatJid, askResult.answer, config);
        }
        return;
      }

      case "s":
      case "st":
      case "status": {
        const askResult = await callBrain(config, "/ask", { question: "/status" });
        if (askResult && askResult.answer) {
          await sendText(sock, chatJid, askResult.answer, config);
        }
        return;
      }

      default: {
        // Unknown or custom slash command (e.g. /summary, /schedule, /weather, etc.)
        // Pass directly to the ReAct agent with recent history so it reasons intelligently!
        const recentHistory = getRecentMessages(chatJid, 8).map((m) => ({
          text: m.message_text,
          is_from_me: m.is_from_me === 1,
          timestamp: m.timestamp,
        }));
        const askResult = await callBrain(config, "/ask", {
          question: text.startsWith("/") ? text : rawCmd,
          use_web_search: false,
          recent_history: recentHistory,
        });
        if (askResult && askResult.answer) {
          await sendText(sock, chatJid, askResult.answer, config);
        } else {
          await sendText(sock, chatJid, `Unknown command: /${cmd}. Type /help for available commands.`, config);
        }
        return;
      }
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

  // ─── Chat Exemption / Ignore Commands ("exclude [chat]", "exempt [chat]", "unexempt [chat]") ───
  if (
    normalized.startsWith("exclude ") ||
    normalized.startsWith("exempt ") ||
    normalized.startsWith("ignore ") ||
    normalized.startsWith("mute ")
  ) {
    const targetQuery = text.replace(/^(exclude|exempt|ignore|mute)\s+(the\s+)?(group\s+|chat\s+)?/i, "").trim();
    const found = findChatByNameOrQuery(targetQuery);
    if (found) {
      exemptChat(found.jid, found.name);
      await sendText(
        sock,
        chatJid,
        `🚫 *Exempted ${found.name}!* ARGUS will ignore background messages from this chat/group.`,
        config
      );
      return;
    } else {
      exemptChat(targetQuery, targetQuery);
      await sendText(
        sock,
        chatJid,
        `🚫 *Exempted "${targetQuery}"!* ARGUS will ignore background messages from this chat/group.`,
        config
      );
      return;
    }
  }

  if (
    normalized.startsWith("unexclude ") ||
    normalized.startsWith("unexempt ") ||
    normalized.startsWith("unignore ") ||
    normalized.startsWith("unmute ")
  ) {
    const targetQuery = text.replace(/^(unexclude|unexempt|unignore|unmute)\s+(the\s+)?(group\s+|chat\s+)?/i, "").trim();
    const success = unexemptChat(targetQuery);
    if (success) {
      await sendText(
        sock,
        chatJid,
        `✅ *Unexempted "${targetQuery}"!* ARGUS will now listen to this chat.`,
        config
      );
    } else {
      await sendText(
        sock,
        chatJid,
        `🔍 "${targetQuery}" was not in your exempted list.`,
        config
      );
    }
    return;
  }

  if (["exempted", "exemptions", "list exemptions", "ignored chats", "muted chats"].includes(normalized)) {
    const list = getExemptedChats();
    if (list.length === 0) {
      await sendText(sock, chatJid, "📋 *No chats are currently exempted.*", config);
    } else {
      const items = list.map((c) => `• *${c.name}* (${c.jid.split("@")[0]})`).join("\n");
      await sendText(
        sock,
        chatJid,
        `🚫 *Currently Exempted Chats (${list.length}):*\n────────────────────────────\n${items}`,
        config
      );
    }
    return;
  }

  // ─── Nudge / Ghosted Follow-up Tracker ──────────────────────
  if (normalized.startsWith("nudge ") || normalized.startsWith("follow up with ") || normalized.startsWith("followup with ")) {
    const contactQuery = text.replace(/^(nudge|follow\s*up\s+with|followup\s+with)\s+/i, "").trim();
    const found = findChatByNameOrQuery(contactQuery);
    if (found) {
      const nudgeMsg = `Hey ${found.name.split(" ")[0]}, just checking in and following up on this! 👍`;
      await sendText(sock, found.jid, nudgeMsg, config);
      trackSentMessage(found.jid, found.name, nudgeMsg);
      await sendText(sock, chatJid, `⏳ *Nudge Sent to ${found.name}!* ("${nudgeMsg}")`, config);
      return;
    } else {
      await sendText(sock, chatJid, `🔍 Could not find contact *${contactQuery}*.`, config);
      return;
    }
  }

  if (["followups", "pending followups", "follow ups", "ghosted", "who hasn't replied"].includes(normalized)) {
    const list = getPendingFollowups(6); // Messages waiting for > 6 hours
    if (list.length === 0) {
      await sendText(sock, chatJid, "✨ *No pending follow-ups!* All your recent outgoing messages have been answered or are fresh.", config);
    } else {
      const items = list.map((f: TrackedFollowup, i: number) => `${i + 1}. 👤 *${f.contact_name}*\n   💬 _"${f.last_sent_text}"_\n   👉 Type *nudge ${f.contact_name}* to ping them!`).join("\n\n");
      await sendText(sock, chatJid, `⏳ *Pending Follow-ups & Unanswered Messages (${list.length}):*\n────────────────────────────\n${items}`, config);
    }
    return;
  }

  // ─── Financial & Expense Ledger Commands ────────────────────
  if (["expenses", "my expenses", "spending", "expense list", "show expenses"].includes(normalized)) {
    const summary = getExpensesSummary("month");
    if (summary.expenses.length === 0) {
      await sendText(sock, chatJid, "💸 *No expenses recorded this month.* To log one: _'Paid 350 for lunch with Taylor'_", config);
    } else {
      const items = summary.expenses.slice(0, 10).map((e: ExpenseRecord) => `• ₹${e.amount} — *${e.description}* (${e.category})`).join("\n");
      await sendText(
        sock,
        chatJid,
        `💸 *Expenses Breakdown (Last 30 Days):*\n────────────────────────────\n💰 *Total Spent:* ₹${summary.total}\n\n${items}`,
        config
      );
    }
    return;
  }

  if (["debts", "who owes me", "who owes me money", "lent", "borrowed", "splits"].includes(normalized)) {
    const debts = getDebtsSummary();
    const sections: string[] = [];
    if (debts.owedToMe.length > 0) {
      const owedLines = debts.owedToMe.map((d: ExpenseRecord) => `• *${d.person || "Someone"}* owes you *₹${d.amount}* (${d.description})`).join("\n");
      sections.push(`🟢 *Money Owed To You:*\n${owedLines}`);
    }
    if (debts.iOwe.length > 0) {
      const iOweLines = debts.iOwe.map((d: ExpenseRecord) => `• You owe *${d.person || "Someone"}* *₹${d.amount}* (${d.description})`).join("\n");
      sections.push(`🔴 *Money You Owe:*\n${iOweLines}`);
    }
    if (sections.length === 0) {
      await sendText(sock, chatJid, "✨ *All debts settled!* Nobody owes you money, and you have no pending debts.", config);
    } else {
      await sendText(sock, chatJid, `💰 *Financial Debts & Split Ledger:*\n────────────────────────────\n${sections.join("\n\n")}`, config);
    }
    return;
  }

  // ─── Online / Offline Mode Commands ────────────────────────
  if (["offline", "offline mode", "disable online mode", "go offline"].includes(normalized)) {
    const askResult = await callBrain(config, "/ask", { question: "/offline" });
    if (askResult && askResult.answer) {
      await sendText(sock, chatJid, askResult.answer, config);
    }
    return;
  }

  if (["online", "online mode", "enable online mode", "go online"].includes(normalized)) {
    const askResult = await callBrain(config, "/ask", { question: "/online" });
    if (askResult && askResult.answer) {
      await sendText(sock, chatJid, askResult.answer, config);
    }
    return;
  }

  if (["mode", "current mode", "what mode"].includes(normalized)) {
    const askResult = await callBrain(config, "/ask", { question: "/mode" });
    if (askResult && askResult.answer) {
      await sendText(sock, chatJid, askResult.answer, config);
    }
    return;
  }

  // ─── Todo & Reminder Natural Language Commands ─────────────
  if (
    /^(show\s+(me\s+)?(my\s+)?(todo|task)s?(\s+list)?|my\s+(todo|task)s?|list\s+(my\s+)?(todo|task)s?|what\s+are\s+my\s+(todo|task)s?|todos|todo|tasks|task\s+list)$/i.test(
      normalized
    )
  ) {
    await handleListTodos(sock, chatJid, config);
    return;
  }

  if (
    /^(show\s+(me\s+)?(my\s+)?reminders?(\s+list)?|my\s+reminders?|list\s+(my\s+)?reminders?|what\s+are\s+my\s+reminders?|reminders|upcoming\s+reminders)$/i.test(
      normalized
    )
  ) {
    await handleListReminders(sock, chatJid, config);
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
    /^(schedule|shedule|scheldule|sked|add|create|book|new)\s+(an?\s+)?(event|meeting|call|session|appointment)s?\b/i.test(normalized) ||
    /^(schedule|shedule|scheldule)\b/i.test(normalized) ||
    normalized.startsWith("add event ") ||
    normalized.startsWith("add a event ") ||
    normalized.startsWith("add an event ") ||
    normalized.startsWith("create event ") ||
    normalized.startsWith("create an event ")
  ) {
    await handleScheduleEvent(sock, chatJid, text, config);
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

  // ─── Multi-Item Conversational Follow-Ups ("set reminders for all", "schedule all", "do all") ───
  const isMultiItemFollowUp =
    /^(yes\s+)?(set\s+reminders?\s+for\s+all|remind\s+(me\s+)?(for\s+)?all|all\s+of\s+them|do\s+all|set\s+all|schedule\s+all|create\s+all|add\s+all|for\s+all|remind\s+all|set\s+them\s+all|do\s+them\s+all|schedule\s+them\s+all)\b/i.test(
      normalized.trim()
    );

  if (isMultiItemFollowUp) {
    const recentHistory = getRecentMessages(chatJid, 10).map((m) => ({
      text: m.message_text,
      is_from_me: m.is_from_me === 1,
      timestamp: m.timestamp,
    }));
    const askResult = await callBrain(config, "/ask", {
      question: text,
      use_web_search: false,
      recent_history: recentHistory,
    });
    if (askResult && askResult.answer) {
      await sendText(sock, chatJid, askResult.answer, config);
    }
    return;
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
        const isFollowup = /^(set\s+reminders?\s+for\s+all|remind\s+(me\s+)?for\s+all|all\s+of\s+them|do\s+all|set\s+all|for\s+all)\b/i.test(text.trim());
        if (isFollowup) {
          const recentHistory = getRecentMessages(chatJid, 8).map((m) => ({
            text: m.message_text,
            is_from_me: m.is_from_me === 1,
            timestamp: m.timestamp,
          }));
          const askResult = await callBrain(config, "/ask", {
            question: text,
            use_web_search: false,
            recent_history: recentHistory,
          });
          if (askResult && askResult.answer) {
            await sendText(sock, chatJid, askResult.answer, config);
          }
          break;
        }

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

        // 1. List / show tasks
        if (
          data?.action === "list" ||
          /\b(show|list|what\s+are|my\s+(todo|task)s?|view|today'?s?\s*(task|todo)s?)\b/i.test(text)
        ) {
          await handleListTodos(sock, chatJid, config);
          break;
        }

        // 2. Complete, delete, or modify tasks
        if (/\b(delete|remove|clear|scratch|drop|done|complete|finish|check\s*off|undo|cancel)\b/i.test(text)) {
          const recentHistory = getRecentMessages(chatJid, 8).map((m) => ({
            text: m.message_text,
            is_from_me: m.is_from_me === 1,
            timestamp: m.timestamp,
          }));
          const askResult = await callBrain(config, "/ask", {
            question: text,
            use_web_search: false,
            recent_history: recentHistory,
          });
          if (askResult && askResult.answer) {
            await sendText(sock, chatJid, askResult.answer, config);
          } else {
            await sendError(sock, chatJid, "Could not update todo item.", config);
          }
          break;
        }

        // 3. Explicit addition
        if (data && data.action === "add" && data.text) {
          const todo = addTodo(chatJid, data.text);
          callBrain(config, "/api/todos", { chat_jid: chatJid, text: data.text }).catch(() => {});
          await sendText(sock, chatJid, `📝 Added: *${todo.text}* (Todo #${todo.id})`, config);
        } else if (/^(add|create|new)\s+(to\s+my\s+)?(todo|task)\b/i.test(text)) {
          const cleanText = text.replace(/^(add|create|new)\s+(to\s+my\s+)?(todo|task)\s*(list)?:?\s*/i, "").trim();
          if (cleanText) {
            const todo = addTodo(chatJid, cleanText);
            callBrain(config, "/api/todos", { chat_jid: chatJid, text: cleanText }).catch(() => {});
            await sendText(sock, chatJid, `📝 Added: *${todo.text}* (Todo #${todo.id})`, config);
          } else {
            await sendError(sock, chatJid, "What would you like to add to your todo list?", config);
          }
        } else {
          // Conversational or ambiguous input — pass to ReAct agent with history
          const recentHistory = getRecentMessages(chatJid, 8).map((m) => ({
            text: m.message_text,
            is_from_me: m.is_from_me === 1,
            timestamp: m.timestamp,
          }));
          const askResult = await callBrain(config, "/ask", {
            question: text,
            use_web_search: false,
            recent_history: recentHistory,
          });
          if (askResult && askResult.answer) {
            await sendText(sock, chatJid, askResult.answer, config);
          } else {
            await sendError(sock, chatJid, "Could not process that task request.", config);
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

      case "memory_save": {
        // Only save memory if explicitly intended, otherwise route to agent with context
        const isExplicitMemory = /^(remember|note\s+that|save\s+note|save\s+memory|save\s+fact)\b/i.test(text);
        if (isExplicitMemory) {
          await handleSaveMemory(sock, chatJid, result.extract_data?.fact || text, config);
        } else {
          // Conversational continuation or question
          const recentHistory = getRecentMessages(chatJid, 8).map((m) => ({
            text: m.message_text,
            is_from_me: m.is_from_me === 1,
            timestamp: m.timestamp,
          }));
          const askResult = await callBrain(config, "/ask", {
            question: text,
            use_web_search: false,
            recent_history: recentHistory,
          });
          if (askResult && askResult.answer) {
            await sendText(sock, chatJid, askResult.answer, config);
          }
        }
        break;
      }

      case "memory_recall":
        await handleRecallMemory(sock, chatJid, result.extract_data?.query || text, config);
        break;

      case "search":
        await handleWebSearch(sock, chatJid, result.extract_data?.query || text, config);
        break;

      case "question":
      default: {
        const recentHistory = getRecentMessages(chatJid, 8).map((m) => ({
          text: m.message_text,
          is_from_me: m.is_from_me === 1,
          timestamp: m.timestamp,
        }));
        const askResult = await callBrain(config, "/ask", {
          question: text,
          use_web_search: false,
          recent_history: recentHistory,
        });
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
        `🔍 Could not find any group or contact matching "*${target}*".\n\n_Tip: Type "catchup Project Team" or "catchup Study Group"._`,
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
    await sendError(sock, chatJid, "What fact would you like me to remember? Example: *remember my student ID is ABC123XYZ*", config);
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
        "🧠 *Your Second Brain is currently empty.*\n\n_To store facts, simply type:_ *remember [fact]* (e.g. *remember my student ID is ABC123XYZ*)",
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

  // 1. Pattern: "send [message] to [target]" (e.g. `send "hello" to Alex`)
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
        `📝 *Draft Mode*\n\nWho's the recipient, what's the purpose, and what tone?\n\n_Example:_\nAlex\npurpose is to meet tmr at central park\ntone is humour\n\n_Or type *cancel* to abort._`,
        config
      );
      return true;
    }

    // If user only typed contact name e.g. "I wanna text Alex" or "text Alex"
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

    // If there's a colon or hyphen e.g. "Alex: let's meet at 7"
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

  // If user only gave a target contact (e.g. "Alex" with no content)
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
    sections.push(`👤 *Saved Contacts:*\n_None yet. To save a contact: type "save contact Alex +15550100"_`);
  }

  if (groups.length > 0) {
    const lines = groups.slice(0, 10).map((g) => `👥 *${g.name}*`);
    sections.push(`👥 *WhatsApp Groups (${groups.length} synced):*\n${lines.join("\n")}\n_...and ${Math.max(0, groups.length - 10)} more_`);
  }

  await sendText(sock, chatJid, `📱 *Your WhatsApp Directory:*\n\n${sections.join("\n\n")}`, config);
}

async function handleListTodos(sock: WASocket, chatJid: string, config: Config): Promise<void> {
  let todos: any[] = [];
  try {
    const res = await callBrain(config, `/api/todos?chat_jid=${encodeURIComponent(chatJid)}`, {}, "GET");
    if (res && Array.isArray(res.todos)) {
      todos = res.todos;
    } else {
      todos = getTodos(chatJid);
    }
  } catch {
    todos = getTodos(chatJid);
  }
  await sendTodoList(sock, chatJid, todos, config);
}

async function handleListReminders(sock: WASocket, chatJid: string, config: Config): Promise<void> {
  let reminders: any[] = [];
  try {
    const res = await callBrain(config, "/api/reminders/pending", {}, "GET");
    if (res && Array.isArray(res.reminders)) {
      reminders = res.reminders;
    } else {
      reminders = getTodayReminders(chatJid);
    }
  } catch {
    reminders = getTodayReminders(chatJid);
  }
  await sendReminderList(sock, chatJid, reminders, config);
}

async function handleShowExpenses(sock: WASocket, chatJid: string, config: Config): Promise<void> {
  const summary = getExpensesSummary("month");
  if (summary.expenses.length === 0) {
    await sendText(sock, chatJid, "💸 *No expenses recorded this month.* To log one: _'Paid 350 for lunch with Taylor'_", config);
  } else {
    const items = summary.expenses.slice(0, 10).map((e: ExpenseRecord) => `• ₹${e.amount} — *${e.description}* (${e.category})`).join("\n");
    await sendText(
      sock,
      chatJid,
      `💸 *Expenses Breakdown (Last 30 Days):*\n────────────────────────────\n💰 *Total Spent:* ₹${summary.total}\n\n${items}`,
      config
    );
  }
}

async function handleShowDebts(sock: WASocket, chatJid: string, config: Config): Promise<void> {
  const debts = getDebtsSummary();
  const sections: string[] = [];
  if (debts.owedToMe.length > 0) {
    const owedLines = debts.owedToMe.map((d: ExpenseRecord) => `• *${d.person || "Someone"}* owes you *₹${d.amount}* (${d.description})`).join("\n");
    sections.push(`🟢 *Money Owed To You:*\n${owedLines}`);
  }
  if (debts.iOwe.length > 0) {
    const iOweLines = debts.iOwe.map((d: ExpenseRecord) => `• You owe *${d.person || "Someone"}* *₹${d.amount}* (${d.description})`).join("\n");
    sections.push(`🔴 *Money You Owe:*\n${iOweLines}`);
  }
  if (sections.length === 0) {
    await sendText(sock, chatJid, "✨ *All debts settled!* Nobody owes you money, and you have no pending debts.", config);
  } else {
    await sendText(sock, chatJid, `💰 *Financial Debts & Split Ledger:*\n────────────────────────────\n${sections.join("\n\n")}`, config);
  }
}

async function handleEmergencyKillSwitch(sock: WASocket, chatJid: string, engage: boolean, config: Config): Promise<void> {
  try {
    await callBrain(config, "/api/killswitch", { active: engage });
    if (engage) {
      await sendText(
        sock,
        chatJid,
        "🛑 *GLOBAL EMERGENCY KILL SWITCH ENGAGED!*\nAll autonomous auto-replies are suspended system-wide across all contacts.\n\n_To restore:_ Type */killswitch off*",
        config
      );
    } else {
      await sendText(
        sock,
        chatJid,
        "🟢 *GLOBAL EMERGENCY KILL SWITCH DISENGAGED!*\nAutonomy rules have been restored across your configured contacts.",
        config
      );
    }
  } catch (err: any) {
    await sendError(sock, chatJid, `Could not toggle kill switch: ${err?.message}`, config);
  }
}

async function handleSaveContact(sock: WASocket, chatJid: string, raw: string, config: Config): Promise<void> {
  const clean = raw.trim();
  const match = clean.match(/^([a-zA-Z\s]+)\s+([\+\d\s\-]{8,20})$/);

  if (!match) {
    await sendError(
      sock,
      chatJid,
      "Format: *save contact [Name] [Phone]*\nExample: *save contact Alex 919876543210*",
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
      "Could not parse event date or time.\nExample: *schedule Meeting with Alex tomorrow at 4pm*",
      config
    );
  } catch (err) {
    logger.error({ err }, "Failed to schedule event");
    await sendError(sock, chatJid, "Failed to schedule event.", config);
  }
}

async function handleAutopilotStatus(sock: WASocket, chatJid: string, config: Config): Promise<void> {
  // Query live rules and killswitch status from Brain central database (ADR 0001)
  let rules: any[] = [];
  let killSwitchActive = false;
  try {
    const res = await callBrain(config, "/api/autopilot/rules", {}, "GET");
    if (res) {
      rules = res.rules || [];
      killSwitchActive = Boolean(res.kill_switch_active);
    }
  } catch (err) {
    logger.warn({ err }, "Could not fetch autopilot rules from brain, falling back to local state");
    rules = listAutopilotRules();
  }

  if (killSwitchActive) {
    await sendText(
      sock,
      chatJid,
      "🛑 *GLOBAL EMERGENCY KILL SWITCH IS ENGAGED!*\nAll auto-replies are currently suspended system-wide across all contacts.\n\n_To disengage:_ Toggle the kill switch in your ARGUS Web Dashboard.",
      config
    );
    return;
  }

  // Filter to contacts with actual active autonomy (Tier 1 or Tier 2)
  const activeRules = rules.filter((r: any) => r.tier && r.tier > 0);

  if (activeRules.length === 0) {
    const msg = [
      `🤖 *ARGUS Auto-Pilot Persona is currently OFF.*`,
      ``,
      `All contacts are currently running in default safe mode (*Tier 0: Draft Only*).`,
      `Zero messages are being sent autonomously.`,
      ``,
      `*How to enable:*`,
      `• */autopilot on [Contact]* — Auto-replies as you to that person`,
      `  _Example:_ */autopilot on Alex*`,
      `• */autopilot on: [reason]* — Global busy mode for all 1-on-1 DMs`,
      `  _Example:_ */autopilot on: studying for exams, reply casually*`,
      ``,
      `_Tip:_ You can also configure contacts anytime in the Web Dashboard at http://100.92.175.117:3000/contacts`,
    ].join("\n");
    await sendText(sock, chatJid, msg, config);
    return;
  }

  const lines = activeRules.map((r: any) => {
    const tierName = r.tier === 2 ? "Tier 2: Autonomous ⚡" : "Tier 1: Supervised 🛡️";
    const promptStr = r.custom_prompt ? `\n   📝 _Context:_ "${r.custom_prompt}"` : "";
    const cleanPhone = r.jid.replace("@s.whatsapp.net", "");
    return `👤 *${r.name}* (+${cleanPhone})\n   🎯 _${tierName}_\n   ⚡ _Replies Sent:_ ${r.auto_reply_count || 0}${promptStr}`;
  });

  const msg = [
    `🤖 *Active Auto-Pilot Contacts (${rules.length}):*`,
    `────────────────────────────`,
    lines.join("\n\n"),
    `────────────────────────────`,
    `_To manage tiers:_ Configure contacts at http://100.92.175.117:3000/contacts`,
  ].join("\n");

  await sendText(sock, chatJid, msg, config);
}

async function handleEnableAutopilot(sock: WASocket, chatJid: string, raw: string, config: Config): Promise<void> {
  const clean = raw.trim();

  // 1. Global Busy Mode: "/autopilot on", "/autopilot on: [prompt]", "/autopilot on global", "/autopilot on all"
  if (
    !clean ||
    clean.toLowerCase() === "on" ||
    clean.toLowerCase() === "global" ||
    clean.toLowerCase() === "all" ||
    clean.startsWith(":")
  ) {
    const globalPrompt = clean.startsWith(":") ? clean.substring(1).trim() : "Autonomously assist and reply naturally as me";
    enableAutopilot("GLOBAL", "Global Busy Mode", globalPrompt, config);
    await sendText(
      sock,
      chatJid,
      [
        `🤖 *Global Auto-Pilot Busy Mode ENABLED!*`,
        `────────────────────────────`,
        `ARGUS will now autonomously reply to all incoming 1-on-1 DMs as you in your personal voice.`,
        globalPrompt ? `📝 *Context:* "${globalPrompt}"` : "",
        `────────────────────────────`,
        `_To turn off:_ */autopilot off*`,
      ].filter(Boolean).join("\n"),
      config
    );
    return;
  }

  // 2. Specific Contact Mode: "on [Contact]", "on for [Contact]", "on [Contact]: [prompt]"
  let targetQuery = clean.replace(/^(for|contact)\s+/i, "").trim();
  let customPrompt: string | undefined = undefined;

  const colonIdx = targetQuery.indexOf(":");
  if (colonIdx !== -1) {
    customPrompt = targetQuery.substring(colonIdx + 1).trim();
    targetQuery = targetQuery.substring(0, colonIdx).trim();
  }

  // Find contact in directory
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

  enableAutopilot(chat.jid, chat.name, customPrompt, config);
  const promptStr = customPrompt ? `\n📝 *Custom Context:* "${customPrompt}"` : "";
  await sendText(
    sock,
    chatJid,
    [
      `🤖 *Auto-Pilot ENABLED for ${chat.name}!*`,
      `────────────────────────────`,
      `ARGUS will now autonomously reply to incoming messages from *${chat.name}* as you in your personal voice.${promptStr}`,
      `────────────────────────────`,
      `_To turn off:_ */autopilot off ${chat.name}*`,
    ].join("\n"),
    config
  );
}

async function handleDisableAutopilot(sock: WASocket, chatJid: string, raw: string, config: Config): Promise<void> {
  const clean = raw.trim().toLowerCase();
  if (
    !clean ||
    clean === "all" ||
    clean === "for all" ||
    clean === "off all" ||
    clean === "off for all" ||
    clean === "global" ||
    clean === "off" ||
    clean === "everyone"
  ) {
    disableAllAutopilot(config);
    await sendText(sock, chatJid, "🛑 *Auto-Pilot disabled for all contacts & global mode.*", config);
    return;
  }

  const targetQuery = clean.replace(/^(for|contact)\s+/i, "").trim();
  const chat = findChatByNameOrQuery(targetQuery);
  const targetJid = chat ? chat.jid : targetQuery;
  const targetName = chat ? chat.name : targetQuery;

  const success = disableAutopilot(targetJid, config);
  if (success) {
    await sendText(sock, chatJid, `🛑 *Auto-Pilot disabled for ${targetName}.*`, config);
  } else {
    disableAllAutopilot(config);
    await sendText(sock, chatJid, "🛑 *Auto-Pilot disabled for all contacts & global mode.*", config);
  }
}

async function sendHelpMessage(sock: WASocket, jid: string, config: Config): Promise<void> {
  const help = [
    `⚡ *ARGUS AI Executive Assistant — Command Center*`,
    ``,
    `📌 *Instant Slash Commands (Deterministic & Fast):*`,
    `• */todos* or */todo list* — View all pending todo tasks`,
    `• */todo add [task]* — Add a new task (e.g. */todo buy milk*)`,
    `• */todo done [id]* — Mark task completed (e.g. */todo done 1*)`,
    `• */todo delete [id]* — Remove task (e.g. */todo delete 1*)`,
    `• */reminders* — View all scheduled reminders & due times`,
    `• */reminder [text] [time]* — Set reminder (e.g. */reminder call Mom 5pm*)`,
    `• */autopilot* — View active autonomy contacts & kill switch state`,
    `• */autopilot on [Person]* — Enable autonomous persona for contact`,
    `• */autopilot off [Person]* — Disable persona for contact`,
    `• */killswitch on* — 🛑 Emergency halt for ALL auto-replies system-wide`,
    `• */killswitch off* — 🟢 Restore auto-replies across active contacts`,
    `• */briefing* or */agenda* — Morning briefing & today's schedule`,
    `• */expenses* — Monthly financial breakdown`,
    `• */debts* — Split ledger & who owes you money`,
    `• */contacts* — Synced WhatsApp directory`,
    `• */ask [query]* — Query AI Brain with live web search & memory`,
    ``,
    `💬 *Natural Language (Ask Anything Naturally):*`,
    `• *"show me my todo list"* or *"what are my pending tasks?"*`,
    `• *"remind me to submit report tomorrow at 10am"*`,
    `• *"paid 450 for lunch with Alex"*`,
    `• *"Alex owes me 200 for taxi"*`,
    `• *"schedule project sync tomorrow at 3pm"*`,
    `• *"tell [name] [message]"* or *"frame message to [name]"*`,
    `• *"remember [fact]"* (e.g. *"remember Alex is my project partner"* )`,
    `• *"what did they say in [group name]?"* / *"summarize [chat]"*`,
    `• *"read my emails"*`,
  ].join("\n");

  await sendText(sock, jid, help, config);
}
