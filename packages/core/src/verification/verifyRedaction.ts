/**
 * verifyRedaction: fail-closed check that a redaction pass actually
 * removed what it said it found, run before the owner's approval preview.
 *
 * Blocks when: no residual-PII scanner is supplied (core has no
 * dependency on the bot, so the scanner is injected, e.g. the privacy
 * gate's findResidualPII); a span is out of range; the original text of a
 * span still appears in the masked text; the scanner reports a hit; or
 * the scanner throws. Feedback names span index and label only and never
 * echoes the PII. A pass never replaces the owner's approval:
 * `ownerReviewRequired` is always true.
 *
 * Pattern adapted from Meta's legal-agent-workshop
 * agent/verification/verify_redaction.py; see VERIFICATION.md.
 * Independent implementation.
 */
import { normalizePiiText } from "./normalize.js";
import type { VerificationResult } from "./types.js";

export interface RedactionSpan {
  start: number;
  end: number;
  label: string;
}

/** Returns the kind of residual PII found, or null when clean. */
export type ResidualScan = (maskedText: string, rawNames: string[]) => string | null;

export interface RedactionVerificationContext {
  rawText: string;
  spans: RedactionSpan[];
  residualScan?: ResidualScan;
}

export interface RedactionVerificationWork {
  maskedText: string;
}

export interface RedactionVerification extends VerificationResult {
  /** Always true: verification never stands in for the owner's approval. */
  ownerReviewRequired: true;
}

const MIN_SURVIVOR_LENGTH = 2;

export function verifyRedaction(
  ctx: RedactionVerificationContext,
  work: RedactionVerificationWork,
): RedactionVerification {
  const done = (feedback: string[]): RedactionVerification => ({
    passed: feedback.length === 0,
    feedback,
    ownerReviewRequired: true,
  });
  if (typeof work?.maskedText !== "string" || typeof ctx?.rawText !== "string" || !Array.isArray(ctx.spans)) {
    return done(["redaction: input unreadable: blocked (fail-closed)"]);
  }
  if (typeof ctx.residualScan !== "function") {
    return done(["redaction: no residual-PII scanner configured: blocked (fail-closed)"]);
  }
  const feedback: string[] = [];
  const names: string[] = [];
  ctx.spans.forEach((s, i) => {
    const valid =
      Number.isInteger(s?.start) && Number.isInteger(s?.end) && s.start >= 0 && s.end > s.start && s.end <= ctx.rawText.length;
    if (!valid) {
      feedback.push(`span ${i} (${String(s?.label)}): invalid range`);
      return;
    }
    const original = ctx.rawText.slice(s.start, s.end).trim();
    if (s.label === "person" && original !== "") names.push(original);
    const folded = normalizePiiText(original);
    // Case, format characters, and collapsed whitespace still count as
    // the same span text. Feedback names the span, never the text.
    if (folded.length >= MIN_SURVIVOR_LENGTH && normalizePiiText(work.maskedText).includes(folded)) {
      feedback.push(`span ${i} (${s.label}): original text still present in masked text`);
    }
  });
  try {
    const hit = ctx.residualScan(work.maskedText, names);
    if (hit !== null) feedback.push(`redaction: residual ${hit} detected in masked text`);
  } catch {
    feedback.push("redaction: residual-PII scanner failed: blocked (fail-closed)");
  }
  return done(feedback);
}
