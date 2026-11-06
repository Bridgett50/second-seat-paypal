import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WEB_ROOT, loadDemo, loadGlimmerAttempts, loadGlimmerLive } from "../src/loadFixtures.js";
import { parseGlimmerRecall } from "../src/modelStrip.js";
import { renderBriefPage, type Brief } from "../src/render.js";

const baseBrief: Brief = { createdAt: "2024-01-01", entries: [] };

describe("parseGlimmerRecall", () => {
  it("parses the recall line from eval stdout", () => {
    expect(
      parseGlimmerRecall(
        "redactor: Glimmer: meta-models/Muse-Glimmer-30B\nrecall: 10/10 = 1.000\nspans returned: 12\nmisses: none\n",
      ),
    ).toBe("10/10");
  });

  it("parses partial recall with surrounding spaces", () => {
    expect(parseGlimmerRecall("recall:  7 / 10 = 0.7\n")).toBe("7/10");
  });

  it("returns null when no recall line is present", () => {
    expect(parseGlimmerRecall("spans returned: 12\nmisses: none\n")).toBeNull();
    expect(parseGlimmerRecall("")).toBeNull();
  });
});

describe("glimmer live chip", () => {
  it("loads the live recall from the repo fixture", () => {
    const live = loadGlimmerLive();
    expect(live).not.toBeNull();
    expect(live?.recall).toMatch(/^\d+\/\d+$/);
  });

  it("tolerates a missing fixture file", () => {
    expect(loadGlimmerLive("/nonexistent-root")).toBeNull();
  });

  it("keeps the invalid 0/39 run as an invalid attempt instead of hiding it", () => {
    const primary = JSON.parse(
      readFileSync(
        join(WEB_ROOT, "..", "..", "services", "bot", "fixtures", "glimmer-live-eval.json"),
        "utf8",
      ),
    ) as { eval_stdout: string };
    expect(primary.eval_stdout).toContain("error Unexpected");
    expect(parseGlimmerRecall(primary.eval_stdout)).toBe("0/39");
    const attempts = loadGlimmerAttempts();
    const invalid = attempts.find((a) => a.recallK === 0 && a.recallN === 39);
    expect(invalid?.status).toBe("invalid");
    expect(invalid?.completedK).toBe(0);
  });

  it("renders the newest-attempt headline with completed and full-batch recall", () => {
    const demo = loadDemo();
    expect(demo.glimmerLive?.status).toBe("incomplete");
    const page = renderBriefPage(
      demo.brief,
      demo.segments,
      demo.frames,
      demo.runLog,
      {
        pressureFallback: demo.pressureFallback,
        payloadDemo: demo.payloadDemo,
        glimmerLive: demo.glimmerLive,
      },
    );
    expect(page).toContain(
      "Latest attempt Oct 26 2026 21:27 UTC — incomplete: 6/8 cases completed · 18/29 legacy entity disappearance on completed cases · 18/39 full batch",
    );
    expect(page).toContain("Previous runs");
  });

  it("renders the glimmer-redact chip as incomplete for the unfinished headline run", () => {
    const demo = loadDemo();
    const page = renderBriefPage(
      demo.brief,
      demo.segments,
      demo.frames,
      demo.runLog,
      {
        pressureFallback: demo.pressureFallback,
        payloadDemo: demo.payloadDemo,
        glimmerLive: demo.glimmerLive,
      },
    );
    expect(demo.glimmerLive).not.toBeNull();
    expect(page).toContain('data-stage="glimmer-redact" data-status="incomplete"');
    expect(page).toContain("glimmer-redact: incomplete");
    expect(page).not.toContain('data-stage="glimmer-redact" data-status="live"');
  });

  it("keeps existing behavior when the fixture is absent", () => {
    const page = renderBriefPage(baseBrief, [], [], [], {
      glimmerLive: null,
    });
    expect(page).not.toContain('data-stage="glimmer-redact" data-status="live"');
  });
});
