import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { renderMeetingRoomBody } from "../src/meetingRoomRender.js";

const HEADERS = { host: "127.0.0.1:4174" } as any;
const TEST_ENV = { SECOND_SEAT_TEST_MODE: "1" } as any;

async function prepareDraft() {
  const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } as any });
  const storeKey = randomUUID();
  // open returns snapshot directly; need roomId from it
  const opened: any = await (svc as any).open("", HEADERS, storeKey);
  const roomId = opened.roomId ?? opened.snapshot?.roomId ?? opened.id ?? storeKey;
  // Some implementations return { snapshot, roomId }, others snapshot with roomId field
  let snap = opened.snapshot ?? opened;

  async function act(action: string, fields: any = {}) {
    const res: any = await (svc as any).act({ roomId, action, ...fields }, HEADERS);
    return res;
  }

  // state -> select-meeting -> stream-next *20
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

describe("meeting room takeover resume", () => {
  it("MR-R1 while taken over the room stays paused and shows a Resume twin control", async () => {
    const { snap: _snap, draftBody, act } = await prepareDraft();
    let r: any = await act("takeover");
    let snap: any = r.body.snapshot;
    expect(snap.view.twinStatus).toBe("paused (you took over)");
    const html: string = renderMeetingRoomBody(snap);
    expect(html).toContain('id="resume"');
    expect(html).toContain('data-mr-action="resume"');
    expect(html).toContain('aria-label="Resume the twin"');

    // approve should not approve
    r = await act("approve");
    snap = r.body.snapshot;
    expect(snap.view.draft.approved).toBe(false);

    // compare should return null
    r = await act("compare", { text: draftBody });
    expect(r.body.comparison).toBeNull();

    // send should not reach sent (use TEST_ENV via service already in test mode, but pass env in act if needed)
    // svc was created with TEST_ENV; act with TEST_ENV headers variant if supported, else just act
    // Try sending; sendState should not be sent
    const svc2: any = r;
    // attempt send
    r = await act("send");
    snap = r.body.snapshot;
    expect(snap.view.draft.sendState).not.toBe("sent");
  });

  it("MR-R2 resume clears the paused state and announces it", async () => {
    const { act } = await prepareDraft();
    await act("takeover");
    const r: any = await act("resume");
    const snap: any = r.body.snapshot;
    expect(snap.view.twinStatus).toBe("active");
    expect(r.body.announcements).toContain("You resumed. The twin is active again.");
    const html: string = renderMeetingRoomBody(snap);
    expect(html).not.toContain('id="resume"');
    // Take over button not disabled
    expect(html).toContain('id="takeover"');
    expect(html).not.toContain('id="takeover" aria-label="Take over from the twin" data-mr-action="takeover" disabled');
  });

  it("MR-R3 after resume approve, compare, edit and test-path send work again", async () => {
    const { draftBody, act } = await prepareDraft();
    await act("takeover");
    await act("resume");

    // edit-draft with changed body succeeds
    const changed = draftBody + "\nEdited after resume.";
    let r: any = await act("edit-draft", { text: changed });
    let snap: any = r.body.snapshot;
    expect(snap.view.draft.body).toBe(changed);

    // approve makes approved true
    r = await act("approve");
    snap = r.body.snapshot;
    expect(snap.view.draft.approved).toBe(true);

    // compare with approved body returns non-null
    r = await act("compare", { text: snap.view.draft.body });
    expect(r.body.comparison).not.toBeNull();

    // send with test path reaches sent
    r = await act("send");
    snap = r.body.snapshot;
    expect(snap.view.draft.sendState).toBe("sent");
  });

  it("MR-R4 take over again after resume pauses the twin again", async () => {
    const { act } = await prepareDraft();
    await act("takeover");
    await act("resume");
    let r: any = await act("takeover");
    let snap: any = r.body.snapshot;
    expect(snap.view.twinStatus).toBe("paused (you took over)");
    r = await act("send");
    snap = r.body.snapshot;
    expect(snap.view.draft.sendState).not.toBe("sent");
  });
});
