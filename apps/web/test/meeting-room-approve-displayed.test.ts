import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import {
  chromium,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { createWebServer } from "../src/server.js";
import {
  createMeetingRoomService,
  type MeetingRoomService,
} from "../src/meetingRoom.js";

// F140-2: Approve and Send are bound to the package the page displayed.
// Private loopback server, test mode only in the injected service env, fake
// in-memory transport, synthetic text only, barriers instead of sleeps.
const VERSION_A = "Synthetic version A reviewed in tab A";
const VERSION_B = "Synthetic version B edited only in tab B";
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };
// System Chrome when PLAYWRIGHT_CHROME_PATH is set or /usr/bin/google-chrome exists; otherwise Playwright's bundled Chromium.
const CHROME_PATH = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
const CHROME_LAUNCH: { executablePath?: string } =
  process.env.PLAYWRIGHT_CHROME_PATH || existsSync(CHROME_PATH) ? { executablePath: CHROME_PATH } : {};
const API = "/api/meeting-room";

type ActResult = { status: number; json: Record<string, unknown> | null };
type View = {
  draft: { body: string; approved: boolean; sendState: string };
  selectedMeetingId: string;
  meetings: { id: string }[];
};

let svc: MeetingRoomService;
let server: Server;
let base = "";
let browser: Browser;

beforeAll(async () => {
  svc = createMeetingRoomService({ env: TEST_ENV });
  server = createWebServer({ meetingRoom: svc } as Parameters<typeof createWebServer>[0]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ ...CHROME_LAUNCH, headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});
// --- end of F140-2 test part 1 ---

async function post(req: APIRequestContext, body: Record<string, unknown>): Promise<ActResult> {
  const res = await req.post(`${base}${API}`, {
    data: body,
    headers: { "content-type": "application/json" },
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status(), json };
}

function viewOf(r: ActResult): View {
  const snap = (r.json?.["snapshot"] ?? null) as { view: View } | null;
  if (snap === null) throw new Error(`no snapshot (status ${r.status})`);
  return snap.view;
}

function packageIdOf(r: ActResult): unknown {
  return ((r.json?.["snapshot"] ?? null) as { packageId?: unknown } | null)?.packageId;
}

async function openRoom(page: Page): Promise<string> {
  await page.goto(`${base}/meeting-room`);
  const roomId = await page.locator("#mr-root").getAttribute("data-room-id");
  if (roomId === null || roomId === "") throw new Error("room id missing from page");
  return roomId;
}

/** Shared room for one browser context: first meeting, streamed, plugins run. */
async function prepareRoom(ctx: BrowserContext, page: Page): Promise<string> {
  const roomId = await openRoom(page);
  const req = ctx.request;
  const first = await post(req, { roomId, action: "state" });
  expect(first.status).toBe(200);
  const meetingId = viewOf(first).meetings[0]?.id;
  if (meetingId === undefined) throw new Error("seeded meeting missing");
  expect((await post(req, { roomId, action: "select-meeting", id: meetingId })).status).toBe(200);
  let last = -1;
  for (let i = 0; i < 20; i += 1) {
    const r = await post(req, { roomId, action: "stream-next" });
    expect(r.status).toBe(200);
    const n = (viewOf(r) as unknown as { transcript: string[] }).transcript.length;
    if (n === last) break;
    last = n;
  }
  expect((await post(req, { roomId, action: "run-plugins" })).status).toBe(200);
  return openRoom(page);
}
// --- end of F140-2 test part 2 ---

function isApi(url: string): boolean {
  return new URL(url).pathname === API;
}

/** Click a rendered control and wait for its /api/meeting-room response. */
async function clickAndWait(page: Page, selector: string): Promise<ActResult> {
  const pending = page.waitForResponse((r) => isApi(r.url()) && r.request().method() === "POST");
  await page.locator(selector).first().click();
  const res = await pending;
  return { status: res.status(), json: (await res.json()) as Record<string, unknown> };
}

async function saveViaUi(page: Page, text: string): Promise<void> {
  await page.locator("#package-editor").fill(text);
  const r = await clickAndWait(page, "#package-save");
  expect(r.status, "save succeeds").toBe(200);
}

async function displayedPackage(page: Page): Promise<string> {
  return (await page.locator('section[aria-labelledby="mr-package-heading"] pre').first().textContent()) ?? "";
}

async function sharedView(ctx: BrowserContext, roomId: string): Promise<View> {
  const r = await post(ctx.request, { roomId, action: "state" });
  expect(r.status).toBe(200);
  return viewOf(r);
}

/** Hold the next POST of `action` from `page` until release() is called. */
async function holdAction(page: Page, action: string): Promise<{ held: Promise<void>; release: () => Promise<void> }> {
  let routeRef: Route | null = null;
  let markHeld: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  await page.route(`**${API}`, async (route) => {
    const data = route.request().postData() ?? "";
    if (routeRef === null && data.includes(`"action":"${action}"`)) {
      routeRef = route;
      markHeld();
      return;
    }
    await route.continue();
  });
  return {
    held,
    release: async () => {
      if (routeRef === null) throw new Error("nothing held");
      await routeRef.continue();
    },
  };
}

/** Let the page run queued tasks (response handlers) after a response. */
async function settle(page: Page): Promise<void> {
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))");
}
// --- end of F140-2 test part 3 ---

