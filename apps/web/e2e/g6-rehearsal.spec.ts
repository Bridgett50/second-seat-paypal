import { test, expect, type Page, type Route } from "@playwright/test";

const SLOW = "[[slow]]";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

async function holdPost(page: Page, path: string) {
  const gate = deferred();
  const hit = deferred();
  let used = false;
  await page.route(`**${path}`, async (route: Route) => {
    if (used || route.request().method() !== "POST") return route.continue();
    used = true;
    const response = await route.fetch();
    hit.resolve();
    await gate.promise;
    await route.fulfill({ response });
  });
  return { hit: hit.promise, release: gate.resolve };
}

async function holdPreflight(page: Page, path: string) {
  const gate = deferred();
  const hit = deferred();
  let used = false;
  await page.route(`**${path}`, async (route: Route) => {
    if (used || route.request().method() !== "POST") return route.continue();
    used = true;
    hit.resolve();
    await gate.promise;
    await route.continue();
  });
  return { hit: hit.promise, release: gate.resolve };
}

async function open(page: Page): Promise<string> {
  const resp = page.waitForResponse(
    (r) => r.url().endsWith("/api/session") && r.request().method() === "POST",
  );
  await page.goto("/session");
  return (await (await resp).json()).sessionId as string;
}

async function state(page: Page, id: string) {
  const res = await page.request.get(`/api/session/state?sessionId=${encodeURIComponent(id)}`);
  expect(res.ok()).toBe(true);
  return res.json();
}

async function outbound(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/test/outbound");
  expect(res.ok()).toBe(true);
  return ((await res.json()).analyzerCalls ?? []) as string[];
}

async function barrier(page: Page, id: string) {
  await page.evaluate((sid) => fetch("/api/session/state?sessionId=" + sid).then((r) => r.text()), id);
  await page.evaluate(() => Promise.resolve());
}

async function completed(page: Page) {
  await expect(page.locator("#session-state")).toContainText("Completed", { timeout: 15000 });
}

async function toReview(page: Page, text: string) {
  await page.locator("#transcript-input").fill(text);
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
}

async function toApproved(page: Page, text: string) {
  await toReview(page, text);
  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");
}

async function reviewAllPressure(page: Page) {
  const boxes = page.locator(".pressure-review");
  const n = await boxes.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i += 1) {
    const done = page.waitForResponse((r) => r.url().endsWith("/api/session/pressure-review"));
    await boxes.nth(i).check();
    await done;
  }
}

async function flagFalse(page: Page, id: string) {
  await expect.poll(async () => (await state(page, id)).draft.approved, { timeout: 10000 }).toBe(false);
}

async function flagOnly(page: Page, id: string, text: string) {
  expect(await page.locator("#draft-text").inputValue()).toBe(text);
  await expect(page.locator("#btn-copy")).toBeDisabled();
  await flagFalse(page, id);
}

async function fullUnapproved(page: Page, id: string, text: string) {
  expect(await page.locator("#draft-text").inputValue()).toBe(text);
  await expect(page.locator("#btn-copy")).toBeDisabled();
  await expect.poll(async () => (await state(page, id)).draft, { timeout: 10000 }).toMatchObject({ text, approved: false });
}

async function draftRound(page: Page, id: string, edit: () => Promise<void>, text: string) {
  const draft = page.locator("#draft-text");
  const held = await holdPost(page, "/api/session/draft/approve");
  await page.locator("#btn-draft-approve").click();
  await held.hit;
  await edit();
  await draft.evaluate((e) => e.blur());
  await flagOnly(page, id, text);
  const delivered = page.waitForResponse((r) => r.url().endsWith("/api/session/draft/approve"));
  held.release();
  await delivered;
  await barrier(page, id);
  await flagOnly(page, id, text);
  await page.clock.runFor(400);
  await barrier(page, id);
  await fullUnapproved(page, id, text);
}

