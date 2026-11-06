import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import type { CandidateReasonerInput, MeetingRoomSnapshot, MeetingRoomCandidateSnapshot } from "../src/meetingRoom.js";

const HEADERS = { host: "127.0.0.1:4174" };
const TEST_ENV = { SECOND_SEAT_TEST_MODE: "1" } as const;

type CapOptions = NonNullable<Parameters<typeof createMeetingRoomService>[0]> & { candidateMaxAttempts?: number; candidateDeadlineMs?: number };
type Service = ReturnType<typeof createMeetingRoomService>;

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type Fake = {
  reasoner: (input: CandidateReasonerInput) => Promise<unknown>;
  calls: CandidateReasonerInput[];
  pending: Deferred<unknown>[];
};
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

function candidateOf(snapshot: MeetingRoomSnapshot): MeetingRoomCandidateSnapshot {
  return must(snapshot.candidate);
}

function stateOf(svc: Service, key: string, roomId: string): Promise<MeetingRoomSnapshot> {
  return svc.actAs(key, { roomId, action: "state" }, HEADERS).then((res) => {
    expect(res.status).toBe(200);
    expect(res.body.snapshot).not.toBeNull();
    return must(res.body.snapshot);
  });
}

function ingest(svc: Service, key: string, roomId: string, p: { meetingId: string; utteranceId: string; sequence: number; revision: number; speaker: string; text: string }) {
  return svc.ingestConversationAs(key, roomId, { version: 1, meetingId: p.meetingId, utteranceId: p.utteranceId, sequence: p.sequence, revision: p.revision, speaker: p.speaker, text: p.text });
}

function pendingAt(fake: Fake, idx: number): Deferred<unknown> {
  expect(fake.pending.length).toBeGreaterThan(idx);
  return must(fake.pending[idx]);
}
function callAt(fake: Fake, idx: number): CandidateReasonerInput {
  expect(fake.calls.length).toBeGreaterThan(idx);
  return must(fake.calls[idx]);
}

