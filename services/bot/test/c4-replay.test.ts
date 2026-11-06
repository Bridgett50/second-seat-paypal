// C4 regressions: strict replay is the default for new run dirs. Dummy bundles only.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error untyped .mjs
import { runEval } from "../scripts/redaction-eval-runner.mjs";
// @ts-expect-error untyped .mjs
import { rescoreRun } from "../scripts/rescore-glimmer-run.mjs";
import { GlimmerClient } from "../src/private/redact.js";

const SCRIPT = resolve(__dirname, "../scripts/rescore-glimmer-run.mjs");
const prevRaw = process.env["GLIMMER_RAW_DIR"];
afterEach(() => {
  if (prevRaw === undefined) delete process.env["GLIMMER_RAW_DIR"];
  else process.env["GLIMMER_RAW_DIR"] = prevRaw;
});

type Reply = { status?: number; content?: string; reasoning?: string; finish?: string };
function fetchFor(reply: (text: string) => Reply) {
  return (async (_u: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: unknown }> };
    const text = String(body.messages?.[1]?.content ?? "");
    const r = reply(text);
    const status = r.status ?? 200;
    return {
      ok: status === 200,
      status,
      text: async () =>
        status !== 200
          ? "upstream bad"
          : JSON.stringify({
              choices: [{ message: { content: r.content ?? "", ...(r.reasoning ? { reasoning_content: r.reasoning } : {}) }, finish_reason: r.finish ?? "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
    };
  }) as unknown as typeof fetch;
}
const maskAll = (t: string): Reply => ({ content: JSON.stringify({ spans: [{ start: 0, end: t.length, label: "person" }], boxes: [] }) });

const FIVE_A = "A1-11 A2-22 A3-33 A4-44 A5-55";
const FIVE_B = "B1-11 B2-22 B3-33 B4-44 B5-55";
const CASES = [
  { file: "a.txt", entities: FIVE_A.split(" ") },
  { file: "b.txt", entities: FIVE_B.split(" ") },
];
const TEXTS = new Map([["a.txt", FIVE_A], ["b.txt", FIVE_B]]);

async function bundle(runId: string, reply: (text: string) => Reply = maskAll, cases = CASES, texts = TEXTS) {
  const outDir = mkdtempSync(join(tmpdir(), "c4-"));
  await runEval({
    cases,
    readText: async (c: { file: string }) => texts.get(c.file) as string,
    makeRedactor: () => new GlimmerClient("http://127.0.0.1:9", { fetchImpl: fetchFor(reply) }),
    concurrency: 1,
    runId,
    outDir,
  });
  return join(outDir, runId);
}
const rd = (d: string, f: string) => readFileSync(join(d, f), "utf8");
const jsonl = (d: string, f: string) => rd(d, f).split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
const wjsonl = (d: string, f: string, rows: unknown[], tail = "") =>
  writeFileSync(join(d, f), rows.map((r) => JSON.stringify(r)).join("\n") + "\n" + tail);
function cli(args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" } });
  let json: any = null;
  try { json = JSON.parse(r.stdout.trim().split("\n").pop() ?? ""); } catch { /* none */ }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}
function treeHash(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p).update(readFileSync(p)).update(String(statSync(p).mtimeMs));
    }
  };
  walk(dir);
  return h.digest("hex");
}
function expectNotComplete(re: any) {
  expect(re.complete).toBe(false);
  expect(re.output.complete).toBe(false);
  expect(re.summary.complete).toBe(false);
  expect(re.report).toMatch(/complete: false/);
  expect(re.status).not.toBe("complete_match");
}

