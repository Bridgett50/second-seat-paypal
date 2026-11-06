import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import {
  chromium,
  request as pwRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createWebServer } from "../src/server.js";
import {
  createMeetingRoomService,
  type MeetingRoomService,
} from "../src/meetingRoom.js";

// F140-1: every meeting room action is bound to the browser (mr_store
// cookie) that opened the room. Private loopback server, test mode only in
// the injected service env, fake in-memory transport, no external calls.
const MARKER = "Synthetic owner A private marker";
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };
// System Chrome when PLAYWRIGHT_CHROME_PATH is set or /usr/bin/google-chrome exists; otherwise Playwright's bundled Chromium.
const CHROME_PATH = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
const CHROME_LAUNCH: { executablePath?: string } =
  process.env.PLAYWRIGHT_CHROME_PATH || existsSync(CHROME_PATH) ? { executablePath: CHROME_PATH } : {};

type ActResult = { status: number; text: string; json: Record<string, unknown> | null };

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
// --- end of F140-1 test part 1 ---

async function post(
  req: APIRequestContext,
  body: Record<string, unknown>,
): Promise<ActResult> {
  const res = await req.post(`${base}/api/meeting-room`, {
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
  return { status: res.status(), text, json };
}

async function openRoom(page: Page, search = ""): Promise<string> {
  await page.goto(`${base}/meeting-room${search}`);
  const roomId = await page.locator("#mr-root").getAttribute("data-room-id");
  if (roomId === null || roomId === "") throw new Error("room id missing from page");
  return roomId;
}

type View = {
  draft: { body: string; approved: boolean; sendState: string };
  transcript: string[];
  guidance: string[];
  twinStatus: string;
  selectedMeetingId: string;
  meetings: { id: string }[];
  plugins: { id: string; status: string }[];
};

function viewOf(r: ActResult): View {
  const snap = (r.json?.["snapshot"] ?? null) as { view: View } | null;
  if (snap === null) throw new Error(`no snapshot (status ${r.status})`);
  return snap.view;
}
// --- end of F140-1 test part 2 ---

/** A's own room, set up through A's own browser context (its cookie jar). */
async function setUpOwnerRoom(ctxA: BrowserContext, roomId: string): Promise<View> {
  const a = ctxA.request;
  const first = await post(a, { roomId, action: "state" });
  expect(first.status).toBe(200);
  const meetingId = viewOf(first).meetings[0]?.id;
  if (meetingId === undefined) throw new Error("seeded meeting missing");
  expect((await post(a, { roomId, action: "select-meeting", id: meetingId })).status).toBe(200);
  let last = -1;
  for (let i = 0; i < 20; i += 1) {
    const r = await post(a, { roomId, action: "stream-next" });
    expect(r.status).toBe(200);
    const n = viewOf(r).transcript.length;
    if (n === last) break;
    last = n;
  }
  expect((await post(a, { roomId, action: "run-plugins" })).status).toBe(200);
  const edited = await post(a, { roomId, action: "edit-draft", text: MARKER });
  expect(edited.status).toBe(200);
  const packageId = (edited.json?.["snapshot"] as { packageId?: unknown } | null)?.packageId;
  const approved = await post(a, { roomId, action: "approve", packageId });
  expect(approved.status).toBe(200);
  const view = viewOf(approved);
  expect(view.draft.body).toContain(MARKER);
  expect(view.draft.approved).toBe(true);
  return view;
}

function ordinaryActions(view: View): Record<string, unknown>[] {
  const meetingId = view.meetings[view.meetings.length - 1]?.id ?? view.selectedMeetingId;
  const pluginId = view.plugins[0]?.id ?? "unknown-plugin";
  return [
    { action: "state" },
    { action: "send" },
    { action: "edit-draft", text: "Synthetic intruder B overwrite" },
    { action: "approve" },
    { action: "compare", text: "Synthetic intruder B compare text" },
    { action: "evidence-export" },
    { action: "guide", text: "Synthetic intruder B guidance" },
    { action: "stream-next" },
    { action: "select-meeting", id: meetingId },
    { action: "run-plugins" },
    { action: "plugin-include", id: pluginId },
    { action: "plugin-exclude", id: pluginId },
    { action: "plugin-refresh", id: pluginId },
    { action: "takeover" },
  ];
}
// --- end of F140-1 test part 3 ---

const DEMO_ACTIONS: Record<string, unknown>[] = [
  { action: "state" },
  { action: "demo-next" },
  { action: "demo-restart" },
  { action: "send" },
  { action: "edit-draft", text: "Synthetic intruder B demo overwrite" },
];

function expectRefused(r: ActResult, label: string): void {
  expect([403, 404], `${label}: status`).toContain(r.status);
  expect(r.text, `${label}: response must not leak A's marker`).not.toContain(MARKER);
  expect(r.json?.["snapshot"] ?? null, `${label}: response must carry no room snapshot`).toBeNull();
}

function stateKey(v: View): string {
  return JSON.stringify({
    body: v.draft.body,
    approved: v.draft.approved,
    sendState: v.draft.sendState,
    transcript: v.transcript.length,
    guidance: v.guidance,
    twinStatus: v.twinStatus,
    meeting: v.selectedMeetingId,
    plugins: v.plugins.map((p) => `${p.id}:${p.status}`),
  });
}
// --- end of F140-1 test part 4 ---

describe("F140-1 meeting room actions are bound to their browser", () => {
  it("F140-1a another browser's cookie or no cookie cannot read or act on A's room, in any action branch", async () => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const noCookie = await pwRequest.newContext();
    try {
      const pageA = await ctxA.newPage();
      const roomA = await openRoom(pageA);
      const pageB = await ctxB.newPage();
      await openRoom(pageB);
      const cookieA = (await ctxA.cookies()).find((c) => c.name === "mr_store")?.value;
      const cookieB = (await ctxB.cookies()).find((c) => c.name === "mr_store")?.value;
      expect(cookieA, "A must get its own server cookie").toBeTruthy();
      expect(cookieB, "B must get its own server cookie").toBeTruthy();
      expect(cookieA).not.toBe(cookieB);
      const before = await setUpOwnerRoom(ctxA, roomA);
      const demoPageA = await ctxA.newPage();
      const demoA = await openRoom(demoPageA, "?demo=1");
      const demoBefore = await post(ctxA.request, { roomId: demoA, action: "state" });
      expect(demoBefore.status).toBe(200);
      const sentBefore = svc.sentBodies().length;

      for (const [who, req] of [["B cookie", ctxB.request], ["no cookie", noCookie]] as const) {
        for (const a of ordinaryActions(before)) {
          expectRefused(await post(req, { roomId: roomA, ...a }), `${who} ${String(a["action"])}`);
        }
        for (const a of DEMO_ACTIONS) {
          expectRefused(await post(req, { roomId: demoA, ...a }), `${who} demo ${String(a["action"])}`);
        }
      }

      expect(svc.sentBodies().length, "no fake transport call").toBe(sentBefore);
      expect(svc.sentBodies().length).toBe(0);
      const after = await post(ctxA.request, { roomId: roomA, action: "state" });
      expect(after.status).toBe(200);
      expect(stateKey(viewOf(after)), "A's room must be unchanged").toBe(stateKey(before));
      const demoAfter = await post(ctxA.request, { roomId: demoA, action: "state" });
      expect(demoAfter.status).toBe(200);
      expect(JSON.stringify((demoAfter.json?.["snapshot"] as { demo: unknown }).demo)).toBe(
        JSON.stringify((demoBefore.json?.["snapshot"] as { demo: unknown }).demo),
      );
      expect(stateKey(viewOf(demoAfter))).toBe(stateKey(viewOf(demoBefore)));
    } finally {
      await noCookie.dispose();
      await ctxA.close();
      await ctxB.close();
    }
  }, 120_000);
  // --- end of F140-1 test part 5 ---

  it("F140-1b the browser sends its cookie to /api/meeting-room; same-cookie tabs share; demo stays isolated", async () => {
    const ctxA = await browser.newContext();
    try {
      const tab1 = await ctxA.newPage();
      const room1 = await openRoom(tab1);
      const cookieA = (await ctxA.cookies()).find((c) => c.name === "mr_store");
      expect(cookieA, "A must get a server cookie").toBeDefined();
      const apiCookies: string[] = [];
      tab1.on("request", (r) => {
        if (new URL(r.url()).pathname === "/api/meeting-room") {
          void r.allHeaders().then((h) => apiCookies.push(h["cookie"] ?? ""));
        }
      });
      const guideText = "Synthetic same-browser guidance from tab one";
      const responsePromise = tab1.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/meeting-room",
      );
      await tab1.locator("#guidance-input").fill(guideText);
      await tab1.locator("#guidance-send").click();
      const response = await responsePromise;
      const sentHeaders = await response.request().allHeaders();
      expect(
        sentHeaders["cookie"] ?? "",
        "the browser must send its mr_store cookie to /api/meeting-room",
      ).toContain(`mr_store=${cookieA?.value}`);
      expect(response.status(), "A's own action succeeds").toBe(200);
      expect(cookieA?.httpOnly).toBe(true);
      expect(cookieA?.sameSite).toBe("Strict");
      expect(cookieA?.path).toBe("/");

      const tab2 = await ctxA.newPage();
      const room2 = await openRoom(tab2);
      expect(room2).not.toBe(room1);
      const shared = await post(ctxA.request, { roomId: room2, action: "state" });
      expect(shared.status).toBe(200);
      expect(viewOf(shared).guidance, "same-cookie tabs share the ordinary room").toContain(guideText);

      const demoTab = await ctxA.newPage();
      const demoRoom = await openRoom(demoTab, "?demo=1");
      const demoState = await post(ctxA.request, { roomId: demoRoom, action: "state" });
      expect(demoState.status).toBe(200);
      expect(viewOf(demoState).guidance, "the demo room is isolated").not.toContain(guideText);
      const demoNextPromise = demoTab.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/meeting-room",
      );
      await demoTab.locator("#demo-next").click();
      const demoNext = await demoNextPromise;
      expect(demoNext.status(), "the demo is reachable from its own browser").toBe(200);
      expect((await demoNext.request().allHeaders())["cookie"] ?? "").toContain(
        `mr_store=${cookieA?.value}`,
      );
    } finally {
      await ctxA.close();
    }
  }, 120_000);
});
