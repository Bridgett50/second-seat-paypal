import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_LABELS,
  MockRedactor,
  extractGlimmerJson,
  maskText,
  normalizeGlimmerLabel,
  validateGlimmerReply,
} from "../src/private/redact.js";
import { createPrivacyGate } from "../src/private/gate.js";

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const out: T[][] = [];
  arr.forEach((v, i) => {
    for (const rest of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) {
      out.push([v, ...rest]);
    }
  });
  return out;
}

describe("maskText merging", () => {
  it("merges nested spans regardless of order", () => {
    const a = [
      { start: 0, end: 13, label: "person" },
      { start: 0, end: 5, label: "person" },
    ];
    const b = [...a].reverse();
    for (const spans of [a, b]) {
      const out = maskText("Alice Johnson called", spans);
      expect(out).toBe("[REDACTED_person] called");
      expect(out).not.toContain("Johnson");
      expect(out).not.toContain("Alice");
    }
  });

  it("collapses duplicates, merges overlap, keeps adjacency separate", () => {
    const text = "Alice Johnson";
    const dup = maskText(text, [
      { start: 0, end: 5, label: "person" },
      { start: 0, end: 5, label: "person" },
    ]);
    expect(dup).toBe("[REDACTED_person] Johnson");
    const overlap = maskText(text, [
      { start: 0, end: 8, label: "person" },
      { start: 5, end: 13, label: "person" },
    ]);
    expect(overlap).toBe("[REDACTED_person]");
    const adjacent = maskText(text, [
      { start: 0, end: 5, label: "person" },
      { start: 5, end: 6, label: "person" },
    ]);
    expect(adjacent).toBe("[REDACTED_person][REDACTED_person]Johnson");
  });

  it("throws on out-of-range spans and is order-invariant", () => {
    expect(() =>
      maskText("hi", [{ start: 0, end: 99, label: "person" }]),
    ).toThrow("maskText: span out of range");
    const spans = [
      { start: 0, end: 5, label: "person" },
      { start: 5, end: 6, label: "person" },
      { start: 0, end: 8, label: "person" },
      { start: 5, end: 13, label: "person" },
    ];
    const outputs = new Set(
      permutations(spans).map((p) => maskText("Alice Johnson", p)),
    );
    expect(outputs.size).toBe(1);
  });
});

describe("unicode spans", () => {
  const text = "Zoë 😀 Park"; // emoji occupies UTF-16 units 4..6, "Park" is 7..11
  it("accepts a span covering Park", () => {
    const r = validateGlimmerReply(text, {
      spans: [{ start: 7, end: 11, label: "person" }],
      boxes: [],
    });
    expect(r.spans).toHaveLength(1);
  });

  it("rejects a span ending inside the emoji", () => {
    expect(() =>
      validateGlimmerReply(text, {
        spans: [{ start: 4, end: 5, label: "person" }],
        boxes: [],
      }),
    ).toThrow();
  });
});

describe("labels", () => {
  it("normalizes aliases to canonical labels", () => {
    for (const raw of ["PHONE", "PHONE_NUMBER", "phone", "Phone"]) {
      expect(normalizeGlimmerLabel(raw)).toBe("phone");
    }
    for (const raw of ["DOB", "DATE_OF_BIRTH", "BIRTHDATE", "BIRTH_DATE"]) {
      expect(normalizeGlimmerLabel(raw)).toBe("date_of_birth");
    }
    expect(normalizeGlimmerLabel("DATE")).toBe("date");
    expect(normalizeGlimmerLabel("date")).toBe("date");
  });

  it("keeps originalLabel and rejects bad labels", () => {
    const r = validateGlimmerReply("Call Ana at 555-0100", {
      spans: [{ start: 12, end: 20, label: "PHONE_NUMBER" }],
      boxes: [],
    });
    expect(r.spans[0]?.label).toBe("phone");
    expect(r.spans[0]?.originalLabel).toBe("PHONE_NUMBER");
    expect(() =>
      validateGlimmerReply("hello world", {
        spans: [{ start: 0, end: 5, label: "ssn_x" }],
        boxes: [],
      }),
    ).toThrow();
    expect(() =>
      validateGlimmerReply("hello world", {
        spans: [{ start: "n", end: 5, label: "person" }],
        boxes: [],
      }),
    ).toThrow();
    expect(() =>
      validateGlimmerReply("hello world", {
        spans: [{ start: 0, end: 5, label: "s" }],
        boxes: [],
      }),
    ).toThrow();
    expect(() =>
      validateGlimmerReply("hello", { boxes: [] }),
    ).toThrow();
    expect(() =>
      validateGlimmerReply("hello", {
        spans: [{ start: 0, end: 99, label: "person" }],
        boxes: [],
      }),
    ).toThrow();
  });
});

