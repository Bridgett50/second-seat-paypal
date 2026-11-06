// B4 acceptance: replay evaluation results from immutable saved inputs,
// annotations and raw final responses. Dummy datasets only; real
// GlimmerClient adapter with a fake fetchImpl; no network, no models.
// @ts-expect-error untyped helper module
import { runEval } from "../scripts/redaction-eval-runner.mjs";
// @ts-expect-error untyped helper module
import { rescoreRun } from "../scripts/rescore-glimmer-run.mjs";
import * as redact from "../src/private/redact.js";
import { GlimmerClient } from "../src/private/redact.js";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Shared answer parser (B4: same parser for original scoring and replay).
const parseAnswer = (redact as unknown as Record<string, unknown>)["parseGlimmerAnswer"];

type Case = { file: string; entities: string[] };
type Reply = { ok: boolean; status: number; text: () => Promise<string> };

let fetchCalls = 0;
const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchCalls = 0;
});
afterEach(() => {
  delete process.env["GLIMMER_RAW_DIR"];
  globalThis.fetch = realFetch;
});

function reply(content: string, extra: Record<string, unknown> = {}): () => Reply {
  return () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content, ...extra }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
  });
}
const fail500 = (): Reply => ({ ok: false, status: 500, text: async () => "bad" });

function spansFor(text: string, entities: string[], labels: string[] = []) {
  return entities.map((e, i) => {
    const start = text.indexOf(e);
    if (start < 0) throw new Error(`fixture bug: ${e}`);
    return { start, end: start + e.length, label: labels[i] ?? "PERSON_NAME" };
  });
}
const answer = (spans: unknown[]) => JSON.stringify({ spans, boxes: [] });

