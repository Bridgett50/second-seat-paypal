// E9 ledger: docs record draft fixes E7 (#73, F4 reload) and E8 (#74, D4-3 git SHA) as pending review/merge.
// Pure file reads; no network, no models, no sealed data.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const rd = (p: string) => readFileSync(resolve(root, p), "utf8");
const README = rd("docs/engineering-log.md");
const READINESS = rd("docs/release/c9-readiness.md");
const VIDEO = rd("docs/submission/video-script.md");
const NOTES = rd("docs/release/video-status-notes.md");
const THREE = [README, READINESS, VIDEO].join("\n");

describe("E9 ledger draft fixes", () => {
  it("E9-1 c9-readiness and README mention #73, #74 and draft", () => {
    for (const f of [READINESS, README]) {
      expect(f, "#73").toContain("#73");
      expect(f, "#74").toContain("#74");
      expect(f).toMatch(/draft/i);
    }
  });

  it("E9-2 README F4 reload line references E7/#73", () => {
    const line =
      README.split("\n").find(
        (l) => /F4/i.test(l) && /reload/i.test(l) && /E7/.test(l),
      ) ?? "";
    expect(line).toContain("#73");
  });

  it("E9-3 c9-readiness says F4 fix is pending review/merge (not closed)", () => {
    expect(READINESS).toMatch(/F4/);
    expect(READINESS).toMatch(/pending review(\/| and )merge/i);
    expect(READINESS).toMatch(/E7[^.\n]*pending review|pending review[^.\n]*E7/i);
    expect(THREE).not.toMatch(/F4 closed/i);
  });

  it("E9-4 historical notes, not current narration, keep the reload fix in draft E7", () => {
    expect(NOTES).toMatch(/reload/i);
    expect(NOTES).toMatch(/draft[^.\n]*E7|E7[^.\n]*draft/i);
    expect(NOTES).toMatch(/not current narration/i);
  });

  it("E9-5 no file says F4 closed or merged about E7/E8", () => {
    const NOTES = rd("docs/release/video-status-notes.md");
    const GUARDED = [THREE, NOTES].join("\n");
    expect(GUARDED).not.toMatch(/F4 closed/i);
    expect(GUARDED).not.toMatch(/E7[^.\n]*\bmerged\b/i);
    expect(GUARDED).not.toMatch(/E8[^.\n]*\bmerged\b/i);
    expect(GUARDED).not.toMatch(/\bmerged\b[^.\n]*E7/i);
    expect(GUARDED).not.toMatch(/\bmerged\b[^.\n]*E8/i);
  });
});
