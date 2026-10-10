import { test, expect } from "@playwright/test";

const TEST_KEY = "test_playwright_access_key_32_bytes_long!";

test.describe("ARGUS Web UI Smoke Tests", () => {
  test("1. Unauthenticated requests are redirected to /login", async ({ page }) => {
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("h1")).toContainText("ARGUS Control Plane");
    await expect(page.locator("#access-key-input")).toBeVisible();
  });

  test("2. Login flow with valid access key", async ({ page }) => {
    await page.goto("/login");

    // Invalid attempt
    await page.fill("#access-key-input", "wrong_key");
    await page.click("#login-submit-button");
    await expect(page.locator("#login-error-message")).toBeVisible();

    // Valid attempt
    await page.fill("#access-key-input", TEST_KEY);
    await page.click("#login-submit-button");

    // Redirected to /chat
    await expect(page).toHaveURL(/\/chat/);
    await expect(page.locator("#chat-input")).toBeVisible();
  });

  test("3. Chat interface sends message and renders response", async ({ page }) => {
    // Authenticate first
    await page.goto("/login");
    await page.fill("#access-key-input", TEST_KEY);
    await page.click("#login-submit-button");
    await expect(page).toHaveURL(/\/chat/);

    // Mock the backend chat stream
    await page.route("**/api/proxy/chat/stream", async (route) => {
      const sseBody = [
        `event: RUN_STARTED\ndata: {"run_id":"run_smoke_123"}\n\n`,
        `event: TEXT_MESSAGE_CHUNK\ndata: {"content":"ARGUS status normal. Chief of staff ready."}\n\n`,
        `event: RUN_FINISHED\ndata: {"run_id":"run_smoke_123","status":"completed"}\n\n`,
      ].join("");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseBody,
      });
    });

    await page.fill("#chat-input", "Status report");
    await page.click("#chat-send-button");

    // Verify response rendered in feed
    await expect(page.locator("#chat-messages-container")).toContainText("ARGUS status normal. Chief of staff ready.");
  });

  test("4. Approvals Inbox allows approving an outbound draft", async ({ page }) => {
    // Authenticate first
    await page.goto("/login");
    await page.fill("#access-key-input", TEST_KEY);
    await page.click("#login-submit-button");

    // Mock approvals API
    await page.route("**/api/proxy/approvals?status=pending", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "draft_smoke_1",
            target_jid: "919876543210@s.whatsapp.net",
            contact_name: "Dr. Evelyn Reed",
            draft_text: "Confirmed for the 3pm sync tomorrow.",
            content_sha256: "abc123sha",
            trigger_type: "autopilot",
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            status: "pending",
          },
        ]),
      });
    });

    await page.route("**/api/proxy/approvals/draft_smoke_1/action", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          id: "draft_smoke_1",
          verdict: "approved",
          target_jid: "919876543210@s.whatsapp.net",
          final_text: "Confirmed for the 3pm sync tomorrow.",
        }),
      });
    });

    await page.goto("/approvals");
    await expect(page.locator("#approval-item-draft_smoke_1")).toBeVisible();
    await expect(page.locator("#approval-item-draft_smoke_1")).toContainText("Dr. Evelyn Reed");
    await expect(page.locator("#approval-item-draft_smoke_1")).toContainText("Confirmed for the 3pm sync tomorrow.");

    // Click Approve
    await page.click("#approve-button-draft_smoke_1");

    // Verify feedback message
    await expect(page.locator("#approval-item-draft_smoke_1")).toContainText("approved and logged to immutable audit trail");
  });

  test("5. Zero Credential Leakage: Memory page has security guarantee and no secrets", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#access-key-input", TEST_KEY);
    await page.click("#login-submit-button");

    // Mock memory API
    await page.route("**/api/proxy/memory", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 101,
            fact_text: "Prefers morning syncs before 11am.",
            category: "preferences",
            entities: ["scheduling"],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/memory");
    await expect(page.locator("#zero-credential-security-banner")).toBeVisible();
    await expect(page.locator("#zero-credential-security-banner")).toContainText("Guaranteed Zero-Credential Exposure");

    // Verify page content does not contain sensitive credential keywords
    const content = await page.content();
    expect(content).not.toContain("AKIA");
    expect(content).not.toContain("password=");
    expect(content).not.toContain("vault_key=");
  });
});
