import { describe, expect, it } from "vitest";
import { loadDemo, loadSeededScore } from "../src/loadFixtures.js";
import { renderBriefPage, type Brief } from "../src/render.js";

const baseBrief: Brief = { createdAt: "2024-01-01", entries: [] };

function countBadges(page: string): number {
  return (page.match(/class="pressure-badge"/g) ?? []).length;
}

function heldStatus(page: string): string {
  const m = page.match(/<p id="draft-status">(.*?)<\/p>/);
  if (!m || m[1] === undefined) throw new Error("draft-status missing");
  return m[1];
}

function html(): string {
  const demo = loadDemo();
  return renderBriefPage(demo.brief, demo.segments, demo.frames, demo.runLog, {
    pressureFallback: demo.pressureFallback,
    payloadDemo: demo.payloadDemo,
  });
}

describe("renderBriefPage", () => {
  it("performs no network calls from inline script", () => {
    const page = html();
    expect(page).not.toContain("fetch(");
    expect(page).not.toContain("XMLHttpRequest");
  });

  it("shows no live-call button by default", () => {
    expect(html()).not.toContain("live-call-btn");
  });

  it("never shows a live-call button, even with liveDev", () => {
    const demo = loadDemo();
    const page = renderBriefPage(
      demo.brief,
      demo.segments,
      demo.frames,
      demo.runLog,
      { liveDev: true, payloadDemo: demo.payloadDemo },
    );
    expect(page).not.toContain("live-call-btn");
    expect(page).not.toContain("Start live call");
  });

  it("has no image-upload control", () => {
    expect(html()).not.toContain("upload-png");
    expect(html()).not.toContain('accept=".png');
  });

  it("renders Copy disabled in the initial HTML", () => {
    expect(html()).toContain('id="btn-copy" disabled');
  });

  it("renders the replay label with the brief timestamp", () => {
    const demo = loadDemo();
    expect(html()).toContain(
      `Analysis precomputed ${demo.brief.createdAt}`,
    );
  });

  it("renders one badge per distinct pressure item id", () => {
    const page = renderBriefPage(baseBrief, [], [], [], {
      pressureFallback: [
        { id: "e8", text: "eight", segmentIds: ["t-00:01", "t-00:02"] },
        { id: "e8", text: "eight again", segmentIds: ["t-00:03"] },
        { id: "e9", text: "nine", segmentIds: ["t-00:04"] },
      ],
    });
    expect(countBadges(page)).toBe(2);
    expect(page.match(/pressure: e8/g) ?? []).toHaveLength(1);
  });

  it("held count equals the number of checkboxes from the same deduped list", () => {
    const page = renderBriefPage(baseBrief, [], [], [], {
      pressureFallback: [
        { id: "e8", text: "eight", segmentIds: ["t-00:01", "t-00:02"] },
        { id: "e8", text: "eight again", segmentIds: ["t-00:03"] },
        { id: "e9", text: "nine", segmentIds: ["t-00:04"] },
      ],
    });
    const boxes = page.match(/class="pressure-review"/g) ?? [];
    expect(countBadges(page)).toBe(2);
    expect(boxes).toHaveLength(2);
    expect(heldStatus(page)).toBe("Held: review the 2 pressure items first");
  });

  it("renders no duplicate badge text", () => {
    const page = renderBriefPage(baseBrief, [], [], [], {
      pressureFallback: [
        { id: "e8", text: "eight", segmentIds: ["t-00:01"] },
        { id: "e9", text: "nine", segmentIds: ["t-00:02"] },
        { id: "e10", text: "ten", segmentIds: ["t-00:03"] },
      ],
    });
    const texts = page.match(/pressure: e\d+/g) ?? [];
    expect(texts).toHaveLength(countBadges(page));
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("held count equals the rendered badge count, skipping items without segments", () => {
    const page = renderBriefPage(baseBrief, [], [], [], {
      pressureFallback: [
        { id: "e8", text: "eight", segmentIds: ["t-00:01"] },
        { id: "e9", text: "nine", segmentIds: [] },
        { id: "e10", text: "ten", segmentIds: ["t-00:03"] },
      ],
    });
    expect(countBadges(page)).toBe(2);
    expect(heldStatus(page)).toBe("Held: review the 2 pressure items first");
  });

  it("loads the seeded score from the frozen live file", () => {
    expect(loadSeededScore()).toEqual({
      catchK: 9,
      catchN: 9,
      catchLo: 0.701,
      catchHi: 1,
      falseK: 0,
      falseN: 4,
    });
    expect(loadSeededScore("/nonexistent-root")).toBeNull();
  });

  it("renders the seeded score line from file values and omits it when missing", () => {
    const seeded = renderBriefPage(baseBrief, [], [], [], {
      seededScore: { catchK: 9, catchN: 9, catchLo: 0.701, catchHi: 1, falseK: 0, falseN: 4 },
    });
    expect(seeded).toContain(
      '<p id="scores-seeded">Seeded errors caught 9/9 (95% CI 0.70–1.00), false alarms 0/4</p>',
    );
    const missing = renderBriefPage(baseBrief, [], [], [], {});
    expect(missing).not.toContain('id="scores-seeded"');
  });

  it("pluralizes the held message", () => {
    const one = renderBriefPage(baseBrief, [], [], [], {
      pressureFallback: [{ id: "p1", text: "one", segmentIds: ["t-00:01"] }],
    });
    expect(heldStatus(one)).toBe("Held: review the 1 pressure item first");
    const many = renderBriefPage(baseBrief, [], [], [], {
      pressureFallback: [
        { id: "p1", text: "one", segmentIds: ["t-00:01"] },
        { id: "p2", text: "two", segmentIds: ["t-00:02"] },
      ],
    });
    expect(heldStatus(many)).toBe("Held: review the 2 pressure items first");
  });

  it("shows a Scores card built from briefScore and glimmerLive numbers", () => {
    const page = renderBriefPage(baseBrief, [], [], [], {
      briefScore: { briefEntries: 9, truthEntries: 12, validatorClean: 8, matched: 11, categoryAgree: 8 },
      glimmerLive: { recall: "10/10" },
    });
    expect(page).toContain('id="scores"');
    expect(page).toContain("categories 8/11 · truth entry match 11/12 · citations resolved 8/9");
    expect(page).toContain("Glimmer legacy entity disappearance 10/10");
  });

  it("omits a Scores line when its file is missing", () => {
    const glimmerOnly = renderBriefPage(baseBrief, [], [], [], {
      glimmerLive: { recall: "10/10" },
    });
    expect(glimmerOnly).toContain('id="scores"');
    expect(glimmerOnly).not.toContain('id="scores-brief"');
    const briefOnly = renderBriefPage(baseBrief, [], [], [], {
      briefScore: { briefEntries: 9, truthEntries: 12, validatorClean: 8, matched: 11, categoryAgree: 8 },
    });
    expect(briefOnly).toContain('id="scores-brief"');
    expect(briefOnly).not.toContain('id="scores-glimmer"');
    const neither = renderBriefPage(baseBrief, [], [], [], {});
    expect(neither).not.toContain('id="scores"');
  });

  it("frame renders an inline data-uri img when pngBase64 given", () => {
    const brief: Brief = {
      createdAt: "2024-01-01",
      entries: [
        {
          id: "e1",
          category: "x",
          text: "see frame",
          speaker: null,
          citations: [
            { kind: "frame", segmentId: null, frameId: "f-00:01", region: null },
          ],
          flags: [],
        },
      ],
    };
    const withPng = renderBriefPage(
      brief,
      [],
      [{ id: "f-00:01", file: "a.png", time: "00:01", pngBase64: "iVBORw0=" }],
      [],
    );
    expect(withPng).toContain('<img src="data:image/png;base64,iVBORw0="');
    const missing = renderBriefPage(
      brief,
      [],
      [{ id: "f-00:01", file: "a.png", time: "00:01" }],
      [],
    );
    expect(missing).toContain("frame image missing");
    expect(missing).not.toContain("data:image/png;base64,");
  });
});

describe("heroChain", () => {
  it("overlays the SAM box on the synthetic hero image", async () => {
    const { renderBriefPage: render } = await import("../src/render.js");
    const page = render(
      { createdAt: "2024-01-01", entries: [] },
      [],
      [],
      [],
      {
        heroChain: {
          pngBase64: "iVBORw0=",
          boxPercent: { x: 10, y: 70, w: 60, h: 10 },
          date: "30th",
          modelGenerated: true,
        },
      },
    );
    expect(page).toContain('id="hero-chain"');
    expect(page).toContain("data-sam-box=");
    expect(page).toContain("Model-generated synthetic image");
  });
});
