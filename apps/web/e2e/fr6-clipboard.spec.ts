/**
 * FR6-1 and FR6-4. Observes writeText. Does not treat a native readback as the contract.
 * Offline test server only.
 */
import { test, expect, type Page } from "@playwright/test";

const DRAFT = "First synthetic line.\nSecond synthetic line.";

async function open(page: Page): Promise<string> {
  const resp = page.waitForResponse(
    (r) => r.url().endsWith("/api/session") && r.request().method() === "POST",
  );
  await page.goto("/session?demo=1");
  return (await (await resp).json()).sessionId as string;
}

async function state(page: Page, id: string) {
  const res = await page.request.get(`/api/session/state?sessionId=${encodeURIComponent(id)}`);
  expect(res.ok()).toBe(true);
  return res.json() as Promise<{ draft: { text: string; approved: boolean } | null }>;
}

async function armWriteSpy(page: Page) {
  await page.evaluate(() => {
    const bag = window as unknown as { __writes: string[] };
    bag.__writes = [];
    const clip = navigator.clipboard;
    const orig = clip.writeText.bind(clip);
    clip.writeText = (text: string) => {
      bag.__writes.push(text);
      return orig(text);
    };
  });
}

async function writes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __writes: string[] }).__writes);
}

test("FR6-1 writeText receives the exact approved draft", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = await open(page);
  await armWriteSpy(page);
  await page.locator("#transcript-input").fill("Discussed options.");
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#session-state")).toContainText("Completed", { timeout: 15000 });
  await page.locator("#draft-text").fill(DRAFT);
  await page.locator("#btn-draft-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
  await page.locator("#btn-copy").click();
  const captured = await writes(page);
  const snap = await state(page, id);
  const readback = await page.evaluate(() => navigator.clipboard.readText());
  // Boundary A: the argument writeText received.
  expect(captured).toEqual([DRAFT]);
  expect(snap.draft?.text).toBe(DRAFT);
  expect(captured[0]).toBe(snap.draft?.text);
  // Boundary B, this Linux Chromium only: native readback is exact, including LF.
  expect(readback).toBe(DRAFT);
  expect(readback).toBe(captured[0]);
});

test("FR6-4 copy stays unused until a fresh explicit approval", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await armWriteSpy(page);
  await page.locator("#transcript-input").fill("Discussed options.");
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  await page.locator("#btn-approve").click();
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#session-state")).toContainText("Completed", { timeout: 15000 });
  const draft = page.locator("#draft-text");
  await draft.fill("Reply A");
  await draft.fill("Reply B");
  await draft.fill("Reply A");
  await page.locator("#btn-copy").click({ force: true });
  expect(await writes(page)).toEqual([]);
  await page.locator("#btn-draft-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
  await page.locator("#btn-copy").click();
  expect(await writes(page)).toEqual(["Reply A"]);
});