describe("C4 strict replay is mandatory", () => {
  it("C4-1 altered saved totals: default API and CLI reconstruct real metrics and report mismatch", async () => {
    const d = await bundle("c4-1");
    const saved = JSON.parse(rd(d, "summary.json"));
    const real = structuredClone(saved);
    saved.request_completion = { completed: 99, planned: 2 };
    saved.recall_end_to_end = { k: 999, n: 10 };
    writeFileSync(join(d, "summary.json"), JSON.stringify(saved));
    const re = await rescoreRun(d);
    expect(re.output.request_completion).toEqual(real.request_completion);
    expect(re.output.recall_end_to_end).toEqual(real.recall_end_to_end);
    expect(re.mismatches).toEqual(expect.arrayContaining(["request_completion", "recall_end_to_end"]));
    expect(re.status).toBe("mismatch");
    const c = cli(["--run-dir", d]);
    expect(c.code).not.toBe(0);
    expect(c.json.status).toBe("mismatch");
    expect(c.stdout).not.toContain("999");
  });

  it("C4-2 unknown or missing terminal status is rejected by default API and CLI", async () => {
    for (const bad of ["done", undefined]) {
      const d = await bundle(`c4-2-${String(bad)}`);
      const recs = jsonl(d, "records.jsonl");
      if (bad === undefined) delete recs[1].status; else recs[1].status = bad;
      wjsonl(d, "records.jsonl", recs);
      const re = await rescoreRun(d);
      expect(re.ok).toBe(false);
      expectNotComplete(re);
      const c = cli(["--run-dir", d]);
      expect(c.code).not.toBe(0);
      expect(c.json.status).toBe("integrity_failure");
    }
  });

  it("C4-3 tampering any scoring-relevant evidence without updating integrity data is detected", async () => {
    const tamper: Array<[string, (d: string) => void]> = [
      ["input", (d) => writeFileSync(join(d, "inputs", "a.txt"), FIVE_A.replace("A1", "Z1"))],
      ["annotations", (d) => { const m = JSON.parse(rd(d, "manifest.json")); m.planned[0].entities = ["A1-11"]; writeFileSync(join(d, "manifest.json"), JSON.stringify(m)); }],
      ["final content", (d) => { const r = jsonl(d, "glimmer-raw.jsonl"); r[0].content = JSON.stringify({ spans: [], boxes: [] }); wjsonl(d, "glimmer-raw.jsonl", r); }],
      ["error metadata", (d) => { const r = jsonl(d, "glimmer-raw.jsonl"); r[0].error = "glimmer: forged"; wjsonl(d, "glimmer-raw.jsonl", r); }],
      ["finish reason", (d) => { const r = jsonl(d, "glimmer-raw.jsonl"); r[0].finish_reason = "length"; wjsonl(d, "glimmer-raw.jsonl", r); }],
    ];
    for (const [name, fn] of tamper) {
      const d = await bundle(`c4-3-${name.replace(" ", "-")}`);
      fn(d);
      const re = await rescoreRun(d);
      expect(re.ok, name).toBe(false);
      expect(re.status, name).toBe("integrity_failure");
    }
  });

  it("C4-4 duplicate, unexpected, wrong-identity and malformed raw receipts are errors", async () => {
    const cases: Array<[string, (r: any[]) => [any[], string]]> = [
      ["duplicate", (r) => [[...r, r[0]], ""]],
      ["unexpected", (r) => [[...r, { ...r[0], case_id: "zzz.txt" }], ""]],
      ["wrong identity", (r) => [[...r, { ...r[0], run_id: "other-run" }], ""]],
      ["malformed", (r) => [r.slice(0, 1), "{not json\n" + JSON.stringify(r[1]) + "\n"]],
    ];
    for (const [name, fn] of cases) {
      const d = await bundle(`c4-4-${name.replace(" ", "-")}`);
      const [rows, tail] = fn(jsonl(d, "glimmer-raw.jsonl"));
      wjsonl(d, "glimmer-raw.jsonl", rows, tail);
      const re = await rescoreRun(d);
      expect(re.ok, name).toBe(false);
      expect(re.errors.join("\n"), name).toMatch(/receipt/i);
      expectNotComplete(re);
    }
  });

  it("C4-5 torn line after all valid records: every completion flag false; output, summary, report agree", async () => {
    const d = await bundle("c4-5");
    writeFileSync(join(d, "records.jsonl"), rd(d, "records.jsonl") + '{"file":"a.txt","sta');
    const re = await rescoreRun(d);
    expect(re.truncated).toBe(true);
    expectNotComplete(re);
    expect(re.summary.all_valid).toBe(false);
    expect(re.status).toBe("incomplete");
    expect(cli(["--run-dir", d]).json.status).toBe("incomplete");
  });

  it("C4-6 removed planned record keeps full denominators and the run is incomplete", async () => {
    const d = await bundle("c4-6");
    wjsonl(d, "records.jsonl", jsonl(d, "records.jsonl").slice(0, 1));
    const re = await rescoreRun(d);
    expectNotComplete(re);
    expect(re.output.request_completion).toEqual({ completed: 1, planned: 2 });
    expect(re.output.recall_end_to_end).toEqual({ k: 5, n: 10 });
    expect(re.report).toMatch(/completion: 1\/2/);
  });

  it("C4-7 two five-span cases, one success one failure: 1/2, completed 5/5, full 5/10", async () => {
    const d = await bundle("c4-7", (t) => (t === FIVE_B ? { status: 500 } : maskAll(t)));
    const re = await rescoreRun(d);
    expect(re.ok).toBe(true);
    expect(re.output.request_completion).toEqual({ completed: 1, planned: 2 });
    expect(re.output.recall_completed).toEqual({ k: 5, n: 5 });
    expect(re.output.recall_end_to_end).toEqual({ k: 5, n: 10 });
    expectNotComplete(re);
    expect(re.mismatches).toEqual([]);
  });

  it("C4-8 reasoning-only fails; empty valid predictions score zero; fenced == plain JSON", async () => {
    const one = [{ file: "a.txt", entities: FIVE_A.split(" ") }];
    const reasoning = await rescoreRun(await bundle("c4-8-r", (t) => ({ content: "", reasoning: maskAll(t).content! }), one));
    expect(reasoning.records[0].status).toBe("error");
    const empty = await rescoreRun(await bundle("c4-8-e", () => ({ content: JSON.stringify({ spans: [], boxes: [] }) }), one));
    expect(empty.records[0].status).toBe("ok");
    expect(empty.output.recall_end_to_end).toEqual({ k: 0, n: 5 });
    const plain = await rescoreRun(await bundle("c4-8-p", maskAll, one));
    const fenced = await rescoreRun(await bundle("c4-8-f", (t) => ({ content: "```json\n" + maskAll(t).content + "\n```" }), one));
    expect(fenced.records).toEqual(plain.records);
    expect(fenced.output.recall_end_to_end).toEqual(plain.output.recall_end_to_end);
  });

  it("C4-9 unchanged evidence reproduces saved metrics/report; nothing on disk changes", async () => {
    const d = await bundle("c4-9");
    const before = treeHash(d);
    const legacyDir = resolve(__dirname, "../fixtures/glimmer-run");
    const legacyBefore = treeHash(legacyDir);
    const re = await rescoreRun(d);
    expect(re.output).toEqual(JSON.parse(rd(d, "summary.json")));
    expect(re.report + "\n").toBe(rd(d, "report.txt"));
    expect(re.mismatches).toEqual([]);
    expect(re.status).toBe("complete_match");
    const c = cli(["--run-dir", d]);
    expect(c.code).toBe(0);
    expect(c.json.status).toBe("complete_match");
    expect(treeHash(d)).toBe(before);
    expect(treeHash(legacyDir)).toBe(legacyBefore);
  });

  it("C4-10 --run-dir selects exactly that dir; bad args never invoke the historical writer", async () => {
    const d1 = await bundle("c4-10-a");
    const d2 = await bundle("c4-10-b", (t) => (t === FIVE_B ? { status: 500 } : maskAll(t)));
    expect(cli(["--run-dir", d1]).json.run_id).toBe("c4-10-a");
    expect(cli(["--run-dir", d2]).json.run_id).toBe("c4-10-b");
    const legacyDir = resolve(__dirname, "../fixtures/glimmer-run");
    const legacyBefore = treeHash(legacyDir);
    for (const args of [[], ["--run-dir"], ["--rundir", d1], ["--out", join(d1, "x.json")], [d1], ["--run-dir", join(d1, "nope")]]) {
      const c = cli(args);
      expect(c.code, args.join(" ")).not.toBe(0);
      expect(c.stdout, args.join(" ")).not.toMatch(/rescore: /);
    }
    expect(treeHash(legacyDir)).toBe(legacyBefore);
  });

  it("C4-11 exit/status semantics are distinct for integrity failure, incomplete and mismatch", async () => {
    const ok = await bundle("c4-11-ok");
    const integ = await bundle("c4-11-int");
    writeFileSync(join(integ, "inputs", "a.txt"), "forged");
    const inc = await bundle("c4-11-inc", (t) => (t === FIVE_B ? { status: 500 } : maskAll(t)));
    const mis = await bundle("c4-11-mis");
    const s = JSON.parse(rd(mis, "summary.json")); s.recall_end_to_end = { k: 1, n: 10 }; writeFileSync(join(mis, "summary.json"), JSON.stringify(s));
    const codes = [ok, integ, inc, mis].map((d) => cli(["--run-dir", d]));
    expect(codes.map((c) => c.json.status)).toEqual(["complete_match", "integrity_failure", "incomplete", "mismatch"]);
    expect(codes[0]!.code).toBe(0);
    const nonzero = codes.slice(1).map((c) => c.code);
    expect(nonzero.every((x) => x !== 0)).toBe(true);
    expect(new Set(nonzero).size).toBe(3);
  });
});
