import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import type { CandidateReasonerInput } from "../src/meetingRoom.js";
import { getPolicyGeneration } from "@second-seat/core";

const HEADERS = { host: "127.0.0.1:4174" };
const TEST_ENV = { SECOND_SEAT_TEST_MODE: "1" } as const;

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

function candidateOf(snapshot: unknown): any{
  const s = snapshot as unknown as Record<string,unknown>;
  if(!s || typeof s !== "object") return undefined;
  if(!("candidate" in s)) return undefined;
  return (s as any).candidate;
}

async function stateOf(svc: any, key: string, roomId: string): Promise<any>{
  const res = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
  expect(res.status).toBe(200);
  expect(res.body.snapshot).not.toBeNull();
  return res.body.snapshot;
}

function ingest(svc:any, key:string, roomId:string, p:{meetingId:string,utteranceId:string,sequence:number,revision:number,speaker:string,text:string}){
  return svc.ingestConversationAs(key, roomId, { version:1, meetingId:p.meetingId, utteranceId:p.utteranceId, sequence:p.sequence, revision:p.revision, speaker:p.speaker, text:p.text });
}

function must<T>(v: T | null | undefined): T {
  expect(v).toBeDefined();
  expect(v).not.toBeNull();
  return v as T;
}
function pendingAt(fake: Fake, idx: number): Deferred<unknown> {
  expect(fake.pending.length).toBeGreaterThan(idx);
  return must(fake.pending[idx]);
}
function callAt(fake: Fake, idx: number): CandidateReasonerInput {
  expect(fake.calls.length).toBeGreaterThan(idx);
  return must(fake.calls[idx] as unknown as CandidateReasonerInput);
}

