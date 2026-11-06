/**
 * B1 browser acceptance (docs/rescue-plan-b.md). Fake clock (page.clock) so
 * debounce timers never fire unless advanced; held routes act as deferred
 * responses. No waitForTimeout sleeps.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

async function outbound(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/test/outbound");
  return (await res.json()).analyzerCalls as string[];
}
async function state(page: Page, id: string) {
  const res = await page.request.get(`/api/session/state?sessionId=${encodeURIComponent(id)}`);
  return res.json();
}
/** Sentinel: a page-side fetch round trip so already-delivered responses' handlers have run. */
async function settle(page: Page) {
  await page.evaluate(() => fetch("/api/test/outbound").then((r) => r.json()).then(() => undefined));
}
async function open(page: Page): Promise<string> {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:00.001Z")); // timers fire only via runFor
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/session") && r.request().method() === "POST");
  await page.goto("/session");
  const id = (await (await resp).json()).sessionId as string;
  await expect(page.locator("#session-state")).toContainText("Input");
  return id;
}
async function approveFlow(page: Page, text: string) {
  await page.locator("#transcript-input").fill(text);
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");
}
async function toCopyReady(page: Page, text: string, reply: string) {
  await approveFlow(page, text);
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#session-state")).toContainText("Completed");
  await page.locator("#draft-text").fill(reply);
  await page.locator("#btn-draft-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
}
function hold(page: Page, pattern: string) {
  const held: Route[] = [];
  let hits = 0;
  const ready = new Promise<void>((res) => {
    void page.route(pattern, (route) => {
      hits += 1;
      held.push(route);
      res();
    });
  });
  return { held, ready, hits: () => hits };
}

test.describe.serial("B1 acceptance (browser)", () => {
  test("B1-1 raw edit before debounce: Analyze sends nothing", async ({ page }) => {
    const id = await open(page);
    await approveFlow(page, "When will you deliver the vendor report?");
    const before = (await outbound(page)).length;
    let analyzeHits = 0;
    await page.route("**/api/session/analyze", (r) => {
      analyzeHits += 1;
      return r.continue();
    });
    const inv = page.waitForResponse((r) => r.url().includes("/api/session/invalidate"));
    await page.locator("#transcript-input").fill("Something entirely different");
    await expect(page.locator("#btn-analyze")).toBeDisabled();
    await page.locator("#btn-analyze").click({ force: true });
    await inv; // server learned of the edit immediately, without the debounce firing
    const s = await state(page, id);
    expect(s.approved).toBe(false);
    expect(analyzeHits).toBe(0);
    expect((await outbound(page)).slice(before)).toEqual([]);
  });

  test("B1-2 preview edit: Analyze and Copy unavailable immediately", async ({ page }) => {
    const id = await open(page);
    await toCopyReady(page, "Is the $40 fee final?", "Reply A");
    const before = (await outbound(page)).length;
    const inv = page.waitForResponse((r) => r.url().includes("/api/session/invalidate"));
    await page.locator("#redacted-text").fill("Is the $40 fee final? edited");
    await expect(page.locator("#btn-analyze")).toBeDisabled();
    await expect(page.locator("#btn-copy")).toBeDisabled();
    await expect(page.locator("#empty-state")).toBeVisible();
    await page.locator("#btn-analyze").click({ force: true });
    await inv;
    const s = await state(page, id);
    expect([s.approved, s.result, s.draft]).toEqual([false, null, null]);
    expect((await outbound(page)).slice(before)).toEqual([]);
  });

  test("B1-3 clearing raw input or preview invalidates approval, findings, draft", async ({ page }) => {
    const id = await open(page);
    await toCopyReady(page, "Is the $40 fee final?", "Reply A");
    const inv = page.waitForResponse((r) => r.url().includes("/api/session/invalidate"));
    await page.locator("#redacted-text").fill("");
    await inv;
    await expect(page.locator("#btn-copy")).toBeDisabled();
    let s = await state(page, id);
    expect([s.approved, s.result, s.draft]).toEqual([false, null, null]);

    await page.locator("#btn-redact").click();
    await expect(page.locator("#session-state")).toContainText("Review required");
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    const inv2 = page.waitForResponse((r) => r.url().includes("/api/session/invalidate"));
    await page.locator("#transcript-input").fill("");
    await inv2;
    s = await state(page, id);
    expect([s.approved, s.result, s.draft]).toEqual([false, null, null]);
    await expect(page.locator("#btn-analyze")).toBeDisabled();
  });

  test("B1-4 held draft-approval response resolved after edit cannot enable Copy", async ({ page }) => {
    const id = await open(page);
    await approveFlow(page, "Is the $40 fee final?");
    await page.locator("#btn-analyze").click();
    await expect(page.locator("#session-state")).toContainText("Completed");
    await page.locator("#draft-text").fill("Reply A");
    const h = hold(page, "**/api/session/draft/approve");
    await page.locator("#btn-draft-approve").click();
    await h.ready;
    // Server processes the approval NOW (pre-edit); only delivery to the page is held.
    const served = await h.held[0]!.fetch();
    const servedBody = await served.json();
    expect(servedBody.draft?.approved).toBe(true);
    const inv = page.waitForResponse((r) => r.url().includes("/api/session/invalidate"));
    await page.locator("#transcript-input").fill("A new meeting text");
    await inv;
    await expect(page.locator("#session-state")).toContainText("Input"); // page has rendered the invalidation
    const late = page.waitForResponse((r) => r.url().includes("/api/session/draft/approve"));
    await h.held[0]!.fulfill({ response: served, json: servedBody });
    await late;
    await settle(page);
    await expect(page.locator("#btn-copy")).toBeDisabled();
    await expect(page.locator("#btn-analyze")).toBeDisabled();
    await expect(page.locator("#draft-status")).not.toContainText("Approved");
    const s = await state(page, id);
    expect(s.draft).toBeNull();
    await page.clock.runFor(1000); // now let the debounce fire
    await expect.poll(async () => (await state(page, id)).state).toBe("input");
    await expect(page.locator("#btn-copy")).toBeDisabled();
  });

  test("B1-5 held analysis A resolved after preview edit B is not shown", async ({ page }) => {
    const id = await open(page);
    await approveFlow(page, "Is the $40 fee final?");
    const h = hold(page, "**/api/session/analyze");
    await page.locator("#btn-analyze").click();
    await h.ready;
    const served = await h.held[0]!.fetch();
    const servedBody = await served.json();
    expect(servedBody.result?.entries?.length).toBeGreaterThan(0);
    const inv = page.waitForResponse((r) => r.url().includes("/api/session/invalidate"));
    await page.locator("#redacted-text").fill("Preview B text");
    await inv;
    await expect(page.locator("#session-state")).toContainText("Review required");
    const late = page.waitForResponse((r) => r.url().includes("/api/session/analyze"));
    await h.held[0]!.fulfill({ response: served, json: servedBody });
    await late;
    await settle(page);
    await expect(page.locator("#results .result")).toHaveCount(0);
    await expect(page.locator("#btn-copy")).toBeDisabled();
    const s = await state(page, id);
    expect(s.result).toBeNull();
  });

  test("B1-7 correction recovery: findings clear, reapprove, re-analyze, new draft", async ({ page }) => {
    const id = await open(page);
    await toCopyReady(page, "Is the $40 fee final?", "Reply A");
    await expect(page.locator("#results .result")).toHaveCount(1);
    await page.locator("#redacted-text").fill("Corrected: is the $90 fee final?");
    await expect(page.locator("#results .result")).toHaveCount(0);
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    await page.locator("#btn-analyze").click();
    await expect(page.locator("#session-state")).toContainText("Completed");
    await expect(page.locator("#results .result")).toContainText("Corrected: is the $90 fee final?");
    await page.locator("#draft-text").fill("Reply B");
    await page.locator("#btn-draft-approve").click();
    await expect(page.locator("#btn-copy")).toBeEnabled();
    const s = await state(page, id);
    expect(s.draft.text).toBe("Reply B");
    expect(s.payload.approvedText).toBe("Corrected: is the $90 fee final?");
  });

  test("B1-9 positive control: unedited journey reaches Copy", async ({ page }) => {
    await open(page);
    await toCopyReady(page, "Is the $40 fee final?", "Reply A");
    await expect(page.locator("#btn-copy")).toBeEnabled();
  });
});
