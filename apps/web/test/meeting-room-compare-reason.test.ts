import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { renderMeetingRoomBody, renderMeetingRoomPage } from "../src/meetingRoomRender.js";

const HEADERS = { host: "127.0.0.1:4174" } as any;

async function prepareDraft() {
  const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } as any });
  const storeKey = randomUUID();
  const opened: any = await (svc as any).open("", HEADERS, storeKey);
  const roomId = opened.roomId ?? opened.snapshot?.roomId ?? opened.id ?? storeKey;
  let snap = opened.snapshot ?? opened;
  async function act(action: string, fields: any = {}) {
    const res: any = await (svc as any).act({ roomId, action, ...fields }, HEADERS);
    return res;
  }
  let r: any = await act("state");
  snap = r.body.snapshot;
  const meetingId = snap.view.meetings[0].id;
  r = await act("select-meeting", { id: meetingId });
  snap = r.body.snapshot;
  for (let i = 0; i < 20; i++) {
    r = await act("stream-next");
    snap = r.body.snapshot;
  }
  const draftBody: string = snap.view.draft.body;
  return { svc, roomId, snap, draftBody, act };
}

describe("meeting room compare reason", () => {
  it("MR-CR1 compare while taken over returns the paused reason and announces it", async () => {
    const { act } = await prepareDraft();
    await act("takeover");
    const r: any = await act("compare", { text: "hello" });
    expect(r.status).toBe(200);
    expect(r.body.comparison).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(r.body, "comparisonApproved")).toBe(false);
    const paused = "Compare is unavailable: you took over; the twin is paused. Resume the twin, then compare.";
    expect(r.body.comparisonReason).toBe(paused);
    expect(r.body.announcements).toContain(paused);
  });

  it("MR-CR2 compare after send returns the sent reason", async () => {
    const { act } = await prepareDraft();
    await act("approve");
    const s: any = await act("send");
    expect(s.body.snapshot.view.draft.sendState).toBe("sent");
    const r: any = await act("compare", { text: "hello" });
    expect(r.status).toBe(200);
    expect(r.body.comparison).toBeNull();
    const sent = "Compare is unavailable: this package was already sent.";
    expect(r.body.comparisonReason).toBe(sent);
    expect(r.body.announcements).toContain(sent);
  });

  it("MR-CR3 compare with a result has no reason", async () => {
    const { act } = await prepareDraft();
    const r: any = await act("compare", { text: "hello" });
    expect(r.body.comparison).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(r.body, "comparisonReason")).toBe(false);
  });

  it("MR-CR4 the page script no longer tells the user to approve first", async () => {
    const { snap } = await prepareDraft();
    const page = renderMeetingRoomPage(snap);
    expect(page).not.toContain("Approve the draft first, then compare.");
    expect(page).toContain("comparisonReason");
    expect(page).toContain("Compare is unavailable right now.");
  });
});
