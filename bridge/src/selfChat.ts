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
} from "./db.js";
import {
  sendText,
  sendTodoList,
  sendReminderSet,
  sendError,
  sendEventConfirmation,
  sendEmailList,
  sendEmailSummary,
  sendCatchupSummary,
  sendMemoryResponse,
  sendSearchResults,
} from "./replySender.js";
import { callBrain } from "./brainClient.js";

const logger = pino({ name: "argus:selfchat" });

// In-memory cache for recent email listing so user can say "summarize email 1"
let cachedEmails: Array<{ id: string; subject: string; sender: string; date: string; snippet: string; body?: string }> = [];

/**
 * Handles messages sent to self-chat (your own JID).
 * This is the command mode where you talk directly to ARGUS.
 */
export async function handleSelfChatMessage(
  sock: WASocket,
  text: string,
  chatJid: string,
  config: Config
): Promise<void> {
  const normalized = text.trim().toLowerCase();

  // ─── Help Command ───────────────────────────────────────────
  if (normalized === "help" || normalized === "/help") {
    await sendHelpMessage(sock, chatJid, config);
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

  // ─── Email Commands ─────────────────────────────────────────
  if (["emails", "email", "unread", "unread emails", "inbox", "check email"].includes(normalized)) {
    await handleFetchUnreadEmails(sock, chatJid, config);
    return;
  }

  if (normalized.startsWith("summarize email") || normalized.startsWith("read email")) {
    const query = normalized.replace(/^(summarize|read)\s+email\s*/, "").trim();
    await handleSummarizeEmail(sock, chatJid, query, config);
    return;
  }

  if (normalized.startsWith("search email") || normalized.startsWith("find email")) {
    const query = text.replace(/^(search|find)\s+email\s*/i, "").trim();
    await handleSearchEmails(sock, chatJid, query, config);
    return;
  }

  // ─── Daily Briefing Command ─────────────────────────────────
  if (["briefing", "daily briefing", "morning briefing", "agenda", "today"].includes(normalized)) {
    await handleDailyBriefing(sock, chatJid, config);
    return;
  }

  // ─── Catch-up / Group Summarization ─────────────────────────
  if (normalized.startsWith("catchup") || normalized.startsWith("catch up") || normalized.startsWith("recap") || normalized.startsWith("summarize chat")) {
    const target = text.replace(/^(catchup|catch\s*up|recap|summarize\s*chat)\s*(on|with|for)?\s*/i, "").trim();
    await handleChatCatchup(sock, chatJid, target, config);
    return;
  }

  // ─── Memory Commands ("Second Brain") ───────────────────────
  if (normalized.startsWith("remember ") || normalized.startsWith("note that ") || normalized.startsWith("save note ")) {
    const fact = text.replace(/^(remember|note\s+that|save\s+note)\s*/i, "").trim();
    await handleSaveMemory(sock, chatJid, fact, config);
    return;
  }

  if (normalized.startsWith("recall ") || normalized.startsWith("what is my ") || normalized.startsWith("where is my ") || normalized.startsWith("where did i put ")) {
    await handleRecallMemory(sock, chatJid, text, config);
    return;
  }

  // ─── Live Web Search Commands ───────────────────────────────
  if (normalized.startsWith("search ") || normalized.startsWith("google ") || normalized.startsWith("web ")) {
    const query = text.replace(/^(search|google|web)\s*/i, "").trim();
    await handleWebSearch(sock, chatJid, query, config);
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
        const extractResult = await callBrain(config, "/extract-event", {
          source_app: "self-chat",
          notification_text: text,
          received_at: new Date().toISOString(),
        });

        if (extractResult && extractResult.is_event) {
          const pending = addPendingEvent(
            chatJid,
            config.myJid,
            text,
            extractResult.title,
            extractResult.date,
            extractResult.time,
            extractResult.confidence
          );

          await sendEventConfirmation(
            sock,
            chatJid,
            pending.id,
            extractResult.title || "Event",
            extractResult.date || "TBD",
            extractResult.time,
            null,
            config
          );
        } else {
          await sendText(sock, chatJid, "🤔 I couldn't find event details with dates/times in that message.", config);
        }
        break;
      }

      case "email_list":
        await handleFetchUnreadEmails(sock, chatJid, config);
        break;

      case "briefing":
        await handleDailyBriefing(sock, chatJid, config);
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
        `📬 *Email Setup Needed:*\n\n${res.message || "Please set EMAIL_USER and EMAIL_PASS in your backend .env file."}`,
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

  // If no cached index match, search or summarize by id
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
  let targetJid = chatJid;
  let targetName = "Recent Messages";

  if (target) {
    const found = findChatByNameOrQuery(target);
    if (found) {
      targetJid = found.jid;
      targetName = found.name;
    } else {
      await sendError(sock, chatJid, `Could not find chat or group matching "${target}".`, config);
      return;
    }
  }

  const messages = getRecentMessages(targetJid, 40);
  if (messages.length === 0) {
    await sendText(sock, chatJid, `No recent messages logged for *${targetName}* yet.`, config);
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
      instruction: `Provide an executive catch-up summary of what was discussed in ${targetName}. Highlight decisions, questions, links, and action items.`,
    };

    const res = await callBrain(config, "/summarize", payload);
    await sendCatchupSummary(sock, chatJid, targetName, res.summary, config);
  } catch (err) {
    await sendError(sock, chatJid, `Could not summarize chat ${targetName}.`, config);
  }
}

