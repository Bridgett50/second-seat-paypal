/**
 * Persuasion Shield (Phase 04b): deterministic persuasion-tactic labels
 * plus a gate that forces owner review and holds any approval.
 *
 * The model (Spark classifier in services/bot) proposes tactic labels;
 * this module only verifies: a label counts only when its `span` is a
 * substring of the cited segment. Verified pressure adds the `pressure`
 * flag and forces `owner_review`. Separately, `gateApproval` reuses
 * `screenOutgoing` to hold approval language. Nothing here makes model
 * or network calls.
 */
import type { EvidenceBrief, EvidenceEntry } from "./schema.js";
import { screenOutgoing } from "../safeguards/outgoing.js";

export type PressureTactic =
  | "authority"
  | "commitment"
  | "liking"
  | "reciprocity"
  | "scarcity"
  | "social_proof"
  | "unity"
  | "none";

export const PRESSURE_TACTICS: readonly PressureTactic[] = [
  "authority",
  "commitment",
  "liking",
  "reciprocity",
  "scarcity",
  "social_proof",
  "unity",
  "none",
];

export type PressureSource = "pattern" | "spark" | "fixture";

/** One tactic claim about a transcript segment. `span` must be a substring. */
export interface PressureLabel {
  segmentId: string;
  tactic: PressureTactic;
  ask: string;
  target: string;
  span: string;
  source: PressureSource;
}

/** Minimal segment shape needed to verify label spans. */
export interface PressureSegment {
  id: string;
  text: string;
}

export interface ApplyPressureInput {
  brief: EvidenceBrief;
  segments: PressureSegment[];
}

export interface ApplyPressureOptions {
  /** Run the approval gate over verified spans. Default true. */
  gate?: boolean;
}

export interface VerifiedLabel {
  label: PressureLabel;
  /** True when `span` is a substring of the cited segment. */
  verified: boolean;
  /** True when the gate held this label's span as approval language. */
  held: boolean;
}

export interface ApplyPressureResult {
  brief: EvidenceBrief;
  labels: VerifiedLabel[];
  /** Always true: any verified pressure forces owner review. */
  ownerReview: boolean;
  approvalsHeld: number;
}

/** Deterministic approval gate: holds text that reads as an approval. */
export function gateApproval(text: string): { held: boolean; reason?: string } {
  const screened = screenOutgoing(text);
  if (screened.allowed) {
    return { held: false };
  }
  const out: { held: boolean; reason?: string } = { held: true };
  if (screened.reason !== undefined) {
    out.reason = screened.reason;
  }
  return out;
}

function addPressure(entry: EvidenceEntry): void {
  if (!entry.flags.includes("pressure")) {
    entry.flags.push("pressure");
  }
  entry.category = "owner_review";
}

function cites(entry: EvidenceEntry, segmentId: string): boolean {
  return entry.citations.some(
    (citation) => citation.kind === "segment" && citation.segmentId === segmentId,
  );
}

/**
 * Apply pressure labels to a brief: verify each `span` is a substring of
 * the cited segment; verified pressure adds the `pressure` flag and forces
 * `owner_review` on citing entries; the gate (default on) additionally
 * holds any verified span that reads as approval language.
 */
export function applyPressure(
  input: ApplyPressureInput,
  labels: PressureLabel[],
  opts?: ApplyPressureOptions,
): ApplyPressureResult {
  const gate = opts?.gate ?? true;
  const byId = new Map(input.segments.map((segment) => [segment.id, segment.text]));
  const verified: VerifiedLabel[] = [];
  let approvalsHeld = 0;

  for (const label of labels) {
    if (label.tactic === "none") {
      continue;
    }
    const text = byId.get(label.segmentId);
    const ok = text !== undefined && label.span !== "" && text.includes(label.span);
    let held = false;
    if (ok && gate) {
      held = gateApproval(label.span).held;
      if (held) {
        approvalsHeld += 1;
      }
    }
    verified.push({ label, verified: ok, held });
    if (!ok) {
      continue;
    }
    for (const entry of input.brief.entries) {
      if (cites(entry, label.segmentId)) {
        addPressure(entry);
      }
    }
  }

  const flagged = new Set(input.brief.flagged);
  for (const entry of input.brief.entries) {
    if (entry.flags.length > 0) {
      flagged.add(entry.id);
    }
  }
  input.brief.flagged = [...flagged];

  return { brief: input.brief, labels: verified, ownerReview: true, approvalsHeld };
}

interface TacticPattern {
  tactic: Exclude<PressureTactic, "none">;
  pattern: RegExp;
}

/** Deterministic per-tactic markers. First match per tactic wins. */
const TACTIC_PATTERNS: readonly TacticPattern[] = [
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

/**
 * Deterministic pattern layer: returns one `pattern`-sourced label per
 * tactic whose marker matches, with `span` set to the matched substring.
 * Returns no labels for neutral text.
 */
export function detectPressurePatterns(text: string, segmentId = ""): PressureLabel[] {
  const labels: PressureLabel[] = [];
  for (const { tactic, pattern } of TACTIC_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[0] !== undefined) {
      labels.push({
        segmentId,
        tactic,
        ask: text.trim(),
        target: "owner",
        span: match[0],
        source: "pattern",
      });
    }
  }
  return labels;
}
