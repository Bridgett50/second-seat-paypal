import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scorer = join(here, "..", "score-brief.mjs");

function runScorer(args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync("node", [scorer, ...args], { encoding: "utf8" });
    return { ok: true, output };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function writeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "score-brief-"));
  const labels = {
    entries: [
      { id: "T1", category: "decision", citations: [{ kind: "segment", segmentId: "s-1" }, { kind: "segment", segmentId: "s-2" }], flags: [] },
      { id: "T2", category: "action_item", citations: [{ kind: "segment", segmentId: "s-3" }], flags: [] },
      { id: "T3", category: "decision", citations: [{ kind: "segment", segmentId: "s-9" }], flags: [] },
    ],
  };
  const brief = {
    entries: [
      { id: "B1", category: "decision", citations: [{ kind: "segment", segmentId: "s-2", frameId: null, region: null }], flags: [] },
      { id: "B2", category: "decision", citations: [{ kind: "segment", segmentId: "s-3", frameId: null, region: null }], flags: ["citation_not_found"] },
      { id: "B3", category: "decision", citations: [{ kind: "segment", segmentId: "s-7", frameId: null, region: null }], flags: [] },
      { id: "B4", category: "action_item", citations: [], flags: ["missing_source"] },
    ],
  };
  const briefPath = join(dir, "brief.json");
  const labelsPath = join(dir, "labels.json");
  writeFileSync(briefPath, JSON.stringify(brief));
  writeFileSync(labelsPath, JSON.stringify(labels));
  return { briefPath, labelsPath };
}

describe("score-brief.mjs", () => {
  it("scores inline made-up brief/labels by shared segment ids", () => {
    const { briefPath, labelsPath } = writeSandbox();
    const result = runScorer([briefPath, labelsPath]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("brief entries: 4");
    expect(result.output).toContain("truth entries: 3");
    expect(result.output).toContain(
      "citations_resolved (no citation_not_found and no missing_source): 2/4",
    );
    expect(result.output).toContain("truth_entry_match (matched/total): 2/3");
    expect(result.output).toContain("category agreement among matched: 1/2");
    expect(result.output).toContain("unmatched truth ids: T3");
    expect(result.output).toContain("brief entries matching no truth entry: B3, B4");
  });

  it("refuses any path containing heldout", () => {
    const { briefPath } = writeSandbox();
    const result = runScorer([briefPath, join(tmpdir(), "heldout-labels.json")]);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("heldout");
  });

  it("writes the same numbers to --json <outPath>", () => {
    const { briefPath, labelsPath } = writeSandbox();
    const outPath = join(mkdtempSync(join(tmpdir(), "score-brief-")), "score.json");
    const result = runScorer([briefPath, labelsPath, "--json", outPath]);
    expect(result.ok).toBe(true);
    const payload = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>;
    expect(payload["briefEntries"]).toBe(4);
    expect(payload["truthEntries"]).toBe(3);
    expect(payload["citationsResolved"]).toBe(2);
    expect(payload["truthEntryMatch"]).toBe(2);
    expect(payload["categoryAgree"]).toBe(1);
    expect(payload["unmatchedTruthIds"]).toEqual(["T3"]);
    expect(typeof payload["scoredAt"]).toBe("string");
    // Deprecated aliases stay readable.
    expect(payload["validatorClean"]).toBe(2);
    expect(payload["matched"]).toBe(2);
    expect(result.output).toContain("brief entries: 4");
    expect(result.output).toContain("truth_entry_match (matched/total): 2/3");
  });
});
