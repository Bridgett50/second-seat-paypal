/**
 * E3 reload acceptance: an edit made while an approve is held must not come
 * back as approved on a reloaded page. Playwright against the existing
 * config (SECOND_SEAT_TEST_MODE fake transport; no live model calls).
 * All meeting data below is made up.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { renderSessionPage } from "../dist/src/render.js";

const FAST_TEXT = "Please send the vendor report by Friday.";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Holds the RESPONSE of the first matching POST until release(); the request reaches the server. */
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

async function open(page: Page): Promise<string> {
  const resp = page.waitForResponse(
    (r) => r.url().endsWith("/api/session") && r.request().method() === "POST",
  );
  await page.goto("/session");
  return (await (await resp).json()).sessionId as string;
}

async function state(page: Page, id: string) {
  const res = await page.request.get(
    `/api/session/state?sessionId=${encodeURIComponent(id)}`,
  );
  expect(res.ok()).toBe(true);
  return res.json();
}

/** In-page barrier: a later fetch completes only after earlier response handlers ran. */
async function barrier(page: Page, id: string) {
  await page.evaluate(
    (sid) => fetch("/api/session/state?sessionId=" + sid).then((r) => r.text()),
    id,
  );
  await page.evaluate(() => Promise.resolve());
}

async function toReview(page: Page, text = FAST_TEXT) {
  await page.locator("#transcript-input").fill(text);
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
}

async function toApproved(page: Page, text = FAST_TEXT) {
  await toReview(page, text);
  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");
}

async function toDraft(page: Page) {
  await toApproved(page);
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#session-state")).toContainText("Completed", {
    timeout: 15000,
  });
  await expect(page.locator("#draft-text")).toBeEnabled();
}

test.describe.serial("E3 reload after held approval with edits", () => {
  test("E3-1: A->B->A under a held approval leaves the server unapproved so a reload keeps Copy disabled.", async ({
    page,
    context,
  }) => {
    const id = await open(page);
    await toDraft(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const draft = page.locator("#draft-text");
    const copy = page.locator("#btn-copy");
    await draft.fill("Reply A");
    const held = await holdPost(page, "/api/session/draft/approve");
    await page.locator("#btn-draft-approve").click();
    await held.hit;
    await draft.fill("Reply B");
    await draft.fill("Reply A");
    const delivered = page.waitForResponse((r) =>
      r.url().endsWith("/api/session/draft/approve"),
    );
    held.release();
    await delivered;
    await barrier(page, id);
    // WITHOUT advancing the clock (the 300 ms debounce never fires): the
    // server must already record the edited text as unapproved.
    const s = await state(page, id);
    expect(s.draft).toMatchObject({ text: "Reply A", approved: false });
    // Simulate the reload: render a fresh page from that server snapshot.
    const page2 = await context.newPage();
    await page2.setContent(renderSessionPage(s));
    await expect(page2.locator("#btn-copy")).toBeDisabled();
    await expect(copy).toBeDisabled();
    await page2.close();
  });

  test("E3-2 (positive control): a normal approve sends no reject and no 409.", async ({
    page,
  }) => {
    const id = await open(page);
    await toDraft(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const statuses: number[] = [];
    let rejectPosts = 0;
    page.on("response", (r) => {
      if (r.url().includes("/api/session/draft")) statuses.push(r.status());
    });
    page.on("request", (req) => {
      if (
        req.url().endsWith("/api/session/draft/reject") &&
        req.method() === "POST"
      )
        rejectPosts += 1;
    });
    await page.locator("#draft-text").fill("Reply C");
    await page.locator("#btn-draft-approve").click();
    await expect(page.locator("#btn-copy")).toBeEnabled();
    await barrier(page, id);
    const s = await state(page, id);
    expect(s.draft).toMatchObject({ text: "Reply C", approved: true });
    expect(statuses.filter((st) => st === 409)).toHaveLength(0);
    expect(rejectPosts).toBe(0);
  });
});
