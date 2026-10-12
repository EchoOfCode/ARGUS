import { test } from "node:test";
import assert from "node:assert/strict";
import { recordLidMapping, resolveLidToPhoneJid } from "../src/lidResolver.js";
import { saveChatDirectory } from "../src/db.js";

const FAKE_LID = "111122223333@lid";
const FAKE_PHONE_JID = "919999900001@s.whatsapp.net";

test("LidResolver: returns original JID if already a phone number or group JID", () => {
  assert.equal(resolveLidToPhoneJid(FAKE_PHONE_JID), FAKE_PHONE_JID);
  assert.equal(resolveLidToPhoneJid("120363099999999999@g.us"), "120363099999999999@g.us");
});

test("LidResolver: resolves @lid via direct recorded mapping", () => {
  recordLidMapping(FAKE_LID, FAKE_PHONE_JID, "Test User");
  const resolved = resolveLidToPhoneJid(FAKE_LID);
  assert.equal(resolved, FAKE_PHONE_JID);
});

test("LidResolver: resolves @lid via contact directory name match", () => {
  const UNMAPPED_LID = "444455556666@lid";
  const CONTACT_PHONE_JID = "919999900002@s.whatsapp.net";
  saveChatDirectory(CONTACT_PHONE_JID, "Bob Example", false);

  // Match by full name
  const resolvedFull = resolveLidToPhoneJid(UNMAPPED_LID, "Bob Example");
  assert.equal(resolvedFull, CONTACT_PHONE_JID);

  const UNMAPPED_LID_2 = "777788889999@lid";
  // Match by first name token
  const resolvedToken = resolveLidToPhoneJid(UNMAPPED_LID_2, "Bob");
  assert.equal(resolvedToken, CONTACT_PHONE_JID);
});
