/**
 * Seeded-mutant suite for the deterministic brief ("memo") rules.
 * $0: recorded briefs only, no model calls. See eval/rules/ and
 * eval/results/rules-table.md.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyBrief } from "@second-seat/core";
import {
  REPO_ROOT,
  SEED,
  SOURCES,
  changeNumber,
  checkSums,
  digestCases,
  flipNegation,
  generate,
  loadSources,
  mulberry32,
} from "../rules/mutants.mjs";
import { EXPECTED_SIGNAL, renderTable, scoreAll, summarize, wilson } from "../rules/run.mjs";
import { claimsCases, runClaimsCase } from "../rules/claims.mjs";

const sources = loadSources();
const cases = generate(sources);
const scored = scoreAll(sources, cases);

describe("generator", () => {
  it("is deterministic for a seed and changes with the seed", () => {
    expect(digestCases(generate(sources, SEED))).toBe(digestCases(cases));
    expect(digestCases(generate(sources, SEED + 1))).not.toBe(digestCases(cases));
  });

  it("matches the pinned eval/rules/SHA256SUMS (inputs + generated set)", () => {
    expect(checkSums(sources, cases)).toEqual([]);
  });

  it("reads only recorded briefs and dev/hero inputs, never sealed or held-out files", () => {
    for (const s of SOURCES) {
      for (const p of [s.brief, s.transcript, s.frames].filter((x) => x !== null)) {
        expect(p).not.toMatch(/heldout|holdout|sealed/i);
      }
    }
  });

  it("does not mutate the source briefs", () => {
    const fresh = loadSources();
    expect(JSON.stringify(sources.map((s) => s.brief))).toBe(JSON.stringify(fresh.map((s) => s.brief)));
  });

  it("produces a non-trivial set with controls", () => {
    expect(cases.mutants.length).toBeGreaterThanOrEqual(60);
    expect(cases.controls.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.mutants.map((m) => m.id)).size).toBe(cases.mutants.length);
  });

  it("mulberry32 is stable", () => {
    const r = mulberry32(102);
    const first = [r(), r(), r()];
    const again = mulberry32(102);
    expect([again(), again(), again()]).toEqual(first);
    for (const x of first) expect(x >= 0 && x < 1).toBe(true);
  });

  it("flipNegation adds or removes a negation", () => {
    expect(flipNegation("The box will fit.")).toBe("The box will not fit.");
    expect(flipNegation("The 10-inch doesn't fit.")).toBe("The 10-inch does fit.");
    expect(flipNegation("We never agreed.")).toBe("We agreed.");
    expect(flipNegation("Buffet, 140 guests.")).toMatch(/^It is not the case that/);
  });

  it("changeNumber bumps the first number, null when none", () => {
    const out = changeNumber("140 guests by November 10", mulberry32(1));
    expect(out).not.toBe("140 guests by November 10");
    expect(out).toMatch(/ guests by November 10$/);
    expect(changeNumber("no digits", mulberry32(1))).toBeNull();
  });
});

describe("verifyBrief vs seeded mutants", () => {
  it("passes every unmutated control brief", () => {
    expect(scored.controlBriefsBlocked).toEqual([]);
  });

  it("blocks every block-expected mutant", () => {
    const missed = scored.mutants.filter((m) => m.expect === "block" && !m.blocked).map((m) => m.id);
    expect(missed).toEqual([]);
  });

  it("escalates every escalate-expected mutant via the designed signal", () => {
    const missed = scored.mutants
      .filter((m) => m.expect === "escalate")
      .filter((m) => !m.newEscalations.some((e) => e.split(":")[0] === (EXPECTED_SIGNAL as Record<string, string>)[m.operator as string]))
      .map((m) => m.id);
    expect(missed).toEqual([]);
  });

  it("raises no false alarm on benign rewrites", () => {
    expect(scored.controls.filter((c) => c.caught).map((c) => c.id)).toEqual([]);
  });

  it("reports known-gap mutants as misses instead of hiding them", () => {
    const gap = scored.mutants.filter((m) => m.expect === "gap");
    expect(gap.length).toBeGreaterThan(0);
    const s = summarize(scored, []);
    expect(s.rules.gapMisses.length + s.rules.knownGaps.k).toBe(gap.length);
  });

  it("mutation check: brief-level defects are invisible to the flags-only baseline", () => {
    // validateBrief alone has no refusal verdict; for a wrong meeting, a
    // dangling flagged id or a malformed brief it adds no flag at all (or
    // throws), so only the fail-closed verifyBrief stops them.
    const briefLevel = scored.mutants.filter((m) => ["meeting_swap", "dangling_flagged", "malformed_brief"].includes(m.operator));
    expect(briefLevel.length).toBe(3 * SOURCES.length);
    expect(briefLevel.filter((m) => m.baselineFlagged).map((m) => m.id)).toEqual([]);
    expect(briefLevel.every((m) => m.blocked)).toBe(true);
  });

  it("a malformed brief is a refusal, not a crash", () => {
    const src = sources[0]!;
    const v = verifyBrief({ segments: src.segments, frames: src.frames }, { entries: "nope" });
    expect(v.passed).toBe(false);
    expect(v.feedback.join(" ")).toMatch(/structure/);
  });
});

describe("results", () => {
  it("eval/results/rules-table.md matches a fresh run", () => {
    const claims = claimsCases().map(runClaimsCase);
    const table = renderTable(summarize(scored, claims));
    expect(readFileSync(join(REPO_ROOT, "eval", "results", "rules-table.md"), "utf8")).toBe(table);
  });

  it("wilson matches the shared helper's values", () => {
    const [lo, hi] = wilson(9, 9);
    expect(lo).toBeCloseTo(0.701, 3);
    expect(hi).toBe(1);
    expect(wilson(0, 4)[1]).toBeCloseTo(0.49, 2);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});
