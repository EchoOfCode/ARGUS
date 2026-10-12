/**
 * Outbound Policy Engine & Mandatory Single Dispatcher (ADR 0003).
 * Sole choke point permitted to call Baileys sock.sendMessage().
 * Enforces fail-closed semantics, sent ID tracking (echo prevention), and undo delays.
 */

import { WASocket, AnyMessageContent } from "@whiskeysockets/baileys";
import pino from "pino";
import { Config } from "../config.js";
import { callBrain } from "../brainClient.js";
import { resolveLidToPhoneJid } from "../lidResolver.js";

const logger = pino({ name: "argus:policy:dispatcher" });

// LRU tracking for bridge-sent message IDs to prevent echo loops (ADR 0002)
const MAX_SENT_IDS = 5000;
const sentMessageIds = new Map<string, number>();

export function recordSentMessageId(messageId: string): void {
  if (!messageId) return;
  if (sentMessageIds.size >= MAX_SENT_IDS) {
    // Evict oldest entry
    const oldestKey = sentMessageIds.keys().next().value;
    if (oldestKey) sentMessageIds.delete(oldestKey);
  }
  sentMessageIds.set(messageId, Date.now());
}

export function isBridgeOriginatedMessage(messageId: string): boolean {
  if (!messageId) return false;
  const sentTime = sentMessageIds.get(messageId);
  if (!sentTime) return false;
  // Expire after 24 hours
  if (Date.now() - sentTime > 24 * 60 * 60 * 1000) {
    sentMessageIds.delete(messageId);
    return false;
  }
  return true;
}

export interface DispatchOptions {
  triggerType: "owner_command" | "autopilot_reply" | "reminder_alert";
  isGroup?: boolean;
  senderName?: string;
  onUndoScheduled?: (cancelFn: () => void, delaySeconds: number) => void;
}

export interface DispatchResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
  approvalId?: string;
  requiresApproval?: boolean;
}

/**
 * MANDATORY CHOKE POINT: All outbound messages across the bridge must route through this function.
 * Evaluates the Brain policy engine with fail-closed semantics before sending.
 */
export async function dispatchOutboundMessage(
  sock: WASocket,
  config: Config,
  targetJid: string,
  content: AnyMessageContent,
  options: DispatchOptions
): Promise<DispatchResult> {
  // If targetJid is an @lid, resolve to the contact's standard phone JID (@s.whatsapp.net)
  // to ensure reliable delivery and synchronization across WhatsApp multi-device clients.
  let effectiveJid = targetJid;
  if (effectiveJid.endsWith("@lid")) {
    const resolvedPn = resolveLidToPhoneJid(effectiveJid, options.senderName);
    if (resolvedPn) {
      logger.info({ originalLid: effectiveJid, resolvedPhoneJid: resolvedPn }, "Resolved outbound @lid to standard phone JID (@s.whatsapp.net)");
      effectiveJid = resolvedPn;
    }
  }

  const messageText = typeof content === "object" && "text" in content ? (content.text as string) : "[Media/Card]";
  const isGroup = options.isGroup ?? effectiveJid.endsWith("@g.us");

  logger.info({ targetJid: effectiveJid, originalJid: targetJid, trigger: options.triggerType, isGroup, senderName: options.senderName }, "Evaluating outbound policy for message");

  // 1. Evaluate policy with 10000ms strict timeout (Fail-Closed)
  let policyVerdict: any;
  try {
    const policyPromise = callBrain(config, "/api/policy/evaluate", {
      target_jid: effectiveJid,
      message_text: messageText,
      trigger_type: options.triggerType,
      is_group: isGroup,
      sender_name: options.senderName,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Policy evaluation timed out (> 10000ms)")), 10000)
    );

    policyVerdict = await Promise.race([policyPromise, timeoutPromise]);
  } catch (err: any) {
    // FAIL CLOSED: If brain is unreachable or times out, never send
    logger.error({ error: err.message, targetJid: effectiveJid }, "Outbound policy evaluation failed; FAILING CLOSED (0 bytes sent)");
    return {
      sent: false,
      reason: `Policy check failed: ${err.message}. Failed closed.`,
    };
  }

  // 2. Process Policy Verdict
  if (policyVerdict.verdict === "rejected") {
    logger.warn({ targetJid: effectiveJid, reason: policyVerdict.reason }, "Outbound message rejected by policy");
    return { sent: false, reason: policyVerdict.reason };
  }

  if (policyVerdict.verdict === "requires_approval") {
    logger.info({ targetJid: effectiveJid, approvalId: policyVerdict.approval_id }, "Outbound message requires owner approval (Tier 1)");
    return {
      sent: false,
      requiresApproval: true,
      approvalId: policyVerdict.approval_id,
      reason: "Requires owner approval",
    };
  }

  if (policyVerdict.verdict === "draft_only") {
    logger.info({ targetJid: effectiveJid }, "Outbound message classified as Draft Only (Tier 0)");
    return {
      sent: false,
      reason: policyVerdict.reason || "Draft Only (Tier 0)",
    };
  }

  // 3. Handle Approved Messages with optional Undo Window
  if (policyVerdict.verdict === "approved") {
    const undoDelayS = policyVerdict.undo_delay_s || 0;
    if (undoDelayS > 0) {
      logger.info({ targetJid: effectiveJid, undoDelayS }, "Holding message in undo window before dispatch");
      let cancelled = false;
      const cancelFn = () => {
        cancelled = true;
        logger.info({ targetJid: effectiveJid }, "Message send cancelled by user during undo window");
      };

      if (options.onUndoScheduled) {
        options.onUndoScheduled(cancelFn, undoDelayS);
      }

      await new Promise((resolve) => setTimeout(resolve, undoDelayS * 1000));
      if (cancelled) {
        return { sent: false, reason: "Cancelled by owner during undo window" };
      }
    }

    // 4. Sole point of execution calling sock.sendMessage()
    try {
      const result = await sock.sendMessage(effectiveJid, content);
      if (result?.key?.id) {
        recordSentMessageId(result.key.id);
      }
      logger.info({ targetJid: effectiveJid, messageId: result?.key?.id }, "Successfully dispatched outbound message to WhatsApp");
      return {
        sent: true,
        messageId: result?.key?.id || undefined,
      };
    } catch (err: any) {
      logger.error({ targetJid: effectiveJid, error: err.message }, "Failed to send message via Baileys socket");
      throw err;
    }
  }

  return { sent: false, reason: "Unhandled policy verdict" };
}
