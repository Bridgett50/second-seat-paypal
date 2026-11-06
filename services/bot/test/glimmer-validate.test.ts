import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_LABELS,
  LABEL_ALIASES,
  extractGlimmerJson,
  validateGlimmerReply,
  validateGlimmerOutput,
} from "../src/private/redact.js";

function body(content: unknown, finishReason = "stop") {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
  };
}

describe("validateGlimmerReply", () => {
  it("accepts the documented example with exact UTF-16 offsets", () => {
    const input = "Call Ana at 555-0100";
    const parsed = {
      spans: [
        { start: 5, end: 8, label: "person" },
        { start: 12, end: 20, label: "phone" },
      ],
      boxes: [],
    };
    expect(input.slice(5, 8)).toBe("Ana");
    expect(input.slice(12, 20)).toBe("555-0100");
    const out = validateGlimmerReply(input, parsed);
    expect(out.spans).toHaveLength(2);
    expect(out.needsReview).toBe(false);
  });

  it("keeps two spans for a repeated entity (same phone twice)", () => {
    const input = "call 555-0100 then 555-0100";
    expect(input.slice(5, 13)).toBe("555-0100");
    expect(input.slice(19, 27)).toBe("555-0100");
    const out = validateGlimmerReply(input, {
      spans: [
        { start: 5, end: 13, label: "phone" },
        { start: 19, end: 27, label: "phone" },
      ],
      boxes: [],
    });
    expect(out.spans).toHaveLength(2);
    expect(out.needsReview).toBe(false);
  });

  it("uses UTF-16 code unit offsets after emoji", () => {
    // "🎉" is one code point but two UTF-16 code units.
    const input = "🎉 555-0100";
    expect("🎉".length).toBe(2);
    expect(input.slice(3, 11)).toBe("555-0100");
    const out = validateGlimmerReply(input, {
      spans: [{ start: 3, end: 11, label: "phone" }],
      boxes: [],
    });
    expect(out.spans).toHaveLength(1);
  });

  it("uses UTF-16 code unit offsets after accented text", () => {
    const input = "Café Ana 555-0100";
    expect(input.slice(5, 8)).toBe("Ana");
    expect(input.slice(9, 17)).toBe("555-0100");
    const out = validateGlimmerReply(input, {
      spans: [
        { start: 5, end: 8, label: "person" },
        { start: 9, end: 17, label: "phone" },
      ],
      boxes: [],
    });
    expect(out.spans).toHaveLength(2);
  });

  it("rejects the placeholder reply", () => {
    const input = "Call Ana at 555-0100";
    const parsed = JSON.parse('{"spans":[{"start":"n","end":"n","label":"s"}],"boxes":[]}');
    expect(() => validateGlimmerReply(input, parsed)).toThrow(
      "glimmer: span start/end must be integers",
    );
  });

  it("rejects unknown labels after aliasing", () => {
    expect(() =>
      validateGlimmerReply("hello world, this is long enough", {
        spans: [{ start: 0, end: 5, label: "SSN" }],
        boxes: [],
      }),
    ).toThrow('glimmer: unknown label "SSN"');
  });

  it("rejects out-of-range and inverted spans", () => {
    const input = "hello";
    expect(() => validateGlimmerReply(input, { spans: [{ start: 0, end: 50, label: "phone" }], boxes: [] })).toThrow(
      "glimmer: span out of range",
    );
    expect(() => validateGlimmerReply(input, { spans: [{ start: 3, end: 3, label: "phone" }], boxes: [] })).toThrow(
      "glimmer: span out of range",
    );
    expect(() => validateGlimmerReply(input, { spans: [{ start: -1, end: 2, label: "phone" }], boxes: [] })).toThrow(
      "glimmer: span out of range",
    );
  });

  it("requires spans and boxes arrays", () => {
    expect(() => validateGlimmerReply("hello", { spans: [] })).toThrow("glimmer: boxes must be an array");
    expect(() => validateGlimmerReply("hello", { boxes: [] })).toThrow("glimmer: spans must be an array");
    expect(() => validateGlimmerReply("hello", null)).toThrow("glimmer: output must be an object");
  });

  it("normalizes PHONE_NUMBER and EMAIL_ADDRESS, keeping originalLabel", () => {
    const input = "Ana ana@example.com 555-0100";
    const phoneStart = input.indexOf("555-0100");
    const emailStart = input.indexOf("ana@example.com");
    const out = validateGlimmerReply(input, {
      spans: [
        { start: emailStart, end: emailStart + "ana@example.com".length, label: "EMAIL_ADDRESS" },
        { start: phoneStart, end: phoneStart + "555-0100".length, label: "PHONE_NUMBER" },
      ],
      boxes: [],
    });
    expect(out.spans[0]).toMatchObject({ label: "email", originalLabel: "EMAIL_ADDRESS" });
    expect(out.spans[1]).toMatchObject({ label: "phone", originalLabel: "PHONE_NUMBER" });
  });

  it("aliasing is case-insensitive", () => {
    const input = "call 555-0100";
    const out = validateGlimmerReply(input, {
      spans: [{ start: 5, end: 13, label: "phone_number" }],
      boxes: [],
    });
    expect(out.spans[0]).toMatchObject({ label: "phone", originalLabel: "phone_number" });
  });

  it("empty spans list is valid but needs review", () => {
    const out = validateGlimmerReply("nothing sensitive here", { spans: [], boxes: [] });
    expect(out.spans).toEqual([]);
    expect(out.needsReview).toBe(true);
  });
});

