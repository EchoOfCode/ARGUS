import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Set environment for test
process.env.ARGUS_WEB_ACCESS_KEY = "test_owner_web_key_32_bytes_super_secure!";

import {
  createSessionToken,
  verifySessionToken,
  verifyAccessKey,
  checkRateLimit,
  recordFailedAttempt,
  clearFailedAttempts,
} from "../src/lib/auth.ts";

test("verifyAccessKey accepts exact configured key and rejects wrong keys", () => {
  assert.equal(verifyAccessKey("test_owner_web_key_32_bytes_super_secure!"), true);
  assert.equal(verifyAccessKey("wrong_key"), false);
  assert.equal(verifyAccessKey(""), false);
  assert.equal(verifyAccessKey("test_owner_web_key_32_bytes_super_secure!_extra"), false);
});

test("createSessionToken and verifySessionToken lifecycle", () => {
  const token = createSessionToken();
  assert.ok(token);
  assert.equal(token.split(".").length, 3);

  // Valid token passes verification
  assert.equal(verifySessionToken(token), true);

  // Tampered payload fails verification
  const parts = token.split(".");
  const tampered = `${parts[0]}.tampered_${parts[1]}.${parts[2]}`;
  assert.equal(verifySessionToken(tampered), false);

  // Tampered signature fails verification
  const badSig = `${parts[0]}.${parts[1]}.bad_sig_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`;
  assert.equal(verifySessionToken(badSig), false);

  // Expired token (8 days in past) fails verification
  const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000;
  const payload = `${oldTime}.${parts[1]}`;
  const hmac = crypto.createHmac("sha256", process.env.ARGUS_WEB_ACCESS_KEY);
  hmac.update(payload);
  const oldToken = `${payload}.${hmac.digest("hex")}`;
  assert.equal(verifySessionToken(oldToken), false);
});

test("Rate limiter locks out IP after 5 consecutive failures", () => {
  const testIp = "192.168.1.100";
  clearFailedAttempts(testIp);

  // 4 attempts allowed
  for (let i = 0; i < 4; i++) {
    assert.equal(checkRateLimit(testIp).allowed, true);
    recordFailedAttempt(testIp);
  }

  // 5th attempt: recorded
  assert.equal(checkRateLimit(testIp).allowed, true);
  recordFailedAttempt(testIp);

  // 6th attempt: blocked with 429 retryAfter
  const blocked = checkRateLimit(testIp);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);

  // Clear attempts resets limit
  clearFailedAttempts(testIp);
  assert.equal(checkRateLimit(testIp).allowed, true);
});
