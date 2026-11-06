import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import type { CandidateReasonerInput, MeetingRoomSnapshot, MeetingRoomCandidateSnapshot } from "../src/meetingRoom.js";

const HEADERS = { host: "127.0.0.1:4174" } as const;
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

function pendingAt(fake: Fake, idx: number): Deferred<unknown> {
  expect(fake.pending.length).toBeGreaterThan(idx);
  const entry = fake.pending[idx];
  expect(entry).toBeDefined();
  if (entry === undefined) throw new Error("missing pending");
  return entry;
}

function previewOf(snapshot: object): unknown {
  if ("candidatePreview" in snapshot) {
    return Reflect.get(snapshot, "candidatePreview");
  }
  return undefined;
}

function stateOf(svc: Service, key: string, roomId: string): Promise<MeetingRoomSnapshot> {
  return svc.actAs(key, { roomId, action: "state" }, HEADERS).then((res) => {
    expect(res.status).toBe(200);
    expect(res.body.snapshot).not.toBeNull();
    return must(res.body.snapshot);
  });
}

function ingest(svc: Service, key: string, roomId: string, p: { meetingId: string; utteranceId: string; sequence: number; revision: number; speaker: string; text: string }) {
  const res = svc.ingestConversationAs(key, roomId, { version: 1, meetingId: p.meetingId, utteranceId: p.utteranceId, sequence: p.sequence, revision: p.revision, speaker: p.speaker, text: p.text });
  expect(res.status).toBe(200);
  return res;
}

function makeRoom(options: CapOptions) {
  const svc = createMeetingRoomService(options);
  const key = randomUUID();
  const opened = svc.open("", HEADERS, key);
  const roomId = opened.roomId;
  const meetingId = opened.view.selectedMeetingId;
  return { svc, key, roomId, meetingId, opened };
}

const { mockEvaluateOutgoing } = vi.hoisted(() => ({
  mockEvaluateOutgoing: vi.fn(),
}));

vi.mock("@second-seat/bot/dist/src/t2-room.js", async () => {
  const actual = await vi.importActual<typeof import("@second-seat/bot/dist/src/t2-room.js")>("@second-seat/bot/dist/src/t2-room.js");
  return {
    ...actual,
    evaluateOutgoing: mockEvaluateOutgoing,
  };
});

