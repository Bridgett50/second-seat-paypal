import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import {
  A11Y_LABELS,
  A11Y_REGION_ORDER,
  pluginControlLabel,
  SEND_DISABLED_REASON,
} from "@second-seat/bot/dist/src/t2-room.js";
import {
  createMeetingRoomService,
  MEETING_ROOM_API,
  type MeetingRoomSnapshot,
} from "../src/meetingRoom.js";
import {
  MEETING_ROOM_EXTRA_LABELS,
  renderMeetingRoomBody,
  renderMeetingRoomPage,
} from "../src/meetingRoomRender.js";
import { validatePostBody } from "../src/server.js";

const HEADERS: IncomingHttpHeaders = { host: "127.0.0.1:4174" };
const TEST_ENV: Readonly<Record<string, string | undefined>> = {
  SECOND_SEAT_TEST_MODE: "1",
};

type ControlTag = { tag: string; id: string | null; label: string | null };

function controlsIn(html: string): ControlTag[] {
  const out: ControlTag[] = [];
  const re = /<(button|input|textarea|select)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[2] ?? "";
    const id = /id="([^"]*)"/.exec(attrs)?.[1] ?? null;
    const label = /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? null;
    out.push({ tag: (m[1] ?? "?").toLowerCase(), id, label });
  }
  return out;
}

function expectedPluginLabel(id: string): string | null {
  for (const action of ["include", "exclude", "refresh"] as const) {
    const prefix = `plugin-${action}-`;
    if (id.startsWith(prefix) && id.length > prefix.length) {
      return pluginControlLabel(action, id.slice(prefix.length));
    }
  }
  return null;
}

/** Snapshots from opening `?demo=1` through every demo step (test mode). */
async function demoSnapshots(): Promise<MeetingRoomSnapshot[]> {
  const svc = createMeetingRoomService({ env: TEST_ENV });
  const snaps: MeetingRoomSnapshot[] = [];
  let snap = svc.open("?demo=1", HEADERS);
  snaps.push(snap);
  for (let i = 0; i < 12; i += 1) {
    const res = await svc.act({ roomId: snap.roomId, action: "demo-next" }, HEADERS);
    expect(res.status).toBe(200);
    const next = res.body.snapshot;
    if (next === null) throw new Error("demo snapshot missing");
    snap = next;
    snaps.push(snap);
    if (snap.demo === null || snap.demo.done) break;
  }
  return snaps;
}

