import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import type { CandidateReasonerInput } from "../src/meetingRoom.js";

const HEADERS = { host: "127.0.0.1:4174" };
const GUIDE_TEXT = "Do not share any dates.";
const REASONER_RESULT = {
  subject: "Meeting on 2026-11-15",
  body: "Thanks for the discussion.",
  sourceRefs: [{ utteranceId: "u1", revision: 1 }],
};
const EVALUATED_SUBJECT = "Meeting on a date the owner will confirm";
const EVALUATED_BODY = "Thanks for the discussion.";

function flush(): Promise<void> {
  return new Promise<void>((r) => setImmediate(r));
}

function makeReasoner() {
  const calls: CandidateReasonerInput[] = [];
  let resolve: (v: unknown) => void = () => {};
  let promise: Promise<unknown> = new Promise<unknown>((r) => {
    resolve = r;
  });
  const candidateReasoner = (input: CandidateReasonerInput): Promise<unknown> => {
    calls.push(input);
    return promise;
  };
  function reset() {
    promise = new Promise<unknown>((r) => {
      resolve = r;
    });
  }
  return { calls, candidateReasoner, get resolve() { return resolve; }, reset };
}

async function setupReleased() {
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
  const guideRes = await svc.actAs(key, { roomId, action: "guide", text: GUIDE_TEXT }, HEADERS);
  expect(guideRes.status).toBe(200);
  expect(guideRes.body.snapshot?.sessionPolicy?.status).toBe("applied");
  expect(opened.view.selectedMeetingId).toBeTruthy();
  const ingestRes = svc.ingestConversationAs(key, roomId, {
    version: 1,
    meetingId: opened.view.selectedMeetingId!,
    utteranceId: "u1",
    sequence: 1,
    revision: 1,
    speaker: "a",
    text: "We met.",
  });
  expect(ingestRes.status).toBe(200);
  reasoner.resolve(REASONER_RESULT);
  await flush();
  await flush();
  const state = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
  expect(state.status).toBe(200);
  const snap = state.body.snapshot;
  expect(snap?.candidatePreview?.status).toBe("released");
  expect(snap?.candidatePreview?.evaluatedSubject).toBe(EVALUATED_SUBJECT);
  expect(snap?.candidatePreview?.evaluatedBody).toBe(EVALUATED_BODY);
  return { svc, key, roomId, snap, reasoner };
}

describe("meeting-room candidate adopt", () => {
  it("adopts with current binding", async () => {
    const { svc, key, roomId, snap } = await setupReleased();
    const prevCandidate = snap?.candidate;
    const preview = snap?.candidatePreview;
    expect(prevCandidate).toBeTruthy();
    expect(preview).toBeTruthy();
    const binding = {
      roomId,
      action: "adopt-candidate",
      id: preview!.candidateId,
      contextRevision: prevCandidate!.contextRevision,
      policyGeneration: preview!.generation,
    };
    const res = await svc.actAs(key, binding, HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.snapshot).not.toBeNull();
    const next = res.body.snapshot!;
    expect(next.view.draft.base).toBe(EVALUATED_SUBJECT + "\n\n" + EVALUATED_BODY);
    expect(next.view.draft.approved).toBe(false);
    expect(next.candidate).toEqual(prevCandidate);
    expect(next.candidate?.candidateId).toBe(prevCandidate?.candidateId);
    expect(next.candidate?.provisional).toBe(true);
    expect(next.candidate?.policyChecked).toBe(false);
    expect(next.candidate?.approved).toBe(false);
    expect(next.candidate?.subject).toBe(REASONER_RESULT.subject);
    expect(next.candidate?.body).toBe(REASONER_RESULT.body);
    expect(svc.sentBodies().length).toBe(0);
  });

  it("rejects stale binding with 409 and no change", async () => {
    const { svc, key, roomId, snap } = await setupReleased();
    const oldPreview = snap?.candidatePreview;
    const oldCandidate = snap?.candidate;
    const oldBinding = {
      roomId,
      action: "adopt-candidate",
      id: oldPreview!.candidateId,
      contextRevision: oldCandidate!.contextRevision,
      policyGeneration: oldPreview!.generation,
    };
    const guide2 = await svc.actAs(key, { roomId, action: "guide", text: GUIDE_TEXT }, HEADERS);
    expect(guide2.status).toBe(200);
    const pre = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    expect(pre.status).toBe(200);
    const preSnap = pre.body.snapshot!;
    const res = await svc.actAs(key, oldBinding, HEADERS);
    expect(res.status).toBe(409);
    const post = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    const postSnap = post.body.snapshot!;
    expect(postSnap.view.draft.base).toBe(preSnap.view.draft.base);
    expect(postSnap.view.draft.sha256).toBe(preSnap.view.draft.sha256);
    expect(postSnap.view.draft.approved).toBe(preSnap.view.draft.approved);
    expect(postSnap.packageId).toBe(preSnap.packageId);
    expect(postSnap.copyText).toBe(preSnap.copyText);
    expect(postSnap.candidate).toEqual(preSnap.candidate);
    expect(postSnap.candidatePreview).toEqual(preSnap.candidatePreview);
  });

  it("rejects wrong or missing key with 404 and no change", async () => {
    const { svc, key, roomId, snap } = await setupReleased();
    const preview = snap?.candidatePreview;
    const candidate = snap?.candidate;
    const binding = {
      roomId,
      action: "adopt-candidate",
      id: preview!.candidateId,
      contextRevision: candidate!.contextRevision,
      policyGeneration: preview!.generation,
    };
    const before = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    const beforeSnap = before.body.snapshot;
    const foreignKey = randomUUID();
    const res1 = await svc.actAs(foreignKey, binding, HEADERS);
    expect(res1.status).toBe(404);
    expect(res1.body.snapshot).toBeNull();
    const res2 = await svc.actAs(null, binding, HEADERS);
    expect(res2.status).toBe(404);
    expect(res2.body.snapshot).toBeNull();
    const after = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    expect(after.status).toBe(200);
    expect(after.body.snapshot).toEqual(beforeSnap);
  });
});

