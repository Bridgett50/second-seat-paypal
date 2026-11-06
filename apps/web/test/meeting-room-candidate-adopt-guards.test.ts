import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import type { CandidateReasonerInput } from "../src/meetingRoom.js";

const HEADERS = { host: "127.0.0.1:4174" };
const SAFE_GUIDE = "Do not share any dates.";
const HELD_GUIDE = "Be careful about dates.";
const REASONER_RESULT = {
  subject: "Meeting on 2026-11-15",
  body: "Thanks for the discussion.",
  sourceRefs: [{ utteranceId: "u1", revision: 1 }],
};

function flush(): Promise<void> {
  return new Promise<void>((r) => { setImmediate(r); });
}

function makeReasoner() {
  const calls: CandidateReasonerInput[] = [];
  let resolve: (v: unknown) => void = () => {};
  let promise: Promise<unknown> = new Promise<unknown>((r) => { resolve = r; });
  function candidateReasoner(input: CandidateReasonerInput): Promise<unknown> {
    calls.push(input);
    return promise;
  }
  function resetNext() {
    promise = new Promise<unknown>((r) => { resolve = r; });
  }
  return { calls, candidateReasoner, get resolve() { return resolve; }, resetNext };
}

async function setupWithGuide(guideText: string) {
  const reasoner = makeReasoner();
  const svc = createMeetingRoomService({
    env: { SECOND_SEAT_TEST_MODE: "1" },
    conversationInput: true,
    sessionPolicy: true,
    candidateReasoner: reasoner.candidateReasoner,
  });
  const key = randomUUID();
  const opened = svc.open("", HEADERS, key);
  const roomId = opened.roomId;
  const selectedMeetingId = opened.view.selectedMeetingId;
  expect(selectedMeetingId).toBeTruthy();
  const g = await svc.actAs(key, { roomId, action: "guide", text: guideText }, HEADERS);
  expect(g.status).toBe(200);
  const ing = svc.ingestConversationAs(key, roomId, {
    version: 1,
    meetingId: selectedMeetingId ?? "",
    utteranceId: "u1",
    sequence: 1,
    revision: 1,
    speaker: "a",
    text: "We met.",
  });
  expect(ing.status).toBe(200);
  reasoner.resolve(REASONER_RESULT);
  await flush();
  await flush();
  const st = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
  expect(st.status).toBe(200);
  return { svc, key, roomId, snap: st.body.snapshot, reasoner };
}

function expectUnchanged(before: unknown, after: unknown) {
  expect(after).toEqual(before);
}

