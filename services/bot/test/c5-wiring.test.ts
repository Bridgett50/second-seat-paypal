// C5 regressions: the real infra/modal/glimmer_app.py wiring is exercised
// against an inert SDK-shaped `modal` stub (injected via sys.modules, never
// the real SDK). Dummy datasets in tmp repos only; no Modal, no network, no
// models, no sealed paths.
// @ts-expect-error untyped helper module
import { runEval } from "../scripts/redaction-eval-runner.mjs";
// @ts-expect-error untyped helper module
import { rescoreRun } from "../scripts/rescore-glimmer-run.mjs";
import { GlimmerClient } from "../src/private/redact.js";
import { toLaunchConfig } from "../src/release/runConfig.js";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const botDir = join(here, "..");
const repo = join(botDir, "..", "..");
const RUNBOOK = join(repo, "docs", "runbook-holdout-run.md");
const DIGEST = `registry.example/vllm-openai@sha256:${"b".repeat(64)}`;
const REV = "c".repeat(40);

afterEach(() => vi.restoreAllMocks());

// Inert SDK-shaped modal stub. Records every construction call in REC.
const STUB = String.raw`
import sys, types, enum, json
REC = {"registry": [], "local_dirs": [], "local_files": [], "spawn": [], "fn_kwargs": []}
class FileEntryType(enum.IntEnum):
    UNSPECIFIED = 0
    FILE = 1
    DIRECTORY = 2
    SYMLINK = 3
class FileEntry:
    def __init__(self, path, type, mtime=0, size=0):
        self.path, self.type, self.mtime, self.size = path, type, mtime, size
class Image:
    def __init__(self, ref=None): self.ref = ref
    @staticmethod
    def from_registry(ref, **kw):
        REC["registry"].append(ref); return Image(ref)
    def _c(self): return Image(self.ref)
    def dockerfile_commands(self, *a, **k): return self._c()
    def entrypoint(self, *a, **k): return self._c()
    def run_commands(self, *a, **k): return self._c()
    def pip_install(self, *a, **k): return self._c()
    def env(self, *a, **k): return self._c()
    def add_local_dir(self, l, r, **k): REC["local_dirs"].append([str(l), str(r)]); return self._c()
    def add_local_file(self, l, r, **k): REC["local_files"].append([str(l), str(r)]); return self._c()
class Volume:
    FILES = {}
    def __init__(self, name): self.name = name
    @staticmethod
    def from_name(name, **k): return Volume(name)
    def listdir(self, path, recursive=False):
        out, dirs = [], set()
        for p in sorted(Volume.FILES):
            if not p.startswith(path.rstrip("/") + "/"): continue
            parts = p.split("/")
            for i in range(1, len(parts) - 1):
                d = "/".join(parts[: i + 1])
                if d not in dirs: dirs.add(d); out.append(FileEntry(d, FileEntryType.DIRECTORY))
            out.append(FileEntry(p, FileEntryType.FILE, size=len(Volume.FILES[p])))
        return out
    def read_file(self, path):
        data = Volume.FILES[path]
        yield data[: len(data) // 2]; yield data[len(data) // 2 :]
    def commit(self): pass
class _Call:
    object_id = "fc-stub"
class Function:
    def __init__(self, f): self.f = f
    def spawn(self, *a, **k): REC["spawn"].append([list(a), k]); return _Call()
    def remote(self, *a, **k): raise RuntimeError("remote() not allowed in stub")
    def local(self, *a, **k): return self.f(*a, **k)
class App:
    def __init__(self, *a, **k): pass
    def function(self, **kw):
        REC["fn_kwargs"].append({k: v for k, v in kw.items() if k in ("gpu", "timeout")})
        return lambda f: Function(f)
    def local_entrypoint(self, *a, **k): return lambda f: f
def concurrent(**k): return lambda f: f
def web_server(*a, **k): return lambda f: f
modal = types.ModuleType("modal")
for _n, _v in dict(App=App, Image=Image, Volume=Volume, concurrent=concurrent, web_server=web_server,
                   FileEntry=FileEntry, FileEntryType=FileEntryType).items(): setattr(modal, _n, _v)
sys.modules["modal"] = modal
volume_mod = types.ModuleType("modal.volume"); volume_mod.FileEntry = FileEntry; volume_mod.FileEntryType = FileEntryType
sys.modules["modal.volume"] = volume_mod; modal.volume = volume_mod
`;

