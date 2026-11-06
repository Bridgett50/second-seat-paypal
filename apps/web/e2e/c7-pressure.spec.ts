import { test, expect, type Page } from "@playwright/test";

async function open(page: Page): Promise<string> {
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/session") && r.request().method() === "POST");
  await page.goto("/session");
  return (await (await resp).json()).sessionId as string;
}
async function state(page: Page, id: string) {
  return (await page.request.get(`/api/session/state?sessionId=${encodeURIComponent(id)}`)).json();
}

test("C7-6 review / unreview / Copy gating bound to the current assessment identity", async ({ page }) => {
  const id = await open(page);
  await page.locator("#transcript-input").fill("Renewal call\nThis is the last chance, the discount expires tonight\nCan we keep net-45 terms?");
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");
  await page.locator("#btn-analyze").click();
  await expect(page.locator(".pressure-review")).toHaveCount(1);
  const s0 = await state(page, id);
  expect(s0.pressure.status).toBe("valid_positive");
  expect(s0.pressure.items[0]).toMatchObject({ quote: "last chance", segmentId: "seg-2" });
  await expect(page.locator("#pressure")).toContainText("term not identified");
  await expect(page.locator("#pressure")).not.toContainText("unresolved term: This is the last chance");

  await page.locator("#draft-text").fill("Reply.");
  await page.locator("#btn-draft-approve").click();
  await expect(page.locator("#btn-copy")).toBeDisabled(); // pressure not reviewed yet

  const reviewed = page.waitForResponse((r) => r.url().endsWith("/api/session/pressure-review"));
  await page.locator(".pressure-review").first().check();
  await reviewed;
  expect((await state(page, id)).pressure.allReviewed).toBe(true);
  await page.locator("#btn-draft-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();

  const unreviewed = page.waitForResponse((r) => r.url().endsWith("/api/session/pressure-review"));
  await page.locator(".pressure-review").first().uncheck();
  await unreviewed;
  await expect(page.locator("#btn-copy")).toBeDisabled();

  // A review naming a different assessment identity is rejected and changes nothing.
  const cur = await state(page, id);
  const stale = await page.request.post("/api/session/pressure-review", {
    data: { sessionId: id, itemId: "p1", expectedRevision: cur.revision, assessmentId: "not-the-current-assessment", reviewed: true },
  });
  expect(stale.status()).toBe(409);
  const after = await state(page, id);
  expect(after.pressure.reviewed).toEqual([]);
  expect(after.pressure.allReviewed).toBe(false);
  expect(after.revision).toBe(cur.revision);
});
