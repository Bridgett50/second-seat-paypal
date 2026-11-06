import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import type { MeetingRoomSnapshot, MeetingRoomActionResult } from "../src/meetingRoom.js";
import { getPolicyGeneration } from "@second-seat/core";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };
const TEST_ENV = { SECOND_SEAT_TEST_MODE: "1" };

function sessionPolicyOf(snapshot: unknown): { generation: number; status: string; meetingId: string; note: string } | undefined {
  return (snapshot as unknown as { sessionPolicy?: { generation: number; status: string; meetingId: string; note: string } } | null)?.sessionPolicy;
}

function snapOf(res: { body: MeetingRoomActionResult }): MeetingRoomSnapshot {
  const s = res.body.snapshot;
  expect(s).not.toBeNull();
  return s as MeetingRoomSnapshot;
}

describe("P2d guide session policy", () => {
  it('P2d-1 enabled guide records policy generation per bound scope with readback and default off unchanged', async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV, sessionPolicy: true } as Parameters<typeof createMeetingRoomService>[0]);
    const keyA = randomUUID();
    const openedA = svc.open("", HEADERS, keyA);
    const viewA0 = openedA.view;
    const ownerA = viewA0.ownerId;
    const meetingA = viewA0.selectedMeetingId;
    const roomIdA = openedA.roomId;

    // first guide
    const r1 = await svc.actAs(keyA, { roomId: roomIdA, action: "guide", text: "Do not share any dates." }, HEADERS);
    expect(r1.status).toBe(200);
    expect(getPolicyGeneration(ownerA, meetingA)).toBe(1);
    expect(sessionPolicyOf(snapOf(r1))?.generation).toBe(1);
    expect(sessionPolicyOf(snapOf(r1))?.status).toBe("applied");

    // readback via state
    const rState = await svc.actAs(keyA, { roomId: roomIdA, action: "state" }, HEADERS);
    const snapState = snapOf(rState);
    expect(sessionPolicyOf(snapState)?.generation).toBe(1);
    expect(sessionPolicyOf(snapState)?.meetingId).toBe(snapState.view.selectedMeetingId);
    expect(getPolicyGeneration(ownerA, meetingA)).toBe(1);

    // second guide -> 2
    const r2 = await svc.actAs(keyA, { roomId: roomIdA, action: "guide", text: "Do not share any dates." }, HEADERS);
    expect(r2.status).toBe(200);
    expect(getPolicyGeneration(ownerA, meetingA)).toBe(2);
    expect(sessionPolicyOf(snapOf(r2))?.generation).toBe(2);

    // select other meeting
    const other = viewA0.meetings[1];
    expect(other).toBeDefined();
    const otherMeetingId = other!.id;
    const rSel = await svc.actAs(keyA, { roomId: roomIdA, action: "select-meeting", id: otherMeetingId }, HEADERS);
    const selSnap = snapOf(rSel);
    expect(sessionPolicyOf(selSnap)?.generation).toBe(0);
    expect(getPolicyGeneration(selSnap.view.ownerId, selSnap.view.selectedMeetingId)).toBe(0);

    // second browser
    const keyB = randomUUID();
    const openedB = svc.open("", HEADERS, keyB);
    const viewB0 = openedB.view;
    const ownerB = viewB0.ownerId;
    const meetingB = viewB0.selectedMeetingId;
    expect(getPolicyGeneration(ownerB, meetingB)).toBe(0);
    expect(sessionPolicyOf(openedB)).toBeDefined();
    expect(sessionPolicyOf(openedB)?.generation).toBe(0);

    // service-level evidence (actAs with extra body keys), not a claim about the public HTTP route, whose POST fields are allow-listed separately.
    const beforeSpoofGenAOther = getPolicyGeneration(selSnap.view.ownerId, selSnap.view.selectedMeetingId);
    const beforeSpoofGenB = getPolicyGeneration(ownerB, meetingB);
    const currentMeetingAAfterSelect = selSnap.view.selectedMeetingId;
    const currentOwnerA = selSnap.view.ownerId;
    const rSpoof = await svc.actAs(
      keyA,
      { roomId: roomIdA, action: "guide", text: "Do not share any dates.", ownerId: "dana", meetingId: meetingB },
      HEADERS,
    );
    expect(rSpoof.status).toBe(200);
    // B unchanged
    expect(getPolicyGeneration(ownerB, meetingB)).toBe(beforeSpoofGenB);
    expect(getPolicyGeneration("dana", meetingB)).toBe(0);
    // A current scope advanced only
    expect(getPolicyGeneration(currentOwnerA, currentMeetingAAfterSelect)).toBe(beforeSpoofGenAOther + 1);
    expect(getPolicyGeneration(ownerA, meetingA)).toBe(2);

    // default off
    const svcOff = createMeetingRoomService({ env: TEST_ENV } as Parameters<typeof createMeetingRoomService>[0]);
    const keyOff = randomUUID();
    const openedOff = svcOff.open("", HEADERS, keyOff);
    const roomIdOff = openedOff.roomId;
    const viewOff0 = openedOff.view;
    const ownerOff = viewOff0.ownerId;
    const meetingOff = viewOff0.selectedMeetingId;
    const rOff = await svcOff.actAs(keyOff, { roomId: roomIdOff, action: "guide", text: "Do not share any dates." }, HEADERS);
    expect(rOff.status).toBe(200);
    const snapOff = snapOf(rOff);
    expect(snapOff.view.guidance).toContain("Do not share any dates.");
    expect("sessionPolicy" in snapOff).toBe(false);
    expect(sessionPolicyOf(snapOff)).toBeUndefined();
    expect(getPolicyGeneration(ownerOff, meetingOff)).toBe(0);
  });

  it("P2d-2 rejected or unbound guidance leaves the generation unchanged and a valid control succeeds", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV, sessionPolicy: true } as Parameters<typeof createMeetingRoomService>[0]);
    const key = randomUUID();
    const opened = svc.open("", HEADERS, key);
    const roomId = opened.roomId;
    const owner = opened.view.ownerId;
    const meeting = opened.view.selectedMeetingId;

    // wrong key -> 404
    const wrongKey = randomUUID();
    const rWrong = await svc.actAs(wrongKey, { roomId, action: "guide", text: "Do not share any dates." }, HEADERS);
    expect(rWrong.status).toBe(404);
    expect(rWrong.body.snapshot).toBeNull();
    expect(getPolicyGeneration(owner, meeting)).toBe(0);

    // null key -> 404
    const rNull = await svc.actAs(null, { roomId, action: "guide", text: "Do not share any dates." }, HEADERS);
    expect(rNull.status).toBe(404);
    expect(rNull.body.snapshot).toBeNull();
    expect(getPolicyGeneration(owner, meeting)).toBe(0);

    // blank text
    const rBlank = await svc.actAs(key, { roomId, action: "guide", text: "   " }, HEADERS);
    expect(getPolicyGeneration(owner, meeting)).toBe(0);

    // 2001 chars -> 413
    const longText = "x".repeat(2001);
    const rLong = await svc.actAs(key, { roomId, action: "guide", text: longText }, HEADERS);
    expect(rLong.status).toBe(413);
    expect(getPolicyGeneration(owner, meeting)).toBe(0);

    // positive control
    const rOk = await svc.actAs(key, { roomId, action: "guide", text: "Do not share any dates." }, HEADERS);
    expect(rOk.status).toBe(200);
    expect(getPolicyGeneration(owner, meeting)).toBe(1);

    // fill to 50
    for (let i = 1; i < 50; i++) {
      const rr = await svc.actAs(key, { roomId, action: "guide", text: `note ${i} Do not share any dates.` }, HEADERS);
      expect(rr.status).toBe(200);
    }
    expect(getPolicyGeneration(owner, meeting)).toBe(50);
    const r51 = await svc.actAs(key, { roomId, action: "guide", text: "Do not share any dates." }, HEADERS);
    expect(r51.status).toBe(400);
    expect(getPolicyGeneration(owner, meeting)).toBe(50);

    // fresh room takeover then guide leaves unchanged
    const svc2 = createMeetingRoomService({ env: TEST_ENV, sessionPolicy: true } as Parameters<typeof createMeetingRoomService>[0]);
    const key2 = randomUUID();
    const opened2 = svc2.open("", HEADERS, key2);
    const roomId2 = opened2.roomId;
    const owner2 = opened2.view.ownerId;
    const meeting2 = opened2.view.selectedMeetingId;
    const rTake = await svc2.actAs(key2, { roomId: roomId2, action: "takeover" }, HEADERS);
    // after takeover
    const afterTakeSnap = snapOf(rTake);
    const guidanceBefore = [...afterTakeSnap.view.guidance];
    const rAfterTake = await svc2.actAs(key2, { roomId: roomId2, action: "guide", text: "Do not share any dates." }, HEADERS);
    expect(getPolicyGeneration(owner2, meeting2)).toBe(0);
    expect(snapOf(rAfterTake).view.guidance).toEqual(guidanceBefore);
  });
});
