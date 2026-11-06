import { expect, test, type Page } from "@playwright/test";

// Collect browser console errors and uncaught page errors for one page.
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// The page is server-rendered: wait until a full guide round-trip works
// (the Guide button's handler clears the input on success) so no
// server-rendered element can appear late.
async function waitForReady(page: Page): Promise<void> {
  const input = page.locator("#guidance-input");
  await expect(async () => {
    await input.fill("ready probe");
    await page.locator("#guidance-send").click();
    await expect(input).toHaveValue("", { timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
}

test("C1-demo-flow-completes-all-nine-steps", async ({ page }) => {
  await page.goto("/meeting-room?demo=1");
  const next = page.locator("#demo-next");
  await expect(next).toBeEnabled();
  for (let i = 1; i <= 9; i++) {
    await expect(
      page.getByRole("status", { name: new RegExp(`^Demo step ${i} of 9`) }),
    ).toBeVisible();
    await next.click();
  }
  await expect(page.getByText("Demo complete")).toBeVisible();
  await expect(next).toBeDisabled();
  await expect(page.getByText("Approved: yes · Send: sent")).toBeVisible();
  await expect(page.getByText("Sent — package locked.", { exact: false })).toBeVisible();
  await expect(page.locator("#evidence-export")).toBeVisible();
});

test("C2-demo-page-loads-without-console-errors", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/meeting-room?demo=1");
  await expect(page.locator("#demo-next")).toBeEnabled();
  await page.locator("#demo-next").click();
  await expect(
    page.getByRole("status", { name: /^Demo step 2 of 9/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("C3-keyboard-shortcuts-advance-and-restart", async ({ page }) => {
  await page.goto("/meeting-room?demo=1");
  await expect(page.locator("#demo-next")).toBeEnabled();
  await page.locator("body").press("ArrowRight");
  await expect(page.getByRole("status", { name: /^Demo step 2 of 9/ })).toBeVisible();
  await page.locator("body").press("n");
  await expect(page.getByRole("status", { name: /^Demo step 3 of 9/ })).toBeVisible();
  await page.locator("#guidance-input").focus();
  await page.keyboard.press("n");
  await expect(page.getByRole("status", { name: /^Demo step 3 of 9/ })).toBeVisible();
  await page.locator("#guidance-input").blur();
  await page.locator("body").press("r");
  await expect(page.getByRole("status", { name: /^Demo step 1 of 9/ })).toBeVisible();
});

test("C4-demo-card-hidden-without-demo-flag", async ({ page }) => {
  await page.goto("/meeting-room");
  await expect(page.locator("#mr-meeting-heading")).toBeVisible();
  await waitForReady(page);
  await expect(page.locator("#demo-next")).toHaveCount(0);
});

test("C5-meeting-room-has-a-single-main-landmark", async ({ page }) => {
  await page.goto("/meeting-room");
  await waitForReady(page);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
});

test("C6-demo-card-shown-with-demo-flag", async ({ page }) => {
  await page.goto("/meeting-room?demo=1");
  await waitForReady(page);
  await expect(page.locator("#demo-next")).toHaveCount(1);
});

test("C7-owner-flow-guide-takeover-approve-send-evidence", async ({ page }) => {
  await page.goto("/meeting-room");
  await expect(page.locator("#mr-meeting-heading")).toBeVisible();
  const input = page.locator("#guidance-input");
  await input.fill("Keep it short and private.");
  await page.locator("#guidance-send").click();
  await expect(input).toHaveValue("");
  for (let i = 1; i <= 4; i++) {
    await page.locator("#stream-next").click();
    await expect(page.locator("#mr-transcript li").nth(i - 1)).toBeVisible();
  }
  await page.locator("#approve").click();
  await expect(page.locator("#mr-approval-state")).toContainText("Approved: yes");
  await page.locator("#send").click();
  await expect(page.getByText("Approved: yes · Send: sent")).toBeVisible();
  await expect(page.getByText("Sent — package locked.", { exact: false })).toBeVisible();
  await page.locator("#evidence-export").click();
  await expect(page.locator("#evidence-json")).toContainText("packageHash");
  await expect(page.locator("#evidence-json")).toContainText('"sendState": "sent"');
  await page.locator("#takeover").click();
  await expect(page.getByLabel("Take over", { exact: true }).getByText("You took over. The twin is paused.")).toBeVisible();
});

test("C8-reload-restores-the-room-in-the-same-browser", async ({ page, browser }) => {
  await page.goto("/meeting-room");
  await expect(page.locator("#mr-meeting-heading")).toBeVisible();
  await page.locator("#stream-next").click();
  await expect(page.locator("#mr-transcript li")).toHaveCount(1);
  const unique = `c8-reload-probe-${Date.now()}`;
  await page.locator("#package-editor").fill(unique);
  await page.locator("#package-save").click();
  await expect(page.locator("#package-editor")).toHaveValue(unique);
  await page.reload();
  await expect(page.getByText("Restored from the shared room store")).toBeVisible();
  await expect(page.locator("#package-editor")).toHaveValue(unique);
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto("/meeting-room");
  await expect(other.locator("#package-editor")).not.toHaveValue(unique);
  await expect(other.getByText("Restored from the shared room store")).toHaveCount(0);
  await fresh.close();
});
