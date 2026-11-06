import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { renderMeetingRoomBody, renderMeetingRoomPage } from "../src/meetingRoomRender.js";
import { renderBriefPage, renderSessionPage, type SessionPageSnapshot } from "../src/render.js";
import { loadDemo } from "../src/loadFixtures.js";
import { twinStageHtml } from "../src/theme.js";

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

const base = {
  state: "input",
  revision: 0,
  segments: [],
  redactedText: "",
  approved: false,
  result: null,
  payload: null,
  offline: true,
  superseded: null,
} as unknown as SessionPageSnapshot;

describe("meeting room copy", () => {
  it("MR-C1 meeting room page shows the meeting room caption, not the brief caption", () => {
    const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } as any });
    const snap: any = (svc as any).open("?demo=1", HEADERS);
    const html = renderMeetingRoomPage(snap.snapshot ?? snap as any, null);
    expect(html).toContain('<p class="twin-caption">Offline meeting room with made-up meetings. The twin drafts; you approve every step before anything moves.</p>');
    expect(html).not.toContain("Sits beside the brief");
  });

  it("MR-C2 brief and session pages keep the default caption", () => {
    const demo = loadDemo();
    const brief = renderBriefPage(demo.brief, demo.segments, demo.frames, demo.runLog, {});
    const session = renderSessionPage(base);
    expect(brief).toContain('<p class="twin-caption">Sits beside the brief and suggests. It never sends anything for you.</p>');
    expect(brief).not.toContain("Offline meeting room with made-up meetings");
    expect(session).toContain('<p class="twin-caption">Sits beside the brief and suggests. It never sends anything for you.</p>');
    expect(session).not.toContain("Offline meeting room with made-up meetings");
    expect(twinStageHtml({ imageSrc: null, modeLabel: "Offline demo" })).toContain('<p class="twin-caption">Sits beside the brief and suggests. It never sends anything for you.</p>');
    expect(twinStageHtml({ imageSrc: null, modeLabel: "Offline demo", caption: "A & <b>" })).toContain("A &amp; &lt;b&gt;");
  });

  it("MR-C3 before Approve the evidence intro says unsent preview", async () => {
    const { snap } = await prepareDraft();
    const body = renderMeetingRoomBody(snap as any);
    expect(body).toContain("Unsent evidence preview for the selected meeting");
    expect(body).toContain("current draft. Nothing has been sent. Synthetic data only.");
    expect(body).toContain("&quot;approved&quot;: false");
    expect(body).toContain("Evidence record</h2>");
    expect(body).not.toContain("approved package.");
    expect(body).not.toContain("Evidence record for the selected meeting");
  });

  it("MR-C4 after Approve the evidence intro says evidence record", async () => {
    const { snap, act } = await prepareDraft();
    const r: any = await act("approve");
    const after = r.body.snapshot;
    const body = renderMeetingRoomBody(after as any);
    expect(body).toContain("Evidence record for the selected meeting");
    expect(body).toContain("package (send state shown below). Synthetic data only.");
    expect(body).toContain("&quot;approved&quot;: true");
    expect(body).not.toContain("Unsent evidence preview");
  });

  it("MR-C5 after a test-mode send the evidence intro says evidence record", async () => {
    const { act } = await prepareDraft();
    let r: any = await act("approve");
    r = await act("send");
    const after = r.body.snapshot;
    expect(after.view.draft.sendState).toBe("sent");
    const body = renderMeetingRoomBody(after as any);
    expect(body).toContain("Evidence record for the selected meeting");
    expect(body).toContain("&quot;sendState&quot;: &quot;sent&quot;");
    expect(body).not.toContain("Unsent evidence preview");
  });
});
