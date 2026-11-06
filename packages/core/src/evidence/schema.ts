/**
 * EvidenceBrief schema: typed entries the model produces, verified by code.
 * The model does the understanding; code only verifies (IDs exist, spans
 * are substrings, gates, caps). Model checks can only add flags, never
 * clear one.
 */

export type EntryCategory =
  | "decision"
  | "action_item"
  | "unresolved_question"
  | "owner_review"
  | "source_conflict";

export type Acceptance = "established" | "not_established";

export type Flag =
  | "missing_source"
  | "citation_not_found"
  | "conflicting_sources"
  | "commitment_language"
  | "request_not_accepted"
  | "region_spotcheck_failed"
  | "pressure"
  | "instruction_in_evidence";

/** Optional sub-region of a frame citation. All fields nullable. */
export interface FrameRegion {
  box: string | null;
  concept: string | null;
  maskRef: string | null;
  spotCheck: string | null;
}

/**
 * One citation: a transcript segment, or a frame with an optional
 * region. Non-applicable ids are null so the JSON Schema needs no
 * oneOf/allOf (see EVIDENCE_BRIEF_JSON_SCHEMA).
 */
export interface Citation {
  kind: "segment" | "frame";
  segmentId: string | null;
  frameId: string | null;
  region: FrameRegion | null;
}

export interface EvidenceEntry {
  id: string;
  category: EntryCategory;
  text: string;
  citations: Citation[];
  requester: string | null;
  assignee: string | null;
  acceptance: Acceptance | null;
  speaker: string | null;
  flags: Flag[];
}

/** Closed settings object (the brief schema allows no open maps). */
export interface EvidenceSettings {
  fixtureMode: boolean;
  maxCostUsdPerDay: number | null;
}

export interface EvidenceBrief {
  meetingId: string;
  model: string;
  promptVersion: string;
  settings: EvidenceSettings;
  entries: EvidenceEntry[];
  /** Ids of entries carrying at least one flag. */
  flagged: string[];
  /** ISO-8601 creation time. */
  createdAt: string;
}

export const ENTRY_CATEGORIES: readonly EntryCategory[] = [
  "decision",
  "action_item",
  "unresolved_question",
  "owner_review",
  "source_conflict",
];

export const FLAGS: readonly Flag[] = [
  "missing_source",
  "citation_not_found",
  "conflicting_sources",
  "commitment_language",
  "request_not_accepted",
  "region_spotcheck_failed",
  "pressure",
  "instruction_in_evidence",
];

/**
 * JSON Schema for EvidenceBrief in the strict subset:
 * root object; every object has `additionalProperties: false` with ALL
 * keys required (optional fields are nullable instead of omitted);
 * no oneOf/allOf/anyOf/not/$ref; nesting depth <= 10; no recursion.
 */
export const EVIDENCE_BRIEF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["meetingId", "model", "promptVersion", "settings", "entries", "flagged", "createdAt"],
  properties: {
    meetingId: { type: "string" },
    model: { type: "string" },
    promptVersion: { type: "string" },
    settings: {
      type: "object",
      additionalProperties: false,
      required: ["fixtureMode", "maxCostUsdPerDay"],
      properties: {
        fixtureMode: { type: "boolean" },
        maxCostUsdPerDay: { type: ["number", "null"] },
      },
    },
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "category",
          "text",
          "citations",
          "requester",
          "assignee",
          "acceptance",
          "speaker",
          "flags",
        ],
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: ["decision", "action_item", "unresolved_question", "owner_review", "source_conflict"],
          },
          text: { type: "string" },
          citations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "segmentId", "frameId", "region"],
              properties: {
                kind: { type: "string", enum: ["segment", "frame"] },
                segmentId: { type: ["string", "null"] },
                frameId: { type: ["string", "null"] },
                region: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  required: ["box", "concept", "maskRef", "spotCheck"],
                  properties: {
                    box: { type: ["string", "null"] },
                    concept: { type: ["string", "null"] },
                    maskRef: { type: ["string", "null"] },
                    spotCheck: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
          requester: { type: ["string", "null"] },
          assignee: { type: ["string", "null"] },
          acceptance: { type: ["string", "null"], enum: ["established", "not_established", null] },
          speaker: { type: ["string", "null"] },
          flags: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "missing_source",
                "citation_not_found",
                "conflicting_sources",
                "commitment_language",
                "request_not_accepted",
                "region_spotcheck_failed",
                "pressure",
                "instruction_in_evidence",
              ],
            },
          },
        },
      },
    },
    flagged: { type: "array", items: { type: "string" } },
    createdAt: { type: "string" },
  },
} as const;
