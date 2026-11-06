import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService, type MeetingRoomService } from "../src/meetingRoom.js";
import { renderMeetingRoomBody } from "../src/meetingRoomRender.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };
const TEST_ENV: Readonly<Record<string, string | undefined>> = { SECOND_SEAT_TEST_MODE: "1" };

async function prepare(svc: MeetingRoomService, roomId: string): Promise<void> {
  const state = await svc.act({ roomId, action: "state" }, HEADERS);
  const meetingId = state.body.snapshot?.view.meetings[0]?.id;
  if (meetingId === undefined) throw new Error("seeded meeting missing");
  await svc.act({ roomId, action: "select-meeting", id: meetingId }, HEADERS);
  for (let i = 0; i < 20; i += 1) await svc.act({ roomId, action: "stream-next" }, HEADERS);
}

function noticeText(html: string): string | null {
  const m = /<p id="send-notice"[^>]*>([^<]*)<\/p>/.exec(html);
  return m === null ? null : (m[1] ?? "");
}

describe("meeting room send notice", () => {
  it("MR-N1 a gate-refused Send renders the reason next to the Send button", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const page = svc.open("", HEADERS, randomUUID());
    await prepare(svc, page.roomId);
    const res = await svc.act({ roomId: page.roomId, action: "send" }, HEADERS);
    expect(res.status).toBe(403);
    const html = renderMeetingRoomBody(res.body.snapshot!);
    expect(html).toContain('id="send-notice"');
    expect(html.indexOf('id="send-notice"')).toBeGreaterThan(html.indexOf('id="send"'));
    expect((noticeText(html) ?? "").length).toBeGreaterThan(0);
  });
  it("MR-N2 an unapproved Send in test mode renders the room's refusal reason", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const page = svc.open("", HEADERS, randomUUID());
    await prepare(svc, page.roomId);
    const res = await svc.act({ roomId: page.roomId, action: "send" }, HEADERS);
    expect(res.body.snapshot?.view.draft.sendState).not.toBe("sent");
    const html = renderMeetingRoomBody(res.body.snapshot!);
    expect((noticeText(html) ?? "").length).toBeGreaterThan(0);
  });
  it("MR-N3 a successful Send and ordinary actions render no send notice", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const page = svc.open("", HEADERS, randomUUID());
    await prepare(svc, page.roomId);
    await svc.act({ roomId: page.roomId, action: "approve" }, HEADERS);
    const sent = await svc.act({ roomId: page.roomId, action: "send" }, HEADERS);
    expect(sent.body.snapshot?.view.draft.sendState).toBe("sent");
    expect(renderMeetingRoomBody(sent.body.snapshot!)).not.toContain('id="send-notice"');
    const state = await svc.act({ roomId: page.roomId, action: "state" }, HEADERS);
    expect(renderMeetingRoomBody(state.body.snapshot!)).not.toContain('id="send-notice"');
  });
});
