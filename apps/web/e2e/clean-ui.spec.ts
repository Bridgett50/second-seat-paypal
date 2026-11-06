import { test, expect } from "@playwright/test";

// Clean UI rebuild in Offline/test mode (no live calls): the AI Twin stage sits
// beside the brief with a visible AI-generated label, the image loads from
// localhost, and Demo Mode / approvals / loading states stay visible.
for (const path of ["/session?demo=1", "/briefs/demo?demo=1"]) {
  test(`twin stage beside the brief on ${path}`, async ({ page }) => {
    const consoleMsgs: string[] = [];
    page.on("console", (m) => consoleMsgs.push(`${m.type()}: ${m.text()}`));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);
    const stage = page.locator("#twin-stage");
    await expect(stage).toBeVisible();
    await expect(stage.locator(".twin-badge")).toHaveText("AI Twin of Bridgett");
    await expect(page.locator("#twin-ai-label")).toBeVisible();
    await expect(page.locator("#twin-ai-label")).toHaveText("AI-generated");
    const img = page.locator("#twin-image");
    await expect(img).toBeVisible();
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const main = await page.locator(".ss-main").boundingBox();
    const box = await stage.boundingBox();
    expect(main && box && box.x >= main.x + main.width).toBe(true);
    await expect(page.locator("#btn-approve")).toBeVisible();
    expect(consoleMsgs).toEqual([]);
  });
}

test("narrow session: stage is a compact strip above the flow, demo switch still visible", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 1280 });
  await page.goto("/session?demo=1");
  await expect(page.locator("#twin-stage")).toBeVisible();
  await expect(page.locator("#twin-ai-label")).toBeVisible();
  await expect(page.locator("#demo-mode")).toBeVisible();
  await expect(page.locator("#btn-redact")).toBeVisible();
  const fitsWidth = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(fitsWidth).toBe(true);
});
