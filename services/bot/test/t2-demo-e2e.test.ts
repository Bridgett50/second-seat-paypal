import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_STEP_IDS } from "../src/t2-room.js";
import {
  assertDemoFinalState,
  runDemoEndToEnd,
} from "../src/t2-room.js";

const repoSecondSeat = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

describe("t2 demo end to end", () => {
  it("T18-1 the headless run completes every demo step once and in order", async () => {
    const state = await runDemoEndToEnd({ search: "?demo=1" });
    expect(state.started).toBe(true);
    expect([...state.stepsCompleted]).toEqual([...DEMO_STEP_IDS]);
    expect(new Set(state.stepsCompleted).size).toBe(DEMO_STEP_IDS.length);
    expect(state.stepsCompleted[state.stepsCompleted.length - 1]).toBe(
      "demo-takeover",
    );
    expect(state.transportCalls).toBe(1);
    expect(state.twinStatus).toBe("paused (you took over)");
  });

  it("T18-2 the final state passes assertDemoFinalState with no failures", async () => {
    const state = await runDemoEndToEnd({ search: "?demo=1" });
    const check = assertDemoFinalState(state);
    expect(check.failures).toEqual([]);
    expect(check.ok).toBe(true);
    expect(state.assertions.length).toBeGreaterThan(0);
    expect(state.assertions.every((a) => a.ok)).toBe(true);
  });

  it("T18-3 assertDemoFinalState reports a failure when a step is skipped or repeated", async () => {
    const state = await runDemoEndToEnd({ search: "?demo=1" });
    expect(assertDemoFinalState(state).ok).toBe(true);

    const skipped = {
      ...state,
      stepsCompleted: state.stepsCompleted.filter((id) => id !== "demo-send"),
    };
    const skippedCheck = assertDemoFinalState(skipped);
    expect(skippedCheck.ok).toBe(false);
    expect(skippedCheck.failures.length).toBeGreaterThan(0);

    const repeated = {
      ...state,
      stepsCompleted: [...state.stepsCompleted, "demo-send"],
    };
    const repeatedCheck = assertDemoFinalState(repeated);
    expect(repeatedCheck.ok).toBe(false);
    expect(repeatedCheck.failures.length).toBeGreaterThan(0);
  });

  it("T18-4 assertDemoFinalState reports a failure when the package is sent without approval or evidence is missing", async () => {
    const state = await runDemoEndToEnd({ search: "?demo=1" });
    expect(assertDemoFinalState(state).ok).toBe(true);

    const unapproved = { ...state, approved: false };
    const unapprovedCheck = assertDemoFinalState(unapproved);
    expect(unapprovedCheck.ok).toBe(false);
    expect(unapprovedCheck.failures.length).toBeGreaterThan(0);

    const noEvidence = { ...state, evidence: null, evidenceJson: null };
    const noEvidenceCheck = assertDemoFinalState(noEvidence);
    expect(noEvidenceCheck.ok).toBe(false);
    expect(noEvidenceCheck.failures.length).toBeGreaterThan(0);
  });

  it("T18-5 a run without demo=1 refuses to start the guided flow", async () => {
    for (const search of ["?demo=0", "", "?x=1"]) {
      const state = await runDemoEndToEnd({ search });
      expect(state.started).toBe(false);
      expect(state.stepsCompleted).toEqual([]);
      expect(state.transportCalls).toBe(0);
      expect(state.transportBodies).toEqual([]);
      expect(state.approved).toBe(false);
      expect(assertDemoFinalState(state).ok).toBe(false);
    }
  });

  // T18-6 moved to session B (holo demo-e2e script/README not ported)
});