function git(r: string, ...args: string[]): string {
  const res = spawnSync("git", args, { cwd: r, encoding: "utf8" });
  expect(res.status).toBe(0);
  return (res.stdout as string).trim();
}

function headSha(r: string): string {
  return git(r, "rev-parse", "HEAD");
}

function shaFile(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

// A throwaway repo that IS a real git checkout: real infra/modal sources
// copied in, dummy bot tree, everything committed so launch (bound to the
// git commit) can succeed from a clean tree.
function fakeRepo(): string {
  const r = mkdtempSync(join(tmpdir(), "c5-repo-"));
  mkdirSync(join(r, "infra", "modal"), { recursive: true });
  for (const f of ["glimmer_app.py", "launch_contract.py"]) copyFileSync(join(repo, "infra", "modal", f), join(r, "infra", "modal", f));
  const bot = join(r, "services", "bot");
  mkdirSync(join(bot, "dist"), { recursive: true });
  mkdirSync(join(bot, "scripts"), { recursive: true });
  writeFileSync(join(bot, "dist", "x.js"), "export const x = 1;\n");
  writeFileSync(join(bot, "scripts", "redaction-eval.mjs"), "// dummy\n");
  writeFileSync(join(bot, "package.json"), "{}\n");
  for (const [name, text] of [["dummyx", "Call Ana at 555-0100"], ["devy", "Mail Bo at 555-0199"]] as const) {
    mkdirSync(join(bot, "fixtures", name), { recursive: true });
    writeFileSync(join(bot, "fixtures", name, `${name}-01.txt`), text);
    writeFileSync(join(bot, "fixtures", name, "cases.json"), JSON.stringify([{ file: `${name}-01.txt`, entities: [] }]));
  }
  writeFileSync(join(r, ".gitignore"), "__pycache__/\n");
  git(r, "init", "-q");
  git(r, "config", "user.email", "dummy@example.invalid");
  git(r, "config", "user.name", "Dummy");
  git(r, "config", "commit.gpgsign", "false");
  git(r, "add", "-A");
  git(r, "commit", "-qm", "dummy commit");
  return r;
}

// Run python: stub modal, optional env, import the real app from the fake
// repo, then run body; body assigns `out`.
function app(r: string, env: Record<string, string>, body: string): any {
  const prog = [
    STUB,
    "import importlib.util, os",
    `spec = importlib.util.spec_from_file_location("glimmer_app", ${JSON.stringify(join(r, "infra", "modal", "glimmer_app.py"))})`,
    "ga = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(ga)",
    "lc = ga.launch_contract",
    "out = None",
    body,
    "print('C5OUT ' + json.dumps({'out': out, 'rec': REC}))",
  ].join("\n");
  const res = spawnSync("python3", ["-c", prog], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
  });
  const line = res.stdout.split("\n").find((l) => l.startsWith("C5OUT "));
  if (!line) throw new Error(`python failed (${res.status}): ${res.stderr.slice(-3000)}`);
  return JSON.parse(line.slice(6));
}

