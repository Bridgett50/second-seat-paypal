import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };

type Sizes = { pages: number; stores: number; activity: number; demoPages: number };

function sizesOf(svc: ReturnType<typeof createMeetingRoomService>): Sizes | undefined {
  const s = svc as unknown as { sizes?: () => Sizes };
  return typeof s.sizes === "function" ? s.sizes() : undefined;
}

describe("meeting room demo page cap", () => {
  it("MR-DC1 250 cookie-less demo opens stay within the demo cap of 200", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const first = svc.open("?demo=1", HEADERS, randomUUID());
    let last = first;
    for (let i = 0; i < 249; i += 1) {
      last = svc.open("?demo=1", HEADERS, randomUUID());
    }
    expect(
      (await svc.act({ roomId: first.roomId, action: "state" }, HEADERS)).status,
      "the oldest demo page must be evicted by the demo cap",
    ).toBe(404);
    expect((await svc.act({ roomId: last.roomId, action: "state" }, HEADERS)).status).toBe(200);
    const sizes = sizesOf(svc);
    expect(sizes, "the service must expose sizes()").toBeDefined();
    expect(sizes?.demoPages ?? Infinity).toBeLessThanOrEqual(200);
    expect(sizes?.pages ?? Infinity).toBeLessThanOrEqual(200);
    expect(sizes?.activity ?? Infinity, "demo pages must record no activity").toBe(0);
  });

  it("MR-DC2 a real tab survives 250 demo pages and 25 demo pages under its own cookie", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const keyK = randomUUID();
    const pageK = svc.open("", HEADERS, keyK);
    expect((await svc.act({ roomId: pageK.roomId, action: "stream-next" }, HEADERS)).status).toBe(200);
    for (let i = 0; i < 250; i += 1) {
      svc.open("?demo=1", HEADERS, randomUUID());
    }
    expect((await svc.act({ roomId: pageK.roomId, action: "state" }, HEADERS)).status).toBe(200);
    for (let i = 0; i < 25; i += 1) {
      svc.open("?demo=1", HEADERS, keyK);
    }
    expect(
      (await svc.act({ roomId: pageK.roomId, action: "state" }, HEADERS)).status,
      "demo pages must not count against the key's page cap",
    ).toBe(200);
  });
});
