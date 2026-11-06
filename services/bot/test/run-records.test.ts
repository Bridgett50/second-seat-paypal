// A7 run records: unique run dirs, keyed receipts, terminal statuses,
// durable + rescorable records. Offline only: fake redactors and fake
// fetchImpl throughout, no network, no Modal.
// @ts-expect-error untyped helper module
import { checkRecordIntegrity } from "../scripts/redaction-eval-lib.mjs";
// @ts-expect-error untyped helper module
import { runEval, sha256Hex } from "../scripts/redaction-eval-runner.mjs";
// @ts-expect-error untyped helper module
import { rescoreLegacyRecords, rescoreRun } from "../scripts/rescore-glimmer-run.mjs";
import { GlimmerClient } from "../src/private/redact.js";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  delete process.env["GLIMMER_RAW_DIR"];
});

function tmpOutDir() {
  return mkdtempSync(join(tmpdir(), "run-records-"));
}

type Span = { start: number; end: number };
type Behavior = { maskedText: string; spans: Span[] } | Error;

function runFake(
  cases: Array<{ file: string; entities: string[] }>,
  texts: Map<string, string>,
  behaviors: Map<string, Behavior>,
  extra: { runId?: string; outDir?: string; deadlineMs?: number } = {},
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
    ...extra,
  });
}

