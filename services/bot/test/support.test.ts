import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  baselineGrade,
  buildSupportUserMessage,
  FixtureSupportJudge,
  lexicalOverlap,
  SparkSupportJudge,
  SUPPORT_JSON_SCHEMA,
  SUPPORT_PROMPT_VERSION,
} from "../src/judge/support.js";
import { createPrivacyGate } from "../src/private/gate.js";

const here = dirname(fileURLToPath(import.meta.url));
const casesPath = join(here, "..", "..", "..", "eval", "fixtures", "support-cases.json");
const fixturePath = join(here, "..", "fixtures", "support-judge-v1.json");

interface SupportCase {
  id: string;
  kind: string;
  entryText: string;
  citedSpans: string[];
  expected: { grade: string; missingQualifier: string | null };
}

function loadCases(): SupportCase[] {
  return (JSON.parse(readFileSync(casesPath, "utf8")) as { cases: SupportCase[] }).cases;
}

describe("support judge fixtures", () => {
  it("grades the 4 acceptance fixtures as expected", async () => {
    const judge = new FixtureSupportJudge(fixturePath);
    for (const id of ["F1-overreach", "F2-paraphrase-drift", "F3-dropped-qualifier", "F4-confidence-laundering"]) {
      const c = loadCases().find((x) => x.id === id)!;
      const verdict = await judge.gradeSupport({ entryId: c.id, entryText: c.entryText, citedSpans: c.citedSpans });
      expect(verdict.grade).toBe(c.expected.grade);
      if (c.expected.missingQualifier !== null) {
        expect(verdict.missingQualifier?.toLowerCase()).toContain(c.expected.missingQualifier.toLowerCase());
      }
    }
  });

  it("overreach is unsupported, drift is at most partial", async () => {
    const judge = new FixtureSupportJudge(fixturePath);
    const cases = loadCases();
    const overreach = cases.find((x) => x.id === "F1-overreach")!;
    const drift = cases.find((x) => x.id === "F2-paraphrase-drift")!;
    expect(
      (await judge.gradeSupport({ entryId: overreach.id, entryText: overreach.entryText, citedSpans: overreach.citedSpans })).grade,
    ).toBe("unsupported");
    expect(
      (await judge.gradeSupport({ entryId: drift.id, entryText: drift.entryText, citedSpans: drift.citedSpans })).grade,
    ).not.toBe("supported");
  });

  it("attaches an advisory lexical overlap score next to every grade", async () => {
    const judge = new FixtureSupportJudge(fixturePath);
    const c = loadCases().find((x) => x.id === "F3-dropped-qualifier")!;
    const verdict = await judge.gradeSupport({ entryId: c.id, entryText: c.entryText, citedSpans: c.citedSpans });
    expect(verdict.overlap).toBeGreaterThan(0);
    expect(verdict.overlap).toBeLessThanOrEqual(1);
    expect(verdict.overlap).toBe(lexicalOverlap(c.entryText, c.citedSpans));
  });

  it("fails loudly for an entry with no recorded verdict", async () => {
    const judge = new FixtureSupportJudge(fixturePath);
    await expect(judge.gradeSupport({ entryId: "NOPE", entryText: "x", citedSpans: ["y"] })).rejects.toThrow(/no recorded verdict/);
  });

  it("fails loudly when the fixture file is missing", async () => {
    const judge = new FixtureSupportJudge("/nonexistent/support-judge.json");
    await expect(
      judge.gradeSupport({ entryId: "F1-overreach", entryText: "x", citedSpans: ["y"] }),
    ).rejects.toThrow(/no fixture file/);
  });
});

describe("judge-disabled baseline", () => {
  it("grades everything supported, so mutants pass without the judge", () => {
    for (const c of loadCases().filter((x) => x.kind !== "control")) {
      const verdict = baselineGrade({ entryId: c.id, entryText: c.entryText, citedSpans: c.citedSpans });
      expect(verdict.grade).toBe("supported");
      expect(verdict.missingQualifier).toBeNull();
    }
  });
});

describe("live client shape (no live calls)", () => {
  it("stays fixture-only without an API key", async () => {
    const savedMeta = process.env["META_API_KEY"];
    const savedMuse = process.env["MUSE_API_KEY"];
    delete process.env["META_API_KEY"];
    delete process.env["MUSE_API_KEY"];
    try {
      const judge = new SparkSupportJudge();
      const gate = createPrivacyGate({ mode: "fixture" });
      const prepared = await gate.prepare("x y");
      const token = gate.approve(prepared.runId, prepared.redactedText);
      const gated = await gate.send(prepared.runId, token, async (g) => g);
      await expect(
        judge.gradeSupport({ entryId: "F1-overreach", entryText: gated, citedSpans: [gated] }),
      ).rejects.toThrow(/META_API_KEY/);
    } finally {
      if (savedMeta !== undefined) process.env["META_API_KEY"] = savedMeta;
      if (savedMuse !== undefined) process.env["MUSE_API_KEY"] = savedMuse;
    }
  });

  it("builds a user message with the entry first and spans as the only evidence", () => {
    const message = buildSupportUserMessage({ entryId: "F1", entryText: "entry text", citedSpans: ["span one"] });
    expect(message).toContain("F1");
    expect(message).toContain("entry text");
    expect(message).toContain("span one");
  });

  it("grade schema only allows the three grades plus a nullable qualifier", () => {
    expect(SUPPORT_JSON_SCHEMA.properties.grade.enum).toEqual(["supported", "partial", "unsupported"]);
    expect(SUPPORT_PROMPT_VERSION).toBe("support-v1");
  });
});
