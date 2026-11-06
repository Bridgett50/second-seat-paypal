import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import type { IncomingHttpHeaders, Server } from "node:http";
import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "@playwright/test";
import { createWebServer } from "../src/server.js";
import { createMeetingRoomService, type MeetingRoomService } from "../src/meetingRoom.js";
import { DEMO_STEPS } from "@second-seat/bot/dist/src/t2-room.js";
// --- end of F140-4 test part 1 ---

// F140-4: the guided demo never stalls at Send when sending is unavailable,
// and Restart gives a fresh demo room. Synthetic text, fake transport,
// private loopback server, awaited responses as barriers (no sleeps).
const LOOPBACK: IncomingHttpHeaders = { host: "127.0.0.1:4174" };
const PUBLIC: IncomingHttpHeaders = { host: "second-seat.example.com", "x-forwarded-host": "second-seat.example.com" };
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };
// System Chrome when PLAYWRIGHT_CHROME_PATH is set or /usr/bin/google-chrome exists; otherwise Playwright's bundled Chromium.
const CHROME_PATH = process.env.PLAYWRIGHT_CHROME_PATH || "/usr/bin/google-chrome";
const CHROME_LAUNCH: { executablePath?: string } =
  process.env.PLAYWRIGHT_CHROME_PATH || existsSync(CHROME_PATH) ? { executablePath: CHROME_PATH } : {};
const API = "/api/meeting-room";
// --- end of F140-4 test part 2 ---

type Snap = {
  roomId: string;
  demo: { completed: number; total: number; done: boolean; sendNote?: string | null } | null;
  view: { transcript: string[]; twinStatus: string; draft: { body: string; approved: boolean; sendState: string } };
};

async function step(svc: MeetingRoomService, roomId: string, action: string, headers: IncomingHttpHeaders) {
  const res = await svc.act({ roomId, action }, headers);
  return { status: res.status, snap: res.body.snapshot as unknown as Snap, notes: res.body.announcements };
}
// --- end of F140-4 test part 3 ---

/** Click Next until the guide reports done; returns every HTTP status. */
async function runGuide(svc: MeetingRoomService, roomId: string, headers: IncomingHttpHeaders) {
  const statuses: number[] = [];
  const notes: string[] = [];
  let last: Snap | null = null;
  for (let i = 0; i < 12; i += 1) {
    const r = await step(svc, roomId, "demo-next", headers);
    statuses.push(r.status);
    notes.push(...r.notes);
    last = r.snap;
    if (r.status !== 200 || r.snap.demo?.done === true) break;
  }
  return { statuses, notes, last };
}
// --- end of F140-4 test part 4 ---

describe("F140-4a public guided demo continues past Send without sending", () => {
  for (const [label, env] of [
    ["test mode absent", {}],
    ["test mode 0", { SECOND_SEAT_TEST_MODE: "0" }],
  ] as const) {
    it(`F140-4a ${label}: Next reaches the honest final state`, async () => {
      const svc = createMeetingRoomService({ env });
      const page = svc.open("?demo=1", PUBLIC, randomUUID());
      expect(page.fakeSend, "public demo cannot send").toBe(false);
      const run = await runGuide(svc, page.roomId, PUBLIC);
// --- end of F140-4 test part 5 ---
      expect(run.statuses, "every Next succeeds past step 5").toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200]);
      const last = run.last as Snap;
      expect(last.demo?.completed, "all nine steps completed").toBe(9);
      expect(last.demo?.done, "guide finished").toBe(true);
      expect(last.demo?.sendNote ?? "", "visible not-sent explanation").toContain("not sent");
      expect(run.notes.join("\n"), "announced as not sent").toContain("not sent");
      expect(svc.sentBodies(), "zero fake transport calls").toEqual([]);
// --- end of F140-4 test part 6 ---
      expect(last.view.draft.approved, "approval is real and kept").toBe(true);
      expect(last.view.draft.sendState, "package stays unsent, no receipt").toBe("unsent");
      expect(last.view.twinStatus, "takeover really paused the twin").toBe("paused (you took over)");
      const evidence = await svc.act({ roomId: page.roomId, action: "evidence-export" }, PUBLIC);
      expect(evidence.status, "evidence export allowed").toBe(200);
      const send = await svc.act({ roomId: page.roomId, action: "send" }, PUBLIC);
      expect(send.status, "direct Send stays refused").toBe(403);
      expect(svc.sentBodies(), "still zero transport calls").toEqual([]);
    });
  }
