// Clean UI rebuild (Oct 28, 2026): header bar, soft purple/pink theme and the
// "AI Twin of Bridgett" stage beside the brief. Offline only; no network.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderBriefPage, renderSessionPage, type SessionPageSnapshot } from "../src/render.js";
import { loadDemo, WEB_ROOT } from "../src/loadFixtures.js";
import { THEME_CSS, findAiSelf, twinStageHtml } from "../src/theme.js";

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

describe("clean UI theme and twin stage", () => {
  it("UI-1 both pages carry the header bar, theme and the twin stage with a visible AI-generated label", () => {
    const demo = loadDemo();
    const brief = renderBriefPage(demo.brief, demo.segments, demo.frames, demo.runLog, {});
    const session = renderSessionPage(base);
    expect(brief).toContain('<header id="app-bar">');
    expect(session).toContain('<header id="app-header">');
    for (const page of [brief, session]) {
      expect(page).toContain(THEME_CSS);
      expect(page).toContain('<aside id="twin-stage" aria-label="AI Twin of Bridgett"');
      expect(page).toContain('<span class="twin-badge">AI Twin of Bridgett</span>');
      expect(page).toMatch(/<span id="twin-ai-label" class="twin-ai-label">AI-generated<\/span>/);
      expect(page.match(/<h1>/g)?.length).toBe(1);
    }
    expect(THEME_CSS).toMatch(/\.ss-shell\{display:grid;grid-template-columns:minmax\(0,1fr\) 16rem/);
  });

  it("UI-2 no image configured: pastel BS initials placeholder and no <img> request", () => {
    const html = twinStageHtml({ imageSrc: null, modeLabel: "Offline demo" });
    expect(html).toContain('id="twin-placeholder"');
    expect(html).toContain(">BS</span>");
    expect(html).not.toContain("<img");
    const session = renderSessionPage(base);
    expect(session).toContain('id="twin-placeholder"');
    expect(session).not.toContain('id="twin-image"');
  });

  it("UI-3 image configured: stage shows it with alt text and keeps the AI-generated label", () => {
    const session = renderSessionPage(base, { aiSelfSrc: "/ai-self.png" });
    expect(session).toContain('<img id="twin-image" src="/ai-self.png" alt="AI-generated likeness of Bridgett');
    expect(session).not.toContain('id="twin-placeholder"');
    expect(session).toContain(">AI-generated</span>");
    const demo = loadDemo();
    const brief = renderBriefPage(demo.brief, demo.segments, demo.frames, demo.runLog, { aiSelfSrc: "/ai-self.jpg" });
    expect(brief).toContain('src="/ai-self.jpg"');
  });

  it("UI-4 findAiSelf prefers png, falls back to jpg, else null", () => {
    const root = mkdtempSync(join(tmpdir(), "ss-ai-self-"));
    expect(findAiSelf(root)).toBeNull();
    mkdirSync(join(root, "public"));
    writeFileSync(join(root, "public", "ai-self.jpg"), "x");
    expect(findAiSelf(root)?.url).toBe("/ai-self.jpg");
    writeFileSync(join(root, "public", "ai-self.png"), "x");
    expect(findAiSelf(root)).toMatchObject({ url: "/ai-self.png", contentType: "image/png" });
    // The repo ships the owner-supplied image.
    expect(findAiSelf(WEB_ROOT)?.url).toBe("/ai-self.png");
  });

  it("UI-5 the theme never hides an approval gate or the Demo Mode switch", () => {
    const hides = [...THEME_CSS.matchAll(/([^{}]+)\{[^}]*display:none[^}]*\}/g)].map((m) => m[1]!.trim());
    for (const sel of hides) {
      expect(sel).not.toMatch(/btn-approve|btn-draft-approve|demo-mode|#draft\b|#progress|#input-section|twin-ai-label/);
    }
    const session = renderSessionPage(base, { mode: "live", liveAvailable: true });
    expect(session).toContain('id="demo-mode" role="switch"');
    expect(session).toContain('<li class="pill pill-soft">Live</li>');
    expect(renderSessionPage(base)).toContain('<li class="pill pill-soft">Offline demo</li>');
  });
});
