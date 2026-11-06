/**
 * EvidenceBrief regression tests for `validateBrief`. No model calls,
 * no network: every brief and source is constructed inline.
 */
import { describe, expect, it } from "vitest";
import type { EvidenceBrief, EvidenceEntry } from "../src/evidence/schema.js";
import { validateBrief, type ValidateInput } from "../src/evidence/validate.js";

const BASE_INPUT: ValidateInput = {
  segments: [
    { id: "t-00:10", speaker: "Alice", text: "The budget is 100 dollars" },
    { id: "t-00:20", speaker: "Bob", text: "We are NOT moving the review" },
    { id: "t-00:30", speaker: "Alice", text: "We accept the offer" },
    { id: "t-00:40", speaker: "Bob", text: "The budget is 200 dollars" },
    { id: "t-00:50", speaker: "Alice", text: "We are moving the review to Friday" },
  ],
  frames: [{ id: "f-00:15" }],
};

function makeEntry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id: "e-1",
    category: "decision",
    text: "The budget is 100 dollars",
    citations: [{ kind: "segment", segmentId: "t-00:10", frameId: null, region: null }],
    requester: null,
    assignee: null,
    acceptance: null,
    speaker: "Alice",
    flags: [],
    ...overrides,
  };
}

function makeBrief(entries: EvidenceEntry[]): EvidenceBrief {
  return {
    meetingId: "m-1",
    model: "fixture",
    promptVersion: "v1",
    settings: { fixtureMode: true, maxCostUsdPerDay: null },
    entries,
    flagged: [],
    createdAt: "2026-10-26T00:00:00.000Z",
  };
}

