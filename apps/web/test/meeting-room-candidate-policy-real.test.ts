import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { getPolicyGeneration } from "@second-seat/core";

const HEADERS = { host: "127.0.0.1:4174" };

function must<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  if (value === null || value === undefined) throw new Error("missing value");
  return value;
}

function flush(): Promise<void> {
  return new Promise<void>((r) => setImmediate(r));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("meeting room candidate preview against real policy", () => {
  it("no-dates policy releases a rewritten preview", async () => {
    const key = randomUUID();
    const deferred = createDeferred<unknown>();
    const calls: unknown[] = [];
    const candidateReasoner = (input: unknown) => {
      calls.push(input);
      return deferred.promise;
    };
    const svc = createMeetingRoomService({
      env: { SECOND_SEAT_TEST_MODE: "1" },
      conversationInput: true,
      sessionPolicy: true,
      candidateReasoner,
    });
    const opened = svc.open("", HEADERS, key);
    const roomId = opened.roomId;
    const ownerId = opened.view.ownerId;
    const meetingId = opened.view.selectedMeetingId;
    const g = await svc.actAs(key, { roomId, action: "guide", text: "Do not share any dates." }, HEADERS);
    expect(g.status).toBe(200);
    expect(must(g.body.snapshot).sessionPolicy?.status).toBe("applied");
    expect(must(g.body.snapshot).sessionPolicy?.generation).toBe(getPolicyGeneration(ownerId, meetingId));
    const stateOf = async () => {
      const r = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
      expect(r.status).toBe(200);
      return must(r.body.snapshot);
    };
    const base = await stateOf();
    const basePackageId = base.packageId;
    const baseCopyText = base.copyText;
    const ing = svc.ingestConversationAs(key, roomId, { version: 1, meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "We met." });
    expect(ing.status).toBe(200);
    expect(calls.length).toBe(1);
    deferred.resolve({ subject: "Meeting on 2026-11-15", body: "Thanks for the discussion.", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    const snap = await stateOf();
    const cand = must(snap.candidate);
    const preview = must(snap.candidatePreview);
    expect(preview.status).toBe("released");
    expect(preview.evaluatedSubject).toBe("Meeting on a date the owner will confirm");
    expect(preview.evaluatedBody).toBe("Thanks for the discussion.");
    expect(preview.subjectChanged).toBe(true);
    expect(preview.bodyChanged).toBe(false);
    expect(preview.generation).toBe(getPolicyGeneration(ownerId, meetingId));
    expect(preview.candidateId).toBe(cand.candidateId);
    expect(cand.status).toBe("provisional");
    expect(cand.subject).toBe("Meeting on 2026-11-15");
    expect(cand.body).toBe("Thanks for the discussion.");
    expect(cand.provisional).toBe(true);
    expect(cand.policyChecked).toBe(false);
    expect(cand.approved).toBe(false);
    expect(snap.packageId).toBe(basePackageId);
    expect(snap.copyText).toBe(baseCopyText);
    expect(svc.sentBodies().length).toBe(0);
  });

  it("needs-clarification policy holds the dated candidate", async () => {
    const key = randomUUID();
    const deferred = createDeferred<unknown>();
    const calls: unknown[] = [];
    const candidateReasoner = (input: unknown) => {
      calls.push(input);
      return deferred.promise;
    };
    const svc = createMeetingRoomService({
      env: { SECOND_SEAT_TEST_MODE: "1" },
      conversationInput: true,
      sessionPolicy: true,
      candidateReasoner,
    });
    const opened = svc.open("", HEADERS, key);
    const roomId = opened.roomId;
    const ownerId = opened.view.ownerId;
    const meetingId = opened.view.selectedMeetingId;
    const g = await svc.actAs(key, { roomId, action: "guide", text: "Be careful about dates." }, HEADERS);
    expect(g.status).toBe(200);
    expect(must(g.body.snapshot).sessionPolicy?.status).toBe("needs-clarification");
    const stateOf = async () => {
      const r = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
      expect(r.status).toBe(200);
      return must(r.body.snapshot);
    };
    const base = await stateOf();
    const basePackageId = base.packageId;
    const baseCopyText = base.copyText;
    const ing = svc.ingestConversationAs(key, roomId, { version: 1, meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "a", text: "We met." });
    expect(ing.status).toBe(200);
    expect(calls.length).toBe(1);
    deferred.resolve({ subject: "Meeting on 2026-11-15", body: "Thanks for the discussion.", sourceRefs: [{ utteranceId: "u1", revision: 1 }] });
    await flush();
    const snap = await stateOf();
    const cand = must(snap.candidate);
    const preview = must(snap.candidatePreview);
    expect(preview.status).toBe("held");
    expect(preview.reason).toBe("needs clarification for date disclosure");
    expect(preview.evaluatedSubject).toBeUndefined();
    expect(preview.evaluatedBody).toBeUndefined();
    expect(preview.generation).toBe(getPolicyGeneration(ownerId, meetingId));
    expect(preview.candidateId).toBe(cand.candidateId);
    expect(cand.status).toBe("provisional");
    expect(cand.subject).toBe("Meeting on 2026-11-15");
    expect(cand.body).toBe("Thanks for the discussion.");
    expect(cand.provisional).toBe(true);
    expect(cand.policyChecked).toBe(false);
    expect(cand.approved).toBe(false);
    expect(snap.packageId).toBe(basePackageId);
    expect(snap.copyText).toBe(baseCopyText);
    expect(svc.sentBodies().length).toBe(0);
  });
});

