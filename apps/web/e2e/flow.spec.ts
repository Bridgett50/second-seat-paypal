import { expect, test, type Page } from "@playwright/test";

interface Outbound {
  blockedOutside: number;
  analyzerCalls: string[];
}

const PII_TRANSCRIPT =
  "Hi, this is Elena Vasquez. Can you deliver the report by Friday?\nCall me at 555-201-3344.";
const CLEAN_TRANSCRIPT = "The team will review the quarterly menu.";
const BASIC_TRANSCRIPT = "When will you deliver the vendor report?";

async function readOutbound(page: Page): Promise<Outbound> {
  const res = await page.request.get("/api/test/outbound");
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Outbound;
}

async function guardNetwork(page: Page): Promise<string[]> {
  const outside: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return route.continue();
    }
    outside.push(url.href);
    return route.abort();
  });
  return outside;
}

async function redactAndApprove(page: Page, text: string): Promise<void> {
  await page.goto("/session");
  await page.locator("#transcript-input").fill(text);
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");
}

test("pii flow: redact, approve, analyze, citation resolves", async ({ page }) => {
  const outside = await guardNetwork(page);
  const before = await readOutbound(page);
  await page.goto("/session");
  await page.locator("#transcript-input").fill(PII_TRANSCRIPT);
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  const redacted = await page.locator("#redacted-text").inputValue();
  expect(redacted).not.toContain("Elena Vasquez");
  expect(redacted).not.toContain("555-201-3344");
  await page.locator("#btn-approve").click();
  await expect(page.locator("#payload-panel")).toContainText("Prepared (not dispatched)");
  const payloadText = await page.locator("#payload-text").textContent();
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#payload-panel")).toContainText("Dispatched to");
  const after = await readOutbound(page);
  expect(after.blockedOutside - before.blockedOutside).toBe(0);
  expect(after.analyzerCalls.slice(before.analyzerCalls.length)).toEqual([payloadText]);
  const href = await page.locator("#results .result .citations a").first().getAttribute("href");
  expect(href).toMatch(/^#seg-/);
  await page.locator("#results .result .citations a").first().click();
  await expect(page.locator(`#segments ${href}`)).toHaveCount(1);
  expect(outside).toEqual([]);
});

test("briefs demo: review pressure, approve, copy exact draft", async ({ page, context }) => {
  const outside = await guardNetwork(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/briefs/demo?static=1");
  const boxes = page.locator(".pressure-review");
  const count = await boxes.count();
  for (let i = 0; i < count; i += 1) {
    await boxes.nth(i).check();
  }
  const draft = "Second Seat will confirm the delivery window tomorrow morning.";
  await page.locator("#draft-text").fill(draft);
  await page.locator("#btn-approve").click();
  await page.locator("#btn-copy").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(draft);
  expect(outside).toEqual([]);
});

test("malformed redactor output blocks without analyzer call", async ({ page }) => {
  const outside = await guardNetwork(page);
  const before = await readOutbound(page);
  await page.goto("/session");
  await page.locator("#transcript-input").fill("hello [[fault:malformed]] world");
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Blocked");
  const after = await readOutbound(page);
  expect(after.analyzerCalls.length - before.analyzerCalls.length).toBe(0);
  expect(outside).toEqual([]);
});

test("redaction timeout blocks without analyzer call", async ({ page }) => {
  const outside = await guardNetwork(page);
  const before = await readOutbound(page);
  await page.goto("/session");
  await page.locator("#transcript-input").fill("hello [[fault:timeout]] world");
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Blocked");
  await expect(page.locator("#session-state")).toContainText("timeout");
  const after = await readOutbound(page);
  expect(after.analyzerCalls.length - before.analyzerCalls.length).toBe(0);
  expect(outside).toEqual([]);
});

test("stale approval blocks analysis", async ({ page }) => {
  const outside = await guardNetwork(page);
  await redactAndApprove(page, BASIC_TRANSCRIPT);
  const before = await readOutbound(page);
  const expired = await page.request.post("/api/test/expire-approvals", { data: {} });
  expect(expired.ok()).toBeTruthy();
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#session-state")).toContainText("Blocked");
  await expect(page.locator("#session-state")).toContainText("stale");
  const after = await readOutbound(page);
  expect(after.analyzerCalls.length - before.analyzerCalls.length).toBe(0);
  expect(outside).toEqual([]);
});

test("changed input clears payload and disables analyze", async ({ page }) => {
  const outside = await guardNetwork(page);
  await redactAndApprove(page, BASIC_TRANSCRIPT);
  await expect(page.locator("#payload-panel")).toContainText("Prepared (not dispatched)");
  const before = await readOutbound(page);
  await page.locator("#transcript-input").fill("A completely different transcript line.");
  await expect(page.locator("#payload-panel")).toContainText("Not prepared yet");
  await expect(page.locator("#btn-analyze")).toBeDisabled();
  const after = await readOutbound(page);
  expect(after.analyzerCalls.length - before.analyzerCalls.length).toBe(0);
  expect(outside).toEqual([]);
});

test("clean transcript passes through and reports no findings", async ({ page }) => {
  const outside = await guardNetwork(page);
  const before = await readOutbound(page);
  await page.goto("/session");
  await page.locator("#transcript-input").fill(CLEAN_TRANSCRIPT);
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  await expect(page.locator("#redacted-text")).toHaveValue(CLEAN_TRANSCRIPT);
  await page.locator("#btn-approve").click();
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#results")).toContainText("No findings in the approved transcript.");
  const after = await readOutbound(page);
  expect(after.blockedOutside - before.blockedOutside).toBe(0);
  expect(after.analyzerCalls.slice(before.analyzerCalls.length)).toEqual([CLEAN_TRANSCRIPT]);
  expect(outside).toEqual([]);
});