describe("commitment language", () => {
  it("flags an accepting decision without changing its category", () => {
    const brief = makeBrief([
      makeEntry({
        category: "decision",
        text: "We accept the offer",
        citations: [{ kind: "segment", segmentId: "t-00:30", frameId: null, region: null }],
        speaker: "Alice",
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.category).toBe("decision");
    expect(result.entries[0]?.flags).toContain("commitment_language");
    expect(result.flagged).toContain("e-1");
  });

  it("flags commitment language quoted from a cited segment", () => {
    const brief = makeBrief([
      makeEntry({
        text: "Noted the vendor update",
        citations: [{ kind: "segment", segmentId: "t-00:30", frameId: null, region: null }],
        speaker: "Alice",
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.category).toBe("decision");
    expect(result.entries[0]?.flags).toContain("commitment_language");
  });

  it("keeps a commitment's category while flagging it for review", () => {
    const brief = makeBrief([
      makeEntry({ text: "We accept the offer", category: "action_item", acceptance: "established" }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.category).toBe("action_item");
    expect(result.entries[0]?.flags).toContain("commitment_language");
  });

  it('keeps a decision citing "we will deliver by Nov 30" as a decision with the flag', () => {
    const input: ValidateInput = {
      ...BASE_INPUT,
      segments: [
        ...BASE_INPUT.segments,
        { id: "t-00:60", speaker: "Alice", text: "We will deliver by Nov 30" },
      ],
    };
    const brief = makeBrief([
      makeEntry({
        category: "decision",
        text: "We will deliver by Nov 30",
        citations: [{ kind: "segment", segmentId: "t-00:60", frameId: null, region: null }],
        speaker: "Alice",
      }),
    ]);
    const result = validateBrief(brief, input);
    expect(result.entries[0]?.category).toBe("decision");
    expect(result.entries[0]?.flags).toContain("commitment_language");
    expect(result.flagged).toContain("e-1");
  });
});

describe("missing evidence", () => {
  it("flags entries with zero citations and moves them to flagged", () => {
    const brief = makeBrief([makeEntry({ citations: [] })]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("missing_source");
    expect(result.flagged).toContain("e-1");
  });
});

describe("conflicting sources", () => {
  it("flags an entry whose sources carry differing values", () => {
    const brief = makeBrief([
      makeEntry({
        text: "The budget figure",
        citations: [
          { kind: "segment", segmentId: "t-00:10", frameId: null, region: null },
          { kind: "segment", segmentId: "t-00:40", frameId: null, region: null },
        ],
        speaker: null,
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("conflicting_sources");
    expect(result.flagged).toContain("e-1");
  });
});

describe("request without acceptance", () => {
  it("recategorizes an unaccepted action_item to owner review", () => {
    const brief = makeBrief([
      makeEntry({
        category: "action_item",
        text: "Please send the invoice",
        acceptance: "not_established",
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.category).toBe("owner_review");
    expect(result.entries[0]?.flags).toContain("request_not_accepted");
    expect(result.flagged).toContain("e-1");
  });

  it("keeps an established action_item as-is", () => {
    const brief = makeBrief([
      makeEntry({ category: "action_item", acceptance: "established" }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.category).toBe("action_item");
    expect(result.entries[0]?.flags).not.toContain("request_not_accepted");
  });
});

describe("negation flip", () => {
  it('flags "moving the review" against "We are NOT moving the review"', () => {
    const brief = makeBrief([
      makeEntry({
        text: "We are moving the review to Friday",
        citations: [{ kind: "segment", segmentId: "t-00:20", frameId: null, region: null }],
        speaker: "Bob",
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("conflicting_sources");
    expect(result.flagged).toContain("e-1");
  });

  it('flags "We are NOT moving the review" against a positive source', () => {
    const brief = makeBrief([
      makeEntry({
        text: "We are NOT moving the review",
        citations: [{ kind: "segment", segmentId: "t-00:50", frameId: null, region: null }],
        speaker: "Alice",
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("conflicting_sources");
  });
});

describe("wrong speaker", () => {
  it("flags a citation when the speaker does not match the segment", () => {
    const brief = makeBrief([
      makeEntry({
        speaker: "Alice",
        citations: [{ kind: "segment", segmentId: "t-00:20", frameId: null, region: null }],
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("citation_not_found");
    expect(result.flagged).toContain("e-1");
  });
});

describe("relaxed speaker rule", () => {
  it("accepts an entry citing its speaker's line plus another person's reply", () => {
    const brief = makeBrief([
      makeEntry({
        speaker: "Alice",
        citations: [
          { kind: "segment", segmentId: "t-00:10", frameId: null, region: null },
          { kind: "segment", segmentId: "t-00:20", frameId: null, region: null },
        ],
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).not.toContain("citation_not_found");
  });

  it("flags an entry whose speaker said none of the cited lines", () => {
    const brief = makeBrief([
      makeEntry({
        speaker: "Alice",
        citations: [
          { kind: "segment", segmentId: "t-00:20", frameId: null, region: null },
          { kind: "segment", segmentId: "t-00:40", frameId: null, region: null },
        ],
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("citation_not_found");
  });

  it("flags an entry citing its speaker's line alongside an unknown segment id", () => {
    const brief = makeBrief([
      makeEntry({
        speaker: "Alice",
        citations: [
          { kind: "segment", segmentId: "t-00:10", frameId: null, region: null },
          { kind: "segment", segmentId: "t-99:99", frameId: null, region: null },
        ],
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("citation_not_found");
  });
});

describe("fabricated id t-99:99", () => {
  it("flags a citation to a segment that does not exist", () => {
    const brief = makeBrief([
      makeEntry({
        citations: [{ kind: "segment", segmentId: "t-99:99", frameId: null, region: null }],
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("citation_not_found");
    expect(result.flagged).toContain("e-1");
  });

  it("flags a citation to a frame that does not exist", () => {
    const brief = makeBrief([
      makeEntry({
        citations: [{ kind: "frame", segmentId: null, frameId: "f-99:99", region: null }],
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("citation_not_found");
  });
});

describe("region spotcheck", () => {
  it("adds a full-frame citation and flags a failed spotcheck", () => {
    const brief = makeBrief([
      makeEntry({
        citations: [
          {
            kind: "frame",
            segmentId: null,
            frameId: "f-00:15",
            region: { box: "0.1,0.1,0.2,0.2", concept: "slide", maskRef: null, spotCheck: "failed" },
          },
        ],
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("region_spotcheck_failed");
    expect(
      result.entries[0]?.citations.some(
        (citation) => citation.kind === "frame" && citation.frameId === "f-00:15" && citation.region === null,
      ),
    ).toBe(true);
  });

  it("flags a region box outside frame bounds", () => {
    const brief = makeBrief([
      makeEntry({
        citations: [
          {
            kind: "frame",
            segmentId: null,
            frameId: "f-00:15",
            region: { box: "0.9,0.9,0.5,0.5", concept: "slide", maskRef: null, spotCheck: "passed" },
          },
        ],
      }),
    ]);
    const result = validateBrief(brief, BASE_INPUT);
    expect(result.entries[0]?.flags).toContain("citation_not_found");
  });
});
