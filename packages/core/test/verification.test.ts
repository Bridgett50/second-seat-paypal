// Verification layer: each check is runVerification(ctx, work) -> { passed, feedback }
// and fails CLOSED. Pattern adapted from Meta's legal-agent-workshop
// (agent/VERIFICATION.md); see VERIFICATION.md at the repo root.
import { describe, expect, it } from "vitest";
import {
  VERIFICATION_POINTS,
  parseJudgeOutput,
  verifyBrief,
  verifyClaims,
  verifyRedaction,
  type EvidenceBrief,
} from "../src/index.js";

const segments = [
  { id: "t-00:05", speaker: "Dana", text: "We stay with the 8-inch box." },
  { id: "t-00:10", speaker: "Priya", text: "Can you send the artwork by Friday the 30th?" },
  { id: "t-00:15", speaker: "Marco", text: "Yes, I will send the artwork by Friday the 30th." },
];
const frames = [{ id: "f-01:10" }];
const ctx = { segments, frames, expectedMeetingId: "m1" };

function seg(id: string) {
  return { kind: "segment" as const, segmentId: id, frameId: null, region: null };
}

function brief(): EvidenceBrief {
  return {
    meetingId: "m1",
    model: "fixture",
    promptVersion: "v-test",
    settings: { fixtureMode: true, maxCostUsdPerDay: null },
    entries: [
      { id: "e1", category: "decision", text: "Stay with the 8-inch box.", citations: [seg("t-00:05")], requester: null, assignee: null, acceptance: null, speaker: "Dana", flags: [] },
      { id: "e2", category: "action_item", text: "Marco sends the artwork by Friday the 30th.", citations: [seg("t-00:10"), seg("t-00:15")], requester: "Priya", assignee: "Marco", acceptance: "established", speaker: "Marco", flags: [] },
    ],
    flagged: [],
    createdAt: "2026-10-28T00:00:00.000Z",
  };
}