describe("meeting-room candidate adopt guards", () => {
  it("400 table and 409 id/revision/generation; unbound act cannot adopt", async () => {
    const { svc, key, roomId, snap } = await setupWithGuide(SAFE_GUIDE);
    const preview = snap?.candidatePreview;
    const candidate = snap?.candidate;
    expect(preview).toBeTruthy();
    expect(candidate).toBeTruthy();
    const valid = {
      roomId,
      action: "adopt-candidate",
      id: preview?.candidateId,
      contextRevision: candidate?.contextRevision,
      policyGeneration: preview?.generation,
    };
    const bad400 = [
      { roomId, action: "adopt-candidate", contextRevision: candidate?.contextRevision, policyGeneration: preview?.generation },
      { roomId, action: "adopt-candidate", id: preview?.candidateId, policyGeneration: preview?.generation },
      { roomId, action: "adopt-candidate", id: preview?.candidateId, contextRevision: candidate?.contextRevision },
      { roomId, action: "adopt-candidate", id: preview?.candidateId, contextRevision: "1", policyGeneration: preview?.generation },
      { roomId, action: "adopt-candidate", id: preview?.candidateId, contextRevision: candidate?.contextRevision, policyGeneration: "2" },
      { roomId, action: "adopt-candidate", id: preview?.candidateId, contextRevision: -1, policyGeneration: preview?.generation },
      { roomId, action: "adopt-candidate", id: preview?.candidateId, contextRevision: 1.5, policyGeneration: preview?.generation },
      { roomId, action: "adopt-candidate", id: preview?.candidateId, contextRevision: candidate?.contextRevision, policyGeneration: -1 },
      { roomId, action: "adopt-candidate", id: preview?.candidateId, contextRevision: candidate?.contextRevision, policyGeneration: 0.5 },
    ];
    for (const payload of bad400) {
      const before = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
      const res = await svc.actAs(key, payload, HEADERS);
      expect(res.status).toBe(400);
      const after = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
      expectUnchanged(before.body.snapshot?.view.draft, after.body.snapshot?.view.draft);
      expect(after.body.snapshot?.packageId).toBe(before.body.snapshot?.packageId);
      expectUnchanged(before.body.snapshot?.candidate, after.body.snapshot?.candidate);
      expectUnchanged(before.body.snapshot?.candidatePreview, after.body.snapshot?.candidatePreview);
    }
    const bad409 = [
      { ...valid, id: randomUUID() },
      { ...valid, contextRevision: (valid.contextRevision ?? 0) + 999 },
      { ...valid, policyGeneration: (valid.policyGeneration ?? 0) + 999 },
    ];
    for (const payload of bad409) {
      const before = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
      const res = await svc.actAs(key, payload, HEADERS);
      expect(res.status).toBe(409);
      const after = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
      expectUnchanged(before.body.snapshot?.view.draft, after.body.snapshot?.view.draft);
      expect(after.body.snapshot?.packageId).toBe(before.body.snapshot?.packageId);
      expectUnchanged(before.body.snapshot?.candidate, after.body.snapshot?.candidate);
      expectUnchanged(before.body.snapshot?.candidatePreview, after.body.snapshot?.candidatePreview);
    }
    const beforeDirect = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    const direct = await svc.actAs(key, { roomId, action: "adopt-candidate" }, HEADERS);
    expect([400, 409].includes(direct.status)).toBe(true);
    const afterDirect = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    expectUnchanged(beforeDirect.body.snapshot?.view.draft, afterDirect.body.snapshot?.view.draft);
    expect(afterDirect.body.snapshot?.packageId).toBe(beforeDirect.body.snapshot?.packageId);
    expectUnchanged(beforeDirect.body.snapshot?.candidate, afterDirect.body.snapshot?.candidate);
    expectUnchanged(beforeDirect.body.snapshot?.candidatePreview, afterDirect.body.snapshot?.candidatePreview);
  });

  it("held preview from real dates guidance cannot be adopted", async () => {
    const { svc, key, roomId, snap } = await setupWithGuide(HELD_GUIDE);
    expect(snap?.candidatePreview?.status).toBe("held");
    const before = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    const binding = {
      roomId,
      action: "adopt-candidate",
      id: snap?.candidatePreview?.candidateId,
      contextRevision: snap?.candidate?.contextRevision,
      policyGeneration: snap?.candidatePreview?.generation,
    };
    const res = await svc.actAs(key, binding, HEADERS);
    expect(res.status).toBe(409);
    const after = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    expect(after.body.snapshot?.view.draft).toEqual(before.body.snapshot?.view.draft);
    expect(after.body.snapshot?.packageId).toBe(before.body.snapshot?.packageId);
    expect(after.body.snapshot?.candidate).toEqual(before.body.snapshot?.candidate);
    expect(after.body.snapshot?.candidatePreview).toEqual(before.body.snapshot?.candidatePreview);
  });

  it("released preview approve package then adopt check", async () => {
    const { svc, key, roomId, snap } = await setupWithGuide(SAFE_GUIDE);
    expect(snap).not.toBeNull();
    expect(snap!.candidatePreview?.status).toBe("released");
    expect(snap!.candidatePreview).toBeTruthy();
    expect(snap!.candidate).toBeTruthy();
    if (!snap || !snap.candidatePreview || !snap.candidate) throw new Error("missing snap preview/candidate");
    const packageId = snap.packageId;
    expect(packageId).toBeTruthy();
    const apr = await svc.actAs(key, { roomId, action: "approve", packageId }, HEADERS);
    expect(apr.status).toBe(200);
    expect(apr.body.snapshot).not.toBeNull();
    expect(apr.body.snapshot!.view.draft.approved).toBe(true);
    expect(apr.body.snapshot!.copyText).not.toBeNull();
    expect(apr.body.snapshot!.copyText).toBeTruthy();
    const preview = snap.candidatePreview;
    const candidate = snap.candidate;
    const adopt = await svc.actAs(key, { roomId, action: "adopt-candidate", id: preview.candidateId, policyGeneration: preview.generation, contextRevision: candidate.contextRevision }, HEADERS);
    expect(adopt.status).toBe(200);
    expect(adopt.body.snapshot).not.toBeNull();
    if (!adopt.body.snapshot) throw new Error("missing adopt snapshot");
    expect(adopt.body.snapshot.view.draft.base).toBe(preview.evaluatedSubject + "\n\n" + preview.evaluatedBody);
    expect(adopt.body.snapshot.view.draft.approved).toBe(false);
    expect(adopt.body.snapshot.copyText).toBeNull();
    expect(adopt.body.snapshot.candidatePreview).toBeTruthy();
    expect(adopt.body.snapshot.candidate).toBeTruthy();
    expect(svc.sentBodies().length).toBe(0);
  });
});
