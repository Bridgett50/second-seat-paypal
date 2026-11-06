import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import type { CandidateReasonerInput, MeetingRoomSnapshot, MeetingRoomCandidateSnapshot } from "../src/meetingRoom.js";

const HEADERS = { host: "127.0.0.1:4174" };
const TEST_ENV = { SECOND_SEAT_TEST_MODE: "1" } as const;

type DeadlineOptions = NonNullable<Parameters<typeof createMeetingRoomService>[0]> & { candidateDeadlineMs?: number };
type Service = ReturnType<typeof createMeetingRoomService>;

type Deferred<T> = { promise: Promise<T>; resolve: (v: T)=>void; reject: (e:unknown)=>void };
function deferred<T>(): Deferred<T>{
  let resolve!: (v:T)=>void; let reject!: (e:unknown)=>void;
  const promise = new Promise<T>((res,rej)=>{ resolve=res; reject=rej; });
  return { promise, resolve, reject };
}

type Fake = {
  reasoner: (input: CandidateReasonerInput)=>Promise<unknown>;
  calls: CandidateReasonerInput[];
  pending: Deferred<unknown>[];
};
function createFake(): Fake{
  const calls: CandidateReasonerInput[] = [];
  const pending: Deferred<unknown>[] = [];
  const reasoner = (input: CandidateReasonerInput): Promise<unknown>=>{
    calls.push(input);
    const d = deferred<unknown>();
    pending.push(d);
    return d.promise;
  };
  return { reasoner, calls, pending };
}

const flush = () => new Promise<void>((r)=> setImmediate(r));

function must<T>(v: T | null | undefined): T {
  expect(v).toBeDefined();
  expect(v).not.toBeNull();
  if(v === null || v === undefined) throw new Error("must: nullish");
  return v;
}

function candidateOf(snapshot: MeetingRoomSnapshot): MeetingRoomCandidateSnapshot {
  return must(snapshot.candidate);
}

function stateOf(svc: Service, key: string, roomId: string): Promise<MeetingRoomSnapshot> {
  return svc.actAs(key, { roomId, action: "state" }, HEADERS).then((res)=>{
    expect(res.status).toBe(200);
    expect(res.body.snapshot).not.toBeNull();
    return must(res.body.snapshot);
  });
}

function ingest(svc: Service, key:string, roomId:string, p:{meetingId:string,utteranceId:string,sequence:number,revision:number,speaker:string,text:string}){
  return svc.ingestConversationAs(key, roomId, { version:1, meetingId:p.meetingId, utteranceId:p.utteranceId, sequence:p.sequence, revision:p.revision, speaker:p.speaker, text:p.text });
}

function pendingAt(fake: Fake, idx: number): Deferred<unknown> {
  expect(fake.pending.length).toBeGreaterThan(idx);
  return must(fake.pending[idx]);
}
function callAt(fake: Fake, idx: number): CandidateReasonerInput {
  expect(fake.calls.length).toBeGreaterThan(idx);
  return must(fake.calls[idx]);
}

function makeRoom(options: DeadlineOptions){
  const svc = createMeetingRoomService(options);
  const key = randomUUID();
  const opened = svc.open("", HEADERS, key);
  const roomId = opened.roomId;
  const meetingId = opened.view.selectedMeetingId;
  return { svc, key, roomId, meetingId };
}

function optionsWith(fake: Fake, v: number): DeadlineOptions {
  return { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateDeadlineMs: v };
}