describe("F140-2 Approve and Send are bound to the displayed package", () => {
  it("F140-2a a still-rendered Approve in tab A cannot approve a package only tab B saw", async () => {
    const ctx = await browser.newContext();
    try {
      const tabA = await ctx.newPage();
      const roomA = await prepareRoom(ctx, tabA);
      await saveViaUi(tabA, VERSION_A);
      expect(await displayedPackage(tabA)).toContain(VERSION_A);
      const tabB = await ctx.newPage();
      const roomB = await openRoom(tabB);
      await saveViaUi(tabB, VERSION_B);
      const sentBefore = svc.sentBodies().length;

      // 1. Text change in tab B; tab A still shows version A.
      expect(await displayedPackage(tabA)).toContain(VERSION_A);
      const stale = await clickAndWait(tabA, "#approve");
      const afterText = await sharedView(ctx, roomB);
      expect(afterText.draft.approved, "A's Approve must not approve B's unseen text").toBe(false);
      expect(stale.status, "stale displayed package").toBe(409);

      // 2. Plugin inclusion in tab B after tab A re-rendered.
      await tabA.reload();
      expect(await displayedPackage(tabA)).toContain(VERSION_B);
      const beforePlugin = afterText.draft.body;
      const inc = await clickAndWait(tabB, '[data-mr-action="plugin-include"]');
      expect(inc.status).toBe(200);
      expect(viewOf(inc).draft.body, "plugin inclusion changes the package").not.toBe(beforePlugin);
      const stalePlugin = await clickAndWait(tabA, "#approve");
      expect((await sharedView(ctx, roomB)).draft.approved, "unseen plugin inclusion").toBe(false);
      expect(stalePlugin.status).toBe(409);

      // 3. Selected-meeting change in tab B.
      await tabA.reload();
      const meetings = afterText.meetings.map((m) => m.id);
      const original = afterText.selectedMeetingId;
      const other = meetings.find((id) => id !== original);
      if (other === undefined) throw new Error("second seeded meeting missing");
      const picked = tabB.waitForResponse((r) => isApi(r.url()));
      await tabB.locator("#meeting-picker").selectOption(other);
      expect((await picked).status()).toBe(200);
      const staleMeeting = await clickAndWait(tabA, "#approve");
      expect((await sharedView(ctx, roomB)).draft.approved, "unseen meeting change").toBe(false);
      expect(staleMeeting.status).toBe(409);
      const back = tabB.waitForResponse((r) => isApi(r.url()));
      await tabB.locator("#meeting-picker").selectOption(original);
      expect((await back).status()).toBe(200);
      expect(svc.sentBodies().length, "no transport call for any stale Approve").toBe(sentBefore);
      // --- F140-2a continues in part 5 ---

      // 4. Refresh A, approve the displayed B package, keep it across reload, send once.
      await tabA.reload();
      const shown = await displayedPackage(tabA);
      expect(shown).toContain(VERSION_B);
      const ok = await clickAndWait(tabA, "#approve");
      expect(ok.status).toBe(200);
      expect(viewOf(ok).draft.approved).toBe(true);
      await tabA.reload();
      expect(await tabA.locator("#mr-approval-state").textContent()).toContain("Approved: yes");
      const composed = (await sharedView(ctx, roomA)).draft.body;
      expect(composed).toBe(shown);
      const sent = await clickAndWait(tabA, "#send");
      expect(sent.status).toBe(200);
      expect(svc.sentBodies().length, "exactly one fake transport call").toBe(sentBefore + 1);
      expect(svc.sentBodies()[sentBefore], "the exact displayed B package").toBe(composed);
    } finally {
      await ctx.close();
    }
  }, 120_000);
// --- end of F140-2 test part 5 ---

  it("F140-2b missing, forged, stale or held identities cannot approve or send; a valid double Send sends once", async () => {
    const ctx = await browser.newContext();
    try {
      const tabA = await ctx.newPage();
      const roomA = await prepareRoom(ctx, tabA);
      await saveViaUi(tabA, VERSION_A);
      expect((await clickAndWait(tabA, "#approve")).status).toBe(200);
      const sentBefore = svc.sentBodies().length;

      // Held Send: A's request is held before the server sees it while tab B
      // changes the shared package and approves its own displayed revision.
      const hold = await holdAction(tabA, "send");
      const sendDone = tabA.waitForResponse((r) => isApi(r.url()));
      sendDone.catch(() => undefined);
      await tabA.locator("#send").click();
      await hold.held;
      const tabB = await ctx.newPage();
      await openRoom(tabB);
      await saveViaUi(tabB, VERSION_B);
      expect((await clickAndWait(tabB, "#approve")).status).toBe(200);
      await hold.release();
      const heldRes = await sendDone;
      await settle(tabA);
      expect(svc.sentBodies().length, "a held Send must not send a package tab A never displayed").toBe(sentBefore);
      expect(heldRes.status()).toBe(409);
      await tabA.unroute(`**${API}`);

      // Missing, malformed, forged and stale identities over HTTP.
      const req = ctx.request;
      const cur = await post(req, { roomId: roomA, action: "state" });
      const pid = packageIdOf(cur);
      expect(typeof pid).toBe("string");
      const meeting = viewOf(cur).selectedMeetingId;
      for (const action of ["approve", "send"]) {
        expect((await post(req, { roomId: roomA, action })).status, `${action} missing`).toBe(400);
        expect((await post(req, { roomId: roomA, action, packageId: "x" })).status, `${action} malformed`).toBe(400);
        expect((await post(req, { roomId: roomA, action, packageId: 7 })).status, `${action} non-string`).toBe(400);
        expect(
          (await post(req, { roomId: roomA, action, packageId: `${meeting}:${"0".repeat(64)}` })).status,
          `${action} forged`,
        ).toBe(409);
      }
      const edited = await post(req, { roomId: roomA, action: "edit-draft", text: VERSION_A });
      expect(edited.status).toBe(200);
      for (const action of ["approve", "send"]) {
        expect((await post(req, { roomId: roomA, action, packageId: pid })).status, `${action} stale`).toBe(409);
      }
      expect((await sharedView(ctx, roomA)).draft.approved).toBe(false);
      expect(svc.sentBodies().length, "no transport call for refused identities").toBe(sentBefore);
      // --- F140-2b continues in part 7 ---

      // A valid concurrent double Send produces exactly one fake call.
      const fresh = packageIdOf(edited);
      expect((await post(req, { roomId: roomA, action: "approve", packageId: fresh })).status).toBe(200);
      const both = await Promise.all([
        post(req, { roomId: roomA, action: "send", packageId: fresh }),
        post(req, { roomId: roomA, action: "send", packageId: fresh }),
      ]);
      expect(both.every((r) => r.status === 200 || r.status === 409)).toBe(true);
      expect(svc.sentBodies().length, "exactly one fake call after both settle").toBe(sentBefore + 1);
      expect(svc.sentBodies()[sentBefore]).toBe((await sharedView(ctx, roomA)).draft.body);
    } finally {
      await ctx.close();
    }
  }, 120_000);
// --- end of F140-2 test part 7 ---

  it("F140-2c an unsaved editor change disables outgoing controls; an older response cannot restore them", async () => {
    const ctx = await browser.newContext();
    try {
      const tabA = await ctx.newPage();
      const roomA = await prepareRoom(ctx, tabA);
      await saveViaUi(tabA, VERSION_A);
      expect((await clickAndWait(tabA, "#approve")).status).toBe(200);
      expect(await tabA.locator("#evidence-mailto").count(), "approved package offers mailto").toBe(1);
      expect(await tabA.locator("#evidence-copy").count(), "approved package offers copy text").toBe(1);
      const outgoing: string[] = [];
      tabA.on("request", (r) => {
        if (!isApi(r.url())) return;
        const m = /"action":"([a-z-]+)"/.exec(r.postData() ?? "");
        const a = m?.[1] ?? "";
        if (a === "approve" || a === "send" || a === "evidence-export") outgoing.push(a);
      });
      const hold = await holdAction(tabA, "stream-next");
      const olderDone = tabA.waitForResponse((r) => isApi(r.url()));
      olderDone.catch(() => undefined);
      await tabA.locator("#stream-next").click();
      await hold.held;

      const unsaved = `${VERSION_A} plus a synthetic unsaved local edit`;
      await tabA.locator("#package-editor").fill(unsaved);
      const expectLocked = async (label: string): Promise<void> => {
        expect(await tabA.locator("#approve").isDisabled(), `${label}: Approve disabled`).toBe(true);
        expect(await tabA.locator("#send").isDisabled(), `${label}: Send disabled`).toBe(true);
        expect(await tabA.locator("#evidence-export").isDisabled(), `${label}: export disabled`).toBe(true);
        expect(await tabA.locator("#evidence-mailto").count(), `${label}: mailto cleared`).toBe(0);
        expect(await tabA.locator("#evidence-copy").count(), `${label}: copy text cleared`).toBe(0);
      };
      await expectLocked("on input");
      for (const id of ["approve", "send", "evidence-export"]) {
        await tabA.evaluate(`document.getElementById(${JSON.stringify(id)})?.click()`);
      }
      await settle(tabA);
      expect(outgoing, "no outgoing action dispatched while dirty").toEqual([]);

      await hold.release();
      await olderDone;
      await settle(tabA);
      await tabA.unroute(`**${API}`);
      await expectLocked("after the older response");
      expect(await tabA.locator("#package-editor").inputValue(), "the unsaved edit stays").toBe(unsaved);
      const server = await post(ctx.request, { roomId: roomA, action: "state" });
      const snap = server.json?.["snapshot"] as { copyText: unknown } | undefined;
      expect(snap?.copyText ?? null, "server evidence is not removed by a dirty editor").not.toBeNull();
      expect(outgoing).toEqual([]);

      const saved = await clickAndWait(tabA, "#package-save");
      expect(saved.status).toBe(200);
      expect(await tabA.locator("#approve").isDisabled(), "Approve re-enabled after save").toBe(false);
      expect(await tabA.locator("#mr-approval-state").textContent()).toContain("Approved: no");
      expect(await displayedPackage(tabA)).toContain(unsaved);
      expect((await clickAndWait(tabA, "#approve")).status).toBe(200);
      expect(outgoing).toEqual(["approve"]);
    } finally {
      await ctx.close();
    }
  }, 120_000);
// --- end of F140-2 test part 8 ---

  it("F140-2d an unrelated response after an unsaved edit keeps the edit and the outgoing lock until Save", async () => {
    const ctx = await browser.newContext();
    try {
      const tabA = await ctx.newPage();
      const roomA = await prepareRoom(ctx, tabA);
      await saveViaUi(tabA, VERSION_A);
      expect((await clickAndWait(tabA, "#approve")).status).toBe(200);
      expect(await tabA.locator("#evidence-copy").count(), "approved package offers copy text").toBe(1);
      const sentBefore = svc.sentBodies().length;
      const outgoing: string[] = [];
      tabA.on("request", (r) => {
        if (!isApi(r.url())) return;
        const m = /"action":"([a-z-]+)"/.exec(r.postData() ?? "");
        const a = m?.[1] ?? "";
        if (a === "approve" || a === "send" || a === "evidence-export") outgoing.push(a);
      });
      const unsaved = "Synthetic unsaved owner correction";
      await tabA.locator("#package-editor").fill(unsaved);
      await tabA.locator("#compare-input").fill("Synthetic imported comparison text");
      const cmp = await clickAndWait(tabA, "#compare-run");
      expect(cmp.status, "Compare succeeds").toBe(200);
      await settle(tabA);
      // --- end of F140-2 test part 9 ---
      expect(await tabA.locator("#package-editor").inputValue(), "the unsaved edit survives Compare").toBe(unsaved);
      expect(await tabA.locator("#approve").isDisabled(), "Approve disabled after Compare").toBe(true);
      expect(await tabA.locator("#send").isDisabled(), "Send disabled after Compare").toBe(true);
      expect(await tabA.locator("#evidence-export").isDisabled(), "export disabled after Compare").toBe(true);
      expect(await tabA.locator("#evidence-mailto").count(), "mailto cleared after Compare").toBe(0);
      expect(await tabA.locator("#evidence-copy").count(), "copy text cleared after Compare").toBe(0);
      for (const id of ["approve", "send", "evidence-export"]) {
        await tabA.evaluate(`document.getElementById(${JSON.stringify(id)})?.click()`);
      }
      await settle(tabA);
      expect(outgoing, "no outgoing action dispatched while dirty").toEqual([]);
      expect(svc.sentBodies().length, "zero transport calls while dirty").toBe(sentBefore);
      // --- end of F140-2 test part 10 ---
      const saved = await clickAndWait(tabA, "#package-save");
      expect(saved.status, "Save B succeeds").toBe(200);
      expect(await tabA.locator("#mr-approval-state").textContent()).toContain("Approved: no");
      expect(await displayedPackage(tabA)).toContain(unsaved);
      expect((await clickAndWait(tabA, "#approve")).status, "explicit approve of B").toBe(200);
      const composed = (await sharedView(ctx, roomA)).draft.body;
      expect(composed).toContain(unsaved);
      expect((await clickAndWait(tabA, "#send")).status).toBe(200);
      expect(svc.sentBodies().length, "exactly one fake Send").toBe(sentBefore + 1);
      expect(svc.sentBodies()[sentBefore], "the Send carries exactly the saved B package").toBe(composed);
      expect(svc.sentBodies()[sentBefore], "the old approved A text is not sent").not.toContain(VERSION_A);
      expect(outgoing).toEqual(["approve", "send"]);
    } finally {
      await ctx.close();
    }
  }, 120_000);
// --- end of F140-2 test part 11 ---
});