function maskAll(text: string): Behavior {
  return { maskedText: "[redacted]", spans: [{ start: 0, end: text.length }] };
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("unique run dir per run", () => {
  it("writes manifest/records/summary/report and refuses to reuse a run dir", async () => {
    const outDir = tmpOutDir();
    const text = "call 555-0100 now";
    const cases = [{ file: "a.txt", entities: ["555-0100"] }];
    const texts = new Map([["a.txt", text]]);
    const behaviors = new Map([[text, maskAll(text)]]);
    const r = await runFake(cases, texts, behaviors, { runId: "run-001", outDir });
    expect(r.runDir).toBe(join(outDir, "run-001"));

    const manifest = JSON.parse(readFileSync(join(r.runDir as string, "manifest.json"), "utf8")) as {
      run_id: string;
      started_at: string;
      planned: Array<{ file: string; input_sha256: string }>;
    };
    expect(manifest.run_id).toBe("run-001");
    expect(typeof manifest.started_at).toBe("string");
    expect(manifest.planned.map((p) => p.file)).toEqual(["a.txt"]);
    expect(manifest.planned[0]?.input_sha256).toBe(sha256Hex(text));

    const lines = readJsonl(join(r.runDir as string, "records.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.status).toBe("ok");
    expect(readFileSync(join(r.runDir as string, "summary.json"), "utf8")).toContain("run-001");
    expect(readFileSync(join(r.runDir as string, "report.txt"), "utf8")).toContain("completion: 1/1");

    await expect(runFake(cases, texts, behaviors, { runId: "run-001", outDir })).rejects.toThrow(
      /already exists/,
    );
  });

  it("defaults to a unique run id per run", async () => {
    const outDir = tmpOutDir();
    const text = "call 555-0100 now";
    const cases = [{ file: "a.txt", entities: ["555-0100"] }];
    const texts = new Map([["a.txt", text]]);
    const behaviors = new Map([[text, maskAll(text)]]);
    const a = await runFake(cases, texts, behaviors, { outDir });
    const b = await runFake(cases, texts, behaviors, { outDir });
    expect(a.runId).not.toBe(b.runId);
    expect(a.runDir).not.toBe(b.runDir);
  });
});

describe("terminal status per planned case", () => {
  it("failed canary yields one error plus explicit not_run for every remaining case", async () => {
    const outDir = tmpOutDir();
    const texts = new Map([
      ["a.txt", "alpha 111"],
      ["b.txt", "beta 222"],
      ["c.txt", "gamma 333"],
    ]);
    const cases = [
      { file: "a.txt", entities: ["111"] },
      { file: "b.txt", entities: ["222"] },
      { file: "c.txt", entities: ["333"] },
    ];
    const behaviors = new Map<string, Behavior>([
      ["alpha 111", new Error("canary boom")],
      ["beta 222", maskAll("beta 222")],
      ["gamma 333", maskAll("gamma 333")],
    ]);
    const r = await runFake(cases, texts, behaviors, { runId: "canary-fail", outDir });
    expect(r.canaryFailed).toBe(true);
    expect(r.complete).toBe(false);
    expect(r.records.map((c: { status: string }) => c.status)).toEqual(["error", "not_run", "not_run"]);
    expect(r.summary.failures).toEqual(["a.txt: canary boom"]);
    expect(r.summary.not_run).toEqual(["b.txt", "c.txt"]);
    // Durable file agrees: 3 terminal records, one per planned case.
    const lines = readJsonl(join(outDir, "canary-fail", "records.jsonl"));
    expect(lines.map((l) => [l.file, l.status])).toEqual([
      ["a.txt", "error"],
      ["b.txt", "not_run"],
      ["c.txt", "not_run"],
    ]);
  });

  it("missing, duplicate, and unexpected case ids each force complete:false with a reason", async () => {
    const mk = (files: string[]) => {
      const dir = mkdtempSync(join(tmpdir(), "integrity-"));
      const runDir = join(dir, "run-x");
      mkdirSync(runDir);
      const manifest = {
        run_id: "run-x",
        started_at: new Date().toISOString(),
        planned: [
          { file: "a.txt", entities: ["111"], input_sha256: "0" },
          { file: "b.txt", entities: ["222"], input_sha256: "1" },
        ],
      };
      writeFileSync(join(runDir, "manifest.json"), JSON.stringify(manifest));
      const rec = (f: string) => JSON.stringify({ file: f, hits: 1, total: 1, status: "ok", misses: [], span_misses: [] });
      writeFileSync(join(runDir, "records.jsonl"), files.map(rec).join("\n") + "\n");
      return runDir;
    };
    const readText = async (c: { file: string; entities: string[] }) =>
      (c.file === "a.txt" ? "alpha 111" : "beta 222");

    const missing = await rescoreLegacyRecords(mk(["a.txt"]), { readText });
    expect(missing.complete).toBe(false);
    expect(missing.integrity.ok).toBe(false);
    expect(missing.integrity.reason).toMatch(/missing: b\.txt/);
    expect(missing.records.find((r: { file: string }) => r.file === "b.txt")?.status).toBe("not_run");

    const dup = await rescoreLegacyRecords(mk(["a.txt", "b.txt", "b.txt"]), { readText });
    expect(dup.complete).toBe(false);
    expect(dup.integrity.reason).toMatch(/duplicate: b\.txt/);

    const extra = await rescoreLegacyRecords(mk(["a.txt", "b.txt", "zzz.txt"]), { readText });
    expect(extra.complete).toBe(false);
    expect(extra.integrity.reason).toMatch(/unexpected: zzz\.txt/);

    expect(checkRecordIntegrity([{ file: "a.txt" }], [{ file: "a.txt" }]).ok).toBe(true);
  });

  it("distinguishes all_attempted (no not_run) from all_valid (all ok)", async () => {
    const textA = "a AAA-11 b";
    const textB = "c BBB-22 d";
    const cases = [
      { file: "a.txt", entities: ["AAA-11"] },
      { file: "b.txt", entities: ["BBB-22"] },
    ];
    const texts = new Map([
      ["a.txt", textA],
      ["b.txt", textB],
    ]);
    // Non-canary error: every case attempted, but not all valid.
    const r = await runFake(cases, texts, new Map<string, Behavior>([
      [textA, maskAll(textA)],
      [textB, new Error("late boom")],
    ]));
    expect(r.summary.all_attempted).toBe(true);
    expect(r.summary.all_valid).toBe(false);
    expect(r.complete).toBe(false);

    const ok = await runFake(cases, texts, new Map<string, Behavior>([
      [textA, maskAll(textA)],
      [textB, maskAll(textB)],
    ]));
    expect(ok.summary.all_attempted).toBe(true);
    expect(ok.summary.all_valid).toBe(true);
    expect(ok.complete).toBe(true);
  });
});

describe("interrupted runs stay readable and honestly incomplete", () => {
  it("ignores a truncated last line and reports missing cases as not_run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "interrupted-"));
    const runDir = join(dir, "run-i");
    mkdirSync(runDir);
    writeFileSync(
      join(runDir, "manifest.json"),
      JSON.stringify({
        run_id: "run-i",
        started_at: new Date().toISOString(),
        planned: [
          { file: "a.txt", entities: ["111"], input_sha256: "0" },
          { file: "b.txt", entities: ["222"], input_sha256: "1" },
        ],
      }),
    );
    const full = JSON.stringify({ file: "a.txt", hits: 1, total: 1, status: "ok", misses: [], span_misses: [] });
    writeFileSync(join(runDir, "records.jsonl"), `${full}\n{"file": "b.txt", "hits": 0, "tot`);
    // No summary.json: the run never finished.

    const r = await rescoreLegacyRecords(runDir, {
      readText: async (c: { file: string }) => (c.file === "a.txt" ? "alpha 111" : "beta 222"),
    });
    expect(r.truncated).toBe(true);
    expect(r.complete).toBe(false);
    expect(r.records.map((c: { file: string; status: string }) => [c.file, c.status])).toEqual([
      ["a.txt", "ok"],
      ["b.txt", "not_run"],
    ]);
  });
});

describe("raw-response isolation", () => {
  it("a repeated run can never append into another run's raw-response file", async () => {
    const outDir = tmpOutDir();
    const text = "call 555-0100 now";
    const cases = [{ file: "a.txt", entities: ["555-0100"] }];
    const texts = new Map([["a.txt", text]]);
    const behaviors = new Map([[text, maskAll(text)]]);
    // GlimmerClient-backed redactor with a fake transport, so receipts land
    // in the per-run raw file via GLIMMER_RAW_DIR.
    const glimmerFactory = () =>
      new GlimmerClient("http://localhost:9", {
        fetchImpl: (async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: '{"spans":[],"boxes":[]}' }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1 },
            }),
        })) as unknown as typeof fetch,
      });
    const runWithGlimmer = (runId: string) =>
      runEval({
        cases,
        readText: async (c: { file: string }) => texts.get(c.file) as string,
        makeRedactor: glimmerFactory,
        concurrency: 1,
        runId,
        outDir,
      });
    await runWithGlimmer("run-one");
    const rawOne = join(outDir, "run-one", "glimmer-raw.jsonl");
    const before = readFileSync(rawOne, "utf8");
    expect(before).toContain('"run_id":"run-one"');

    await runWithGlimmer("run-two");
    expect(readFileSync(rawOne, "utf8")).toBe(before);
    expect(readFileSync(join(outDir, "run-two", "glimmer-raw.jsonl"), "utf8")).toContain(
      '"run_id":"run-two"',
    );

    // Same run id again is refused before any redaction happens.
    await expect(runWithGlimmer("run-one")).rejects.toThrow(/already exists/);
    expect(readFileSync(rawOne, "utf8")).toBe(before);
  });

  it("refuses to append into a pre-existing raw file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "raw-claim-"));
    writeFileSync(join(dir, "glimmer-raw.jsonl"), '{"old":true}\n');
    process.env["GLIMMER_RAW_DIR"] = dir;
    const client = new GlimmerClient("http://localhost:9", {
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: '{"spans":[],"boxes":[]}' }, finish_reason: "stop" }],
            usage: {},
          }),
      })) as unknown as typeof fetch,
    });
    await expect(client.redactText("hello")).rejects.toThrow(/refusing to append/);
    expect(readFileSync(join(dir, "glimmer-raw.jsonl"), "utf8")).toBe('{"old":true}\n');
  });
});

