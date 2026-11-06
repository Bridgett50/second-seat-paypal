import { describe, expect, it } from "vitest";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { createMeetWorkerBridge, type Capture } from "../src/meetWorkerBridge.js";
type Scope = Parameters<Parameters<typeof createMeetWorkerBridge>[0]["startCapture"]>[0];
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function fixture() {
  const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" }, conversationInput: true, candidateAutoDispatch: false, sessionPolicy: true, now: () => 1000 });
  const headers = { host: "127.0.0.1:4174" } as const; const key = "owner-browser";
  const opened = svc.open("", headers as unknown as Record<string, string>, key); const room = opened.roomId;
  const entered = deferred<Scope>(); const factory = deferred<Capture>(); let launchcount = 0;
  const bridge = createMeetWorkerBridge({ service: svc, now: () => 1000, startCapture: (scope: Scope, _signal?: AbortSignal): Promise<Capture> => { launchcount++; entered.resolve(scope); return factory.promise; } });
  const connect = () => bridge.connect(key, room, "https://meet.google.com/abc-defg-hij", "Second Seat");
  return { svc, headers: headers as unknown as Record<string, string>, key, room, entered, factory, get launchcount() { return launchcount; }, bridge, connect };
}
describe("meet-worker-bridge stage1", () => {
  it("foreign/null cookies and unknown room and default service", () => {
    const f = fixture();
    expect(f.bridge.connect(null, f.room, "https://meet.google.com/abc-defg-hij", "Second Seat").status).toBe(404);
    expect(f.bridge.connect("foreign", f.room, "https://meet.google.com/abc-defg-hij", "Second Seat").status).toBe(404);
    expect(f.bridge.status(null, f.room).status).toBe(404);
    expect(f.bridge.status("foreign", f.room).status).toBe(404);
    expect(f.launchcount).toBe(0);
    expect(f.bridge.status(f.key, f.room).body.status).toBe("idle");
    expect(f.bridge.status(f.key, f.room).status).toBe(200);
    const svc2 = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" }, sessionPolicy: true, now: () => 1000 });
    const o2 = svc2.open("", f.headers, f.key); const b2 = createMeetWorkerBridge({ service: svc2, now: () => 1000, startCapture: () => Promise.resolve({ sample: () => Promise.resolve([]), stop: () => Promise.resolve() }) });
    expect(b2.connect(f.key, o2.roomId, "https://meet.google.com/abc-defg-hij", "Second Seat").status).toBe(404);
    expect(f.bridge.status(f.key, "unknown-room").status).toBe(404);
  });
  it("real review ingest", async () => {
    const f = fixture();
    expect(f.connect().status).toBe(202); expect(f.connect().status).toBe(409);
    const scope = await f.entered.promise; expect(scope.binding.roomId).toBe(f.room);
    const cap: Capture = { sample: () => Promise.resolve([{ event: { version: 1, meetingId: scope.binding.meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "Alice", text: "Review this request" }, verified: false }]), stop: () => Promise.resolve() };
    expect(Object.isFrozen(cap)).toBe(false);
    f.factory.resolve(cap); await Promise.resolve();
    expect(f.bridge.status(f.key, f.room).body.status).toBe("listening");
    const sampled = await f.bridge.sample(f.key, f.room); expect(sampled.status).toBe(200); expect(sampled.body.accepted).toBe(1);
    expect(Object.isFrozen(sampled)).toBe(true); expect(Object.isFrozen(sampled.body)).toBe(true);
    expect(Object.keys(sampled.body).sort()).toEqual(["accepted", "status"]); expect(JSON.stringify(sampled.body).includes("Review")).toBe(false);
    const conv = f.svc.open("", f.headers, f.key).conversation as unknown as { utterances: { utteranceId: string; text: string }[]; contextRevision: number } | undefined;
    expect(conv?.utterances.some(u => u.utteranceId === "u1" && u.text === "Review this request")).toBe(true); expect(conv?.contextRevision).toBe(1);
    expect((await f.bridge.sample("foreign", f.room)).status).toBe(404);
    const st = await f.bridge.stop(f.key, f.room); expect(st.body.status).toBe("stopped");
    expect(f.launchcount).toBe(1);
  });
  it("stop while queued", async () => {
    const f = fixture(); f.connect(); const s = f.bridge.stop(f.key, f.room); expect(f.bridge.status(f.key, f.room).body.status).toBe("stopping");
    expect((await s).body.status).toBe("stopped"); expect(f.launchcount).toBe(0);
    expect((await f.bridge.stop(f.key, f.room)).body.status).toBe("stopped"); expect(f.launchcount).toBe(0);
  });
  it("late factory", async () => {
    const f = fixture(); f.connect(); await f.entered.promise;
    let stopCount = 0; const ack = deferred<void>();
    const cap: Capture = { sample: () => Promise.resolve([]), stop: () => { stopCount++; return ack.promise; } };
    const p1 = f.bridge.stop(f.key, f.room); const p2 = f.bridge.stop(f.key, f.room);
    expect(f.bridge.status(f.key, f.room).body.status).toBe("stopping");
    f.factory.resolve(cap); await Promise.resolve();
    expect(f.bridge.status(f.key, f.room).body.status).toBe("stopping");
    ack.resolve(undefined); const [r1, r2] = await Promise.all([p1, p2]); expect(r1.body.status).toBe("stopped"); expect(r2.body.status).toBe("stopped");
    expect(stopCount).toBe(1); expect((await f.bridge.stop(f.key, f.room)).body.status).toBe("stopped"); expect(stopCount).toBe(1);
    const sc = await f.entered.promise; expect(sc.isCurrent()).toBe(false);
  });
});
describe("meet-worker-bridge stage2", () => {
  it("A late sample takeover+resume", async () => {
    const f = fixture();
    f.connect();
    const scope = await f.entered.promise;
    const pendingBatch = deferred<Awaited<ReturnType<Capture["sample"]>>>();
    let samples = 0;
    let closed = 0;
    const cap: Capture = {
      sample: () => { samples++; return pendingBatch.promise; },
      stop: () => { closed++; return Promise.resolve(); },
    };
    f.factory.resolve(cap);
    await Promise.resolve();
    const pending = f.bridge.sample(f.key, f.room);
    expect(samples).toBe(1);
    const second = await f.bridge.sample(f.key, f.room);
    expect(second.status).toBe(409);
    expect(await f.bridge.sample("foreign", f.room)).toStrictEqual(expect.objectContaining({ status: 404 }));
    expect(samples).toBe(1);
    await f.svc.actAs(f.key, { roomId: f.room, action: "takeover" }, f.headers);
    await f.svc.actAs(f.key, { roomId: f.room, action: "resume" }, f.headers);
    const binding2 = f.svc.workerBindingAs(f.key, f.room);
    expect((binding2?.epoch ?? 0) > (scope.binding.epoch ?? 0)).toBe(true);
    pendingBatch.resolve([{ event: { version: 1, meetingId: scope.binding.meetingId, utteranceId: "uA", sequence: 1, revision: 1, speaker: "Alice", text: "private row" }, verified: false }]);
    const r = await pending;
    expect(r.body.accepted).toBe(0);
    const st = await f.bridge.stop(f.key, f.room);
    expect(st.body.status).toBe("stopped");
    expect(closed).toBe(1);
    const conv = f.svc.open("", f.headers, f.key).conversation as unknown as { contextRevision: number; utterances: unknown[] } | undefined;
    expect(conv?.contextRevision).toBe(0);
    expect(conv?.utterances.length).toBe(0);
  });
  it("B status detects takeover+resume without sample", async () => {
    const f = fixture();
    const cap: Capture = { sample: () => Promise.resolve([]), stop: () => Promise.resolve() };
    f.factory.resolve(cap);
    f.connect();
    await f.entered.promise;
    await Promise.resolve();
    await f.svc.actAs(f.key, { roomId: f.room, action: "takeover" }, f.headers);
    await f.svc.actAs(f.key, { roomId: f.room, action: "resume" }, f.headers);
    expect(f.bridge.status(f.key, f.room).body.status).toBe("stopping");
    const st = await f.bridge.stop(f.key, f.room);
    expect(st.body.status).toBe("stopped");
    expect(st.body.accepted).toBe(0);
  });
  it("C cap.stop rejects => stop-unconfirmed", async () => {
    const f = fixture();
    f.connect();
    await f.entered.promise;
    let closeCount = 0;
    const cap: Capture = { sample: () => Promise.resolve([]), stop: () => { closeCount++; return Promise.reject(new Error("private cleanup")); } };
    f.factory.resolve(cap);
    await Promise.resolve();
    const r = await f.bridge.stop(f.key, f.room);
    expect(r.body.status).toBe("stop-unconfirmed");
    expect((await f.bridge.stop(f.key, f.room)).body.status).toBe("stop-unconfirmed");
    expect(f.bridge.status(f.key, f.room).body.status).toBe("stop-unconfirmed");
    expect(f.bridge.connect(f.key, f.room, "https://meet.google.com/abc-defg-hij", "Second Seat").status).toBe(409);
    expect(f.launchcount).toBe(1);
    expect(closeCount).toBe(1);
    expect(JSON.stringify(r).includes("private cleanup")).toBe(false);
  });
  it("D factory rejection cleanupConfirmed", async () => {
    for (const confirmed of [true, false] as const) {
      const f = fixture();
      f.connect();
      await f.entered.promise;
      f.factory.reject({ cleanupConfirmed: confirmed });
      await Promise.resolve();
      const s = f.bridge.status(f.key, f.room);
      expect(s.body.status).toBe(confirmed ? "failed" : "stop-unconfirmed");
      const st = await f.bridge.stop(f.key, f.room);
      expect(st.body.status).toBe(confirmed ? "stopped" : "stop-unconfirmed");
      if (!confirmed) expect(f.bridge.connect(f.key, f.room, "https://meet.google.com/abc-defg-hij", "Second Seat").status).toBe(409);
    }
  });
  it("E foreign event stops before further ingest", async () => {
    const f = fixture();
    f.connect();
    const scope = await f.entered.promise;
    const cap: Capture = {
      sample: () => Promise.resolve([{ event: { version: 1, meetingId: "foreign", utteranceId: "uF", sequence: 1, revision: 1, speaker: "Alice", text: "private row" }, verified: false }, { event: { version: 1, meetingId: scope.binding.meetingId, utteranceId: "u2", sequence: 1, revision: 1, speaker: "Alice", text: "private row" }, verified: false }]),
      stop: () => Promise.resolve(),
    };
    let closed = 0;
    const origStop = cap.stop;
    const cap2: Capture = { sample: cap.sample, stop: () => { closed++; return origStop(); } };
    f.factory.resolve(cap2);
    await Promise.resolve();
    const r = await f.bridge.sample(f.key, f.room);
    expect(r.body.accepted).toBe(0);
    const conv = f.svc.open("", f.headers, f.key).conversation as unknown as { utterances: unknown[] } | undefined;
    expect(conv?.utterances.length).toBe(0);
    await f.bridge.stop(f.key, f.room);
    expect(closed).toBe(1);
  });
  it("F a 409 meeting mismatch skips that caption and keeps the worker listening", async () => {
    const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" }, conversationInput: true, candidateAutoDispatch: false, sessionPolicy: true, now: () => 1000 });
    const headers: Record<string, string> = { host: "127.0.0.1:4174" }; const key = "owner-browser";
    const room = svc.open("", headers, key).roomId;
    let ingests = 0;
    const wrapped: typeof svc = { ...svc, ingestConversationAs: (k: string | null, r: unknown, ev: unknown) => { ingests++; if (ingests === 1) return { ...svc.ingestConversationAs("nobody", r, ev), status: 409 }; return svc.ingestConversationAs(k, r, ev); } };
    const entered = deferred<Scope>();
    let stops = 0;
    const bridge = createMeetWorkerBridge({ service: wrapped, now: () => 1000, startCapture: (scope: Scope): Promise<Capture> => { entered.resolve(scope); return Promise.resolve({ sample: () => Promise.resolve([{ event: { version: 1, meetingId: scope.binding.meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "Alice", text: "skipped row" }, verified: false }, { event: { version: 1, meetingId: scope.binding.meetingId, utteranceId: "u2", sequence: 1, revision: 1, speaker: "Alice", text: "kept row" }, verified: false }]), stop: () => { stops++; return Promise.resolve(); } }); } });
    expect(bridge.connect(key, room, "https://meet.google.com/abc-defg-hij", "Second Seat").status).toBe(202);
    await entered.promise; await Promise.resolve(); await Promise.resolve();
    expect(bridge.status(key, room).body.status).toBe("listening");
    const r = await bridge.sample(key, room);
    expect(r.body.accepted).toBe(1);
    expect(ingests).toBe(2);
    expect(bridge.status(key, room).body.status).toBe("listening");
    expect(stops).toBe(0);
    await bridge.stop(key, room);
    expect(stops).toBe(1);
  });
});
