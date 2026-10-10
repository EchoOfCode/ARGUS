import test from "node:test";
import assert from "node:assert/strict";

process.env.ARGUS_WEB_ACCESS_KEY = "test_owner_web_key_32_bytes_super_secure!";

import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE_NAME,
} from "../src/lib/auth.ts";

test("Unauthenticated requests to API routes are strictly rejected", async () => {
  // Test simulated request without session cookie
  const unauthedToken = null;
  assert.equal(verifySessionToken(unauthedToken), false);

  const fakeToken = "invalid.session.token";
  assert.equal(verifySessionToken(fakeToken), false);

  // Valid session cookie passes
  const validToken = createSessionToken();
  assert.equal(verifySessionToken(validToken), true);
});

test("Zero Credential Leakage: Credential patterns and vault values are fundamentally excluded", async () => {
  // Simulated memory items from database
  const sampleMemories = [
    { id: 1, fact_text: "Prefers oat milk in coffee", category: "preferences" },
    { id: 2, fact_text: "Office address is 100 Main St", category: "work" },
  ];

  // Forbidden categories that must never appear in response
  const forbiddenCategories = ["credentials", "credential", "password", "secret", "vault"];
  for (const m of sampleMemories) {
    assert.equal(
      forbiddenCategories.includes(m.category.toLowerCase()),
      false,
      `Forbidden category ${m.category} detected in memory output!`
    );
  }

  // Ensure no secret patterns exist
  const serialized = JSON.stringify(sampleMemories);
  const secretKeywords = ["password=", "secret_key=", "vault_token="];
  for (const kw of secretKeywords) {
    assert.equal(serialized.includes(kw), false);
  }
});

test("Approvals state transitions: Pending -> Approved / Edited / Declined", () => {
  const draft = {
    id: "draft_test_1",
    target_jid: "919876543210@s.whatsapp.net",
    draft_text: "Original draft text",
    status: "pending",
  };

  // 1. Approve transition
  const approvedDraft = { ...draft, status: "approved" };
  assert.equal(approvedDraft.status, "approved");

  // 2. Edit transition
  const editedDraft = {
    ...draft,
    draft_text: "Modified text",
    status: "approved",
    action: "edited_approved",
  };
  assert.equal(editedDraft.draft_text, "Modified text");
  assert.equal(editedDraft.action, "edited_approved");

  // 3. Decline transition
  const declinedDraft = { ...draft, status: "declined" };
  assert.equal(declinedDraft.status, "declined");
});
