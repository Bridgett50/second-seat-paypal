import { describe, expect, it } from "vitest";
import { screenOutgoing, classifyIncoming } from "../src/index.js";

describe("screenOutgoing blocks commitment language", () => {
  it("blocks the exact phrase: We accept your offer.", () => {
    const result = screenOutgoing("We accept your offer.");
    expect(result.allowed).toBe(false);
  });

  it("blocks the exact phrase: Approved. Please proceed with the purchase.", () => {
    const result = screenOutgoing("Approved. Please proceed with the purchase.");
    expect(result.allowed).toBe(false);
  });

  it("blocks bare acceptance variants", () => {
    expect(screenOutgoing("we accept").allowed).toBe(false);
    expect(screenOutgoing("Accepted.").allowed).toBe(false);
    expect(screenOutgoing("I accept your offer.").allowed).toBe(false);
  });

  it("blocks approve combined with proceed", () => {
    expect(screenOutgoing("Approved, please proceed.").allowed).toBe(false);
  });

  it("blocks go-ahead with purchase/order/payment", () => {
    expect(screenOutgoing("Go ahead with the purchase.").allowed).toBe(false);
    expect(screenOutgoing("Go ahead with the order.").allowed).toBe(false);
    expect(screenOutgoing("Go ahead with the payment.").allowed).toBe(false);
  });
});

describe("screenOutgoing stays negation-safe and allows neutral text", () => {
  const allowedCases = [
    "I can't accept that on Bridgett's behalf.",
    "Bridgett will review the offer.",
    "We cannot accept these terms.",
    "Bridgett will never approve a purchase sight unseen.",
    "Thanks for sharing the details.",
    "Could you send the agenda before we meet?",
    "We need more time to review.",
  ];

  for (const text of allowedCases) {
    it(`allows: ${JSON.stringify(text)}`, () => {
      expect(screenOutgoing(text).allowed).toBe(true);
    });
  }
});

describe("screenOutgoing scopes negation to its own clause", () => {
  it("blocks when a later clause commits despite an earlier negation", () => {
    expect(
      screenOutgoing("I cannot attend tomorrow. I accept your offer.").allowed,
    ).toBe(false);
  });

  it("blocks approve+proceed despite an earlier negated clause", () => {
    expect(
      screenOutgoing("We will not proceed. Approved, please proceed.").allowed,
    ).toBe(false);
  });

  it("allows negation inside the same clause as the commitment", () => {
    expect(screenOutgoing("I can't accept your offer.").allowed).toBe(true);
  });
});

describe("classifyIncoming", () => {
  it("labels offers", () => {
    expect(classifyIncoming("Here is our offer on the house.").kind).toBe("offer");
  });

  it("labels requests", () => {
    expect(classifyIncoming("Could you send the agenda?").kind).toBe("request");
  });

  it("labels anything else neutral", () => {
    expect(classifyIncoming("Thanks for sharing the details.").kind).toBe("neutral");
  });
});
