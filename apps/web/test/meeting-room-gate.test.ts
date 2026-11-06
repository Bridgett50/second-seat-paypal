import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import {
  createMeetingRoomService,
  meetingRoomFakeSendAllowed,
  meetingRoomStoreKey,
  type MeetingRoomService,
} from "../src/meetingRoom.js";

const LOOPBACK: IncomingHttpHeaders = { host: "127.0.0.1:4310" };
const TEST_ENV: Readonly<Record<string, string | undefined>> = {
  SECOND_SEAT_TEST_MODE: "1",
};

function rawHeaders(
  value: Record<string, string | string[] | undefined>,
): IncomingHttpHeaders {
  return value as unknown as IncomingHttpHeaders;
}

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

describe("meeting room fake-send gate", () => {
  it("MR-G1 fake-send gate: 17 Host / X-Forwarded-Host cases", () => {
    const baseEnv: Readonly<Record<string, string | undefined>> = {
      SECOND_SEAT_TEST_MODE: "1",
    };
    const base: IncomingHttpHeaders = { host: "127.0.0.1:4310" };
    expect(meetingRoomFakeSendAllowed(baseEnv, base)).toBe(true);
    expect(meetingRoomFakeSendAllowed(baseEnv, { host: "localhost:4310" })).toBe(true);
    expect(meetingRoomFakeSendAllowed(baseEnv, { host: "[::1]:4310" })).toBe(true);
    expect(
      meetingRoomFakeSendAllowed(baseEnv, {
        host: "127.0.0.1:4310",
        "x-forwarded-host": "localhost",
      }),
    ).toBe(true);
    expect(
      meetingRoomFakeSendAllowed({ SECOND_SEAT_TEST_MODE: "true" }, base),
    ).toBe(false);
    expect(meetingRoomFakeSendAllowed({}, base)).toBe(false);
    expect(
      meetingRoomFakeSendAllowed({ SECOND_SEAT_TEST_MODE: " 1" }, base),
    ).toBe(false);
    expect(
      meetingRoomFakeSendAllowed(baseEnv, { host: "second-seat.example.com" }),
    ).toBe(false);
    expect(
      meetingRoomFakeSendAllowed(baseEnv, { host: "localhost.evil.test" }),
    ).toBe(false);
    expect(meetingRoomFakeSendAllowed(baseEnv, { host: "0.0.0.0:4310" })).toBe(false);
    expect(meetingRoomFakeSendAllowed(baseEnv, {})).toBe(false);
    expect(
      meetingRoomFakeSendAllowed(baseEnv, {
        host: "127.0.0.1:4310",
        "x-forwarded-host": "second-seat.example.com",
      }),
    ).toBe(false);
    expect(
      meetingRoomFakeSendAllowed(baseEnv, {
        host: "127.0.0.1:4310",
        "x-forwarded-host": "localhost.evil.test",
      }),
    ).toBe(false);
    expect(
      meetingRoomFakeSendAllowed(baseEnv, {
        host: "127.0.0.1:4310",
        "x-forwarded-host": "0.0.0.0",
      }),
    ).toBe(false);
    expect(meetingRoomFakeSendAllowed(baseEnv, { host: "localhost:notaport" })).toBe(
      false,
    );
    expect(
      meetingRoomFakeSendAllowed(baseEnv, { host: "127.0.0.1, evil.test" }),
    ).toBe(false);
    expect(
      meetingRoomFakeSendAllowed(baseEnv, {
        host: "second-seat.example.com",
        "x-forwarded-host": "localhost",
      }),
    ).toBe(false);
  });

  it("MR-G2 duplicated Host or X-Forwarded-Host headers are refused", () => {
    expect(
      meetingRoomFakeSendAllowed(
        TEST_ENV,
        rawHeaders({ host: ["127.0.0.1:4310", "127.0.0.1:4310"] }),
      ),
    ).toBe(false);
    expect(
      meetingRoomFakeSendAllowed(
        TEST_ENV,
        rawHeaders({
          host: "127.0.0.1:4310",
          "x-forwarded-host": ["localhost", "localhost"],
        }),
      ),
    ).toBe(false);
  });

  it("MR-G3 a default service with no SECOND_SEAT_TEST_MODE refuses Send and never calls the transport", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const opened = svc.open("", LOOPBACK);
    const roomId = opened.roomId;
    const meetingId = opened.view.meetings[0]?.id;
    if (meetingId === undefined) throw new Error("seeded meeting missing");
    expect(opened.fakeSend).toBe(false);
    const selected = await svc.act(
      { roomId, action: "select-meeting", id: meetingId },
      LOOPBACK,
    );
    expect(selected.status).toBe(200);
    await streamAllLines(svc, roomId, LOOPBACK);
    const approved = await svc.act({ roomId, action: "approve" }, LOOPBACK);
    expect(approved.body.snapshot?.view.draft.approved).toBe(true);
    const sent = await svc.act({ roomId, action: "send" }, LOOPBACK);
    expect(sent.status).toBe(403);
    expect(svc.sentBodies()).toHaveLength(0);
    expect(sent.body.snapshot?.view.draft.sendState).not.toBe("sent");
  });

  it("MR-G4 env exactly \"1\" with loopback headers sends exactly the approved body once", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const opened = svc.open("", LOOPBACK);
    const roomId = opened.roomId;
    const meetingId = opened.view.meetings[0]?.id;
    if (meetingId === undefined) throw new Error("seeded meeting missing");
    expect(opened.fakeSend).toBe(true);
    await svc.act({ roomId, action: "select-meeting", id: meetingId }, LOOPBACK);
    await streamAllLines(svc, roomId, LOOPBACK);
    const approved = await svc.act({ roomId, action: "approve" }, LOOPBACK);
    expect(approved.body.snapshot?.view.draft.approved).toBe(true);
    const approvedBody = approved.body.snapshot?.view.draft.body;
    const sent = await svc.act({ roomId, action: "send" }, LOOPBACK);
    expect(sent.status).toBe(200);
    expect(sent.body.snapshot?.view.draft.sendState).toBe("sent");
    expect(svc.sentBodies()).toHaveLength(1);
    expect(svc.sentBodies()[0]).toBe(approvedBody);
  });

  it("MR-G5 Send re-checks the gate per request: a public Host is refused even for a test-mode room", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const opened = svc.open("", LOOPBACK);
    const roomId = opened.roomId;
    const meetingId = opened.view.meetings[0]?.id;
    if (meetingId === undefined) throw new Error("seeded meeting missing");
    await svc.act({ roomId, action: "select-meeting", id: meetingId }, LOOPBACK);
    await streamAllLines(svc, roomId, LOOPBACK);
    await svc.act({ roomId, action: "approve" }, LOOPBACK);
    const refused = await svc.act(
      { roomId, action: "send" },
      { host: "second-seat.example.com" },
    );
    expect(refused.status).toBe(403);
    expect(svc.sentBodies()).toHaveLength(0);
    expect(refused.body.snapshot?.view.draft.sendState).not.toBe("sent");
  });

  it("MR-G6 unknown room is 404 and unknown action is 400", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const missing = await svc.act({ roomId: "no-such-room", action: "state" }, LOOPBACK);
    expect(missing.status).toBe(404);
    const noId = await svc.act({ action: "state" }, LOOPBACK);
    expect(noId.status).toBe(404);
    const opened = svc.open("", LOOPBACK);
    const badAction = await svc.act(
      { roomId: opened.roomId, action: "bogus-action" },
      LOOPBACK,
    );
    expect(badAction.status).toBe(400);
    const badField = await svc.act(
      { roomId: opened.roomId, action: "guide" },
      LOOPBACK,
    );
    expect(badField.status).toBe(400);
  });

  it("MR-G7 reopening restores the room from the shared store", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const first = svc.open("", LOOPBACK);
    expect(first.restored).toBe(false);
    const roomId = first.roomId;
    const guided = await svc.act(
      { roomId, action: "guide", text: "Keep it short and private." },
      LOOPBACK,
    );
    expect(guided.status).toBe(200);
    await streamAllLines(svc, roomId, LOOPBACK);
    const approved = await svc.act({ roomId, action: "approve" }, LOOPBACK);
    expect(approved.body.snapshot?.view.draft.approved).toBe(true);
    const before = (
      await svc.act({ roomId, action: "state" }, LOOPBACK)
    ).body.snapshot;
    if (before === null) throw new Error("snapshot missing");
    const reopened = svc.open("", LOOPBACK);
    expect(reopened.roomId).not.toBe(roomId);
    expect(reopened.restored).toBe(true);
    expect(reopened.view.transcript).toEqual(before.view.transcript);
    expect(reopened.view.transcript.length).toBeGreaterThan(0);
    expect(reopened.view.draft.body).toBe(before.view.draft.body);
    // Same browser, same live shared room (review fix B-2): approval is not reset by a reopen.
    expect(reopened.view.draft.approved).toBe(true);
    expect(reopened.approvalNote).toBeNull();
  });

  it("MR-G8 different store keys are isolated and the same key restores", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const keyA = randomUUID();
    const keyB = randomUUID();
    const first = svc.open("", LOOPBACK, keyA);
    expect(first.restored).toBe(false);
    const roomId = first.roomId;
    const guided = await svc.act(
      { roomId, action: "guide", text: "per-browser persistence probe" },
      LOOPBACK,
    );
    expect(guided.status).toBe(200);
    await streamAllLines(svc, roomId, LOOPBACK);
    const editedDraft = await svc.act(
      { roomId, action: "edit-draft", text: "per-browser draft body probe" },
      LOOPBACK,
    );
    expect(editedDraft.status).toBe(200);
    const approved = await svc.act({ roomId, action: "approve" }, LOOPBACK);
    expect(approved.body.snapshot?.view.draft.approved).toBe(true);
    const before = (
      await svc.act({ roomId, action: "state" }, LOOPBACK)
    ).body.snapshot;
    if (before === null) throw new Error("snapshot missing");
    expect(before.view.transcript.length).toBeGreaterThan(0);
    const sameKey = svc.open("", LOOPBACK, keyA);
    expect(sameKey.roomId).not.toBe(roomId);
    expect(sameKey.restored).toBe(true);
    expect(sameKey.view.transcript).toEqual(before.view.transcript);
    expect(sameKey.view.draft.body).toBe(before.view.draft.body);
    const otherKey = svc.open("", LOOPBACK, keyB);
    expect(otherKey.restored).toBe(false);
    expect(otherKey.view.transcript).toHaveLength(0);
    expect(otherKey.view.draft.body).not.toBe(before.view.draft.body);
    expect(otherKey.view.guidance).not.toContain("per-browser persistence probe");
  });

  it("MR-G9 meetingRoomStoreKey accepts only a UUID cookie value", () => {
    const id = randomUUID();
    expect(meetingRoomStoreKey(undefined)).toBeNull();
    expect(meetingRoomStoreKey("")).toBeNull();
    expect(meetingRoomStoreKey("other=1")).toBeNull();
    expect(meetingRoomStoreKey(`mr_store=${id}`)).toBe(id);
    expect(meetingRoomStoreKey(`mr_store=${id.toUpperCase()}`)).toBe(
      id.toUpperCase(),
    );
    expect(meetingRoomStoreKey(`other=1; mr_store=${id}; x=2`)).toBe(id);
    expect(meetingRoomStoreKey([`mr_store=${id}`])).toBe(id);
    expect(meetingRoomStoreKey("mr_store=not-a-uuid")).toBeNull();
    expect(meetingRoomStoreKey("mr_store=")).toBeNull();
    expect(meetingRoomStoreKey(`mr_store=${id}-extra`)).toBeNull();
    expect(meetingRoomStoreKey(`mr_store=${id.slice(0, 8)}`)).toBeNull();
    expect(meetingRoomStoreKey(`mr_store=${id}; mr_store=not-a-uuid`)).toBe(id);
  });
});
