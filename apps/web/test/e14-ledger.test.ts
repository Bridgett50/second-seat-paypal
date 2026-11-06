// E14 ledger: docs record draft fixes E10 (#76, F1 redact temp), E11 (#77, F2 SAM parser),
// E12 (#78, F3 prompt-cache key), E13 (#79, F4 guardrails) as pending review/merge.
// Pure file reads; no network, no models, no sealed data.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const rd = (p: string) => readFileSync(resolve(root, p), "utf8");
const README = rd("docs/engineering-log.md");
const READINESS = rd("docs/release/c9-readiness.md");
const RUNBOOK = rd("docs/runbook-holdout-run.md");
const B9 = rd("docs/release/b9-evidence-run-prep.md");
const FREEZE = rd("eval/results/prompt-freeze.md");
const TWO = [README, READINESS].join("\n");

describe("E14 ledger draft fixes", () => {
  it("E14-1 README and c9-readiness each mention #76, #77, #78, #79 and draft", () => {
    for (const f of [README, READINESS]) {
      for (const pr of ["#76", "#77", "#78", "#79"]) expect(f, pr).toContain(pr);
      expect(f).toMatch(/draft/i);
    }
  });

  it("E14-2 no stale decoding; each doc says temperature 0.0; README sampling line cites E10/#76 and vllm.md, never deploy.md:243", () => {
    for (const f of [README, RUNBOOK, B9]) {
      expect(f).not.toContain("temperature 1.0");
      expect(f).not.toContain("top_k 64");
      expect(f).not.toMatch(/never greedy/);
      expect(f).toMatch(/temperature 0(\.0)?/);
    }
    expect(README).not.toContain("deploy.md:243");
    const line =
      README.split("\n").find(
        (l) =>
          /temperature 0(\.0)?/.test(l) &&
          /E10|#76/.test(l) &&
          /vllm\.md/.test(l),
      ) ?? "";
    expect(line).not.toBe("");
    expect(line).toMatch(/temperature 0(\.0)?/);
  });

  it("E14-3 runbook and b9 prep say a prepared holdout config must be re-frozen", () => {
    for (const f of [RUNBOOK, B9]) expect(f).toMatch(/re-?freez/i);
  });

  it("E14-4 prompt-freeze redact temperature is 0.0 with no top_p 0.95 row", () => {
    expect(FREEZE).toMatch(/\|\s*redact temperature\s*\|\s*0\.0\s*\|/);
    expect(FREEZE).not.toMatch(/\|\s*redact temperature\s*\|\s*1\.0\s*\|/);
    expect(FREEZE).not.toContain("| redact top_p | 0.95 |");
  });

  it("E14-5 README names prompt_cache_key, include_confidence, .agents/AGENTS.md; hero-chain.mjs still has its own parser", () => {
    expect(README).toContain("prompt_cache_key");
    expect(README).toContain("include_confidence");
    expect(README).toContain(".agents/AGENTS.md");
    expect(TWO).toContain("hero-chain.mjs");
    expect(TWO).toMatch(/own parser|still[^.\n]*parser|parser[^.\n]*still/i);
  });

  it("E14-6 no file says E10..E13 or #76..#79 are merged", () => {
    for (const e of ["E10", "E11", "E12", "E13"]) {
      expect(TWO).not.toMatch(new RegExp(`${e}[^.\\n]*\\bmerged\\b`, "i"));
      expect(TWO).not.toMatch(new RegExp(`\\bmerged\\b[^.\\n]*${e}`, "i"));
    }
    for (const pr of ["#76", "#77", "#78", "#79"]) {
      const n = pr.slice(1);
      expect(TWO).not.toMatch(new RegExp(`#${n}[^.\\n]*\\bmerged\\b`, "i"));
      expect(TWO).not.toMatch(new RegExp(`\\bmerged\\b[^.\\n]*#${n}`, "i"));
    }
  });
});
