// Camera-ready UI (recording prep): prominent Demo Mode switch that keeps
// both approval gates, a labeled loading state for the two slow calls,
// and no developer clutter / console noise. Offline only; no network.
import { describe, expect, it } from "vitest";
import { PROGRESS_LABELS, renderBriefPage, renderSessionPage, type SessionPageSnapshot } from "../src/render.js";
import { loadDemo } from "../src/loadFixtures.js";

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

describe("camera-ready session UI", () => {
  it("CR-1 Demo Mode is a prominent switch and approval gates stay in the page", () => {
    const page = renderSessionPage(base);
    expect(page).toMatch(/<input type="checkbox" id="demo-mode" role="switch"/);
    expect(page).toContain('id="demo-mode-state"');
    expect(page).toMatch(/#demo-mode-toggle\{[^}]*border:2px solid/);
    expect(page).toContain("Owner approval is unchanged");
    expect(page).toContain('id="btn-approve"');
    expect(page).toContain('id="btn-draft-approve"');
    // Demo Mode hides only the developer payload panel, never an approval gate.
    const demoHides = [...page.matchAll(/body\.demo ([^{]+)\{display:none\}/g)].map((m) => m[1]!);
    expect(demoHides.join(",")).toContain("#payload-panel");
    expect(demoHides.join(",")).not.toMatch(/btn-approve|btn-draft-approve|#draft\b|#input-section/);
  });

  it("CR-2 loading state: live labels name Glimmer (GPU) and Muse Spark; offline never claims a GPU", () => {
    expect(PROGRESS_LABELS.live.redact).toBe("Redacting on Meta Glimmer (GPU)\u2026");
    expect(PROGRESS_LABELS.live.analyze).toBe("Writing brief with Meta Muse Spark\u2026");
    for (const v of Object.values(PROGRESS_LABELS.offline)) expect(v).not.toMatch(/GPU|Glimmer|Spark/);
    const live = renderSessionPage({ ...base, offline: false }, { mode: "live", liveAvailable: true });
    expect(live).toMatch(/<div id="progress" role="status"[^>]*data-mode="live"[^>]*hidden>/);
    expect(live).toContain('id="progress-elapsed"');
    expect(live).toContain("Redacting on Meta Glimmer (GPU)");
    const offline = renderSessionPage(base);
    expect(offline).toMatch(/data-mode="offline"/);
    expect(offline).not.toContain("Redacting on Meta Glimmer (GPU)");
    expect(offline).toContain("prefers-reduced-motion");
  });

  it("CR-3 no browser console noise: no console calls in page scripts and no favicon 404", () => {
    const session = renderSessionPage(base);
    const demo = loadDemo();
    const brief = renderBriefPage(demo.brief, demo.segments, demo.frames, demo.runLog, {});
    for (const page of [session, brief]) {
      expect(page).not.toMatch(/console\.(log|debug|info|warn|error)/);
      expect(page).toContain('<link rel="icon" href="data:,">');
    }
  });

  it("CR-4 brief page ?demo=1 hides developer-only run history panels", () => {
    const demo = loadDemo();
    const brief = renderBriefPage(demo.brief, demo.segments, demo.frames, demo.runLog, {});
    expect(brief).toMatch(/body\.demo #glimmer-runs,[^{]*#frames\{display:none\}/);
    expect(brief).toContain('document.body.classList.add("demo")');
  });
});
