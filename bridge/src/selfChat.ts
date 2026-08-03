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
} from "./db.js";
import {
  sendText,
  sendTodoList,
  sendReminderSet,
  sendError,
  sendEventConfirmation,
} from "./replySender.js";
import { callBrain } from "./brainClient.js";

const logger = pino({ name: "argus:selfchat" });

/**
 * Handles messages sent to self-chat (your own JID).
 * This is the "command mode" where you talk directly to ARGUS.
 */
export async function handleSelfChatMessage(
  sock: WASocket,
  text: string,
  chatJid: string,
  config: Config
): Promise<void> {
  const normalized = text.trim().toLowerCase();

  // ─── Explicit commands ─────────────────────────────────────
  if (normalized === "help" || normalized === "/help") {
    await sendHelpMessage(sock, chatJid, config);
    return;
  }

  if (normalized === "todos" || normalized === "show todos" || normalized === "my todos" || normalized === "list") {
    const todos = getTodos(chatJid);
    await sendTodoList(sock, chatJid, todos, config);
    return;
  }

  if (normalized.startsWith("done #") || normalized.startsWith("complete #")) {
    const idStr = normalized.replace(/^(done|complete)\s*#/, "").trim();
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      await sendError(sock, chatJid, "Invalid todo ID. Use: done #1", config);
      return;
    }
    const success = completeTodo(id);
    if (success) {
      await sendText(sock, chatJid, `✅ Todo #${id} completed!`, config);
    } else {
      await sendError(sock, chatJid, `Todo #${id} not found or already completed.`, config);
    }
    return;
  }

  if (normalized.startsWith("delete #") || normalized.startsWith("remove #")) {
    const idStr = normalized.replace(/^(delete|remove)\s*#/, "").trim();
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      await sendError(sock, chatJid, "Invalid todo ID. Use: delete #1", config);
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

  // ─── AI-powered intent routing ─────────────────────────────
  // Send to AI Brain for intent classification
  try {
    const result = await callBrain(config, "/process-message", {
      sender_jid: chatJid,
      message_text: text,
      chat_jid: chatJid,
      timestamp: new Date().toISOString(),
      is_self_chat: true,
    });

    if (!result || !result.intent) {
      await sendText(sock, chatJid, "🤔 I didn't understand that. Type *help* for commands.", config);
      return;
    }

    switch (result.intent) {
      case "reminder": {
        // Parse the reminder
        const reminderResult = await callBrain(config, "/parse-reminder", {
          message_text: text,
          reference_timestamp: new Date().toISOString(),
        });
        if (reminderResult && reminderResult.reminder_text && reminderResult.due_at) {
          addReminder(chatJid, reminderResult.reminder_text, reminderResult.due_at);
          await sendReminderSet(
            sock,
            chatJid,
            reminderResult.reminder_text,
            reminderResult.due_at,
            config
          );
        } else {
          await sendError(sock, chatJid, "Couldn't parse the reminder. Try: 'remind me to call mom at 5pm'", config);
        }
        break;
      }

      case "todo": {
        // Extract todo text from the AI response, or fallback to simple parsing
        const todoText = result.extract_data?.text || text.replace(/^add\s+/i, "").replace(/\s+to\s+(my\s+)?(todo|list)$/i, "").trim();
        if (todoText) {
          const todo = addTodo(chatJid, todoText);
          await sendText(sock, chatJid, `📝 Added: *${todo.text}* (Todo #${todo.id})`, config);
        } else {
          await sendError(sock, chatJid, "Couldn't understand what to add. Try: 'add buy groceries to my list'", config);
        }
        break;
      }

      case "question": {
        const answer = await callBrain(config, "/ask", { question: text });
        if (answer && answer.answer) {
          await sendText(sock, chatJid, `💡 ${answer.answer}`, config);
        } else {
          await sendError(sock, chatJid, "Couldn't get an answer. Try rephrasing.", config);
        }
        break;
      }

      case "summarize": {
        // Get recent messages for the requested chat
        // For now, summarize self-chat context. Future: parse which chat to summarize
        const messages = getRecentMessages(chatJid, 30);
        if (messages.length === 0) {
          await sendText(sock, chatJid, "No recent messages to summarize.", config);
          break;
        }
        const summary = await callBrain(config, "/summarize", {
          messages: messages.reverse().map((m) => ({
            sender: m.is_from_me ? "You" : (m.sender_name || "Unknown"),
            text: m.message_text,
            timestamp: m.timestamp,
          })),
          instruction: text,
        });
        if (summary && summary.summary) {
          await sendText(sock, chatJid, `📋 *Summary:*\n\n${summary.summary}`, config);
        } else {
          await sendError(sock, chatJid, "Couldn't generate a summary.", config);
        }
        break;
      }

      case "event": {
        // Self-chat event — treat like a manual event creation
        const eventResult = await callBrain(config, "/extract-event", {
          source_app: "self-chat",
          notification_text: text,
          received_at: new Date().toISOString(),
        });
        if (eventResult && eventResult.is_event) {
          const pending = addPendingEvent(
            chatJid,
            chatJid,
            text,
            eventResult.title,
            eventResult.date,
            eventResult.time,
            eventResult.confidence
          );
          await sendEventConfirmation(
            sock,
            chatJid,
            pending.id,
            eventResult.title || "Event",
            eventResult.date || "TBD",
            eventResult.time,
            null,
            config
          );
        } else {
          await sendText(sock, chatJid, "🤔 I didn't detect an event in that. Try rephrasing, or type *help* for commands.", config);
        }
        break;
      }

      default:
        await sendText(sock, chatJid, "🤔 I didn't understand that. Type *help* for commands.", config);
    }
  } catch (err) {
    logger.error({ err }, "Error processing self-chat message");
    await sendError(sock, chatJid, "Something went wrong. The AI Brain might be offline.", config);
  }
}

async function sendHelpMessage(
  sock: WASocket,
  jid: string,
  config: Config
): Promise<void> {
  const help = [
    `🤖 *ARGUS — Your Personal AI Assistant*`,
    ``,
    `*Calendar:*`,
    `  • Just mention a meeting in any chat — I'll detect it`,
    `  • Or tell me: "meeting with Rahul on Tuesday at 3pm"`,
    ``,
    `*Reminders:*`,
    `  • "remind me to call mom at 5pm"`,
    `  • "remind me tomorrow morning to buy milk"`,
    ``,
    `*Todos:*`,
    `  • "add buy groceries to my list"`,
    `  • "todos" — show your list`,
    `  • "done #1" — mark completed`,
    `  • "delete #1" — remove`,
    ``,
    `*AI:*`,
    `  • Ask me anything — "what's the capital of France?"`,
    `  • "summarize my chat with Rahul"`,
    ``,
    `_Just type naturally — I'll figure out what you mean!_`,
  ].join("\n");

  await sendText(sock, jid, help, config);
}
