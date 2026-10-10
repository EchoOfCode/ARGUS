import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const VALID_ENV: Record<string, string> = {
  MY_JID: "919876543210@s.whatsapp.net",
  ARGUS_SECRET: "0123456789abcdef0123456789abcdef",
  AI_BRAIN_URL: "http://127.0.0.1:8000",
  LISTEN_MODE: "all",
  ALLOWED_JIDS: "919876543210@s.whatsapp.net,919123456789@s.whatsapp.net",
  SEND_DELAY_MS: "1200",
  BRIEFING_HOUR: "9",
  BRIEFING_MINUTE: "30",
  ENABLE_DAILY_BRIEFING: "true",
  DEDICATED_GROUP_NAME: "ARGUS-TEST",
  ENABLE_PASSIVE_ALERTS: "true",
  OWNER_NAME: "Alex",
};

test("loadConfig parses valid config correctly", () => {
  const config = loadConfig(VALID_ENV);
  assert.equal(config.myJid, "919876543210@s.whatsapp.net");
  assert.equal(config.argusSecret, "0123456789abcdef0123456789abcdef");
  assert.equal(config.aiBrainUrl, "http://127.0.0.1:8000");
  assert.equal(config.listenMode, "all");
  assert.deepEqual(config.allowedJids, [
    "919876543210@s.whatsapp.net",
    "919123456789@s.whatsapp.net",
  ]);
  assert.equal(config.sendDelayMs, 1200);
  assert.equal(config.briefingHour, 9);
  assert.equal(config.briefingMinute, 30);
  assert.equal(config.enableDailyBriefing, true);
  assert.equal(config.dedicatedGroupName, "ARGUS-TEST");
  assert.equal(config.enablePassiveAlerts, true);
  assert.equal(config.ownerName, "Alex");
});

test("loadConfig rejects missing MY_JID", () => {
  const env = { ...VALID_ENV, MY_JID: "" };
  assert.throws(() => loadConfig(env), /MY_JID is required/);
});

test("loadConfig rejects placeholder ARGUS_SECRET", () => {
  const placeholders = [
    "change-me-generate-with-openssl-rand-hex-32",
    "your_32_byte_hex_secret_here",
    "your_generated_secret_here",
    "dummy_secret",
  ];

  for (const placeholder of placeholders) {
    const env = { ...VALID_ENV, ARGUS_SECRET: placeholder };
    assert.throws(
      () => loadConfig(env),
      /ARGUS_SECRET cannot be an unconfigured placeholder/
    );
  }
});

test("loadConfig rejects secrets shorter than 32 characters in production mode", () => {
  const env = { ...VALID_ENV, ARGUS_SECRET: "tooshortsecret", ARGUS_TEST_MODE: "" };
  assert.throws(
    () => loadConfig(env),
    /ARGUS_SECRET must be at least 32 characters/
  );
});

test("loadConfig applies reasonable defaults for optional values", () => {
  const minimalEnv: Record<string, string> = {
    MY_JID: "919876543210@s.whatsapp.net",
    ARGUS_SECRET: "abcdefabcdefabcdefabcdefabcdefab",
  };
  const config = loadConfig(minimalEnv);
  assert.equal(config.aiBrainUrl, "http://127.0.0.1:8000");
  assert.equal(config.listenMode, "all");
  assert.deepEqual(config.allowedJids, []);
  assert.equal(config.sendDelayMs, 1500);
  assert.equal(config.briefingHour, 8);
  assert.equal(config.briefingMinute, 0);
  assert.equal(config.enableDailyBriefing, true);
  assert.equal(config.ownerName, "User");
});
