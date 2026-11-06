import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { renderMeetingRoomBody } from "../src/meetingRoomRender.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };

describe("meeting room restored copy", () => {
  it("MR-R1 an approved room reopened with the same cookie does not claim approval never survives", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const key = randomUUID();
    const first = svc.open("", HEADERS, key);
    for (let i = 0; i < 3; i += 1) await svc.act({ roomId: first.roomId, action: "stream-next" }, HEADERS);
    const approved = await svc.act({ roomId: first.roomId, action: "approve" }, HEADERS);
    expect(approved.body.snapshot?.view.draft.approved).toBe(true);
    const reopened = svc.open("", HEADERS, key);
    expect(reopened.restored).toBe(true);
    expect(reopened.view.draft.approved).toBe(true);
    const html = renderMeetingRoomBody(reopened);
    expect(html).toContain("Restored from the shared room store");
    expect(html).not.toContain("approval never");
    expect(html).toContain("approval stay while this server keeps the room");
  });
});
