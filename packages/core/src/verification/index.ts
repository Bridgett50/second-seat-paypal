export type { VerificationResult, RunVerification } from "./types.js";
export { verifyBrief } from "./verifyBrief.js";
export type { BriefVerification, BriefVerificationContext, Escalation } from "./verifyBrief.js";
export { verifyClaims, parseJudgeOutput } from "./verifyClaims.js";
export type {
  ClaimsVerificationContext,
  ClaimsVerificationWork,
  ParsedJudgeOutput,
  SupportGrade,
} from "./verifyClaims.js";
export { normalizePiiText, preparePiiScanText } from "./normalize.js";
export { verifyRedaction } from "./verifyRedaction.js";
export type {
  RedactionSpan,
  RedactionVerification,
  RedactionVerificationContext,
  RedactionVerificationWork,
  ResidualScan,
} from "./verifyRedaction.js";

/** One row of VERIFICATION.md (Meta's When / File / Check / Built by / On failure columns). */
export interface VerificationPoint {
  when: string;
  file: string;
  check: "verifyRedaction" | "verifyBrief" | "verifyClaims";
  builtBy: string;
  onFailure: string;
}

/** The fixed points, in pipeline order. VERIFICATION.md mirrors this list (a test keeps them in sync). */
export const VERIFICATION_POINTS: readonly VerificationPoint[] = [
  {
    when: "After the owner reviews the redaction preview, before analysis is dispatched",
    file: "packages/core/src/verification/verifyRedaction.ts",
    check: "verifyRedaction",
    builtBy: "Second Seat (pattern adapted from Meta legal-agent-workshop)",
    onFailure: "Blocked: the preview can already be on screen; analysis dispatch does not proceed; feedback names span index and label",
  },
  {
    when: "After the brief is generated, before it is presented as source-backed",
    file: "packages/core/src/verification/verifyBrief.ts",
    check: "verifyBrief",
    builtBy: "Second Seat (pattern adapted from Meta legal-agent-workshop)",
    onFailure: "Blocked on structure or dangling citations; heuristic findings escalate the entry to the owner",
  },
  {
    when: "After the support judge grades each entry, before an entry is marked verified",
    file: "packages/core/src/verification/verifyClaims.ts",
    check: "verifyClaims",
    builtBy: "Second Seat (pattern adapted from Meta legal-agent-workshop)",
    onFailure: "Blocked: partial/unsupported, missing, or unreadable verdicts (fail-closed)",
  },
];
