/**
 * verifyBrief: fail-closed structural + grounding check for an evidence
 * brief before anyone presents it as source-backed.
 *
 * Blocks (passed=false) on anything that would make a source-backed claim
 * unverifiable: malformed structure (walked against
 * EVIDENCE_BRIEF_JSON_SCHEMA, read as data), a meetingId for a different
 * meeting, a citation to a segment or frame that does not exist, a
 * citation with no id for its kind, an uncited entry without the
 * missing_source flag, duplicate entry ids, and `flagged` naming an entry
 * that does not exist.
 *
 * Everything heuristic is an ESCALATION, not a block: the existing
 * validateBrief flags (unchanged) plus one verification-only rule
 * (`ungrounded_number:N`, a number in the entry text that none of its
 * cited segments state). Escalations route the entry to the owner; they
 * never silently pass it as verified-and-clean.
 *
 * Pattern (one entry point, refuse with per-item feedback) adapted from
 * Meta's legal-agent-workshop agent/verification/verify_memo.py; see
 * VERIFICATION.md. Independent implementation.
 */
import {
  EVIDENCE_BRIEF_JSON_SCHEMA,
  type EvidenceBrief,
  type EvidenceEntry,
} from "../evidence/schema.js";
import { validateBrief, type ValidateFrame, type ValidateSegment } from "../evidence/validate.js";
import type { VerificationResult } from "./types.js";

export interface BriefVerificationContext {
  segments: ValidateSegment[];
  frames: ValidateFrame[];
  /** When set, the brief must be for exactly this meeting. */
  expectedMeetingId?: string;
}

export interface Escalation {
  entryId: string;
  /** A Flag name, or `ungrounded_number:<n>`. */
  reason: string;
}

export interface BriefVerification extends VerificationResult {
  /** The validateBrief output when the hard rules pass; null when blocked on structure. */
  verified: EvidenceBrief | null;
  /** Entries routed to the owner (one row per entry and reason), in entry order. */
  escalations: Escalation[];
}

const MAX_STRUCTURE_FEEDBACK = 25;

type Schema = {
  type?: string | string[];
  enum?: readonly unknown[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: Schema;
};

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "non-finite";
  return typeof value;
}

/** Walk `value` against the strict schema subset, appending problems. */
function walk(schema: Schema, value: unknown, path: string, out: string[]): void {
  if (out.length >= MAX_STRUCTURE_FEEDBACK) return;
  const allowed = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = typeOf(value);
  if (allowed.length > 0 && !allowed.includes(actual)) {
    out.push(`structure: ${path}: expected ${allowed.join(" or ")}, got ${actual}`);
    return;
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    out.push(`structure: ${path}: value not in allowed set`);
    return;
  }
  if (actual === "object" && schema.properties !== undefined) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) out.push(`structure: ${path}: missing required key ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) out.push(`structure: ${path}: unexpected key ${key}`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) walk(sub, obj[key], `${path}.${key}`, out);
    }
  }
  if (actual === "array" && schema.items !== undefined) {
    (value as unknown[]).forEach((item, i) => walk(schema.items as Schema, item, `${path}[${i}]`, out));
  }
}

const NUMBER_RE = /\d+(?:\.\d+)?/g;

/** Raw digit tokens. "01" and "1" stay distinct. */
function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(NUMBER_RE)) out.add(m[0]);
  return out;
}

function ungroundedNumbers(entry: EvidenceEntry, byId: Map<string, ValidateSegment>): string[] {
  const cited = entry.citations
    .filter((c) => c.kind === "segment" && c.segmentId !== null)
    .map((c) => byId.get(c.segmentId as string))
    .filter((s): s is ValidateSegment => s !== undefined);
  const entryNums = [...numbersIn(entry.text)];
  // A frame-only citation has no segment text to ground a number against.
  if (cited.length === 0) return entryNums;
  const stated = new Set<string>();
  for (const s of cited) for (const n of numbersIn(s.text)) stated.add(n);
  return entryNums.filter((n) => !stated.has(n));
}

function briefContextOk(ctx: BriefVerificationContext | null | undefined): ctx is BriefVerificationContext {
  if (ctx == null || typeof ctx !== "object") return false;
  if (!Array.isArray(ctx.segments) || !Array.isArray(ctx.frames)) return false;
  for (const segment of ctx.segments) {
    if (segment == null || typeof segment !== "object" || typeof segment.id !== "string" || typeof segment.text !== "string") {
      return false;
    }
  }
  for (const frame of ctx.frames) {
    if (frame == null || typeof frame !== "object" || typeof frame.id !== "string") return false;
  }
  return true;
}

export function verifyBrief(ctx: BriefVerificationContext, work: unknown): BriefVerification {
  if (!briefContextOk(ctx)) {
    return {
      passed: false,
      feedback: ["brief: context unreadable: blocked (fail-closed)"],
      verified: null,
      escalations: [],
    };
  }
  const structure: string[] = [];
  walk(EVIDENCE_BRIEF_JSON_SCHEMA as unknown as Schema, work, "$", structure);
  if (structure.length > 0) {
    return { passed: false, feedback: structure, verified: null, escalations: [] };
  }
  const brief = work as EvidenceBrief;
  const feedback: string[] = [];

  if (ctx.expectedMeetingId !== undefined && brief.meetingId !== ctx.expectedMeetingId) {
    feedback.push(`meeting: brief meetingId ${brief.meetingId} does not match expected ${ctx.expectedMeetingId}`);
  }

  const segmentById = new Map(ctx.segments.map((s) => [s.id, s]));
  const frameIds = new Set(ctx.frames.map((f) => f.id));
  const seen = new Set<string>();
  for (const entry of brief.entries) {
    if (seen.has(entry.id)) feedback.push(`entry ${entry.id}: duplicate entry id`);
    seen.add(entry.id);
    for (const c of entry.citations) {
      if (c.kind === "segment") {
        if (c.segmentId === null) feedback.push(`entry ${entry.id}: segment citation has no segmentId`);
        else if (!segmentById.has(c.segmentId)) feedback.push(`entry ${entry.id}: cites unknown segment ${c.segmentId}`);
      } else {
        if (c.frameId === null) feedback.push(`entry ${entry.id}: frame citation has no frameId`);
        else if (!frameIds.has(c.frameId)) feedback.push(`entry ${entry.id}: cites unknown frame ${c.frameId}`);
      }
    }
    if (entry.citations.length === 0 && !entry.flags.includes("missing_source")) {
      feedback.push(`entry ${entry.id}: presented as source-backed without citations (no missing_source flag)`);
    }
  }
  for (const id of brief.flagged) {
    if (!seen.has(id)) feedback.push(`flagged: references unknown entry ${id}`);
  }

  // validateBrief clones entries; the work under review is never mutated.
  const verified = validateBrief(brief, { segments: ctx.segments, frames: ctx.frames });
  const escalations: Escalation[] = [];
  for (const entry of verified.entries) {
    for (const flag of entry.flags) escalations.push({ entryId: entry.id, reason: flag });
    for (const n of ungroundedNumbers(entry, segmentById)) {
      escalations.push({ entryId: entry.id, reason: `ungrounded_number:${n}` });
    }
  }
  const passed = feedback.length === 0;
  return { passed, feedback, verified: passed ? verified : null, escalations };
}