describe("P3d candidate reasoner deadline", ()=>{
  beforeEach(()=>{ vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
  afterEach(()=>{ vi.useRealTimers(); });

  it("D1 hung call hits the deadline", async ()=>{
    const fake = createFake();
    const options: DeadlineOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateDeadlineMs: 1000 };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
    expect(fake.calls.length).toBe(1);
    vi.advanceTimersByTime(999);
    let snap = await stateOf(svc, key, roomId);
    let cand = candidateOf(snap);
    expect(cand.status).toBe("pending");
    vi.advanceTimersByTime(1);
    snap = await stateOf(svc, key, roomId);
    cand = candidateOf(snap);
    expect(cand.status).toBe("failed");
    expect(cand.note).toBe("Candidate unavailable: reasoner timed out. It was not retried.");
    expect(cand.subject).toBeNull();
    expect(cand.body).toBeNull();
    expect(cand.sourceRefs).toEqual([]);
    expect(cand.approved).toBe(false);
    expect(fake.calls.length).toBe(1);
  });

  it("D2 no overlapping physical call and single drain only after real settlement", async ()=>{
    const fake = createFake();
    const options: DeadlineOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateDeadlineMs: 1000 };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
    vi.advanceTimersByTime(1000);
    await ingest(svc, key, roomId, { meetingId, utteranceId:"u2", sequence:2, revision:1, speaker:"a", text:"t2" });
    await ingest(svc, key, roomId, { meetingId, utteranceId:"u3", sequence:3, revision:1, speaker:"a", text:"t3" });
    expect(fake.calls.length).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject:"late-subject-should-be-discarded", body:"late-body", sourceRefs:[{utteranceId:"u1", revision:1}] });
    await flush();
    await flush();
    expect(fake.calls.length).toBe(2);
    const c1 = callAt(fake, 1);
    expect(c1.contextRevision).toBe(3);
    expect(c1.utterances.map((u)=>u.utteranceId)).toEqual(expect.arrayContaining(["u1","u2","u3"]));
    // resolve drained call before its deadline
    pendingAt(fake, 1).resolve({ subject:"drained-ok", body:"drained-body", sourceRefs:[{utteranceId:"u3", revision:1}] });
    await flush();
    const snap = await stateOf(svc, key, roomId);
    const cand = candidateOf(snap);
    expect(cand.status).toBe("provisional");
    expect(cand.subject).toBe("drained-ok");
  });

  it("D3 late results discarded", async ()=>{
    // (a) late valid resolve discarded
    {
      const fake = createFake();
      const options: DeadlineOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateDeadlineMs: 1000 };
      const { svc, key, roomId, meetingId } = makeRoom(options);
      await ingest(svc, key, roomId, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
      vi.advanceTimersByTime(1000);
      pendingAt(fake, 0).resolve({ subject:"should-not-adopt", body:"body-a", sourceRefs:[{utteranceId:"u1", revision:1}] });
      await flush();
      const snap = await stateOf(svc, key, roomId);
      const cand = candidateOf(snap);
      expect(cand.status).toBe("failed");
      expect(cand.note).toBe("Candidate unavailable: reasoner timed out. It was not retried.");
      expect(cand.subject).toBeNull();
      expect(fake.calls.length).toBe(1);
    }
    // (b) late reject discarded, fresh room
    {
      const fake = createFake();
      const options: DeadlineOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateDeadlineMs: 1000 };
      const { svc, key, roomId, meetingId } = makeRoom(options);
      await ingest(svc, key, roomId, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
      vi.advanceTimersByTime(1000);
      pendingAt(fake, 0).reject(new Error("boom"));
      await flush();
      const snap = await stateOf(svc, key, roomId);
      const cand = candidateOf(snap);
      expect(cand.status).toBe("failed");
      expect(cand.note).toBe("Candidate unavailable: reasoner timed out. It was not retried.");
      expect(fake.calls.length).toBe(1);
    }
  });

  it("D4 fast resolution unchanged", async ()=>{
    const fake = createFake();
    const options: DeadlineOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateDeadlineMs: 1000 };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
    vi.advanceTimersByTime(500);
    pendingAt(fake, 0).resolve({ subject:"fast-sub", body:"fast-body", sourceRefs:[{utteranceId:"u1", revision:1}] });
    await flush();
    let snap = await stateOf(svc, key, roomId);
    let cand = candidateOf(snap);
    expect(cand.status).toBe("provisional");
    expect(cand.subject).toBe("fast-sub");
    expect(cand.body).toBe("fast-body");
    expect(cand.sourceRefs).toEqual([{ utteranceId:"u1", revision:1 }]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    snap = await stateOf(svc, key, roomId);
    cand = candidateOf(snap);
    expect(cand.status).toBe("provisional");
    expect(cand.subject).toBe("fast-sub");
    expect(fake.calls.length).toBe(1);
  });

  it("D5 configuration", async ()=>{
    for(const v of [0, -1, 1.5, NaN, Infinity]){
      const fake = createFake();
      const options = optionsWith(fake, v);
      expect(()=>createMeetingRoomService(options)).toThrow(RangeError);
      expect(fake.calls.length).toBe(0);
    }
    // default
    {
      const fake = createFake();
      const defaultOptions: DeadlineOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner };
      const { svc, key, roomId, meetingId } = makeRoom(defaultOptions);
      await ingest(svc, key, roomId, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
      vi.advanceTimersByTime(9999);
      let snap = await stateOf(svc, key, roomId);
      let cand = candidateOf(snap);
      expect(cand.status).toBe("pending");
      vi.advanceTimersByTime(1);
      snap = await stateOf(svc, key, roomId);
      cand = candidateOf(snap);
      expect(cand.status).toBe("failed");
      expect(cand.note).toBe("Candidate unavailable: reasoner timed out. It was not retried.");
    }
  });

  it("D6 stale timer does not publish over newer state", async ()=>{
    const fake = createFake();
    const options: DeadlineOptions = { env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner, candidateDeadlineMs: 1000 };
    const { svc, key, roomId, meetingId } = makeRoom(options);
    await ingest(svc, key, roomId, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
    expect(fake.calls.length).toBe(1);
    vi.advanceTimersByTime(500);
    const g = await svc.actAs(key, { roomId, action:"guide", text:"Do not share any dates." }, HEADERS);
    expect(g.status).toBe(200);
    vi.advanceTimersByTime(500);
    let snap = await stateOf(svc, key, roomId);
    let cand = candidateOf(snap);
    expect(cand.status).toBe("none");
    expect(cand.subject).toBeNull();
    await ingest(svc, key, roomId, { meetingId, utteranceId:"u3", sequence:3, revision:1, speaker:"a", text:"t3" });
    expect(fake.calls.length).toBe(1);
    pendingAt(fake, 0).resolve({ subject:"stale-should-not-adopt", body:"body", sourceRefs:[{utteranceId:"u1", revision:1}] });
    await flush();
    await flush();
    expect(fake.calls.length).toBe(2);
    snap = await stateOf(svc, key, roomId);
    cand = candidateOf(snap);
    // after drain, still pending because second call hasn't resolved
    expect(cand.status).toBe("pending");
    pendingAt(fake, 1).resolve({ subject:"good-after-drain", body:"body2", sourceRefs:[{utteranceId:"u3", revision:1}] });
    await flush();
    snap = await stateOf(svc, key, roomId);
    cand = candidateOf(snap);
    expect(cand.status).toBe("provisional");
    expect(cand.subject).toBe("good-after-drain");
  });
});
