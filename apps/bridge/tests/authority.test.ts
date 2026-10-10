import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveOwnerIdentity,
  isOwnerSender,
  isCommandChannel,
  isAuthorizedCommandTurn,
} from "../src/authority.js";
import { isBridgeOriginatedMessage, recordSentMessageId } from "../src/policy/dispatcher.js";

const OWNER_PHONE = "919876543210";
const OWNER_JID = `${OWNER_PHONE}@s.whatsapp.net`;
const OWNER_LID = "12345678901234@lid";
const COMMAND_GROUP_JID = "120363029999999999@g.us";
const ATTACKER_JID = "919999999999@s.whatsapp.net";

test("ADR 0002: Session credentials match configured MY_JID", () => {
  const identity = deriveOwnerIdentity(
    { id: `${OWNER_PHONE}:2@s.whatsapp.net`, lid: OWNER_LID },
    OWNER_JID
  );
  assert.equal(identity.ownerJid, OWNER_JID);
  assert.equal(identity.ownerLid, OWNER_LID);
});

test("ADR 0002: Session credentials mismatch halts with fatal error", () => {
  assert.throws(
    () => {
      deriveOwnerIdentity(
        { id: "910000000000@s.whatsapp.net" },
        OWNER_JID
      );
    },
    /CRITICAL IDENTITY MISMATCH/
  );
});

test("ADR 0002: Sender authentication via phone JID (with device suffix) and LID", () => {
  // Device suffix :1 normalized to base JID
  assert.ok(isOwnerSender(`${OWNER_PHONE}:1@s.whatsapp.net`, OWNER_JID, OWNER_LID));
  // Exact match
  assert.ok(isOwnerSender(OWNER_JID, OWNER_JID, OWNER_LID));
  // LID match
  assert.ok(isOwnerSender(OWNER_LID, OWNER_JID, OWNER_LID));
  // Non-owner rejected
  assert.ok(!isOwnerSender(ATTACKER_JID, OWNER_JID, OWNER_LID));
});

test("ADR 0002: Channel authorization strictly pinned by Group JID or Self-Chat", () => {
  // Self-chat is valid
  assert.ok(isCommandChannel(OWNER_JID, OWNER_JID, COMMAND_GROUP_JID));
  // Pinned group JID is valid
  assert.ok(isCommandChannel(COMMAND_GROUP_JID, OWNER_JID, COMMAND_GROUP_JID));
  // Other group JIDs are invalid even if renamed
  assert.ok(!isCommandChannel("120363021111111111@g.us", OWNER_JID, COMMAND_GROUP_JID));
  // Other contacts are invalid
  assert.ok(!isCommandChannel(ATTACKER_JID, OWNER_JID, COMMAND_GROUP_JID));
});

test("ADR 0002: Authority Equation evaluation", () => {
  // 1. Authorized: Owner in command group
  assert.ok(
    isAuthorizedCommandTurn({
      chatJid: COMMAND_GROUP_JID,
      senderJid: OWNER_JID,
      isBridgeOriginated: false,
      ownerJid: OWNER_JID,
      ownerLid: OWNER_LID,
      commandGroupJid: COMMAND_GROUP_JID,
    })
  );

  // 2. Authorized: Owner via LID in self-chat
  assert.ok(
    isAuthorizedCommandTurn({
      chatJid: OWNER_JID,
      senderJid: OWNER_LID,
      isBridgeOriginated: false,
      ownerJid: OWNER_JID,
      ownerLid: OWNER_LID,
      commandGroupJid: COMMAND_GROUP_JID,
    })
  );

  // 3. Rejected: Non-owner in command group (even if spoofing pushName)
  assert.ok(
    !isAuthorizedCommandTurn({
      chatJid: COMMAND_GROUP_JID,
      senderJid: ATTACKER_JID,
      isBridgeOriginated: false,
      ownerJid: OWNER_JID,
      ownerLid: OWNER_LID,
      commandGroupJid: COMMAND_GROUP_JID,
    })
  );

  // 4. Rejected: Owner in external chat (not command channel)
  assert.ok(
    !isAuthorizedCommandTurn({
      chatJid: "120363028888888888@g.us",
      senderJid: OWNER_JID,
      isBridgeOriginated: false,
      ownerJid: OWNER_JID,
      ownerLid: OWNER_LID,
      commandGroupJid: COMMAND_GROUP_JID,
    })
  );

  // 5. Rejected: Bridge-originated message (echo loop prevention)
  assert.ok(
    !isAuthorizedCommandTurn({
      chatJid: COMMAND_GROUP_JID,
      senderJid: OWNER_JID,
      isBridgeOriginated: true,
      ownerJid: OWNER_JID,
      ownerLid: OWNER_LID,
      commandGroupJid: COMMAND_GROUP_JID,
    })
  );
});

test("ADR 0002: Sent message ID LRU prevents echo loops", () => {
  const msgId = "TEST_MSG_ECHO_12345";
  assert.ok(!isBridgeOriginatedMessage(msgId));
  recordSentMessageId(msgId);
  assert.ok(isBridgeOriginatedMessage(msgId));
});
