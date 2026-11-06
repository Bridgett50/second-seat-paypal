// B5 acceptance: launch / download / freeze contract, tested ONLY with new
// dummy datasets in tmp dirs. Never reads, copies, hashes or packages any
// real holdout dataset or sealed manifest. Python helpers run with stdlib
// only (no modal import); no Modal, no network, no models.
// @ts-expect-error untyped helper module
import { runEval } from "../scripts/redaction-eval-runner.mjs";
// @ts-expect-error untyped helper module
import { rescoreRun } from "../scripts/rescore-glimmer-run.mjs";
import { GlimmerClient, parseGlimmerAnswer } from "../src/private/redact.js";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const botDir = join(here, "..");
const repo = join(botDir, "..", "..");
const LC = join(repo, "infra", "modal", "launch_contract.py");
const APP = join(repo, "infra", "modal", "glimmer_app.py");
const RUNBOOK = join(repo, "docs", "runbook-holdout-run.md");

afterEach(() => {
  delete process.env["GLIMMER_RAW_DIR"];
  vi.restoreAllMocks();
});

// Run a Python snippet against launch_contract.py; the snippet must end by
// assigning `out`, which is printed as JSON.
function py(body: string): any {
  const prelude = [
    "import json, os, sys, importlib.util",
    `spec = importlib.util.spec_from_file_location("lc", ${JSON.stringify(LC)})`,
    "lc = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(lc)",
    "assert 'modal' not in sys.modules, 'launch_contract must not import modal'",
  ].join("\n");
  const r = spawnSync("python3", ["-c", `${prelude}\n${body}\nprint(json.dumps(out))`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
  const lines = r.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]!);
}
const J = (v: unknown) => JSON.stringify(JSON.stringify(v));

function dummyRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "b5-fixtures-"));
  const mk = (name: string, text: string, ents: string[]) => {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, `${name}-01.txt`), text);
    writeFileSync(join(root, name, "cases.json"), JSON.stringify([{ file: `${name}-01.txt`, entities: ents }]));
  };
  mk("dummyx", "Call Ana at 555-0100", ["Ana", "555-0100"]);
  mk("devy", "Mail Bo at 555-0199", ["Bo", "555-0199"]);
  return root;
}

function validConfig(root: string) {
  const sha = py(`out = lc.dataset_sha256(${JSON.stringify(join(root, "dummyx"))})`);
  expect(sha).toMatch(/^[0-9a-f]{64}$/);
  return {
    dataset: "dummyx",
    dataset_sha256: sha,
    source_sha: "a".repeat(40),
    image: `vllm/vllm-openai@sha256:${"b".repeat(64)}`,
    model: "meta-models/Muse-Glimmer-30B",
    model_revision: "c".repeat(40),
    review: { status: "reviewed", reviewer: "Dummy Reviewer", reviewed_at: "2026-10-27", dataset_sha256: sha },
  };
}
const blockers = (cfg: unknown, root: string, invoked?: string): string[] =>
  py(
    `out = lc.check_launch(json.loads(${J(cfg)}), ${JSON.stringify(root)}${invoked !== undefined ? `, invoked_dataset=${JSON.stringify(invoked)}` : ""})`,
  );