describe("meeting-room candidate policy preview", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockEvaluateOutgoing.mockReset();
    const mod = await import("@second-seat/bot/dist/src/t2-room.js");
    mockEvaluateOutgoing.mockImplementation((ownerId: string, meetingId: string, candidate: string) => {
      const gen = mod.getPolicyGeneration(ownerId, meetingId);
      return { outcome: "released", text: candidate, version: "test", generation: gen };
    });
  });
  afterEach(() => {
    mockEvaluateOutgoing.mockReset();
    vi.useRealTimers();
  });

  it("released preview carries rewritten subject and body with generation", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const mod = await import("@second-seat/bot/dist/src/t2-room.js");
    const { svc, key, roomId, meetingId } = makeRoom(options);
    mockEvaluateOutgoing.mockImplementation((o: string, m: string, txt: string, _kind: string) => {
      const g = mod.getPolicyGeneration(o, m);
      if (txt === "Subj 2024-01-01") return { outcome: "released", text: "Subj [redacted date]", version: "test", generation: g };
      return { outcome: "released", text: "Body [redacted date]", version: "test", generation: g };
    });
    ingest(svc, key, roomId, { meetingId, utteranceId: "u2", sequence: 1, revision: 1, speaker: "a", text: "t2" });
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject: "Subj 2024-01-01", body: "Body 2024-01-01", sourceRefs: [{ utteranceId: "u2", revision: 1 }] });
    await flush();
    const snap = await stateOf(svc, key, roomId);
    const cand = candidateOf(snap);
    const ownerId = snap.view.ownerId;
    const gen = mod.getPolicyGeneration(ownerId, meetingId);
    expect(mockEvaluateOutgoing).toHaveBeenCalledTimes(2);
    expect(mockEvaluateOutgoing).toHaveBeenNthCalledWith(1, ownerId, meetingId, "Subj 2024-01-01", "follow-up-draft");
    expect(mockEvaluateOutgoing).toHaveBeenNthCalledWith(2, ownerId, meetingId, "Body 2024-01-01", "follow-up-draft");
    expect(cand).toMatchObject({ status: "provisional", approved: false, policyChecked: false });
    expect(cand).toMatchObject({ subject: "Subj 2024-01-01", body: "Body 2024-01-01" });
    const preview = previewOf(snap);
    expect(preview).toMatchObject({ status: "released", generation: gen });
    expect(preview).toMatchObject({ evaluatedSubject: "Subj [redacted date]", evaluatedBody: "Body [redacted date]", subjectChanged: true, bodyChanged: true, candidateId: cand.candidateId });
  });

  it("unknown outcome becomes unavailable with no evaluated text", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    const mod = await import("@second-seat/bot/dist/src/t2-room.js");
    mockEvaluateOutgoing.mockImplementation((o: string, m: string) => {
      const g = mod.getPolicyGeneration(o, m);
      return { outcome: "mystery", text: "rewritten", version: "test", generation: g };
    });
    ingest(svc, key, roomId, { meetingId, utteranceId: "u3", sequence: 1, revision: 1, speaker: "a", text: "hi" });
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject: "s3", body: "b3", sourceRefs: [{ utteranceId: "u3", revision: 1 }] });
    await flush();
    const snap = await stateOf(svc, key, roomId);
    const cand = candidateOf(snap);
    expect(cand.status).toBe("provisional");
    expect(cand.subject).toBe("s3");
    const preview = previewOf(snap);
    expect(preview).toMatchObject({ status: "unavailable" });
    expect(preview).not.toHaveProperty("evaluatedSubject");
    expect(preview).not.toHaveProperty("evaluatedBody");
  });

  it.each([
    { subject: "held-subject", body: "ok-body" },
    { subject: "ok-subject", body: "held-body" },
  ])("held preview carries exact reason and no evaluated text %#", async ({ subject, body }) => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    const mod = await import("@second-seat/bot/dist/src/t2-room.js");
    mockEvaluateOutgoing.mockImplementation((o: string, m: string, txt: string, _kind: string) => {
      const g = mod.getPolicyGeneration(o, m);
      if (txt === "held-subject" || txt === "held-body") return { outcome: "held", reason: "needs clarification for date disclosure", version: "test", generation: g };
      return { outcome: "released", text: txt, version: "test", generation: g };
    });
    ingest(svc, key, roomId, { meetingId, utteranceId: "u4", sequence: 1, revision: 1, speaker: "a", text: "trigger" });
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject, body, sourceRefs: [{ utteranceId: "u4", revision: 1 }] });
    await flush();
    const snap = await stateOf(svc, key, roomId);
    const cand = candidateOf(snap);
    const preview = previewOf(snap);
    expect(preview).toMatchObject({ status: "held", reason: "needs clarification for date disclosure" });
    expect(preview).not.toHaveProperty("evaluatedSubject");
    expect(preview).not.toHaveProperty("evaluatedBody");
    expect(cand.status).toBe("provisional");
    expect(cand.subject).toBe(subject);
  });
  it.each([
    { name: "oversize evaluated subject 201", subject: "ok-subj", body: "ok-body", mock: "subject-oversize" },
    { name: "oversize evaluated body 20001", subject: "ok-subj2", body: "ok-body2", mock: "body-oversize" },
    { name: "held+unknown peer sHeld bUnknown", subject: "held-subject", body: "ok-body3", mock: "held-unknown-sfirst" },
    { name: "held+unknown peer bHeld sUnknown", subject: "ok-subject3", body: "held-body", mock: "held-unknown-bfirst" },
    { name: "empty held reason", subject: "held-empty-reason", body: "ok-body4", mock: "empty-reason" },
    { name: "missing result version", subject: "missing-version", body: "ok-body5", mock: "missing-version" },
  ])("invalid preview becomes unavailable: $name", async ({ mock }) => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    const mod = await import("@second-seat/bot/dist/src/t2-room.js");
    mockEvaluateOutgoing.mockImplementation((o: string, m: string, txt: string) => {
      const g = mod.getPolicyGeneration(o, m);
      if (mock === "subject-oversize") {
        if (txt === "ok-subj") return { outcome: "released", text: "x".repeat(201), version: "test", generation: g };
        return { outcome: "released", text: txt, version: "test", generation: g };
      }
      if (mock === "body-oversize") {
        if (txt === "ok-body2") return { outcome: "released", text: "x".repeat(20001), version: "test", generation: g };
        return { outcome: "released", text: txt, version: "test", generation: g };
      }
      if (mock === "held-unknown-sfirst") {
        if (txt === "held-subject") return { outcome: "held", reason: "needs clarification", version: "test", generation: g };
        return { outcome: "mystery", text: "rewritten", version: "test", generation: g };
      }
      if (mock === "held-unknown-bfirst") {
        if (txt === "held-body") return { outcome: "held", reason: "needs clarification", version: "test", generation: g };
        return { outcome: "mystery", text: "rewritten", version: "test", generation: g };
      }
      if (mock === "empty-reason") {
        if (txt === "held-empty-reason") return { outcome: "held", reason: "", version: "test", generation: g };
        return { outcome: "released", text: txt, version: "test", generation: g };
      }
      if (mock === "missing-version") {
        if (txt === "missing-version") return { outcome: "released", text: "rewritten", generation: g };
        return { outcome: "released", text: txt, version: "test", generation: g };
      }
      return { outcome: "released", text: txt, version: "test", generation: g };
    });
    const subjMap: Record<string, string> = {
      "subject-oversize": "ok-subj",
      "body-oversize": "ok-subj2",
      "held-unknown-sfirst": "held-subject",
      "held-unknown-bfirst": "ok-subject3",
      "empty-reason": "held-empty-reason",
      "missing-version": "missing-version",
    };
    const bodyMap: Record<string, string> = {
      "subject-oversize": "ok-body",
      "body-oversize": "ok-body2",
      "held-unknown-sfirst": "ok-body3",
      "held-unknown-bfirst": "held-body",
      "empty-reason": "ok-body4",
      "missing-version": "ok-body5",
    };
    const subject = subjMap[mock] ?? "ok-subj";
    const body = bodyMap[mock] ?? "ok-body";
    ingest(svc, key, roomId, { meetingId, utteranceId: "u5", sequence: 1, revision: 1, speaker: "a", text: "hi2" });
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject, body, sourceRefs: [{ utteranceId: "u5", revision: 1 }] });
    await flush();
    const snap = await stateOf(svc, key, roomId);
    const cand = candidateOf(snap);
    expect(cand.status).toBe("provisional");
    expect(cand.subject).toBe(subject);
    expect(cand.body).toBe(body);
    const preview = previewOf(snap);
    expect(preview).toMatchObject({ status: "unavailable", candidateId: cand.candidateId });
    expect(preview).not.toHaveProperty("evaluatedSubject");
    expect(preview).not.toHaveProperty("evaluatedBody");
  });
  it("stale preview after scoped recorder generation change without guide keeps counts", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const mod = await import("@second-seat/bot/dist/src/t2-room.js");
    const { svc, key, roomId, meetingId } = makeRoom(options);
    ingest(svc, key, roomId, { meetingId, utteranceId: "u-stale-1", sequence: 1, revision: 1, speaker: "a", text: "t" });
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject: "s-stale", body: "b-stale", sourceRefs: [{ utteranceId: "u-stale-1", revision: 1 }] });
    await flush();
    const snap1 = await stateOf(svc, key, roomId);
    const cand1 = candidateOf(snap1);
    const preview1 = previewOf(snap1);
    expect(preview1).toMatchObject({ status: "released" });
    const ownerId = snap1.view.ownerId;
    const genBefore = mod.getPolicyGeneration(ownerId, meetingId);
    expect(mockEvaluateOutgoing).toHaveBeenCalledTimes(2);
    expect(fake.calls.length).toBe(1);
    const rec = mod.createMeetingPolicyRecorder(ownerId, meetingId);
    const result = rec.record("Do not share any dates.");
    const genAfter = mod.getPolicyGeneration(ownerId, meetingId);
    expect(result.generation).toBeGreaterThan(genBefore);
    expect(genAfter).toBeGreaterThan(genBefore);
    const snap2 = await stateOf(svc, key, roomId);
    const preview2 = previewOf(snap2);
    expect(preview2).toMatchObject({ status: "stale", candidateId: cand1.candidateId, generation: genBefore });
    expect(preview2).not.toHaveProperty("evaluatedSubject");
    expect(preview2).not.toHaveProperty("evaluatedBody");
    expect(mockEvaluateOutgoing).toHaveBeenCalledTimes(2);
    expect(fake.calls.length).toBe(1);
  });
  it.each([
    { action: "guide", payload: { text: "guidance hello" } },
    { action: "edit-draft", payload: { text: "edited text" } },
    { action: "takeover", payload: { text: "" } },
    { action: "resume", payload: { text: "" } },
    { action: "select-meeting", payload: { text: "" } },
  ])("successful $action clears candidate preview %#", async ({ action, payload }) => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    ingest(svc, key, roomId, { meetingId, utteranceId: "u-clr", sequence: 1, revision: 1, speaker: "a", text: "hi" });
    pendingAt(fake, 0).resolve({ subject: "s-clr", body: "b-clr", sourceRefs: [{ utteranceId: "u-clr", revision: 1 }] });
    await flush();
    const snap0 = await stateOf(svc, key, roomId);
    const cand0 = candidateOf(snap0);
    expect(previewOf(snap0)).toMatchObject({ status: "released", candidateId: cand0.candidateId });
    let res: Awaited<ReturnType<Service["actAs"]>>;
    if (action === "select-meeting") {
      const otherId = must(snap0.view.meetings.find((m) => m.id !== meetingId)).id;
      res = await svc.actAs(key, { roomId, action, id: otherId }, HEADERS);
    } else if (action === "guide" || action === "edit-draft") {
      res = await svc.actAs(key, { roomId, action, text: payload.text }, HEADERS);
    } else {
      res = await svc.actAs(key, { roomId, action }, HEADERS);
    }
    expect(res.status).toBe(200);
    const snap1 = await stateOf(svc, key, roomId);
    expect(candidateOf(snap1)).toMatchObject({ status: "none", candidateId: null });
    const pv = previewOf(snap1);
    expect(pv === null || pv === undefined).toBe(true);
  });
  it("pending held across guide and takeover cannot restore preview after late resolve", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    ingest(svc, key, roomId, { meetingId, utteranceId: "u-pend", sequence: 1, revision: 1, speaker: "a", text: "trig" });
    expect(fake.calls.length).toBe(1);
    const pend = pendingAt(fake, 0);
    const g = await svc.actAs(key, { roomId, action: "guide", text: "guidance X" }, HEADERS);
    expect(g.status).toBe(200);
    const tk = await svc.actAs(key, { roomId, action: "takeover" }, HEADERS);
    expect(tk.status).toBe(200);
    pend.resolve({ subject: "s-late", body: "b-late", sourceRefs: [{ utteranceId: "u-pend", revision: 1 }] });
    await flush();
    const snap = await stateOf(svc, key, roomId);
    expect(candidateOf(snap)).toMatchObject({ status: "none", candidateId: null });
    const pv = previewOf(snap);
    expect(pv === null || pv === undefined).toBe(true);
    expect(mockEvaluateOutgoing).toHaveBeenCalledTimes(0);
  });
  it("repeated reads and second page same key share preview with 2 evals 1 reasoner, different key sees none", async () => {
    const fake = createFake();
    const options: CapOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    ingest(svc, key, roomId, { meetingId, utteranceId: "u-cache", sequence: 1, revision: 1, speaker: "a", text: "hi-cache" });
    pendingAt(fake, 0).resolve({ subject: "s-cache", body: "b-cache", sourceRefs: [{ utteranceId: "u-cache", revision: 1 }] });
    await flush();
    const snapA1 = await stateOf(svc, key, roomId);
    const candA1 = candidateOf(snapA1);
    const pvA1 = previewOf(snapA1);
    expect(pvA1).toMatchObject({ status: "released", candidateId: candA1.candidateId });
    expect(mockEvaluateOutgoing).toHaveBeenCalledTimes(2);
    expect(fake.calls.length).toBe(1);
    const snapA2 = await stateOf(svc, key, roomId);
    expect(candidateOf(snapA2).candidateId).toBe(candA1.candidateId);
    expect(previewOf(snapA2)).toEqual(pvA1);
    expect(mockEvaluateOutgoing).toHaveBeenCalledTimes(2);
    expect(fake.calls.length).toBe(1);
    const opened2 = svc.open("", HEADERS, key);
    const roomId2 = opened2.roomId;
    const snapB = await stateOf(svc, key, roomId2);
    expect(candidateOf(snapB).candidateId).toBe(candA1.candidateId);
    expect(previewOf(snapB)).toEqual(pvA1);
    expect(mockEvaluateOutgoing).toHaveBeenCalledTimes(2);
    const otherKey = randomUUID();
    const openedOther = svc.open("", HEADERS, otherKey);
    const snapOther = await stateOf(svc, otherKey, openedOther.roomId);
    expect(candidateOf(snapOther)).toMatchObject({ status: "none", candidateId: null });
    const pvOther = previewOf(snapOther);
    expect(pvOther === null || pvOther === undefined).toBe(true);
    expect(mockEvaluateOutgoing).toHaveBeenCalledTimes(2);
  });
});



