import { test, expect } from "@playwright/test";

const DEMO = "/briefs/demo";

test("citation click jumps to the segment and shows it", async ({ page }) => {
  await page.goto(DEMO);
  const link = page.locator('.entry .citations a[href^="#seg-"]').first();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  await link.click();
  expect(page.url()).toContain(href as string);
  await expect(page.locator(`[id="${(href as string).slice(1)}"]`)).toBeVisible();
});

test("no image-upload or live-call controls (text-only core flow)", async ({
  page,
}) => {
  await page.goto(DEMO);
  await expect(page.locator("#upload-png")).toHaveCount(0);
  await expect(page.locator('input[accept=".png,image/png"]')).toHaveCount(0);
  await expect(page.locator("#live-call-btn")).toHaveCount(0);
  await expect(page.getByText("Start live call")).toHaveCount(0);
});

test("pressure badge href targets an existing segment", async ({ page }) => {
  await page.goto(DEMO);
  const badges = page.locator("a.pressure-badge");
  expect(await badges.count()).toBeGreaterThan(0);
  for (const badge of await badges.all()) {
    const href = await badge.getAttribute("href");
    expect(href).toMatch(/^#seg-/);
    await expect(page.locator(`[id="${(href as string).slice(1)}"]`)).toHaveCount(1);
  }
});

test("copy gating: disabled until reviewed + approved, no requests fired", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(DEMO);
  const nonLocal = requests.filter(
    (u) => !u.startsWith("http://127.0.0.1:4173"),
  );
  expect(nonLocal).toEqual([]);

  const copy = page.locator("#btn-copy");
  await expect(copy).toBeDisabled();

  await page.locator(".pressure-review").first().check();
  await expect(copy).toBeDisabled();

  for (const box of await page.locator(".pressure-review").all()) {
    await box.check();
  }
  await expect(copy).toBeDisabled();

  const before = requests.length;
  await page.locator("#btn-approve").click();
  await expect(copy).toBeEnabled();

  await page.locator("#btn-copy").click();
  await expect(page.locator("#draft-note")).toContainText("Copied locally");
  expect(requests.length).toBe(before);
  expect(
    requests.filter((u) => !u.startsWith("http://127.0.0.1:4173")),
  ).toEqual([]);
});

test("page works offline after load", async ({ page, context }) => {
  await page.goto(DEMO);
  await expect(page.locator("#transcript-lines li").first()).toBeVisible();
  await context.setOffline(true);
  const link = page.locator('.entry .citations a[href^="#seg-"]').first();
  const href = await link.getAttribute("href");
  await link.click();
  expect(page.url()).toContain(href as string);
  for (const box of await page.locator(".pressure-review").all()) {
    await box.check();
  }
  await page.locator("#btn-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
});

test("loads with only localhost allowed on the network", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const blocked: string[] = [];
  await context.route("**", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:4173")) {
      void route.continue();
    } else {
      blocked.push(url);
      void route.abort();
    }
  });
  const page = await context.newPage();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(`http://127.0.0.1:4173${DEMO}`);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("#transcript-lines li").first()).toBeVisible();
  expect(blocked).toEqual([]);
  expect(
    requests.filter((u) => !u.startsWith("http://127.0.0.1:4173")),
  ).toEqual([]);
  await context.close();
});

const HERO_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 720, height: 1280 },
];

for (const vp of HERO_VIEWPORTS) {
  test(`hero above the fold at ${vp.width}x${vp.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await page.goto(`${DEMO}?static=1`);
    await expect(page.locator(".replay-label")).toContainText(
      "Replay of recorded brief",
    );
    for (const sel of ["#conflicts", "a.pressure-badge", "#draft-status"]) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box).not.toBeNull();
      expect((box as { y: number; height: number }).y + (box as { y: number; height: number }).height).toBeLessThanOrEqual(
        vp.height,
      );
    }
    const fitsWidth = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    );
    expect(fitsWidth).toBe(true);
    const chip = page.locator('[data-stage="glimmer-redact"]');
    await expect(chip).toHaveAttribute("data-status", "incomplete");
    await expect(chip).toContainText("glimmer-redact: incomplete");
  });
}

test("desktop screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${DEMO}?static=1`);
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({ path: "proof/desktop.png", fullPage: false });
});

test("mobile screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 1280 });
  await page.goto(`${DEMO}?static=1`);
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({ path: "proof/mobile-9x16.png", fullPage: false });
});

