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

describe("meeting room evidence before approve", () => {
  it("MR-E1 evidence panel shows the visible unsent, unapproved package before Approve", async () => {
    const { snap } = await prepareDraft();
    const snapshot: any = snap;
    const preview = JSON.parse(snapshot.evidencePreviewJson);
    expect(preview.packageHash).toBe(snapshot.view.draft.sha256);
    expect(preview.sendState).toBe("unsent");
    expect(preview.approved).toBe(false);
    const html = renderMeetingRoomBody(snapshot);
    expect(html).toContain(preview.packageHash);
    expect(html).toContain("&quot;approved&quot;: false");
    expect(html).toContain("&quot;sendState&quot;: &quot;unsent&quot;");
  });

  it("MR-E2 evidence panel updates on Approve", async () => {
    const { act, snap } = await prepareDraft();
    let r: any = await act("approve");
    const approvedSnap: any = r.body.snapshot;
    const preview = JSON.parse(approvedSnap.evidencePreviewJson);
    expect(preview.approved).toBe(true);
    expect(preview.packageHash).toBe(approvedSnap.view.draft.sha256);
    expect(typeof preview.approvedAt).toBe("number");
    expect(preview.sendState).toBe("unsent");
    r = await act("evidence-export");
    const exported = JSON.parse(r.body.evidenceJson);
    expect(exported.packageHash).toBe(preview.packageHash);
  });

  it("MR-E3 imported-draft compare before approval reports a result marked not yet approved", async () => {
    const { act, draftBody, snap } = await prepareDraft();
    let r: any = await act("compare", { text: draftBody });
    expect(r.body.comparison).not.toBeNull();
    expect(r.body.comparisonApproved).toBe(false);
    r = await act("approve");
    r = await act("compare", { text: draftBody });
    expect(r.body.comparison).not.toBeNull();
    expect(r.body.comparisonApproved).toBe(true);
    const page = renderMeetingRoomPage(snap as any);
    expect(page).toContain("Not yet approved: compared against the current draft package. Approve it before sending.");
  });

  it("MR-E4 send still requires the exact approved package", async () => {
    const { act } = await prepareDraft();
    let r: any = await act("send");
    let preview = JSON.parse(r.body.snapshot.evidencePreviewJson);
    expect(preview.sendState).not.toBe("sent");
    r = await act("approve");
    r = await act("edit-draft", { text: (r.body.snapshot.view.draft.body as string) + " changed" });
    const editedSnap: any = r.body.snapshot;
    r = await act("send");
    preview = JSON.parse(r.body.snapshot.evidencePreviewJson);
    expect(r.body.snapshot.view.draft.sendState).not.toBe("sent");
    expect(preview.approved).toBe(false);
    expect(preview.packageHash).toBe(r.body.snapshot.view.draft.sha256);
    expect(preview.packageHash).toBe(editedSnap.view.draft.sha256);
    r = await act("approve");
    r = await act("send");
    preview = JSON.parse(r.body.snapshot.evidencePreviewJson);
    expect(r.body.snapshot.view.draft.sendState).toBe("sent");
    expect(preview.sendState).toBe("sent");
    expect(preview.approved).toBe(true);
  });

  it("MR-E5 while taken over compare stays empty", async () => {
    const { act } = await prepareDraft();
    await act("takeover");
    const r: any = await act("compare", { text: "hello" });
    expect(r.body.comparison).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(r.body, "comparisonApproved")).toBe(false);
  });
});
