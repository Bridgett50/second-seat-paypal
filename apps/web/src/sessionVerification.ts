/**
 * Session-facing verification. Hard failures stop the flow. Heuristic
 * warnings escalate to the owner and do not block. Feedback from the
 * checks is not copied into the view: the message is a fixed line.
 */
import { verifyBrief, verifyClaims, verifyRedaction } from "@second-seat/core";
import { findResidualPII } from "@second-seat/bot/dist/src/private/gate.js";

export const VERIFICATION_BLOCK_MESSAGE =
  "Needs owner review. A verification check blocked this step.";

export const VERIFICATION_WARN_MESSAGE =
  "Needs owner review. The hard checks passed, and some lines are flagged for you.";

export interface VerificationCheck {
  id: "redaction" | "brief" | "claims";
  label: string;
  result: "passed" | "blocked" | "not_run" | "escalated";
}

export interface SessionVerification {
  status: "verified" | "needs_owner_review" | "structural" | "redaction_checked";
  blocked: boolean;
  title: "Verified" | "Needs owner review" | "Structural checks passed" | "Redaction check passed";
  message: string;
  checks: VerificationCheck[];
}

export interface RedactionSpanInput {
  start: number;
  end: number;
  label: string;
}

const EMPTY_REGION = null;

function citation(segmentId: string) {
  return { kind: "segment" as const, segmentId, frameId: null, region: EMPTY_REGION };
}

/** Schema-shaped brief for the offline fixture path. No model text is added. */
export function offlineEvidenceBrief(
  meetingId: string,
  entries: { kind: string; text: string; segmentIds: string[] }[],
): unknown {
  const built = entries.map((entry, index) => {
    const category =
      entry.kind === "question"
        ? "unresolved_question"
        : entry.kind === "commitment"
          ? "action_item"
          : "decision";
    const flags = entry.segmentIds.length === 0 ? (["missing_source"] as const) : [];
    return {
      id: `e${index + 1}`,
      category,
      text: entry.text,
      citations: entry.segmentIds.map(citation),
      requester: null,
      assignee: null,
      acceptance: category === "action_item" ? "not_established" : null,
      speaker: null,
      flags: [...flags],
    };
  });
  return {
    meetingId,
    model: "offline-fixture",
    promptVersion: "offline-v1",
    settings: { fixtureMode: true, maxCostUsdPerDay: null },
    entries: built,
    flagged: built.filter((entry) => entry.flags.length > 0).map((entry) => entry.id),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function view(
  blocked: boolean,
  escalated: boolean,
  checks: VerificationCheck[],
): SessionVerification {
  const needsReview = blocked || escalated;
  return {
    status: needsReview ? "needs_owner_review" : "verified",
    blocked,
    title: needsReview ? "Needs owner review" : "Verified",
    message: blocked ? VERIFICATION_BLOCK_MESSAGE : escalated ? VERIFICATION_WARN_MESSAGE : "",
    checks,
  };
}

export function verifyApprovedRedaction(
  rawText: string,
  spans: RedactionSpanInput[],
  maskedText: string,
): SessionVerification {
  const result = verifyRedaction(
    { rawText, spans, residualScan: findResidualPII },
    { maskedText },
  );
  const checks: VerificationCheck[] = [
    { id: "redaction", label: "Redaction", result: result.passed ? "passed" : "blocked" },
    { id: "brief", label: "Brief", result: "not_run" },
    { id: "claims", label: "Claims", result: "not_run" },
  ];
  if (!result.passed) return view(true, false, checks);
  return {
    status: "redaction_checked",
    blocked: false,
    title: "Redaction check passed",
    message: "Brief and claim support not checked.",
    checks,
  };
}

export function verifySessionBrief(
  work: unknown,
  segments: { id: string; text: string }[],
  meetingId: string,
  verdicts: Record<string, unknown> | null | undefined,
): SessionVerification {
  const brief = verifyBrief(
    {
      segments: segments.map((segment) => ({ id: segment.id, speaker: "", text: segment.text })),
      frames: [],
      expectedMeetingId: meetingId,
    },
    work,
  );
  const checks: VerificationCheck[] = [
    { id: "redaction", label: "Redaction", result: "passed" },
    {
      id: "brief",
      label: "Brief",
      result: brief.passed ? (brief.escalations.length > 0 ? "escalated" : "passed") : "blocked",
    },
  ];
  if (!brief.passed) {
    checks.push({ id: "claims", label: "Claims", result: "not_run" });
    return view(true, false, checks);
  }
  const entryIds = entryIdsOf(work);
  const claimsRan = verdicts !== null && verdicts !== undefined && entryIds.length > 0;
  if (!claimsRan) {
    checks.push({ id: "claims", label: "Claims", result: "not_run" });
    if (brief.escalations.length > 0) {
      return {
        status: "needs_owner_review",
        blocked: false,
        title: "Needs owner review",
        message: `${VERIFICATION_WARN_MESSAGE} Claim support not checked.`,
        checks,
      };
    }
    return {
      status: "structural",
      blocked: false,
      title: "Structural checks passed",
      message: "Claim support not checked.",
      checks,
    };
  }
  const claims = verifyClaims({ entryIds }, { verdicts });
  checks.push({
    id: "claims",
    label: "Claims",
    result: claims.passed ? "passed" : "blocked",
  });
  return view(!claims.passed, brief.escalations.length > 0, checks);
}

function entryIdsOf(work: unknown): string[] {
  if (work === null || typeof work !== "object" || !("entries" in work)) return [];
  const entries = (work as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => (entry !== null && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string"
      ? (entry as { id: string }).id
      : ""))
    .filter((id) => id !== "");
}
