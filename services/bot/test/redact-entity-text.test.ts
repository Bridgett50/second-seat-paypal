/**
 * Glimmer redaction uses the entity TEXT, not model-supplied offsets.
 *
 * Failure shapes reproduced from a live smoke test (all data below is
 * made up): the model's character offsets landed a few characters off
 * ("[REDACTED_phone]7 or[REDACTED_email]ample", a date label landing on
 * "$24,"), and only the first occurrence of a repeated name was masked, so
 * the privacy gate refused to send. No network or model calls: every
 * Glimmer reply comes from an injected fake fetch.
 */
import { describe, expect, it } from "vitest";
import {
  GLIMMER_RESPONSE_SCHEMA,
  GLIMMER_SYSTEM_PROMPT,
  GlimmerClient,
  findEntityOccurrences,
  parseGlimmerAnswer,
  validateGlimmerReply,
} from "../src/private/redact.js";
import { backstopContactSpans, createPrivacyGate, findResidualPII } from "../src/private/gate.js";

const NAME = "Rhea Castellano";
const PHONE = "555-0187";
const EMAIL = "rhea.castellano@lumenparts.example";
const TRANSCRIPT = [
  `${NAME} (Lumen Parts): Thanks for joining. You can reach me at ${PHONE} or ${EMAIL}.`,
  `${NAME}: We can do the pilot at $24,000 for 3 months, starting December 3.`,
  "You: We still need our security review before we sign anything.",
  `${NAME}: Honestly, this price is a last chance. It expires tonight.`,
  `${NAME}: You already agreed on the last call that you would sign this week.`,
].join("\n");

