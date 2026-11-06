import { randomUUID } from "node:crypto";
import { EVIDENCE_BRIEF_JSON_SCHEMA, PRESSURE_TACTICS } from "@second-seat/core";
import { hashDraft } from "./draftApproval.js";
import {
  createPrivacyGate,
  type DispatchReceipt,
  type GatedText,
  type PrivacyGate,
} from "@second-seat/bot/dist/src/private/gate.js";
import { MockRedactor } from "@second-seat/bot/dist/src/private/redact.js";
import { LIVE_REDACT_TIMEOUT_MS } from "./liveConfig.js";
import {
  offlineEvidenceBrief,
  verifyApprovedRedaction,
  verifySessionBrief,
  type SessionVerification,
} from "./sessionVerification.js";

/**
 * Shown instead of a provider or transport error. Those messages can
 * include a slice of the response body; this line does not.
 */
export const TRANSPORT_FAILURE_REASON =
  "the analysis service failed; the provider response was not included";

function isTransportFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "SyntaxError") return true;
  if (err.name === "TypeError" && /fetch/i.test(err.message)) return true;
  const msg = err.message;
  return (
    msg.startsWith("muse-spark") ||
    msg.startsWith("fetch failed") ||
    msg.startsWith("glimmer: chat failed") ||
    msg.startsWith("glimmer: no JSON") ||
    msg.startsWith("glimmer: finish_reason")
  );
}

export type SessionStatus =
  | "input"
  | "redaction_pending"
  | "review_required"
  | "approved"
  | "analysis_pending"
  | "completed"
  | "blocked"
  | "error";

export interface Segment {
  id: string;
  text: string;
}

export interface BriefEntry {
  kind: string;
  text: string;
  segmentIds: string[];
  flags?: string[];
}

export interface AnalysisResult {
  offline: boolean;
  entries: BriefEntry[];
}

export interface PayloadRecord {
  approvedText: string;
  /**
   * Live analyzers derive this from the gate receipts recorded for the
   * analysis: "prepared" (no receipt), "invoked" (fetch ran, outcome
   * pending), "dispatched" (provider confirmed), "failed" (HTTP or
   * transport failure). Offline transports record no receipts: "prepared"
   * until adapter entry marks dispatch.
   */
  status: "prepared" | "invoked" | "dispatched" | "failed";
  sentAt?: string;
  adapterLabel?: string;
}

export interface SupersededRecord {
  approvedText: string;
  sentAt: string;
  status: "sent";
}

export interface MutationOpts {
  expectedRevision?: number;
  assessmentId?: string;
}

export interface SessionSnapshot {
  state: SessionStatus;
  /** Strictly increasing server-side revision; every content/approval mutation bumps it. */
  revision: number;
  reason?: string;
  segments: Segment[];
  redactedText: string;
  approved: boolean;
  result: AnalysisResult | null;
  payload: PayloadRecord | null;
  superseded: SupersededRecord | null;
  offline: boolean;
  draft: { text: string; origin: "user"; approved: boolean } | null;
  /** Null before analysis and after any content change; else the current assessment. */
  pressure: PressureAssessment | null;
  /**
   * Transport-boundary dispatch receipts for every run this session has
   * ever used (in run order). Survives invalidation and setTranscript:
   * already-dispatched history is never erased.
   */
  receipts: DispatchReceipt[];
  /** Present after a verification check has run. Absent before that. */
  verification?: SessionVerification | null;
}

export interface DraftRecord {
  text: string;
  origin: "user";
  resultGeneration: number;
  approvedHash: string | null;
}

export type AnalyzerTransport = (approvedText: string) => Promise<unknown>;

/**
 * Live analyzer (e.g. MuseClient): called with the gate-minted GatedText
 * from gate.send, never with a plain string. The gate-approved payload is
 * the sole source of outbound text.
 */
export interface LiveBriefAnalyzer {
  completeBrief(input: {
    meetingId: string;
    transcriptText: GatedText;
    framesSidecarText: GatedText | "";
    fixtureMode: boolean;
    /** Structured labels bound to the approved transcript (no free-string channel). */
    pressureLabels?: { segmentId: string; tactic: string; span: string }[];
  }): Promise<{ rawText: unknown }>;
}

function isLiveAnalyzer(
  analyzer: AnalyzerTransport | LiveBriefAnalyzer,
): analyzer is LiveBriefAnalyzer {
  return typeof (analyzer as LiveBriefAnalyzer).completeBrief === "function";
}

/** One tactic claim about a transcript segment. `span` must be a substring. */
export interface PressureLabel {
  segmentId: string;
  tactic: string;
  ask: string;
  target: string;
  span: string;
  source: "pattern" | "spark" | "fixture";
}

export interface PressureClassifier {
  mode: "fixture" | "live";
  classify(lines: { segmentId: string; text: string }[]): Promise<PressureLabel[]>;
}

export interface PressureItem {
  id: string;
  tactic: string;
  quote: string;
  segmentId: string;
  unresolvedTerm: string;
}

export interface PressureAssessment {
  /** Unique per completed analysis, even for identical text. */
  assessmentId: string;
  /**
   * Honest availability state. valid_* only when a classifier/pattern
   * layer actually ran and returned a valid label array (positive iff
   * items.length > 0). not_run and failed always carry items [] and
   * allReviewed false: never an invisible negative or reviewed success.
   * A rejected label (unknown tactic, unknown segment, missing/empty or
   * nonmatching span) is never a valid_negative: any rejection fails the
   * assessment with items [] and a visible reason.
   */
  status: "not_run" | "failed" | "valid_negative" | "valid_positive";
  items: PressureItem[];
  rejected: number;
  reviewed: string[];
  allReviewed: boolean;
  source: "offline-pattern" | "offline-fixture" | "live" | "pattern" | "none";
  offline: boolean;
  /** Why a failed assessment failed; shown in the pressure section. */
  reason?: string;
}

export interface SessionStoreOptions {
  gate?: PrivacyGate;
  redactor?: { redactText: (t: string) => Promise<unknown> } & Record<string, unknown>;
  analyzer?: AnalyzerTransport | LiveBriefAnalyzer;
  analyzerLabel?: string;
  offline?: boolean;
  pressureClassifier?: PressureClassifier | null;
  /**
   * Recorded support-judge verdicts, keyed by brief entry id. When this
   * is set and the brief has entries, verifyClaims runs. Offline and live
   * both use it; nothing here calls a model.
   */
  judgeVerdicts?: Record<string, unknown> | null;
}

