/**
 * Outgoing safeguard: blocks commitment language (accepting offers,
 * approving purchases) while staying negation-safe.
 *
 * Rule: the bot drafts replies, but only a person may commit Bridgett to
 * an offer or a purchase. Anything that reads as acceptance or as an
 * instruction to proceed is blocked; negated or neutral text stays allowed.
 *
 * Commitment detection is advisory: a clause-scoped heuristic, not a
 * guarantee. A person reviews every draft before it is copied or sent.
 */

export interface ScreenResult {
  allowed: boolean;
  reason?: string;
}

export type IncomingKind = "offer" | "request" | "neutral";

export interface IncomingClassification {
  kind: IncomingKind;
}

/** Words that negate a nearby acceptance, so the text must stay allowed. */
const NEGATION_PATTERN =
  /n't\b|n’t\b|\b(can\s+not|cannot|will\s+not|do\s+not|does\s+not|did\s+not|would\s+not|could\s+not|never|unable|refus\w*|declin\w*|reject\w*)\b/i;

/** Bare acceptance: "we accept", "I accept", "accepted", "accept your offer". */
const ACCEPT_PATTERN = /\b(we|i)\s+accept\b|\baccepted\b|\baccept\s+(your|the|this|that)\s+offer\b/i;

/** Approve + proceed in either order: "Approved. Please proceed ...". */
const APPROVE_PROCEED_PATTERN =
  /approv\w*[\s\S]*proceed|proceed[\s\S]*approv\w*/i;

/** "go ahead with the purchase/order/payment" and "proceed with the ...". */
const GO_AHEAD_PATTERN =
  /\bgo\s+ahead\s+with\s+the\s+(purchase|order|payment)\b|\bproceed\s+with\s+the\s+(purchase|order|payment)\b/i;

/**
 * A clause is blocked only when it matches a commitment pattern with no
 * negation before the commitment verb within the same clause. A negation
 * in one clause never clears a commitment in another clause.
 */
function clauseBlockReason(clause: string): string | null {
  const checks: [RegExp, string][] = [
    [GO_AHEAD_PATTERN, "blocked: instruction to proceed with a purchase/order/payment"],
    [APPROVE_PROCEED_PATTERN, "blocked: approve combined with proceed"],
    [ACCEPT_PATTERN, "blocked: acceptance language"],
  ];
  for (const [pattern, reason] of checks) {
    const match = pattern.exec(clause);
    if (match?.index !== undefined) {
      const before = clause.slice(0, match.index);
      if (!NEGATION_PATTERN.test(before)) {
        return reason;
      }
    }
  }
  return null;
}

/**
 * Screen a draft outgoing message. Returns `{ allowed: false }` with a
 * reason when a clause commits to an offer or a purchase; otherwise
 * `{ allowed: true }`. Negation only clears the clause it appears in
 * ("can't accept ..." is allowed, but "I cannot attend tomorrow.
 * I accept your offer." is blocked). Advisory heuristic: a person reviews.
 */
export function screenOutgoing(text: string): ScreenResult {
  const input = text.trim();
  if (input.length === 0) {
    return { allowed: true, reason: "empty text carries no commitment" };
  }
  const clauses = input.split(/[.!?;]+|,\s*but\b/i);
  for (const clause of clauses) {
    const reason = clauseBlockReason(clause);
    if (reason !== null) {
      return { allowed: false, reason };
    }
  }
  // Driver fix: "approved" and "proceed" may sit in different clauses
  // ("The purchase is approved; kindly proceed."). Block when some
  // un-negated clause approves and some un-negated clause says proceed.
  const unNegated = (word: RegExp) =>
    clauses.some((c) => {
      const m = word.exec(c);
      return m !== null && !NEGATION_PATTERN.test(c.slice(0, m.index));
    });
  if (unNegated(/approv\w*/i) && unNegated(/\bproceed\b/i)) {
    return { allowed: false, reason: "blocked: approve combined with proceed" };
  }
  return { allowed: true };
}

const OFFER_PATTERN = /\b(offer|propos\w*|deal\b|terms\b|bid\b)\b/i;
const REQUEST_PATTERN = /\?|\bplease\b|\bcould\s+you\b|\bwould\s+you\b|\bcan\s+you\b|\bwill\s+you\b/i;

/** Classify an incoming transcript line as an offer, a request, or neutral. */
export function classifyIncoming(text: string): IncomingClassification {
  if (OFFER_PATTERN.test(text)) {
    return { kind: "offer" };
  }
  if (REQUEST_PATTERN.test(text)) {
    return { kind: "request" };
  }
  return { kind: "neutral" };
}
