export const SESSION_POLICY_VERSION = "sp-v1";

type Restriction = "no-date-disclosure" | null;

interface ScopeState {
  generation: number;
  restriction: Restriction;
  clarificationNeeded: boolean;
}

const scopes = new Map<string, ScopeState>();
const heldUsed = new Set<string>();
let holdSeq = 0;
type HeldRecord = Readonly<{
  ownerId: string;
  meetingId: string;
  generationAtHold: number;
  candidate: string | Readonly<{ subject: string; body: string }>;
  kind: OutgoingKind;
}>;
const heldRecords = new Map<string, HeldRecord>();

function scopeKey(ownerId: string, meetingId: string): string {
  return `${ownerId}\u001F${meetingId}`;
}

function getScope(ownerId: string, meetingId: string): ScopeState {
  const k = scopeKey(ownerId, meetingId);
  let s = scopes.get(k);
  if (s === undefined) {
    s = { generation: 0, restriction: null, clarificationNeeded: false };
    scopes.set(k, s);
  }
  return s;
}

export function clearPolicy(ownerId: string, meetingId: string): { version: string; generation: number } {
  const s = getScope(ownerId, meetingId);
  s.restriction = null;
  s.clarificationNeeded = false;
  s.generation += 1;
  return { version: SESSION_POLICY_VERSION, generation: s.generation };
}

export function resetAllPolicyState(): void {
  scopes.clear();
  heldUsed.clear();
  heldRecords.clear();
  holdSeq = 0;
}

export function getPolicyGeneration(ownerId: string, meetingId: string): number {
  return scopes.get(scopeKey(ownerId, meetingId))?.generation ?? 0;
}

export function createMeetingPolicyRecorder(ownerId: string, meetingId: string): { record(text: string): { status: GuidanceStatus; generation: number } } {
  return {
    record(text: string): { status: GuidanceStatus; generation: number } {
      const res = submitGuidance(ownerId, meetingId, text);
      return { status: res.status, generation: res.generation };
    },
  };
}

// --- guidance interpretation ---

const APPLIED_PATTERNS: RegExp[] = [
  /do not share dates/i,
  /do not share any dates/i,
  /not to share dates/i,
  /please do not share any dates/i,
  /keep dates out/i,
  /don'?t mention when/i,
  /do not mention when/i,
  /no timing details/i,
  /don'?t share dates/i,
  /i will confirm.*date/i,
  /i'll handle scheduling/i,
];

function hasDateWord(text: string): boolean {
  return /\b(date|dates|timing|when|schedule|scheduling|calendar|month|week|quarter|year)\b/i.test(text);
}

export type GuidanceStatus = "applied" | "needs-clarification" | "not-applied";

export interface SubmitResult {
  status: GuidanceStatus;
  version: string;
  generation: number;
  restriction?: Restriction;
  clarificationQuestion?: string;
}

function needsClarificationHeuristic(lower: string): boolean {
  if (/\b(be careful|careful about|maybe|unsure|timing)\b/i.test(lower) && hasDateWord(lower)) return true;
  if (hasDateWord(lower)) return true;
  return false;
}

export function submitGuidance(ownerId: string, meetingId: string, text: string): SubmitResult {
  const s = getScope(ownerId, meetingId);
  s.generation += 1;
  const lower = text.toLowerCase();

  for (const re of APPLIED_PATTERNS) {
    if (re.test(text)) {
      s.restriction = "no-date-disclosure";
      s.clarificationNeeded = false;
      return {
        status: "applied",
        version: SESSION_POLICY_VERSION,
        generation: s.generation,
        restriction: "no-date-disclosure",
      };
    }
  }

  // direct fallback for phrases not in list but clearly restrictive
  if (/\b(do not|don't|dont|never|no dates|not share)\b/i.test(text) && hasDateWord(text)) {
    s.restriction = "no-date-disclosure";
    s.clarificationNeeded = false;
    return {
      status: "applied",
      version: SESSION_POLICY_VERSION,
      generation: s.generation,
      restriction: "no-date-disclosure",
    };
  }

  if (needsClarificationHeuristic(lower)) {
    s.clarificationNeeded = true;
    // keep existing restriction if any, but mark clarification needed
    return {
      status: "needs-clarification",
      version: SESSION_POLICY_VERSION,
      generation: s.generation,
      clarificationQuestion: "Could you clarify which dates or timing details should be withheld and for how long?",
    };
  }

  return {
    status: "not-applied",
    version: SESSION_POLICY_VERSION,
    generation: s.generation,
  };
}

// --- outgoing check ---

const MONTHS_FULL = "January|February|March|April|May|June|July|August|September|October|November|December";
const MONTHS_ABBR = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const MONTHS = `${MONTHS_FULL}|${MONTHS_ABBR}`;

const MONTH_STANDALONE_RE = new RegExp(`\\b(?:${MONTHS})\\b\\.?`, "gi");
const MONTH_WITH_DAY_RE = new RegExp(`\\b(?:${MONTHS})\\b\\.?\\s*\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi");
const DAY_OF_MONTH_RE = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+of\\s+(?:${MONTHS})\\b`, "gi");

const NUMERIC_DATE_RE = /\b\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\b/g;
const ISO_DATE_RE = /\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b/g;

const WEEKDAY_FULL = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
const WEEKDAY_ABBR = "Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun";
const WEEKDAY_RE = new RegExp(`\\b(?:${WEEKDAY_FULL}|${WEEKDAY_ABBR})\\b`, "gi");
const WEEKDAY_WITH_TIME_RE = new RegExp(`\\b(?:${WEEKDAY_FULL}|${WEEKDAY_ABBR})\\b\\s+(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?`, "gi");

const CLOCK_TIME_RE1 = /\b\d{1,2}:\d{2}\b/g;
const CLOCK_TIME_RE2 = /\b\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)\b/gi;
const CLOCK_TIME_RE3 = /\b\d{1,2}:\d{2}\s*(?:am|pm|a\.m\.|p\.m\.)\b/gi;

