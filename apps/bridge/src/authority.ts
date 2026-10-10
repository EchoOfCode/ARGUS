import { jidNormalizedUser, areJidsSameUser } from "@whiskeysockets/baileys";
import pino from "pino";

const logger = pino({ name: "argus:authority" });

export interface OwnerIdentity {
  ownerJid: string;
  ownerLid?: string;
}

/**
 * Derive authenticated owner identity from the paired Baileys session credentials.
 * Asserts that the configured MY_JID matches the session identity.
 */
export function deriveOwnerIdentity(
  sockUser?: { id?: string; lid?: string },
  configuredOwnerJid?: string
): OwnerIdentity {
  if (!sockUser || !sockUser.id) {
    if (configuredOwnerJid) {
      return { ownerJid: jidNormalizedUser(configuredOwnerJid) };
    }
    throw new Error("Cannot derive owner identity: neither paired session user nor configured MY_JID is available.");
  }

  const derivedOwnerJid = jidNormalizedUser(sockUser.id);
  const ownerLid = sockUser.lid ? jidNormalizedUser(sockUser.lid) : undefined;

  if (configuredOwnerJid) {
    const normalizedConfigured = jidNormalizedUser(configuredOwnerJid);
    if (!areJidsSameUser(derivedOwnerJid, normalizedConfigured)) {
      const msg = `CRITICAL IDENTITY MISMATCH: Configured MY_JID (${normalizedConfigured}) does not match paired WhatsApp session user (${derivedOwnerJid}). Halting execution for safety.`;
      logger.fatal(msg);
      throw new Error(msg);
    }
  }

  return { ownerJid: derivedOwnerJid, ownerLid };
}

/**
 * Verify if the sender JID matches the authenticated owner (by phone JID or LID).
 */
export function isOwnerSender(
  senderJid: string,
  ownerJid: string,
  ownerLid?: string
): boolean {
  if (!senderJid) return false;
  const normSender = jidNormalizedUser(senderJid);
  const normOwner = jidNormalizedUser(ownerJid);

  if (areJidsSameUser(normSender, normOwner)) {
    return true;
  }

  if (ownerLid) {
    const normOwnerLid = jidNormalizedUser(ownerLid);
    if (areJidsSameUser(normSender, normOwnerLid)) {
      return true;
    }
  }

  return false;
}

/**
 * Determine if a chat channel is an authorized command channel (ADR 0002).
 * Group names are NEVER trusted. Only direct self-chat or the exact COMMAND_GROUP_JID is accepted.
 */
export function isCommandChannel(
  chatJid: string,
  ownerJid: string,
  commandGroupJid?: string
): boolean {
  if (!chatJid) return false;
  const normChat = jidNormalizedUser(chatJid);

  // Self-chat is always an authorized command channel
  if (areJidsSameUser(normChat, jidNormalizedUser(ownerJid))) {
    return true;
  }

  // Pinned command group JID match
  if (commandGroupJid && commandGroupJid.trim().length > 0) {
    const normCommandGroup = jidNormalizedUser(commandGroupJid.trim());
    if (normChat === normCommandGroup) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluate the full ADR 0002 Authority equation:
 * Authority = (chat_jid == COMMAND_GROUP_JID || chat_jid == OWNER_JID)
 *             AND (sender_jid == OWNER_JID)
 *             AND (!is_bridge_originated)
 */
export function isAuthorizedCommandTurn(params: {
  chatJid: string;
  senderJid: string;
  isBridgeOriginated: boolean;
  ownerJid: string;
  ownerLid?: string;
  commandGroupJid?: string;
}): boolean {
  const { chatJid, senderJid, isBridgeOriginated, ownerJid, ownerLid, commandGroupJid } = params;

  if (isBridgeOriginated) {
    logger.debug({ senderJid }, "Authority rejected: message is bridge-originated");
    return false;
  }

  if (!isCommandChannel(chatJid, ownerJid, commandGroupJid)) {
    logger.debug({ chatJid }, "Authority rejected: channel is not an authorized command channel");
    return false;
  }

  if (!isOwnerSender(senderJid, ownerJid, ownerLid)) {
    logger.warn({ senderJid, chatJid }, "Authority rejected: sender is not the authenticated owner");
    return false;
  }

  return true;
}