// --- end of F140-4 test part 7 ---

  it("F140-4a browser: the Next control reaches the honest final state", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const server: Server = createWebServer({ meetingRoom: svc } as Parameters<typeof createWebServer>[0]);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const browser: Browser = await chromium.launch({ ...CHROME_LAUNCH, headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${base}/meeting-room?demo=1`);
// --- end of F140-4 test part 8 ---
      const statuses: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        if (await page.locator("#demo-next").isDisabled()) break;
        const pending = page.waitForResponse((r) => new URL(r.url()).pathname === API && r.request().method() === "POST");
        await page.locator("#demo-next").click();
        statuses.push((await pending).status());
      }
      expect(statuses, "every Next click succeeds").toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200]);
// --- end of F140-4 test part 9 ---
      expect(await page.locator("#demo-progress").textContent(), "progress shows 9 of 9").toBe("9 / 9");
      expect(await page.locator("#demo-status").textContent(), "honest final caption").toBe("Demo complete");
      expect(await page.locator("#demo-send-note").textContent(), "visible not-sent note").toContain("not sent");
      expect(await page.locator("#demo-next").isDisabled(), "Next disabled at the end").toBe(true);
      expect(svc.sentBodies(), "zero fake transport calls").toEqual([]);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);
});
// --- end of F140-4 test part 10 ---

describe("F140-4b demo restart gives a fresh demo room", () => {
  it("F140-4b test mode 1: restart resets the real room and a second run sends once more", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const page = svc.open("?demo=1", LOOPBACK, randomUUID());
    const first = await runGuide(svc, page.roomId, LOOPBACK);
    expect(first.statuses, "first run completes").toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200]);
    expect(svc.sentBodies().length, "exactly one fake send").toBe(1);
    expect(first.last?.view.draft.sendState, "first run sent").toBe("sent");
// --- end of F140-4 test part 11 ---
    const restarted = await step(svc, page.roomId, "demo-restart", LOOPBACK);
    expect(restarted.status, "restart allowed").toBe(200);
    expect(restarted.snap.roomId, "same demo page").toBe(page.roomId);
    expect(restarted.snap.view.twinStatus, "twin active again").toBe("active");
    expect(restarted.snap.view.draft.approved, "package unapproved").toBe(false);
    expect(restarted.snap.view.draft.sendState, "package unsent, no prior receipt").toBe("unsent");
    expect(restarted.snap.view.transcript, "empty transcript").toEqual([]);
    expect(restarted.snap.demo?.completed, "zero progress").toBe(0);
    expect(restarted.snap.demo?.sendNote ?? null, "no carried-over send note").toBeNull();
// --- end of F140-4 test part 12 ---
    for (let i = 0; i < 3; i += 1) await step(svc, page.roomId, "demo-next", LOOPBACK);
    const streamed = await step(svc, page.roomId, "state", LOOPBACK);
    expect(streamed.snap.view.transcript.length, "fresh transcript streamed").toBeGreaterThan(0);
    const second = await runGuide(svc, page.roomId, LOOPBACK);
    expect(second.statuses.every((s) => s === 200), "second run completes").toBe(true);
    expect(second.last?.demo?.completed, "second run reaches nine").toBe(9);
    expect(second.last?.view.draft.sendState, "second run really sent").toBe("sent");
// --- end of F140-4 test part 13 ---
    const sent = svc.sentBodies();
    expect(sent.length, "exactly one additional fake call").toBe(2);
    expect(sent[1], "second send is the fresh run's package").toBe(second.last?.view.draft.body);
    expect(second.last?.view.twinStatus, "second takeover paused the fresh twin").toBe("paused (you took over)");
  });
// --- end of F140-4 test part 14 ---

  it("F140-4b public restart leaves the same browser's ordinary room unchanged", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const key = randomUUID();
    const ordinary = svc.open("", LOOPBACK, key);
    for (let i = 0; i < 3; i += 1) await svc.act({ roomId: ordinary.roomId, action: "stream-next" }, LOOPBACK);
    await svc.act({ roomId: ordinary.roomId, action: "approve" }, LOOPBACK);
    const sendRes = await svc.act({ roomId: ordinary.roomId, action: "send" }, LOOPBACK);
    expect(sendRes.status, "ordinary send works in test mode").toBe(200);
// --- end of F140-4 test part 15 ---
    const demo = svc.open("?demo=1", PUBLIC, key);
    const run = await runGuide(svc, demo.roomId, PUBLIC);
    expect(run.last?.demo?.done, "public guide completes").toBe(true);
    const restarted = await step(svc, demo.roomId, "demo-restart", PUBLIC);
    expect(restarted.status, "public restart allowed").toBe(200);
    expect(restarted.snap.view.twinStatus, "public demo twin active again").toBe("active");
    const after = await step(svc, ordinary.roomId, "state", LOOPBACK);
    expect(after.snap.view.draft.approved, "ordinary room still approved").toBe(true);
    expect(after.snap.view.draft.sendState, "ordinary room still sent").toBe("sent");
    expect(svc.sentBodies().length, "no extra transport call").toBe(1);
  });
});
// --- end of F140-4 test part 15b ---

describe("F140-4c guided compare and evidence steps return and keep their results", () => {
  it("F140-4c service: steps 7 and 8 return the comparison and the unsent evidence, kept after takeover", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const page = svc.open("?demo=1", PUBLIC, randomUUID());
    let approvedSha = "";
    for (let i = 0; i < 6; i += 1) {
      const r = await svc.act({ roomId: page.roomId, action: "demo-next" }, PUBLIC);
      expect(r.status, `step ${i + 1} succeeds`).toBe(200);
      if (i === 4) approvedSha = (r.body.snapshot as unknown as { view: { draft: { sha256: string } } }).view.draft.sha256;
    }
    expect(approvedSha, "step 5 approved a package").not.toBe("");
    // --- end of F140-4 test part 16 ---
    const s7 = await svc.act({ roomId: page.roomId, action: "demo-next" }, PUBLIC);
    expect(s7.status, "step 7 succeeds").toBe(200);
    const cmp = s7.body.comparison as { identical?: boolean; flags?: unknown[] } | null | undefined;
    expect(cmp, "step 7 returns a comparison").toBeTruthy();
    expect(cmp?.identical, "approved package matches its own export").toBe(true);
    expect(cmp?.flags, "no mismatch flags").toEqual([]);
    const s8 = await svc.act({ roomId: page.roomId, action: "demo-next" }, PUBLIC);
    expect(s8.status, "step 8 succeeds").toBe(200);
    expect(typeof s8.body.evidenceJson, "step 8 returns evidence JSON").toBe("string");
    const ev = JSON.parse(s8.body.evidenceJson as string) as { packageHash: string; sendState: string; sentAt: number | null };
    expect(ev.packageHash, "evidence names the approved package").toBe(approvedSha);
    expect(ev.sendState, "evidence records the package as unsent").toBe("unsent");
    expect(ev.sentAt, "no send receipt").toBeNull();
    expect(svc.sentBodies(), "zero fake transport calls").toEqual([]);
    // --- end of F140-4 test part 17 ---
    const s9 = await svc.act({ roomId: page.roomId, action: "demo-next" }, PUBLIC);
    expect(s9.status, "takeover step succeeds").toBe(200);
    const demo = (s9.body.snapshot as unknown as { demo: { done: boolean; comparison?: unknown; evidenceJson?: string | null } }).demo;
    expect(demo.done, "guide finished").toBe(true);
    expect(demo.comparison, "comparison kept after takeover").toEqual(s7.body.comparison);
    expect(demo.evidenceJson, "evidence kept after takeover").toBe(s8.body.evidenceJson);
    // --- end of F140-4 test part 18 ---
  });

  it("F140-4c browser: steps 7 and 8 show the comparison and the unsent evidence, kept after takeover", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const server: Server = createWebServer({ meetingRoom: svc } as Parameters<typeof createWebServer>[0]);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const browser: Browser = await chromium.launch({ ...CHROME_LAUNCH, headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${base}/meeting-room?demo=1`);
      const next = async (n: number) => {
        const pending = page.waitForResponse((r) => new URL(r.url()).pathname === API && r.request().method() === "POST");
        await page.locator("#demo-next").click();
        expect((await pending).status(), `Next ${n} succeeds`).toBe(200);
        await page.locator("#demo-progress", { hasText: `${n} / 9` }).waitFor();
      };
      for (let n = 1; n <= 7; n += 1) await next(n);
      const cmpText = (await page.locator("#compare-result").textContent()) ?? "";
      expect(cmpText, "step 7 shows a comparison in the page").not.toBe("");
      const cmp = JSON.parse(cmpText) as { identical?: boolean; flags?: unknown[] };
      expect(cmp.identical, "shown comparison matches the approved package").toBe(true);
      expect(cmp.flags, "no mismatch flags shown").toEqual([]);
      // --- end of F140-4 test part 19 ---
      await next(8);
      const evText = (await page.locator("#evidence-json").textContent()) ?? "";
      expect(evText, "step 8 shows the evidence record in the page").not.toBe("");
      const ev = JSON.parse(evText) as { packageHash: string; sendState: string; sentAt: number | null };
      const shaLine = (await page.locator("p", { hasText: "sha256: " }).first().textContent()) ?? "";
      expect(ev.packageHash, "shown evidence names the approved package").toBe(shaLine.replace("sha256: ", "").trim());
      expect(ev.sendState, "shown evidence records the package as unsent").toBe("unsent");
      expect(ev.sentAt, "no send receipt").toBeNull();
      expect(await page.locator("#mr-approval-state").textContent(), "page shows approved and unsent").toContain("Send: unsent");
      expect(svc.sentBodies(), "zero fake transport calls").toEqual([]);
      await next(9);
      expect(await page.locator("#demo-status").textContent(), "honest final caption").toBe("Demo complete");
      expect(await page.locator("#compare-result").textContent(), "comparison kept after takeover").toBe(cmpText);
      expect(await page.locator("#evidence-json").textContent(), "evidence kept after takeover").toBe(evText);
      // --- end of F140-4 test part 20 ---
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);
});

