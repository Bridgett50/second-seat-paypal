import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };

async function approvedRoom() {
  const svc = createMeetingRoomService({ env: TEST_ENV });
  const key = randomUUID();
  const first = svc.open("", HEADERS, key);
  for (let i = 0; i < 3; i += 1) await svc.act({ roomId: first.roomId, action: "stream-next" }, HEADERS);
  const approved = await svc.act({ roomId: first.roomId, action: "approve" }, HEADERS);
  expect(approved.body.snapshot?.view.draft.approved).toBe(true);
  return { svc, key };
}

describe("meeting room demo gets a fresh store", () => {
  it("MR-D1 a ?demo=1 page with a used cookie starts fresh, not restored or approved", async () => {
    const { svc, key } = await approvedRoom();
    const demo = svc.open("?demo=1", HEADERS, key);
    expect(demo.restored).toBe(false);
    expect(demo.view.draft.approved).toBe(false);
    expect(demo.demo).not.toBeNull();
  });
  it("MR-D2 the cookie's real room is still restored and approved after a demo page", async () => {
    const { svc, key } = await approvedRoom();
    svc.open("?demo=1", HEADERS, key);
    const again = svc.open("", HEADERS, key);
    expect(again.restored).toBe(true);
    expect(again.view.draft.approved).toBe(true);
    expect(again.demo).toBeNull();
  });
});