describe("receipts", () => {
  function fetchOk(content: string, messageExtra: Record<string, unknown> = {}) {
    return (async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content, ...messageExtra },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 5 },
        }),
    })) as unknown as typeof fetch;
  }

  it("preserves final content, original/canonical labels, finish reason, usage, latency, and keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "receipt-"));
    process.env["GLIMMER_RAW_DIR"] = dir;
    const text = "Call Ana at 555-0100";
    const content = JSON.stringify({
      spans: [{ start: 5, end: 8, label: "PERSON_NAME" }],
      boxes: [],
    });
    const client = new GlimmerClient("http://localhost:9", { fetchImpl: fetchOk(content) });
    client.setReceiptContext({ runId: "run-r", caseId: "a.txt", inputSha256: "abc123" });
    const out = await client.redactText(text);
    expect(out.maskedText).not.toContain("Ana");

    const lines = readJsonl(join(dir, "glimmer-raw.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      run_id: "run-r",
      case_id: "a.txt",
      input_sha256: "abc123",
      kind: "text",
      status: 200,
      content,
      finish_reason: "stop",
      usage: { prompt_tokens: 3, completion_tokens: 5 },
    });
    expect(typeof lines[0]?.latency_ms).toBe("number");
    expect(lines[0]?.spans).toEqual([{ start: 5, end: 8, label: "person", original_label: "PERSON_NAME" }]);
    expect(lines[0]).not.toHaveProperty("error");
  });

  it("reasoning with a valid JSON answer but empty content is a case error, never scored", async () => {
    const outDir = tmpOutDir();
    const text = "Call Ana at 555-0100";
    const reasoningAnswer = JSON.stringify({
      spans: [{ start: 5, end: 8, label: "person" }],
      boxes: [],
    });
    const r = await runEval({
      cases: [{ file: "a.txt", entities: ["Ana", "555-0100"] }],
      readText: async () => text,
      makeRedactor: () =>
        new GlimmerClient("http://localhost:9", {
          fetchImpl: fetchOk("", { reasoning_content: reasoningAnswer }),
        }),
      concurrency: 1,
      runId: "reasoning-trap",
      outDir,
    });
    expect(r.records.map((c: { status: string }) => c.status)).toEqual(["error"]);
    expect(r.complete).toBe(false);
    // The valid-looking answer hiding in reasoning earned nothing.
    expect(r.summary.recall_end_to_end).toEqual({ k: 0, n: 2 });

    const lines = readJsonl(join(outDir, "reasoning-trap", "glimmer-raw.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.run_id).toBe("reasoning-trap");
    expect(typeof lines[0]?.error).toBe("string");
    expect(lines[0]?.reasoning).toBe(reasoningAnswer);
    expect(lines[0]?.content).toBe("");
  });

  it("transport failure writes an error receipt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "receipt-err-"));
    process.env["GLIMMER_RAW_DIR"] = dir;
    const client = new GlimmerClient("http://localhost:9", {
      fetchImpl: (async () => ({ ok: false, status: 500, text: async () => "bad" })) as unknown as typeof fetch,
    });
    client.setReceiptContext({ runId: "run-e", caseId: "a.txt", inputSha256: "ff" });
    await expect(client.redactText("hello")).rejects.toThrow(/chat failed 500/);
    const lines = readJsonl(join(dir, "glimmer-raw.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ run_id: "run-e", case_id: "a.txt", status: 500 });
    expect(typeof lines[0]?.error).toBe("string");
  });
});

describe("offline rescoring", () => {
  it("reproduces the saved summary.json and report exactly, with no redactor", async () => {
    const outDir = tmpOutDir();
    const textA = "a AAA-11 b BBB-22 c";
    const textB = "d CCC-33 e";
    const cases = [
      { file: "a.txt", entities: ["AAA-11", "BBB-22"] },
      { file: "b.txt", entities: ["CCC-33"] },
    ];
    const texts = new Map([
      ["a.txt", textA],
      ["b.txt", textB],
    ]);
    const fetchImpl = (async (_u: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ content?: unknown }>;
      };
      const text = String(body.messages?.[1]?.content ?? "");
      const content = JSON.stringify({
        spans: [{ start: 0, end: text.length, label: "person" }],
        boxes: [],
      });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
      };
    }) as unknown as typeof fetch;
    const r = await runEval({
      cases,
      readText: async (c: { file: string }) => texts.get(c.file) as string,
      makeRedactor: () => new GlimmerClient("http://localhost:9", { fetchImpl }),
      concurrency: 1,
      runId: "rescore-me",
      outDir,
    });
    expect(r.complete).toBe(true);

    const runDir = join(outDir, "rescore-me");
    const savedSummary = JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8"));
    const savedReport = readFileSync(join(runDir, "report.txt"), "utf8");

    // No redactor is passed at all: rescoring is offline by construction.
    const { parseGlimmerAnswer } = (await import("../src/private/redact.js")) as unknown as {
      parseGlimmerAnswer: (text: string, content: string, finishReason?: string) => unknown;
    };
    const re = await rescoreRun(runDir, { parseAnswer: parseGlimmerAnswer });
    expect(re.output).toEqual(savedSummary);
    expect(re.report + "\n").toBe(savedReport);
    expect(re.complete).toBe(true);
  });
});