describe("B5 launch contract (dummy datasets only)", () => {
  it("B5-1: selecting dummy dataset X packages and invokes X", () => {
    const root = dummyRoot();
    expect(py(`out = lc.eval_command("dummyx", "/results", "run-1", "<config>", "<config_sha256>")`)).toEqual([
      "node",
      "scripts/redaction-eval.mjs",
      "--cases",
      "dummyx",
      "--out-dir",
      "/results",
      "--run-id",
      "run-1",
      "--run-config",
      "<config>",
      "--run-config-sha256",
      "<config_sha256>",
    ]);
    const dirs: Array<[string, string]> = py(`out = lc.package_dirs("/r", "dummyx")`);
    const fixtureDirs = dirs.filter(([l]) => l.includes("/fixtures/"));
    expect(fixtureDirs).toEqual([["/r/services/bot/fixtures/dummyx", "/app/services/bot/fixtures/dummyx"]]);
    expect(blockers(validConfig(root), root, "dummyx")).toEqual([]);
    // The Modal app really uses the helpers (no hard-coded dataset).
    const app = readFileSync(APP, "utf8");
    expect(app).toMatch(/eval_command\(/);
    expect(app).toMatch(/package_dirs\(/);
    expect(app).not.toMatch(/fixtures\/pii/);
    expect(app).toMatch(/check_launch\(/);
  });

  it("B5-2: substituting development dataset Y for X blocks launch", () => {
    const root = dummyRoot();
    const cfg = validConfig(root);
    expect(blockers(cfg, root, "devy").join(" ")).toMatch(/dataset/i);
    // Same name, swapped contents: hash no longer matches the frozen config.
    rmSync(join(root, "dummyx"), { recursive: true });
    mkdirSync(join(root, "dummyx"));
    for (const f of readdirSync(join(root, "devy"))) writeFileSync(join(root, "dummyx", f), readFileSync(join(root, "devy", f)));
    expect(blockers(cfg, root, "dummyx").join(" ")).toMatch(/dataset/i);
  });

  it("B5-3: missing dataset selection fails clearly, never defaults to dev fixtures", () => {
    const root = dummyRoot();
    const raised = py(`
try:
    lc.eval_command("", "/results", "run-1", "<config>", "<config_sha256>")
    a = None
except ValueError as e:
    a = str(e)
try:
    lc.package_dirs("/r", None)
    b = None
except ValueError as e:
    b = str(e)
out = [a, b]`);
    expect(raised[0]).toMatch(/dataset/i);
    expect(raised[1]).toMatch(/dataset/i);
    const cfg: Record<string, unknown> = { ...validConfig(root) };
    delete cfg["dataset"];
    expect(blockers(cfg, root).join(" ")).toMatch(/dataset/i);
    // Node CLI in launch mode (--out-dir/--run-id) refuses to default to pii.
    const out = mkdtempSync(join(tmpdir(), "b5-cli-"));
    const r = spawnSync("node", ["scripts/redaction-eval.mjs", "--out-dir", out, "--run-id", "r1"], {
      cwd: botDir,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "" },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--cases|dataset/i);
    expect(existsSync(join(out, "r1"))).toBe(false);
  });

  it("B5-4: mock download preserves every evidence file and filename", () => {
    const vol = mkdtempSync(join(tmpdir(), "b5-vol-"));
    const files: Record<string, string> = {
      "run-1/manifest.json": '{"run_id":"run-1"}\n',
      "run-1/records.jsonl": '{"file":"a.txt"}\n',
      "run-1/glimmer-raw.jsonl": '{"content":"{}"}\n',
      "run-1/summary.json": '{"complete":true}\n',
      "run-1/report.txt": "report\n",
      "run-1/glimmer-live-eval.json": "{}\n",
      "run-1/inputs/a.txt": "Call Ana",
      "run-2/manifest.json": "other run\n",
    };
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(dirname(join(vol, p)), { recursive: true });
      writeFileSync(join(vol, p), c);
    }
    const dest = join(mkdtempSync(join(tmpdir(), "b5-dl-")), "run-1");
    py(`
vol = ${JSON.stringify(vol)}
def list_files(run_id):
    base = os.path.join(vol, run_id)
    res = []
    for d, _, fs in os.walk(base):
        for f in fs:
            res.append(os.path.relpath(os.path.join(d, f), base).replace(os.sep, "/"))
    return res
def read_file(remote):
    with open(os.path.join(vol, remote), "rb") as fh:
        return fh.read()
out = lc.download_run(list_files, read_file, "run-1", ${JSON.stringify(dest)})`);
    const got: Record<string, string> = {};
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else got[`run-1/${relative(dest, p).split("\\").join("/")}`] = readFileSync(p, "utf8");
      }
    };
    walk(dest);
    const expected = Object.fromEntries(Object.entries(files).filter(([k]) => k.startsWith("run-1/")));
    expect(got).toEqual(expected);
  });

  it("B5-5: a downloaded dummy bundle passes B4 replay (function and CLI) and matches the report", async () => {
    const vol = mkdtempSync(join(tmpdir(), "b5-vol5-"));
    const text = "Call Ana at 555-0100";
    const content = JSON.stringify({
      spans: [
        { start: 5, end: 8, label: "PERSON_NAME" },
        { start: 12, end: 20, label: "PHONE_NUMBER" },
      ],
      boxes: [],
    });
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: null }),
    })) as unknown as typeof fetch;
    const r = await runEval({
      cases: [{ file: "dummyx-01.txt", entities: ["Ana", "555-0100"] }],
      readText: async () => text,
      makeRedactor: () => new GlimmerClient("http://localhost:9", { fetchImpl }),
      concurrency: 1,
      runId: "run-5",
      outDir: vol,
    });
    expect(r.complete).toBe(true);
    const dest = join(mkdtempSync(join(tmpdir(), "b5-dl5-")), "run-5");
    py(`
vol = ${JSON.stringify(vol)}
def list_files(run_id):
    base = os.path.join(vol, run_id)
    return [os.path.relpath(os.path.join(d, f), base).replace(os.sep, "/") for d, _, fs in os.walk(base) for f in fs]
def read_file(remote):
    with open(os.path.join(vol, remote), "rb") as fh:
        return fh.read()
out = lc.download_run(list_files, read_file, "run-5", ${JSON.stringify(dest)})`);
    const re = await rescoreRun(dest, { parseAnswer: parseGlimmerAnswer });
    expect(re.ok).toBe(true);
    expect(re.complete).toBe(true);
    expect(re.output).toEqual(JSON.parse(readFileSync(join(vol, "run-5", "summary.json"), "utf8")));
    expect(re.report + "\n").toBe(readFileSync(join(vol, "run-5", "report.txt"), "utf8"));
    // Documented read-only replay CLI.
    const before = readdirSync(dest).sort();
    const cli = spawnSync("node", ["scripts/rescore-glimmer-run.mjs", "--run-dir", dest], { cwd: botDir, encoding: "utf8" });
    expect(cli.status).toBe(0);
    const parsed = JSON.parse(cli.stdout);
    expect(parsed).toMatchObject({ ok: true, complete: true, mismatches: [] });
    expect(readdirSync(dest).sort()).toEqual(before);
  });

  it("B5-6: pending review, placeholder SHA, mutable image tag, or unpinned model revision blocks launch", () => {
    const root = dummyRoot();
    const base = validConfig(root);
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ ...base, review: { ...base.review, status: "pending-manual-review" } }, /review/i],
      [{ ...base, source_sha: "<fill at freeze>" }, /source/i],
      [{ ...base, source_sha: "0".repeat(40) }, /source/i],
      [{ ...base, image: "vllm/vllm-openai:muse-glimmer" }, /image/i],
      [{ ...base, model_revision: "main" }, /revision/i],
      [{ ...base, model_revision: undefined }, /revision/i],
    ];
    for (const [cfg, re] of cases) {
      const b = blockers(JSON.parse(JSON.stringify(cfg)), root, "dummyx");
      expect(b.length).toBeGreaterThan(0);
      expect(b.join(" ")).toMatch(re);
    }
  });

  it("B5-7: a completed review attestation passes the review-status check", () => {
    const root = dummyRoot();
    const cfg = validConfig(root);
    expect(py(`out = lc.review_status_ok(json.loads(${J(cfg.review)}), ${JSON.stringify(cfg.dataset_sha256)})`)).toBe(true);
    expect(py(`out = lc.review_status_ok(json.loads(${J({ ...cfg.review, reviewer: "" })}), ${JSON.stringify(cfg.dataset_sha256)})`)).toBe(false);
    expect(py(`out = lc.review_status_ok(json.loads(${J(cfg.review)}), ${JSON.stringify("d".repeat(64))})`)).toBe(false);
    expect(blockers(cfg, root, "dummyx")).toEqual([]);
  });

  it("B5-8: model load / readiness consume the work deadline (fake clock)", () => {
    const res = py(`
class Clock:
    def __init__(self): self.t = 1000.0
    def now(self): return self.t
    def sleep(self, s): self.t += s
def run(load_s):
    c = Clock()
    probe = lambda: 200 if c.t >= 1000.0 + load_s else None
    return lc.wait_ready(c.now, c.sleep, probe, 1000.0)
out = [run(200), run(0), run(400)]`);
    expect(res[0]).toMatchObject({ ready: true, remaining_ms: (780 - 200) * 1000 - 30_000 });
    expect(res[1]).toMatchObject({ ready: true, remaining_ms: 780 * 1000 - 30_000 });
    expect(res[0].remaining_s).toBeCloseTo(780 - 200 - 5, 5);
    expect(res[2].ready).toBe(false);
  });

  it("B5-9: deadline exhaustion stops new requests and records the rest as not_run", async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    let calls = 0;
    const r = await runEval({
      cases: ["a", "b", "c", "d"].map((f) => ({ file: `${f}.txt`, entities: [] })),
      readText: async () => "nothing here",
      makeRedactor: () => ({
        redactText: async (t: string) => {
          calls += 1;
          clock += 600;
          return { maskedText: t, spans: [] };
        },
      }),
      concurrency: 1,
      deadlineMs: 1000,
      runId: "b5-9",
    });
    expect(calls).toBe(2);
    expect(r.records.map((x: { status: string }) => x.status)).toEqual(["ok", "ok", "not_run", "not_run"]);
    expect(r.complete).toBe(false);
  });

  it("B5-10: an interrupted writer leaves recoverable incomplete evidence", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "b5-int-"));
    try {
      const text = "Call Ana at 555-0100";
      const content = JSON.stringify({ spans: [{ start: 5, end: 8, label: "PERSON_NAME" }], boxes: [] });
      let n = 0;
      let secondStartedResolve!: () => void;
      const secondStarted = new Promise<void>((resolve) => {
        secondStartedResolve = resolve;
      });
      let releaseReject!: (err: Error) => void;
      const release = new Promise<never>((_, reject) => {
        releaseReject = reject;
      });
      // Prevent an unhandled rejection while the writer is parked.
      release.catch(() => {});
      const fetchImpl = (async () => {
        n += 1;
        if (n > 1) {
          secondStartedResolve(); // first case already persisted (concurrency 1)
          return release; // writer "dies" mid-case until the test releases it
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }) };
      }) as unknown as typeof fetch;
      const runPromise = runEval({
        cases: [
          { file: "a.txt", entities: ["Ana"] },
          { file: "b.txt", entities: ["Ana"] },
        ],
        readText: async () => text,
        makeRedactor: () => new GlimmerClient("http://localhost:9", { fetchImpl }),
        concurrency: 1,
        runId: "b5-10",
        outDir,
      });
      // Cleanup path: release the parked writer and wait for the run to settle.
      const cleanup = async () => {
        releaseReject(new Error("writer died mid-case"));
        await runPromise;
      };
      try {
        await secondStarted;
        const recs = join(outDir, "b5-10", "records.jsonl");
        expect(readFileSync(recs, "utf8").trim().split("\n")).toHaveLength(1);
        appendFileSync(recs, '{"file":"b.txt","sta'); // torn write
        const re = await rescoreRun(join(outDir, "b5-10"), { parseAnswer: parseGlimmerAnswer });
        expect(re.truncated).toBe(true);
        expect(re.complete).toBe(false);
        expect(re.records.map((x: { file: string; status: string }) => [x.file, x.status])).toEqual([["a.txt", "ok"]]);
        expect(re.output.recall_end_to_end).toEqual({ k: 1, n: 2 });
      } finally {
        await cleanup();
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("B5-11: no B5 test or launch helper references an actual sealed path", () => {
    const banned = ["heldout" + "-sealed", "eval/" + "heldout/", "heldout-" + "presealed", "shield-" + "heldout", "holdout" + "-v1"];
    for (const p of [fileURLToPath(import.meta.url), LC]) {
      const src = readFileSync(p, "utf8");
      for (const b of banned) expect(src.includes(b), `${p} mentions ${b}`).toBe(false);
    }
  });

  it("B5-12: documented commands and tested command construction agree", () => {
    const book = readFileSync(RUNBOOK, "utf8");
    const evalCmd: string[] = py(`out = lc.eval_command("<dataset>", "/results", "<run_id>", "<config>", "<config_sha256>")`);
    expect(book).toContain("`" + evalCmd.join(" ") + "`");
    expect(book).toMatch(/modal run --detach infra\/modal\/glimmer_app\.py --dataset <dataset> --config <config>/);
    expect(book).toContain("`node services/bot/scripts/rescore-glimmer-run.mjs --run-dir <run_dir>`");
    const app = readFileSync(APP, "utf8");
    expect(app).toMatch(/def main\(dataset: str = "", config: str = ""\)/);
    const c = spawnSync("python3", ["-m", "py_compile", APP, LC], { encoding: "utf8" });
    expect(c.status, c.stderr).toBe(0);
  });
});