const RELATIVE_RE = /\b(?:today|tonight|tomorrow|yesterday)\b/gi;
const RELATIVE_NEXT_RE = new RegExp(`\\b(?:next|this|last)\\s+(?:week|month|quarter|year|${WEEKDAY_FULL}|${WEEKDAY_ABBR})\\b`, "gi");
const IN_N_WEEKS_RE = /\bin\s+(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|years?)\b/gi;
const END_OF_RE = /\bend of (?:the )?(?:month|week|next week)\b/gi;

const ALL_DETECT_RES: RegExp[] = [
  MONTH_WITH_DAY_RE,
  DAY_OF_MONTH_RE,
  NUMERIC_DATE_RE,
  ISO_DATE_RE,
  WEEKDAY_WITH_TIME_RE,
  WEEKDAY_RE,
  CLOCK_TIME_RE3,
  CLOCK_TIME_RE1,
  CLOCK_TIME_RE2,
  RELATIVE_RE,
  RELATIVE_NEXT_RE,
  IN_N_WEEKS_RE,
  END_OF_RE,
  MONTH_STANDALONE_RE,
];

function containsProhibited(text: string): boolean {
  for (const re of ALL_DETECT_RES) {
    re.lastIndex = 0;
    if (re.test(text)) return true;
  }
  return false;
}

function replaceProhibited(text: string): string {
  const replacement = "a date the owner will confirm";
  let out = text;
  // use fresh regex instances to avoid lastIndex issues
  const reps: RegExp[] = [
    new RegExp(`\\b(?:${MONTHS})\\b\\.?\\s*\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"),
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+of\\s+(?:${MONTHS})\\b`, "gi"),
    /\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b/g,
    /\b\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\b/g,
    new RegExp(`\\b(?:${WEEKDAY_FULL}|${WEEKDAY_ABBR})\\b\\s+(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?`, "gi"),
    new RegExp(`\\b(?:${WEEKDAY_FULL}|${WEEKDAY_ABBR})\\b`, "gi"),
    /\b\d{1,2}:\d{2}\s*(?:am|pm|a\.m\.|p\.m\.)\b/gi,
    /\b\d{1,2}:\d{2}\b/g,
    /\b\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)\b/gi,
    /\b(?:today|tonight|tomorrow|yesterday)\b/gi,
    new RegExp(`\\b(?:next|this|last)\\s+(?:week|month|quarter|year|${WEEKDAY_FULL}|${WEEKDAY_ABBR})\\b`, "gi"),
    /\bin\s+(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|years?)\b/gi,
    /\bend of (?:the )?(?:month|week|next week)\b/gi,
    new RegExp(`\\b(?:${MONTHS})\\b\\.?`, "gi"),
  ];
  for (const re of reps) {
    out = out.replace(re, replacement);
  }
  return out;
}

export type OutgoingKind = "turn" | "follow-up-draft";

export interface EvaluateResult {
  outcome: "released" | "held";
  text?: string;
  reason?: string;
  version: string;
  generation: number;
}

function normalizeCandidate(candidate: string | { subject: string; body: string }): string {
  if (typeof candidate === "string") return candidate;
  return `${candidate.subject} ${candidate.body}`;
}

