// R1 (release/v1): demo UI — Offline default with a clear Live option,
// a Demo Mode toggle that keeps owner approval, prominent Analyze/Approve,
// and SAM hidden unless SECOND_SEAT_EXPERIMENTAL_IMAGES=1. Offline only.
import { describe, expect, it } from "vitest";
import { createWebServer } from "../src/server.js";
import { renderSessionPage, type SessionPageSnapshot } from "../src/render.js";

const base: SessionPageSnapshot = {
  state: "input",
  revision: 0,
  segments: [],
  redactedText: "",
  result: null,
  payload: null,
  offline: true,
  superseded: null,
} as unknown as SessionPageSnapshot;

function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const server = createWebServer();
    server.listen(0, () => {
      const a = server.address();
      const port = typeof a === "object" && a !== null ? a.port : 0;
      fn(`http://localhost:${port}`).then(
        (v) => { server.close(); resolve(v); },
        (e: unknown) => { server.close(); reject(e); },
      );
    });
  });
}

describe("R1 demo UI", () => {
  it("R1-1 defaults to Offline and still offers a clearly labeled Live option", () => {
    const page = renderSessionPage(base);
    expect(page).toContain('id="mode-select"');
    expect(page).toMatch(/id="mode-offline"[^>]*aria-current="true"/);
    expect(page).toContain('id="mode-live"');
    expect(page).toContain("Live (Glimmer + Spark)");
    expect(page).toMatch(/id="mode-live"[^>]*aria-disabled="true"/);
    const live = renderSessionPage({ ...base, offline: false }, { mode: "live", liveAvailable: true });
    expect(live).toMatch(/id="mode-live"[^>]*aria-current="true"/);
    expect(live).toContain('id="live-label"');
  });

  it("R1-2 Demo Mode toggle is labeled and says owner approval is unchanged; approve buttons remain", () => {
    const page = renderSessionPage(base);
    expect(page).toContain('id="demo-mode"');
    expect(page).toContain("Demo Mode");
    expect(page).toContain("Owner approval is unchanged");
    expect(page).toContain('id="btn-approve"');
    expect(page).toContain('id="btn-analyze"');
    expect(page).toContain('id="btn-draft-approve"');
    expect(page).toMatch(/#btn-redact,#btn-approve,#btn-analyze/);
  });

  it("R1-3 server: /session stays Offline when Live is requested but not configured", async () => {
    await withServer(async (b) => {
      const html = await (await fetch(`${b}/session?mode=live`)).text();
      expect(html).toContain('id="live-unavailable"');
      expect(html).toContain('id="offline-label"');
      const res = await fetch(`${b}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "live" }),
      });
      expect(res.status).toBe(200);
      const { sessionId } = (await res.json()) as { sessionId: string };
      const st = (await (await fetch(`${b}/api/session/state?sessionId=${sessionId}`)).json()) as { offline: boolean };
      expect(st.offline).toBe(true);
    });
  });

  it("R1-4 SAM box is hidden on the brief page unless experimental images are enabled", async () => {
    expect(process.env.SECOND_SEAT_EXPERIMENTAL_IMAGES).not.toBe("1");
    await withServer(async (b) => {
      const html = await (await fetch(`${b}/briefs/demo`)).text();
      expect(html).not.toContain("data-sam-box=");
      expect(html).not.toContain('id="hero-chain"');
    });
  });
});
