import pino from "pino";
import { chatDirectory } from "./db.js";

const logger = pino({ name: "argus:lid-resolver" });

// In-memory mapping of @lid -> @s.whatsapp.net
const lidToPhoneMap = new Map<string, string>();
const phoneToLidMap = new Map<string, string>();

/**
 * Record a bidirectional mapping between an @lid and a phone JID (@s.whatsapp.net).
 */
export function recordLidMapping(lid: string, phoneJid: string, name?: string): void {
  if (!lid || !phoneJid) return;
  const cleanLid = lid.split(":")[0];
  const cleanPn = phoneJid.split(":")[0];
  const normPn = cleanPn.includes("@") ? cleanPn : `${cleanPn}@s.whatsapp.net`;

  if (cleanLid.endsWith("@lid") && normPn.endsWith("@s.whatsapp.net")) {
    lidToPhoneMap.set(cleanLid, normPn);
    phoneToLidMap.set(normPn, cleanLid);
    logger.info({ lid: cleanLid, phoneJid: normPn, name }, "Recorded LID to Phone JID mapping");
  }
}

/**
 * Resolve an @lid identifier to its standard phone number JID (@s.whatsapp.net).
 * Uses direct recorded mappings, followed by fuzzy name resolution across the contact directory.
 */
export function resolveLidToPhoneJid(lid: string, hintName?: string | null): string | null {
  if (!lid) return null;
  const cleanLid = lid.split(":")[0];
  if (!cleanLid.endsWith("@lid")) return cleanLid; // Already a phone JID or group

  // 1. Direct recorded mapping lookup
  if (lidToPhoneMap.has(cleanLid)) {
    return lidToPhoneMap.get(cleanLid)!;
  }

  // 2. Lookup by contact name in chatDirectory
  if (hintName) {
    const hintLower = hintName.toLowerCase().trim();
    // Split into tokens of length >= 3 (e.g. "Harshith", "Nadella")
    const hintTokens = hintLower.split(/\s+/).filter((t) => t.length >= 3);

    for (const [jid, contact] of chatDirectory.entries()) {
      if (jid.endsWith("@s.whatsapp.net") && !contact.is_group && contact.name) {
        const contactNameLower = contact.name.toLowerCase().trim();
        if (
          contactNameLower === hintLower ||
          contactNameLower.includes(hintLower) ||
          hintLower.includes(contactNameLower) ||
          hintTokens.some((t) => contactNameLower.includes(t))
        ) {
          logger.info(
            { lid: cleanLid, matchedPhoneJid: jid, hintName, contactName: contact.name },
            "Resolved @lid to phone JID via contact directory name match"
          );
          lidToPhoneMap.set(cleanLid, jid);
          phoneToLidMap.set(jid, cleanLid);
          return jid;
        }
      }
    }
  }

  return null;
}
