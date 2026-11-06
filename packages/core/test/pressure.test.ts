import { describe, expect, it } from "vitest";
import {
  applyPressure,
  detectPressurePatterns,
  gateApproval,
  type EvidenceBrief,
} from "../src/index.js";

function briefFor(segmentId: string, text: string): EvidenceBrief {
  return {
    meetingId: "pressure-test",
    model: "test",
    promptVersion: "test",
    settings: { fixtureMode: true, maxCostUsdPerDay: null },
    entries: [
      {
        id: "e1",
        category: "action_item",
        text,
        citations: [{ kind: "segment", segmentId, frameId: null, region: null }],
        requester: null,
        assignee: null,
        acceptance: null,
        speaker: null,
        flags: [],
      },
    ],
    flagged: [],
    createdAt: new Date(0).toISOString(),
  };
}

const SEG = { id: "t-00:01", text: "Only 2 spots remaining, so act now before it's gone." };

describe("applyPressure span verification", () => {
  it("accepts a span that is a substring of the cited segment", () => {
    const labels = detectPressurePatterns(SEG.text, SEG.id);
    expect(labels.length).toBeGreaterThan(0);
    const result = applyPressure({ brief: briefFor(SEG.id, SEG.text), segments: [SEG] }, labels);
    expect(result.labels.every((l) => l.verified)).toBe(true);
  });

  it("rejects a span that is not a substring and adds no flag", () => {
    const brief = briefFor(SEG.id, SEG.text);
    const result = applyPressure({ brief, segments: [SEG] }, [
      { segmentId: SEG.id, tactic: "scarcity", ask: "buy", target: "owner", span: "words never said", source: "spark" },
    ]);
    expect(result.labels[0]!.verified).toBe(false);
    expect(brief.entries[0]!.flags).not.toContain("pressure");
  });
});

describe("applyPressure forcing", () => {
  it("adds the pressure flag and forces owner_review", () => {
    const brief = briefFor(SEG.id, SEG.text);
    applyPressure({ brief, segments: [SEG] }, detectPressurePatterns(SEG.text, SEG.id));
    expect(brief.entries[0]!.flags).toContain("pressure");
    expect(brief.entries[0]!.category).toBe("owner_review");
    expect(brief.flagged).toContain("e1");
  });
});

describe("gateApproval", () => {
  it("holds approval language", () => {
    expect(gateApproval("Approved. Please proceed with the purchase.").held).toBe(true);
  });

  it("holds nothing when the gate option is off", () => {
    const brief = briefFor("s", "Approved. Please proceed with the purchase.");
    const result = applyPressure(
      { brief, segments: [{ id: "s", text: "Approved. Please proceed with the purchase." }] },
      [],
      { gate: false },
    );
    expect(result.approvalsHeld).toBe(0);
  });
});

describe("neutral text gets no badge", () => {
  it("#55-like neutral line: no pattern labels, gate allows", () => {
    const text = "The meeting is scheduled for Tuesday at 3pm in room B.";
    expect(detectPressurePatterns(text, "s")).toEqual([]);
    expect(gateApproval(text).held).toBe(false);
  });
});
