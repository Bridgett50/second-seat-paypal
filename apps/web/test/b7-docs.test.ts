// B7 acceptance: documentation claims match the implementation. Pure file reads; no network.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const rd = (p: string) => readFileSync(resolve(root, p), "utf8");
const README = rd("docs/engineering-log.md");
const VIDEO = rd("docs/submission/video-script.md");
const FIELDS = rd("docs/submission/submission-fields.md");
const RULES = rd("docs/submission/rules-check.md");
const XPOST = rd("docs/submission/x-post-draft.md");
const PLAN = rd("docs/rescue-plan.md");
const ALL = [README, VIDEO, FIELDS, RULES, XPOST].join("\n");

describe("B7 claims reconciliation", () => {
  it("B7-1 rescue plan restores A1-A3 criteria", () => {
    for (const a of ["A1", "A2", "A3"]) {
      const m = PLAN.match(new RegExp(`PR ${a} —[^\\n]*\\n([\\s\\S]*?)(?=\\nPR A\\d —)`));
      expect(m, `section PR ${a}`).toBeTruthy();
      expect(m![1]).toMatch(/Acceptance (tests|criteria):\n(- .+\n){2,}/);
    }
    expect(PLAN).toMatch(/#35/); expect(PLAN).toMatch(/#36/); expect(PLAN).toMatch(/#37/);
  });
  it("B7-2 no 'implementation complete'; acceptance-status table present", () => {
    expect(ALL).not.toMatch(/implementation:?\s*complete/i);
    expect(README).toMatch(/\|\s*PR\s*\|[^\n]*Implementation[^\n]*Offline[^\n]*Live[^\n]*Partner/i);
    for (const id of ["A1","A2","A3","A4","A5","A6","A7","A8","A9","B1","B2","B3","B4","B5","B6","B7","B8"])
      expect(README, id).toMatch(new RegExp(`^\\|\\s*${id}\\b`, "m"));
  });
  it("B7-3 offline narration does not attribute simulated output to Glimmer/Spark", () => {
    const rows = VIDEO.split("\n").filter((l) => l.startsWith("| 0:") || l.startsWith("| 1:"));
    for (const r of rows) {
      const narr = r.split("|").slice(-2, -1)[0] ?? "";
      expect(narr, r).not.toMatch(/Glimmer|Spark/);
    }
    expect(README).not.toMatch(/Glimmer redacts the PII locally/);
  });
  it("B7-4 pressure claims match connected implementation (review gates Copy)", () => {
    expect(README).toMatch(/pressure[^\n]*review[^\n]*Copy|Copy[^\n]*pressure[^\n]*review/i);
    expect(ALL).not.toMatch(/pressure gets held/i);
  });
  it("B7-5 no 'cannot leave'; precise Copy-button behavior", () => {
    expect(ALL).not.toMatch(/cannot leave/i);
    expect(README).toMatch(/#btn-copy/);
    expect(README).toMatch(/clipboard/i);
  });
  it("B7-6 Modal hosting described; no on-device/local redaction implication", () => {
    expect(ALL).not.toMatch(/on[- ]device|redacts?[^.\n]*locally/i);
    expect(README).toMatch(/Glimmer[^\n]*Modal/);
  });
  it("B7-7 historical Glimmer failures visible and artifacts unchanged", () => {
    for (const s of ["6/8", "18/29", "18/39", "complete: false", "invalid JSON"]) expect(README).toContain(s);
    const h = (p: string) => createHash("sha256").update(readFileSync(resolve(root, p))).digest("hex");
    // rescore.json content pinned except `generatedAt`, which the pre-existing bot suite rewrites on every run.
    const j = JSON.parse(readFileSync(resolve(root, "services/bot/fixtures/glimmer-run/rescore.json"), "utf8"));
    delete j.generatedAt;
    expect(createHash("sha256").update(JSON.stringify(j)).digest("hex")).toBe("99629cbebba3c9ea421442f9702424ddcfa51a7405e84f86293ac617ab5b5c34");
    expect(h("services/bot/fixtures/glimmer-run/eval-summary.json")).toBe("b293e4ce4250aa79d0ba10e2739d403cfb7eabf4f791e319895757594006da84");
  });
  it("B7-8 test counts link tested commit and CI run", () => {
    const line = README.split("\n").find((l) => /pnpm -r test/.test(l) && /core \d+/.test(l))!;
    expect(line).toBeTruthy();
    expect(line).toMatch(/github\.com\/Bridgett50\/second-seat-hackathon\/commit\/[0-9a-f]{40}/);
    expect(line).toMatch(/github\.com\/Bridgett50\/second-seat-hackathon\/actions\/runs\/\d+/);
  });
  it("B7-9 spending controls implemented, no hard billing guarantee", () => {
    expect(README).toMatch(/costGuard/);
    expect(README).toMatch(/not a (hard )?billing (guarantee|limit)/i);
  });
  it("B7-10 exact local startup command and /session route", () => {
    expect(README).toContain("pnpm --filter @second-seat/web serve");
    expect(README).toContain("http://localhost:4173/session");
  });
  it("B7-11 founder story is supplied; observations and video URLs stay pending", () => {
    expect(README).toMatch(/Founder story: done/);
    expect(README).toMatch(/User observations: PENDING/);
    expect(README).toMatch(/Video URLs: PENDING/);
  });
});
