import { describe, expect, it } from "vitest";
import { buildOfflineBrief, createSessionStore } from "../src/session.js";
import { createWebServer } from "../src/server.js";

// Made-up meeting text; both A and B trigger one offline pressure item.
const A = "You owe us this favor.\nPlease send the vendor report.";
const B = "You owe us this favor.\nPlease send the revised budget instead.";

type Store = ReturnType<typeof createSessionStore>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const st = (s: unknown) => s as any;

async function toCompleted(store: Store, id: string, text: string) {
  store.setTranscript(id, text);
  await store.redact(id);
  store.approve(id, { expectedRevision: st(store.getState(id)).revision });
  return st(await store.analyze(id));
}

function errName(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).name;
  }
  return "no error";
}

describe("C1 versioned approval mutations (store)", () => {
  it("C1-3 every approval mutation with an old expectedRevision is rejected and changes nothing", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    const s0 = await toCompleted(store, id, A);
    expect(typeof s0.revision).toBe("number");
    const old = s0.revision;
    const s1 = st(store.editDraft(id, "Reply B", { expectedRevision: old }));
    expect(s1.revision).toBeGreaterThan(old);
    const before = JSON.stringify(store.getState(id));
    const p1 = s0.pressure.items[0].id;
    expect(errName(() => store.approveDraft(id, "Reply B", { expectedRevision: old }))).toBe("StaleRevisionError");
    expect(errName(() => store.approve(id, { expectedRevision: old }))).toBe("StaleRevisionError");
    expect(errName(() => store.correct(id, "x", { expectedRevision: old }))).toBe("StaleRevisionError");
    expect(
      errName(() => store.reviewPressure(id, p1, { expectedRevision: old, assessmentId: s0.pressure.assessmentId })),
    ).toBe("StaleRevisionError");
    expect(JSON.stringify(store.getState(id))).toBe(before);
  });

  it("C1-5 acknowledgement captured for A's p1 cannot review B's p1", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    const a = await toCompleted(store, id, A);
    const b = await toCompleted(store, id, B);
    expect(b.pressure.items[0].id).toBe(a.pressure.items[0].id);
    expect(b.pressure.assessmentId).not.toBe(a.pressure.assessmentId);
    expect(
      errName(() =>
        store.reviewPressure(id, a.pressure.items[0].id, {
          expectedRevision: st(store.getState(id)).revision,
          assessmentId: a.pressure.assessmentId,
        }),
      ),
    ).toBe("StaleRevisionError");
    const now = st(store.getState(id));
    expect(now.pressure.reviewed).toEqual([]);
    expect(now.pressure.allReviewed).toBe(false);
  });

  it("C1-6 reanalysis of identical text yields a new assessment; old ack rejected", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    const a = await toCompleted(store, id, A);
    const b = await toCompleted(store, id, A);
    expect(b.pressure.assessmentId).not.toBe(a.pressure.assessmentId);
    expect(
      errName(() =>
        store.reviewPressure(id, a.pressure.items[0].id, {
          expectedRevision: st(store.getState(id)).revision,
          assessmentId: a.pressure.assessmentId,
        }),
      ),
    ).toBe("StaleRevisionError");
    expect(st(store.getState(id)).pressure.reviewed).toEqual([]);
  });

  it("C1-7 unchecking Reviewed revokes the acknowledgement and draft approval", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    const a = await toCompleted(store, id, A);
    const item = a.pressure.items[0].id;
    let s = st(store.reviewPressure(id, item, { expectedRevision: a.revision, assessmentId: a.pressure.assessmentId }));
    s = st(store.editDraft(id, "Reply", { expectedRevision: s.revision }));
    s = st(store.approveDraft(id, "Reply", { expectedRevision: s.revision }));
    expect(s.draft.approved).toBe(true);
    s = st(store.unreviewPressure(id, item, { expectedRevision: s.revision, assessmentId: a.pressure.assessmentId }));
    expect(s.pressure.reviewed).toEqual([]);
    expect(s.draft.approved).toBe(false);
    expect(st(store.getState(id)).draft.approved).toBe(false);
  });

  it("C1-8 a provider that ignores cancellation cannot populate current state; its receipt stays", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const started = new Promise<void>((r) => (entered = r));
    const store = createSessionStore({
      analyzer: async (text: string) => {
        entered();
        await held; // ignores any abort
        return buildOfflineBrief(text, []);
      },
    });
    const id = store.createSession();
    store.setTranscript(id, A);
    await store.redact(id);
    store.approve(id);
    const pending = store.analyze(id);
    await started;
    store.setTranscript(id, B);
    release();
    await pending;
    const s = st(store.getState(id));
    expect(s.result).toBeNull();
    expect(s.pressure).toBeNull();
    expect(s.draft).toBeNull();
    // Offline transport has no receipt boundary (C2); the historical evidence is the superseded record.
    expect(s.superseded).toMatchObject({ approvedText: expect.stringContaining("Please send the vendor report"), status: "sent" });
  });
});

function serve(): Promise<{ base: string; close: () => void }> {
  const server = createWebServer();
  return new Promise((resolve) => {
    server.listen(0, () => {
      const a = server.address();
      const port = typeof a === "object" && a !== null ? a.port : 0;
      resolve({ base: `http://localhost:${port}`, close: () => server.close() });
    });
  });
}
async function post(base: string, path: string, body: unknown) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: st(await r.json()) };
}

describe("C1 versioned approval mutations (HTTP)", () => {
  it("C1-3 a delayed old draft-approve request is 409 and the server state is unchanged", async () => {
    const prev = process.env.SECOND_SEAT_TEST_MODE;
    process.env.SECOND_SEAT_TEST_MODE = "1";
    const { base, close } = await serve();
    try {
      const { json: c } = await post(base, "/api/session", {});
      const sessionId = c.sessionId;
      await post(base, "/api/session/transcript", { sessionId, text: A });
      let s = (await post(base, "/api/session/redact", { sessionId })).json;
      s = (await post(base, "/api/session/approve", { sessionId, expectedRevision: s.revision })).json;
      s = (await post(base, "/api/session/analyze", { sessionId })).json;
      s = (await post(base, "/api/session/draft", { sessionId, text: "Reply A", expectedRevision: s.revision })).json;
      const oldRev = s.revision; // request built for "Reply A" at this revision, then held
      s = (await post(base, "/api/session/draft", { sessionId, text: "Reply B", expectedRevision: s.revision })).json;
      const before = await (await fetch(`${base}/api/session/state?sessionId=${sessionId}`)).text();
      const late = await post(base, "/api/session/draft/approve", { sessionId, text: "Reply A", expectedRevision: oldRev });
      expect(late.status).toBe(409);
      const missing = await post(base, "/api/session/draft/approve", { sessionId, text: "Reply B" });
      expect(missing.status).toBe(400);
      const after = await (await fetch(`${base}/api/session/state?sessionId=${sessionId}`)).text();
      expect(after).toBe(before);
      expect(st(JSON.parse(after)).draft).toMatchObject({ text: "Reply B", approved: false });
    } finally {
      close();
      if (prev === undefined) delete process.env.SECOND_SEAT_TEST_MODE;
      else process.env.SECOND_SEAT_TEST_MODE = prev;
    }
  });
});
