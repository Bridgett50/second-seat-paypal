import { test, expect } from "@playwright/test";

const SESSION = "/session";
const TRANSCRIPT = "When will you deliver the vendor report?";

test("paste -> redact -> review -> approve -> analyze -> completed", async ({
  page,
}) => {
  await page.goto(SESSION);
  await expect(page.locator("#offline-label")).toContainText("Offline demo");
  await expect(page.locator("#session-state")).toContainText("Input");
  await expect(page.locator("#empty-state")).toContainText(
    "No findings yet — paste a transcript and run analysis.",
  );

  await page.locator("#transcript-input").fill(TRANSCRIPT);
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  await expect(page.locator("#redacted-text")).not.toHaveValue("");

  // Review: edit the redacted preview (correct clears approval).
  const redacted = await page.locator("#redacted-text").inputValue();
  await page.locator("#redacted-text").fill(`${redacted} Please confirm.`);
  await expect(page.locator("#session-state")).toContainText("Review required");
  const approvedText = await page.locator("#redacted-text").inputValue();

  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");
  await expect(page.locator("#payload-panel")).toContainText("Prepared (not dispatched)");
  expect(await page.locator("#payload-text").textContent()).toBe(approvedText);

  // Double-click analyze: still a single analysis result.
  await page.locator("#btn-analyze").dblclick();
  await expect(page.locator("#session-state")).toContainText("Completed");
  await expect(page.locator("#results .result")).toHaveCount(1);
  const href = await page.locator("#results .result .citations a").first().getAttribute("href");
  expect(href).toMatch(/^#seg-/);
  await expect(page.locator("#payload-panel")).toContainText("Dispatched to");
  expect(await page.locator("#payload-text").textContent()).toBe(approvedText);

  // Changing the transcript clears approvals and results.
  await page.locator("#transcript-input").fill("Something entirely different");
  await expect(page.locator("#session-state")).toContainText("Input");
  await expect(page.locator("#results .result")).toHaveCount(0);
  await expect(page.locator("#empty-state")).toContainText(
    "No findings yet — paste a transcript and run analysis.",
  );
});
