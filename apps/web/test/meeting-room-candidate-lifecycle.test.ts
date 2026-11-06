import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import type { CandidateReasonerInput, CandidateCurrentBinding } from "../src/meetingRoom.js";
import { createCandidateReasoner } from "../src/candidateReasoner.js";
import type { PrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
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

describe("candidate lifecycle revoke", () => {
  it("candidateBindingAs exposes frozen current initiating-page binding; takeover revokes; guards hold", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const ctx = makeRoom(svc);
    try {
      ingest(svc, ctx.key, ctx.roomId, { meetingId: ctx.meetingId, utteranceId: randomUUID(), sequence: 1, revision: 1, speaker: "alice", text: "hello" });
      await flush();
      expect(fake.calls.length).toBe(1);
      const input = must(fake.calls[0]);
      expect(svc.candidateBindingAs(ctx.key, ctx.roomId)).toBeNull();
      expect(typeof input.registerRevoke).toBe("function");
      let revoked = 0;
      input.registerRevoke?.(() => { revoked += 1; });
      const binding = svc.candidateBindingAs(ctx.key, ctx.roomId);
      expect(binding).toEqual(toBinding(input));
      expect(typeof must(input.epoch)).toBe("number");
      expect(Object.keys(must(binding)).sort()).toEqual(["contextRevision", "epoch", "meetingId", "ownerId", "policyGeneration", "roomId"].sort());
      expect(Object.isFrozen(must(binding))).toBe(true);
      expect(svc.candidateIsCurrent(must(binding))).toBe(true);
      const second = svc.open("", HEADERS, ctx.key);
      expect(svc.candidateBindingAs(ctx.key, second.roomId)).toBeNull();
      expect(svc.candidateBindingAs(ctx.key, ctx.roomId)).toEqual(toBinding(input));
      const beforeSizes = svc.sizes();
      expect(svc.candidateBindingAs(null, ctx.roomId)).toBeNull();
      expect(svc.candidateBindingAs(randomUUID(), ctx.roomId)).toBeNull();
      expect(svc.candidateBindingAs(ctx.key, "unknown-room-id")).toBeNull();
      expect(svc.candidateBindingAs(ctx.key, 123)).toBeNull();
      expect(svc.sizes()).toEqual(beforeSizes);
      expect(fake.calls.length).toBe(1);
      const res = await svc.actAs(ctx.key, { roomId: ctx.roomId, action: "takeover" }, HEADERS);
      expect(res.status).toBe(200);
      expect(svc.candidateBindingAs(ctx.key, ctx.roomId)).toBeNull();
      expect(revoked).toBe(1);
      expect(fake.pending.length).toBe(1);
    } finally {
      for (const d of fake.pending) d.resolve(null);
      await flush();
    }
  });
  it("takeover/resume revoke the registered callback; stale epoch stays invalid; other room untouched", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const ctxA = makeRoom(svc);
    const ctxB = makeRoom(svc);
    ingest(svc, ctxA.key, ctxA.roomId, { meetingId: ctxA.meetingId, utteranceId: randomUUID(), sequence: 1, revision: 1, speaker: "alice", text: "hello" });
    ingest(svc, ctxB.key, ctxB.roomId, { meetingId: ctxB.meetingId, utteranceId: randomUUID(), sequence: 1, revision: 1, speaker: "bob", text: "hey" });
    await flush();
    expect(fake.calls.length).toBe(2);
    const callA = must(fake.calls.find((c) => c.roomId === ctxA.roomId));
    const callB = must(fake.calls.find((c) => c.roomId === ctxB.roomId));
    const bA = toBinding(callA);
    const bB = toBinding(callB);
    let cbACount = 0;
    let cbBCount = 0;
    const cbA = (): void => { cbACount += 1; };
    const cbB = (): void => { cbBCount += 1; };
    callA.registerRevoke?.(cbA);
    callB.registerRevoke?.(cbB);
    expect(cbACount).toBe(0);
    expect(cbBCount).toBe(0);
    const tk = await svc.actAs(ctxA.key, { roomId: ctxA.roomId, action: "takeover" }, HEADERS);
    expect(tk.status).toBe(200);
    expect(cbACount).toBe(1);
    expect(cbBCount).toBe(0);
    expect(svc.candidateIsCurrent(bA)).toBe(false);
    expect(svc.candidateIsCurrent(bB)).toBe(true);
    const rs = await svc.actAs(ctxA.key, { roomId: ctxA.roomId, action: "resume" }, HEADERS);
    expect(rs.status).toBe(200);
    expect(cbACount).toBe(1);
    expect(svc.candidateIsCurrent(bA)).toBe(false);
    expect(svc.candidateIsCurrent(bB)).toBe(true);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("late OLD registration after real first settlement + fresh dispatch is revoked immediately; fresh callback stays registered and usable", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const ctx = makeRoom(svc);
    ingest(svc, ctx.key, ctx.roomId, { meetingId: ctx.meetingId, utteranceId: randomUUID(), sequence: 1, revision: 1, speaker: "alice", text: "first" });
    await flush();
    expect(fake.calls.length).toBe(1);
    const call1 = must(fake.calls[0]);
    must(fake.pending[0]).resolve(null);
    await flush();
    ingest(svc, ctx.key, ctx.roomId, { meetingId: ctx.meetingId, utteranceId: randomUUID(), sequence: 2, revision: 1, speaker: "alice", text: "second" });
    await flush();
    expect(fake.calls.length).toBe(2);
    const call2 = must(fake.calls[1]);
    // second dispatch saw exactly one more accepted context revision
    expect(call2.contextRevision).toBe(call1.contextRevision + 1);
    let cbNewCount = 0;
    let cbOldCount = 0;
    const cbNew = (): void => { cbNewCount += 1; };
    const cbOld = (): void => { cbOldCount += 1; };
    call2.registerRevoke?.(cbNew);
    expect(cbNewCount).toBe(0);
    call1.registerRevoke?.(cbOld);
    expect(cbOldCount).toBe(1);
    expect(cbNewCount).toBe(0);
    const tk = await svc.actAs(ctx.key, { roomId: ctx.roomId, action: "takeover" }, HEADERS);
    expect(tk.status).toBe(200);
    expect(cbNewCount).toBe(1);
    expect(cbOldCount).toBe(1);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("normal settlement clears only its own callback, no extra revoke", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const ctx = makeRoom(svc);
    ingest(svc, ctx.key, ctx.roomId, { meetingId: ctx.meetingId, utteranceId: randomUUID(), sequence: 1, revision: 1, speaker: "alice", text: "hello" });
    await flush();
    expect(fake.calls.length).toBe(1);
    const call1 = must(fake.calls[0]);
    let cbCount = 0;
    const cb = (): void => { cbCount += 1; };
    call1.registerRevoke?.(cb);
    expect(cbCount).toBe(0);
    must(fake.pending[0]).resolve(null);
    await flush();
    expect(cbCount).toBe(0);
    const tk = await svc.actAs(ctx.key, { roomId: ctx.roomId, action: "takeover" }, HEADERS);
    expect(tk.status).toBe(200);
    expect(cbCount).toBe(0);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("unrecorded guide invalidates", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const ctx = makeRoom(svc);
    ingest(svc, ctx.key, ctx.roomId, { meetingId: ctx.meetingId, utteranceId: randomUUID(), sequence: 1, revision: 1, speaker: "alice", text: "hello" });
    await flush();
    expect(fake.calls.length).toBe(1);
    const call1 = must(fake.calls[0]);
    const b1 = toBinding(call1);
    let cbCount = 0;
    const cb = (): void => { cbCount += 1; };
    call1.registerRevoke?.(cb);
    expect(cbCount).toBe(0);
    const gr = await svc.actAs(ctx.key, { roomId: ctx.roomId, action: "guide", text: "   " }, HEADERS);
    expect(gr.status).toBe(200);
    expect(cbCount).toBe(1);
    expect(svc.candidateIsCurrent(b1)).toBe(false);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("T5 new utterance during flight revokes and coalesces", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const room = makeRoom(svc);
    const rid = room.roomId;
    const mid = room.meetingId;
    ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 1, speaker: "alice", text: "hello" });
    expect(fake.calls.length).toBe(1);
    const call1 = must(fake.calls[0]);
    let cb1 = 0;
    call1.registerRevoke?.(() => { cb1 += 1; });
    ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u2", sequence: 2, revision: 1, speaker: "alice", text: "world" });
    expect(cb1).toBe(1);
    expect(fake.calls.length).toBe(1);
    must(fake.pending[0]).resolve(null);
    await flush();
    expect(fake.calls.length).toBe(2);
    const call2 = must(fake.calls[1]);
    expect(call2.contextRevision).toBe(call1.contextRevision + 1);
    let cb2 = 0;
    call2.registerRevoke?.(() => { cb2 += 1; });
    expect(cb2).toBe(0);
    expect(cb1).toBe(1);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("T6 correction during flight revokes and coalesces", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const room = makeRoom(svc);
    const rid = room.roomId;
    const mid = room.meetingId;
    ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 1, speaker: "alice", text: "hello" });
    expect(fake.calls.length).toBe(1);
    const call1 = must(fake.calls[0]);
    let cb1 = 0;
    call1.registerRevoke?.(() => { cb1 += 1; });
    ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 2, speaker: "alice", text: "hello edited" });
    expect(cb1).toBe(1);
    expect(fake.calls.length).toBe(1);
    must(fake.pending[0]).resolve(null);
    await flush();
    expect(fake.calls.length).toBe(2);
    const call2 = must(fake.calls[1]);
    expect(call2.contextRevision).toBe(call1.contextRevision + 1);
    let cb2 = 0;
    call2.registerRevoke?.(() => { cb2 += 1; });
    expect(cb2).toBe(0);
    expect(cb1).toBe(1);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("T7 duplicate and old revision does not revoke or dispatch", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const room = makeRoom(svc);
    const rid = room.roomId;
    const mid = room.meetingId;
    ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 1, speaker: "alice", text: "hello" });
    expect(fake.calls.length).toBe(1);
    must(fake.pending[0]).resolve(null);
    await flush();
    ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 2, speaker: "alice", text: "hello edited" });
    expect(fake.calls.length).toBe(2);
    const call2 = must(fake.calls[1]);
    let cb2 = 0;
    call2.registerRevoke?.(() => { cb2 += 1; });
    ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 2, speaker: "alice", text: "hello edited dup" });
    expect(cb2).toBe(0);
    expect(fake.calls.length).toBe(2);
    ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 1, speaker: "alice", text: "older" });
    expect(cb2).toBe(0);
    expect(fake.calls.length).toBe(2);
    must(fake.pending[1]).resolve(null);
    await flush();
    expect(fake.calls.length).toBe(2);
    expect(cb2).toBe(0);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("T8 deadline revokes once and keeps slot until settlement", async () => {
    const fake = createFake();
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateDeadlineMs: 50 });
      const room = makeRoom(svc);
      const rid = room.roomId;
      const mid = room.meetingId;
      ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 1, speaker: "alice", text: "hello" });
      expect(fake.calls.length).toBe(1);
      const call1 = must(fake.calls[0]);
      let cb = 0;
      call1.registerRevoke?.(() => { cb += 1; });
      vi.advanceTimersByTime(49);
      expect(cb).toBe(0);
      vi.advanceTimersByTime(1);
      expect(cb).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(cb).toBe(1);
      ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u2", sequence: 2, revision: 1, speaker: "alice", text: "new utter" });
      expect(fake.calls.length).toBe(1);
      must(fake.pending[0]).resolve(null);
      await flush();
      expect(fake.calls.length).toBe(2);
      expect(cb).toBe(1);
      for (const d of fake.pending) d.resolve(null);
      await flush();
    } finally {
      vi.useRealTimers();
    }
  });
  it("T9 store eviction revokes", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, maxStores: 1 });
    const roomA = makeRoom(svc);
    const ridA = roomA.roomId;
    const midA = roomA.meetingId;
    ingest(svc, roomA.key, ridA, { meetingId: midA, utteranceId: "u1", sequence: 1, revision: 1, speaker: "alice", text: "hello" });
    expect(fake.calls.length).toBe(1);
    const call1 = must(fake.calls[0]);
    let cb = 0;
    call1.registerRevoke?.(() => { cb += 1; });
    svc.open("", HEADERS, randomUUID());
    expect(cb).toBe(1);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("T10 same-cookie page eviction only revokes dispatch page", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, maxPagesPerKey: 2 });
    const key = randomUUID();
    const p1 = svc.open("", HEADERS, key);
    const p2 = svc.open("", HEADERS, key);
    const rid = p2.roomId;
    const mid = p2.view.selectedMeetingId;
    ingest(svc, key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 1, speaker: "alice", text: "hello" });
    expect(fake.calls.length).toBe(1);
    const call1 = must(fake.calls[0]);
    expect(call1.roomId).toBe(p2.roomId);
    let cb = 0;
    call1.registerRevoke?.(() => { cb += 1; });
    svc.open("", HEADERS, key);
    expect(cb).toBe(0);
    svc.open("", HEADERS, key);
    expect(cb).toBe(1);
    for (const d of fake.pending) d.resolve(null);
    await flush();
  });
  it("T11 demo zero-provider control never dispatches", async () => {
    const fake = createFake();
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner });
    const key = randomUUID();
    const d = svc.open("?demo=1", HEADERS, key);
    const mid = d.view.selectedMeetingId;
    const rid = d.roomId;
    expect(ingest(svc, key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 1, speaker: "alice", text: "hello" }).status).toBe(200);
    ingest(svc, key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 2, speaker: "alice", text: "hello edited" });
    ingest(svc, key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 2, speaker: "alice", text: "dup" });
    ingest(svc, key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 1, speaker: "alice", text: "old" });
    ingest(svc, key, rid, { meetingId: mid, utteranceId: "u2", sequence: 2, revision: 1, speaker: "alice", text: "second" });
    await flush();
    expect(fake.calls.length).toBe(0);
    for (const d2 of fake.pending) d2.resolve(null);
    await flush();
  });

  it("T12 real reasoner: new context cancels held approval, settles, and dispatches pending", async () => {
    let n = 0;
    const revoked: string[] = [];
    const gate: PrivacyGate = {
      prepare: async (rawText: string) => {
        n += 1;
        return { runId: `run-${n}`, redactedText: rawText, spans: [], needsReview: true, piiFree: false };
      },
      preview: () => "",
      correct: () => "",
      approve: () => "",
      send: async () => { throw new Error("fake gate send refused"); },
      revoke: (runId: string) => { revoked.push(runId); },
      receipts: () => [],
    };
    const approvals: Array<{ runId: string; release: (v: string | null) => void; signal: AbortSignal | undefined }> = [];
    let modelCalls = 0;
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, {
      gate,
      requestOwnerApproval: (runId, _preview, _binding, signal?: AbortSignal) => new Promise<string | null>((resolve) => {
        approvals.push({ runId, release: resolve, signal });
      }),
      isCurrent: () => true,
      callModel: async () => { modelCalls += 1; return null; },
    });
    if (reasoner === undefined) throw new Error("reasoner off");
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: reasoner });
    const room = makeRoom(svc);
    const rid = room.roomId;
    const mid = room.meetingId;
    try {
      ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u1", sequence: 1, revision: 1, speaker: "alice", text: "hello" });
      await flush();
      expect(approvals.length).toBe(1);
      ingest(svc, room.key, rid, { meetingId: mid, utteranceId: "u2", sequence: 2, revision: 1, speaker: "alice", text: "world" });
      await flush();
      expect(approvals.length).toBe(2);
      expect(must(approvals[0]).signal?.aborted).toBe(true);
      expect(revoked).toContain(must(approvals[0]).runId);
      expect(modelCalls).toBe(0);
    } finally {
      for (const a of approvals) a.release(null);
      await flush();
      for (const a of approvals) a.release(null);
      await flush();
    }
  });