function goodConfig(r: string, over: Record<string, unknown> = {}) {
  const res = app(r, {}, [
    `ds = ${JSON.stringify(join(r, "services", "bot", "fixtures", "dummyx"))}`,
    `out = {"ds": lc.dataset_sha256(ds), "src": lc.packaged_source_sha256(${JSON.stringify(r)}, "dummyx")}`,
  ].join("\n"));
  const cfg = {
    configVersion: 1,
    sourceSha: headSha(r),
    sourceSha256: res.out.src,
    dataset: { id: "dummyx", sha256: res.out.ds },
    model: { name: "meta-models/Muse-Glimmer-30B", revision: REV },
    image: { ref: DIGEST, digest: `sha256:${"b".repeat(64)}` },
    prompt: { sha256: "c".repeat(64) },
    schema: { sha256: "d".repeat(64) },
    scorer: { sha256: "f".repeat(64) },
    decoding: { temperature: 0, seed: 1, reasoning: "low" },
    tokenLimits: { maxTokens: 512 },
    timeouts: { requestMs: 60000, workDeadlineS: 700, functionTimeoutS: 840 },
    retry: { maxAttempts: 1 },
    modal: { allocations: 1, concurrency: 1, maxConcurrency: 2, scoredCanary: true, teardown: true, evidenceDownload: "complete" },
    review: { status: "reviewed", reviewer: "Dummy Reviewer", reviewed_at: "2026-10-27", dataset_sha256: res.out.ds },
    glimmerDemoRequests: 0,
    budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 },
    ...over,
  };
  const p = join(r, `cfg-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(cfg));
  return { cfg, path: p };
}

// Call main() and report SystemExit code (or null) plus spawn records.
const MAIN = (ds: string, cfg: string) => `
try:
    ga.main(dataset=${JSON.stringify(ds)}, config=${JSON.stringify(cfg)}); out = None
except SystemExit as e:
    out = e.code
`;

// Run eval_in_container's body with Popen/readiness stubbed; returns the
// captured vLLM command(s). Readiness is reported not-ready so no eval runs.
const CAPTURE_VLLM = `
import subprocess as _sp
CMDS = []
class _P:
    pid = 999999
    def poll(self): return 0
    def wait(self, timeout=None): return 0
def _popen(cmd, **k): CMDS.append(list(cmd)); return _P()
ga.subprocess.Popen = _popen
lc.wait_ready = lambda *a, **k: {"ready": False, "remaining_ms": 0, "remaining_s": 0}
import pathlib, tempfile
_tmp = tempfile.mkdtemp()
ga._RESULTS_ROOT = _tmp
_orig = pathlib.Path
ga.Path = lambda p, *a: _orig(_tmp) / str(p).lstrip("/") if str(p).startswith("/results") else _orig(p, *a)
ga.serve.f()
ga.eval_in_container.f("dummyx", ga._LAUNCH_CONFIG_SHA256)
out = CMDS
`;

describe("C5 launch/download wiring through an inert modal stub", () => {
  it("C5-1: captured image construction uses the exact configured immutable digest", () => {
    const r = fakeRepo();
    const { path } = goodConfig(r);
    const res = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path }, "out = 1");
    expect(res.rec.registry.length).toBeGreaterThan(0);
    for (const ref of res.rec.registry) expect(ref).toBe(DIGEST);
  });

  it("C5-2: captured vLLM command uses the exact configured model revision", () => {
    const r = fakeRepo();
    const { path } = goodConfig(r);
    const res = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path }, CAPTURE_VLLM);
    const cmds: string[][] = res.out;
    expect(cmds).toHaveLength(2); // serve + eval_in_container
    for (const c of cmds) {
      const i = c.indexOf("--revision");
      expect(i).toBeGreaterThan(-1);
      expect(c[i + 1]).toBe(REV);
    }
  });

  it("C5-3: packaged source identity must match the recorded one", () => {
    const r = fakeRepo();
    const env = (p: string) => ({ GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: p });
    const ok = goodConfig(r);
    const good = app(r, env(ok.path), MAIN("dummyx", ok.path));
    expect(good.out).toBe(null);
    expect(good.rec.spawn).toEqual([[[ "dummyx", shaFile(ok.path) ], {}]]);
    const bad = goodConfig(r, { sourceSha256: "d".repeat(64) });
    const blocked = app(r, env(bad.path), MAIN("dummyx", bad.path));
    expect(blocked.out).toBe(2);
    expect(blocked.rec.spawn).toEqual([]);
    // Changing a packaged file after recording also blocks.
    writeFileSync(join(r, "services", "bot", "dist", "x.js"), "export const x = 2;\n");
    const drift = app(r, env(ok.path), MAIN("dummyx", ok.path));
    expect(drift.out).toBe(2);
    expect(drift.rec.spawn).toEqual([]);
  });

  it("C5-4: dummy dataset X is packaged and invoked; substituting Y blocks dispatch", () => {
    const r = fakeRepo();
    const { path } = goodConfig(r);
    const res = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path }, MAIN("dummyx", path));
    const fx = res.rec.local_dirs.filter(([l]: string[]) => String(l).includes("/fixtures/"));
    expect(fx).toEqual([[join(r, "services/bot/fixtures/dummyx"), "/app/services/bot/fixtures/dummyx"]]);
    expect(res.rec.spawn).toEqual([[[ "dummyx", shaFile(path) ], {}]]);
    for (const [ds, envDs] of [["devy", "dummyx"], ["devy", "devy"], ["dummyx", "devy"]]) {
      const b = app(r, { GLIMMER_EVAL_DATASET: envDs!, GLIMMER_LAUNCH_CONFIG: path }, MAIN(ds!, path));
      expect(b.out).toBe(2);
      expect(b.rec.spawn).toEqual([]);
    }
    // A --config different from the one the image was built from blocks too.
    const other = goodConfig(r);
    const m = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path }, MAIN("dummyx", other.path));
    expect(m.out).toBe(2);
    expect(m.rec.spawn).toEqual([]);
  });

  it("C5-5: missing or valueless --cases fails before fixtures or any redactor", () => {
    const script = join(botDir, "scripts", "redaction-eval.mjs");
    for (const args of [[], ["--cases"], ["--cases", ""], ["--cases-dir"], ["--cases", "--out-dir", "/tmp/x"]]) {
      const res = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" } });
      expect(res.status, `args ${JSON.stringify(args)}`).toBe(2);
      expect(res.stdout).not.toMatch(/redactor:/);
      expect(res.stderr).toMatch(/--cases/);
      expect(res.stderr).not.toMatch(/ENOENT|cases\.json/);
    }
  });

  it("C5-6: one attestation contract rejects placeholders, mutable refs, blank reviewer, bad dates", () => {
    const r = fakeRepo();
    const { cfg } = goodConfig(r);
    const flat = toLaunchConfig(cfg);
    const fx = join(r, "services", "bot", "fixtures");
    const check = (c: unknown) =>
      app(r, {}, `out = lc.check_launch(json.loads(${JSON.stringify(JSON.stringify(c))}), ${JSON.stringify(fx)}, invoked_dataset="dummyx")`).out as string[];
    const ok = (rev: unknown) =>
      app(r, {}, `out = lc.review_status_ok(json.loads(${JSON.stringify(JSON.stringify(rev))}), ${JSON.stringify(flat.dataset_sha256)})`).out;
    expect(check(flat)).toEqual([]);
    expect(ok(flat.review)).toBe(true);
    for (const bad of [
      { model_revision: "0".repeat(40) },
      { image: "registry.example/vllm-openai:latest" },
      { image: `registry.example/vllm-openai@sha256:${"0".repeat(64)}` },
      { image: `registry.example/vllm-openai:latest@sha256:${"b".repeat(64)}x` },
      { source_sha: "0".repeat(40) },
    ]) expect(check({ ...flat, ...bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
    for (const rv of [{ reviewer: "   " }, { reviewer: "\t\n" }, { reviewed_at: "not-a-date" }, { reviewed_at: "2026-13-45" }, { reviewed_at: " " }]) {
      const review = { ...flat.review, ...rv };
      expect(ok(review), JSON.stringify(rv)).toBe(false);
      expect(check({ ...flat, review }).length, JSON.stringify(rv)).toBeGreaterThan(0);
    }
  });

  it("C5-7: actual fetch wrapper handles SDK FileEntry objects, dirs and nested files; rejects escapes", () => {
    const r = fakeRepo();
    const files = { "run-7/manifest.json": "{\"a\":1}\n", "run-7/raw/deep/r.jsonl": "x\ny\n", "run-7/records.jsonl": "" };
    const setup = `Volume.FILES = {k: v.encode() for k, v in json.loads(${JSON.stringify(JSON.stringify(files))}).items()}\n`;
    const res = app(r, {}, setup + `ga.fetch(run_id="run-7")\nout = 1`);
    expect(res.out).toBe(1);
    const dest = join(r, "services", "bot", "fixtures", "glimmer-run", "run-7");
    const got: Record<string, string> = {};
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else got[relative(dest, p).split("\\").join("/")] = readFileSync(p, "utf8");
      }
    };
    walk(dest);
    expect(got).toEqual({ "manifest.json": "{\"a\":1}\n", "raw/deep/r.jsonl": "x\ny\n", "records.jsonl": "" });
    for (const evil of ["run-8/../escape.txt", "run-8/a/../../escape.txt"]) {
      const r2 = fakeRepo();
      const s = `Volume.FILES = {${JSON.stringify(evil)}: b"pwn", "run-8/ok.txt": b"ok"}\n`;
      const e = app(r2, {}, s + `try:\n    ga.fetch(run_id="run-8"); out = "no-error"\nexcept (ValueError, SystemExit) as ex:\n    out = "rejected"`);
      expect(e.out).toBe("rejected");
      expect(existsSync(join(r2, "services", "bot", "fixtures", "glimmer-run", "escape.txt"))).toBe(false);
      expect(existsSync(join(r2, "services", "bot", "fixtures", "escape.txt"))).toBe(false);
    }
  });

  it("C5-8: downloaded dummy evidence tree passes C4 replay and matches the original report", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "c5-src-"));
    const text = "Call Ana at 555-0100";
    const content = JSON.stringify({ spans: [{ start: 5, end: 8, label: "PERSON_NAME" }], boxes: [] });
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }),
    })) as unknown as typeof fetch;
    const orig = await runEval({
      cases: [{ file: "a.txt", entities: ["Ana"] }, { file: "b.txt", entities: ["Ana"] }],
      readText: async () => text,
      makeRedactor: () => new GlimmerClient("http://127.0.0.1:9", { fetchImpl }),
      concurrency: 1,
      runId: "run-c5",
      outDir,
    });
    const files: Record<string, string> = {};
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else files[`run-c5/${relative(orig.runDir, p).split("\\").join("/")}`] = readFileSync(p, "base64");
      }
    };
    walk(orig.runDir);
    const r = fakeRepo();
    const setup = `import base64\nVolume.FILES = {k: base64.b64decode(v) for k, v in json.loads(${JSON.stringify(JSON.stringify(files))}).items()}\n`;
    app(r, {}, setup + `ga.fetch(run_id="run-c5")\nout = 1`);
    const dl = join(r, "services", "bot", "fixtures", "glimmer-run", "run-c5");
    const re = await rescoreRun(dl);
    expect(re.status).toBe("complete_match");
    expect(re.output).toEqual(orig.output);
    expect(re.report).toBe(orig.report);
  });

  it("C5-9: model load/readiness consume the work deadline", () => {
    const r = fakeRepo();
    const res = app(r, {}, `
T = [100.0]
def now(): return T[0]
def sleep(s): T[0] += s
def probe(): return 200 if T[0] >= 100.0 + 200 else None
out = lc.wait_ready(now, sleep, probe, 100.0)
`);
    expect(res.out.ready).toBe(true);
    expect(res.out.remaining_s).toBe(780 - 200 - 5);
    expect(res.out.remaining_ms).toBe((780 - 200) * 1000 - 30000);
  });

  it("C5-10: deadline passing during input preparation means zero requests, no canary, all not_run", async () => {
    let clock = 5_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    let calls = 0;
    const r = await runEval({
      cases: ["a", "b", "c"].map((f) => ({ file: `${f}.txt`, entities: [] })),
      readText: async () => {
        clock += 2000; // preparing inputs blows the 1 s budget
        return "nothing here";
      },
      makeRedactor: () => ({
        redactText: async (t: string) => {
          calls += 1;
          return { maskedText: t, spans: [] };
        },
      }),
      concurrency: 1,
      deadlineMs: 1000,
      runId: "c5-10",
    });
    expect(calls).toBe(0);
    expect(r.records.map((x: { status: string }) => x.status)).toEqual(["not_run", "not_run", "not_run"]);
    expect(r.complete).toBe(false);
  });

  it("C5-11: a SIGTERM'd writer process leaves readable, incomplete evidence (local only, not Modal hard-kill)", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "c5-kill-"));
    const runner = join(botDir, "scripts", "redaction-eval-runner.mjs");
    const child = `
import { runEval } from ${JSON.stringify(runner)};
let n = 0;
await runEval({
  cases: [{ file: "a.txt", entities: [] }, { file: "b.txt", entities: [] }],
  readText: async () => "plain text",
  makeRedactor: () => ({ redactText: async (t) => {
    n += 1;
    if (n > 1) { process.stdout.write("PARKED\\n"); return new Promise(() => {}); }
    return { maskedText: t, spans: [] };
  } }),
  concurrency: 1, runId: "c5-11", outDir: ${JSON.stringify(outDir)},
});
`;
    const p = spawn(process.execPath, ["--input-type=module", "-e", child], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await new Promise<void>((resolve, reject) => {
        p.stdout.on("data", (b: Buffer) => { if (b.toString().includes("PARKED")) resolve(); });
        p.on("exit", (c) => reject(new Error(`child exited early ${c}`)));
      });
      const exited = new Promise<NodeJS.Signals | null>((resolve) => p.on("exit", (_c, s) => resolve(s)));
      p.kill("SIGTERM");
      expect(await exited).toBe("SIGTERM");
    } finally {
      if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
    }
    const runDir = join(outDir, "c5-11");
    const lines = readFileSync(join(runDir, "records.jsonl"), "utf8").split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).file).toBe("a.txt");
    const re = await rescoreRun(runDir);
    expect(re.status).not.toBe("complete_match");
    expect(re.output.complete).toBe(false);
  });

  it("C5-12: the documented launch and fetch commands run through the same wiring", () => {
    const doc = readFileSync(RUNBOOK, "utf8");
    const cmds = [...doc.matchAll(/`([^`]*python3 -m modal run[^`]*)`/g)].map((m) => m[1]!);
    const launch = cmds.find((c) => !c.includes("::"));
    const fetchCmd = cmds.find((c) => c.includes("::fetch"));
    expect(launch).toBeDefined();
    expect(fetchCmd).toBeDefined();
    const r = fakeRepo();
    const { path } = goodConfig(r);
    const subst = (s: string) => s.replace(/<dataset>/g, "dummyx").replace(/<config>/g, path).replace(/<run_id>/g, "run-12");
    const parse = (cmd: string) => {
      const toks = subst(cmd).split(/\s+/).filter(Boolean);
      const env: Record<string, string> = {};
      while (toks[0] && /^[A-Z_][A-Z0-9_]*=/.test(toks[0])) {
        const [k, ...v] = toks.shift()!.split("=");
        env[k!] = v.join("=");
      }
      expect(toks.slice(0, 4)).toEqual(["python3", "-m", "modal", "run"]);
      const rest = toks.slice(4).filter((t) => t !== "--detach");
      const [target, ...flags] = rest;
      const [file, fn] = target!.split("::");
      expect(file).toBe("infra/modal/glimmer_app.py");
      const kwargs: Record<string, string> = {};
      for (let i = 0; i < flags.length; i += 2) kwargs[flags[i]!.replace(/^--/, "").replace(/-/g, "_")] = flags[i + 1]!;
      return { env, fn: fn ?? "main", kwargs };
    };
    const L = parse(launch!);
    const res = app(r, L.env, `out = None\ntry:\n    ga.${L.fn}(**json.loads(${JSON.stringify(JSON.stringify(L.kwargs))}))\nexcept SystemExit as e:\n    out = e.code`);
    expect(res.out).toBe(null);
    expect(res.rec.spawn).toEqual([[[ "dummyx", shaFile(path) ], {}]]);
    for (const ref of res.rec.registry) expect(ref).toBe(DIGEST);
    const F = parse(fetchCmd!);
    const fr = app(r, F.env, `Volume.FILES = {"run-12/manifest.json": b"{}"}\nga.${F.fn}(**json.loads(${JSON.stringify(JSON.stringify(F.kwargs))}))\nout = 1`);
    expect(fr.out).toBe(1);
    expect(readFileSync(join(r, "services", "bot", "fixtures", "glimmer-run", "run-12", "manifest.json"), "utf8")).toBe("{}");
  });
});
