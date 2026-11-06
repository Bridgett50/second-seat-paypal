import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService, type MeetingRoomService } from "../src/meetingRoom.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };

async function streamAllLines(svc: MeetingRoomService, roomId: string, headers: IncomingHttpHeaders): Promise<void> {
  let last = -1;
  for (let i = 0; i < 20; i += 1) {
    const res = await svc.act({ roomId, action: "stream-next" }, headers);
    expect(res.status).toBe(200);
    const length = res.body.snapshot?.view.transcript.length ?? -2;
    if (length === last) break;
    last = length;
  }
}

describe("P2a conversation input", () => {
  it("P2a-1 out-of-order, duplicate and corrected utterances keep two stable utterances and a monotonic context revision", () => {
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true });
    const key = randomUUID();
    const opened = svc.open("", HEADERS, key);
    const roomId = opened.roomId;

    const u1_r1_text = "I propose we move the deadline to Friday.";
    const u1_r2_text = "I retract my proposal to move the deadline.";
    const u2_text = "Can you send it to the team?";
    const meetingId = opened.view.selectedMeetingId;

    let r = svc.ingestConversationAs(key, roomId, { version: 1, meetingId, utteranceId: "u2", sequence: 2, revision: 1, speaker: "Bob", text: u2_text });
    expect(r.status).toBe(200);
    expect(r.body.snapshot?.conversation?.contextRevision).toBe(1);

    r = svc.ingestConversationAs(key, roomId, { version: 1, meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "Alice", text: u1_r1_text });
    expect(r.status).toBe(200);
    expect(r.body.snapshot?.conversation?.contextRevision).toBe(2);

    r = svc.ingestConversationAs(key, roomId, { version: 1, meetingId, utteranceId: "u2", sequence: 2, revision: 1, speaker: "Bob", text: u2_text });
    expect(r.status).toBe(200);
    expect(r.body.snapshot?.conversation?.contextRevision).toBe(2);

    r = svc.ingestConversationAs(key, roomId, { version: 1, meetingId, utteranceId: "u1", sequence: 1, revision: 2, speaker: "Alice", text: u1_r2_text });
    expect(r.status).toBe(200);
    expect(r.body.snapshot?.conversation?.contextRevision).toBe(3);

    r = svc.ingestConversationAs(key, roomId, { version: 1, meetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "Alice", text: u1_r1_text });
    expect(r.status).toBe(200);
    expect(r.body.snapshot?.conversation?.contextRevision).toBe(3);

    const conv = r.body.snapshot?.conversation;
    expect(conv).toBeDefined();
    expect(conv?.utterances.length).toBe(2);
    expect(conv?.utterances[0]?.utteranceId).toBe("u1");
    expect(conv?.utterances[0]?.sequence).toBe(1);
    expect(conv?.utterances[0]?.revision).toBe(2);
    expect(conv?.utterances[0]?.speaker).toBe("Alice");
    expect(conv?.utterances[0]?.text).toBe(u1_r2_text);
    expect(conv?.utterances[1]?.utteranceId).toBe("u2");
    expect(conv?.utterances[1]?.sequence).toBe(2);
    expect(conv?.utterances[1]?.revision).toBe(1);
    expect(conv?.utterances[1]?.speaker).toBe("Bob");
    expect(conv?.utterances[1]?.text).toBe(u2_text);
    expect(conv?.latestCorrection).toEqual({ utteranceId: "u1", revision: 2 });
  });

  it("P2a-2 late previous-meeting, wrong-owner and wrong-browser events leave the conversation unchanged and a fresh valid event succeeds", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true });
    const key = randomUUID();
    const opened = svc.open("", HEADERS, key);
    const roomId = opened.roomId;
    const meetings = opened.view.meetings;
    expect(meetings.length).toBeGreaterThanOrEqual(2);
    const meetingA = meetings[0]!.id;
    const meetingB = meetings[1]!.id;

    // select A then ingest
    let sel = await svc.actAs(key, { roomId, action: "select-meeting", id: meetingA }, HEADERS);
    expect(sel.status).toBe(200);
    let r = svc.ingestConversationAs(key, roomId, { version: 1, meetingId: meetingA, utteranceId: "a1", sequence: 1, revision: 1, speaker: "Alice", text: "hello A" });
    expect(r.status).toBe(200);
    // select B then ingest
    sel = await svc.actAs(key, { roomId, action: "select-meeting", id: meetingB }, HEADERS);
    expect(sel.status).toBe(200);
    r = svc.ingestConversationAs(key, roomId, { version: 1, meetingId: meetingB, utteranceId: "b1", sequence: 1, revision: 1, speaker: "Alice", text: "hello B" });
    expect(r.status).toBe(200);
    const before = r.body.snapshot?.conversation;
    expect(before).toBeDefined();

    // late event carrying A's id
    const late = svc.ingestConversationAs(key, roomId, { version: 1, meetingId: meetingA, utteranceId: "a2", sequence: 2, revision: 1, speaker: "Bob", text: "late" });
    expect(late.status).toBe(409);
    expect(late.body.snapshot?.conversation).toEqual(before);

    // wrong owner
    const wrongOwner = svc.ingestConversationAs(key, roomId, { version: 1, meetingId: meetingB, utteranceId: "b2", sequence: 2, revision: 1, speaker: "Bob", text: "hi", ownerId: "someone-else" });
    expect(wrongOwner.status).toBe(403);
    expect(wrongOwner.body.snapshot?.conversation).toEqual(before);

    // wrong browser
    const otherKey = randomUUID();
    svc.open("", HEADERS, otherKey);
    const wrongBrowser = svc.ingestConversationAs(otherKey, roomId, { version: 1, meetingId: meetingB, utteranceId: "b3", sequence: 3, revision: 1, speaker: "Bob", text: "hi2" });
    expect(wrongBrowser.status).toBe(404);
    expect(wrongBrowser.body.snapshot).toBeNull();

    // bound room unchanged after wrongBrowser check via correct key
    const check = svc.ingestConversationAs(key, roomId, { version: 1, meetingId: meetingB, utteranceId: "b1", sequence: 1, revision: 1, speaker: "Alice", text: "hello B" });
    expect(check.status).toBe(200);
    expect(check.body.snapshot?.conversation).toEqual(before);

    const fresh = svc.ingestConversationAs(key, roomId, { version: 1, meetingId: meetingB, utteranceId: "b2", sequence: 2, revision: 1, speaker: "Bob", text: "fresh valid" });
    expect(fresh.status).toBe(200);
    expect(fresh.body.snapshot?.conversation?.contextRevision).toBe((before?.contextRevision ?? 0) + 1);
  });

  it("P2a-3 default option off rejects ingestion and leaves scripted room behavior unchanged", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const key = randomUUID();
    const opened = svc.open("", HEADERS, key);
    const roomId = opened.roomId;
    // capture state snapshot via act
    const stateBefore = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    expect(stateBefore.status).toBe(200);
    const snapBefore = stateBefore.body.snapshot!;
    // ingest with valid event should be 403 and no conversation property
    const ing = svc.ingestConversationAs(key, roomId, { version: 1, meetingId: snapBefore.view.selectedMeetingId, utteranceId: "u1", sequence: 1, revision: 1, speaker: "Alice", text: "hi" });
    expect(ing.status).toBe(403);
    expect(ing.body.announcements).toEqual(["Conversation input is not enabled."]);
    const stateAfter = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    expect(stateAfter.body.snapshot).toEqual(snapBefore);
    expect("conversation" in stateAfter.body.snapshot!).toBe(false);

    // scripted flow comparison with second service
    const svc2 = createMeetingRoomService({ env: TEST_ENV });
    const key2 = randomUUID();
    const opened2 = svc2.open("", HEADERS, key2);
    const roomId2 = opened2.roomId;

    async function runFlow(s: MeetingRoomService, rid: string, k: string) {
      const st0 = await s.actAs(k, { roomId: rid, action: "state" }, HEADERS);
      const mid = st0.body.snapshot!.view.meetings[0]!.id;
      await s.actAs(k, { roomId: rid, action: "select-meeting", id: mid }, HEADERS);
      await streamAllLines(s, rid, HEADERS);
      const st = await s.actAs(k, { roomId: rid, action: "state" }, HEADERS);
      const pkg = st.body.snapshot!.packageId;
      const appr = await s.actAs(k, { roomId: rid, action: "approve", packageId: pkg }, HEADERS);
      return appr.body.snapshot!;
    }

    const snap1 = await runFlow(svc, roomId, key);
    const snap2 = await runFlow(svc2, roomId2, key2);
    expect(snap1.view.transcript).toEqual(snap2.view.transcript);
    expect(snap1.view.twinStatus).toEqual(snap2.view.twinStatus);
    expect(snap1.view.draft.approved).toEqual(snap2.view.draft.approved);
  });

  it("P2a-4 a valid ingested event is visible through the bound state read and selecting the other meeting shows only that meeting's context", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV, conversationInput: true });
    const key = randomUUID();
    const opened = svc.open("", HEADERS, key);
    const roomId = opened.roomId;
    const meetings = opened.view.meetings;
    expect(meetings.length).toBeGreaterThanOrEqual(2);
    const meetingA = meetings[0]!.id;
    const meetingB = meetings[1]!.id;

    const selA = await svc.actAs(key, { roomId, action: "select-meeting", id: meetingA }, HEADERS);
    expect(selA.status).toBe(200);

    const ing = svc.ingestConversationAs(key, roomId, { version: 1, meetingId: meetingA, utteranceId: "a1", sequence: 1, revision: 1, speaker: "Alice", text: "Let's ship the draft on Friday." });
    expect(ing.status).toBe(200);

    const st = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    expect(st.status).toBe(200);
    expect(st.body.snapshot?.conversation).toEqual({ version: 1, meetingId: meetingA, contextRevision: 1, utterances: [{ utteranceId: "a1", sequence: 1, revision: 1, speaker: "Alice", text: "Let's ship the draft on Friday." }], latestCorrection: null });

    const selB = await svc.actAs(key, { roomId, action: "select-meeting", id: meetingB }, HEADERS);
    expect(selB.status).toBe(200);
    const stB = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    expect(stB.status).toBe(200);
    expect(stB.body.snapshot?.conversation).toEqual({ version: 1, meetingId: meetingB, contextRevision: 0, utterances: [], latestCorrection: null });

    const selA2 = await svc.actAs(key, { roomId, action: "select-meeting", id: meetingA }, HEADERS);
    expect(selA2.status).toBe(200);
    const stA2 = await svc.actAs(key, { roomId, action: "state" }, HEADERS);
    expect(stA2.status).toBe(200);
    expect(stA2.body.snapshot?.conversation).toEqual({ version: 1, meetingId: meetingA, contextRevision: 1, utterances: [{ utteranceId: "a1", sequence: 1, revision: 1, speaker: "Alice", text: "Let's ship the draft on Friday." }], latestCorrection: null });
  });
});