it("candidateAutoDispatch:false buffers conversation and finishConversationAs triggers one reasoner call", async () => {
  const fake = createFake();
  const svc = createMeetingRoomService({
    env: TEST_ENV,
    conversationInput: true,
    sessionPolicy: true,
    candidateReasoner: fake.reasoner,
    candidateAutoDispatch: false,
    candidateMaxAttempts: 2,
  });
  const ctx = makeRoom(svc);
  try {
    const r1 = ingest(svc, ctx.key, ctx.roomId, { meetingId: ctx.meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "Synthetic", text: "First part" });
    expect(r1.status).toBe(200);
    const r2 = ingest(svc, ctx.key, ctx.roomId, { meetingId: ctx.meetingId, utteranceId: "u2", sequence: 2, revision: 1, speaker: "Synthetic", text: "Second part" });
    expect(r2.status).toBe(200);
    expect(fake.calls.length).toBe(0);
    const bad = svc.finishConversationAs(randomUUID(), ctx.roomId);
    expect(bad.status).toBe(404);
    expect(fake.calls.length).toBe(0);
    const ok = svc.finishConversationAs(ctx.key, ctx.roomId);
    expect(ok.status).toBe(202);
    expect(fake.calls.length).toBe(1);
    expect(must(fake.calls[0]).utterances.map((u) => u.utteranceId)).toEqual(["u1", "u2"]);
    const again = svc.finishConversationAs(ctx.key, ctx.roomId);
    expect(again.status).toBe(409);
    expect(fake.calls.length).toBe(1);
  } finally {
    await svc.actAs(ctx.key, { roomId: ctx.roomId, action: "takeover" }, HEADERS);
    for (const p of fake.pending) p.resolve(null);
    await flush();
  }
});