// F140-4f: overlapping Next calls around Send. The Send check must see the
// step the call really acts on, so it cannot send on a public demo.
describe("F140-4f overlapping Next calls around Send cannot bypass or duplicate the send", () => {
  it("F140-4f public demo: two overlapping Next calls at the approve step approve once and skip Send without sending", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const page = svc.open("?demo=1", PUBLIC, randomUUID());
    for (let i = 0; i < 4; i += 1) await step(svc, page.roomId, "demo-next", PUBLIC);
    const [a, b] = await Promise.all([
      step(svc, page.roomId, "demo-next", PUBLIC),
      step(svc, page.roomId, "demo-next", PUBLIC),
    ]);
    expect([a.status, b.status], "both Next calls succeed").toEqual([200, 200]);
    expect(svc.sentBodies(), "zero fake transport calls on a public demo").toEqual([]);
    const state = await step(svc, page.roomId, "state", PUBLIC);
    expect(state.snap.demo?.completed, "approve and Send each counted once").toBe(6);
    expect(state.snap.demo?.sendNote ?? "", "Send recorded as not sent").toContain("not sent");
    expect(state.snap.view.draft.sendState, "package stays unsent").toBe("unsent");
    expect(b.notes.join("\n"), "second call announces not sent").toContain("not sent");
  });

  it("F140-4f test mode: three overlapping Next calls from the approve step send exactly once", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const page = svc.open("?demo=1", LOOPBACK, randomUUID());
    for (let i = 0; i < 4; i += 1) await step(svc, page.roomId, "demo-next", LOOPBACK);
    const results = await Promise.all([
      step(svc, page.roomId, "demo-next", LOOPBACK),
      step(svc, page.roomId, "demo-next", LOOPBACK),
      step(svc, page.roomId, "demo-next", LOOPBACK),
    ]);
    expect(results.map((r) => r.status), "all three Next calls succeed").toEqual([200, 200, 200]);
    expect(svc.sentBodies().length, "exactly one fake send").toBe(1);
    const state = await step(svc, page.roomId, "state", LOOPBACK);
    expect(state.snap.demo?.completed, "approve, Send and compare each counted once").toBe(7);
    expect(state.snap.view.draft.sendState, "package sent once").toBe("sent");
    expect(svc.sentBodies()[0], "the approved package was sent").toBe(state.snap.view.draft.body);
  });

  it("F140-4f route: two overlapping Next requests over HTTP at the approve step skip Send without sending", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const server: Server = createWebServer({ meetingRoom: svc } as Parameters<typeof createWebServer>[0]);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const browser: Browser = await chromium.launch({ ...CHROME_LAUNCH, headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${base}/meeting-room?demo=1`);
      const roomId = await page.locator("#mr-root").getAttribute("data-room-id");
      const post = async (action: string) => {
        const res = await page.request.post(`${base}${API}`, {
          data: { roomId, action },
          headers: { "content-type": "application/json" },
        });
        return { status: res.status(), json: (await res.json()) as { snapshot: Snap; announcements: string[] } };
      };
      for (let i = 0; i < 4; i += 1) expect((await post("demo-next")).status, `Next ${i + 1} succeeds`).toBe(200);
      const [a, b] = await Promise.all([post("demo-next"), post("demo-next")]);
      expect([a.status, b.status], "both Next requests succeed").toEqual([200, 200]);
      expect(svc.sentBodies(), "zero fake transport calls through the route").toEqual([]);
      const state = await post("state");
      expect(state.json.snapshot.demo?.completed, "approve and Send each counted once").toBe(6);
      expect(state.json.snapshot.demo?.sendNote ?? "", "Send recorded as not sent").toContain("not sent");
      expect(state.json.snapshot.view.draft.sendState, "package stays unsent").toBe("unsent");
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);

  it("F140-4f test mode: Restart while Next calls are queued leaves no older room operation acting afterwards", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const page = svc.open("?demo=1", LOOPBACK, randomUUID());
    for (let i = 0; i < 4; i += 1) await step(svc, page.roomId, "demo-next", LOOPBACK);
    const [a, b, r] = await Promise.all([
      step(svc, page.roomId, "demo-next", LOOPBACK),
      step(svc, page.roomId, "demo-next", LOOPBACK),
      step(svc, page.roomId, "demo-restart", LOOPBACK),
    ]);
    expect([a.status, b.status, r.status], "all calls answer").toEqual([200, 200, 200]);
    expect(svc.sentBodies(), "no send from a Next queued before Restart").toEqual([]);
    const state = await step(svc, page.roomId, "state", LOOPBACK);
    expect(state.snap.demo?.completed, "fresh demo has zero progress").toBe(0);
    expect(state.snap.demo?.sendNote ?? null, "no carried-over send note").toBeNull();
    expect(state.snap.view.draft.approved, "fresh package unapproved").toBe(false);
    expect(state.snap.view.draft.sendState, "fresh package unsent").toBe("unsent");
  });

  it("F140-4f test mode: a Next held inside the old demo across Restart answers with the fresh room at 0 of 9", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const page = svc.open("?demo=1", LOOPBACK, randomUUID());
    for (let i = 0; i < 2; i += 1) await step(svc, page.roomId, "demo-next", LOOPBACK);
    const streamStep = DEMO_STEPS[2]!;
    expect(streamStep.id, "step 3 is the stream step").toBe("demo-stream");
    const original = streamStep.run.bind(streamStep);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const spy = vi.spyOn(streamStep, "run").mockImplementationOnce(async (r) => {
      markStarted();
      await gate;
      return original(r);
    });
    try {
      const held = step(svc, page.roomId, "demo-next", LOOPBACK);
      await started;
      const restarted = await step(svc, page.roomId, "demo-restart", LOOPBACK);
      expect(restarted.status, "restart allowed").toBe(200);
      release();
      const answer = await held;
      expect(answer.status, "the held Next answers").toBe(200);
      expect(answer.snap.roomId, "same demo page").toBe(page.roomId);
      expect(answer.snap.demo?.completed, "fresh room: 0 steps done").toBe(0);
      expect(answer.snap.demo?.total, "of 9 steps").toBe(9);
      expect(answer.snap.demo?.done, "fresh demo not done").toBe(false);
      expect(answer.snap.view.transcript, "fresh room: nothing streamed").toEqual([]);
      expect(answer.snap.view.draft.approved, "fresh package unapproved").toBe(false);
      expect(answer.snap.view.draft.sendState, "fresh package unsent").toBe("unsent");
      expect(answer.notes, "no announcements from the old demo").toEqual([]);
      expect(spy, "the held stream step ran once, on the old room only").toHaveBeenCalledTimes(1);
      const state = await step(svc, page.roomId, "state", LOOPBACK);
      expect(state.snap.view.transcript, "the fresh room stays unstreamed").toEqual([]);
      expect(state.snap.demo?.completed, "fresh demo still at 0").toBe(0);
      expect(svc.sentBodies(), "nothing sent").toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
