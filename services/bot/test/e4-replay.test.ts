// E4 regressions: replay rescoring holes (dot-segment aliases, summary key
// set, symlinked evidence). Dummy bundles only, temp dirs under os.tmpdir().
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
              choices: [{ message: { content: r.content ?? "" }, finish_reason: r.finish ?? "stop" }],
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

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

async function bundle(runId: string, reply: (text: string) => Reply = maskAll) {
  const outDir = mkdtempSync(join(tmpdir(), "e4-"));
  dirs.push(outDir);
  await runEval({
    cases: CASES,
    readText: async (c: { file: string }) => TEXTS.get(c.file) as string,
    makeRedactor: () => new GlimmerClient("http://127.0.0.1:9", { fetchImpl: fetchFor(reply) }),
    concurrency: 1,
    runId,
    outDir,
  });
  return join(outDir, runId);
}
const rd = (d: string, f: string) => readFileSync(join(d, f), "utf8");

describe("E4 replay rescoring holes", () => {
  it("E4-1 dot-segment alias beside a planned id is an integrity failure", async () => {
    const d = await bundle("e4-1-dot");
    const before = rd(d, "inputs/a.txt");
    const m = JSON.parse(rd(d, "manifest.json"));
    const alias = { ...m.planned[0], file: "./a.txt" };
    m.planned = [...m.planned, alias];
    writeFileSync(join(d, "manifest.json"), JSON.stringify(m));
    const re = await rescoreRun(d);
    expect(re.ok).toBe(false);
    expect(re.status).toBe("integrity_failure");
    expect(re.errors.join("\n")).toMatch(/manifest/i);
    expect(rd(d, "inputs/a.txt")).toBe(before);
  });

  it("E4-2 empty or key-dropping saved summary with honest report is a mismatch", async () => {
    const d = await bundle("e4-2-empty");
    writeFileSync(join(d, "summary.json"), "{}");
    const re = await rescoreRun(d);
    expect(re.mismatches.length).toBeGreaterThan(0);
    expect(re.status).toBe("mismatch");

    const d2 = await bundle("e4-2-missing-keys");
    const saved = JSON.parse(rd(d2, "summary.json"));
    delete saved.request_completion;
    delete saved.recall_end_to_end;
    writeFileSync(join(d2, "summary.json"), JSON.stringify(saved));
    const r2 = await rescoreRun(d2);
    expect(r2.mismatches).toEqual(expect.arrayContaining(["request_completion", "recall_end_to_end"]));
    expect(r2.status).toBe("mismatch");
  });

  it("E4-3 symlinked input, records, or summary is an integrity failure", async () => {
    const d = await bundle("e4-3-input");
    const outsideDir = mkdtempSync(join(tmpdir(), "e4-out-"));
    dirs.push(outsideDir);
    const target = join(outsideDir, "a-copy.txt");
    writeFileSync(target, rd(d, "inputs/a.txt"));
    rmSync(join(d, "inputs", "a.txt"));
    symlinkSync(target, join(d, "inputs", "a.txt"));
    const re = await rescoreRun(d);
    expect(re.ok).toBe(false);
    expect(re.status).toBe("integrity_failure");

    const r = await bundle("e4-3-records");
    const rOut = mkdtempSync(join(tmpdir(), "e4-out-"));
    dirs.push(rOut);
    const rTarget = join(rOut, "records.jsonl");
    writeFileSync(rTarget, rd(r, "records.jsonl"));
    rmSync(join(r, "records.jsonl"));
    symlinkSync(rTarget, join(r, "records.jsonl"));
    const rr = await rescoreRun(r);
    expect(rr.ok).toBe(false);
    expect(rr.status).toBe("integrity_failure");

    const s = await bundle("e4-3-summary");
    const sOut = mkdtempSync(join(tmpdir(), "e4-out-"));
    dirs.push(sOut);
    const sTarget = join(sOut, "summary.json");
    writeFileSync(sTarget, rd(s, "summary.json"));
    rmSync(join(s, "summary.json"));
    symlinkSync(sTarget, join(s, "summary.json"));
    const rs = await rescoreRun(s);
    expect(rs.ok).toBe(false);
    expect(rs.status).toBe("integrity_failure");
  });
});
