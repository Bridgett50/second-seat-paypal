import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import type { CandidateReasonerInput, CandidateCurrentBinding } from "../src/meetingRoom.js";
const HEADERS = { host: "127.0.0.1:4174" };
const TEST_ENV: Readonly<Record<string, string>> = { SECOND_SEAT_TEST_MODE: "1" };
type Service = ReturnType<typeof createMeetingRoomService>;
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
type Fake = { reasoner: (input: CandidateReasonerInput) => Promise<unknown>; calls: CandidateReasonerInput[]; pending: Deferred<unknown>[] };
function createFake(): Fake {
  const calls: CandidateReasonerInput[] = [];
  const pending: Deferred<unknown>[] = [];
  const reasoner = (input: CandidateReasonerInput): Promise<unknown> => {
    calls.push(input);
    const d = deferred<unknown>();
    pending.push(d);
    return d.promise;
  };
  return { reasoner, calls, pending };
}
const flush = (): Promise<void> => new Promise<void>((r) => setImmediate(r));
function must<T>(v: T | null | undefined): T {
  expect(v).toBeDefined();
  expect(v).not.toBeNull();
  if (v === null || v === undefined) throw new Error("must nullish");
  return v;
}
function ingest(svc: Service, key: string, roomId: string, p: { meetingId: string; utteranceId: string; sequence: number; revision: number; speaker: string; text: string }) {
  return svc.ingestConversationAs(key, roomId, { version: 1, meetingId: p.meetingId, utteranceId: p.utteranceId, sequence: p.sequence, revision: p.revision, speaker: p.speaker, text: p.text });
}
function makeRoom(svc: Service): { svc: Service; key: string; roomId: string; meetingId: string } {
  const key = randomUUID();
  const opened = svc.open("", HEADERS, key);
  return { svc, key, roomId: opened.roomId, meetingId: opened.view.selectedMeetingId };
}
function toBinding(input: CandidateReasonerInput): CandidateCurrentBinding {
  const b: CandidateCurrentBinding = { roomId: input.roomId, ownerId: input.ownerId, meetingId: input.meetingId, contextRevision: input.contextRevision, policyGeneration: input.policyGeneration, ...(input.epoch !== undefined ? { epoch: input.epoch } : {}) };
  return b;
}
describe("candidate epoch + currentness", () => {
  it("exposes epoch and binding is current while pending", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const ctx = makeRoom(svc);
    ingest(svc, ctx.key, ctx.roomId, { meetingId: ctx.meetingId, utteranceId: randomUUID(), sequence: 1, revision: 1, speaker: "alice", text: "hello" });
    await flush();
    expect(fake.calls.length).toBe(1);
    const input = must(fake.calls[0]);
    expect(typeof input.epoch).toBe("number");
    const binding = toBinding(input);
    const res = svc.candidateIsCurrent(binding);
    expect(typeof res).toBe("boolean");
    expect(res).toBe(true);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("rejects bad epoch and mismatched fields and feature off", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const ctx = makeRoom(svc);
    ingest(svc, ctx.key, ctx.roomId, { meetingId: ctx.meetingId, utteranceId: randomUUID(), sequence: 1, revision: 1, speaker: "alice", text: "hi" });
    await flush();
    const input = must(fake.calls[0]);
    const base = toBinding(input);
    const noEpoch: CandidateCurrentBinding = { roomId: base.roomId, ownerId: base.ownerId, meetingId: base.meetingId, contextRevision: base.contextRevision, policyGeneration: base.policyGeneration };
    expect(svc.candidateIsCurrent(noEpoch)).toBe(false);
    expect(svc.candidateIsCurrent({ roomId: base.roomId, ownerId: base.ownerId, meetingId: base.meetingId, contextRevision: base.contextRevision, policyGeneration: base.policyGeneration, epoch: -1 })).toBe(false);
    expect(svc.candidateIsCurrent({ roomId: base.roomId, ownerId: base.ownerId, meetingId: base.meetingId, contextRevision: base.contextRevision, policyGeneration: base.policyGeneration, epoch: 1.5 })).toBe(false);
    expect(svc.candidateIsCurrent({ roomId: base.roomId, ownerId: base.ownerId, meetingId: base.meetingId, contextRevision: base.contextRevision, policyGeneration: base.policyGeneration, epoch: NaN })).toBe(false);
    const ep = base.epoch ?? 0;
    expect(svc.candidateIsCurrent({ roomId: base.roomId, ownerId: base.ownerId, meetingId: base.meetingId, contextRevision: base.contextRevision, policyGeneration: base.policyGeneration, epoch: ep + 1 })).toBe(false);
    expect(svc.candidateIsCurrent({ roomId: "nope", ownerId: base.ownerId, meetingId: base.meetingId, contextRevision: base.contextRevision, policyGeneration: base.policyGeneration, epoch: ep })).toBe(false);
    expect(svc.candidateIsCurrent({ roomId: base.roomId, ownerId: "wrong-owner", meetingId: base.meetingId, contextRevision: base.contextRevision, policyGeneration: base.policyGeneration, epoch: ep })).toBe(false);
    expect(svc.candidateIsCurrent({ roomId: base.roomId, ownerId: base.ownerId, meetingId: "wrong-m", contextRevision: base.contextRevision, policyGeneration: base.policyGeneration, epoch: ep })).toBe(false);
    expect(svc.candidateIsCurrent({ roomId: base.roomId, ownerId: base.ownerId, meetingId: base.meetingId, contextRevision: base.contextRevision + 1, policyGeneration: base.policyGeneration, epoch: ep })).toBe(false);
    expect(svc.candidateIsCurrent({ roomId: base.roomId, ownerId: base.ownerId, meetingId: base.meetingId, contextRevision: base.contextRevision, policyGeneration: base.policyGeneration + 1, epoch: ep })).toBe(false);
    const svcOff = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true });
    expect(svcOff.candidateIsCurrent(base)).toBe(false);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("takeover invalidates old epoch, second room isolated, duplicate ingest no-op", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const ctxA = makeRoom(svc);
    ingest(svc, ctxA.key, ctxA.roomId, { meetingId: ctxA.meetingId, utteranceId: randomUUID(), sequence: 1, revision: 1, speaker: "alice", text: "hello" });
    await flush();
    expect(fake.calls.length).toBe(1);
    expect(fake.calls.filter((c) => c.roomId === ctxA.roomId).length).toBe(1);
    const b1 = toBinding(must(fake.calls[0]));
    const e1 = b1.epoch;
    if (typeof e1 !== "number") throw new Error("epoch missing");
    const ctxB = makeRoom(svc);
    const uid2 = randomUUID();
    ingest(svc, ctxB.key, ctxB.roomId, { meetingId: ctxB.meetingId, utteranceId: uid2, sequence: 1, revision: 1, speaker: "bob", text: "hey" });
    await flush();
    expect(fake.calls.length).toBe(2);
    expect(fake.calls.filter((c) => c.roomId === ctxB.roomId).length).toBe(1);
    expect(fake.calls.filter((c) => c.roomId === ctxA.roomId).length).toBe(1);
    const b2 = toBinding(must(fake.calls[1]));
    expect(svc.candidateIsCurrent(b2)).toBe(true);
    const tkRes = await svc.actAs(ctxA.key, { roomId: ctxA.roomId, action: "takeover" }, HEADERS);
    expect(tkRes.status).toBe(200);
    const rsRes = await svc.actAs(ctxA.key, { roomId: ctxA.roomId, action: "resume" }, HEADERS);
    expect(rsRes.status).toBe(200);
    expect(must(rsRes.body.snapshot).view.twinStatus).toBe("active");
    expect(svc.candidateIsCurrent(b1)).toBe(false);
    expect(svc.candidateIsCurrent({ roomId: b1.roomId, ownerId: b1.ownerId, meetingId: b1.meetingId, contextRevision: b1.contextRevision, policyGeneration: b1.policyGeneration, epoch: e1 + 2 })).toBe(true);
    expect(svc.candidateIsCurrent(b2)).toBe(true);
    ingest(svc, ctxB.key, ctxB.roomId, { meetingId: ctxB.meetingId, utteranceId: uid2, sequence: 1, revision: 1, speaker: "bob", text: "hey" });
    await flush();
    expect(fake.calls.length).toBe(2);
    expect(fake.calls.filter((c) => c.roomId === ctxB.roomId).length).toBe(1);
    expect(svc.candidateIsCurrent(b2)).toBe(true);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
});