async function handleSaveMemory(sock: WASocket, chatJid: string, fact: string, config: Config) {
  if (!fact) {
    await sendError(sock, chatJid, "What fact would you like me to remember? Example: remember gate code is 1234", config);
    return;
  }
  try {
    const res = await callBrain(config, "/memory/save", { fact, category: "general" });
    await sendMemoryResponse(sock, chatJid, `Saved: "${res.fact}"`, config);
  } catch (err) {
    await sendError(sock, chatJid, "Failed to save to memory.", config);
  }
}

async function handleRecallMemory(sock: WASocket, chatJid: string, query: string, config: Config) {
  try {
    const res = await callBrain(config, "/memory/recall", { query, limit: 5 });
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

async function sendHelpMessage(sock: WASocket, jid: string, config: Config): Promise<void> {
  const help = [
    `🤖 *ARGUS Executive Assistant — Capabilities:*`,
    ``,
    `📅 *Events & Scheduling:*`,
    `• "Meeting with Alex tomorrow at 3pm" — Extracted & queued for calendar`,
    ``,
    `⏰ *Reminders:*`,
    `• "Remind me to call Mom in 20 minutes"`,
    `• "Remind me tomorrow at 9am to submit report"`,
    ``,
    `📝 *Todos:*`,
    `• "todos" / "list" — Show active tasks`,
    `• "add buy groceries" — Add new task`,
    `• "done #1" — Complete task`,
    `• "delete #1" — Delete task`,
    ``,
    `📬 *Emails (Direct IMAP):*`,
    `• "emails" / "unread" — View unread inbox`,
    `• "summarize email #1" — Deep executive breakdown`,
    `• "search email invoice" — Search inbox`,
    ``,
    `💬 *All-Chats Catch-up:*`,
    `• "catchup [Group/Contact Name]" — Summarizes missed discussions`,
    ``,
    `🌅 *Executive Briefing:*`,
    `• "briefing" / "agenda" — Instant daily overview`,
    ``,
    `🧠 *Second Brain Memory:*`,
    `• "remember my passport number is A123..."`,
    `• "what is my passport number?"`,
    ``,
    `🎙️ *Voice Notes:*`,
    `• Send any voice note directly to self-chat for instant Whisper execution!`,
  ].join("\n");

  await sendText(sock, jid, help, config);
}