function fakeFetch(content: string): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (!u.endsWith("/v1/chat/completions")) throw new Error(`unexpected url ${u}`);
    return new Response(
      JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

/** The observed misaligned-offset reply shape (offsets only, no text). */
function misalignedOffsetReply(input: string): string {
  const p = input.indexOf(PHONE);
  const e = input.indexOf(EMAIL);
  const money = input.indexOf("$24,");
  return JSON.stringify({
    spans: [
      { start: 0, end: NAME.length, label: "person" },
      // end one short: leaves the last phone digit visible
      { start: p, end: p + PHONE.length - 1, label: "phone" },
      // shifted left by one: covers the preceding space, leaves "ample"
      { start: e - 1, end: e + EMAIL.length - 5, label: "email" },
      // a date label that lands on money instead of "December 3"
      { start: money - 8, end: money + 4, label: "date_of_birth" },
    ],
    boxes: [],
  });
}

/** Same entities, but carrying the entity text with the wrong offsets. */
function misalignedTextReply(input: string): string {
  const p = input.indexOf(PHONE);
  const e = input.indexOf(EMAIL);
  const money = input.indexOf("$24,");
  return JSON.stringify({
    spans: [
      { text: NAME, label: "person", start: 0, end: NAME.length },
      { text: PHONE, label: "phone", start: p, end: p + PHONE.length - 1 },
      { text: EMAIL, label: "email", start: e - 1, end: e + EMAIL.length - 5 },
      { text: "December 3", label: "date_of_birth", start: money - 8, end: money + 4 },
    ],
    boxes: [],
  });
}

function textOnlyReply(): string {
  return JSON.stringify({
    spans: [
      { text: NAME, label: "person" },
      { text: PHONE, label: "phone" },
      { text: EMAIL, label: "email" },
      { text: "December 3", label: "date_of_birth" },
    ],
    boxes: [],
  });
}

describe("prompt and schema ask for entity text + type", () => {
  it("the frozen prompt asks for text and label, not offsets", () => {
    expect(GLIMMER_SYSTEM_PROMPT).toContain('"text":"Ana"');
    expect(GLIMMER_SYSTEM_PROMPT).not.toContain('"start":');
    const items = (GLIMMER_RESPONSE_SCHEMA.schema as any).properties.spans.items;
    expect(items.required).toEqual(["text", "label"]);
    expect(items.properties.text).toEqual({ type: "string" });
  });
});

describe("findEntityOccurrences", () => {
  it("finds every case-sensitive exact occurrence on token boundaries", () => {
    const text = "Ana met Ana. Banana and ana are not Ana's matches? Ana";
    const hits = findEntityOccurrences(text, "Ana", "person").map((h) => text.slice(h.start, h.end));
    expect(hits).toEqual(["Ana", "Ana", "Ana", "Ana"]);
    expect(findEntityOccurrences(text, "Ana", "person").map((h) => h.start)).toEqual([0, 8, 36, 51]);
  });

  it("matches phones by digits across formatting", () => {
    const text = "call 555-0187, or (555) 0187, or 555.0187; not 555-01878";
    const hits = findEntityOccurrences(text, "555 0187", "phone").map((h) => text.slice(h.start, h.end));
    expect(hits).toEqual(["555-0187", "(555) 0187", "555.0187"]);
  });

  it("matches emails case-insensitively", () => {
    const text = "write rhea.castellano@lumenparts.example or Rhea.Castellano@LumenParts.example";
    const hits = findEntityOccurrences(text, "RHEA.castellano@lumenparts.EXAMPLE", "email");
    expect(hits).toHaveLength(2);
  });

  it("returns nothing for text the input does not contain", () => {
    expect(findEntityOccurrences(TRANSCRIPT, "Rhea Castelano", "person")).toEqual([]);
  });
});

describe("validateGlimmerReply with entity text", () => {
  it("realigns a span whose slice does not match its entity text and masks every occurrence", () => {
    const out = validateGlimmerReply(TRANSCRIPT, JSON.parse(misalignedTextReply(TRANSCRIPT)));
    const slices = out.spans.map((s) => `${s.label}:${TRANSCRIPT.slice(s.start, s.end)}`);
    expect(slices.filter((s) => s === `person:${NAME}`)).toHaveLength(4);
    expect(slices).toContain(`phone:${PHONE}`);
    expect(slices).toContain(`email:${EMAIL}`);
    expect(slices).toContain("date_of_birth:December 3");
    expect(slices.some((s) => s.includes("$24"))).toBe(false);
    for (const s of out.spans) expect(TRANSCRIPT.slice(s.start, s.end)).toBe(s.text);
  });

  it("rejects an entity whose text is not in the input, without masking anything for it", () => {
    const out = validateGlimmerReply(TRANSCRIPT, {
      spans: [
        { text: "Rhea Castelano", label: "person" },
        { text: PHONE, label: "phone" },
      ],
      boxes: [],
    });
    expect(out.spans.map((s) => s.label)).toEqual(["phone"]);
    expect(out.rejected).toEqual([{ text: "Rhea Castelano", label: "person", reason: "entity text not found in input" }]);
    expect(out.needsReview).toBe(true);
  });

  it("still rejects bad labels and empty text", () => {
    expect(() => validateGlimmerReply(TRANSCRIPT, { spans: [{ text: NAME, label: "ssn_x" }], boxes: [] })).toThrow(
      'glimmer: unknown label "ssn_x"',
    );
    expect(() => validateGlimmerReply(TRANSCRIPT, { spans: [{ text: "", label: "person" }], boxes: [] })).toThrow(
      "glimmer: span text must be a non-empty string",
    );
  });

  it("parseGlimmerAnswer returns code-computed positions for every occurrence", () => {
    const { spans } = parseGlimmerAnswer(TRANSCRIPT, textOnlyReply(), "stop");
    expect(spans.filter((s) => s.label === "person")).toHaveLength(4);
    for (const s of spans) expect(s.end).toBeGreaterThan(s.start);
  });
});

describe("GlimmerClient.redactText (fake transport)", () => {
  for (const [name, reply] of [
    ["text-only reply", () => textOnlyReply()],
    ["text with misaligned offsets", () => misalignedTextReply(TRANSCRIPT)],
  ] as const) {
    it(`${name}: masks every name occurrence, the whole phone and email, and the date (not money)`, async () => {
      const client = new GlimmerClient("http://glimmer.invalid", { fetchImpl: fakeFetch(reply()) });
      const { maskedText } = await client.redactText(TRANSCRIPT);
      expect(maskedText).not.toContain("Rhea");
      expect(maskedText).not.toContain("Castellano");
      expect(maskedText).not.toContain("0187");
      expect(maskedText).not.toContain("lumenparts");
      expect(maskedText).not.toMatch(/\]\d|\]ample|or\[/);
      expect(maskedText).toContain("$24,000");
      expect(maskedText).toContain("[REDACTED_date_of_birth]");
      expect(maskedText.split("[REDACTED_person]")).toHaveLength(5);
      expect(maskedText).toContain("at [REDACTED_phone] or [REDACTED_email].");
      expect(findResidualPII(maskedText, [NAME])).toBeNull();
    });
  }

  it("legacy offset reply: every occurrence of a correctly aligned name is masked", async () => {
    const client = new GlimmerClient("http://glimmer.invalid", { fetchImpl: fakeFetch(misalignedOffsetReply(TRANSCRIPT)) });
    const { maskedText } = await client.redactText(TRANSCRIPT);
    expect(maskedText).not.toContain(NAME);
  });
});