export function evaluateOutgoing(
  ownerId: string,
  meetingId: string,
  candidate: string | { subject: string; body: string },
  kind: OutgoingKind,
): EvaluateResult {
  const s = getScope(ownerId, meetingId);
  const text = normalizeCandidate(candidate);

  if (s.clarificationNeeded) {
    if (containsProhibited(text)) {
      return { outcome: "held", reason: "needs clarification for date disclosure", version: SESSION_POLICY_VERSION, generation: s.generation };
    }
    return { outcome: "released", text, version: SESSION_POLICY_VERSION, generation: s.generation };
  }

  if (s.restriction === "no-date-disclosure") {
    if (!containsProhibited(text)) {
      return { outcome: "released", text, version: SESSION_POLICY_VERSION, generation: s.generation };
    }
    const replaced = replaceProhibited(text);
    if (containsProhibited(replaced)) {
      return { outcome: "held", reason: "prohibited date/time remains after rewrite", version: SESSION_POLICY_VERSION, generation: s.generation };
    }
    // for follow-up-draft we return combined replaced text
    if (typeof candidate !== "string" && kind === "follow-up-draft") {
      const subjReplaced = replaceProhibited(candidate.subject);
      const bodyReplaced = replaceProhibited(candidate.body);
      const combined = `${subjReplaced} ${bodyReplaced}`;
      if (containsProhibited(combined)) {
        return { outcome: "held", reason: "prohibited date/time remains", version: SESSION_POLICY_VERSION, generation: s.generation };
      }
      return { outcome: "released", text: combined, version: SESSION_POLICY_VERSION, generation: s.generation };
    }
    return { outcome: "released", text: replaced, version: SESSION_POLICY_VERSION, generation: s.generation };
  }

  return { outcome: "released", text, version: SESSION_POLICY_VERSION, generation: s.generation };
}

function copyCandidate(candidate: string | { subject: string; body: string }): string | { subject: string; body: string } {
  if (typeof candidate === "string") return candidate;
  return { subject: candidate.subject, body: candidate.body };
}

function candidatesEqual(
  a: string | { subject: string; body: string },
  b: string | { subject: string; body: string },
): boolean {
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a !== "string" && typeof b !== "string") return a.subject === b.subject && a.body === b.body;
  return false;
}

// --- hold / release ---

export interface HoldHandle {
  readonly id: string;
  readonly ownerId: string;
  readonly meetingId: string;
  readonly generationAtHold: number;
  readonly candidate: string | { subject: string; body: string };
  readonly kind: OutgoingKind;
}

export function holdCandidate(
  ownerId: string,
  meetingId: string,
  candidate: string | { subject: string; body: string },
  kind: OutgoingKind,
): HoldHandle {
  const s = getScope(ownerId, meetingId);
  const id = `hold-${holdSeq++}`;
  const storedCandidate = copyCandidate(candidate);
  const recordCandidate = typeof storedCandidate === "string" ? storedCandidate : Object.freeze({ ...storedCandidate });
  const record: HeldRecord = Object.freeze({
    ownerId,
    meetingId,
    generationAtHold: s.generation,
    candidate: recordCandidate,
    kind,
  });
  heldRecords.set(id, record);
  const handleCandidate = copyCandidate(candidate);
  const handle: HoldHandle = Object.freeze({
    id,
    ownerId,
    meetingId,
    generationAtHold: s.generation,
    candidate: handleCandidate,
    kind,
  });
  return handle;
}

export interface ReleaseResult {
  outcome: "released" | "held" | "invalidated";
  text?: string;
  reason?: string;
  version: string;
  generation: number;
}

export function releaseHeld(handle: HoldHandle, onDispatch?: (text: string) => void): ReleaseResult {
  const stored = heldRecords.get(handle.id);
  if (stored === undefined) {
    return {
      outcome: "invalidated",
      reason: "unknown hold id",
      version: SESSION_POLICY_VERSION,
      generation: getScope(handle.ownerId, handle.meetingId).generation,
    };
  }
  if (
    handle.ownerId !== stored.ownerId ||
    handle.meetingId !== stored.meetingId ||
    handle.generationAtHold !== stored.generationAtHold ||
    handle.kind !== stored.kind ||
    !candidatesEqual(handle.candidate, stored.candidate)
  ) {
    return {
      outcome: "invalidated",
      reason: "handle mismatch",
      version: SESSION_POLICY_VERSION,
      generation: getScope(stored.ownerId, stored.meetingId).generation,
    };
  }
  if (heldUsed.has(handle.id)) {
    return {
      outcome: "invalidated",
      reason: "already released",
      version: SESSION_POLICY_VERSION,
      generation: getScope(stored.ownerId, stored.meetingId).generation,
    };
  }
  heldUsed.add(handle.id);
  const s = getScope(stored.ownerId, stored.meetingId);
  if (s.generation !== stored.generationAtHold) {
    return { outcome: "invalidated", reason: "stale generation", version: SESSION_POLICY_VERSION, generation: s.generation };
  }
  const evalRes = evaluateOutgoing(stored.ownerId, stored.meetingId, stored.candidate, stored.kind);
  if (evalRes.outcome === "held") {
    return {
      outcome: "held",
      ...(evalRes.reason !== undefined ? { reason: evalRes.reason } : {}),
      version: evalRes.version,
      generation: evalRes.generation,
    };
  }
  if (evalRes.text !== undefined && onDispatch !== undefined) {
    onDispatch(evalRes.text);
  }
  return {
    outcome: "released",
    ...(evalRes.text !== undefined ? { text: evalRes.text } : {}),
    version: evalRes.version,
    generation: evalRes.generation,
  };
}
