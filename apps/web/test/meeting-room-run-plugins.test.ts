import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { renderMeetingRoomBody } from "../src/meetingRoomRender.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };

function runButton(html: string): string | null {
  const m = /<button[^>]*id="run-plugins"[^>]*>/.exec(html);
  return m === null ? null : m[0];
}

describe("meeting room run plugins button", () => {
  it("MR-P1 a non-demo page shows an enabled Run plugins button", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const page = svc.open("", HEADERS, randomUUID());
    expect(page.demo).toBeNull();
    const res = await svc.act({ roomId: page.roomId, action: "stream-next" }, HEADERS);
    const btn = runButton(renderMeetingRoomBody(res.body.snapshot!));
    expect(btn).not.toBeNull();
    expect(btn).toContain('data-mr-action="run-plugins"');
    expect(btn).not.toContain("disabled");
  });
  it("MR-P2 the run-plugins action succeeds outside demo mode", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const page = svc.open("", HEADERS, randomUUID());
    await svc.act({ roomId: page.roomId, action: "stream-next" }, HEADERS);
    const res = await svc.act({ roomId: page.roomId, action: "run-plugins" }, HEADERS);
    expect(res.status).toBe(200);
  });
  it("MR-P3 after takeover the Run plugins button is disabled", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const page = svc.open("", HEADERS, randomUUID());
    const res = await svc.act({ roomId: page.roomId, action: "takeover" }, HEADERS);
    const btn = runButton(renderMeetingRoomBody(res.body.snapshot!));
    expect(btn).not.toBeNull();
    expect(btn).toContain("disabled");
  });
});
