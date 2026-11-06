/**
 * Claims-check corpus: the fail-closed contrast.
 *
 * Source verdicts: eval/results/support-judgments-frozen-live.jsonl (13
 * recorded Spark support verdicts, read-only), mapped to the strict judge
 * shape {grade, missing_qualifier}. Each is then corrupted with every
 * corruption below to model a judge that answered badly.
 *
 * Two checkers see the same corpus:
 *   - verifyClaims (Second Seat, @second-seat/core): unreadable -> blocked.
 *   - failOpenReference: a reference model of the behaviour documented at
 *     Meta legal-agent-workshop agent/verification/verify_claims.py L50-54
 *     (commit 2a8efc8): when the judgement cannot be read, the check passes.
 *     Written here from that description only; no workshop code is copied
 *     (the workshop has no LICENSE).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyClaims } from "@second-seat/core";
import { REPO_ROOT } from "./mutants.mjs";

export const VERDICTS_PATH = "eval/results/support-judgments-frozen-live.jsonl";

export function loadVerdicts() {
  return readFileSync(join(REPO_ROOT, VERDICTS_PATH), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l))
    .map((v) => ({ entryId: v.entryId, strict: { grade: v.grade, missing_qualifier: v.missingQualifier ?? null } }));
}

/** Ways a judge output can be unreadable or off-contract. Each maps strict -> raw. */
export const CORRUPTIONS = [
  { id: "truncated", make: (s) => JSON.stringify(s).slice(0, Math.floor(JSON.stringify(s).length / 2)) },
  { id: "prose_wrapped", make: (s) => `Here is my verdict: ${JSON.stringify(s)}` },
  { id: "code_fenced", make: (s) => `\`\`\`json\n${JSON.stringify(s)}\n\`\`\`` },
  { id: "empty", make: () => "" },
  { id: "null_literal", make: () => "null" },
  { id: "array_wrapped", make: (s) => JSON.stringify([s]) },
  { id: "grade_wrong_case", make: (s) => JSON.stringify({ ...s, grade: s.grade.toUpperCase() }) },
  { id: "grade_unknown", make: (s) => JSON.stringify({ ...s, grade: "mostly_supported" }) },
  { id: "missing_key", make: (s) => JSON.stringify({ grade: s.grade }) },
  { id: "extra_key", make: (s) => JSON.stringify({ ...s, confidence: 0.9 }) },
  { id: "qualifier_wrong_type", make: (s) => JSON.stringify({ ...s, missing_qualifier: 0 }) },
];

/**
 * Fail-open reference: read the grade if possible; block only on a readable
 * "partial" / "unsupported"; anything unreadable or missing passes.
 */
export function failOpenReference(entryIds, verdicts) {
  const feedback = [];
  for (const id of entryIds) {
    let v = verdicts?.[id];
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        continue; // unreadable -> does not block
      }
    }
    const grade = v !== null && typeof v === "object" ? v.grade : undefined;
    if (grade === "partial" || grade === "unsupported") feedback.push(`${id}: ${grade}`);
  }
  return { passed: feedback.length === 0, feedback };
}

/** Build every claims case: well-formed, corrupted, and missing-verdict. */
export function claimsCases(verdicts = loadVerdicts()) {
  const cases = [];
  for (const v of verdicts) {
    cases.push({ kind: "well_formed", corruption: null, entryId: v.entryId, grade: v.strict.grade, verdicts: { [v.entryId]: JSON.stringify(v.strict) } });
    for (const c of CORRUPTIONS) {
      cases.push({ kind: "malformed", corruption: c.id, entryId: v.entryId, grade: v.strict.grade, verdicts: { [v.entryId]: c.make(v.strict) } });
    }
    cases.push({ kind: "missing_verdict", corruption: "missing_verdict", entryId: v.entryId, grade: v.strict.grade, verdicts: {} });
  }
  return cases;
}

/** Run one case through both checkers. */
export function runClaimsCase(c) {
  const closed = verifyClaims({ entryIds: [c.entryId] }, { verdicts: c.verdicts });
  const open = failOpenReference([c.entryId], c.verdicts);
  return { ...c, failClosedBlocked: !closed.passed, failOpenBlocked: !open.passed, feedback: closed.feedback };
}
