import { beforeEach, describe, expect, it } from "vitest";
import * as sp from "../src/t2/session-policy.js";
import { clearPolicy, evaluateOutgoing, resetAllPolicyState, submitGuidance } from "../src/t2/session-policy.js";

describe("P2c core policy generation", () => {
  beforeEach(() => resetAllPolicyState());

  it("P2c-2a the accessor exists as a function", () => {
    const acc = (sp as unknown as Record<string, unknown>)["getPolicyGeneration"];
    expect(typeof acc).toBe("function");
  });

  it("P2c-2b an unseen scope reads 0 and stays 0 when read twice", () => {
    const acc = (sp as unknown as Record<string, unknown>)["getPolicyGeneration"];
    expect(typeof acc).toBe("function");
    const getPolicyGeneration = acc as (ownerId: string, meetingId: string) => number;
    expect(getPolicyGeneration("o-unseen", "m-unseen")).toBe(0);
    expect(getPolicyGeneration("o-unseen", "m-unseen")).toBe(0);
  });

  it("P2c-2c guidance then clear advance only their own scope", () => {
    const acc = (sp as unknown as Record<string, unknown>)["getPolicyGeneration"];
    expect(typeof acc).toBe("function");
    const getPolicyGeneration = acc as (ownerId: string, meetingId: string) => number;
    submitGuidance("o1", "m1", "Do not share any dates.");
    expect(getPolicyGeneration("o1", "m1")).toBe(1);
    clearPolicy("o1", "m1");
    expect(getPolicyGeneration("o1", "m1")).toBe(2);
    expect(getPolicyGeneration("o1", "m2")).toBe(0);
    expect(getPolicyGeneration("o2", "m1")).toBe(0);
  });

  it("P2c-2d reading never changes the generation evaluateOutgoing reports", () => {
    const acc = (sp as unknown as Record<string, unknown>)["getPolicyGeneration"];
    expect(typeof acc).toBe("function");
    const getPolicyGeneration = acc as (ownerId: string, meetingId: string) => number;
    submitGuidance("o1", "m1", "Do not share any dates.");
    const first = evaluateOutgoing("o1", "m1", "hello", "turn");
    expect(first.generation).toBe(1);
    getPolicyGeneration("o1", "m1");
    getPolicyGeneration("o1", "m1");
    getPolicyGeneration("o1", "m1");
    const second = evaluateOutgoing("o1", "m1", "hello", "turn");
    expect(second.generation).toBe(1);
    expect(second.generation).toBe(getPolicyGeneration("o1", "m1"));
  });
});
