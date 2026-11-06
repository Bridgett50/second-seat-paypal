import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error untyped helper module
import { annotateOccurrences, scoreSpans, summarize, wilson } from "../scripts/redaction-eval-lib.mjs";
// @ts-expect-error untyped helper module
import { runEval } from "../scripts/redaction-eval-runner.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("wilson", () => {
  it("returns [0,0] for n=0", () => {
    expect(wilson(0, 0)).toEqual([0, 0]);
  });

  it("matches the Wilson score interval for 8/8", () => {
    const [lo, hi] = wilson(8, 8) as [number, number];
    expect(lo).toBeCloseTo(0.676, 2);
    expect(hi).toBeCloseTo(1.0, 2);
  });

  it("widens as n shrinks", () => {
    const [, hi1] = wilson(1, 1) as [number, number];
    const [lo1] = wilson(1, 1) as [number, number];
    const [lo8] = wilson(8, 8) as [number, number];
    expect(hi1 - lo1).toBeGreaterThan(1.0 - lo8);
  });
});

describe("summarize", () => {
  it("computes recall only over completed cases", () => {
    const s = summarize([
      { file: "a", hits: 4, total: 5, status: "ok" },
      { file: "b", hits: 0, total: 3, status: "error", error: "boom" },
      { file: "c", hits: 0, total: 0, status: "not_run" },
    ]);
    expect(s.recall).toEqual({ k: 4, n: 5 });
    expect(s.complete).toBe(false);
    expect(s.failures).toEqual(["b: boom"]);
    expect(s.not_run).toEqual(["c"]);
    expect(s.wilson95).toHaveLength(2);
  });

  it("is complete only when every case is ok", () => {
    const s = summarize([
      { file: "a", hits: 5, total: 5, status: "ok" },
      { file: "b", hits: 3, total: 3, status: "ok" },
    ]);
    expect(s.complete).toBe(true);
    expect(s.recall).toEqual({ k: 8, n: 8 });
  });
});

describe("scoreSpans", () => {
  it("masks one digit of an account number: span not covered, char coverage partial", () => {
    const text = "account acct 88123456 closed";
    const expected = annotateOccurrences(text, ["88123456"]);
    expect(expected).toHaveLength(1);
    // Predict every char of the span except one digit.
    const [span] = expected;
    const predicted = [{ start: span.start, end: span.end - 1 }];
    const s = scoreSpans(text, expected, predicted);
    expect(s.covered).toBe(0);
    expect(s.expected).toBe(1);
    expect(s.piiCharsMasked).toBe(s.piiChars - 1);
    expect(s.charCoverage).toBeGreaterThan(0);
    expect(s.charCoverage).toBeLessThan(1);
  });

  it("whole-transcript mask gives full coverage and over-redaction above 0.9", () => {
    const text = "Caller Alex Rivera, phone 555-0100, thanks";
    const expected = annotateOccurrences(text, ["Alex Rivera", "555-0100"]);
    const s = scoreSpans(text, expected, [{ start: 0, end: text.length }]);
    expect(s.covered).toBe(s.expected);
    expect(s.charCoverage).toBe(1);
    expect(s.overRedaction).toBeGreaterThan(0.9);
  });

  it("repeated entities yield one span per occurrence", () => {
    const text = readFileSync(join(here, "..", "fixtures", "pii-scoring", "repeat-01.txt"), "utf8");
    const spans = annotateOccurrences(text, ["priya.nair@example.com", "Priya Nair"]);
    expect(spans).toHaveLength(6);
  });

  it("nested same-offset matches keep only the longest span, standalone repeats kept", () => {
    // Regression: holdout-04 listed both [1,4] ("Zoë") and [1,13] ("Zoë Callahan")
    // because "Zoë" is a substring of "Zoë Callahan" at the same offset; the old
    // count double-counted the expected span. The standalone "Zoë" later in the
    // text is a genuinely separate occurrence and must remain.
    const text = "“Zoë Callahan” met Zoë";
    const spans = annotateOccurrences(text, ["Zoë Callahan", "Zoë"]);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ start: 1, end: 1 + "Zoë Callahan".length });
    expect(spans[1]).toEqual({ start: text.lastIndexOf("Zoë"), end: text.lastIndexOf("Zoë") + "Zoë".length });
    // No two returned spans may overlap.
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        expect(spans[i].start < spans[j].end && spans[j].start < spans[i].end).toBe(false);
      }
    }
  });

  it("nested Ingrid / Ingrid Sørensen keeps only the longest overlapping span", () => {
    // Regression: holdout-07 listed [7,13] ("Ingrid") and [7,22] ("Ingrid Sørensen").
    const text = "Vendor Ingrid Sørensen called; Ingrid confirmed";
    const spans = annotateOccurrences(text, ["Ingrid Sørensen", "Ingrid"]);
    expect(spans).toHaveLength(2);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("Ingrid Sørensen");
    expect(text.slice(spans[1].start, spans[1].end)).toBe("Ingrid");
  });

  it("clean negative controls have 0 expected and still measure over-redaction", () => {
    for (const file of ["clean-01.txt", "clean-02.txt"]) {
      const text = readFileSync(join(here, "..", "fixtures", "pii-scoring", file), "utf8");
      const s = scoreSpans(text, annotateOccurrences(text, []), [{ start: 0, end: 5 }]);
      expect(s.expected).toBe(0);
      expect(s.covered).toBe(0);
      expect(s.nonPii).toBeGreaterThan(0);
      expect(s.nonPiiMasked).toBeGreaterThan(0);
      expect(s.overRedaction).toBeGreaterThan(0);
    }
  });
});

