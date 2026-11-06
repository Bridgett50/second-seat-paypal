import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };

describe("meeting room acted keys", () => {
  it("MR-A1 200 state POSTs do not mark keys as acted so a new key still gets a page", async () => {
    const svc = createMeetingRoomService({ env: {} });
    for (let i = 0; i < 200; i += 1) {
      const page = svc.open("", HEADERS, randomUUID());
      await svc.act({ roomId: page.roomId, action: "state" }, HEADERS);
      await svc.act({ roomId: page.roomId, action: "evidence-export" }, HEADERS);
    }
    let admitted = true;
    try {
      svc.open("", HEADERS, randomUUID());
    } catch {
      admitted = false;
    }
    expect(admitted, "state and evidence-export must not mark a key as acted").toBe(true);
  });

  it("MR-A2 a stream-next marks a key as acted so it survives 250 open-only keys", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const keyA = randomUUID();
    const pageA = svc.open("", HEADERS, keyA);
    expect((await svc.act({ roomId: pageA.roomId, action: "stream-next" }, HEADERS)).status).toBe(200);
    for (let i = 0; i < 250; i += 1) {
      try {
        svc.open("", HEADERS, randomUUID());
      } catch {
        // a busy refusal is fine here; key A must survive either way
      }
    }
    expect((await svc.act({ roomId: pageA.roomId, action: "state" }, HEADERS)).status).toBe(200);
  });

  it("MR-A3 an action on an evicted room shows the expired text to the client", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const res = await svc.act({ roomId: randomUUID(), action: "state" }, HEADERS);
    expect(res.status).toBe(404);
    expect(res.body.snapshot).toBeNull();
    // The page script shows body.announcements in its live region.
    expect(res.body.announcements).toEqual(["This room expired. Reload to start again."]);
  });
});
