/**
 * FR9: offline paste-to-copy of demo/synthetic-transcript.txt.
 * No provider. Counts analyzer callbacks.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRANSCRIPT = readFileSync(join(HERE, "..", "..", "..", "demo", "synthetic-transcript.txt"), "utf8");
const PHONE = "555-013-8844";
const EMAIL = "ellis.ward@northglass-retail.example";
const DRAFT = "Please send a corrected written quote. I have not accepted the deadline.";
const BLOCKED_LABEL = "Review required — check the redacted preview, then approve.";

async function open(page: Page): Promise<string> {
  const resp = page.waitForResponse(
    (r) => r.url().endsWith("/api/session") && r.request().method() === "POST",
  );
  await page.goto("/session?demo=1");
  return (await (await resp).json()).sessionId as string;
}

async function state(page: Page, id: string): Promise<Record<string, unknown>> {
  const res = await page.request.get(`/api/session/state?sessionId=${encodeURIComponent(id)}`);
  expect(res.ok()).toBe(true);
  return res.json();
}

async function writesOf(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __writes?: string[] }).__writes ?? []);
}

async function outbound(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/test/outbound");
  expect(res.ok()).toBe(true);
  return ((await res.json()).analyzerCalls ?? []) as string[];
}

function foreignHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname;
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return null;
  return host;
}

test("FR9 offline synthetic transcript reaches copy without a provider call", async ({ page, context }) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    requested.push(request.url());
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    const bag = window as unknown as { __writes: string[] };
    bag.__writes = [];
    const wrap = () => {
      const clip = navigator.clipboard;
      if (!clip || (clip.writeText as unknown as { __fr9?: boolean }).__fr9) return;
      const orig = clip.writeText.bind(clip);
      const wrapped = (text: string) => {
        bag.__writes.push(text);
        return orig(text);
      };
      (wrapped as unknown as { __fr9: boolean }).__fr9 = true;
      clip.writeText = wrapped;
    };
    wrap();
  });
  const id = await open(page);
  await expect(page.locator("#offline-label")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/demo/);
  const before = await outbound(page);

  await page.locator("#transcript-input").fill(TRANSCRIPT);
  await page.locator("#btn-redact").click();
  await expect(page.locator("#session-state")).toContainText("Review required");
  const preview = page.locator("#redacted-text");
  const masked = await preview.inputValue();
  expect(masked).not.toContain(PHONE);
  expect(masked).not.toContain("Ellis Ward");
  expect(masked).not.toContain("Amira Solano");
  expect(masked).toContain(EMAIL);
  expect(masked).toMatch(/\bAmira\b/);
  expect(masked).not.toMatch(/\bEllis\b/);

  const beforeCalls = await outbound(page);
  const beforeSnap = await state(page, id);
  const beforeReceipts = JSON.stringify(beforeSnap.receipts ?? []);

  await page.locator("#btn-approve").click();
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#session-state")).toHaveText(BLOCKED_LABEL, { timeout: 15000 });
  const newAnalyzerCalls = (await outbound(page)).slice(beforeCalls.length);
  expect(newAnalyzerCalls).toEqual([]);
  expect(newAnalyzerCalls.some((call) => call.includes(EMAIL) || call.includes(PHONE))).toBe(false);
  const blocked = await state(page, id);
  expect(blocked.state).toBe("review_required");
  expect(blocked.result).toBeNull();
  expect((blocked.verification as { blocked?: boolean }).blocked).toBe(true);
  expect(JSON.stringify(blocked.receipts ?? [])).toBe(beforeReceipts);
  expect(blocked.draft).toBeNull();
  await expect(page.locator("#draft")).toBeHidden();
  expect(await page.locator("#draft-text").inputValue()).toBe("");
  await expect(page.locator("#btn-copy")).toBeDisabled();
  await page.locator("#btn-copy").evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(await writesOf(page)).toEqual([]);

  let corrected = masked.split(EMAIL).join("[REDACTED_email]");
  corrected = corrected.replace(/\bAmira\b/g, "[REDACTED_person]");
  corrected = corrected.replace(/\bEllis\b/g, "[REDACTED_person]");
  expect(corrected).not.toContain(EMAIL);
  expect(corrected).not.toMatch(/\bAmira\b/);
  expect(corrected).not.toMatch(/\bEllis\b/);
  expect(corrected).not.toContain(PHONE);
  await preview.fill(corrected);
  await page.locator("#btn-approve").click();
  await expect(page.locator("#session-state")).toContainText("Approved");
  await page.locator("#btn-analyze").click();
  await expect(page.locator("#session-state")).toContainText("Completed", { timeout: 15000 });
  const sent = (await outbound(page)).slice(beforeCalls.length);
  expect(sent).toEqual([corrected]);
  expect(sent).toHaveLength(1);
  expect(sent[0]).not.toContain(PHONE);
  expect(sent[0]).not.toContain(EMAIL);
  expect(sent[0]).not.toMatch(/\bAmira\b/);
  expect(sent[0]).not.toMatch(/\bEllis\b/);
  expect(sent[0]).not.toContain("Ellis Ward");
  expect(sent[0]).not.toContain("Amira Solano");

  const snap = await state(page, id);
  const result = snap.result as { entries: { segmentIds: string[] }[] };
  expect(result.entries).toHaveLength(2);
  expect((snap.pressure as { items: unknown[] }).items).toHaveLength(0);
  expect((snap.verification as { status: string }).status).toBe("needs_owner_review");
  expect(
    (snap.verification as { checks: { id: string; result: string }[] }).checks.find((c) => c.id === "claims")
      ?.result,
  ).toBe("not_run");
  expect((snap.verification as { message: string }).message).toContain("Claim support not checked.");
  await expect(page.locator("#verification-title")).toHaveText("Needs owner review");

  const links = page.locator("#results .citations a");
  const n = await links.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i += 1) {
    const href = await links.nth(i).getAttribute("href");
    expect(href).toBeTruthy();
    const target = page.locator(href!);
    await expect(target).toHaveCount(1);
    const cited = (await target.innerText()).trim();
    expect(corrected).toContain(cited);
    await links.nth(i).click();
  }

  await page.locator("#draft-text").fill(DRAFT);
  await page.locator("#btn-draft-approve").click();
  await expect(page.locator("#btn-copy")).toBeEnabled();
  await page.locator("#btn-copy").click();
  const writes = await writesOf(page);
  const readback = await page.evaluate(() => navigator.clipboard.readText());
  expect(writes).toHaveLength(1);
  expect(writes[0]).toBe(DRAFT);
  const same = await state(page, id);
  const sameDraft = same.draft as { text: string; approved: boolean };
  expect(same.state).toBe("completed");
  expect(sameDraft.text).toBe(DRAFT);
  expect(sameDraft.approved).toBe(true);
  expect(writes[0]).toBe(sameDraft.text);
  expect(readback).toBe(DRAFT);
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.map(foreignHost).filter((host) => host !== null)).toEqual([]);

  await page.locator("#draft-text").fill(`${DRAFT} extra`);
  await expect(page.locator("#btn-copy")).toBeDisabled();
  await expect.poll(async () => {
    const edited = await state(page, id);
    const draft = edited.draft as { text?: string; approved?: boolean } | null;
    return draft === null ? "null" : `${String(draft.approved)}:${draft.text ?? ""}`;
  }).toBe(`false:${DRAFT} extra`);
  expect(await writesOf(page)).toEqual([DRAFT]);
});