test("one badge per pressure id, held count matches checkboxes", async ({
  page,
}) => {
  await page.goto(`${DEMO}?static=1`);
  const badgeTexts = await page.locator("a.pressure-badge").allTextContents();
  expect(badgeTexts.length).toBeGreaterThan(0);
  expect(new Set(badgeTexts).size).toBe(badgeTexts.length);
  const boxCount = await page.locator(".pressure-review").count();
  expect(boxCount).toBe(badgeTexts.length);
  const status = await page.locator("#draft-status").textContent();
  const expected =
    boxCount === 1
      ? `Held: review the 1 pressure item first`
      : `Held: review the ${boxCount} pressure items first`;
  expect(status).toBe(expected);
});

test("scores and badges are consistent", async ({ page }) => {
  await page.goto(`${DEMO}?static=1`);
  await expect(page.locator("#scores-seeded")).toContainText("9/9");
  const chip = page.locator('[data-stage="glimmer-redact"]');
  await expect(chip).toContainText("incomplete");
  await expect(chip).not.toContainText("0/39");
  const badgeTexts = await page.locator("a.pressure-badge").allTextContents();
  expect(badgeTexts.length).toBeGreaterThan(0);
  expect(new Set(badgeTexts).size).toBe(badgeTexts.length);
  const status = await page.locator("#draft-status").textContent();
  const m = status?.match(/review the (\d+) pressure/);
  expect(m).not.toBeNull();
  expect(Number((m as RegExpMatchArray)[1])).toBe(badgeTexts.length);
});

test("draft approval: approve then copy copies the draft text exactly", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(DEMO);
  for (const box of await page.locator(".pressure-review").all()) {
    await box.check();
  }
  await page.locator("#btn-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
  await page.locator("#btn-copy").click();
  const draftValue = await page.locator("#draft-text").inputValue();
  const statusText = await page.locator("#draft-status").textContent();
  const pasted = await page.evaluate(() => navigator.clipboard.readText());
  expect(pasted).toBe(draftValue);
  expect(pasted).not.toBe(statusText);
});

test("draft approval: editing after approve disables Copy", async ({
  page,
}) => {
  await page.goto(DEMO);
  for (const box of await page.locator(".pressure-review").all()) {
    await box.check();
  }
  await page.locator("#btn-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
  const draftValue = await page.locator("#draft-text").inputValue();
  await page.locator("#draft-text").fill(`${draftValue} (edited)`);
  await expect(page.locator("#btn-copy")).toBeDisabled();
});

test("draft approval: Reject disables Copy", async ({ page }) => {
  await page.goto(DEMO);
  for (const box of await page.locator(".pressure-review").all()) {
    await box.check();
  }
  await page.locator("#btn-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
  await page.locator("#btn-reject").click();
  await expect(page.locator("#btn-copy")).toBeDisabled();
});

test("draft approval: changing meeting disables Copy", async ({ page }) => {
  await page.goto(DEMO);
  for (const box of await page.locator(".pressure-review").all()) {
    await box.check();
  }
  await page.locator("#btn-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
  await page.locator("#meeting-select").selectOption("");
  await expect(page.locator("#btn-copy")).toBeDisabled();
});

test("draft approval: blank zero-flag meeting approves and copies typed text", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(DEMO);
  await page.locator("#meeting-select").selectOption("");
  await page.locator("#draft-text").fill("Blank meeting reply, typed by hand.");
  await expect(page.locator("#btn-approve")).toBeEnabled();
  await page.locator("#btn-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
  await page.locator("#btn-copy").click();
  const pasted = await page.evaluate(() => navigator.clipboard.readText());
  expect(pasted).toBe("Blank meeting reply, typed by hand.");
});

test("draft has no send action", async ({ page }) => {
  await page.goto(DEMO);
  await expect(
    page.locator("#draft").getByRole("button", { name: /send/i }),
  ).toHaveCount(0);
});

test("Scores card visible above the fold at 1280x800", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${DEMO}?static=1`);
  const scores = page.locator("#scores");
  await expect(scores).toBeVisible();
  const box = await scores.boundingBox();
  expect(box).not.toBeNull();
  expect((box as { y: number; height: number }).y).toBeGreaterThanOrEqual(0);
  expect(
    (box as { y: number; height: number }).y +
      (box as { y: number; height: number }).height,
  ).toBeLessThanOrEqual(800);
  await expect(page.locator("#scores-glimmer")).toContainText(
    /Glimmer legacy entity disappearance \d+\/\d+/,
  );
});
