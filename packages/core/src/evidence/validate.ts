/**
 * Deterministic brief validators: existence and rule checks over an
 * EvidenceBrief against its transcript segments and frames.
 *
 * `validateBrief` can only ADD flags (never clear one), add full-frame
 * citations, and recategorize entries to `owner_review`. It never proves
 * support and makes no model or network calls.
 */
import type { Citation, EvidenceBrief, EvidenceEntry, Flag } from "./schema.js";
import { classifyIncoming, screenOutgoing } from "../safeguards/outgoing.js";

/** Minimal transcript segment shape needed for validation. */
export interface ValidateSegment {
  id: string;
  speaker: string;
  text: string;
}

/** Minimal frame shape needed for validation. */
export interface ValidateFrame {
  id: string;
}

/** Evidence sources a brief is validated against. */
export interface ValidateInput {
  segments: ValidateSegment[];
  frames: ValidateFrame[];
}

/** Words that negate a nearby claim, so a mismatch signals a flip. */
const NEGATION_PATTERN =
  /\b(not|never|no|cannot|can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|unable|refus\w*|declin\w*|reject\w*)\b|n't\b/i;

const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;

/** Box edge tolerance for normalized coordinates. */
const EPS = 1e-9;

function addFlag(entry: EvidenceEntry, flag: Flag): void {
  if (!entry.flags.includes(flag)) {
    entry.flags.push(flag);
  }
}

function hasNegation(text: string): boolean {
  return NEGATION_PATTERN.test(text);
}

/** First-person future promise ("we will deliver ..."). */
const FUTURE_COMMITMENT_PATTERN = /\b(we|i)\s+will\b/i;

/** True when the text reads as a binding offer/request or commitment. */
function isBinding(text: string): boolean {
  if (FUTURE_COMMITMENT_PATTERN.test(text)) {
    return true;
  }
  if (classifyIncoming(text).kind !== "neutral") {
    return true;
  }
  return !screenOutgoing(text).allowed;
}

/** Parse a region box into four numbers, or null when malformed. */
function parseBox(box: string): [number, number, number, number] | null {
  const parts = box.split(/[\s,]+/).filter((part) => part.length > 0);
  if (parts.length !== 4) {
    return null;
  }
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isFinite(n))) {
    return null;
  }
  return numbers as [number, number, number, number];
}

/**
 * True when a region box lies inside normalized frame bounds
 * (`x,y,w,h` in `[0,1]` with `x + w <= 1` and `y + h <= 1`).
 */
function boxInsideBounds(box: string): boolean {
  const parsed = parseBox(box);
  if (parsed === null) {
    return false;
  }
  const [x, y, w, h] = parsed;
  return (
    x >= -EPS &&
    y >= -EPS &&
    w > EPS &&
    h > EPS &&
    x <= 1 + EPS &&
    y <= 1 + EPS &&
    x + w <= 1 + EPS &&
    y + h <= 1 + EPS
  );
}

function numbersIn(text: string): string[] {
  return text.match(NUMBER_PATTERN) ?? [];
}

/**
 * Validate a brief against its sources. Returns a new brief: flags only
 * added, `flagged` only grown, entries recategorized to `owner_review`
 * only for `request_not_accepted` and `commitment_language`.
 */
export function validateBrief(brief: EvidenceBrief, input: ValidateInput): EvidenceBrief {
  const segments = new Map(input.segments.map((segment) => [segment.id, segment]));
  const frames = new Map(input.frames.map((frame) => [frame.id, frame]));

  const entries = brief.entries.map((entry): EvidenceEntry => {
    const next: EvidenceEntry = {
      ...entry,
      citations: entry.citations.map((citation) => ({
        ...citation,
        region: citation.region === null ? null : { ...citation.region },
      })),
      flags: [...entry.flags],
    };

    if (next.citations.length === 0) {
      addFlag(next, "missing_source");
    }

    const citedSegments: ValidateSegment[] = [];
    for (const citation of next.citations) {
      if (citation.kind === "segment") {
        const segment = citation.segmentId === null ? undefined : segments.get(citation.segmentId);
        if (segment === undefined) {
          addFlag(next, "citation_not_found");
        } else {
          citedSegments.push(segment);
        }
      } else {
        const frame = citation.frameId === null ? undefined : frames.get(citation.frameId);
        if (frame === undefined) {
          addFlag(next, "citation_not_found");
          continue;
        }
        if (citation.region !== null) {
          if (citation.region.box === null || !boxInsideBounds(citation.region.box)) {
            addFlag(next, "citation_not_found");
          }
          if (citation.region.spotCheck !== "passed") {
            addFlag(next, "region_spotcheck_failed");
            const hasFullFrame = next.citations.some(
              (other: Citation) =>
                other.kind === "frame" && other.frameId === citation.frameId && other.region === null,
            );
            if (!hasFullFrame) {
              next.citations.push({
                kind: "frame",
                segmentId: null,
                frameId: citation.frameId,
                region: null,
              });
            }
          }
        }
      }
    }

    if (
      next.speaker !== null &&
      citedSegments.length > 0 &&
      citedSegments.every((segment) => segment.speaker !== next.speaker)
    ) {
      addFlag(next, "citation_not_found");
    }

    if (next.category === "action_item" && next.acceptance !== "established") {
      addFlag(next, "request_not_accepted");
      next.category = "owner_review";
    }

    const citedBinding = citedSegments.some((segment) => isBinding(segment.text));
    if (isBinding(next.text) || citedBinding) {
      addFlag(next, "commitment_language");
    }

    const entryNegated = hasNegation(next.text);
    if (citedSegments.some((segment) => hasNegation(segment.text) !== entryNegated)) {
      addFlag(next, "conflicting_sources");
    }
    if (citedSegments.length > 1) {
      const segmentNegations = new Set(citedSegments.map((segment) => hasNegation(segment.text)));
      const valueSets = new Set(
        citedSegments.map((segment) => JSON.stringify(numbersIn(segment.text))),
      );
      if (segmentNegations.size > 1 || valueSets.size > 1) {
        addFlag(next, "conflicting_sources");
      }
    }

    return next;
  });

  const flagged = [...brief.flagged];
  for (const entry of entries) {
    if (entry.flags.length > 0 && !flagged.includes(entry.id)) {
      flagged.push(entry.id);
    }
  }

  return { ...brief, entries, flagged };
}