async function run(runId: string, cases: Case[], texts: Map<string, string>, plan: Array<[string, () => Reply]>) {
  const outDir = mkdtempSync(join(tmpdir(), "b4-"));
  const fetchImpl = (async (_u: unknown, init?: { body?: unknown }) => {
    fetchCalls += 1;
    const body = String(init?.body ?? "");
    for (const [marker, make] of plan) if (body.includes(marker)) return make();
    throw new Error("fake fetch: no plan");
  }) as unknown as typeof fetch;
  const r = await runEval({
    cases,
    readText: async (c: Case) => texts.get(c.file) as string,
    makeRedactor: () => new GlimmerClient("http://localhost:9", { fetchImpl }),
    concurrency: 1,
    runId,
    outDir,
  });
  return { r, runDir: join(outDir, runId) };
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[p] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

function readLines(p: string): Array<Record<string, unknown>> {
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}
function writeLines(p: string, lines: unknown[]) {
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

async function replay(runDir: string) {
  const throwingFetch = (async () => {
    throw new Error("replay must not call inference");
  }) as unknown as typeof fetch;
  globalThis.fetch = throwingFetch;
  const before = fetchCalls;
  const re = await rescoreRun(runDir, { parseAnswer });
  expect(fetchCalls).toBe(before);
  return re;
}

const TA = "p ALFA1 q BRAVO2 r CHARL3 s DELTA4 t ECHO55 u";
const EA = ["ALFA1", "BRAVO2", "CHARL3", "DELTA4", "ECHO55"];
const TB = "v FOXT1 w GOLF2 x HOTEL3 y INDIA4 z JULI5 k";
const EB = ["FOXT1", "GOLF2", "HOTEL3", "INDIA4", "JULI5"];
const twoCases: Case[] = [
  { file: "a.txt", entities: EA },
  { file: "b.txt", entities: EB },
];
const twoTexts = new Map([
  ["a.txt", TA],
  ["b.txt", TB],
]);
const okPlan: Array<[string, () => Reply]> = [
  [TA, reply(answer(spansFor(TA, EA)))],
  [TB, reply(answer(spansFor(TB, EB)))],
];

async function validRun(id: string) {
  const out = await run(id, twoCases, twoTexts, okPlan);
  expect(out.r.complete).toBe(true);
  return out;
}

function errorsOf(re: { errors?: string[] }): string {
  return (re.errors ?? []).join(" | ");
}

describe("B4 replay from immutable evidence", () => {
  it("B4-12: valid unchanged evidence replays to the same metrics without inference, read-only", async () => {
    const { runDir } = await validRun("b4-12");
    const snap = snapshot(runDir);
    const re = await replay(runDir);
    expect(re.ok).toBe(true);
    expect(re.errors).toEqual([]);
    expect(re.mismatches).toEqual([]);
    expect(re.complete).toBe(true);
    expect(re.output).toEqual(JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8")));
    expect(re.report + "\n").toBe(readFileSync(join(runDir, "report.txt"), "utf8"));
    expect(snapshot(runDir)).toEqual(snap);
  });

  it("B4-1: an altered aggregate is independently reconstructed and reported, bundle untouched", async () => {
    const { runDir } = await validRun("b4-1");
    const sp = join(runDir, "summary.json");
    const original = JSON.parse(readFileSync(sp, "utf8"));
    const tampered = JSON.parse(JSON.stringify(original));
    tampered.recall_end_to_end = { k: 99, n: 10 };
    tampered.request_completion = { completed: 0, planned: 2 };
    writeFileSync(sp, `${JSON.stringify(tampered, null, 2)}\n`);
    const snap = snapshot(runDir);
    const re = await replay(runDir);
    expect(re.output.recall_end_to_end).toEqual({ k: 10, n: 10 });
    expect(re.output.request_completion).toEqual({ completed: 2, planned: 2 });
    expect(re.output).toEqual(original);
    expect(re.mismatches).toEqual(expect.arrayContaining(["recall_end_to_end", "request_completion"]));
    expect(snapshot(runDir)).toEqual(snap);
  });

  describe("B4-2: changed evidence with unchanged recorded hashes is rejected", () => {
    it("changed saved input", async () => {
      const { runDir } = await validRun("b4-2-input");
      const p = join(runDir, "inputs", "a.txt");
      expect(readFileSync(p, "utf8")).toBe(TA);
      writeFileSync(p, TA.replace("ALFA1", "ALFAX"));
      const re = await replay(runDir);
      expect(re.ok).toBe(false);
      expect(re.complete).toBe(false);
      expect(errorsOf(re)).toMatch(/input/i);
    });
    it("changed annotation", async () => {
      const { runDir } = await validRun("b4-2-annot");
      const mp = join(runDir, "manifest.json");
      const m = JSON.parse(readFileSync(mp, "utf8"));
      expect(typeof m.planned[0].annotation_sha256).toBe("string");
      m.planned[0].entities = m.planned[0].entities.slice(0, 4);
      writeFileSync(mp, JSON.stringify(m, null, 2));
      const re = await replay(runDir);
      expect(re.ok).toBe(false);
      expect(re.complete).toBe(false);
      expect(errorsOf(re)).toMatch(/annotation/i);
    });
    it("changed raw-response content", async () => {
      const { runDir } = await validRun("b4-2-raw");
      const rp = join(runDir, "glimmer-raw.jsonl");
      const lines = readLines(rp);
      const i = lines.findIndex((l) => l["case_id"] === "a.txt");
      expect(i).toBeGreaterThanOrEqual(0);
      lines[i]!["content"] = answer([]);
      writeLines(rp, lines);
      const re = await replay(runDir);
      expect(re.ok).toBe(false);
      expect(re.complete).toBe(false);
      expect(errorsOf(re)).toMatch(/raw/i);
    });
  });

  it("B4-2: stripping raw_sha256 from an ok record cannot launder changed raw content", async () => {
    const { runDir } = await validRun("b4-2-strip");
    const rp = join(runDir, "glimmer-raw.jsonl");
    const raws = readLines(rp);
    const i = raws.findIndex((l) => l["case_id"] === "a.txt");
    raws[i]!["content"] = answer([]);
    writeLines(rp, raws);
    const p = join(runDir, "records.jsonl");
    const recs = readLines(p);
    const first = { ...recs[0]! };
    delete first["raw_sha256"];
    writeLines(p, [first, ...recs.slice(1)]);
    const re = await replay(runDir);
    expect(re.ok).toBe(false);
    expect(re.complete).toBe(false);
    expect(errorsOf(re)).toMatch(/raw/i);
  });

  describe("B4-3: wrong keys, duplicate and unexpected records are rejected", () => {
    const mutate = async (id: string, f: (lines: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) => {
      const { runDir } = await validRun(id);
      const p = join(runDir, "records.jsonl");
      const lines = readLines(p);
      expect(lines[0]).toMatchObject({ run_id: id, case_id: "a.txt" });
      expect(typeof lines[0]!["input_sha256"]).toBe("string");
      expect(typeof lines[0]!["raw_sha256"]).toBe("string");
      writeLines(p, f(lines));
      const re = await replay(runDir);
      expect(re.ok).toBe(false);
      expect(re.complete).toBe(false);
      return errorsOf(re);
    };
    it("wrong run id", async () => {
      expect(await mutate("b4-3-run", (l) => [{ ...l[0], run_id: "other-run" }, ...l.slice(1)])).toMatch(/run_id|run id/i);
    });
    it("wrong case id", async () => {
      expect(await mutate("b4-3-case", (l) => [{ ...l[0], case_id: "zzz.txt" }, ...l.slice(1)])).toMatch(/case/i);
    });
    it("wrong input hash", async () => {
      expect(await mutate("b4-3-hash", (l) => [{ ...l[0], input_sha256: "0".repeat(64) }, ...l.slice(1)])).toMatch(/input/i);
    });
    it("duplicate record", async () => {
      expect(await mutate("b4-3-dup", (l) => [...l, l[0]!])).toMatch(/duplicate/i);
    });
    it("unexpected record", async () => {
      expect(await mutate("b4-3-unexp", (l) => [...l, { ...l[1], file: "extra.txt", case_id: "extra.txt" }])).toMatch(/unexpected/i);
    });
  });

  it("B4-4: a missing planned case prevents complete: true", async () => {
    const { runDir } = await validRun("b4-4");
    const p = join(runDir, "records.jsonl");
    writeLines(p, readLines(p).filter((l) => l["file"] !== "b.txt"));
    const re = await replay(runDir);
    expect(re.complete).toBe(false);
    expect(re.output.complete).toBe(false);
    expect(errorsOf(re)).toMatch(/missing/i);
  });

  describe("B4-5: unknown or missing terminal status is rejected", () => {
    it("unknown status", async () => {
      const { runDir } = await validRun("b4-5-unknown");
      const p = join(runDir, "records.jsonl");
      const l = readLines(p);
      writeLines(p, [{ ...l[0], status: "weird" }, ...l.slice(1)]);
      const re = await replay(runDir);
      expect(re.ok).toBe(false);
      expect(re.complete).toBe(false);
      expect(errorsOf(re)).toMatch(/status/i);
    });
    it("missing status", async () => {
      const { runDir } = await validRun("b4-5-missing");
      const p = join(runDir, "records.jsonl");
      const l = readLines(p);
      const first = { ...l[0] };
      delete first["status"];
      writeLines(p, [first, ...l.slice(1)]);
      const re = await replay(runDir);
      expect(re.ok).toBe(false);
      expect(re.complete).toBe(false);
      expect(errorsOf(re)).toMatch(/status/i);
    });
  });

  it("B4-6: plain and fenced JSON keep equivalent canonical/original labels and identical scores", async () => {
    const text = "Call Ana at 555-0100 today";
    const ents = ["Ana", "555-0100"];
    const spans = spansFor(text, ents, ["PERSON_NAME", "PHONE_NUMBER"]);
    const cases = [{ file: "a.txt", entities: ents }];
    const texts = new Map([["a.txt", text]]);
    const plain = await run("b4-6-plain", cases, texts, [[text, reply(answer(spans))]]);
    const fenced = await run("b4-6-fenced", cases, texts, [[text, reply("```json\n" + answer(spans) + "\n```")]]);
    expect(plain.r.complete).toBe(true);
    expect(fenced.r.complete).toBe(true);
    const expectedLabels = [
      { start: spans[0]!.start, end: spans[0]!.end, label: "person", original_label: "PERSON_NAME" },
      { start: spans[1]!.start, end: spans[1]!.end, label: "phone", original_label: "PHONE_NUMBER" },
    ];
    const rp = readLines(join(plain.runDir, "glimmer-raw.jsonl"));
    const rf = readLines(join(fenced.runDir, "glimmer-raw.jsonl"));
    expect(rp[0]!["spans"]).toEqual(expectedLabels);
    expect(rf[0]!["spans"]).toEqual(expectedLabels);
    const a = await replay(plain.runDir);
    const b = await replay(fenced.runDir);
    expect(a.ok && b.ok).toBe(true);
    const strip = (o: Record<string, unknown>) => {
      const { run_id: _r, ...rest } = o;
      return rest;
    };
    expect(strip(a.output)).toEqual(strip(b.output));
    expect(a.output.recall_end_to_end).toEqual({ k: 2, n: 2 });
    expect(strip(plain.r.output)).toEqual(strip(fenced.r.output));
  });

  it("B4-7: reasoning-only content remains a failure on replay", async () => {
    const text = "Call Ana at 555-0100 today";
    const ents = ["Ana", "555-0100"];
    const hidden = answer(spansFor(text, ents));
    const { r, runDir } = await run("b4-7", [{ file: "a.txt", entities: ents }], new Map([["a.txt", text]]), [
      [text, reply("", { reasoning_content: hidden })],
    ]);
    expect(r.records[0].status).toBe("error");
    const re = await replay(runDir);
    expect(re.ok).toBe(true);
    expect(re.records.map((x: { status: string }) => x.status)).toEqual(["error"]);
    expect(re.complete).toBe(false);
    expect(re.output.recall_end_to_end).toEqual({ k: 0, n: 2 });
  });

  it("B4-8: one success + one failure of two five-span cases: 1/2, 5/5, 5/10", async () => {
    const { r, runDir } = await run("b4-8", twoCases, twoTexts, [
      [TA, reply(answer(spansFor(TA, EA)))],
      [TB, fail500],
    ]);
    const re = await replay(runDir);
    expect(re.ok).toBe(true);
    for (const s of [r.summary, re.output]) {
      expect(s.request_completion).toEqual({ completed: 1, planned: 2 });
      expect(s.recall_completed).toEqual({ k: 5, n: 5 });
      expect(s.recall_end_to_end).toEqual({ k: 5, n: 10 });
      expect(s.complete).toBe(false);
    }
  });

  it("B4-9: empty predictions on a positive case give zero coverage", async () => {
    const { runDir } = await run("b4-9", [twoCases[0]!], twoTexts, [[TA, reply(answer([]))]]);
    const re = await replay(runDir);
    expect(re.ok).toBe(true);
    expect(re.records[0].status).toBe("ok");
    expect(re.output.recall_end_to_end).toEqual({ k: 0, n: 5 });
    expect(re.output.char_coverage.completed).toBe(0);
  });

  it("B4-10: a failed canary creates explicit not_run records for every remaining case", async () => {
    const TC = "m KILO1 n";
    const cases = [...twoCases, { file: "c.txt", entities: ["KILO1"] }];
    const texts = new Map([...twoTexts, ["c.txt", TC]]);
    const { runDir } = await run("b4-10", cases, texts, [[TA, fail500], ...okPlan.slice(1), [TC, reply(answer([]))]]);
    expect(fetchCalls).toBe(1);
    const saved = readLines(join(runDir, "records.jsonl"));
    expect(saved.map((l) => [l["file"], l["status"]])).toEqual([
      ["a.txt", "error"],
      ["b.txt", "not_run"],
      ["c.txt", "not_run"],
    ]);
    const re = await replay(runDir);
    expect(re.ok).toBe(true);
    expect(re.records.map((x: { status: string }) => x.status)).toEqual(["error", "not_run", "not_run"]);
    expect(re.complete).toBe(false);
    expect(re.output.not_run).toEqual(["b.txt", "c.txt"]);
  });

  it("B4-11: a truncated record file is readable as incomplete, never complete", async () => {
    const { runDir } = await validRun("b4-11");
    const p = join(runDir, "records.jsonl");
    const raw = readFileSync(p, "utf8");
    const lastStart = raw.trimEnd().lastIndexOf("\n") + 1;
    writeFileSync(p, raw.slice(0, lastStart + 10));
    const re = await replay(runDir);
    expect(re.truncated).toBe(true);
    expect(re.complete).toBe(false);
    expect(re.output.complete).toBe(false);
    expect(re.records.map((x: { file: string }) => x.file)).toEqual(["a.txt"]);
  });
});
