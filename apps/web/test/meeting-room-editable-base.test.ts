import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createWebServer } from "../src/server.js";
import { createMeetingRoomService, type MeetingRoomService } from "../src/meetingRoom.js";

// F140-3: the package editor edits only the owner-written base; included
// plugin sections stay managed by Include/Exclude. Private loopback server,
// test mode only in the injected service env, synthetic text only, real
// browser clicks, barriers (awaited responses) instead of sleeps.
const OWNER_BASE = "Synthetic owner summary for the review.\nAction items\n- Synthetic owner-written follow-up, not from the plugin.";
// --- end of F140-3 test part 1 ---
const OWNER_ADDENDUM = "\nSynthetic owner addendum after review.";
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };
// System Chrome when PLAYWRIGHT_CHROME_PATH is set or /usr/bin/google-chrome exists; otherwise Playwright's bundled Chromium.
const CHROME_PATH = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
const CHROME_LAUNCH: { executablePath?: string } =
  process.env.PLAYWRIGHT_CHROME_PATH || existsSync(CHROME_PATH) ? { executablePath: CHROME_PATH } : {};
const API = "/api/meeting-room";
const PLUGIN = "action-items";

type ActResult = { status: number; json: Record<string, unknown> | null };
type View = {
  draft: { body: string; approved: boolean; sendState: string };
  transcript: string[];
// --- end of F140-3 test part 2 ---
};

let svc: MeetingRoomService;
let server: Server;
let base = "";
let browser: Browser;

beforeAll(async () => {
  svc = createMeetingRoomService({ env: TEST_ENV });
  server = createWebServer({ meetingRoom: svc } as Parameters<typeof createWebServer>[0]);
// --- end of F140-3 test part 3 ---
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ ...CHROME_LAUNCH, headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

// --- end of F140-3 test part 4 ---
function isApi(url: string): boolean {
  return new URL(url).pathname === API;
}

/** Click a rendered control and wait for its /api/meeting-room response. */
async function clickAndWait(page: Page, selector: string): Promise<ActResult> {
  const pending = page.waitForResponse((r) => isApi(r.url()) && r.request().method() === "POST");
  await page.locator(selector).first().click();
  const res = await pending;
  return { status: res.status(), json: (await res.json()) as Record<string, unknown> };
// --- end of F140-3 test part 5 ---
}

function viewOf(r: ActResult): View {
  const snap = (r.json?.["snapshot"] ?? null) as { view: View } | null;
  if (snap === null) throw new Error(`no snapshot (status ${r.status})`);
  return snap.view;
}

/** Let the page run queued tasks (response handlers) after a response. */
async function settle(page: Page): Promise<void> {
// --- end of F140-3 test part 6 ---
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))");
}

/** Click a control, require HTTP 200, let the page apply the result. */
async function act(page: Page, selector: string): Promise<View> {
  const r = await clickAndWait(page, selector);
  expect(r.status, `${selector} succeeds`).toBe(200);
  await settle(page);
  return viewOf(r);
}
// --- end of F140-3 test part 7 ---

async function displayedPackage(page: Page): Promise<string> {
  return (await page.locator('section[aria-labelledby="mr-package-heading"] pre').first().textContent()) ?? "";
}

function count(haystack: string, needle: string): number {
  if (needle.length === 0) throw new Error("empty needle");
  return haystack.split(needle).length - 1;
}

// --- end of F140-3 test part 8 ---
/** Open the room in the browser, stream every synthetic line, run plugins. */
async function prepareRoom(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${base}/meeting-room`);
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    const n = (await act(page, "#stream-next")).transcript.length;
    if (n === last) break;
    last = n;
  }
// --- end of F140-3 test part 9 ---
  expect(last, "synthetic lines streamed").toBeGreaterThan(0);
  await act(page, "#run-plugins");
  return page;
}

/** Click Include on the Action items plugin; return [before, after, managed]. */
async function includeActionItems(page: Page): Promise<{ before: string; after: View; managed: string }> {
  const before = await displayedPackage(page);
  const after = await act(page, `#plugin-include-${PLUGIN}`);
  expect(after.draft.body.startsWith(before), "included section is appended after the base").toBe(true);
// --- end of F140-3 test part 10 ---
  const managed = after.draft.body.slice(before.length);
  expect(managed.length, "managed Action items section is non-empty").toBeGreaterThan(0);
  expect(await displayedPackage(page), "preview shows the full composed package").toBe(after.draft.body);
  return { before, after, managed };
}

describe("F140-3 package editor edits the base, not the composed package", () => {
  it("F140-3a unchanged saves keep the composed package exact and exclude removes the managed section", async () => {
    const ctx = await browser.newContext();
    try {
// --- end of F140-3 test part 11 ---
      const page = await prepareRoom(ctx);
      const { managed, after } = await includeActionItems(page);
      const S = after.draft.body;
      for (const round of [1, 2]) {
        const saved = await act(page, "#package-save");
        expect(saved.draft.body.length, `save ${round}: composed length unchanged`).toBe(S.length);
        expect(saved.draft.body, `save ${round}: composed body unchanged`).toBe(S);
        expect(await displayedPackage(page), `save ${round}: preview unchanged`).toBe(S);
      }
      const excluded = await act(page, `#plugin-exclude-${PLUGIN}`);
// --- end of F140-3 test part 12 ---
      expect(count(excluded.draft.body, managed), "managed section absent after exclude").toBe(0);
      expect(await displayedPackage(page), "preview matches after exclude").toBe(excluded.draft.body);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it("F140-3b owner text resembling the plugin heading survives; managed content once then zero; edit needs reapproval", async () => {
    const ctx = await browser.newContext();
    try {
// --- end of F140-3 test part 13 ---
      const page = await prepareRoom(ctx);
      await page.locator("#package-editor").fill(OWNER_BASE);
      const savedBase = await act(page, "#package-save");
      expect(savedBase.draft.body, "owner base saved exactly").toBe(OWNER_BASE);
      const { managed } = await includeActionItems(page);
      const approved = await act(page, "#approve");
      expect(approved.draft.approved, "package approved").toBe(true);
      const editor = page.locator("#package-editor");
      await editor.fill((await editor.inputValue()) + OWNER_ADDENDUM);
      const edited = await act(page, "#package-save");
// --- end of F140-3 test part 14 ---
      expect(edited.draft.approved, "changed approved package needs reapproval").toBe(false);
      expect(count(edited.draft.body, managed), "managed section appears once before exclude").toBe(1);
      expect(count(edited.draft.body, OWNER_BASE + OWNER_ADDENDUM), "owner text once before exclude").toBe(1);
      const excluded = await act(page, `#plugin-exclude-${PLUGIN}`);
      expect(count(excluded.draft.body, managed), "managed section absent after exclude").toBe(0);
      expect(excluded.draft.body, "owner text survives exactly").toBe(OWNER_BASE + OWNER_ADDENDUM);
      expect(await displayedPackage(page), "preview matches after exclude").toBe(excluded.draft.body);
    } finally {
      await ctx.close();
    }
// --- end of F140-3 test part 15 ---
  }, 60_000);
});