function makeRoom(options: CapOptions) {
  const svc = createMeetingRoomService(options);
  const key = randomUUID();
  const opened = svc.open("", HEADERS, key);
  const roomId = opened.roomId;
  const meetingId = opened.view.selectedMeetingId;
  return { svc, key, roomId, meetingId, opened };
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("P3f-ID candidate identity", () => {
  beforeEach(()=>{ vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
  afterEach(()=>{ vi.useRealTimers(); });

  it("provisional result has UUID id stable across repeated reads", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    const snap0 = await stateOf(svc, key, roomId);
    const cand0 = candidateOf(snap0);
    expect(cand0.status).toBe("provisional");
    const id0 = cand0.candidateId;
    expect(typeof id0).toBe("string");
    expect(id0).toMatch(uuidRe);
    const callsBefore = fake.calls.length;
    const snap1 = await stateOf(svc, key, roomId);
    expect(candidateOf(snap1).candidateId).toBe(id0);
    expect(fake.calls.length).toBe(callsBefore);
    const snap2 = await stateOf(svc, key, roomId);
    expect(candidateOf(snap2).candidateId).toBe(id0);
    expect(fake.calls.length).toBe(callsBefore);
    const snap3 = await stateOf(svc, key, roomId);
    expect(candidateOf(snap3).candidateId).toBe(id0);
    expect(fake.calls.length).toBe(callsBefore);
    expect(candidateOf(snap3).status).toBe("provisional");
  });

  it("replacement ingest produces different id", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    pendingAt(fake, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    const id1 = candidateOf(await stateOf(svc, key, roomId)).candidateId;
    expect(typeof id1).toBe("string");
    expect(id1).toMatch(uuidRe);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u2", sequence: 2, revision: 1, speaker: "a", text: "t2" });
    expect(fake.calls.length).toBe(2);
    pendingAt(fake, 1).resolve({ subject: "s2", body: "b2", sourceRefs: [{ utteranceId: "u2", revision: 1 }] });
    await flush();
    const snap2 = await stateOf(svc, key, roomId);
    const cand2 = candidateOf(snap2);
    expect(cand2.status).toBe("provisional");
    const id2 = cand2.candidateId;
    expect(typeof id2).toBe("string");
    expect(id2).toMatch(uuidRe);
    expect(id2).not.toBe(id1);
  });

  it("failed result has stable UUID id across repeated reads", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    pendingAt(fake, 0).resolve({ subject: "", body: "", sourceRefs: [] });
    await flush();
    const snapRej = await stateOf(svc, key, roomId);
    const candRej = candidateOf(snapRej);
    expect(candRej.status).toBe("failed");
    const idRej = candRej.candidateId;
    expect(typeof idRej).toBe("string");
    expect(idRej).toMatch(uuidRe);
    const snapRej2 = await stateOf(svc, key, roomId);
    expect(candidateOf(snapRej2).candidateId).toBe(idRej);
    expect(candidateOf(snapRej2).status).toBe("failed");
    expect(fake.calls.length).toBe(1);
    const snapRej3 = await stateOf(svc, key, roomId);
    expect(candidateOf(snapRej3).candidateId).toBe(idRej);

    const fake2 = createFake();
    const options2: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake2.reasoner, candidateDeadlineMs: 1000 };
    const ctx2 = makeRoom(options2);
    await ingest(ctx2.svc, ctx2.key, ctx2.roomId, { meetingId: ctx2.meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    expect(fake2.calls.length).toBe(1);
    vi.advanceTimersByTime(1000);
    await flush();
    const snapTo = await stateOf(ctx2.svc, ctx2.key, ctx2.roomId);
    expect(must(snapTo.candidate).status).toBe("failed");
    const idTo = must(snapTo.candidate).candidateId;
    expect(typeof idTo).toBe("string");
    expect(idTo).toMatch(uuidRe);
    const snapTo2 = await stateOf(ctx2.svc, ctx2.key, ctx2.roomId);
    expect(must(snapTo2.candidate).candidateId).toBe(idTo);
    expect(must(snapTo2.candidate).status).toBe("failed");
    expect(fake2.calls.length).toBe(1);
    expect(idTo).not.toBe(idRej);
  });

  it("none and pending have candidateId null", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId } = makeRoom(options);
    const snapNone = await stateOf(svc, key, roomId);
    const candNone = candidateOf(snapNone);
    expect(candNone.status).toBe("none");
    expect(candNone.candidateId).toBeNull();
    await ingest(svc, key, roomId, { meetingId: snapNone.view.selectedMeetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    expect(fake.calls.length).toBe(1);
    const snapPend = await stateOf(svc, key, roomId);
    const candPend = candidateOf(snapPend);
    expect(candPend.status).toBe("pending");
    expect(candPend.candidateId).toBeNull();
  });

  it("guide edit-draft takeover resume select-meeting each null the id", async () => {
    const fakeG = createFake();
    const optionsG: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fakeG.reasoner };
    const ctxG = makeRoom(optionsG);
    await ingest(ctxG.svc, ctxG.key, ctxG.roomId, { meetingId: ctxG.meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    pendingAt(fakeG, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    expect(candidateOf(await stateOf(ctxG.svc, ctxG.key, ctxG.roomId)).status).toBe("provisional");
    const gRes = await ctxG.svc.actAs(ctxG.key, { roomId: ctxG.roomId, action: "guide", text: "guidance A" }, HEADERS);
    expect(gRes.status).toBe(200);
    expect(candidateOf(must(gRes.body.snapshot)).candidateId).toBeNull();

    const fakeE = createFake();
    const optionsE: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fakeE.reasoner };
    const ctxE = makeRoom(optionsE);
    await ingest(ctxE.svc, ctxE.key, ctxE.roomId, { meetingId: ctxE.meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    pendingAt(fakeE, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    const eRes = await ctxE.svc.actAs(ctxE.key, { roomId: ctxE.roomId, action: "edit-draft", text: "edited draft" }, HEADERS);
    expect(eRes.status).toBe(200);
    expect(candidateOf(must(eRes.body.snapshot)).candidateId).toBeNull();

    const fakeT = createFake();
    const optionsT: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fakeT.reasoner };
    const ctxT = makeRoom(optionsT);
    await ingest(ctxT.svc, ctxT.key, ctxT.roomId, { meetingId: ctxT.meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    pendingAt(fakeT, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    const tkRes = await ctxT.svc.actAs(ctxT.key, { roomId: ctxT.roomId, action: "takeover" }, HEADERS);
    expect(tkRes.status).toBe(200);
    expect(candidateOf(must(tkRes.body.snapshot)).candidateId).toBeNull();
    const rsRes = await ctxT.svc.actAs(ctxT.key, { roomId: ctxT.roomId, action: "resume" }, HEADERS);
    expect(rsRes.status).toBe(200);
    expect(candidateOf(must(rsRes.body.snapshot)).candidateId).toBeNull();

    const fakeS = createFake();
    const optionsS: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fakeS.reasoner };
    const ctxS = makeRoom(optionsS);
    await ingest(ctxS.svc, ctxS.key, ctxS.roomId, { meetingId: ctxS.meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    pendingAt(fakeS, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    const snapS = await stateOf(ctxS.svc, ctxS.key, ctxS.roomId);
    expect(snapS.view.meetings.length).toBeGreaterThanOrEqual(2);
    const otherId = must(snapS.view.meetings.find((m) => m.id !== ctxS.meetingId)).id;
    const selRes = await ctxS.svc.actAs(ctxS.key, { roomId: ctxS.roomId, action: "select-meeting", id: otherId }, HEADERS);
    expect(selRes.status).toBe(200);
    expect(candidateOf(must(selRes.body.snapshot)).candidateId).toBeNull();
  });

  it("in-flight late settlement cannot restore old id", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    pendingAt(fake, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    const id1 = candidateOf(await stateOf(svc, key, roomId)).candidateId;
    expect(typeof id1).toBe("string");
    expect(id1).toMatch(uuidRe);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u2", sequence: 2, revision: 1, speaker: "a", text: "t2" });
    expect(fake.calls.length).toBe(2);
    const snapPend = await stateOf(svc, key, roomId);
    expect(candidateOf(snapPend).status).toBe("pending");
    expect(candidateOf(snapPend).candidateId).toBeNull();
    const gRes = await svc.actAs(key, { roomId, action: "guide", text: "guidance while in flight" }, HEADERS);
    expect(gRes.status).toBe(200);
    const candAfterGuide = candidateOf(must(gRes.body.snapshot));
    expect(candAfterGuide.candidateId).toBeNull();
    pendingAt(fake, 1).resolve({ subject: "late", body: "late-body", sourceRefs: [{ utteranceId: "u2", revision: 1 }] });
    await flush();
    const snapAfter = await stateOf(svc, key, roomId);
    const candAfter = candidateOf(snapAfter);
    expect(candAfter.candidateId).not.toBe(id1);
    expect(candAfter.candidateId).toBeNull();
    expect(candAfter.status).not.toBe("provisional");
  });

  it("guide at unchanged revision nulls id and later ingest gets new id", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    pendingAt(fake, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    const snapBefore = await stateOf(svc, key, roomId);
    const candBefore = candidateOf(snapBefore);
    const id1 = candBefore.candidateId;
    expect(typeof id1).toBe("string");
    expect(id1).toMatch(uuidRe);
    const revBefore = must(snapBefore.conversation).contextRevision;
    const gRes = await svc.actAs(key, { roomId, action: "guide", text: "guidance same rev" }, HEADERS);
    expect(gRes.status).toBe(200);
    const snapGuide = must(gRes.body.snapshot);
    expect(candidateOf(snapGuide).candidateId).toBeNull();
    expect(must(snapGuide.conversation).contextRevision).toBe(revBefore);
    await ingest(svc, key, roomId, { meetingId, utteranceId: "u2", sequence: 2, revision: 1, speaker: "a", text: "t2" });
    expect(fake.calls.length).toBe(2);
    pendingAt(fake, 1).resolve({ subject: "s2", body: "b2", sourceRefs: [{ utteranceId: "u2", revision: 1 }] });
    await flush();
    const snapAfter = await stateOf(svc, key, roomId);
    const candAfter = candidateOf(snapAfter);
    expect(candAfter.status).toBe("provisional");
    const id2 = candAfter.candidateId;
    expect(typeof id2).toBe("string");
    expect(id2).toMatch(uuidRe);
    expect(id2).not.toBe(id1);
  });

  it("same shared-room tabs share id and different store key isolated", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const svc = createMeetingRoomService(options);
    const key = randomUUID();
    const opened1 = svc.open("", HEADERS, key);
    const roomId1 = opened1.roomId;
    const meetingId = opened1.view.selectedMeetingId;
    await ingest(svc, key, roomId1, { meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "t1" });
    pendingAt(fake, 0).resolve({ subject: "s1", body: "b1", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    const snap1 = await stateOf(svc, key, roomId1);
    const id1 = candidateOf(snap1).candidateId;
    expect(typeof id1).toBe("string");
    expect(id1).toMatch(uuidRe);
    const opened2 = svc.open("", HEADERS, key);
    const roomId2 = opened2.roomId;
    expect(roomId2 !== roomId1).toBe(true);
    const snap2 = await stateOf(svc, key, roomId2);
    expect(candidateOf(snap2).candidateId).toBe(id1);
    expect(candidateOf(snap2).status).toBe("provisional");
    const otherKey = randomUUID();
    const openedOther = svc.open("", HEADERS, otherKey);
    const snapOther = await stateOf(svc, otherKey, openedOther.roomId);
    const candOther = candidateOf(snapOther);
    expect(candOther.status).toBe("none");
    expect(candOther.candidateId).toBeNull();
    expect(candOther.candidateId).not.toBe(id1);
  });
});