test.describe.serial("G6 rehearsal guards", () => {
  test("G6-1g", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    const before = await outbound(page);
    const CORRECTED = "Please send the vendor report by Friday.\nYou owe us this favor, please confirm the final delivery date.";
    const DRAFT = "Thanks for the update - confirmed for Friday.\nSecond Seat will confirm the delivery window tomorrow morning.";
    await toReview(page, "Hi, this is Quinn Harper. Please send the vendor report by Friday.\nCall me at 555-014-2233.\nYou owe us this favor, please confirm the delivery date.");
    const preview = await page.locator("#redacted-text").inputValue();
    expect(preview).not.toContain("555-014-2233");
    expect(preview).not.toContain("Quinn Harper");
    await page.locator("#redacted-text").fill(CORRECTED);
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    const approvedText = await page.locator("#redacted-text").inputValue();
    expect(approvedText).toBe(CORRECTED);
    await page.locator("#btn-analyze").click();
    await completed(page);
    await reviewAllPressure(page);
    await expect(page.locator("#btn-copy")).toBeDisabled();
    await page.locator("#draft-text").fill(DRAFT);
    await page.locator("#btn-draft-approve").click();
    await expect(page.locator("#btn-copy")).toBeEnabled();
    expect(await page.locator("#draft-text").inputValue()).toBe(DRAFT);
    await page.locator("#btn-copy").click();
    await expect(page.locator("#draft-note")).toContainText("Copied locally. Nothing was sent.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(DRAFT);
    expect((await outbound(page)).slice(before.length)).toEqual([approvedText]);
    expect(approvedText).not.toContain("555-014-2233");
  });

  test("G6-2g", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = await open(page);
    await toApproved(page, "Please send the vendor report by Friday.");
    await page.locator("#btn-analyze").click();
    await completed(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const draft = page.locator("#draft-text");
    const copy = page.locator("#btn-copy");
    await draft.fill("Reply A");
    await draftRound(page, id, () => draft.fill("Reply B"), "Reply B");
    await draft.fill("Reply A");
    await draftRound(page, id, async () => { await draft.fill("Reply B"); await draft.fill("Reply A"); }, "Reply A");
    await draftRound(page, id, async () => { await draft.fill(""); await draft.fill("Reply A"); }, "Reply A");
    await page.locator("#btn-draft-approve").click();
    await expect(copy).toBeEnabled();
    await copy.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Reply A");
  });

  test("G6-3g", async ({ page }) => {
    const id = await open(page);
    await toReview(page, "When will you deliver the vendor report?");
    const preview = page.locator("#redacted-text");
    await preview.fill("Corrected A text.");
    const held = await holdPost(page, "/api/session/correct");
    let approvePosts = 0;
    await page.route("**/api/session/approve", async (route: Route) => { approvePosts += 1; await route.continue(); });
    await page.locator("#btn-approve").click();
    await held.hit;
    const inval = page.waitForResponse((r) => r.url().endsWith("/api/session/invalidate"));
    await preview.fill("Corrected B text.");
    await inval;
    const delivered = page.waitForResponse((r) => r.url().endsWith("/api/session/correct"));
    held.release();
    await delivered;
    await barrier(page, id);
    await barrier(page, id);
    expect(approvePosts).toBe(0);
    expect(await preview.inputValue()).toBe("Corrected B text.");
    expect((await state(page, id)).approved).toBe(false);
    const A = "Status meeting with Rivera Co.\nYou owe us this favor. Please confirm the vendor report date.";
    const B = "Renewal call\nThis is the last chance, the discount expires tonight\nCan we keep net-45 terms?";
    await toApproved(page, A);
    await page.locator("#btn-analyze").click();
    await completed(page);
    const sA = await state(page, id);
    const assessmentA = sA.pressure.assessmentId as string;
    expect(sA.pressure.items.length).toBeGreaterThan(0);
    await toApproved(page, B);
    await page.locator("#btn-analyze").click();
    await completed(page);
    const sB = await state(page, id);
    expect(sB.pressure.assessmentId).not.toBe(assessmentA);
    const stale = await page.request.post("/api/session/pressure-review", {
      data: { sessionId: id, itemId: sB.pressure.items[0].id as string, expectedRevision: sB.revision, assessmentId: assessmentA, reviewed: true },
    });
    expect(stale.status()).toBe(409);
    const afterStale = await state(page, id);
    expect(afterStale.pressure.assessmentId).toBe(sB.pressure.assessmentId);
    expect(afterStale.pressure.reviewed).toEqual([]);
    expect(afterStale.pressure.allReviewed).toBe(false);
    const checked = page.waitForResponse((r) => r.url().endsWith("/api/session/pressure-review"));
    await page.locator(".pressure-review").first().check();
    await checked;
    await page.locator("#draft-text").fill("Reply.");
    await page.locator("#btn-draft-approve").click();
    await expect(page.locator("#btn-copy")).toBeEnabled();
    const unchecked = page.waitForResponse((r) => r.url().endsWith("/api/session/pressure-review"));
    await page.locator(".pressure-review").first().uncheck();
    await expect(page.locator("#btn-copy")).toBeDisabled();
    await unchecked;
    const s = await state(page, id);
    expect(s.pressure.reviewed).toEqual([]);
    expect(s.draft.approved).toBe(false);
    await barrier(page, id);
    await expect(page.locator("#btn-copy")).toBeDisabled();
  });

  test("G6-4g", async ({ page }) => {
    const id = await open(page);
    await toReview(page, "Please send the vendor report by Friday.");
    await page.locator("#redacted-text").fill(`Please send the vendor report by Friday. ${SLOW}`);
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    await expect(page.locator("#payload-status")).toContainText("Prepared (not dispatched)");
    expect((await state(page, id)).payload.status).toBe("prepared");
    expect((await state(page, id)).receipts).toEqual([]);
    const preflight = await holdPreflight(page, "/api/session/analyze");
    const analyzed = page.waitForResponse((r) => r.url().endsWith("/api/session/analyze"));
    await page.locator("#btn-analyze").click();
    await preflight.hit;
    await expect.poll(async () => (await state(page, id)).payload, { timeout: 10000 }).toMatchObject({ status: "prepared" });
    expect((await state(page, id)).receipts).toEqual([]);
    await expect(page.locator("#payload-status")).toContainText("Prepared (not dispatched)");
    preflight.release();
    await expect(page.locator("#payload-status")).toContainText("— outcome pending", { timeout: 10000 });
    const pendingText = (await page.locator("#payload-status").textContent()) ?? "";
    expect(pendingText).toContain("Transport invoked at");
    const t1 = /Transport invoked at (.+?) — outcome pending/.exec(pendingText)?.[1];
    expect(t1).toBeTruthy();
    expect(Number.isFinite(Date.parse(t1!))).toBe(true);
    await analyzed;
    await completed(page);
    await expect(page.locator("#payload-panel")).toContainText("Dispatched to");
    const expired = await page.request.post("/api/test/expire-approvals", { data: {} });
    expect(expired.ok()).toBe(true);
    await page.locator("#btn-analyze").click();
    await expect(page.locator("#session-state")).toContainText("Blocked", { timeout: 15000 });
    await expect(page.locator("#payload-status")).toContainText("failed or unknown outcome");
    const failedText = (await page.locator("#payload-panel").textContent()) ?? "";
    expect(failedText).not.toContain("nothing was sent");
    expect(failedText).not.toContain("Not prepared");
  });
});
