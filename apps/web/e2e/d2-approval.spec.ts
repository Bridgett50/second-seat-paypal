/**
 * D2 browser acceptance: draft intent invalidation and the active receipt
 * panel. Playwright against the existing config (SECOND_SEAT_TEST_MODE fake
 * transport; no live model calls). All meeting data below is made up.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

const FAST_TEXT = "Please send the vendor report by Friday.";
const FAST_PRESSURE_TEXT =
  "You owe us this favor. Please confirm the vendor report date.";
const SLOW_TEXT = "Please send the vendor report by Friday. [[slow]]";
const SLOW_PRESSURE_TEXT =
  "You owe us this favor. Please confirm the vendor report date. [[slow]]";

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

/** Holds the RESPONSE of the first in-page GET state poll until release(); the request reaches the server. */
async function holdGet(page: Page) {
  const gate = deferred();
  const hit = deferred();
  let used = false;
  await page.route(
    (url) => url.pathname === "/api/session/state",
    async (route: Route) => {
      if (used || route.request().method() !== "GET") return route.continue();
      used = true;
      const response = await route.fetch();
      hit.resolve();
      await gate.promise;
      await route.fulfill({ response });
    },
  );
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

async function outbound(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/test/outbound");
  expect(res.ok()).toBe(true);
  return ((await res.json()).analyzerCalls ?? []) as string[];
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

test.describe.serial("D2 draft invalidation and receipt panel", () => {
  test("D2-1: paused-clock A→B held approval keeps B and disables Copy (page.clock paused; approval response held while draft edited A→B).", async ({
    page,
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
    await draft.evaluate((e) => e.blur());
    // Local invalidation is synchronous: B kept, Copy disabled.
    expect(await draft.inputValue()).toBe("Reply B");
    await expect(copy).toBeDisabled();
    await expect(page.locator("#draft-status")).not.toContainText(
      "Approved — ready to copy.",
    );
    // The edit revoked the server approval immediately while the text sync is still debounced (text stays "Reply A").
    await expect
      .poll(
        async () => (await state(page, id)).draft,
        { timeout: 10000 },
      )
      .toMatchObject({ text: "Reply A", approved: false });
    const delivered = page.waitForResponse((r) =>
      r.url().endsWith("/api/session/draft/approve"),
    );
    held.release();
    await delivered;
    await barrier(page, id);
    // The stale approval for A must not re-enable Copy for B.
    expect(await draft.inputValue()).toBe("Reply B");
    await expect(copy).toBeDisabled();
    await expect(page.locator("#draft-status")).not.toContainText(
      "Approved — ready to copy.",
    );
    await page.clock.runFor(400); // now let the debounce post B
    await barrier(page, id);
    await expect
      .poll(
        async () => (await state(page, id)).draft,
        { timeout: 10000 },
      )
      .toMatchObject({ text: "Reply B", approved: false });
    expect(await draft.inputValue()).toBe("Reply B");
    await expect(copy).toBeDisabled();
  });

  test("D2-2: A→B→A and A→empty→A stay unapproved until a new click (held approval + paused clock; then Copy writes exact bytes).", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = await open(page);
    await toDraft(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const draft = page.locator("#draft-text");
    const copy = page.locator("#btn-copy");
    const status = page.locator("#draft-status");

    // Round 1: A→B→A under a held approval for A.
    await draft.fill("Reply A");
    const held1 = await holdPost(page, "/api/session/draft/approve");
    await page.locator("#btn-draft-approve").click();
    await held1.hit;
    await draft.fill("Reply B");
    await draft.fill("Reply A");
    await draft.evaluate((e) => e.blur());
    expect(await draft.inputValue()).toBe("Reply A");
    await expect(copy).toBeDisabled();
    // The edit revoked the server approval immediately while the text sync is still debounced (text stays "Reply A").
    await expect
      .poll(
        async () => (await state(page, id)).draft,
        { timeout: 10000 },
      )
      .toMatchObject({ text: "Reply A", approved: false });
    const delivered1 = page.waitForResponse((r) =>
      r.url().endsWith("/api/session/draft/approve"),
    );
    held1.release();
    await delivered1;
    await barrier(page, id);
    // Returning to A must not restore the stale approval.
    expect(await draft.inputValue()).toBe("Reply A");
    await expect(copy).toBeDisabled();
    await expect(status).not.toContainText("Approved — ready to copy.");
    await page.clock.runFor(400); // flush the A edit
    await barrier(page, id);
    await expect
      .poll(
        async () => (await state(page, id)).draft,
        { timeout: 10000 },
      )
      .toMatchObject({ text: "Reply A", approved: false });

    // Re-approve the returned-to text, then round 2: A→empty→A held.
    await page.locator("#btn-draft-approve").click();
    await expect(copy).toBeEnabled();
    const held2 = await holdPost(page, "/api/session/draft/approve");
    await page.locator("#btn-draft-approve").click();
    await held2.hit;
    await draft.fill("");
    await draft.fill("Reply A");
    await draft.evaluate((e) => e.blur());
    expect(await draft.inputValue()).toBe("Reply A");
    await expect(copy).toBeDisabled();
    const delivered2 = page.waitForResponse((r) =>
      r.url().endsWith("/api/session/draft/approve"),
    );
    held2.release();
    await delivered2;
    await barrier(page, id);
    expect(await draft.inputValue()).toBe("Reply A");
    await expect(copy).toBeDisabled();
    await expect(status).not.toContainText("Approved — ready to copy.");
    await page.clock.runFor(400); // flush the A edit
    await barrier(page, id);
    await expect
      .poll(
        async () => (await state(page, id)).draft,
        { timeout: 10000 },
      )
      .toMatchObject({ text: "Reply A", approved: false });

    // Positive control: a fresh click enables Copy and writes exact bytes.
    await page.locator("#btn-draft-approve").click();
    await expect(copy).toBeEnabled();
    expect(await draft.inputValue()).toBe("Reply A");
    await copy.click();
    await expect(page.locator("#draft-note")).toContainText(
      "Copied locally. Nothing was sent.",
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "Reply A",
    );
  });

  test("D2-3: held /correct A followed by B emits zero stale approve requests and server stays unapproved.", async ({
    page,
  }) => {
    const id = await open(page);
    await toReview(page, "When will you deliver the vendor report?");
    const preview = page.locator("#redacted-text");
    await preview.fill("Corrected A text.");
    const held = await holdPost(page, "/api/session/correct");
    let approvePosts = 0;
    await page.route(
      "**/api/session/approve",
      async (route: Route) => {
        approvePosts += 1;
        await route.continue();
      },
    );
    await page.locator("#btn-approve").click();
    await held.hit;
    const inval = page.waitForResponse((r) =>
      r.url().endsWith("/api/session/invalidate"),
    );
    await preview.fill("Corrected B text.");
    await inval;
    const delivered = page.waitForResponse((r) =>
      r.url().endsWith("/api/session/correct"),
    );
    held.release();
    await delivered;
    await barrier(page, id);
    await barrier(page, id);
    expect(approvePosts).toBe(0);
    expect(await preview.inputValue()).toBe("Corrected B text.");
    const s = await state(page, id);
    expect(s.approved).toBe(false);
    expect(s.payload).toBeNull();
  });

  test("D2-4: after a real fake-fetch invocation, the existing page shows invoked/pending with t1 before provider completion, without manual reload.", async ({
    page,
  }) => {
    await open(page);
    await toReview(page, FAST_TEXT);
    await page.locator("#redacted-text").fill(SLOW_TEXT);
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    const analyzed = page.waitForResponse((r) =>
      r.url().endsWith("/api/session/analyze"),
    );
    await page.locator("#btn-analyze").click();
    // The active receipt panel updates on its own: no page.reload() anywhere
    // in this test. The fake transport takes ~1.5s; the poll below resolves
    // in well under a second via the entry-invoked receipt.
    await expect(page.locator("#payload-status")).toContainText(
      "— outcome pending",
      { timeout: 10000 },
    );
    const pendingText =
      (await page.locator("#payload-status").textContent()) ?? "";
    const match = /Transport invoked at (.+?) — outcome pending/.exec(
      pendingText,
    );
    expect(match?.[1]).toBeTruthy();
    expect(Number.isFinite(Date.parse(match![1]!))).toBe(true);
    await analyzed;
    await expect(page.locator("#session-state")).toContainText("Completed", {
      timeout: 15000,
    });
    await expect(page.locator("#payload-panel")).toContainText(
      "Dispatched to",
    );
  });

  test("D2-5: edit while a state refresh is held; its response cannot restore result, draft, pressure review, or approval.", async ({
    page,
  }) => {
    const id = await open(page);
    await toReview(page, FAST_PRESSURE_TEXT);
    await page.locator("#redacted-text").fill(SLOW_PRESSURE_TEXT);
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    await page.locator("#btn-analyze").click();
    await expect(page.locator("#session-state")).toContainText("Completed", {
      timeout: 15000,
    });
    const box = page.locator(".pressure-review").first();
    await expect(box).toBeVisible();
    const reviewed = page.waitForResponse((r) =>
      r.url().endsWith("/api/session/pressure-review"),
    );
    await box.check();
    await reviewed;
    await page.locator("#draft-text").fill("Reply one.");
    await page.locator("#btn-draft-approve").click();
    await expect(page.locator("#btn-copy")).toBeEnabled();

    // Hold the receipt panel's own refresh, then edit underneath it.
    const n0 = (await outbound(page)).length;
    const held = await holdGet(page);
    await page.locator("#btn-analyze").click(); // second run: pending, prior work still shown
    await expect(page.locator("#session-state")).toContainText(
      "Analysis pending",
    );
    await held.hit;
    const inval = page.waitForResponse((r) =>
      r.url().endsWith("/api/session/invalidate"),
    );
    await page.locator("#transcript-input").fill("Something entirely different.");
    await inval;
    const delivered = page.waitForResponse(
      (r) =>
        r.url().includes("/api/session/state") &&
        r.request().method() === "GET",
    );
    held.release();
    await delivered;
    await barrier(page, id);
    await barrier(page, id);
    await expect(page.locator("#results")).toContainText(
      "No findings yet — paste a transcript and run analysis.",
    );
    await expect(page.locator("#draft")).toBeHidden();
    expect(await page.locator("#pressure").count()).toBe(0);
    expect(await page.locator("#btn-copy").isDisabled()).toBe(true);
    const s = await state(page, id);
    expect(s.result).toBeNull();
    expect(s.draft).toBeNull();
    expect(s.approved).toBe(false);
    expect(s.redactedText).toBe("");
    // Settle the second (slow) analysis before finishing: the fake transport
    // records the analyzer call ~1.5s after dispatch, after this test would
    // otherwise end. The outbound log is global to the one-worker e2e server,
    // so an unsettled call leaks into the next spec file's exact-delta
    // assertions (e.g. flow.spec.ts "pii flow").
    await expect
      .poll(async () => (await outbound(page)).slice(n0), { timeout: 20000 })
      .toContain(SLOW_PRESSURE_TEXT);
  });

  test("D2-6: one complete paste→redact→correct→approve→analyze→review→edit→approve→copy test asserting exact clipboard bytes and expected fake transport bodies.", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    const before = await outbound(page);
    const TRANSCRIPT =
      "When will you deliver the vendor report?\nYou owe us this favor, please confirm the delivery date.";
    const CORRECTED =
      "When will you deliver the vendor report?\nYou owe us this favor, please confirm the final delivery date.";
    const DRAFT = "Thanks for the update - confirmed for Friday.";

    // Paste, redact, correct the preview, approve the corrected text.
    await page.locator("#transcript-input").fill(TRANSCRIPT);
    await page.locator("#btn-redact").click();
    await expect(page.locator("#session-state")).toContainText(
      "Review required",
    );
    await page.locator("#redacted-text").fill(CORRECTED);
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    const approvedText = await page.locator("#redacted-text").inputValue();
    expect(approvedText).toBe(CORRECTED);

    // Analyze, then review the pressure flag.
    await page.locator("#btn-analyze").click();
    await expect(page.locator("#session-state")).toContainText("Completed");
    const box = page.locator(".pressure-review").first();
    await expect(box).toBeVisible();
    const reviewed = page.waitForResponse((r) =>
      r.url().endsWith("/api/session/pressure-review"),
    );
    await box.check();
    await reviewed;

    // Edit the draft, approve the exact text, copy it.
    await expect(page.locator("#btn-copy")).toBeDisabled();
    await page.locator("#draft-text").fill(DRAFT);
    await page.locator("#btn-draft-approve").click();
    await expect(page.locator("#btn-copy")).toBeEnabled();
    expect(await page.locator("#draft-text").inputValue()).toBe(DRAFT);
    await page.locator("#btn-copy").click();
    await expect(page.locator("#draft-note")).toContainText(
      "Copied locally. Nothing was sent.",
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      DRAFT,
    );

    // The fake transport saw exactly the approved text, once.
    expect((await outbound(page)).slice(before.length)).toEqual([
      approvedText,
    ]);
  });
});