describe("meeting room page", () => {
  it("T17-6 every meeting room control is labeled from A11Y_LABELS or pluginControlLabel", async () => {
    const snaps = await demoSnapshots();
    const first = snaps[0];
    const second = snaps[1];
    const afterPlugin = snaps[4];
    const last = snaps[snaps.length - 1];
    if (
      first === undefined ||
      second === undefined ||
      afterPlugin === undefined ||
      last === undefined
    ) {
      throw new Error("demo snapshots missing");
    }
    const pages = [
      renderMeetingRoomPage(first),
      renderMeetingRoomPage(second),
      renderMeetingRoomPage(afterPlugin),
      renderMeetingRoomPage(last),
    ];
    const demoPage = pages[pages.length - 1];
    if (demoPage === undefined) throw new Error("demo page missing");
    for (const key of Object.keys(A11Y_LABELS)) {
      expect(demoPage, `missing control ${key}`).toContain(`id="${key}"`);
    }
    const pluginPage = pages[2];
    if (pluginPage === undefined) throw new Error("plugin stage page missing");
    expect(
      controlsIn(pluginPage).some((c) => c.id !== null && c.id.startsWith("plugin-")),
      "expected a plugin control after demo-plugin",
    ).toBe(true);
    for (const page of pages) {
      for (const c of controlsIn(page)) {
        expect(c.id, `<${c.tag}> is missing an id`).not.toBeNull();
        const id = c.id ?? "";
        const staticLabel = (A11Y_LABELS as Record<string, string>)[id];
        if (staticLabel !== undefined) {
          expect(c.label, `wrong aria-label for #${id}`).toBe(staticLabel);
        } else if ((MEETING_ROOM_EXTRA_LABELS as Record<string, string>)[id] !== undefined) {
          expect(c.label, `wrong aria-label for #${id}`).toBe((MEETING_ROOM_EXTRA_LABELS as Record<string, string>)[id]);
        } else {
          const expected = expectedPluginLabel(id);
          expect(expected, `unexpected control id #${id}`).not.toBeNull();
          expect(c.label, `wrong aria-label for #${id}`).toBe(expected);
        }
      }
    }
  });

  it("T17-6 the page has one polite live region and exactly one main landmark", async () => {
    const snaps = await demoSnapshots();
    const last = snaps[snaps.length - 1];
    if (last === undefined) throw new Error("demo snapshots missing");
    const html = renderMeetingRoomPage(last);
    expect(html.match(/aria-live="polite"/g) ?? []).toHaveLength(1);
    expect(html.match(/<main\b/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('role="main"');
  });

  it("T17-6 the nine A11Y_REGION_ORDER sections are labeled by their headings, in order", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const html = renderMeetingRoomPage(svc.open("?demo=1", HEADERS));
    let prev = -1;
    for (const region of A11Y_REGION_ORDER) {
      const open = `<section aria-labelledby="mr-${region}-heading">`;
      const idx = html.indexOf(open);
      expect(idx, `missing section for region ${region}`).toBeGreaterThan(prev);
      const heading = `<h2 id="mr-${region}-heading">`;
      const headingIdx = html.indexOf(heading, idx);
      expect(headingIdx, `missing heading for region ${region}`).toBeGreaterThan(idx);
      prev = idx;
    }
  });

  it("T17-6 the demo card renders only with ?demo=1", () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const plain = renderMeetingRoomPage(svc.open("", HEADERS));
    expect(plain).not.toContain('id="demo-next"');
    expect(plain).not.toContain("mr-demo-heading");
    const demo = renderMeetingRoomPage(svc.open("?demo=1", HEADERS));
    expect(demo).toContain('id="demo-next"');
    expect(demo).toContain("mr-demo-heading");
  });

  it("MR-R1 dynamic text is HTML-escaped", async () => {
    const svc = createMeetingRoomService({ env: TEST_ENV });
    const opened = svc.open("", HEADERS);
    const evil = "<script>alert(1)</script>";
    const res = await svc.act(
      { roomId: opened.roomId, action: "guide", text: evil },
      HEADERS,
    );
    expect(res.status).toBe(200);
    const snap = res.body.snapshot;
    if (snap === null) throw new Error("snapshot missing");
    const html = renderMeetingRoomBody(snap);
    expect(html).not.toContain(evil);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("MR-R2 POST /api/meeting-room accepts only roomId, action, text and id", () => {
    const ok = { roomId: "r", action: "state", text: "t", id: "i" };
    expect(
      validatePostBody(MEETING_ROOM_API, "application/json", JSON.stringify(ok), ok),
    ).toBeNull();
    const bad = { roomId: "r", action: "state", extra: "x" };
    const err = validatePostBody(
      MEETING_ROOM_API,
      "application/json",
      JSON.stringify(bad),
      bad,
    );
    expect(typeof err).toBe("string");
    expect(err ?? "").toContain('unknown field "extra"');
  });

  it("MR-R3 the page loads no external resources and uses no browser storage", async () => {
    const snaps = await demoSnapshots();
    const last = snaps[snaps.length - 1];
    if (last === undefined) throw new Error("demo snapshots missing");
    const html = renderMeetingRoomPage(last);
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("sessionStorage");
    expect(html).not.toContain("url(");
    expect(html).not.toContain(" src=");
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(
        href.startsWith("data:") || href.startsWith("mailto:"),
        `external href ${href}`,
      ).toBe(true);
    }
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0] ?? "").not.toContain("src");
  });

  it("MR-R4 demo-next refuses the send step without the fake-send gate", async () => {
    const svc = createMeetingRoomService({ env: {} });
    const opened = svc.open("?demo=1", HEADERS);
    let snap = opened;
    for (let i = 0; i < 5; i += 1) {
      const res = await svc.act({ roomId: snap.roomId, action: "demo-next" }, HEADERS);
      expect(res.status).toBe(200);
      const next = res.body.snapshot;
      if (next === null) throw new Error("demo snapshot missing");
      snap = next;
    }
    const refused = await svc.act(
      { roomId: snap.roomId, action: "demo-next" },
      HEADERS,
    );
    // F140-4: the guide records Send as not attempted and moves on.
    expect(refused.status).toBe(200);
    expect(refused.body.snapshot?.demo?.completed).toBe(6);
    expect(refused.body.snapshot?.demo?.sendNote).toContain("not sent");
    expect(refused.body.announcements).toContain(SEND_DISABLED_REASON);
    expect(svc.sentBodies()).toHaveLength(0);
    expect(refused.body.snapshot?.view.draft.sendState).not.toBe("sent");
  });
});
