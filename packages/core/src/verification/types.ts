/**
 * Verification-layer contract.
 *
 * Pattern adapted from Meta's legal-agent-workshop, Agents 102 "Best
 * Practices for Verifiable Agents" (agent/VERIFICATION.md,
 * agent/verification/*; https://github.com/meta-models/legal-agent-workshop
 * at 2a8efc8): every check has ONE entry point,
 * `runVerification(ctx, work) -> { passed, feedback }`, and is called at a
 * fixed point so the model cannot skip it. Independent TypeScript
 * implementation; no workshop code or text is copied (see VERIFICATION.md).
 *
 * Second Seat difference: every check here FAILS CLOSED. Anything the
 * check cannot read (malformed input, a missing scanner, a missing
 * verdict) is a refusal with feedback, never a silent pass.
 */

/** Result of one verification check. `passed` is true only when `feedback` is empty. */
export interface VerificationResult {
  passed: boolean;
  /** One line per problem, each naming the item and the rule that fired. Never echoes raw PII. */
  feedback: string[];
}

/** One check: a pure function of its context and the work under review. */
export type RunVerification<Ctx, Work, R extends VerificationResult = VerificationResult> = (
  ctx: Ctx,
  work: Work,
) => R;

/** Build a result from a feedback list (passed iff the list is empty). */
export function result(feedback: string[]): VerificationResult {
  return { passed: feedback.length === 0, feedback };
}
