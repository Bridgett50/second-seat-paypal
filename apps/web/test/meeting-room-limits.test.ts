import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import {
  MEETING_ROOM_MAX_COMPARE_CHARS,
  MEETING_ROOM_MAX_DRAFT_CHARS,
  MEETING_ROOM_MAX_GUIDANCE_CHARS,
  MEETING_ROOM_MAX_GUIDANCE_ENTRIES,
  createMeetingRoomService,
} from "../src/meetingRoom.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };

describe("meeting room input limits", () => {
  it("MR-L1 guide with 1,000,000 characters is refused fast and leaves the room unchanged", async () => {
    expect(MEETING_ROOM_MAX_GUIDANCE_CHARS).toBe(2_000);
    const svc = createMeetingRoomService({ env: {} });
    const roomId = svc.open("", HEADERS).roomId;
    const before = (await svc.act({ roomId, action: "state" }, HEADERS)).body
      .snapshot;
    if (before === undefined || before === null) throw new Error("snapshot missing");
    const text = "g".repeat(1_000_000);
    const start = performance.now();
    const refused = await svc.act({ roomId, action: "guide", text }, HEADERS);
    const elapsed = performance.now() - start;
    expect([400, 413]).toContain(refused.status);
    expect(refused.body.announcements).toHaveLength(1);
    expect(elapsed).toBeLessThan(200);
    const after = (await svc.act({ roomId, action: "state" }, HEADERS)).body
      .snapshot;
    if (after === undefined || after === null) throw new Error("snapshot missing");
    expect(after.view.guidance).toEqual(before.view.guidance);
    expect(after.view.transcript).toEqual(before.view.transcript);
  });

  it("MR-L2 edit-draft with 1,000,000 characters is refused fast and leaves the draft unchanged", async () => {
    expect(MEETING_ROOM_MAX_DRAFT_CHARS).toBe(20_000);
    const svc = createMeetingRoomService({ env: {} });
    const roomId = svc.open("", HEADERS).roomId;
    const before = (await svc.act({ roomId, action: "state" }, HEADERS)).body
      .snapshot;
    if (before === undefined || before === null) throw new Error("snapshot missing");
    const text = "g".repeat(1_000_000);
    const start = performance.now();
    const refused = await svc.act(
      { roomId, action: "edit-draft", text },
      HEADERS,
    );
    const elapsed = performance.now() - start;
    expect([400, 413]).toContain(refused.status);
    expect(refused.body.announcements).toHaveLength(1);
    expect(elapsed).toBeLessThan(200);
    const after = (await svc.act({ roomId, action: "state" }, HEADERS)).body
      .snapshot;
    if (after === undefined || after === null) throw new Error("snapshot missing");
    expect(after.view.draft).toEqual(before.view.draft);
  });

  it("MR-L3 compare with 20,001 characters is refused with 413", async () => {
    expect(MEETING_ROOM_MAX_COMPARE_CHARS).toBe(20_000);
    const svc = createMeetingRoomService({ env: {} });
    const roomId = svc.open("", HEADERS).roomId;
    const refused = await svc.act(
      { roomId, action: "compare", text: "x".repeat(20_001) },
      HEADERS,
    );
    expect(refused.status).toBe(413);
    expect(refused.body.announcements).toHaveLength(1);
  });

  it("MR-L4 at most 50 guidance entries per meeting", async () => {
    expect(MEETING_ROOM_MAX_GUIDANCE_ENTRIES).toBe(50);
    const svc = createMeetingRoomService({ env: {} });
    const roomId = svc.open("", HEADERS).roomId;
    for (let n = 0; n < 50; n += 1) {
      const res = await svc.act(
        { roomId, action: "guide", text: `note ${n}` },
        HEADERS,
      );
      expect(res.status).toBe(200);
    }
    const full = (await svc.act({ roomId, action: "state" }, HEADERS)).body
      .snapshot;
    expect(full?.view.guidance).toHaveLength(50);
    const refused = await svc.act(
      { roomId, action: "guide", text: "note 50" },
      HEADERS,
    );
    expect(refused.status).toBe(400);
    expect(refused.body.announcements).toHaveLength(1);
    const after = (await svc.act({ roomId, action: "state" }, HEADERS)).body
      .snapshot;
    expect(after?.view.guidance).toHaveLength(50);
  });

  it("MR-L5 guidance at exactly 2,000 characters is accepted", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const roomId = svc.open("", HEADERS).roomId;
    const res = await svc.act(
      { roomId, action: "guide", text: "h".repeat(2_000) },
      HEADERS,
    );
    expect(res.status).toBe(200);
  });
});