describe("LABEL_ALIASES", () => {
  it("maps every documented alias to its canonical label", () => {
    expect(LABEL_ALIASES).toMatchObject({
      PHONE: "phone",
      PHONE_NUMBER: "phone",
      EMAIL: "email",
      EMAIL_ADDRESS: "email",
      PERSON: "person",
      PERSON_NAME: "person",
      NAME: "person",
      CREDIT_CARD: "credit_card",
      CREDIT_CARD_NUMBER: "credit_card",
      ACCOUNT_NUMBER: "account_number",
      BANK_ACCOUNT_NUMBER: "account_number",
      IBAN: "iban",
      ADDRESS: "address",
    });
    // Every alias target is an allowed label.
    for (const target of Object.values(LABEL_ALIASES)) {
      expect(ALLOWED_LABELS as readonly string[]).toContain(target);
    }
  });
});

describe("extractGlimmerJson malformed replies", () => {
  it("rejects truncated JSON", () => {
    expect(() => extractGlimmerJson(body('{"spans":[{"start":5'))).toThrow("glimmer: no JSON in reply");
  });

  it("rejects extra prose around the JSON", () => {
    expect(() =>
      extractGlimmerJson(body('Here is the result: {"spans":[],"boxes":[]} hope this helps')),
    ).toThrow("glimmer: no JSON in reply");
  });

  it("rejects unparsable JSON", () => {
    expect(() => extractGlimmerJson(body("{not json}"))).toThrow("glimmer: no JSON in reply");
  });

  it("rejects finish_reason=length with empty content", () => {
    expect(() => extractGlimmerJson(body("", "length"))).toThrow("glimmer: finish_reason=length");
  });

  it("rejects empty content without using reasoning fields", () => {
    expect(() =>
      extractGlimmerJson({
        choices: [
          {
            message: { content: "", reasoning: '{"spans":[],"boxes":[]}', reasoning_content: '{"spans":[],"boxes":[]}' },
            finish_reason: "stop",
          },
        ],
      }),
    ).toThrow("glimmer: no JSON in reply");
  });

  it("missing boxes is rejected at validation", () => {
    const parsed = extractGlimmerJson(body('{"spans":[]}'));
    expect(() => validateGlimmerReply("hello", parsed)).toThrow("glimmer: boxes must be an array");
  });
});

describe("validateGlimmerOutput compatibility", () => {
  it("normalizes aliases through the legacy entry point", () => {
    const input = "call 555-0100";
    const { spans } = validateGlimmerOutput(input, {
      spans: [{ start: 5, end: 13, label: "PHONE_NUMBER" }],
      boxes: [],
    });
    expect(spans).toEqual([{ start: 5, end: 13, label: "phone" }]);
  });
});

describe("glimmer system prompt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a concrete example, not the n/s placeholder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: '{"spans":[],"boxes":[]}' }, finish_reason: "stop" }] }),
        json: async () => ({}),
      })),
    );
    const { GlimmerClient } = await import("../src/private/redact.js");
    await new GlimmerClient("http://localhost:9").redactText("hello");
    const sent = JSON.parse((fetch as any).mock.calls[0][1].body);
    const system = (sent.messages as Array<{ role: string; content: string }>).find((m) => m.role === "system")!.content;
    expect(system).not.toContain('"start":n');
    expect(system).toContain("Call Ana at 555-0100");
    // Entity-text contract: the model returns the entity text + type and code
    // computes positions (model offsets landed a few characters off live).
    expect(system).toContain('{"text":"Ana","label":"person"},{"text":"555-0100","label":"phone"}');
    expect(system).not.toContain('"start":');
    for (const label of ALLOWED_LABELS) expect(system).toContain(label);
    expect(system).toContain("copied exactly");
  });
});