it("finishConversationAs caps at candidateMaxAttempts", async () => {
  const fake = createFake();
  const svc = createMeetingRoomService({
    env: TEST_ENV,
    conversationInput: true,
    sessionPolicy: true,
    candidateReasoner: fake.reasoner,
    candidateAutoDispatch: false,
    candidateMaxAttempts: 2,
  });
  const ctx = makeRoom(svc);
  try {
    const r1 = ingest(svc, ctx.key, ctx.roomId, { meetingId: ctx.meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "Synthetic", text: "First part" });
    expect(r1.status).toBe(200);
    const a = svc.finishConversationAs(ctx.key, ctx.roomId);
    expect(a.status).toBe(202);
    expect(fake.calls.length).toBe(1);
    must(fake.pending[0]).resolve(null);
    await flush();
    const b = svc.finishConversationAs(ctx.key, ctx.roomId);
    expect(b.status).toBe(202);
    expect(fake.calls.length).toBe(2);
    must(fake.pending[1]).resolve(null);
    await flush();
    const c = svc.finishConversationAs(ctx.key, ctx.roomId);
    expect(c.status).toBe(429);
    expect(fake.calls.length).toBe(2);
  } finally {
    await svc.actAs(ctx.key, { roomId: ctx.roomId, action: "takeover" }, HEADERS);
    for (const p of fake.pending) p.resolve(null);
    await flush();
  }
});

});
