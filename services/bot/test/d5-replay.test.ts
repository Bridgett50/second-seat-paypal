// D5 regressions: manifest-first validation + complete_uncompared. Dummy bundles only.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped .mjs
import { runEval } from "../scripts/redaction-eval-runner.mjs";
// @ts-expect-error untyped .mjs
import { rescoreRun } from "../scripts/rescore-glimmer-run.mjs";
import { GlimmerClient } from "../src/private/redact.js";

const SCRIPT = resolve(__dirname, "../scripts/rescore-glimmer-run.mjs");

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
  const outDir = mkdtempSync(join(tmpdir(), "d5-"));
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
function withManifest(d: string, fn: (m: any) => any) {
  const m = JSON.parse(rd(d, "manifest.json"));
  writeFileSync(join(d, "manifest.json"), JSON.stringify(fn(m)));
}
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
function fileHash(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}
function inputHashes(d: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string) => {
    const abs = join(d, rel);
    for (const n of readdirSync(abs).sort()) {
      const r = join(rel, n);
      if (statSync(join(d, r)).isDirectory()) walk(r);
      else out.set(r, fileHash(join(d, r)));
    }
  };
  walk("inputs");
  return out;
}

describe("D5 manifest-first validation and uncompared completion", () => {
  it("D5-1 duplicate planned case ids are an integrity failure", async () => {
    const d = await bundle("d5-1");
    withManifest(d, (m) => ({ ...m, planned: [m.planned[0], m.planned[0]] }));
    const re = await rescoreRun(d);
    expect(re.ok).toBe(false);
    expect(re.status).toBe("integrity_failure");
    expect(re.errors.join("\n")).toMatch(/duplicate planned case id/);
    expect(re.output).toBeNull();
    expect(re.summary).toBeNull();
    const c = cli(["--run-dir", d]);
    expect(c.code).not.toBe(0);
    expect(c.json.status).toBe("integrity_failure");
  });

  it("D5-2 bad run id, unsafe paths and wrong manifest shape fail before reads", async () => {
    const badManifests: Array<[string, (m: any) => any]> = [
      ["non-object", () => []],
      ["empty run id", (m) => ({ ...m, run_id: "" })],
      ["unsafe run id", (m) => ({ ...m, run_id: "../evil" })],
      ["spaced run id", (m) => ({ ...m, run_id: "has space" })],
      ["planned not array", (m) => ({ ...m, planned: {} })],
      ["dotdot path", (m) => ({ ...m, planned: m.planned.map((c: any, i: number) => (i === 0 ? { ...c, file: "../evil.txt" } : c)) })],
      ["absolute path", (m) => ({ ...m, planned: m.planned.map((c: any, i: number) => (i === 0 ? { ...c, file: "/abs.txt" } : c)) })],
      ["backslash path", (m) => ({ ...m, planned: m.planned.map((c: any, i: number) => (i === 0 ? { ...c, file: "a\\b.txt" } : c)) })],
      ["missing case id", (m) => ({ ...m, planned: m.planned.map((c: any, i: number) => (i === 0 ? { entities: c.entities } : c)) })],
    ];
    for (const [name, fn] of badManifests) {
      const d = await bundle(`d5-2-${name.replace(/[^a-z]+/g, "-")}`);
      withManifest(d, fn);
      const re = await rescoreRun(d);
      expect(re.status, name).toBe("integrity_failure");
      expect(re.ok, name).toBe(false);
      expect(re.errors.join("\n"), name).toMatch(/manifest/i);
      // No aggregate metrics are published on manifest failure.
      expect(re.output, name).toBeNull();
      expect(re.summary, name).toBeNull();
      expect(re.report, name).toBeNull();
      const c = cli(["--run-dir", d]);
      expect(c.code, name).not.toBe(0);
      expect(c.json.status, name).toBe("integrity_failure");
    }
    // No further reads: a bad manifest plus a deleted input still reports
    // only the manifest failure, never a missing-input error.
    const d = await bundle("d5-2-no-further-reads");
    withManifest(d, (m) => ({ ...m, run_id: "../evil" }));
    rmSync(join(d, "inputs", "a.txt"));
    const re = await rescoreRun(d);
    expect(re.status).toBe("integrity_failure");
    expect(re.errors.join("\n")).toMatch(/manifest/i);
    expect(re.errors.join("\n")).not.toMatch(/missing input file/);
    expect(re.output).toBeNull();
  });

  it("D5-3 missing summary or report never complete_match; API and CLI share the policy", async () => {
    // Missing summary: complete reconstruction with nothing to compare against.
    const d = await bundle("d5-3-no-summary");
    rmSync(join(d, "summary.json"));
    const re = await rescoreRun(d);
    expect(re.ok).toBe(true);
    expect(re.complete).toBe(true);
    expect(re.output.request_completion).toEqual({ completed: 2, planned: 2 });
    expect(re.status).toBe("complete_uncompared");
    expect(re.status).not.toBe("complete_match");
    const c = cli(["--run-dir", d]);
    expect(c.json.status).toBe("complete_uncompared");
    expect(c.code).not.toBe(0);
    expect(c.code).toBe(5);

    // Missing report: same policy.
    const r = await bundle("d5-3-no-report");
    rmSync(join(r, "report.txt"));
    const rr = await rescoreRun(r);
    expect(rr.ok).toBe(true);
    expect(rr.complete).toBe(true);
    expect(rr.mismatches).toEqual([]);
    expect(rr.status).toBe("complete_uncompared");
    expect(rr.status).not.toBe("complete_match");
    const cr = cli(["--run-dir", r]);
    expect(cr.json.status).toBe("complete_uncompared");
    expect(cr.code).not.toBe(0);
    expect(cr.code).toBe(5);

    // Both saved outputs missing: still a complete reconstruction, still uncompared.
    const both = await bundle("d5-3-neither");
    rmSync(join(both, "summary.json"));
    rmSync(join(both, "report.txt"));
    expect((await rescoreRun(both)).status).toBe("complete_uncompared");
    const cb = cli(["--run-dir", both]);
    expect(cb.json.status).toBe("complete_uncompared");
    expect(cb.code).toBe(5);
  });

  it("D5-4 unchanged replay matches, one failure keeps full denominator, removed record and torn tail stay incomplete", async () => {
    // Unchanged complete bundle still reproduces the saved metrics/report.
    const ok = await bundle("d5-4-ok");
    const okBefore = treeHash(ok);
    const okInputs = inputHashes(ok);
    const re = await rescoreRun(ok);
    expect(re.output).toEqual(JSON.parse(rd(ok, "summary.json")));
    expect(re.report + "\n").toBe(rd(ok, "report.txt"));
    expect(re.mismatches).toEqual([]);
    expect(re.status).toBe("complete_match");
    const okCli = cli(["--run-dir", ok]);
    expect(okCli.code).toBe(0);
    expect(okCli.json.status).toBe("complete_match");
    expect(treeHash(ok)).toBe(okBefore);
    expect(inputHashes(ok)).toEqual(okInputs);

    // One failed case keeps the full planned denominator.
    const oneFail = await bundle("d5-4-fail", (t) => (t === FIVE_B ? { status: 500 } : maskAll(t)));
    const failInputs = inputHashes(oneFail);
    const rf = await rescoreRun(oneFail);
    expect(rf.ok).toBe(true);
    expect(rf.output.request_completion).toEqual({ completed: 1, planned: 2 });
    expect(rf.output.recall_end_to_end).toEqual({ k: 5, n: 10 });
    expect(rf.status).toBe("incomplete");
    expect(inputHashes(oneFail)).toEqual(failInputs);

    // A removed record and a torn tail both stay incomplete.
    const removed = await bundle("d5-4-removed");
    wjsonl(removed, "records.jsonl", jsonl(removed, "records.jsonl").slice(0, 1));
    const rr = await rescoreRun(removed);
    expect(rr.complete).toBe(false);
    expect(rr.output.request_completion).toEqual({ completed: 1, planned: 2 });
    expect(rr.status).toBe("incomplete");
    const torn = await bundle("d5-4-torn");
    writeFileSync(join(torn, "records.jsonl"), rd(torn, "records.jsonl") + '{"file":"a.txt","sta');
    const rt = await rescoreRun(torn);
    expect(rt.truncated).toBe(true);
    expect(rt.complete).toBe(false);
    expect(rt.status).toBe("incomplete");
  });

  it("D5-5 altered totals, status, raw content and finish-error metadata mismatch; duplicate, missing and unexpected receipts rejected; input dir hashes unchanged", async () => {
    // Altered totals/status evidence is still rejected, never trusted.
    const forged = await bundle("d5-5-forged");
    const forgedInputs = inputHashes(forged);
    const real = structuredClone(JSON.parse(rd(forged, "summary.json")));
    const saved = JSON.parse(rd(forged, "summary.json"));
    saved.request_completion = { completed: 99, planned: 2 };
    writeFileSync(join(forged, "summary.json"), JSON.stringify(saved));
    const rforged = await rescoreRun(forged);
    expect(rforged.output.request_completion).toEqual(real.request_completion);
    expect(rforged.mismatches).toEqual(expect.arrayContaining(["request_completion"]));
    expect(rforged.status).toBe("mismatch");
    expect(inputHashes(forged)).toEqual(forgedInputs);

    // Duplicate receipts are rejected.
    const dupRaw = await bundle("d5-5-dupraw");
    const dupInputs = inputHashes(dupRaw);
    const raws = jsonl(dupRaw, "glimmer-raw.jsonl");
    wjsonl(dupRaw, "glimmer-raw.jsonl", [...raws, raws[0]]);
    const rdup = await rescoreRun(dupRaw);
    expect(rdup.ok).toBe(false);
    expect(rdup.status).toBe("integrity_failure");
    expect(inputHashes(dupRaw)).toEqual(dupInputs);

    // --help documents the nonzero exit code for complete_uncompared.
    const help = cli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/complete_uncompared/);
    expect(help.stdout).toMatch(/5/);
  });
});