describe("summarize end-to-end", () => {
  it("failed and not_run cases keep expected counts in the end-to-end denominator", () => {
    const planned = [
      { file: "a", total: 5, expected: 5 },
      { file: "b", total: 3, expected: 3 },
      { file: "c", total: 4, expected: 4 },
    ];
    const s = summarize(
      [
        { file: "a", hits: 4, total: 5, status: "ok", span: { covered: 4, expected: 5, piiChars: 10, piiCharsMasked: 8, nonPii: 20, nonPiiMasked: 1 } },
        { file: "b", hits: 0, total: 3, status: "error", error: "boom" },
        { file: "c", hits: 0, total: 4, status: "not_run" },
      ],
      planned,
    );
    expect(s.request_completion).toEqual({ completed: 1, planned: 3 });
    expect(s.legacy_entity_disappearance.completed).toEqual({ k: 4, n: 5 });
    expect(s.legacy_entity_disappearance.end_to_end).toEqual({ k: 4, n: 12 });
    expect(s.recall_completed).toEqual({ k: 4, n: 5 });
    expect(s.recall_end_to_end).toEqual({ k: 4, n: 12 });
    expect(s.wilson95_recall_completed).toHaveLength(2);
    expect(s.wilson95_recall_end_to_end).toHaveLength(2);
  });

  it("rescore of the glimmer-run fixture gives 6/8, 18/29 completed, 18/39 end-to-end legacy", () => {
    const script = join(here, "..", "scripts", "rescore-glimmer-run.mjs");
    const outDir = mkdtempSync(join(tmpdir(), "glimmer-rescore-"));
    const outPath = join(outDir, "rescore.json");
    try {
      const output = execFileSync("node", [script, "--legacy-glimmer-run", "--out", outPath], { encoding: "utf8" });
      expect(output).toContain("requests: 6/8");
      expect(output).toContain("legacy completed: 18/29");
      expect(output).toContain("legacy end-to-end: 18/39");
      const rescore = JSON.parse(readFileSync(outPath, "utf8")) as {
        request_completion: { completed: number; planned: number };
        legacy_entity_disappearance: { completed: { k: number; n: number }; end_to_end: { k: number; n: number } };
        span_coverage: null;
      };
      expect(rescore.request_completion).toEqual({ completed: 6, planned: 8 });
      expect(rescore.legacy_entity_disappearance.completed).toEqual({ k: 18, n: 29 });
      expect(rescore.legacy_entity_disappearance.end_to_end).toEqual({ k: 18, n: 39 });
      expect(rescore.span_coverage).toBeNull();
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe("runEval (fake redactor, offline)", () => {
  type Span = { start: number; end: number };
  type Behavior = { maskedText: string; spans: Span[] } | Error;

  function maskAll(text: string): Behavior {
    return { maskedText: "[redacted]", spans: [{ start: 0, end: text.length }] };
  }

  function runFake(
    cases: Array<{ file: string; entities: string[]; names?: string[] }>,
    texts: Map<string, string>,
    behaviors: Map<string, Behavior>,
  ) {
    return runEval({
      cases,
      readText: async (c: { file: string }) => texts.get(c.file) as string,
      makeRedactor: () => ({
        label: "fake",
        timeoutMs: 0,
        async redactText(text: string) {
          for (const [key, value] of behaviors) {
            if (text === key) {
              if (value instanceof Error) throw value;
              return value;
            }
          }
          throw new Error(`unexpected text: ${text.slice(0, 20)}`);
        },
      }),
      concurrency: 2,
    });
  }

  it("failed case keeps planned spans: completion 1/2, completed 5/5, end-to-end 5/10", async () => {
    const textA = "a AAA-11 b BBB-22 c CCC-33 d DDD-44 e EEE-55 f";
    const textB = "a FFF-11 b GGG-22 c HHH-33 d III-44 e JJJ-55 f";
    const cases = [
      { file: "a.txt", entities: ["AAA-11", "BBB-22", "CCC-33", "DDD-44", "EEE-55"] },
      { file: "b.txt", entities: ["FFF-11", "GGG-22", "HHH-33", "III-44", "JJJ-55"] },
    ];
    const texts = new Map([
      ["a.txt", textA],
      ["b.txt", textB],
    ]);
    const behaviors = new Map<string, Behavior>([
      [textA, maskAll(textA)],
      [textB, new Error("boom")],
    ]);
    const r = await runFake(cases, texts, behaviors);
    // Same round-trip the GLIMMER_RESULT_JSON payload goes through.
    expect(r.output).toEqual(JSON.parse(JSON.stringify(r.output)));
    expect(r.output.request_completion).toEqual({ completed: 1, planned: 2 });
    expect(r.output.recall_completed).toEqual({ k: 5, n: 5 });
    expect(r.output.recall_end_to_end).toEqual({ k: 5, n: 10 });
    expect(r.output.complete).toBe(false);
    expect(r.records).toHaveLength(2);
    expect(r.records[1].status).toBe("error");
    expect(r.report).toContain("completion: 1/2");
    expect(r.report).toContain("span_coverage_completed: 5/5");
    expect(r.report).toContain("span_coverage_end_to_end: 5/10");
  });

  it("empty predictions on a positive case score zero coverage, not null", async () => {
    const text = "please call 555-0100 tomorrow";
    const cases = [{ file: "e.txt", entities: ["555-0100"] }];
    const r = await runFake(
      cases,
      new Map([["e.txt", text]]),
      new Map([[text, { maskedText: text, spans: [] }]]),
    );
    expect(r.output.recall_completed).toEqual({ k: 0, n: 1 });
    expect(r.output.recall_end_to_end).toEqual({ k: 0, n: 1 });
    expect(r.output.char_coverage.completed).toBe(0);
    expect(r.records[0].span.covered).toBe(0);
  });

  it("masking one digit of an account number earns no span credit and lists misses", async () => {
    const text = "account acct 88123456 closed";
    const [span] = annotateOccurrences(text, ["88123456"]);
    const cases = [{ file: "d.txt", entities: ["88123456"] }];
    const r = await runFake(
      cases,
      new Map([["d.txt", text]]),
      new Map([[text, { maskedText: text, spans: [{ start: span.start, end: span.end - 1 }] }]]),
    );
    expect(r.output.recall_completed).toEqual({ k: 0, n: 1 });
    // Legacy entity still present -> miss; uncovered span listed with offsets.
    expect(r.records[0].misses).toEqual(["d.txt: 88123456"]);
    expect(r.records[0].span_misses).toEqual([
      { file: "d.txt", start: span.start, end: span.end, text: "88123456" },
    ]);
    expect(r.output.misses).toEqual(["d.txt: 88123456"]);
    expect(r.output.span_misses).toEqual([
      { file: "d.txt", start: span.start, end: span.end, text: "88123456" },
    ]);
    expect(r.report).toContain("d.txt: 88123456");
    expect(r.report).toContain(`[${span.start},${span.end})`);
  });

  it("masking the whole transcript exposes substantial over-redaction", async () => {
    const text = "Hello world, please call 555-0100 tomorrow morning";
    const cases = [{ file: "w.txt", entities: ["555-0100"] }];
    const r = await runFake(
      cases,
      new Map([["w.txt", text]]),
      new Map([[text, maskAll(text)]]),
    );
    expect(r.output.recall_completed).toEqual({ k: 1, n: 1 });
    expect(r.output.over_redaction_rate).toBeGreaterThan(0.5);
  });

  it("masking exactly an annotated name is not over-redaction", async () => {
    const text = "Alex Rivera called from 555-0100 today";
    const [nameSpan] = annotateOccurrences(text, ["Alex Rivera"]);
    const cases = [{ file: "n.txt", entities: ["555-0100"], names: ["Alex Rivera"] }];
    const r = await runFake(
      cases,
      new Map([["n.txt", text]]),
      new Map([
        [
          text,
          {
            maskedText: text.replace("Alex Rivera", "[redacted]"),
            spans: [{ start: nameSpan.start, end: nameSpan.end }],
          },
        ],
      ]),
    );
    expect(r.output.over_redaction_rate).toBe(0);
    // The name span is covered; the phone span is missed.
    expect(r.output.recall_completed).toEqual({ k: 1, n: 2 });
    expect(r.records[0].misses).toEqual(["n.txt: 555-0100"]);
  });

  it("misses survive serialization and appear in the report", async () => {
    const text = "reach sam.chen@example.com or 555-010-2202";
    const cases = [{ file: "m.txt", entities: ["sam.chen@example.com", "555-010-2202"] }];
    const r = await runFake(
      cases,
      new Map([["m.txt", text]]),
      new Map([[text, { maskedText: text, spans: [] }]]),
    );
    expect(r.records[0].misses).toEqual(["m.txt: sam.chen@example.com", "m.txt: 555-010-2202"]);
    expect(r.records[0].span_misses).toHaveLength(2);
    expect(r.output.misses).toEqual(r.records[0].misses);
    expect(r.output.span_misses).toEqual(r.records[0].span_misses);
    expect(r.output).toEqual(JSON.parse(JSON.stringify(r.output)));
    expect(r.report).toContain("misses:");
    expect(r.report).toContain("m.txt: sam.chen@example.com");
    expect(r.report).toContain("span_misses:");
  });

  it("zero-positive case reports null recall, never perfect", async () => {
    const text = "The lobby meeting starts at noon.";
    const cases = [{ file: "z.txt", entities: [] as string[] }];
    const r = await runFake(
      cases,
      new Map([["z.txt", text]]),
      new Map([[text, { maskedText: text, spans: [] }]]),
    );
    expect(r.output.recall_completed).toBeNull();
    expect(r.output.recall_end_to_end).toBeNull();
    expect(r.output.char_coverage.completed).toBeNull();
    expect(r.report).toContain("n/a (no positives)");
  });

  it("fixtures/pii keeps the historical legacy n=39", async () => {
    const cases = JSON.parse(
      readFileSync(join(here, "..", "fixtures", "pii", "cases.json"), "utf8"),
    ) as Array<{ file: string; entities: string[]; names?: string[] }>;
    const texts = new Map(cases.map((c) => [c.file, readFileSync(join(here, "..", "fixtures", "pii", c.file), "utf8") as string]));
    const behaviors = new Map<string, Behavior>(
      [...texts.entries()].map(([file, text]) => [text, maskAll(text)] as [string, Behavior]),
    );
    const r = await runFake(cases, texts, behaviors);
    expect(r.output.request_completion).toEqual({ completed: 8, planned: 8 });
    expect(r.output.legacy_entity_disappearance.completed).toEqual({ k: 39, n: 39 });
    expect(r.output.legacy_entity_disappearance.end_to_end).toEqual({ k: 39, n: 39 });
  });
});
