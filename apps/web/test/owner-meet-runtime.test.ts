import { describe, it, expect, vi } from "vitest";
import { createOwnerMeetRuntime, type StartCapture } from "../src/ownerMeetRuntime.js";
import type { Capture } from "../src/meetWorkerBridge.js";
type Scope = Parameters<StartCapture>[0];
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const ORIGIN = "http://127.0.0.1:4174"; const HOST = "127.0.0.1:4174";
function fixture(maxWorkers = 1) {
  let tickFn: () => void = () => {}; let cancels = 0;
  let launches = 0; let samples = 0; let closed = 0;
  const entered = deferred<Scope>();
  let sampleImpl: (s: Scope) => ReturnType<Capture["sample"]> = () => Promise.resolve([]);
  let stopImpl: () => Promise<void> = () => Promise.resolve();
  const schedule = (cb: () => void) => { tickFn = cb; return () => { cancels++; }; };
  const startCapture: StartCapture = (scope: Scope) => {
    launches++; entered.resolve(scope);
    const cap: Capture = {
      sample: () => { samples++; return sampleImpl(scope); },
      stop: () => { closed++; return stopImpl(); }
    };
    return Promise.resolve(cap);
  };
  const runtime = createOwnerMeetRuntime({ origin: ORIGIN, startCapture, canPrepare: () => true, schedule, maxWorkers });
  const key = "owner-browser"; const headers = { host: HOST } as const;
  const room = runtime.meetingRoom.open("", { host: HOST }, key) as { roomId: string };
  const post = (action: string, body: unknown, k = key) => runtime.meetWorkerHttp({ method: "POST", path: "/api/meeting-room/worker/"+action, callerKey: k, origin: ORIGIN, host: HOST, remoteAddress: "127.0.0.1", body, query: new URLSearchParams() });
  const status = (r: string, k: string | null = key) => runtime.meetWorkerHttp({ method: "GET", path: "/api/meeting-room/worker/status", callerKey: k, origin: null, host: HOST, remoteAddress: "127.0.0.1", body: undefined, query: new URLSearchParams({ roomId: r }) });
  return { runtime, service: runtime.meetingRoom, room, key, headers, post, status, tick: () => tickFn(), entered, get launches() { return launches; }, get samples() { return samples; }, get closed() { return closed; }, get cancels() { return cancels; }, setSample(fn: typeof sampleImpl) { sampleImpl = fn; }, setStop(fn: typeof stopImpl) { stopImpl = fn; } };
}
describe("owner-meet-runtime", () => {
  it("explicit HTTP connect", async () => {
    const f = fixture(1);
    const finishSpy = vi.spyOn(f.service, "finishConversationAs");
    const r1 = await f.post("connect", { roomId: f.room.roomId, meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat" }, "foreign"); expect(r1.status).toBe(404); expect(f.launches).toBe(0);
    const r2 = await f.post("connect", { roomId: f.room.roomId, meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat" }); expect(r2.status).toBe(202); await f.entered.promise; await Promise.resolve(); expect(f.launches).toBe(1);
    const held = deferred<Awaited<ReturnType<Capture["sample"]>>>(); f.setSample(() => held.promise);
    f.tick(); f.tick(); await Promise.resolve(); expect(f.samples).toBe(1);
    const scope = await f.entered.promise; held.resolve([{event:{version:1,meetingId:scope.binding.meetingId,utteranceId:"u1",sequence:1,revision:1,speaker:"Alice",text:"hello\r\nworld\u2603"},verified:false}]); await Promise.resolve(); await Promise.resolve();
    const snap = f.service.open("", f.headers, f.key);
    // conversation asserted via real service
    expect(snap.conversation?.contextRevision).toBe(1);
    expect(snap.conversation?.utterances[0]?.text).toBe("hello\r\nworld\u2603");
    expect(finishSpy).toHaveBeenCalledTimes(0);
    const stp = await f.post("stop", { roomId: f.room.roomId }); expect(stp.status).toBe(200);
    const st = await f.status(f.room.roomId); expect((st.body as { canPrepare: boolean }).canPrepare).toBe(false);
    const prep = await f.post("prepare", { roomId: f.room.roomId }); expect(prep.status).toBe(403); expect(finishSpy).toHaveBeenCalledTimes(0);
    expect(Object.hasOwn(f.runtime as object, "candidateApprovalApi")).toBe(false);
    await expect(f.runtime.dispose()).resolves.toBeUndefined();
  });
  it("default capacity 1", async () => {
    const f = fixture(1);
    const a = await f.post("connect", { roomId: f.room.roomId, meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat" }); expect(a.status).toBe(202);
    const k2 = "owner-browser-2"; const room2 = f.service.open("", { host: HOST }, k2) as { roomId: string };
    const b = await f.post("connect", { roomId: room2.roomId, meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat" }, k2); expect(b.status).toBe(409);
    const foreign = await f.post("connect", { roomId: f.room.roomId, meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat" }, "foreign2"); expect(foreign.status).toBe(404); expect(f.launches).toBe(1);
    await (f.runtime.bridge.stop as (k: string, r: string) => Promise<unknown>)(f.key, f.room.roomId);
    const c = await f.post("connect", { roomId: room2.roomId, meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat" }, k2); expect(c.status).toBe(202);
    await f.runtime.dispose();
  });
  it("config", async () => {
    for (const v of [0, 3, 1.5]) expect(() => createOwnerMeetRuntime({ origin: ORIGIN, startCapture: (() => Promise.reject({ cleanupConfirmed: true })) as unknown as StartCapture, maxWorkers: v })).toThrow(RangeError);
    let scheduled = 0;
    const badSched = vi.fn((_cb: () => void) => { scheduled++; return () => {}; });
    expect(() => createOwnerMeetRuntime({ origin: "https://example.com", startCapture: (() => Promise.reject({ cleanupConfirmed: true })) as unknown as StartCapture, schedule: badSched as unknown as (tick: () => void) => () => void })).toThrow();
    expect(scheduled).toBe(0);
    const ok = fixture(1); await ok.runtime.dispose();
    const ok2 = fixture(2); await ok2.runtime.dispose();
  });
});
it("stale held sample discarded", async () => {
  const f = fixture(1);
  const r = await f.post("connect", { roomId: f.room.roomId, meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat" });
  expect(r.status).toBe(202);
  const scope = await f.entered.promise;
  await Promise.resolve();
  const held = deferred<Awaited<ReturnType<Capture["sample"]>>>();
  const sampleEntered = deferred<void>();
  f.setSample(() => { sampleEntered.resolve(undefined); return held.promise; });
  f.tick();
  await sampleEntered.promise;
  f.tick();
  expect(f.samples).toBe(1);
  await f.service.actAs(f.key, { roomId: f.room.roomId, action: "takeover" }, f.headers);
  await f.service.actAs(f.key, { roomId: f.room.roomId, action: "resume" }, f.headers);
  f.tick();
  await f.runtime.bridge.stop(f.key, f.room.roomId);
  held.resolve([{ event: { version: 1, meetingId: scope.binding.meetingId, utteranceId: "stale", sequence: 1, revision: 1, speaker: "Alice", text: "must discard" }, verified: false }]);
  await Promise.resolve();
  await Promise.resolve();
  const snap = f.service.open("", f.headers, f.key);
  expect(snap.conversation?.contextRevision).toBe(0);
  expect(snap.conversation?.utterances.length).toBe(0);
  expect(f.closed).toBe(1);
  await f.runtime.dispose();
});
it("dispose waits ACK", async () => {
  const f = fixture(1);
  const closeEntered = deferred<void>();
  const heldClose = deferred<void>();
  f.setStop(() => { closeEntered.resolve(undefined); return heldClose.promise; });
  const r = await f.post("connect", { roomId: f.room.roomId, meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat" });
  expect(r.status).toBe(202);
  await f.entered.promise;
  await Promise.resolve();
  const p = f.runtime.dispose();
  let settled = false;
  void p.then(() => { settled = true; }, () => { settled = true; });
  await closeEntered.promise;
  expect(settled).toBe(false);
  expect(f.runtime.dispose()).toBe(p);
  expect(f.cancels).toBe(1);
  const samples = f.samples;
  f.tick();
  expect(f.samples).toBe(samples);
  expect(f.runtime.bridge.connect(f.key, f.room.roomId, "https://meet.google.com/abc-defg-hij", "Second Seat").status).toBe(503);
  expect(f.launches).toBe(1);
  expect(f.closed).toBe(1);
  heldClose.resolve(undefined);
  await expect(p).resolves.toBeUndefined();
  expect(settled).toBe(true);
  f.tick();
  expect(f.samples).toBe(samples);
});
it("quarantine stop-unconfirmed", async () => {
  const f = fixture(1);
  const r = await f.post("connect", { roomId: f.room.roomId, meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat" });
  expect(r.status).toBe(202);
  f.setStop(() => Promise.reject(new Error("private")));
  const st = await f.runtime.bridge.stop(f.key, f.room.roomId);
  expect(st.body.status).toBe("stop-unconfirmed");
  f.tick();
  const room2 = f.service.open("", { host: HOST }, "other") as { roomId: string };
  const b = await f.post("connect", { roomId: room2.roomId, meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Second Seat" }, "other");
  expect(b.status).toBe(409);
  expect(f.launches).toBe(1);
  const q = f.runtime.dispose();
  expect(f.runtime.dispose()).toBe(q);
  await expect(q).rejects.toThrow("Worker cleanup unconfirmed");
});
