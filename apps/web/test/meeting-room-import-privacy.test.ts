import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createWebServer } from "../src/server.js";
import { createMeetingRoomService, type MeetingRoomService } from "../src/meetingRoom.js";
import { outboundStats } from "../src/netGuard.js";

// F140-5: the import panel tells the truth about where imported text goes.
// Synthetic text only, private loopback server, fake transport, test-mode
// --- end of F140-5 test part 1 ---
// network guard on, awaited responses as barriers (no sleeps).
// System Chrome when PLAYWRIGHT_CHROME_PATH is set or /usr/bin/google-chrome exists; otherwise Playwright's bundled Chromium.
const CHROME_PATH = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
const CHROME_LAUNCH: { executablePath?: string } =
  process.env.PLAYWRIGHT_CHROME_PATH || existsSync(CHROME_PATH) ? { executablePath: CHROME_PATH } : {};
const API = "/api/meeting-room";
const MARKER = "SYNTHETIC_COMPARE_MARKER_140";
const ACCURATE = "Compare sends this text to this app's server";
let svc: MeetingRoomService;
let server: Server;
let base = "";
let browser: Browser;
let priorMode: string | undefined;
// --- end of F140-5 test part 2 ---

beforeAll(async () => {
  priorMode = process.env.SECOND_SEAT_TEST_MODE;
  process.env.SECOND_SEAT_TEST_MODE = "1";
  svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } });
  server = createWebServer({ meetingRoom: svc } as Parameters<typeof createWebServer>[0]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ ...CHROME_LAUNCH, headless: true });
});
// --- end of F140-5 test part 3 ---

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (priorMode === undefined) delete process.env.SECOND_SEAT_TEST_MODE;
  else process.env.SECOND_SEAT_TEST_MODE = priorMode;
});

async function openRoom(): Promise<{ page: Page; requests: string[]; blocked: string[] }> {
  const context = await browser.newContext();
// --- end of F140-5 test part 4 ---
  const requests: string[] = [];
  const blocked: string[] = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (new URL(url).origin !== base) {
      blocked.push(url);
      await route.abort();
      return;
    }
// --- end of F140-5 test part 5 ---
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${base}/meeting-room`);
  return { page, requests, blocked };
}

describe("F140-5 import privacy boundary", () => {
  it("F140-5a the rendered import panel explains app-server processing before Compare", async () => {
    const { page } = await openRoom();
// --- end of F140-5 test part 6 ---
    const panel = page.locator("section", { has: page.locator("#compare-run") });
    const text = (await panel.textContent()) ?? "";
    expect(text, "no false browser-only claim").not.toContain("Nothing leaves the browser");
    expect(text, "explains app-server processing").toContain(ACCURATE);
    expect(text, "no external model or email").toContain("this demo does not call an external model or send email");
    const notice = panel.locator("p", { hasText: ACCURATE });
    expect(await notice.count(), "one visible notice").toBe(1);
    expect(await notice.isVisible(), "notice visible").toBe(true);
    const html = await panel.innerHTML();
    const at = html.indexOf(ACCURATE);
// --- end of F140-5 test part 7 ---
    expect(at, "notice is in the panel markup").toBeGreaterThan(-1);
    expect(at, "notice comes before the import box").toBeLessThan(html.indexOf('id="compare-input"'));
    expect(at, "notice comes before Compare").toBeLessThan(html.indexOf('id="compare-run"'));
    await page.context().close();
  }, 60_000);

  it("F140-5b Compare posts the marker only to the loopback app server; no external transport runs", async () => {
    const { page, requests, blocked } = await openRoom();
    const statsBefore = outboundStats();
    const sentBefore = svc.sentBodies().length;
// --- end of F140-5 test part 8 ---
    await page.locator("#compare-input").fill(`Synthetic imported draft ${MARKER} for comparison.`);
    const pending = page.waitForRequest((r) => new URL(r.url()).pathname === API && r.method() === "POST");
    const answered = page.waitForResponse((r) => new URL(r.url()).pathname === API && r.request().method() === "POST");
    await page.locator("#compare-run").click();
    const request = await pending;
    const response = await answered;
    const body = JSON.parse(request.postData() ?? "{}") as { action?: string; text?: string };
    expect(new URL(request.url()).origin, "Compare goes to the loopback app server").toBe(base);
    expect(body.action, "the Compare action").toBe("compare");
    expect(body.text, "the text field carries the exact marker").toContain(MARKER);
// --- end of F140-5 test part 9 ---
    expect(response.status(), "local server answered").toBeLessThan(500);
    expect(requests.length, "requests were observed").toBeGreaterThan(0);
    expect(requests.every((u) => new URL(u).origin === base), "every browser request stays on loopback").toBe(true);
    expect(blocked, "no request was blocked").toEqual([]);
    const statsAfter = outboundStats();
    expect(statsAfter.blockedOutside, "server network guard saw no outside call").toBe(statsBefore.blockedOutside);
    expect(statsAfter.analyzerCalls, "no model analyzer call").toEqual(statsBefore.analyzerCalls);
    expect(svc.sentBodies().length, "zero fake email transport calls").toBe(sentBefore);
    const outbound = await page.evaluate(async () => (await fetch("/api/test/outbound")).status);
    expect(outbound, "test-mode guard endpoint is live").toBe(200);
// --- end of F140-5 test part 10 ---
    await page.context().close();
  }, 60_000);
});
// --- end of F140-5 test part 11 ---
