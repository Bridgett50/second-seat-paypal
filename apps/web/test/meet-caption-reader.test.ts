import { test, expect, vi } from "vitest";
import { chromium, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { readMeetCaptionRows } from "../src/meetCaptionReader.js";
import { createMeetCaptionBuffer } from "../src/meetCaptionBuffer.js";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { createMeetWorkerBridge } from "../src/meetWorkerBridge.js";
import { createLocalMeetCaptureFactory } from "../src/meetWorkerCapture.js";
const CANONICAL = "https://meet.google.com/abc-defg-hij";
const CODE_MEET = "https://meet.google.com/def-ghij-klm";
function html() {
  return `<!doctype html><meta charset="utf-8"><button aria-label="Leave call">Leave</button><div role="region" aria-label="Captions"><div class="nMcdL"><div class="adE6rb"><div class="KcIKyf">Alice</div></div><div class="ygicle">budget is seven hundred dollars</div></div><div class="nMcdL"><div class="adE6rb"><div class="KcIKyf">AI Twin</div></div><div class="ygicle">budget is seven hundred dollars</div></div><div class="nMcdL"><div class="adE6rb"><div class="KcIKyf">Renée</div></div><div class="ygicle">I ain’t agreeing yet — I’ll confirm it myself.</div></div><span>ignore me</span></div>`;
}
test("real headless chrome with intercepted synthetic captions", async () => {
  let executablePath: string | undefined;
  if (process.env.PLAYWRIGHT_CHROME_PATH) executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
  else if (existsSync("/usr/bin/google-chrome")) executablePath = "/usr/bin/google-chrome";
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html() }));
    await page.goto("https://meet.google.com/abc-defg-hij");
    const signal = new AbortController().signal;
    const rows = await readMeetCaptionRows(page, { meetingUrl: CANONICAL }, signal, () => true);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ rowIndex: 0, speaker: "Alice", text: "budget is seven hundred dollars", verified: false });
    expect(rows[1]).toEqual({ rowIndex: 1, speaker: "AI Twin", text: "budget is seven hundred dollars", verified: false });
    expect(rows[2]).toEqual({ rowIndex: 2, speaker: "Renée", text: "I ain’t agreeing yet — I’ll confirm it myself.", verified: false });
    for (const r of rows) expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(rows)).toBe(true);
    await page.goto("https://meet.google.com/meet/abc-defg-hij?pli=1");
    expect(await readMeetCaptionRows(page, { meetingUrl: CANONICAL }, signal, () => true)).toEqual(rows);
    expect(await readMeetCaptionRows(page, { meetingUrl: CANONICAL + "?pli=1" }, signal, () => true)).toEqual([]);
    await page.goto(CODE_MEET);
    expect(await readMeetCaptionRows(page, { meetingUrl: CANONICAL }, signal, () => true)).toEqual([]);
  } finally {
    await browser.close();
  }
});
test("fake Page barrier defers count and respects abort", async () => {
  let resolveCount!: (v: number) => void;
  const countDeferred = new Promise<number>((r) => (resolveCount = r));
  const countSpy = vi.fn(() => countDeferred);
  const visibleSpy = vi.fn(() => Promise.resolve(true));
  const locatorSpy = vi.fn(() => {
    throw new Error("locator should not be called");
  });
  const getByRole = vi.fn(() => ({ count: countSpy, isVisible: visibleSpy }));
  const fakePage = { url: () => CANONICAL, getByRole, locator: locatorSpy } as unknown as Page;
  const controller = new AbortController();
  const pending = readMeetCaptionRows(fakePage, { meetingUrl: CANONICAL }, controller.signal, () => !controller.signal.aborted);
  expect(countSpy).toHaveBeenCalledTimes(1);
  expect(getByRole).toHaveBeenCalledWith("button", { name: "Leave call", exact: true });
  controller.abort();
  resolveCount(1);
  const result = await pending;
  expect(result).toEqual([]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(visibleSpy).toHaveBeenCalledTimes(0);
  expect(locatorSpy).toHaveBeenCalledTimes(0);
  const getByRole2 = vi.fn(() => ({ count: vi.fn(), isVisible: vi.fn() }));
  const locator2 = vi.fn();
  const abortedCtrl = new AbortController();
  abortedCtrl.abort();
  const fake2 = { url: () => CANONICAL, getByRole: getByRole2, locator: locator2 } as unknown as Page;
  expect(await readMeetCaptionRows(fake2, { meetingUrl: CANONICAL }, abortedCtrl.signal, () => false)).toEqual([]);
  expect(getByRole2).toHaveBeenCalledTimes(0);
  expect(locator2).toHaveBeenCalledTimes(0);
});

// revocation-after-extraction guard: startedPromise pattern
test('aborts after DOM extraction started but before resolve when current becomes false', async () => {
  let heldResolve!: (v: { speaker: string; text: string }[]) => void;
  const heldPromise = new Promise<{ speaker: string; text: string }[]>((res) => { heldResolve = res; });
  let startedResolve!: () => void;
  const startedPromise = new Promise<void>((res) => { startedResolve = res; });
  const rawRows = [{ speaker: 'Alice', text: 'synthetic only' }];

  let current = true;
  let evaluateCallCount = 0;

  const fakePage = {
    url: () => CANONICAL,
    getByRole: vi.fn(() => ({
      count: vi.fn(() => Promise.resolve(1)),
      isVisible: vi.fn(() => Promise.resolve(true)),
    })),
    locator: vi.fn(() => ({
      count: vi.fn(() => Promise.resolve(1)),
      isVisible: vi.fn(() => Promise.resolve(true)),
      evaluate: vi.fn((_cb: unknown) => {
        evaluateCallCount++;
        startedResolve();
        return heldPromise;
      }),
    })),
  } as unknown as Page;

  const readerPromise = readMeetCaptionRows(fakePage, { meetingUrl: CANONICAL }, new AbortController().signal, () => current);

  await startedPromise;

  // revoke after extraction started, before it resolves
  current = false;
  heldResolve(rawRows);

  const rows = await readerPromise;

  expect(rows).toEqual([]);
  expect(Object.isFrozen(rows)).toBe(true);
  expect(evaluateCallCount).toBe(1);
});
test("several attached Captions regions, all empty: zero rows without failing; first caption rows are read and the buffer keeps sampling", async () => {
  let executablePath: string | undefined;
  if (process.env.PLAYWRIGHT_CHROME_PATH) executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
  else if (existsSync("/usr/bin/google-chrome")) executablePath = "/usr/bin/google-chrome";
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const page = await browser.newPage();
    const body = '<!doctype html><meta charset="utf-8"><button aria-label="Leave call">Leave</button><div role="region" aria-label="Captions"></div><div role="region" aria-label="Captions"></div>';
    await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body }));
    await page.goto(CANONICAL);
    const signal = new AbortController().signal;
    expect(await readMeetCaptionRows(page, { meetingUrl: CANONICAL }, signal, () => true)).toEqual([]);
    const buffer = createMeetCaptionBuffer({ page, meetingUrl: CANONICAL, meetingId: "m-multi", signal, isCurrent: () => true });
    expect(await buffer.sample()).toEqual([]);
    await page.locator('[role="region"]').nth(1).evaluate((el: { innerHTML: string }) => { el.innerHTML = '<div class="nMcdL"><div class="adE6rb"><div class="KcIKyf">Alice</div></div><div class="ygicle">first words</div></div>'; });
    expect(await readMeetCaptionRows(page, { meetingUrl: CANONICAL }, signal, () => true)).toEqual([{ rowIndex: 0, speaker: "Alice", text: "first words", verified: false }]);
    const first = await buffer.sample();
    expect(first.map((e) => e.event.text)).toEqual(["first words"]);
    await page.locator("div.ygicle").evaluate((el: { textContent: string | null }) => { el.textContent = "first words and more"; });
    const next = await buffer.sample();
    expect(next.map((e) => e.event.text)).toEqual(["first words and more"]);
    const tags = warn.mock.calls.map((c) => String(c[0]));
    expect(tags.some((t) => t.includes("captions.reader.regionCount"))).toBe(false);
  } finally {
    warn.mockRestore();
    await browser.close();
  }
}, 30000);
test("caption region with zero rows logs one redacted role/name snapshot; query string ignored", async () => {
  let executablePath: string | undefined;
  if (process.env.PLAYWRIGHT_CHROME_PATH) executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
  else if (existsSync("/usr/bin/google-chrome")) executablePath = "/usr/bin/google-chrome";
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const page = await browser.newPage();
    const body = '<!doctype html><meta charset="utf-8"><button aria-label="Leave call">Leave</button><button aria-label="Account owner@example.com">x</button><div role="region" aria-label="Captions"></div>';
    await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body }));
    await page.goto(CANONICAL + "?authuser=0");
    const signal = new AbortController().signal;
    for (let i = 0; i < 25; i++) expect(await readMeetCaptionRows(page, { meetingUrl: CANONICAL }, signal, () => true)).toEqual([]);
    const logs = spy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith("[meet-diagnostic]"));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("0 rows");
    expect(logs[0]).toContain("region: Captions");
    expect(logs[0]).toContain("[email]");
    expect(logs[0]).not.toContain("owner@example.com");
    await page.locator('[role="region"]').evaluate((el: { innerHTML: string }) => { el.innerHTML = "<div><div>Dana</div><div>structural caption</div></div>"; });
    expect(await readMeetCaptionRows(page, { meetingUrl: CANONICAL }, signal, () => true)).toEqual([{ rowIndex: 0, speaker: "Dana", text: "structural caption", verified: false }]);
  } finally {
    spy.mockRestore();
    await browser.close();
  }
}, 30000);
test("capture starts right after join: the first caption row on screen is ingested by the first sample (two Leave call buttons)", async () => {
  let executablePath: string | undefined;
  if (process.env.PLAYWRIGHT_CHROME_PATH) executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
  else if (existsSync("/usr/bin/google-chrome")) executablePath = "/usr/bin/google-chrome";
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const page = await browser.newPage();
    const body = '<!doctype html><meta charset="utf-8"><button aria-label="Leave call">Leave</button><button aria-label="Leave call">Leave</button><div role="region" aria-label="Captions"><div class="nMcdL"><div class="adE6rb"><div class="KcIKyf">Bridgett</div></div><div class="ygicle">first words</div></div></div>';
    await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body }));
    const headers: Record<string, string> = { host: "127.0.0.1:4174" };
    const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" }, conversationInput: true, candidateAutoDispatch: false, sessionPolicy: true, now: () => 1000 });
    const key = "owner-browser";
    const room = svc.open("", headers, key).roomId;
    let joinedAt = 0;
    let readyAt = 0;
    let markReady: () => void = () => {};
    const ready = new Promise<void>((r) => { markReady = r; });
    const factory = createLocalMeetCaptureFactory({
      expectedOwnerEmail: "owner@example.test",
      launch: async () => ({ newContext: async () => ({ newPage: async () => page }), close: async () => {} }),
      admit: async (p) => { await p.goto(CANONICAL); joinedAt = Date.now(); return true; },
    });
    const bridge = createMeetWorkerBridge({ service: svc, now: () => 1000, startCapture: (scope, signal) => factory(scope, signal).then((cap) => { readyAt = Date.now(); markReady(); return cap; }, (e: unknown) => { markReady(); throw e; }) });
    expect(bridge.connect(key, room, CANONICAL, "Second Seat AI twin (test)").status).toBe(202);
    await ready;
    for (let i = 0; i < 20 && bridge.status(key, room).body.status !== "listening"; i++) await Promise.resolve();
    expect(bridge.status(key, room).body.status).toBe("listening");
    expect(joinedAt).toBeGreaterThan(0);
    expect(readyAt - joinedAt).toBeLessThan(3000);
    const first = await bridge.sample(key, room);
    expect(first.status).toBe(200);
    expect(first.body.accepted).toBe(1);
    expect(warn.mock.calls.map((c) => c.map(String).join(" ")).filter((l) => l.includes("failed"))).toEqual([]);
    expect((await bridge.stop(key, room)).body.status).toBe("stopped");
  } finally {
    warn.mockRestore();
    await browser.close();
  }
}, 30000);
