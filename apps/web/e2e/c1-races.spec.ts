import { test, expect, type Page, type Route } from "@playwright/test";

const TEXT = "Please send the vendor report by Friday.";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Holds the RESPONSE of the first matching POST until release(); the request reaches the server. */
async function holdResponse(page: Page, path: string) {
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

async function open(page: Page): Promise<string> {
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/session") && r.request().method() === "POST");
  await page.goto("/session");
  return (await (await resp).json()).sessionId as string;
}
async function state(page: Page, id: string) {
  return (await page.request.get(`/api/session/state?sessionId=${encodeURIComponent(id)}`)).json();
}
/** In-page barrier: a later fetch completes only after earlier response handlers ran. */
async function barrier(page: Page, id: string) {
  await page.evaluate((sid) => fetch("/api/session/state?sessionId=" + sid).then((r) => r.text()), id);
  await page.evaluate(() => Promise.resolve());
}
async function toReview(page: Page) {
  await page.locator("#transcript-input").fill(TEXT);
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
}
async function toDraft(page: Page) {
  await toReview(page);
  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#draft-text")).toBeEnabled();
}

test.describe("C1 browser races", () => {
  test("C1-1 held draft-approve A released after edit to B does not restore A", async ({ page }) => {
    await page.clock.install();
    const id = await open(page);
    await toDraft(page);
    const draft = page.locator("#draft-text");
    await draft.fill("Reply A");
    const held = await holdResponse(page, "/api/session/draft/approve");
    await page.locator("#btn-draft-approve").click();
    await held.hit;
    await draft.fill("Reply B");
    await page.locator("h1").first().click(); // blur
    const delivered = page.waitForResponse((r) => r.url().endsWith("/api/session/draft/approve"));
    held.release();
    await delivered;
    await barrier(page, id);
    expect(await draft.inputValue()).toBe("Reply B");
    expect(await page.locator("#btn-copy").isDisabled()).toBe(true);
    await page.clock.runFor(400); // now let the debounce post B
    await barrier(page, id);
    const s = await state(page, id);
    expect(s.draft).toMatchObject({ text: "Reply B", approved: false });
    expect(await draft.inputValue()).toBe("Reply B");
    expect(await page.locator("#btn-copy").isDisabled()).toBe(true);
  });

  test("C1-2 held correction A released after preview edited to B creates no approval", async ({ page }) => {
    const id = await open(page);
    await toReview(page);
    const preview = page.locator("#redacted-text");
    await preview.fill("Corrected A text.");
    const held = await holdResponse(page, "/api/session/correct");
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
    const s = await state(page, id);
    expect(s.approved).toBe(false);
    expect(s.payload).toBeNull();
    expect(await preview.inputValue()).toBe("Corrected B text.");
  });

  test("C1-4 held invalidation released after blur keeps B, which can be corrected and approved", async ({ page }) => {
    const id = await open(page);
    await toReview(page);
    const preview = page.locator("#redacted-text");
    const held = await holdResponse(page, "/api/session/invalidate");
    await preview.fill("Preview B text.");
    await held.hit;
    await page.locator("h1").first().click(); // blur
    const delivered = page.waitForResponse((r) => r.url().endsWith("/api/session/invalidate"));
    held.release();
    await delivered;
    await barrier(page, id);
    expect(await preview.inputValue()).toBe("Preview B text.");
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    const s = await state(page, id);
    expect(s.approved).toBe(true);
    expect(s.redactedText).toBe("Preview B text.");
  });

  test("C1-9 positive control: paste to copy puts exactly the approved draft on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = await open(page);
    await toDraft(page);
    const draft = page.locator("#draft-text");
    await draft.fill("Thanks, sending Friday.");
    await page.locator("#btn-draft-approve").click();
    await expect(page.locator("#btn-copy")).toBeEnabled();
    await page.locator("#btn-copy").click();
    await expect(page.locator("#draft-note")).toContainText("Copied locally");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Thanks, sending Friday.");
    const s = await state(page, id);
    expect(s.draft).toMatchObject({ text: "Thanks, sending Friday.", approved: true });
  });
  test("C1-7 browser: unchecking Reviewed after draft approval disables Copy and revokes on the server", async ({ page }) => {
    const id = await open(page);
    await page.locator("#transcript-input").fill("You owe us this favor.\nPlease send the vendor report.");
    await page.locator("#btn-redact").click();
    await expect(page.locator("#session-state")).toContainText("Review required");
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    await page.locator("#btn-analyze").click();
    const box = page.locator(".pressure-review").first();
    const reviewed = page.waitForResponse((r) => r.url().endsWith("/api/session/pressure-review"));
    await box.check();
    await reviewed;
    expect((await state(page, id)).pressure.allReviewed).toBe(true);
    await page.locator("#draft-text").fill("Reply.");
    await page.locator("#btn-draft-approve").click();
    await expect(page.locator("#btn-copy")).toBeEnabled();
    const resp = page.waitForResponse((r) => r.url().endsWith("/api/session/pressure-review"));
    await page.locator(".pressure-review").first().uncheck();
    expect(await page.locator("#btn-copy").isDisabled()).toBe(true);
    await resp;
    const s = await state(page, id);
    expect(s.pressure.reviewed).toEqual([]);
    expect(s.draft.approved).toBe(false);
    await barrier(page, id);
    expect(await page.locator("#btn-copy").isDisabled()).toBe(true);
  });
});
