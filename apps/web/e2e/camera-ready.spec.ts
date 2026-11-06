import { test, expect } from "@playwright/test";

// Camera-ready UI in Offline/test mode (no live calls): Demo Mode keeps both
// approval gates visible, the loading state shows a label plus elapsed
// seconds while analysis runs, and the page logs nothing to the console.
test("camera-ready: demo mode, loading state, no console noise", async ({ page }) => {
  const consoleMsgs: string[] = [];
  page.on("console", (m) => consoleMsgs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => consoleMsgs.push(`pageerror: ${e.message}`));
  const created = page.waitForResponse((r) => r.url().endsWith("/api/session") && r.request().method() === "POST");
  await page.goto("/session?demo=1");
  await created;
  await expect(page.locator("body")).toHaveClass(/demo/);
  await expect(page.locator("#demo-mode")).toBeChecked();
  await expect(page.locator("#demo-mode-state")).toHaveText("ON");
  await expect(page.locator("#demo-mode-note")).toBeVisible();
  await expect(page.locator("#payload-panel")).toBeHidden();
  await expect(page.locator("#progress")).toBeHidden();

  await page.locator("#transcript-input").fill("Dana Whitfield: pilot at $18,000 owed tomorrow.");
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  await expect(page.locator("#btn-approve")).toBeVisible();
  await expect(page.locator("#progress")).toBeHidden();
  // The test-mode analyzer waits ~1.5 s on this marker, so the loading state is observable.
  const base = await page.locator("#redacted-text").inputValue();
  await page.locator("#redacted-text").fill(`${base} [[slow]]`);
  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");

  await page.locator("#btn-analyze").click();
  await expect(page.locator("#progress")).toBeVisible();
  await expect(page.locator("#progress-label")).toHaveText(/Writing brief \(offline demo/);
  await expect(page.locator("#progress-label")).not.toContainText("GPU");
  await expect(page.locator("#progress-elapsed")).toHaveText(/^\d+ s$/);
  await expect(page.locator("#session-state")).toContainText("Completed", { timeout: 15000 });
  await expect(page.locator("#progress")).toBeHidden();

  // Toggling Demo Mode off and on never hides the approval gates.
  await page.locator("#demo-mode").uncheck();
  await expect(page.locator("#demo-mode-state")).toHaveText("OFF");
  await expect(page.locator("#btn-approve")).toBeVisible();
  await page.locator("#demo-mode").check();
  await expect(page.locator("#btn-approve")).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("secondSeatDemo"));
  expect(consoleMsgs).toEqual([]);
});