describe("regex backstop for phone and email (before the residual-PII check)", () => {
  it("backstopContactSpans finds phones and emails deterministically", () => {
    const spans = backstopContactSpans(TRANSCRIPT).map((s) => `${s.label}:${TRANSCRIPT.slice(s.start, s.end)}`);
    expect(spans).toEqual([`phone:${PHONE}`, `email:${EMAIL}`]);
  });

  it("live gate: misaligned offsets from the model still yield a sendable, fully masked text", async () => {
    process.env["GLIMMER_BASE_URL"] = "http://glimmer.invalid";
    try {
      const redactor = new GlimmerClient("http://glimmer.invalid", { fetchImpl: fakeFetch(misalignedOffsetReply(TRANSCRIPT)) });
      const gate = createPrivacyGate({ mode: "live", redactor });
      const prepared = await gate.prepare(TRANSCRIPT);
      expect(prepared.redactedText).not.toContain("0187");
      expect(prepared.redactedText).not.toContain("lumenparts");
      expect(prepared.redactedText).not.toContain(NAME);
      // no leftover tails of a half-masked phone or email (a legacy date
      // span landing on money over-masks it; that is safe, not a leak)
      expect(prepared.redactedText).not.toMatch(/\[REDACTED_phone\]\d|\[REDACTED_email\]ample/);
      expect(prepared.redactedText).toContain("at [REDACTED_phone] or");
      expect(findResidualPII(prepared.redactedText)).toBeNull();
      const token = gate.approve(prepared.runId, prepared.redactedText);
      let sent = "";
      await gate.send(prepared.runId, token, async (g) => {
        sent = g.text;
      });
      expect(sent).toBe(prepared.redactedText);
    } finally {
      delete process.env["GLIMMER_BASE_URL"];
    }
  });

  it("the PII guard stays strict: a name the model missed is still refused", async () => {
    process.env["GLIMMER_BASE_URL"] = "http://glimmer.invalid";
    try {
      const redactor = new GlimmerClient("http://glimmer.invalid", { fetchImpl: fakeFetch(textOnlyReply()) });
      const gate = createPrivacyGate({ mode: "live", redactor });
      const prepared = await gate.prepare(TRANSCRIPT);
      const edited = `${prepared.redactedText}\nRhea Castellano: one more thing.`;
      gate.correct(prepared.runId, edited);
      const token = gate.approve(prepared.runId, edited);
      await expect(gate.send(prepared.runId, token, async () => "sent")).rejects.toThrow(/residual PII/);
      const phoneBack = `${prepared.redactedText}\ncall 555-0187`;
      gate.correct(prepared.runId, phoneBack);
      const token2 = gate.approve(prepared.runId, phoneBack);
      await expect(gate.send(prepared.runId, token2, async () => "sent")).rejects.toThrow(/residual PII/);
    } finally {
      delete process.env["GLIMMER_BASE_URL"];
    }
  });
});