/**
 * Deterministic offline pattern layer. Mirrors detectPressurePatterns in
 * packages/core/src/evidence/pressure.ts (same per-tactic markers, first
 * match per tactic wins, span set to the matched substring). No model calls,
 * no network.
 */
const TACTIC_PATTERNS: readonly { tactic: string; pattern: RegExp }[] = [
  {
    tactic: "authority",
    pattern:
      /\b(CEO|board|legal|counsel|compliance|auditor|regulator|chief executive)\b[^.]{0,60}\b(requires?|demands?|orders?|directs?|says? (so|you must)|approved? this)\b|\b(as|I'm|I am) (your|the) (CEO|boss|manager|director|lawyer|doctor)\b|\blegal (requires|demands)|per (company )?policy,? (you|we) must/i,
  },
  {
    tactic: "commitment",
    pattern:
      /\byou (already )?(agreed|promised|committed|said you would|gave your word)\b|\bas you (agreed|promised|committed)\b|\bstay consistent\b|\byou told us you would\b/i,
  },
  {
    tactic: "liking",
    pattern:
      /\bas a friend\b|\bwe (really )?(like|love|appreciate) you\b|\byou(['’]re| are) so (great|wonderful|amazing|terrific|smart)\b|\bfriends? like us\b/i,
  },
  {
    tactic: "reciprocity",
    pattern:
      /\bafter (all|everything) we (did|have done|gave)\b|\bwe (already|just) (gave|did|sent|offered) you\b|\bin return for\b|\byou owe us\b|\bdo us this (one )?favor\b|\bwe did you a favor\b/i,
  },
  {
    tactic: "scarcity",
    pattern:
      /\bonly \d+ (left|remaining|spots?)\b|\blast chance\b|\bexpires? (at|tonight|today|midnight)\b|\blimited (time|offer|spots?|availability)\b|\bact (now|fast|today)\b|\bbefore it(['’]s| is) gone\b|\brunning out\b/i,
  },
  {
    tactic: "social_proof",
    pattern:
      /\beveryone else (already )?(agreed|signed|approved)\b|\ball (your|the) (peers|competitors|neighbors) (already )?(agreed|signed|approved)\b|\bmost (teams|people|customers|clients) (already )?(agreed|signed|chose)\b|\bjoin the rest\b|\bnobody else refused\b/i,
  },
  {
    tactic: "unity",
    pattern:
      /\bas (a fellow|one of us|part of)\b|\bwe(['’]re| are) (all )?(in this together|on the same team|family)\b|\bfellow (members?|teammates?)\b|\bour (team|family|community) (always |needs |counts on )\b/i,
  },
];

function detectPressurePatterns(text: string, segmentId = ""): PressureLabel[] {
  const labels: PressureLabel[] = [];
  for (const { tactic, pattern } of TACTIC_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[0] !== undefined) {
      labels.push({
        segmentId,
        tactic,
        ask: "",
        target: "owner",
        span: match[0],
        source: "pattern",
      });
    }
  }
  return labels;
}

/**
 * G4a negative-result contract: a "none" label is an assessment-level
 * explicit negative. It is valid only when (a) it is the ONLY label in the
 * array, (b) its span is exactly "", and (c) its segmentId names an existing
 * approved segment. Any other "none" (nonempty span, unknown/missing
 * segment, mixed with any other label, malformed field) is invalid and
 * rejects the assessment. An empty array stays a valid negative.
 *
 * A non-"none" label is accepted only when its segmentId names a current
 * approved segment and its span is non-empty and a substring of that
 * segment's text.
 */
/**
 * An unresolved term is shown only with validated provenance: label.ask
 * must be a non-empty substring of the CITED segment text and not equal
 * to the whole (trimmed) cited segment text. Otherwise the item carries
 * "" and renderers show "term not identified". Substring presence does
 * not prove semantic unresolvedness: it only shows the word was said in
 * the cited segment, not that the term itself is unresolved.
 */
function resolveUnresolvedTerm(
  ask: unknown,
  segmentText: string | undefined,
  approvedText: string,
): string {
  if (typeof ask !== "string" || ask === "") return "";
  if (segmentText === undefined || !segmentText.includes(ask)) return "";
  if (!approvedText.includes(ask)) return "";
  if (ask === segmentText.trim()) return "";
  return ask;
}

/** The one shared known-tactic list (from `@second-seat/core`). */
const KNOWN_PRESSURE_TACTICS: ReadonlySet<string> = new Set<string>(PRESSURE_TACTICS);

/**
 * Why a non-"none" label fails verification, or null when it verifies:
 * unknown tactic, unknown segment, or a missing/empty span that is not a
 * substring of the cited segment.
 */
function pressureLabelProblem(label: PressureLabel, byId: Map<string, string>): string | null {
  if (!KNOWN_PRESSURE_TACTICS.has(label.tactic)) {
    return `unknown tactic ${JSON.stringify(label.tactic)}`;
  }
  const text = typeof label.segmentId === "string" ? byId.get(label.segmentId) : undefined;
  if (text === undefined) {
    return `unknown segment ${JSON.stringify(label.segmentId)}`;
  }
  const span = typeof label.span === "string" ? label.span : "";
  if (span === "") {
    return "empty span";
  }
  if (!text.includes(span)) {
    return "span is not a substring of the cited segment";
  }
  return null;
}

/**
 * Why a "none" label fails verification, or null when it is a valid explicit
 * negative: it must be the only label, carry span exactly "", and name an
 * existing approved segment. Anything else is an invalid "none".
 */
function pressureNoneProblem(
  label: PressureLabel,
  onlyLabel: boolean,
  byId: Map<string, string>,
): string | null {
  if (!onlyLabel) {
    return 'invalid "none" assessment: a "none" label must be the only label';
  }
  if (typeof label.span !== "string" || label.span !== "") {
    return 'invalid "none" assessment: span must be exactly ""';
  }
  if (typeof label.segmentId !== "string" || !byId.has(label.segmentId)) {
    return `invalid "none" assessment: unknown segment ${JSON.stringify(label.segmentId)}`;
  }
  return null;
}

function verifyPressureLabels(
  labels: PressureLabel[],
  segments: Segment[],
  source: PressureAssessment["source"],
  offline: boolean,
): PressureAssessment {
  const byId = new Map(segments.map((s) => [s.id, s.text]));
  const approvedText = segments.map((s) => s.text).join("\n");
  const items: PressureItem[] = [];
  let rejected = 0;
  let firstCause = "";
  let firstNoneCause = "";
  for (const label of labels) {
    const problem =
      label.tactic === "none"
        ? pressureNoneProblem(label, labels.length === 1, byId)
        : pressureLabelProblem(label, byId);
    if (problem === null) {
      if (label.tactic === "none") continue;
      const text = byId.get(label.segmentId) as string;
      items.push({
        id: `p${items.length + 1}`,
        tactic: label.tactic,
        quote: label.span,
        segmentId: label.segmentId,
        unresolvedTerm: resolveUnresolvedTerm(label.ask, text, approvedText),
      });
    } else {
      rejected += 1;
      if (firstCause === "") firstCause = problem;
      if (label.tactic === "none" && firstNoneCause === "") firstNoneCause = problem;
    }
  }
  // Any rejected label — including an invalid "none" — fails the whole
  // assessment: never an invisible valid_negative, and items [] so Copy
  // gating stays disabled. A mixed valid positive + invalid "none" is
  // "failed", never valid_positive. valid_negative happens only for an empty
  // array or one valid explicit "none". The reason names "none" whenever an
  // invalid "none" is present.
  if (rejected > 0) {
    const cause = firstNoneCause !== "" ? firstNoneCause : firstCause;
    return {
      assessmentId: randomUUID(),
      status: "failed",
      items: [],
      rejected,
      reviewed: [],
      allReviewed: false,
      source,
      offline,
      reason: `pressure verification failed: rejected ${rejected} of ${rejected + items.length} label(s): ${cause}`,
    };
  }
  const status: PressureAssessment["status"] = items.length > 0 ? "valid_positive" : "valid_negative";
  return {
    assessmentId: randomUUID(),
    status,
    items,
    rejected,
    reviewed: [],
    allReviewed: items.length === 0,
    source,
    offline,
  };
}

function notRunPressure(offline: boolean): PressureAssessment {
  return {
    assessmentId: randomUUID(),
    status: "not_run",
    items: [],
    rejected: 0,
    reviewed: [],
    allReviewed: false,
    source: "none",
    offline,
  };
}

function failedPressure(offline: boolean, reason: string): PressureAssessment {
  return {
    assessmentId: randomUUID(),
    status: "failed",
    items: [],
    rejected: 0,
    reviewed: [],
    allReviewed: false,
    source: "none",
    offline,
    reason,
  };
}

/** A classifier result is usable only as a real array of well-formed labels. */
function isValidLabelArray(value: unknown): value is PressureLabel[] {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return false;
    const r = entry as Record<string, unknown>;
    if (typeof r["segmentId"] !== "string") return false;
    if (typeof r["tactic"] !== "string") return false;
    if (typeof r["span"] !== "string") return false;
    if ("ask" in r && typeof r["ask"] !== "string") return false;
  }
  return true;
}

/** Copy/draft gating: valid_negative, or valid_positive with allReviewed. */
function pressureSatisfied(p: PressureAssessment | null): boolean {
  if (p === null) return true;
  if (p.status === "valid_negative") return true;
  if (p.status === "valid_positive") return p.allReviewed;
  return false;
}

/** Thrown (by name) when a mutation names a stale revision or assessment. Changes nothing. */
function staleRevision(): Error {
  const err = new Error("stale revision: state changed since review");
  err.name = "StaleRevisionError";
  return err;
}

function checkRevision(s: SessionRecord, opts?: MutationOpts): void {
  if (opts?.expectedRevision !== undefined && opts.expectedRevision !== s.revision) {
    throw staleRevision();
  }
}

function checkAssessment(s: SessionRecord, opts?: MutationOpts): void {
  if (!s.pressure || opts?.assessmentId === undefined || opts.assessmentId !== s.pressure.assessmentId) {
    throw staleRevision();
  }
}

interface SessionRecord {
  id: string;
  segments: Segment[];
  rawText: string;
  runId: string | null;
  /** Every runId this session has ever used; append-only across invalidation. */
  runIds: string[];
  approvalToken: string | null;
  redactedText: string;
  redactionSpans: { start: number; end: number; label: string }[];
  verification: SessionVerification | null;
  approved: boolean;
  approvedText: string;
  result: AnalysisResult | null;
  payload: PayloadRecord | null;
  superseded: SupersededRecord | null;
  pressure: PressureAssessment | null;
  draft: DraftRecord | null;
  inFlight: { approvedText: string; sentAt: string } | null;
  /**
   * The live analysis currently in flight (if any): the run it sends
   * through, how many receipts that run already had, and the approved
   * text. Lets snapshot() derive the payload panel from the HTTP-boundary
   * receipts for this analysis while the transport is still running.
   * Cleared when the analysis settles or the content is invalidated.
   */
  pendingSend: { approvedText: string; runId: string; receiptsBefore: number } | null;
  generation: number;
  /** Strictly increasing on every server-side content/approval change. */
  revision: number;
  state: SessionStatus;
  reason?: string;
  approvalExpired: boolean;
  redactPending: Promise<void> | null;
  analyzePending: Promise<void> | null;
}

const DATE_WORDS =
  /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|monday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|\d{1,2}[/-]\d{1,2})\b/i;

/** Deterministic offline brief derived only from approved text. No hardcoded findings. */
export function buildOfflineBrief(approvedText: string, segments: Segment[]): AnalysisResult {
  const lines = approvedText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const entries: BriefEntry[] = [];
  lines.forEach((line, i) => {
    const segId = segments[i]?.id ?? `seg-${i + 1}`;
    if (line.includes("?")) {
      entries.push({ kind: "question", text: line, segmentIds: [segId] });
    } else if (line.includes("$") || (/\d/.test(line) && DATE_WORDS.test(line))) {
      entries.push({ kind: "commitment", text: line, segmentIds: [segId] });
    }
  });
  return { offline: true, entries };
}

function toAnalysisResult(value: unknown, offline: boolean): AnalysisResult {
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { entries?: unknown }).entries)
  ) {
    const raw = (value as { entries: unknown[] }).entries;
    const entries: BriefEntry[] = raw
      .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
      .map((e) => ({
        kind: typeof e["kind"] === "string" ? (e["kind"] as string) : "note",
        text: typeof e["text"] === "string" ? (e["text"] as string) : "",
        segmentIds: Array.isArray(e["segmentIds"])
          ? (e["segmentIds"] as unknown[]).filter((s): s is string => typeof s === "string")
          : [],
      }));
    const result = value as { offline?: unknown };
    return {
      offline: typeof result.offline === "boolean" ? (result.offline as boolean) : offline,
      entries,
    };
  }
  return { offline, entries: [] };
}

/**
 * Strict live-analysis validation against the shared EvidenceBrief contract
 * (EVIDENCE_BRIEF_JSON_SCHEMA from @second-seat/core: every object carries
 * exactly its required keys with no extras, and each value matches its
 * declared type and enum, including nested citation regions). meetingId must
 * equal the session the brief was requested for, exactly. Entries map
 * to BriefEntry {kind: category, text, segmentIds, flags?}. Citations are
 * existence-checked only (never treated as proof of factual support): a
 * "segment" citation must name a current approved segment id, and a "frame"
 * citation is always unknown (sessions carry no frames). An entry with zero
 * citations is allowed only with the "missing_source" flag. Anything
 * unexpected throws (the caller records session state "error").
 * (Error texts avoid the gate's failure-state keywords so failures land
 * in "error", never the gate failure state.)
 */
interface SchemaNode {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly required?: readonly string[];
  readonly properties?: Record<string, SchemaNode>;
  readonly items?: SchemaNode;
  readonly additionalProperties?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function matchesJsonType(v: unknown, t: string): boolean {
  switch (t) {
    case "object":
      return isRecord(v);
    case "array":
      return Array.isArray(v);
    case "string":
      return typeof v === "string";
    case "boolean":
      return typeof v === "boolean";
    case "number":
      return typeof v === "number";
    case "null":
      return v === null;
    default:
      return false;
  }
}

/** Walk one shared-schema node, enforcing type, enum, required and closed objects. */
function validateAgainstSchema(value: unknown, schema: SchemaNode, label: string): void {
  if (schema.type !== undefined) {
    const allowed: readonly string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((t) => matchesJsonType(value, t))) {
      throw new Error(`live analysis: ${label} has wrong type`);
    }
  }
  if (schema.enum !== undefined) {
    if (!(schema.enum as readonly unknown[]).includes(value)) {
      throw new Error(`live analysis: ${label} has value outside the schema enum`);
    }
  }
  if (isRecord(value) && schema.properties !== undefined) {
    if (schema.required !== undefined) {
      for (const k of schema.required) {
        if (!(k in value)) {
          throw new Error(`live analysis: ${label} is missing required field ${k}`);
        }
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const k of Object.keys(value)) {
        if (!allowed.has(k)) {
          throw new Error(`live analysis: ${label} has unexpected field ${k}`);
        }
      }
    }
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (k in value) validateAgainstSchema(value[k], sub as SchemaNode, `${label}.${k}`);
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((v, i) => validateAgainstSchema(v, schema.items as SchemaNode, `${label}[${i}]`));
  }
}

export function toLiveAnalysisResult(
  value: unknown,
  validIds: Set<string>,
  expectedMeetingId: string,
): AnalysisResult {
  if (!isRecord(value)) {
    throw new Error("live analysis: response is not a JSON object with an entries array");
  }
  validateAgainstSchema(
    value,
    EVIDENCE_BRIEF_JSON_SCHEMA as unknown as SchemaNode,
    "response",
  );
  const root = value as {
    meetingId: unknown;
    entries: unknown[];
  };
  if (root.meetingId !== expectedMeetingId) {
    throw new Error("live analysis: wrong meeting id");
  }
  const raw = root.entries;
  const entries: BriefEntry[] = raw.map((entryValue, i) => {
    const e = entryValue as {
      category: unknown;
      text: unknown;
      citations: unknown[];
      flags: unknown;
    };
    const flags = e.flags as string[];
    const segmentIds: string[] = [];
    (e.citations as unknown[]).forEach((citationValue, j) => {
      const c = citationValue as {
        kind: unknown;
        segmentId: unknown;
        frameId: unknown;
      };
      if (c.kind === "segment") {
        if (typeof c.segmentId !== "string") {
          throw new Error(`live analysis: entry ${i} citation ${j} segmentId must be a string`);
        }
        if (!validIds.has(c.segmentId)) {
          throw new Error(`live analysis: entry ${i} cites unknown segment`);
        }
        segmentIds.push(c.segmentId);
      } else {
        if (typeof c.frameId !== "string") {
          throw new Error(`live analysis: entry ${i} citation ${j} frameId must be a string`);
        }
        throw new Error(`live analysis: entry ${i} cites unknown frame`);
      }
    });
    if (segmentIds.length === 0 && !flags.includes("missing_source")) {
      throw new Error(`live analysis: entry ${i} is presented as source-backed without citations`);
    }
    const out: BriefEntry = {
      kind: e.category as string,
      text: e.text as string,
      segmentIds,
    };
    if (flags.length > 0) out.flags = [...flags];
    return out;
  });
  return { offline: false, entries };
}

const SESSION_TEST_MODE = process.env.SECOND_SEAT_TEST_MODE === "1";

export { LIVE_REDACT_TIMEOUT_MS };
/** Offline/fixture redaction timeout (local mock redactor). */
export const OFFLINE_REDACT_TIMEOUT_MS = 30_000;

/**
 * Redaction timeout for the session analyze step. Test mode stays at 500ms;
 * SECOND_SEAT_REDACT_TIMEOUT_MS overrides; otherwise live mode gets 240s
 * (a full transcript took ~50s on the private endpoint, over the old 30s)
 * and offline keeps 30s.
 */
export function redactTimeoutMs(opts: {
  offline: boolean;
  env?: Record<string, string | undefined>;
}): number {
  const env = opts.env ?? process.env;
  if (env["SECOND_SEAT_TEST_MODE"] === "1") return 500;
  const raw = env["SECOND_SEAT_REDACT_TIMEOUT_MS"] ?? "";
  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return opts.offline ? OFFLINE_REDACT_TIMEOUT_MS : LIVE_REDACT_TIMEOUT_MS;
}

function withRedactTimeout<T>(promise: Promise<T>, offline: boolean): Promise<T> {
  const ms = redactTimeoutMs({ offline });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`redaction timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function assertWellFormedRedaction(prepared: unknown): void {
  const p = prepared as { redactedText?: unknown; spans?: unknown } | null;
  if (
    typeof p !== "object" ||
    p === null ||
    typeof p.redactedText !== "string" ||
    !Array.isArray(p.spans)
  ) {
    throw new Error("malformed redactor output: expected { redactedText: string, spans: array }");
  }
  for (const s of p.spans) {
    const span = s as { start?: unknown; end?: unknown; label?: unknown };
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || typeof span.label !== "string") {
      throw new Error("malformed redactor output: every span needs integer start/end and string label");
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapTestRedactor(base: any): any {
  return {
    label: "test-fake",
    redactText: async (text: string): Promise<unknown> => {
      if (text.includes("[[fault:malformed]]")) {
        return { maskedText: 42, spans: [{ start: "n", end: "s", label: 42 }] };
      }
      if (text.includes("[[fault:timeout]]")) {
        return new Promise<never>(() => {});
      }
      if (text.includes("[[slow]]")) {
        await new Promise((r) => setTimeout(r, 1500));
      }
      return base.redactText(text);
    },
    redactImage: (png: Buffer, name: string): Promise<unknown> => base.redactImage(png, name),
    health: async (): Promise<{ ok: boolean; label: string }> => ({ ok: true, label: "test-fake" }),
  };
}

export function createSessionStore(options?: SessionStoreOptions) {
  const offline = options?.offline ?? true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseRedactor = (options?.redactor as any) ?? new MockRedactor();
  const gate: PrivacyGate =
    options?.gate ??
    createPrivacyGate({
      mode: "fixture",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redactor: (SESSION_TEST_MODE ? wrapTestRedactor(baseRedactor) : baseRedactor) as any,
    });
  const analyzer: AnalyzerTransport | LiveBriefAnalyzer =
    options?.analyzer ??
    (async (approvedText: string) => buildOfflineBrief(approvedText, []));
  const analyzerLabel =
    options?.analyzerLabel ?? (isLiveAnalyzer(analyzer) ? "MuseClient" : "offline heuristic");
  const pressureClassifier = options?.pressureClassifier;
  const sessions = new Map<string, SessionRecord>();

  function lookup(sessionId: string): SessionRecord {
    const s = sessions.get(sessionId);
    if (!s) throw new Error(`unknown sessionId: ${sessionId}`);
    return s;
  }

  function snapshot(s: SessionRecord): SessionSnapshot {
    const seen = new Set<string>();
    const receipts: DispatchReceipt[] = [];
    for (const runId of [...s.runIds, s.runId]) {
      if (runId === null || seen.has(runId)) continue;
      seen.add(runId);
      receipts.push(...gate.receipts(runId));
    }
    // Live payload panel, read at snapshot time from the HTTP-boundary
    // receipts for the in-flight analysis (beyond receiptsBefore): no
    // receipt -> prepared; latest "invoked" -> invoked; latest
    // "provider_confirmed" -> dispatched; "http_error"/"transport_failed"
    // -> failed. sentAt is the first such receipt's dispatchedAt.
    let payload = s.payload;
    if (payload !== null && s.pendingSend !== null && isLiveAnalyzer(analyzer)) {
      const fresh = gate.receipts(s.pendingSend.runId).slice(s.pendingSend.receiptsBefore);
      if (fresh.length > 0) {
        const first = fresh[0] as DispatchReceipt;
        const latest = fresh[fresh.length - 1] as DispatchReceipt;
        const status: PayloadRecord["status"] =
          latest.outcome === "provider_confirmed"
            ? "dispatched"
            : latest.outcome === "invoked"
              ? "invoked"
              : "failed";
        payload = {
          approvedText: s.pendingSend.approvedText,
          status,
          sentAt: first.dispatchedAt,
          adapterLabel: analyzerLabel,
        };
      }
    }
    const snap: SessionSnapshot = {
      state: s.state,
      revision: s.revision,
      segments: s.segments,
      redactedText: s.redactedText,
      approved: s.approved,
      result: s.result,
      payload,
      superseded: s.superseded,
      receipts,
      offline,
      pressure: s.pressure,
      verification: s.verification,
      draft:
        s.draft === null
          ? null
          : {
              text: s.draft.text,
              origin: "user" as const,
              approved:
                s.draft.approvedHash !== null &&
                s.draft.approvedHash === hashDraft(s.draft.text) &&
                s.draft.resultGeneration === s.generation &&
                pressureSatisfied(s.pressure),
            },
    };
    if (s.reason !== undefined) snap.reason = s.reason;
    return snap;
  }

  function invalidateContent(s: SessionRecord): void {
    s.generation += 1;
    s.revision += 1;
    if (s.runId) gate.revoke(s.runId);
    s.approvalToken = null;
    s.approved = false;
    s.approvedText = "";
    s.result = null;
    s.payload = null;
    s.pressure = null;
    s.verification = null;
    s.draft = null;
    if (s.inFlight) {
      s.superseded = { ...s.inFlight, status: "sent" };
      s.inFlight = null;
    }
    s.pendingSend = null;
    s.analyzePending = null;
    delete s.reason;
  }

  function fail(s: SessionRecord, err: unknown): void {
    const msg = err instanceof Error ? err.message : "failed";
    const name = err instanceof Error ? err.name : "";
    if (
      name === "GateApprovalError" ||
      name === "ResidualPIIError" ||
      name === "GateConfigError" ||
      /residual|approval|stale|expired|config|glimmer|malformed|timeout/i.test(msg)
    ) {
      s.state = "blocked";
    } else {
      s.state = "error";
    }
    // Keep the policy classification on the original message, but never
    // store a transport body in the reason the page and state API show.
    s.reason = isTransportFailure(err) ? TRANSPORT_FAILURE_REASON : msg;
  }

  return {
    createSession(): string {
      const id = randomUUID();
      sessions.set(id, {
        id,
        segments: [],
        rawText: "",
        runId: null,
        runIds: [],
        approvalToken: null,
        redactedText: "",
        redactionSpans: [],
        verification: null,
        approved: false,
        approvedText: "",
        result: null,
        payload: null,
        superseded: null,
        pressure: null,
        draft: null,
        inFlight: null,
        pendingSend: null,
        generation: 0,
        revision: 0,
        state: "input",
        approvalExpired: false,
        redactPending: null,
        analyzePending: null,
      });
      return id;
    },

    setTranscript(sessionId: string, text: string): SessionSnapshot {
      const s = lookup(sessionId);
      invalidateContent(s);
      const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      s.segments = lines.map((line, i) => ({ id: `seg-${i + 1}`, text: line }));
      s.rawText = text;
      s.runId = null;
      s.redactionSpans = [];
      s.approvalExpired = false;
      s.redactedText = "";
      s.redactPending = null;
      s.state = "input";
      return snapshot(s);
    },

    redact(sessionId: string): Promise<SessionSnapshot> {
      const s = lookup(sessionId);
      if (s.redactPending) return s.redactPending.then(() => snapshot(s));
      s.state = "redaction_pending";
      s.pressure = null;
      delete s.reason;
      const gen = s.generation;
      let p!: Promise<void>;
      p = (async () => {
        try {
          const prepared = await withRedactTimeout(gate.prepare(s.rawText), offline);
          if (s.generation !== gen) return;
          assertWellFormedRedaction(prepared);
          s.runId = prepared.runId;
          if (!s.runIds.includes(prepared.runId)) s.runIds.push(prepared.runId);
          s.redactedText = prepared.redactedText;
          s.redactionSpans = prepared.spans.map((span) => ({
            start: span.start,
            end: span.end,
            label: span.label,
          }));
          s.verification = null;
          s.approved = false;
          s.approvalToken = null;
          s.state = "review_required";
          s.revision += 1;
        } catch (err: unknown) {
          if (s.generation !== gen) return;
          fail(s, err);
          s.revision += 1;
        } finally {
          if (s.redactPending === p) s.redactPending = null;
        }
      })();
      s.redactPending = p;
      return p.then(() => snapshot(s));
    },

    correct(sessionId: string, text: string, opts?: MutationOpts): SessionSnapshot {
      const s = lookup(sessionId);
      checkRevision(s, opts);
      if (!s.runId) throw new Error("no redaction to correct: redact first");
      const runId = s.runId;
      invalidateContent(s);
      s.runId = runId;
      s.redactedText = gate.correct(runId, text);
      s.state = "review_required";
      return snapshot(s);
    },

    invalidate(sessionId: string, scope: "transcript" | "preview" = "preview", opts?: MutationOpts): SessionSnapshot {
      const s = lookup(sessionId);
      checkRevision(s, opts);
      invalidateContent(s);
      if (scope === "transcript") {
        s.runId = null;
        s.redactedText = "";
        s.redactionSpans = [];
        s.segments = [];
        s.redactPending = null;
        s.state = "input";
      } else {
        s.state = s.runId ? "review_required" : "input";
      }
      return snapshot(s);
    },

    approve(sessionId: string, opts?: MutationOpts): SessionSnapshot {
      const s = lookup(sessionId);
      checkRevision(s, opts);
      if (!s.runId) throw new Error("no redaction to approve: redact first");
      try {
        const token = gate.approve(s.runId, s.redactedText);
        s.approvalToken = token;
        s.approved = true;
        s.approvedText = s.redactedText;
        s.segments = s.approvedText
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .map((line, i) => ({ id: `seg-${i + 1}`, text: line }));
        s.payload = { approvedText: s.redactedText, status: "prepared" };
        s.state = "approved";
        delete s.reason;
      } catch (err: unknown) {
        fail(s, err);
      }
      s.revision += 1;
      return snapshot(s);
    },

    analyze(sessionId: string): Promise<SessionSnapshot> {
      const s = lookup(sessionId);
      if (s.analyzePending) return s.analyzePending.then(() => snapshot(s));
      if (!s.approvalToken || (s.state !== "approved" && s.state !== "completed")) {
        s.state = "analysis_pending";
        delete s.reason;
        const gen = s.generation;
        let p!: Promise<void>;
        p = (async () => {
          await Promise.resolve();
          try {
            throw new Error("approval required");
          } catch (err: unknown) {
            if (s.generation !== gen) return;
            fail(s, err);
            s.revision += 1;
          } finally {
            if (s.analyzePending === p) s.analyzePending = null;
          }
        })();
        s.analyzePending = p;
        return p.then(() => snapshot(s));
      }
      s.state = "analysis_pending";
      delete s.reason;
      const gen = s.generation;
      const approvedText = s.approvedText;
      const approvedSegments = [...s.segments];
      const sentAt = new Date().toISOString();
      const live = isLiveAnalyzer(analyzer);
      // The run this analysis sends through, captured before the send so a
      // later invalidation cannot move the receipt accounting to a new run.
      const sendRunId = s.runId;
      const receiptsBefore = sendRunId === null ? 0 : gate.receipts(sendRunId).length;
      if (!live) {
        // Fake-transport receipt panel: record the invocation (t1) at entry
        // so a state poll during the run shows invoked/pending before the
        // provider completes. Live mode derives this from gate receipts.
        s.payload = { approvedText, status: "invoked", sentAt, adapterLabel: analyzerLabel };
        s.revision += 1;
      }
      // Live dispatch identity comes from the HTTP-boundary receipts for
      // this analysis (beyond receiptsBefore), never from adapter entry or
      // completion timestamps. Offline transports record no receipts, so
      // entry still marks dispatch there.
      const freshReceipts = (): DispatchReceipt[] =>
        sendRunId === null ? [] : gate.receipts(sendRunId).slice(receiptsBefore);
      const receiptSentAt = (): string | null => {
        const fresh = freshReceipts();
        return fresh.length > 0 ? ((fresh[0] as DispatchReceipt).dispatchedAt ?? null) : null;
      };
      const receiptStatus = (): PayloadRecord["status"] | null => {
        const fresh = freshReceipts();
        if (fresh.length === 0) return null;
        const latest = (fresh[fresh.length - 1] as DispatchReceipt).outcome;
        if (latest === "provider_confirmed") return "dispatched";
        if (latest === "invoked") return "invoked";
        return "failed";
      };
      const recordSuperseded = (): void => {
        if (live) {
          const at = receiptSentAt();
          if (at === null) return;
          s.superseded = { approvedText, sentAt: at, status: "sent" };
          s.revision += 1;
          return;
        }
        if (dispatched) {
          s.superseded = { approvedText, sentAt, status: "sent" };
          s.revision += 1;
        }
      };
      let dispatched = false;
      // Identity token so settling this analysis never clears a newer
      // analysis's tracking.
      const thisSend = sendRunId === null ? null : { approvedText, runId: sendRunId, receiptsBefore };
      if (live && thisSend !== null) {
        s.pendingSend = thisSend;
      }
      let p!: Promise<void>;
      p = (async () => {
        await Promise.resolve();
        try {
          if (!s.runId || !s.approvalToken) throw new Error("approval required");
          if (s.approvalExpired) throw new Error("approval is stale: test hook expired approvals");
          // Fail closed before any send. The message is fixed and does not
          // include the check's feedback, which can name span text.
          const redaction = verifyApprovedRedaction(s.rawText, s.redactionSpans, approvedText);
          if (redaction.blocked) {
            if (s.runId) gate.revoke(s.runId);
            s.approved = false;
            s.approvalToken = null;
            s.verification = redaction;
            s.reason = redaction.message;
            s.result = null;
            s.draft = null;
            s.state = "review_required";
            if (!live) {
              s.payload = { approvedText, status: "prepared", adapterLabel: analyzerLabel };
            }
            s.revision += 1;
            return;
          }
          // Resolve the pressure assessment from the approved segments.
          // Undefined classifier means the deterministic pattern layer is
          // the default in both modes; null means not_run; a throwing
          // classifier or a non-array/malformed label array means failed
          // (never substitute the pattern heuristic). Never a network call.
          const resolvePressure = async (): Promise<PressureAssessment> => {
            if (pressureClassifier === undefined) {
              return verifyPressureLabels(
                approvedSegments.flatMap((g) => detectPressurePatterns(g.text, g.id)),
                approvedSegments,
                offline ? "offline-pattern" : "pattern",
                offline,
              );
            }
            if (pressureClassifier === null) return notRunPressure(offline);
            let out: unknown;
            try {
              out = await pressureClassifier.classify(
                approvedSegments.map((g) => ({ segmentId: g.id, text: g.text })),
              );
            } catch {
              return failedPressure(offline, "pressure classifier failed");
            }
            if (!isValidLabelArray(out)) return failedPressure(offline, "pressure classifier returned an unusable label array");
            return verifyPressureLabels(
              out,
              approvedSegments,
              pressureClassifier.mode === "live" ? "live" : "offline-fixture",
              !(pressureClassifier.mode === "live" && !offline),
            );
          };
          // Live mode computes the assessment BEFORE the Spark request so
          // it can ride inside the single owner-approved analysis request
          // as structured labels bound to the approved segments.
          let livePressure: PressureAssessment | null = null;
          let livePressureLabels: { segmentId: string; tactic: string; span: string }[] = [];
          if (live) {
            livePressure = await resolvePressure();
            if (s.generation !== gen) {
              recordSuperseded();
              return;
            }
            livePressureLabels = livePressure.items.map((i) => ({
              segmentId: i.segmentId,
              tactic: i.tactic,
              span: i.quote,
            }));
          }
          const raw = await gate.send(s.runId, s.approvalToken, async (gated) => {
            if (!live) {
              // Offline transports have no transport boundary: entry marks
              // dispatch, exactly as before.
              dispatched = true;
              s.inFlight = { approvedText, sentAt };
            }
            if (live) {
              // Gate-approved payload is the sole source of outbound text.
              const res = await analyzer.completeBrief({
                meetingId: sessionId,
                transcriptText: gated,
                framesSidecarText: "",
                fixtureMode: false,
                pressureLabels: livePressureLabels,
              });
              const rawText = (res as { rawText?: unknown } | null)?.rawText;
              if (typeof rawText !== "string") {
                throw new Error("live analysis: response has no text");
              }
              return rawText;
            }
            return analyzer(approvedText);
          });
          if (s.generation !== gen) {
            recordSuperseded();
            return;
          }
          let result: AnalysisResult;
          let briefWork: unknown;
          if (live) {
            // Live mode never substitutes the offline heuristic or a
            // fixture: unparseable or invalid output is an error.
            if (typeof raw !== "string") {
              throw new Error("live analysis: response has no text");
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw) as unknown;
            } catch {
              throw new Error("live analysis: response is not JSON");
            }
            briefWork = parsed;
            const briefCheck = verifySessionBrief(
              briefWork,
              approvedSegments,
              sessionId,
              options?.judgeVerdicts,
            );
            s.verification = briefCheck;
            if (briefCheck.blocked) {
              s.result = null;
              s.draft = null;
              s.pressure = null;
              s.reason = briefCheck.message;
              s.state = "blocked";
              s.revision += 1;
              return;
            }
            result = toLiveAnalysisResult(parsed, new Set(approvedSegments.map((g) => g.id)), sessionId);
          } else {
            // Default analyzer ignores segments; rebuild offline brief with real ids when offline-shaped.
            result = toAnalysisResult(raw, offline);
            if (offline && approvedText.length > 0) {
              const maybe = raw as { entries?: unknown[] } | null;
              const looksDefault =
                !maybe || !Array.isArray(maybe.entries) || maybe.entries.length === 0;
              if (looksDefault) result = buildOfflineBrief(approvedText, approvedSegments);
              else {
                const valid = new Set(approvedSegments.map((g) => g.id));
                result = {
                  offline: result.offline,
                  entries: result.entries.map((e) => ({
                    ...e,
                    segmentIds: e.segmentIds.filter((id) => valid.has(id)),
                  })),
                };
              }
            }
            if (result.entries.length === 0) result = { offline: result.offline, entries: [] };
            const briefCheck = verifySessionBrief(
              offlineEvidenceBrief(sessionId, result.entries),
              approvedSegments,
              sessionId,
              options?.judgeVerdicts,
            );
            s.verification = briefCheck;
            if (briefCheck.blocked) {
              s.result = null;
              s.draft = null;
              s.pressure = null;
              s.reason = briefCheck.message;
              s.state = "blocked";
              s.revision += 1;
              return;
            }
          }
          // Pressure evidence for this generation, assigned only after a
          // successful analysis: a failed analysis never leaves behind an
          // allReviewed/valid assessment. Live mode reuses the assessment
          // already computed (and sent) before the request; offline mode
          // resolves it here from the same helper. Never a network call.
          let pressure: PressureAssessment;
          if (live) {
            pressure = livePressure as PressureAssessment;
          } else {
            pressure = await resolvePressure();
            if (s.generation !== gen) {
              recordSuperseded();
              return;
            }
          }
          s.inFlight = null;
          s.result = result;
          s.pressure = pressure;
          s.draft = { text: "", origin: "user", resultGeneration: gen, approvedHash: null };
          if (live) {
            // Receipts are the source of dispatch identity and time: the
            // first receipt's dispatchedAt, never adapter completion time.
            // No receipt means the transport never ran: stay prepared.
            const status = receiptStatus();
            const at = receiptSentAt();
            s.payload =
              status === null || at === null
                ? { approvedText, status: "prepared" }
                : { approvedText, status, sentAt: at, adapterLabel: analyzerLabel };
          } else {
            s.payload = {
              approvedText,
              status: "dispatched",
              sentAt: new Date().toISOString(),
              adapterLabel: analyzerLabel,
            };
          }
          s.state = "completed";
          s.revision += 1;
        } catch (err: unknown) {
          if (s.generation !== gen) {
            recordSuperseded();
            return;
          }
          if (live) {
            const status = receiptStatus();
            const at = receiptSentAt();
            if (status !== null && at !== null) {
              s.payload = { approvedText, status, sentAt: at, adapterLabel: analyzerLabel };
            }
          } else if (dispatched) {
            s.payload = {
              approvedText,
              status: "dispatched",
              sentAt,
              adapterLabel: analyzerLabel,
            };
          } else if (!live) {
            // The entry-invoked payload above must never read "pending"
            // after the run settled without dispatching.
            s.payload = { approvedText, status: "failed", sentAt, adapterLabel: analyzerLabel };
          }
          fail(s, err);
          s.revision += 1;
        } finally {
          // Settle from this analysis's own receipts before dropping the
          // pending-send pointer. A verification rejection used to return
          // early and leave the approval-time "prepared" status behind a
          // confirmed send. An older generation must not write the payload.
          if (s.generation === gen && live) {
            const status = receiptStatus();
            const at = receiptSentAt();
            if (status !== null && at !== null) {
              s.payload = { approvedText, status, sentAt: at, adapterLabel: analyzerLabel };
            }
          }
          if (s.analyzePending === p) s.analyzePending = null;
          if (s.pendingSend === thisSend) s.pendingSend = null;
        }
      })();
      s.analyzePending = p;
      return p.then(() => snapshot(s));
    },

    editDraft(sessionId: string, text: string, opts?: MutationOpts): SessionSnapshot {
      const s = lookup(sessionId);
      checkRevision(s, opts);
      if (s.state !== "completed" || !s.result) throw new Error("no completed result: analyze first");
      s.draft = { text, origin: "user", resultGeneration: s.generation, approvedHash: null };
      s.revision += 1;
      return snapshot(s);
    },

    approveDraft(sessionId: string, text: string, opts?: MutationOpts): SessionSnapshot {
      const s = lookup(sessionId);
      checkRevision(s, opts);
      if (s.state !== "completed" || !s.result || !s.draft) throw new Error("no completed result: analyze first");
      if (s.draft.resultGeneration !== s.generation) throw new Error("no completed result: analyze first");
      if (text.length === 0) throw new Error("cannot approve an empty draft");
      if (text !== s.draft.text) throw new Error("draft changed; review again");
      s.draft.approvedHash = hashDraft(text);
      s.revision += 1;
      return snapshot(s);
    },

    rejectDraft(sessionId: string, opts?: MutationOpts): SessionSnapshot {
      const s = lookup(sessionId);
      checkRevision(s, opts);
      if (s.draft) s.draft.approvedHash = null;
      s.revision += 1;
      return snapshot(s);
    },

    reviewPressure(sessionId: string, itemId: string, opts?: MutationOpts): SessionSnapshot {
      const s = lookup(sessionId);
      if (!s.pressure) throw new Error("no current pressure assessment: analyze first");
      checkAssessment(s, opts);
      checkRevision(s, opts);
      if (!s.pressure.items.some((i) => i.id === itemId)) {
        throw new Error(`unknown pressure item: ${itemId}`);
      }
      if (!s.pressure.reviewed.includes(itemId)) {
        const reviewed = [...s.pressure.reviewed, itemId];
        s.pressure = {
          ...s.pressure,
          reviewed,
          allReviewed: s.pressure.items.every((i) => reviewed.includes(i.id)),
        };
      }
      s.revision += 1;
      return snapshot(s);
    },

    unreviewPressure(sessionId: string, itemId: string, opts?: MutationOpts): SessionSnapshot {
      const s = lookup(sessionId);
      if (!s.pressure) throw new Error("no current pressure assessment: analyze first");
      checkAssessment(s, opts);
      checkRevision(s, opts);
      if (!s.pressure.items.some((i) => i.id === itemId)) {
        throw new Error(`unknown pressure item: ${itemId}`);
      }
      s.pressure = {
        ...s.pressure,
        reviewed: s.pressure.reviewed.filter((id) => id !== itemId),
        allReviewed: false,
      };
      s.revision += 1;
      return snapshot(s);
    },

    expireApprovals(): void {
      for (const s of sessions.values()) {
        if (s.approvalToken !== null) s.approvalExpired = true;
      }
    },

    getState(sessionId: string): SessionSnapshot {
      return snapshot(lookup(sessionId));
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