function fixtureTexts(): string[] {
  const dir = fileURLToPath(new URL("../fixtures/pii/", import.meta.url));
  const raw = readFileSync(dir + "cases.json", "utf8");
  const parsed: unknown = JSON.parse(raw);
  const entries: unknown[] = Array.isArray(parsed)
    ? parsed
    : (parsed as { cases?: unknown[] }).cases ?? [parsed];
  const texts: string[] = [];
  for (const e of entries) {
    if (typeof e === "string") {
      texts.push(e);
      continue;
    }
    if (typeof e === "object" && e !== null) {
      const o = e as Record<string, unknown>;
      for (const k of ["text", "input", "transcript", "content", "prompt"]) {
        if (typeof o[k] === "string") texts.push(o[k] as string);
      }
      for (const k of ["file", "path", "name"]) {
        const v = o[k];
        if (typeof v === "string" && v.endsWith(".txt")) {
          texts.push(readFileSync(dir + v.split("/").pop(), "utf8"));
        }
      }
    }
  }
  return texts;
}

describe("fixture cases", () => {
  it("every MockRedactor span label is allowed; dates covered as date_of_birth", async () => {
    const allowed = new Set<string>(ALLOWED_LABELS as readonly string[]);
    const texts = fixtureTexts();
    expect(texts.length).toBeGreaterThan(0);
    const redactor = new MockRedactor();
    for (const text of texts) {
      const r = await redactor.redactText(text);
      for (const s of r.spans) expect(allowed.has(s.label)).toBe(true);
    }
    for (const date of ["March 14, 1988", "07/22/1991"]) {
      const holder =
        texts.find((t) => t.includes(date)) ??
        `Born ${date} in Springfield`;
      const r = await redactor.redactText(holder);
      const covering = r.spans.filter(
        (s) =>
          s.label === "date_of_birth" &&
          holder.slice(s.start, s.end) === date,
      );
      expect(covering.length).toBeGreaterThan(0);
    }
  });
});

function choiceBody(message: unknown, finish = "stop"): unknown {
  return {
    choices: [{ finish_reason: finish, message }],
  };
}

describe("extractGlimmerJson", () => {
  it("throws on length, empty, reasoning-only, and blank content", () => {
    expect(() =>
      extractGlimmerJson(
        choiceBody({ content: '{"spans":[],"boxes":[]}' }, "length"),
      ),
    ).toThrow();
    expect(() => extractGlimmerJson(choiceBody({ content: "" }))).toThrow();
    expect(() =>
      extractGlimmerJson(
        choiceBody({ reasoning: '{"spans":[],"boxes":[]}' }),
      ),
    ).toThrow();
    expect(() => extractGlimmerJson(choiceBody({ content: "   " }))).toThrow();
  });
});

describe("gate review", () => {
  it("empty spans need review and are never PII-free", async () => {
    expect(
      validateGlimmerReply("hello", { spans: [], boxes: [] }).needsReview,
    ).toBe(true);
    const gate = createPrivacyGate({
      mode: "fixture",
      redactor: new MockRedactor(),
    });
    const prepared = await gate.prepare("hello there");
    expect(prepared.needsReview).toBe(true);
    expect(prepared.piiFree).toBe(false);
  });
});
