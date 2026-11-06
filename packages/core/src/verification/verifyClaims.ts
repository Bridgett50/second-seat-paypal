/**
 * verifyClaims: fail-closed gate over a support judge's raw output.
 *
 * The judge (model or fixture) grades each entry against its cited spans
 * as supported | partial | unsupported with an optional missing
 * qualifier. This check reads the judge's RAW output and blocks unless
 * every entry has a readable verdict of `supported`.
 *
 * Deliberate contrast with the pattern it adapts: Meta's
 * legal-agent-workshop agent/verification/verify_claims.py (2a8efc8,
 * L50-54) treats an unreadable judgement as a pass ("never blocks the
 * memo"). Here an unreadable, missing, or off-schema verdict is a
 * refusal: a judge that fails to answer cannot vouch for a claim.
 * Independent implementation; see VERIFICATION.md.
 */
import { result, type VerificationResult } from "./types.js";

export type SupportGrade = "supported" | "partial" | "unsupported";

export type ParsedJudgeOutput =
  | { ok: true; grade: SupportGrade; missingQualifier: string | null }
  | { ok: false; reason: string };

export interface ClaimsVerificationContext {
  /** Every entry that must carry a verdict. */
  entryIds: string[];
}

export interface ClaimsVerificationWork {
  /** entryId -> raw judge output: the JSON text the judge returned, or its parsed object. */
  verdicts: Record<string, unknown>;
}

const GRADES: readonly SupportGrade[] = ["supported", "partial", "unsupported"];
const KEYS = ["grade", "missing_qualifier"];

/** Parse one raw judge output in the strict support shape {grade, missing_qualifier}. Never throws. */
export function parseJudgeOutput(raw: unknown): ParsedJudgeOutput {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return { ok: false, reason: "empty output" };
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "not valid JSON" };
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "not a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (const k of KEYS) if (!keys.includes(k)) return { ok: false, reason: `missing key ${k}` };
  const extra = keys.filter((k) => !KEYS.includes(k));
  if (extra.length > 0) return { ok: false, reason: `unexpected key ${extra[0]}` };
  if (!GRADES.includes(obj["grade"] as SupportGrade)) return { ok: false, reason: "grade not in supported|partial|unsupported" };
  const q = obj["missing_qualifier"];
  if (q !== null && typeof q !== "string") return { ok: false, reason: "missing_qualifier not a string or null" };
  return { ok: true, grade: obj["grade"] as SupportGrade, missingQualifier: q as string | null };
}

export function verifyClaims(ctx: ClaimsVerificationContext, work: ClaimsVerificationWork): VerificationResult {
  if (ctx == null || !Array.isArray(ctx.entryIds)) {
    return result(["claims: entry id list unreadable: blocked (fail-closed)"]);
  }
  if (ctx.entryIds.length === 0) {
    return result(["claims: no entries to verify: blocked (fail-closed)"]);
  }
  const verdicts = work?.verdicts;
  if (verdicts === null || typeof verdicts !== "object" || Array.isArray(verdicts)) {
    return result(["claims: verdict map unreadable: blocked (fail-closed)"]);
  }
  const feedback: string[] = [];
  const wanted = new Set(ctx.entryIds);
  for (const id of ctx.entryIds) {
    if (!Object.prototype.hasOwnProperty.call(verdicts, id)) {
      feedback.push(`entry ${id}: no judge verdict: blocked (fail-closed)`);
      continue;
    }
    const parsed = parseJudgeOutput(verdicts[id]);
    if (!parsed.ok) {
      feedback.push(`entry ${id}: judge output unreadable (${parsed.reason}): blocked (fail-closed)`);
    } else if (parsed.grade === "partial") {
      feedback.push(`entry ${id}: partially supported; a missing qualifier was reported`);
    } else if (parsed.grade === "unsupported") {
      feedback.push(`entry ${id}: not supported by its cited spans`);
    } else if (parsed.missingQualifier !== null) {
      feedback.push(`entry ${id}: supported grade contradicts a missing qualifier`);
    }
  }
  for (const id of Object.keys(verdicts)) {
    if (!wanted.has(id)) feedback.push(`verdict ${id}: no such entry`);
  }
  return result(feedback);
}