describe("P3a provisional candidate", ()=>{
  it("C1 accepted input triggers one full-context call, duplicates none, and a valid result is readable via bound state without touching the package", async ()=>{
    const fake = createFake();
    const svc: any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, sessionPolicy:true, candidateReasoner: fake.reasoner } as Parameters<typeof createMeetingRoomService>[0]);
    const storeKey = randomUUID();
    const opened = svc.open("", HEADERS, storeKey);
    const roomId = opened.roomId as string;
    const view0 = opened.view as any;
    const meetingId = view0.selectedMeetingId as string;
    const ownerId = view0.ownerId as string;
    const draft0 = { body: view0.draft.body, sha256: view0.draft.sha256, approved: view0.draft.approved, sendState: view0.draft.sendState };
    const packageId0 = (opened as any).packageId as string;

    // ingest u2 first (seq2)
    let r = ingest(svc, storeKey, roomId, { meetingId, utteranceId:"u2", sequence:2, revision:1, speaker:"alice", text:"hello u2" });
    expect(r.status).toBe(200);
    expect(fake.calls.length).toBe(1);
    const inp1 = fake.calls[0] as any;
    expect(inp1.roomId).toBe(roomId);
    expect(inp1.ownerId).toBe(ownerId);
    expect(inp1.meetingId).toBe(meetingId);
    expect(inp1.contextRevision).toBe(1);
    expect(inp1.policyGeneration).toBe(getPolicyGeneration(ownerId, meetingId));
    expect(inp1.utterances.map((u:any)=>u.utteranceId)).toEqual(["u2"]);
    expect(Object.isFrozen(inp1)).toBe(true);
    // mutate input copy should not affect (frozen)
    // second ingest while active -> coalesced
    r = ingest(svc, storeKey, roomId, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"bob", text:"hello u1" });
    expect(r.status).toBe(200);
    expect(fake.calls.length).toBe(1);
    // duplicate
    r = ingest(svc, storeKey, roomId, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"bob", text:"hello u1" });
    expect(fake.calls.length).toBe(1);
    // check pending snapshot
    let snap = r.body.snapshot as any;
    const candPending = candidateOf(snap);
    expect(candPending).toBeDefined();
    expect(candPending.status).toBe("pending");

    // resolve first call -> stale (context advanced to 2) so dispatch second
    fake.pending[0]!.resolve({ subject:"Follow-up: deadline", body:"Hi team, ...", sourceRefs:[{ utteranceId:"u2", revision:1 }] });
    await flush(); await flush();
    expect(fake.calls.length).toBe(2);
    const inp2 = fake.calls[1] as any;
    expect(inp2.contextRevision).toBe(2);
    expect(inp2.utterances.map((u:any)=>u.utteranceId)).toEqual(["u1","u2"]);
    // resolve second valid
    fake.pending[1]!.resolve({ subject:"final subject", body:"final body", sourceRefs:[{ utteranceId:"u1", revision:1 },{ utteranceId:"u2", revision:1 }] });
    await flush();
    const s = await stateOf(svc, storeKey, roomId);
    const cand = candidateOf(s);
    expect(cand.status).toBe("provisional");
    expect(cand.provisional).toBe(true);
    expect(cand.policyChecked).toBe(false);
    expect(cand.approved).toBe(false);
    expect(cand.contextRevision).toBe(2);
    expect(cand.subject).toBe("final subject");
    expect(cand.body).toBe("final body");
    expect(cand.sourceRefs).toEqual([{ utteranceId:"u1", revision:1 },{ utteranceId:"u2", revision:1 }]);
    // draft/package unchanged
    const v = s.view as any;
    expect(v.draft.body).toBe(draft0.body);
    expect(v.draft.sha256).toBe(draft0.sha256);
    expect(v.draft.approved).toBe(draft0.approved);
    expect(v.draft.sendState).toBe(draft0.sendState);
    expect(s.packageId).toBe(packageId0);
    expect(svc.sentBodies().length).toBe(0);
    // duplicate after provisional makes no call? Actually duplicate will early return -> no new call
    const before = fake.calls.length;
    ingest(svc, storeKey, roomId, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"bob", text:"hello u1" });
    expect(fake.calls.length).toBe(before);
  });

  it("C2 stale results are never published after context, guidance, meeting, takeover-resume or edit-restore changes, and bounds hold", async ()=>{
    // helper to create fresh room
    const make = ()=>{
      const fake = createFake();
      const svc:any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, sessionPolicy:true, candidateReasoner: fake.reasoner } as Parameters<typeof createMeetingRoomService>[0]);
      const key = randomUUID();
      const opened = svc.open("", HEADERS, key);
      return { fake, svc, key, opened, roomId: opened.roomId as string, meetingId:(opened.view as any).selectedMeetingId as string, ownerId:(opened.view as any).ownerId as string, otherMeetingId:(opened.view as any).meetings[1].id as string, draftBase:(opened.view as any).draft.base as string };
    };
    // (a) correction while held -> coalesced
    {
      const {fake, svc, key, roomId, meetingId} = make();
      ingest(svc,key,roomId,{meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1"});
      expect(fake.calls.length).toBe(1);
      ingest(svc,key,roomId,{meetingId, utteranceId:"u1", sequence:1, revision:2, speaker:"a", text:"t1-c2"});
      expect(fake.calls.length).toBe(1); // pending coalesce
      pendingAt(fake, 0).resolve({ subject:"stale-a", body:"b", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush(); await flush();
      expect(fake.calls.length).toBe(2);
      expect(must(callAt(fake, 1).utterances[0]).revision).toBe(2);
      // intermediate pending before fresh result
      {
        const sMid = await stateOf(svc,key,roomId);
        const cMid = candidateOf(sMid);
        expect(cMid).toBeDefined();
        expect(cMid.status).toBe("pending");
        expect(cMid.subject).toBeNull();
        expect(cMid.body).toBeNull();
        expect(callAt(fake, 1).contextRevision).toBe(2);
      }
      pendingAt(fake, 1).resolve({ subject:"good-a", body:"body-a", sourceRefs:[{ utteranceId:"u1", revision:2 }] });
      await flush();
      const s = await stateOf(svc,key,roomId);
      expect(candidateOf(s).status).toBe("provisional");
      expect(candidateOf(s).subject).toBe("good-a");
    }
    // (b) guide while held
    {
      const {fake, svc, key, roomId, meetingId} = make();
      ingest(svc,key,roomId,{meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1"});
      const beforeGen = getPolicyGeneration((await stateOf(svc,key,roomId)).view.ownerId, meetingId);
      // guide advances policy
      const g = await svc.actAs(key, { roomId, action:"guide", text:"Do not share any dates." }, HEADERS);
      expect(g.status).toBe(200);
      pendingAt(fake, 0).resolve({ subject:"stale-b", body:"b", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      let s = await stateOf(svc,key,roomId);
      let cand = candidateOf(s);
      expect(cand).toBeDefined();
      expect(cand.status).toBe("none");
      expect(cand.subject).toBeNull();
      expect(cand.body).toBeNull();
      // positive control
      ingest(svc,key,roomId,{meetingId, utteranceId:"u3", sequence:3, revision:1, speaker:"a", text:"t3"});
      await flush();
      expect(fake.calls.length).toBe(2);
      pendingAt(fake, 1).resolve({ subject:"good-b", body:"body-b", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      s = await stateOf(svc,key,roomId);
      expect(candidateOf(s).status).toBe("provisional");
      expect(candidateOf(s).subject).toBe("good-b");
    }
    // (c) select-meeting while held then back
    {
      const {fake, svc, key, roomId, meetingId, otherMeetingId} = make();
      ingest(svc,key,roomId,{meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1"});
      await svc.actAs(key, { roomId, action:"select-meeting", id: otherMeetingId }, HEADERS);
      await svc.actAs(key, { roomId, action:"select-meeting", id: meetingId }, HEADERS);
      pendingAt(fake, 0).resolve({ subject:"stale-c", body:"b", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      let s = await stateOf(svc,key,roomId);
      let cand = candidateOf(s);
      expect(cand).toBeDefined();
      expect(cand.status).toBe("none");
      expect(cand.subject).toBeNull();
      expect(cand.body).toBeNull();
      ingest(svc,key,roomId,{meetingId, utteranceId:"u3", sequence:3, revision:1, speaker:"a", text:"t3"});
      await flush();
      expect(fake.calls.length).toBe(2);
      pendingAt(fake, 1).resolve({ subject:"good-c", body:"body-c", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      s = await stateOf(svc,key,roomId);
      expect(candidateOf(s).status).toBe("provisional");
      expect(candidateOf(s).subject).toBe("good-c");
    }
    // (d1) takeover then resume while held with no ingest while taken over
    {
      const {fake, svc, key, roomId, meetingId} = make();
      ingest(svc,key,roomId,{meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1"});
      const snapBefore = await stateOf(svc,key,roomId);
      const revBefore = (snapBefore.conversation as any).contextRevision as number;
      const genBefore = getPolicyGeneration((snapBefore.view as any).ownerId, meetingId);
      await svc.actAs(key, { roomId, action:"takeover" }, HEADERS);
      await svc.actAs(key, { roomId, action:"resume" }, HEADERS);
      const snapMid = await stateOf(svc,key,roomId);
      expect((snapMid.conversation as any).contextRevision).toBe(revBefore);
      expect(getPolicyGeneration((snapMid.view as any).ownerId, meetingId)).toBe(genBefore);
      expect((snapMid.view as any).twinStatus).toBe("active");
      pendingAt(fake, 0).resolve({ subject:"stale-d", body:"b", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      let s = await stateOf(svc,key,roomId);
      let cand = candidateOf(s);
      expect(cand).toBeDefined();
      expect(cand.status).toBe("none");
      expect(cand.subject).toBeNull();
      expect(cand.body).toBeNull();
      ingest(svc,key,roomId,{meetingId, utteranceId:"u3", sequence:3, revision:1, speaker:"a", text:"t3"});
      await flush();
      expect(fake.calls.length).toBe(2);
      pendingAt(fake, 1).resolve({ subject:"good-d", body:"body-d", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      s = await stateOf(svc,key,roomId);
      expect(candidateOf(s).status).toBe("provisional");
      expect(candidateOf(s).subject).toBe("good-d");
    }
    // (d2) paused ingestion: takeover, ingest u2 queued as no call, settle while taken over, resume then fresh ingest
    {
      const {fake, svc, key, roomId, meetingId} = make();
      ingest(svc,key,roomId,{meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1"});
      await svc.actAs(key, { roomId, action:"takeover" }, HEADERS);
      const r2 = ingest(svc,key,roomId,{meetingId, utteranceId:"u2", sequence:2, revision:1, speaker:"a", text:"t2"});
      expect(r2.status).toBe(200);
      expect(fake.calls.length).toBe(1);
      pendingAt(fake, 0).resolve({ subject:"stale-d2", body:"b", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      let s = await stateOf(svc,key,roomId);
      let cand = candidateOf(s);
      expect(cand).toBeDefined();
      expect(cand.status).toBe("none");
      expect(cand.subject).toBeNull();
      expect(cand.body).toBeNull();
      await svc.actAs(key, { roomId, action:"resume" }, HEADERS);
      const r3 = ingest(svc,key,roomId,{meetingId, utteranceId:"u3", sequence:3, revision:1, speaker:"a", text:"t3"});
      expect(r3.status).toBe(200);
      await flush();
      expect(fake.calls.length).toBe(2);
      pendingAt(fake, 1).resolve({ subject:"good-d2", body:"body-d2", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      s = await stateOf(svc,key,roomId);
      expect(candidateOf(s).status).toBe("provisional");
      expect(candidateOf(s).subject).toBe("good-d2");
    }
    // (e) edit-draft then back while held
    {
      const {fake, svc, key, roomId, meetingId, draftBase} = make();
      ingest(svc,key,roomId,{meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1"});
      const inp1 = callAt(fake, 0);
      const snapBefore = await stateOf(svc,key,roomId);
      const origSha = (snapBefore.view as any).draft.sha256;
      await svc.actAs(key, { roomId, action:"edit-draft", text: draftBase + " extra" }, HEADERS);
      await svc.actAs(key, { roomId, action:"edit-draft", text: draftBase }, HEADERS);
      const snapAfter = await stateOf(svc,key,roomId);
      expect((snapAfter.view as any).draft.sha256).toBe(origSha);
      // contextRevision and policy generation unchanged
      expect((snapAfter.conversation as any).contextRevision).toBe(inp1.contextRevision);
      expect(getPolicyGeneration(snapAfter.view.ownerId, meetingId)).toBe(inp1.policyGeneration);
      pendingAt(fake, 0).resolve({ subject:"stale-e", body:"b", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      let s = await stateOf(svc,key,roomId);
      let cand = candidateOf(s);
      expect(cand).toBeDefined();
      expect(cand.status).toBe("none");
      expect(cand.subject).toBeNull();
      expect(cand.body).toBeNull();
      ingest(svc,key,roomId,{meetingId, utteranceId:"u3", sequence:3, revision:1, speaker:"a", text:"t3"});
      await flush();
      expect(fake.calls.length).toBe(2);
      pendingAt(fake, 1).resolve({ subject:"good-e", body:"body-e", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      s = await stateOf(svc,key,roomId);
      expect(candidateOf(s).status).toBe("provisional");
      expect(candidateOf(s).subject).toBe("good-e");
    }
    // bounds coalesce
    {
      const {fake, svc, key, roomId, meetingId} = make();
      ingest(svc,key,roomId,{meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1"});
      ingest(svc,key,roomId,{meetingId, utteranceId:"u2", sequence:2, revision:1, speaker:"a", text:"t2"});
      ingest(svc,key,roomId,{meetingId, utteranceId:"u3", sequence:3, revision:1, speaker:"a", text:"t3"});
      expect(fake.calls.length).toBe(1);
      pendingAt(fake, 0).resolve({ subject:"stale-bounds", body:"b", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush(); await flush();
      expect(fake.calls.length).toBe(2);
      expect(callAt(fake, 1).utterances.length).toBe(3);
      expect(fake.calls.length).toBe(2);
    }
    // eviction
    {
      const fake = createFake();
      const svc:any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, sessionPolicy:true, candidateReasoner: fake.reasoner, maxPagesPerKey:1 } as Parameters<typeof createMeetingRoomService>[0]);
      const key = randomUUID();
      const o1 = svc.open("", HEADERS, key);
      const rid1 = o1.roomId as string;
      const mid = (o1.view as any).selectedMeetingId as string;
      ingest(svc,key,rid1,{meetingId:mid, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1"});
      ingest(svc,key,rid1,{meetingId:mid, utteranceId:"u2", sequence:2, revision:1, speaker:"a", text:"t2"});
      const o2 = svc.open("", HEADERS, key);
      // old page evicted
      pendingAt(fake, 0).resolve({ subject:"stale-evict", body:"b", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      expect(fake.calls.length).toBe(1);
      const r = await svc.actAs(key, { roomId: rid1, action:"state" }, HEADERS);
      expect(r.status).toBe(404);
    }
  });

  it("C3 malformed or unknown-reference results fail honestly, unbound browsers cannot trigger or read, and disabled mode is unchanged", async ()=>{
    const badCases: unknown[] = [
      null,
      "text",
      { subject:"", body:"x", sourceRefs:[{ utteranceId:"u1", revision:1 }] },
      { subject:"s", body:"   ", sourceRefs:[{ utteranceId:"u1", revision:1 }] },
      { subject:"s", body:"b" },
      { subject:"s", body:"b", sourceRefs:[] },
      { subject:"s", body:"b", sourceRefs:[{ utteranceId:"unknown", revision:1 }] },
      { subject:"s", body:"b", sourceRefs:[{ utteranceId:"u1", revision:2 }] },
      { subject:"s", body:"b", sourceRefs:[{ utteranceId:"unknown", revision:1 }], toolCalls:[{ name:"send" }] },
    ];
    for(const bad of badCases){
      const fake = createFake();
      const svc:any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, sessionPolicy:true, candidateReasoner: fake.reasoner } as Parameters<typeof createMeetingRoomService>[0]);
      const key = randomUUID();
      const opened = svc.open("", HEADERS, key);
      const roomId = opened.roomId as string;
      const meetingId = (opened.view as any).selectedMeetingId as string;
      ingest(svc,key,roomId,{meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1"});
      pendingAt(fake, 0);
      pendingAt(fake, 0).resolve(bad);
      await flush();
      const s = await stateOf(svc,key,roomId);
      const cand = candidateOf(s);
      expect(cand).toBeDefined();
      expect(cand.status).toBe("failed");
      expect(cand.subject).toBeNull();
      expect(cand.body).toBeNull();
      expect(fake.calls.length).toBe(1);
      expect(svc.sentBodies().length).toBe(0);
    }
    // rejected promise
    {
      const fake = createFake();
      const svc:any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, sessionPolicy:true, candidateReasoner: fake.reasoner } as Parameters<typeof createMeetingRoomService>[0]);
      const key = randomUUID();
      const opened = svc.open("", HEADERS, key);
      const roomId = opened.roomId as string;
      const meetingId = (opened.view as any).selectedMeetingId as string;
      ingest(svc,key,roomId,{meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1"});
      pendingAt(fake, 0).reject(new Error("boom"));
      await flush();
      const s = await stateOf(svc,key,roomId);
      const cand2 = candidateOf(s);
      expect(cand2).toBeDefined();
      expect(cand2.status).toBe("failed");
      expect(cand2.subject).toBeNull();
      expect(fake.calls.length).toBe(1);
    }
    // wrong key and null key
    {
      const fake = createFake();
      const svc:any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, sessionPolicy:true, candidateReasoner: fake.reasoner } as Parameters<typeof createMeetingRoomService>[0]);
      const key = randomUUID();
      const opened = svc.open("", HEADERS, key);
      const roomId = opened.roomId as string;
      const meetingId = (opened.view as any).selectedMeetingId as string;
      const r1 = svc.ingestConversationAs("wrong-key", roomId, { version:1, meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
      expect(r1.status).toBe(404);
      expect(fake.calls.length).toBe(0);
      const r2 = svc.ingestConversationAs(null, roomId, { version:1, meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
      expect(r2.status).toBe(404);
      expect(fake.calls.length).toBe(0);
      const r3 = await svc.actAs("wrong-key", { roomId, action:"state" }, HEADERS);
      expect(r3.status).toBe(404);
      expect(r3.body.snapshot).toBeNull();
      const r4 = await svc.actAs(null, { roomId, action:"state" }, HEADERS);
      expect(r4.status).toBe(404);
      expect(r4.body.snapshot).toBeNull();
    }
    // disabled modes
    {
      const fake = createFake();
      const svc1:any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, candidateReasoner: fake.reasoner } as Parameters<typeof createMeetingRoomService>[0]);
      const k1 = randomUUID();
      const o1 = svc1.open("", HEADERS, k1);
      const s1 = await stateOf(svc1,k1,o1.roomId);
      expect("candidate" in s1).toBe(false);
      const mid1 = (o1.view as any).selectedMeetingId as string;
      const rOk = svc1.ingestConversationAs(k1, o1.roomId, { version:1, meetingId: mid1, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
      expect(rOk.status).toBe(200);
      expect(fake.calls.length).toBe(0);
      expect("candidate" in await stateOf(svc1,k1,o1.roomId)).toBe(false);
      const svc2:any = createMeetingRoomService({ env: TEST_ENV, sessionPolicy:true, candidateReasoner: fake.reasoner } as Parameters<typeof createMeetingRoomService>[0]);
      const k2 = randomUUID();
      const o2 = svc2.open("", HEADERS, k2);
      const mid2 = (o2.view as any).selectedMeetingId as string;
      const r = svc2.ingestConversationAs(k2, o2.roomId, { version:1, meetingId:mid2, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
      expect(r.status).toBe(403);
      expect(fake.calls.length).toBe(0);
      const svc3:any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, sessionPolicy:true } as Parameters<typeof createMeetingRoomService>[0]);
      const k3 = randomUUID();
      const o3 = svc3.open("", HEADERS, k3);
      const s3 = await stateOf(svc3,k3,o3.roomId);
      expect("candidate" in s3).toBe(false);
      const mid3 = (o3.view as any).selectedMeetingId as string;
      const r3b = svc3.ingestConversationAs(k3, o3.roomId, { version:1, meetingId: mid3, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
      expect(r3b.status).toBe(200);
      expect("candidate" in await stateOf(svc3,k3,o3.roomId)).toBe(false);
      expect(o3.view.draft.body).toBe((s3.view as any).draft.body);
      expect(svc3.sentBodies().length).toBe(0);
    }
  });
  describe("P3a-R1 shared-room candidate coordination", ()=>{
    it("R1-1a same-browser page B edit-restore invalidates page A held result", async ()=>{
      // sub-case (a) edit-draft restore
      {
        const fake = createFake();
        const svc: any = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner } as Parameters<typeof createMeetingRoomService>[0]);
        const key = randomUUID();
        const openedA = svc.open("", HEADERS, key);
        const roomIdA = openedA.roomId as string;
        const viewA0 = openedA.view as any;
        const meetingId = viewA0.selectedMeetingId as string;
        const draftBase = viewA0.draft.base as string;
        const openedB = svc.open("", HEADERS, key);
        const roomIdB = openedB.roomId as string;
        // same TwinRoom shared
        let r = ingest(svc, key, roomIdA, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"alice", text:"hello u1" });
        expect(r.status).toBe(200);
        expect(fake.calls.length).toBe(1);
        expect(fake.pending.length).toBe(1);
        const snapABefore = await stateOf(svc, key, roomIdA);
        const origBody = (snapABefore.view as any).draft.body as string;
        const origSha = (snapABefore.view as any).draft.sha256 as string;
        const origRev = (snapABefore.conversation as any).contextRevision as number;
        const origGen = getPolicyGeneration((snapABefore.view as any).ownerId, meetingId);
        // B edit then restore
        let er = await svc.actAs(key, { roomId: roomIdB, action:"edit-draft", text: draftBase + " extra" }, HEADERS);
        expect(er.status).toBe(200);
        er = await svc.actAs(key, { roomId: roomIdB, action:"edit-draft", text: draftBase }, HEADERS);
        expect(er.status).toBe(200);
        const snapAfter = await stateOf(svc, key, roomIdB);
        expect((snapAfter.view as any).draft.body).toBe(origBody);
        expect((snapAfter.view as any).draft.sha256).toBe(origSha);
        expect((snapAfter.conversation as any).contextRevision).toBe(origRev);
        expect(getPolicyGeneration((snapAfter.view as any).ownerId, meetingId)).toBe(origGen);
        // resolve held call with valid output - should be invalidated by shared epoch
        pendingAt(fake, 0).resolve({ subject:"should be dropped", body:"body dropped", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
        await flush();
        for(const rid of [roomIdA, roomIdB]){
          const s = await stateOf(svc, key, rid);
          const cand = candidateOf(s);
          expect(cand).toBeDefined();
          expect(cand.status).toBe("none");
          expect(cand.subject).toBeNull();
          expect(cand.body).toBeNull();
        }
        // fresh work via B should succeed
        ingest(svc, key, roomIdB, { meetingId, utteranceId:"u2", sequence:2, revision:1, speaker:"bob", text:"hello u2" });
        expect(fake.calls.length).toBe(2);
        const inp2 = callAt(fake, 1);
        expect(inp2.utterances.map((u:any)=>u.utteranceId).sort()).toEqual(["u1","u2"].sort());
        pendingAt(fake, 1).resolve({ subject:"fresh subject", body:"fresh body", sourceRefs:[{ utteranceId:"u1", revision:1 },{ utteranceId:"u2", revision:1 }] });
        await flush();
        const sA2 = await stateOf(svc, key, roomIdA);
        const cA2 = candidateOf(sA2);
        expect(cA2).toBeDefined();
        expect(cA2.status).toBe("provisional");
        expect(cA2.subject).toBe("fresh subject");
        const sB2 = await stateOf(svc, key, roomIdB);
        const cB2 = candidateOf(sB2);
        expect(cB2).toBeDefined();
        expect(cB2.status).toBe("provisional");
        expect(cB2.subject).toBe("fresh subject");
        expect(candidateOf(sA2).subject).toBe("fresh subject");
        expect(fake.calls.length).toBe(2);
        // after settle both pages explicit none when invalidated (already asserted above)
        // also verify B side unchanged contextRevision/policy/draft not bumped checked above
      }
    });
    it("R1-1b same-browser page B takeover-resume invalidates page A held result", async ()=>{
      const fake = createFake();
      const svc: any = createMeetingRoomService({ env: TEST_ENV, conversationInput: true, sessionPolicy: true, candidateReasoner: fake.reasoner } as Parameters<typeof createMeetingRoomService>[0]);
      const key = randomUUID();
      const openedA = svc.open("", HEADERS, key);
      const roomIdA = openedA.roomId as string;
      const viewA0 = openedA.view as any;
      const meetingId = viewA0.selectedMeetingId as string;
      const openedB = svc.open("", HEADERS, key);
      const roomIdB = openedB.roomId as string;
      let r = ingest(svc, key, roomIdA, { meetingId, utteranceId:"u1", sequence:1, revision:1, speaker:"alice", text:"hello u1" });
      expect(r.status).toBe(200);
      expect(fake.calls.length).toBe(1);
      const snapBefore = await stateOf(svc, key, roomIdA);
      const origRev = (snapBefore.conversation as any).contextRevision as number;
      const origGen = getPolicyGeneration((snapBefore.view as any).ownerId, meetingId);
      const origSha = (snapBefore.view as any).draft.sha256 as string;
      let tr = await svc.actAs(key, { roomId: roomIdB, action:"takeover" }, HEADERS);
      expect(tr.status).toBe(200);
      tr = await svc.actAs(key, { roomId: roomIdB, action:"resume" }, HEADERS);
      expect(tr.status).toBe(200);
      const snapAfter = await stateOf(svc, key, roomIdB);
      expect((snapAfter.conversation as any).contextRevision).toBe(origRev);
      expect(getPolicyGeneration((snapAfter.view as any).ownerId, meetingId)).toBe(origGen);
      expect((snapAfter.view as any).draft.sha256).toBe(origSha);
      expect((snapAfter.view as any).twinStatus).toBe("active");
      pendingAt(fake, 0).resolve({ subject:"stale takeover", body:"body stale", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      for(const rid of [roomIdA, roomIdB]){
        const s = await stateOf(svc, key, rid);
        const cand = candidateOf(s);
        expect(cand).toBeDefined();
        expect(cand.status).toBe("none");
        expect(cand.subject).toBeNull();
        expect(cand.body).toBeNull();
      }
      ingest(svc, key, roomIdB, { meetingId, utteranceId:"u2", sequence:2, revision:1, speaker:"bob", text:"hello u2" });
      expect(fake.calls.length).toBe(2);
      pendingAt(fake, 1).resolve({ subject:"fresh2", body:"body2", sourceRefs:[{ utteranceId:"u1", revision:1 },{ utteranceId:"u2", revision:1 }] });
      await flush();
      for(const rid of [roomIdA, roomIdB]){
        const s = await stateOf(svc, key, rid);
        const c = candidateOf(s);
        expect(c).toBeDefined();
        expect(c.status).toBe("provisional");
        expect(c.subject).toBe("fresh2");
        expect(c.body).toBe("body2");
      }
      expect(fake.calls.length).toBe(2);
    });
    it("R1-2 evicted page never publishes and pending work moves to the latest authorized page", async ()=>{
      // main case: pending moves to latest page
      {
        const fake = createFake();
        const svc:any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, sessionPolicy:true, candidateReasoner: fake.reasoner, maxPagesPerKey:1 } as Parameters<typeof createMeetingRoomService>[0]);
        const key = randomUUID();
        const oA = svc.open("", HEADERS, key);
        const ridA = oA.roomId as string;
        const mid = (oA.view as any).selectedMeetingId as string;
        let r = ingest(svc, key, ridA, { meetingId: mid, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
        expect(r.status).toBe(200);
        expect(fake.calls.length).toBe(1);
        expect(fake.pending.length).toBe(1);
        const oB = svc.open("", HEADERS, key);
        const ridB = oB.roomId as string;
        const ev = await svc.actAs(key, { roomId: ridA, action:"state" }, HEADERS);
        expect(ev.status).toBe(404);
        // ingest via B while A call held -> should NOT start second concurrent call (shared bound)
        ingest(svc, key, ridB, { meetingId: mid, utteranceId:"u2", sequence:2, revision:1, speaker:"a", text:"t2" });
        expect(fake.calls.length).toBe(1);
        // resolve first call validly; should redispatch for B
        pendingAt(fake, 0).resolve({ subject:"stale evict", body:"body stale", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
        await flush(); await flush();
        expect(fake.calls.length).toBe(2);
        const inp2 = callAt(fake, 1);
        expect(inp2.roomId).toBe(ridB);
        expect(inp2.utterances.map((u:any)=>u.utteranceId).sort()).toEqual(["u1","u2"].sort());
        const snapBefore = await stateOf(svc, key, ridB);
        const candBefore = candidateOf(snapBefore);
        expect(candBefore).toBeDefined();
        expect(candBefore.status).toBe("pending");
        expect(candBefore.subject).toBeNull();
        expect(candBefore.body).toBeNull();
        pendingAt(fake, 1).resolve({ subject:"good evict", body:"body good", sourceRefs:[{ utteranceId:"u2", revision:1 }] });
        await flush();
        const snapB = await stateOf(svc, key, ridB);
        const candB = candidateOf(snapB);
        expect(candB).toBeDefined();
        expect(candB.status).toBe("provisional");
        expect(candB.subject).toBe("good evict");
        expect(fake.calls.length).toBe(2);
      }
      // opposite control: no B input, resolve should not publish nor create new call
      {
        const fake = createFake();
        const svc:any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, sessionPolicy:true, candidateReasoner: fake.reasoner, maxPagesPerKey:1 } as Parameters<typeof createMeetingRoomService>[0]);
        const key = randomUUID();
        const oA = svc.open("", HEADERS, key);
        const ridA = oA.roomId as string;
        const mid = (oA.view as any).selectedMeetingId as string;
        ingest(svc, key, ridA, { meetingId: mid, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
        expect(fake.calls.length).toBe(1);
        const oB = svc.open("", HEADERS, key);
        const ridB = oB.roomId as string;
        // no B input
        pendingAt(fake, 0).resolve({ subject:"should not appear", body:"body", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
        await flush();
        expect(fake.calls.length).toBe(1);
        const snapB = await stateOf(svc, key, ridB);
        const candB = candidateOf(snapB);
        expect(candB).toBeDefined();
        expect(candB.status).toBe("none");
        expect(candB.subject).toBeNull();
        expect(candB.body).toBeNull();
      }
    });
    it("R1-3 pages share one-active/one-latest; another browser stays isolated", async ()=>{
      const fake = createFake();
      const svc:any = createMeetingRoomService({ env: TEST_ENV, conversationInput:true, sessionPolicy:true, candidateReasoner: fake.reasoner } as Parameters<typeof createMeetingRoomService>[0]);
      const keyAB = randomUUID();
      const keyC = randomUUID();
      const oA = svc.open("", HEADERS, keyAB);
      const ridA = oA.roomId as string;
      const midAB = (oA.view as any).selectedMeetingId as string;
      const oB = svc.open("", HEADERS, keyAB);
      const ridB = oB.roomId as string;
      // A and B share same TwinRoom/meeting but different page ids
      expect(ridB).not.toBe(ridA);
      expect((oB.view as any).selectedMeetingId).toBe(midAB);
      const oC = svc.open("", HEADERS, keyC);
      const ridC = oC.roomId as string;
      const midC = (oC.view as any).selectedMeetingId as string;
      // ingest u1 via A -> one call
      ingest(svc, keyAB, ridA, { meetingId: midAB, utteranceId:"u1", sequence:1, revision:1, speaker:"a", text:"t1" });
      expect(fake.calls.length).toBe(1);
      // ingest u2 via A and u3 via B while held -> still one call
      ingest(svc, keyAB, ridA, { meetingId: midAB, utteranceId:"u2", sequence:2, revision:1, speaker:"a", text:"t2" });
      expect(fake.calls.length).toBe(1);
      ingest(svc, keyAB, ridB, { meetingId: midAB, utteranceId:"u3", sequence:3, revision:1, speaker:"a", text:"t3" });
      expect(fake.calls.length).toBe(1);
      // ingest into C isolated -> second call
      ingest(svc, keyC, ridC, { meetingId: midC, utteranceId:"u9", sequence:1, revision:1, speaker:"c", text:"tc" });
      expect(fake.calls.length).toBe(2);
      expect(callAt(fake, 1).roomId).toBe(ridC);
      // resolve A held (stale) -> exactly one coalesced call for B room
      pendingAt(fake, 0).resolve({ subject:"stale", body:"b", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush(); await flush();
      expect(fake.calls.length).toBe(3);
      const inp3 = callAt(fake, 2);
      expect(inp3.roomId).toBe(ridB);
      expect(inp3.utterances.map((u:any)=>u.utteranceId).sort()).toEqual(["u1","u2","u3"].sort());
      expect(fake.calls.length).toBe(3);
      // resolve coalesced validly -> A and B provisional with exact fields
      const ctx2 = callAt(fake, 2).contextRevision;
      pendingAt(fake, 2).resolve({ subject:"final AB", body:"body AB", sourceRefs:[{ utteranceId:"u1", revision:1 }] });
      await flush();
      for(const rid of [ridA, ridB]){
        const s = await stateOf(svc, keyAB, rid);
        const cand = candidateOf(s);
        expect(cand).toBeDefined();
        expect(cand.status).toBe("provisional");
        expect(cand.subject).toBe("final AB");
        expect(cand.body).toBe("body AB");
        expect(cand.sourceRefs).toEqual([{ utteranceId:"u1", revision:1 }]);
        expect(cand.contextRevision).toBe(ctx2);
      }
      // C unaffected (still pending until its own call settles)
      const sCpre = await stateOf(svc, keyC, ridC);
      const candCpre = candidateOf(sCpre);
      expect(candCpre).toBeDefined();
      expect(candCpre.status).toBe("pending");
      // resolve C
      pendingAt(fake, 1).resolve({ subject:"final C", body:"body C", sourceRefs:[{ utteranceId:"u9", revision:1 }] });
      await flush();
      const sC = await stateOf(svc, keyC, ridC);
      const candC = candidateOf(sC);
      expect(candC).toBeDefined();
      expect(candC.status).toBe("provisional");
      expect(candC.subject).toBe("final C");
      expect(candC.body).toBe("body C");
      expect(candC.sourceRefs).toEqual([{ utteranceId:"u9", revision:1 }]);
      // re-read A and B unchanged
      for(const rid of [ridA, ridB]){
        const s = await stateOf(svc, keyAB, rid);
        const cand = candidateOf(s);
        expect(cand.subject).toBe("final AB");
        expect(cand.body).toBe("body AB");
      }
      expect(fake.calls.length).toBe(3);
    });
  });
});
