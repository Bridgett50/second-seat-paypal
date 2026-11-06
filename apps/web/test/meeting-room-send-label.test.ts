import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { renderMeetingRoomBody } from "../src/meetingRoomRender.js";

describe("meeting room send label", () => {
  it("MR-SL1 a public loopback room labels Send as refused and links the refusal note", () => {
    const svc = createMeetingRoomService({ env: {} });
    const snap = svc.open("", { host: "127.0.0.1:4310" } as IncomingHttpHeaders, randomUUID());
    expect(snap.fakeSend).toBe(false);
    const body = renderMeetingRoomBody(snap);
    expect(body).toContain('>Send (refused on this host)</button>');
    expect(body).toContain('<p id="send-refused-note">Sending is refused on this host. The server only sends in local loopback test mode.</p>');
    expect(body).toContain('aria-describedby="send-refused-note"');
    expect(body).toContain('id="send"');
    expect(body).not.toContain("Send (test fake transport)");
    const tag = body.match(/<button[^>]*id="send"[^>]*>/);
    expect(tag).not.toBeNull();
    expect(tag![0]).not.toContain("disabled");
    expect(body.indexOf('id="send-refused-note"') < body.indexOf('id="send" ')).toBe(true);
  });

  it("MR-SL2 local loopback test mode keeps the fake transport label", () => {
    const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } });
    const snap = svc.open("", { host: "127.0.0.1:4310" } as IncomingHttpHeaders, randomUUID());
    expect(snap.fakeSend).toBe(true);
    const body = renderMeetingRoomBody(snap);
    expect(body).toContain('>Send (test fake transport)</button>');
    expect(body).not.toContain("refused on this host");
    expect(body).not.toContain("send-refused-note");
    expect(body).not.toContain('aria-describedby="send-refused-note"');
  });

  it("MR-SL3 a non-loopback host with the test flag is still labelled refused", () => {
    const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } });
    const snap = svc.open("", { host: "example.test" } as IncomingHttpHeaders, randomUUID());
    expect(snap.fakeSend).toBe(false);
    const body = renderMeetingRoomBody(snap);
    expect(body).toContain('>Send (refused on this host)</button>');
    expect(body).toContain('aria-describedby="send-refused-note"');
    expect(body).not.toContain("Send (test fake transport)");
  });

  it("MR-SL4 the Send accessible name matches the visible label on each host", () => {
    const publicSvc = createMeetingRoomService({ env: {} });
    const publicSnap = publicSvc.open("", { host: "127.0.0.1:4310" } as IncomingHttpHeaders, randomUUID());
    const publicBody = renderMeetingRoomBody(publicSnap);
    const publicTag = publicBody.match(/<button[^>]*id="send"[^>]*>/);
    expect(publicTag).not.toBeNull();
    expect(publicTag![0]).toContain('aria-label="Send (refused on this host)"');
    expect(publicTag![0]).toContain('aria-describedby="send-refused-note"');
    expect(publicTag![0]).not.toContain("Send through the test fake transport");
    const testSvc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } });
    const testSnap = testSvc.open("", { host: "127.0.0.1:4310" } as IncomingHttpHeaders, randomUUID());
    const testBody = renderMeetingRoomBody(testSnap);
    const testTag = testBody.match(/<button[^>]*id="send"[^>]*>/);
    expect(testTag).not.toBeNull();
    expect(testTag![0]).toContain('aria-label="Send through the test fake transport"');
  });
});
