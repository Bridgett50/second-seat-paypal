// G6 rehearsal guards: replay accounting and strict-replay integrity.
// Dummy bundles only (mkdtemp), no sealed paths, no network.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped .mjs
import { runEval } from "../scripts/redaction-eval-runner.mjs";
// @ts-expect-error untyped .mjs
import { rescoreRun } from "../scripts/rescore-glimmer-run.mjs";
import { GlimmerClient } from "../src/private/redact.js";

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
  const outDir = mkdtempSync(join(tmpdir(), "g6-"));
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
function snapFiles(d: string, files: string[]) {
  return new Map(files.map((f) => [f, { bytes: rd(d, f), mtimeMs: statSync(join(d, f)).mtimeMs }]));
}

describe("G6 replay rehearsal guards", () => {
  it("G6-5g", async () => {
    // Two planned five-span cases, one failure: completion 1/2,
    // completed coverage 5/5, full coverage 5/10.
    const d = await bundle("g6-5", (t) => (t === FIVE_B ? { status: 500 } : maskAll(t)));
    const re = await rescoreRun(d);
    expect(re.ok).toBe(true);
    expect(re.output.request_completion).toEqual({ completed: 1, planned: 2 });
    expect(re.output.recall_completed).toEqual({ k: 5, n: 5 });
    expect(re.output.recall_end_to_end).toEqual({ k: 5, n: 10 });
    expect(re.status).toBe("incomplete");

    // Reasoning-only, length-truncated, and malformed outputs are failures,
    // never scored as text.
    const one = [{ file: "a.txt", entities: FIVE_A.split(" ") }];
    const texts = new Map([["a.txt", FIVE_A]]);
    const reasoning = await rescoreRun(
      await bundle("g6-5-reasoning", (t) => ({ content: "", reasoning: maskAll(t).content! }), one, texts),
    );
    expect(reasoning.records[0].status).toBe("error");
    expect(reasoning.output.recall_end_to_end).toEqual({ k: 0, n: 5 });
    const length = await rescoreRun(
      await bundle("g6-5-length", (t) => ({ content: maskAll(t).content!, finish: "length" }), one, texts),
    );
    expect(length.records[0].status).toBe("error");
    expect(length.output.recall_end_to_end).toEqual({ k: 0, n: 5 });
    const malformed = await rescoreRun(
      await bundle("g6-5-malformed", () => ({ content: "not json at all" }), one, texts),
    );
    expect(malformed.records[0].status).toBe("error");
    expect(malformed.output.recall_end_to_end).toEqual({ k: 0, n: 5 });
  });

  it("G6-6g", async () => {
    // Altered totals are rejected, never trusted.
    const forged = await bundle("g6-6-forged");
    const real = structuredClone(JSON.parse(rd(forged, "summary.json")));
    const saved = JSON.parse(rd(forged, "summary.json"));
    saved.request_completion = { completed: 99, planned: 2 };
    writeFileSync(join(forged, "summary.json"), JSON.stringify(saved));
    const rforged = await rescoreRun(forged);
    expect(rforged.output.request_completion).toEqual(real.request_completion);
    expect(rforged.mismatches).toEqual(expect.arrayContaining(["request_completion"]));
    expect(rforged.status).toBe("mismatch");

    // Unknown terminal status is rejected.
    const bad = await bundle("g6-6-status");
    const recs = jsonl(bad, "records.jsonl");
    recs[1].status = "done";
    wjsonl(bad, "records.jsonl", recs);
    const rbad = await rescoreRun(bad);
    expect(rbad.ok).toBe(false);
    expect(rbad.status).toBe("integrity_failure");

    // Duplicate receipts are rejected; a missing receipt leaves the run
    // incomplete with the full denominator.
    const dup = await bundle("g6-6-dup");
    const raws = jsonl(dup, "glimmer-raw.jsonl");
    wjsonl(dup, "glimmer-raw.jsonl", [...raws, raws[0]]);
    const rdup = await rescoreRun(dup);
    expect(rdup.ok).toBe(false);
    expect(rdup.status).toBe("integrity_failure");
    const missing = await bundle("g6-6-missing");
    wjsonl(missing, "records.jsonl", jsonl(missing, "records.jsonl").slice(0, 1));
    const rmissing = await rescoreRun(missing);
    expect(rmissing.complete).toBe(false);
    expect(rmissing.output.request_completion).toEqual({ completed: 1, planned: 2 });
    expect(rmissing.status).toBe("incomplete");

    // A torn trailing record stays incomplete.
    const torn = await bundle("g6-6-torn");
    writeFileSync(join(torn, "records.jsonl"), rd(torn, "records.jsonl") + '{"file":"a.txt","sta');
    const rtorn = await rescoreRun(torn);
    expect(rtorn.truncated).toBe(true);
    expect(rtorn.complete).toBe(false);
    expect(rtorn.status).toBe("incomplete");

    // Missing comparison evidence is not complete_match.
    const nocomp = await bundle("g6-6-nocomp");
    rmSync(join(nocomp, "summary.json"));
    const rnocomp = await rescoreRun(nocomp);
    expect(rnocomp.ok).toBe(true);
    expect(rnocomp.complete).toBe(true);
    expect(rnocomp.status).toBe("complete_uncompared");
    expect(rnocomp.status).not.toBe("complete_match");

    // Replay changes no bundle bytes or mtimes.
    const intact = await bundle("g6-6-intact");
    const files = ["manifest.json", "records.jsonl", "glimmer-raw.jsonl", "summary.json", "report.txt"];
    const before = snapFiles(intact, files);
    const rintact = await rescoreRun(intact);
    expect(rintact.status).toBe("complete_match");
    expect(snapFiles(intact, files)).toEqual(before);
  });
});
