import { describe, it, expect } from "vitest";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { createWebServer } from "../src/server.js";
import { renderMeetingRoomPage } from "../src/meetingRoomRender.js";
import { findAiSelf } from "../src/theme.js";
import { WEB_ROOT } from "../src/loadFixtures.js";

const HEADERS = { host: "127.0.0.1:4174" };

describe("meeting room twin stage", () => {
  it("meeting room page mounts the twin stage with the AI-self image when one is present", () => {
    const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } });
    const snap = svc.open("?demo=1", HEADERS);
    const html = renderMeetingRoomPage(snap as any, "/ai-self.png");
    expect(html).toContain('id="twin-stage"');
    expect(html).toContain('id="twin-image"');
    expect(html).toContain('src="/ai-self.png"');
    expect(html).toContain("AI-generated likeness of Bridgett, her AI Twin");
    expect(html).toContain("AI-generated");
    expect(html).not.toContain('id="twin-placeholder"');
    const h1Idx = html.indexOf("<h1>Twin meeting room</h1>");
    const stageIdx = html.indexOf('id="twin-stage"');
    const rootIdx = html.indexOf('id="mr-root"');
    expect(h1Idx).toBeGreaterThan(-1);
    expect(stageIdx).toBeGreaterThan(-1);
    expect(rootIdx).toBeGreaterThan(-1);
    expect(stageIdx).toBeGreaterThan(h1Idx);
    expect(stageIdx).toBeLessThan(rootIdx);
    const mains = (html.match(/<main/g) ?? []).length;
    expect(mains).toBe(1);
  });

  it("meeting room page shows the BS placeholder when no AI-self image exists", () => {
    const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } });
    const snap = svc.open("?demo=1", HEADERS);
    const htmlNull = renderMeetingRoomPage(snap as any, null);
    expect(htmlNull).toContain('id="twin-stage"');
    expect(htmlNull).toContain('id="twin-placeholder"');
    expect(htmlNull).toContain(">BS<");
    expect(htmlNull).not.toContain('id="twin-image"');
    expect(htmlNull).not.toContain("<img");
    const htmlOmitted = renderMeetingRoomPage(snap as any);
    expect(htmlOmitted).toContain('id="twin-stage"');
    expect(htmlOmitted).toContain('id="twin-placeholder"');
    expect(htmlOmitted).toContain(">BS<");
    expect(htmlOmitted).not.toContain('id="twin-image"');
    expect(htmlOmitted).not.toContain("<img");
  });

  it("GET /meeting-room?demo=1 serves the twin stage using findAiSelf", async () => {
    const svc = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "1" } });
    const server = createWebServer({ meetingRoom: svc } as Parameters<typeof createWebServer>[0]);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const addr = server.address() as any;
      const url = `http://127.0.0.1:${addr.port}/meeting-room?demo=1`;
      const res = await fetch(url);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('id="twin-stage"');
      const aiSelf = findAiSelf(WEB_ROOT);
      if (aiSelf) {
        expect(html).toContain('id="twin-image"');
        expect(html).toContain(`src="${aiSelf.url}"`);
      } else {
        expect(html).toContain('id="twin-placeholder"');
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
