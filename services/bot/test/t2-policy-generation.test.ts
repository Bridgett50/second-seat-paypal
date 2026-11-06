import { describe, expect, it } from "vitest";
import * as core from "@second-seat/core";
import * as room from "../src/t2-room.js";

describe("P2c public policy generation", () => {
  it("P2c-1a the public package exports getPolicyGeneration as a function", () => {
    const acc = (core as unknown as Record<string, unknown>)["getPolicyGeneration"];
    expect(typeof acc).toBe("function");
  });

  it("P2c-1b t2-room re-exports the same function and an unseen scope reads 0", () => {
    const coreAcc = (core as unknown as Record<string, unknown>)["getPolicyGeneration"];
    expect(typeof coreAcc).toBe("function");
    const roomAcc = (room as unknown as Record<string, unknown>)["getPolicyGeneration"];
    expect(typeof roomAcc).toBe("function");
    expect(roomAcc).toBe(coreAcc);
    const getPolicyGeneration = coreAcc as (ownerId: string, meetingId: string) => number;
    expect(getPolicyGeneration("o-unseen", "m-unseen")).toBe(0);
  });

  it("P2c-3 internal session-policy mutators stay off the public surface", () => {
    const names = ["resetAllPolicyState", "clearPolicy", "submitGuidance", "holdCandidate", "releaseHeld"] as const;
    for (const name of names) {
      expect(name in core).toBe(false);
      expect(name in room).toBe(false);
    }
  });
});
