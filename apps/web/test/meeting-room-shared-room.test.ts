import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import {
  createMeetingRoomService,
  type MeetingRoomService,
} from "../src/meetingRoom.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };
const TEST_ENV: Readonly<Record<string, string | undefined>> = {
  SECOND_SEAT_TEST_MODE: "1",
};

async function streamAllLines(
  svc: MeetingRoomService,
  roomId: string,
  headers: IncomingHttpHeaders,
): Promise<void> {
  let last = -1;
  for (let i = 0; i < 20; i += 1) {
    const res = await svc.act({ roomId, action: "stream-next" }, headers);
    expect(res.status).toBe(200);
    const length = res.body.snapshot?.view.transcript.length ?? -2;
    if (length === last) break;
    last = length;
  }
}

async function selectFirstMeeting(
  svc: MeetingRoomService,
  roomId: string,
): Promise<void> {
  const state = await svc.act({ roomId, action: "state" }, HEADERS);
  expect(state.status).toBe(200);
  const meetingId = state.body.snapshot?.view.meetings[0]?.id;
  if (meetingId === undefined) throw new Error("seeded meeting missing");
  const selected = await svc.act(
    { roomId, action: "select-meeting", id: meetingId },
    HEADERS,
  );
  expect(selected.status).toBe(200);
}

async function setUpTab(
  svc: MeetingRoomService,
  roomId: string,
): Promise<void> {
  await selectFirstMeeting(svc, roomId);
  await streamAllLines(svc, roomId, HEADERS);
}

describe("meeting room shared twin room", () => {
  it("MR-S1 two tabs with the same cookie share one room and only one Send goes out", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const key = randomUUID();
    const tabA = svc.open("", HEADERS, key);
    const tabB = svc.open("", HEADERS, key);
    expect(tabA.roomId).not.toBe(tabB.roomId);
    await setUpTab(svc, tabA.roomId);
    await setUpTab(svc, tabB.roomId);
    const approveA = await svc.act(
      { roomId: tabA.roomId, action: "approve" },
      HEADERS,
    );
    expect(approveA.status).toBe(200);
    const approveB = await svc.act(
      { roomId: tabB.roomId, action: "approve" },
      HEADERS,
    );
    expect(approveB.status).toBe(200);
    const sendA = await svc.act({ roomId: tabA.roomId, action: "send" }, HEADERS);
    expect(sendA.status).toBe(200);
    expect(sendA.body.snapshot?.view.draft.sendState).toBe("sent");
    expect(svc.sentBodies()).toHaveLength(1);
    const sendB = await svc.act({ roomId: tabB.roomId, action: "send" }, HEADERS);
    expect(
      sendB.status !== 200 || svc.sentBodies().length === 1,
      "second tab Send must be refused or send nothing new",
    ).toBe(true);
    expect(sendB.body.announcements).not.toContain(
      "Package sent through the test fake transport.",
    );
    expect(svc.sentBodies()).toHaveLength(1);
  });

  it("MR-S2 a stale tab opened before the send that approves afterwards is refused", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const key = randomUUID();
    const tabA = svc.open("", HEADERS, key);
    const tabB = svc.open("", HEADERS, key);
    await setUpTab(svc, tabA.roomId);
    await setUpTab(svc, tabB.roomId);
    const approveA = await svc.act(
      { roomId: tabA.roomId, action: "approve" },
      HEADERS,
    );
    expect(approveA.status).toBe(200);
    const sendA = await svc.act({ roomId: tabA.roomId, action: "send" }, HEADERS);
    expect(sendA.status).toBe(200);
    expect(sendA.body.snapshot?.view.draft.sendState).toBe("sent");
    expect(svc.sentBodies()).toHaveLength(1);
    const approveB = await svc.act(
      { roomId: tabB.roomId, action: "approve" },
      HEADERS,
    );
    expect(approveB.status).toBe(200);
    const sendB = await svc.act({ roomId: tabB.roomId, action: "send" }, HEADERS);
    expect(
      sendB.status !== 200 || svc.sentBodies().length === 1,
      "stale tab Send must be refused or send nothing new",
    ).toBe(true);
    expect(sendB.body.announcements).not.toContain(
      "Package sent through the test fake transport.",
    );
    expect(svc.sentBodies()).toHaveLength(1);
  });

  it("MR-S3 different store keys get different rooms", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const key1 = randomUUID();
    const key2 = randomUUID();
    const first = svc.open("", HEADERS, key1);
    await setUpTab(svc, first.roomId);
    const approve1 = await svc.act(
      { roomId: first.roomId, action: "approve" },
      HEADERS,
    );
    expect(approve1.status).toBe(200);
    const send1 = await svc.act(
      { roomId: first.roomId, action: "send" },
      HEADERS,
    );
    expect(send1.status).toBe(200);
    expect(send1.body.snapshot?.view.draft.sendState).toBe("sent");
    expect(svc.sentBodies()).toHaveLength(1);
    const second = svc.open("", HEADERS, key2);
    expect(second.restored).toBe(false);
    const before = await svc.act(
      { roomId: second.roomId, action: "state" },
      HEADERS,
    );
    expect(before.body.snapshot?.view.draft.sendState).not.toBe("sent");
    await setUpTab(svc, second.roomId);
    const approve2 = await svc.act(
      { roomId: second.roomId, action: "approve" },
      HEADERS,
    );
    expect(approve2.status).toBe(200);
    const send2 = await svc.act(
      { roomId: second.roomId, action: "send" },
      HEADERS,
    );
    expect(send2.status).toBe(200);
    expect(send2.body.snapshot?.view.draft.sendState).toBe("sent");
    expect(svc.sentBodies()).toHaveLength(2);
  });

  it("MR-S4 reopening with the same key reports restored", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const key = randomUUID();
    const first = svc.open("", HEADERS, key);
    expect(first.restored).toBe(false);
    const reopened = svc.open("", HEADERS, key);
    expect(reopened.roomId).not.toBe(first.roomId);
    expect(reopened.restored).toBe(true);
  });
});
