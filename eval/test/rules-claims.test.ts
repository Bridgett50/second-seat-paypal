/**
 * Fail-closed claims check vs a fail-open reference.
 *
 * Contrast: Meta legal-agent-workshop agent/verification/verify_claims.py
 * L50-54 (commit 2a8efc8) returns passed=True when the judgement cannot be
 * read. Second Seat's verifyClaims blocks instead. failOpenReference models
 * the workshop behaviour from its description (no code copied; the
 * workshop has no LICENSE).
 */
import { describe, expect, it } from "vitest";
import { verifyClaims } from "@second-seat/core";
import { CORRUPTIONS, claimsCases, failOpenReference, loadVerdicts, runClaimsCase } from "../rules/claims.mjs";

const verdicts = loadVerdicts();
const results = claimsCases(verdicts).map(runClaimsCase);

describe("claims check: malformed judge output", () => {
  it("loads the 13 recorded support verdicts", () => {
    expect(verdicts.length).toBe(13);
  });

  it("blocks a malformed judge output (fail-closed), where the fail-open reference passes it", () => {
    const raw = '{"grade": "supp'; // truncated mid-stream
    const closed = verifyClaims({ entryIds: ["e1"] }, { verdicts: { e1: raw } });
    expect(closed.passed).toBe(false);
    expect(closed.feedback[0]).toMatch(/unreadable.*fail-closed/);
    expect(failOpenReference(["e1"], { e1: raw }).passed).toBe(true);
  });

  it("blocks every corruption of every verdict", () => {
    const malformed = results.filter((r) => r.kind === "malformed");
    expect(malformed.length).toBe(verdicts.length * CORRUPTIONS.length);
    expect(malformed.filter((r) => !r.failClosedBlocked).map((r) => `${r.entryId}:${r.corruption}`)).toEqual([]);
  });

  it("the fail-open reference lets unreadable outputs through (the contrast)", () => {
    const unreadable = results.filter((r) =>
      ["truncated", "prose_wrapped", "code_fenced", "empty", "null_literal", "array_wrapped"].includes(r.corruption ?? ""),
    );
    expect(unreadable.length).toBeGreaterThan(0);
    expect(unreadable.every((r) => r.failClosedBlocked && !r.failOpenBlocked)).toBe(true);
  });

  it("blocks a missing verdict", () => {
    const missing = results.filter((r) => r.kind === "missing_verdict");
    expect(missing.every((r) => r.failClosedBlocked)).toBe(true);
    expect(missing.some((r) => r.failOpenBlocked)).toBe(false);
  });

  it("well-formed verdicts: blocks exactly the partial/unsupported ones", () => {
    const well = results.filter((r) => r.kind === "well_formed");
    expect(well.length).toBe(verdicts.length);
    for (const r of well) expect(r.failClosedBlocked).toBe(r.grade !== "supported");
    expect(well.some((r) => r.grade === "supported")).toBe(true);
  });
});