describe("verifyBrief (fail-closed)", () => {
  it("passes a well-formed, fully grounded brief", () => {
    const r = verifyBrief(ctx, brief());
    expect(r.feedback).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.verified).not.toBeNull();
  });

  it.each([
    ["null", null],
    ["a string", "{\"meetingId\":\"m1\"}"],
    ["an array", []],
  ])("blocks non-object work (%s)", (_name, work) => {
    const r = verifyBrief(ctx, work);
    expect(r.passed).toBe(false);
    expect(r.verified).toBeNull();
    expect(r.feedback[0]).toMatch(/^structure: /);
  });

  it("blocks a missing required field, an extra key, and a bad enum, naming the path", () => {
    const b = brief() as unknown as Record<string, unknown>;
    delete b["createdAt"];
    (b as { extra?: number }).extra = 1;
    ((b["entries"] as Array<Record<string, unknown>>)[0] as Record<string, unknown>)["category"] = "note";
    const r = verifyBrief(ctx, b);
    expect(r.passed).toBe(false);
    expect(r.feedback).toContain("structure: $: missing required key createdAt");
    expect(r.feedback).toContain("structure: $: unexpected key extra");
    expect(r.feedback.some((f) => f.startsWith("structure: $.entries[0].category: "))).toBe(true);
  });

  it("blocks a meetingId that does not match the meeting under review", () => {
    const r = verifyBrief({ ...ctx, expectedMeetingId: "other" }, brief());
    expect(r.passed).toBe(false);
    expect(r.feedback).toEqual(["meeting: brief meetingId m1 does not match expected other"]);
  });

  it("blocks a citation to an unknown segment or frame", () => {
    const b = brief();
    b.entries[0]!.citations = [seg("t-99:99")];
    b.entries[1]!.citations.push({ kind: "frame", segmentId: null, frameId: "f-09:99", region: null });
    const r = verifyBrief(ctx, b);
    expect(r.passed).toBe(false);
    expect(r.feedback).toContain("entry e1: cites unknown segment t-99:99");
    expect(r.feedback).toContain("entry e2: cites unknown frame f-09:99");
  });

  it("blocks a citation whose id is null for its kind", () => {
    const b = brief();
    b.entries[0]!.citations = [{ kind: "segment", segmentId: null, frameId: null, region: null }];
    const r = verifyBrief(ctx, b);
    expect(r.feedback).toContain("entry e1: segment citation has no segmentId");
  });

  it("blocks an uncited entry presented as source-backed, but allows a declared missing_source", () => {
    const b = brief();
    b.entries[0]!.citations = [];
    expect(verifyBrief(ctx, b).feedback).toEqual([
      "entry e1: presented as source-backed without citations (no missing_source flag)",
    ]);
    b.entries[0]!.flags = ["missing_source"];
    b.flagged = ["e1"];
    const r = verifyBrief(ctx, b);
    expect(r.passed).toBe(true);
    expect(r.escalations).toContainEqual({ entryId: "e1", reason: "missing_source" });
  });

  it("blocks duplicate entry ids and dangling flagged ids", () => {
    const b = brief();
    b.entries[1]!.id = "e1";
    b.flagged = ["e9"];
    const r = verifyBrief(ctx, b);
    expect(r.feedback).toContain("entry e1: duplicate entry id");
    expect(r.feedback).toContain("flagged: references unknown entry e9");
  });

  it("escalates (does not block) an action item whose acceptance is not established", () => {
    const b = brief();
    b.entries[1]!.acceptance = "not_established";
    const r = verifyBrief(ctx, b);
    expect(r.passed).toBe(true);
    expect(r.escalations).toContainEqual({ entryId: "e2", reason: "request_not_accepted" });
    expect(r.verified!.entries[1]!.category).toBe("owner_review");
  });

  it("escalates a number in the entry text that no cited segment states", () => {
    const b = brief();
    b.entries[0]!.text = "Stay with the 10-inch box.";
    const r = verifyBrief(ctx, b);
    expect(r.passed).toBe(true);
    expect(r.escalations).toContainEqual({ entryId: "e1", reason: "ungrounded_number:10" });
  });

  it("does not treat 01 and 1 as the same number", () => {
    const b = brief();
    b.entries[0]!.text = "Use code 01.";
    const r = verifyBrief(ctx, b);
    expect(r.passed).toBe(true);
    expect(r.escalations).toContainEqual({ entryId: "e1", reason: "ungrounded_number:01" });
  });

  it("escalates numbers when the only citation is a frame", () => {
    const b = brief();
    b.entries = [
      {
        ...b.entries[0]!,
        text: "Ship 99 units.",
        citations: [{ kind: "frame", segmentId: null, frameId: "f-01:10", region: null }],
      },
    ];
    const r = verifyBrief(ctx, b);
    expect(r.passed).toBe(true);
    expect(r.escalations).toContainEqual({ entryId: "e1", reason: "ungrounded_number:99" });
  });

  it("returns verified null when a hard rule fails", () => {
    const r = verifyBrief({ ...ctx, expectedMeetingId: "other" }, brief());
    expect(r.passed).toBe(false);
    expect(r.verified).toBeNull();
  });

  it("blocks an unreadable context instead of throwing", () => {
    expect(() => verifyBrief(null as never, brief())).not.toThrow();
    const missing = verifyBrief(null as never, brief());
    expect(missing.passed).toBe(false);
    expect(missing.verified).toBeNull();
    expect(missing.feedback[0]).toMatch(/context unreadable/);
    const badSegment = verifyBrief({ segments: [null], frames: [] } as never, brief());
    expect(badSegment.passed).toBe(false);
    expect(badSegment.verified).toBeNull();
  });

  it("does not mutate the work under review", () => {
    const b = brief();
    b.entries[1]!.acceptance = "not_established";
    const before = JSON.stringify(b);
    verifyBrief(ctx, b);
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe("verifyClaims (fail-closed)", () => {
  const ok = JSON.stringify({ grade: "supported", missing_qualifier: null });

  it("passes when every entry has a readable 'supported' verdict", () => {
    const r = verifyClaims({ entryIds: ["e1", "e2"] }, { verdicts: { e1: ok, e2: { grade: "supported", missing_qualifier: null } } });
    expect(r).toMatchObject({ passed: true, feedback: [] });
  });

  it("blocks a partial or unsupported verdict, naming the entry and qualifier", () => {
    const r = verifyClaims(
      { entryIds: ["e1", "e2"] },
      { verdicts: { e1: { grade: "partial", missing_qualifier: "plus tax and freight" }, e2: { grade: "unsupported", missing_qualifier: null } } },
    );
    expect(r.passed).toBe(false);
    expect(r.feedback).toEqual([
      "entry e1: partially supported; a missing qualifier was reported",
      "entry e2: not supported by its cited spans",
    ]);
    expect(r.feedback.join("\n")).not.toContain("plus tax and freight");
  });

  it("blocks a supported grade that still names a qualifier, without echoing it", () => {
    const r = verifyClaims(
      { entryIds: ["e1"] },
      { verdicts: { e1: { grade: "supported", missing_qualifier: "plus tax and freight" } } },
    );
    expect(r.passed).toBe(false);
    expect(r.feedback).toEqual(["entry e1: supported grade contradicts a missing qualifier"]);
    expect(r.feedback.join("\n")).not.toContain("plus tax");
  });

  it("blocks an empty entry list", () => {
    const r = verifyClaims({ entryIds: [] }, { verdicts: {} });
    expect(r.passed).toBe(false);
    expect(r.feedback[0]).toMatch(/no entries/);
  });

  it.each([
    ["empty string", ""],
    ["truncated JSON", "{\"grade\":\"supp"],
    ["prose", "The claim looks supported."],
    ["null", null],
    ["array", ["supported"]],
    ["unknown grade", { grade: "mostly", missing_qualifier: null }],
    ["wrong case", { grade: "Supported", missing_qualifier: null }],
    ["missing key", { grade: "supported" }],
    ["extra key", { grade: "supported", missing_qualifier: null, note: "x" }],
    ["qualifier wrong type", { grade: "partial", missing_qualifier: 3 }],
  ])("blocks malformed judge output (%s): an unreadable verdict never passes", (_n, raw) => {
    const r = verifyClaims({ entryIds: ["e1"] }, { verdicts: { e1: raw } });
    expect(r.passed).toBe(false);
    expect(r.feedback).toHaveLength(1);
    expect(r.feedback[0]).toMatch(/^entry e1: judge output unreadable \(.+\): blocked \(fail-closed\)$/);
  });

  it("blocks a missing verdict and a verdict for an unknown entry", () => {
    const r = verifyClaims({ entryIds: ["e1"] }, { verdicts: { e2: ok } });
    expect(r.feedback).toEqual(["entry e1: no judge verdict: blocked (fail-closed)", "verdict e2: no such entry"]);
  });

  it("blocks when work itself is unreadable", () => {
    expect(verifyClaims({ entryIds: ["e1"] }, null as never).passed).toBe(false);
  });

  it("blocks an unreadable entry list instead of throwing", () => {
    expect(() => verifyClaims(null as never, { verdicts: {} })).not.toThrow();
    expect(verifyClaims(null as never, { verdicts: {} }).passed).toBe(false);
    expect(verifyClaims({ entryIds: "e1" as never }, { verdicts: {} }).passed).toBe(false);
  });

  it("parseJudgeOutput accepts only the strict support shape", () => {
    expect(parseJudgeOutput(ok)).toEqual({ ok: true, grade: "supported", missingQualifier: null });
    expect(parseJudgeOutput("nope").ok).toBe(false);
  });
});

describe("verifyRedaction (fail-closed)", () => {
  const rawText = "Call Ana Bell at 555-0100 today.";
  const spans = [
    { start: 5, end: 13, label: "person" },
    { start: 17, end: 25, label: "phone" },
  ];
  const masked = "Call [REDACTED_person] at [REDACTED_phone] today.";
  const cleanScan = () => null;

  it("passes when every span is gone and the residual scan is clean, and still requires owner review", () => {
    const r = verifyRedaction({ rawText, spans, residualScan: cleanScan }, { maskedText: masked });
    expect(r).toMatchObject({ passed: true, feedback: [], ownerReviewRequired: true });
  });

  it("blocks when no residual scanner is configured", () => {
    const r = verifyRedaction({ rawText, spans }, { maskedText: masked });
    expect(r.passed).toBe(false);
    expect(r.feedback).toEqual(["redaction: no residual-PII scanner configured: blocked (fail-closed)"]);
  });

  it("blocks a span whose text survives masking, without echoing the PII", () => {
    const r = verifyRedaction({ rawText, spans, residualScan: cleanScan }, { maskedText: "Call Ana Bell at [REDACTED_phone] today." });
    expect(r.passed).toBe(false);
    expect(r.feedback).toEqual(["span 0 (person): original text still present in masked text"]);
    expect(r.feedback.join("\n")).not.toContain("Ana");
  });

  it.each([
    ["different case", "Call ana bell at [REDACTED_phone] today."],
    ["collapsed whitespace", "Call Ana  Bell at [REDACTED_phone] today."],
    ["a zero-width character", "Call Ana\u200B Bell at [REDACTED_phone] today."],
  ])("blocks a span that survives as %s, without echoing the text", (_name, maskedText) => {
    const r = verifyRedaction({ rawText, spans, residualScan: cleanScan }, { maskedText });
    expect(r.passed).toBe(false);
    expect(r.feedback[0]).toBe("span 0 (person): original text still present in masked text");
    expect(r.feedback.join("\n")).not.toMatch(/ana bell/i);
  });

  it("blocks out-of-range or inverted spans", () => {
    const r = verifyRedaction(
      { rawText, spans: [{ start: 10, end: 5, label: "person" }, { start: 0, end: 999, label: "phone" }], residualScan: cleanScan },
      { maskedText: masked },
    );
    expect(r.feedback).toEqual(["span 0 (person): invalid range", "span 1 (phone): invalid range"]);
  });

  it("blocks when the residual scanner finds PII, passing person names to it", () => {
    let seenNames: string[] = [];
    const scan = (_t: string, names: string[]) => {
      seenNames = names;
      return "email";
    };
    const r = verifyRedaction({ rawText, spans, residualScan: scan }, { maskedText: masked });
    expect(r.feedback).toEqual(["redaction: residual email detected in masked text"]);
    expect(seenNames).toEqual(["Ana Bell"]);
  });

  it("blocks when the residual scanner throws (an unreadable scan never passes)", () => {
    const r = verifyRedaction({ rawText, spans, residualScan: () => { throw new Error("boom"); } }, { maskedText: masked });
    expect(r.feedback).toEqual(["redaction: residual-PII scanner failed: blocked (fail-closed)"]);
  });

  it("blocks unreadable work", () => {
    expect(verifyRedaction({ rawText, spans, residualScan: cleanScan }, {} as never).passed).toBe(false);
  });
});

describe("VERIFICATION_POINTS registry", () => {
  it("lists one point per check with the Meta-style columns", () => {
    expect(VERIFICATION_POINTS.map((p) => p.check)).toEqual(["verifyRedaction", "verifyBrief", "verifyClaims"]);
    for (const p of VERIFICATION_POINTS) {
      expect(p.when.length).toBeGreaterThan(0);
      expect(p.file).toMatch(/^packages\/core\/src\/verification\/verify\w+\.ts$/);
      expect(p.onFailure).toMatch(/blocked/i);
    }
  });
});
