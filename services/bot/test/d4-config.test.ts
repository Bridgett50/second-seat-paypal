// D4 regressions: config-bytes binding (F2) and run-config mapping (F7).
// The real infra/modal/glimmer_app.py is exercised against an inert
// SDK-shaped `modal` stub (injected via sys.modules, never the real SDK).
// Dummy datasets in tmp repos only; no Modal, no network, no models, no
// sealed paths. TS run-config checks use dummy values only.
// @ts-expect-error untyped helper module
import { runEval, concurrencyFromRunConfig } from "../scripts/redaction-eval-runner.mjs";
import { MuseClient } from "../src/brief/muse.js";
import { GatedText, createPrivacyGate } from "../src/private/gate.js";
import {
  sparkProofClientOptions,
  toLaunchConfig,
  toRunnerSettings,
  validateRunConfig,
} from "../src/release/runConfig.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const botDir = join(here, "..");
const DIGEST = `registry.example/vllm-openai@sha256:${"b".repeat(64)}`;
const REV = "c".repeat(40);
// Nondefault dummy identities for the mapping test.
const DIGEST_D4 = `registry.example/vllm-openai@sha256:${"e".repeat(64)}`;
const REV_D4 = "f".repeat(40);

let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = {
    GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"],
    GLIMMER_TIMEOUT_MS: process.env["GLIMMER_TIMEOUT_MS"],
    META_API_KEY: process.env["META_API_KEY"],
    MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"],
    MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"],
  };
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  process.env["META_API_KEY"] = "test-key-not-a-secret";
  const d = mkdtempSync(join(tmpdir(), "d4-"));
  process.env["MUSE_STATE_FILE"] = join(d, "state.json");
  process.env["MUSE_COST_LOG_FILE"] = join(d, "cost.jsonl");
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

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

// A throwaway repo that IS a real git checkout: real infra/modal sources
// copied in, dummy bot tree, everything committed so launch (bound to the
// git commit) can succeed from a clean tree.
function fakeRepo(): string {
  const r = mkdtempSync(join(tmpdir(), "d4-repo-"));
  mkdirSync(join(r, "infra", "modal"), { recursive: true });
  for (const f of ["glimmer_app.py", "launch_contract.py"]) copyFileSync(join(botDir, "..", "..", "infra", "modal", f), join(r, "infra", "modal", f));
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
// repo, then run body; body assigns `out`. The launch record (if any) is
// reported alongside the spawn records.
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
    "print('D4OUT ' + json.dumps({'out': out, 'rec': REC, 'record': ga._LAST_LAUNCH_RECORD}))",
  ].join("\n");
  const res = spawnSync("python3", ["-c", prog], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
  });
  const line = res.stdout.split("\n").find((l) => l.startsWith("D4OUT "));
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

function shaFile(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function launcherSha(r: string): string {
  return createHash("sha256")
    .update(Buffer.concat([
      readFileSync(join(r, "infra", "modal", "glimmer_app.py")),
      readFileSync(join(r, "infra", "modal", "launch_contract.py")),
    ]))
    .digest("hex");
}

// Valid dummy TS run config with nondefault identities and settings. ds/src
// are the measured fake-repo hashes so the mapped launch config passes the
// Python contract too.
function d4RunConfig(ds: string, src: string) {
  return {
    configVersion: 1,
    sourceSha: "a".repeat(40),
    sourceSha256: src,
    dataset: { id: "dummyx", sha256: ds },
    model: { name: "meta-models/Muse-Glimmer-30B", revision: REV_D4 },
    image: { ref: DIGEST_D4, digest: `sha256:${"e".repeat(64)}` },
    prompt: { sha256: "c".repeat(64) },
    schema: { sha256: "d".repeat(64) },
    scorer: { sha256: "f".repeat(64) },
    decoding: { temperature: 0.7, seed: 7, reasoning: "high" },
    tokenLimits: { maxTokens: 512 },
    timeouts: { requestMs: 60000, workDeadlineS: 700, functionTimeoutS: 840 },
    retry: { maxAttempts: 1 },
    modal: { allocations: 1, concurrency: 3, maxConcurrency: 8, scoredCanary: true, teardown: true, evidenceDownload: "complete" },
    review: { status: "reviewed", reviewer: "D4 Reviewer", reviewed_at: "2026-10-27", dataset_sha256: ds },
    glimmerDemoRequests: 0,
    budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 },
  };
}

function stubRedactor() {
  return {
    label: "stub",
    redactText: async (t: string) => ({ maskedText: t, spans: [] }),
    redactImage: async () => {
      throw new Error("no images");
    },
    health: async () => ({ ok: true, label: "stub" }),
  };
}

async function mintLive(text: string): Promise<GatedText> {
  const gate = createPrivacyGate({ mode: "live", redactor: stubRedactor() });
  const prepared = await gate.prepare(text);
  const token = gate.approve(prepared.runId, prepared.redactedText);
  return gate.send(prepared.runId, token, async (gated) => gated);
}

describe("D4 config-bytes binding and run-config mapping", () => {
  it("D4-1: same-path replace after import => zero spawns", () => {
    const r = fakeRepo();
    const { path } = goodConfig(r);
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path };
    const ok = app(r, env, MAIN("dummyx", path));
    expect(ok.out).toBe(null);
    expect(ok.rec.spawn).toEqual([[[ "dummyx", shaFile(path) ], {}]]);
    expect(ok.record.config_sha256).toBe(shaFile(path));
    expect(ok.record.launcher_sha256).toBe(launcherSha(r));
    // Same path, same parsed config, different bytes (trailing newline):
    // path equality holds but the drift gate must still refuse.
    const drifted = app(r, env, `
with open(${JSON.stringify(path)}, "a", encoding="utf-8") as _fh:
    _fh.write("\\n")
try:
    ga.main(dataset="dummyx", config=${JSON.stringify(path)}); out = None
except SystemExit as e:
    out = e.code
`);
    expect(drifted.out).toBe(2);
    expect(drifted.rec.spawn).toEqual([]);
    expect(drifted.record).toBe(null);
  });

  it("D4-2: all-zero identities and blank review rejected (TS and Python)", () => {
    const r = fakeRepo();
    const hashes = app(r, {}, [
      `ds = ${JSON.stringify(join(r, "services", "bot", "fixtures", "dummyx"))}`,
      `out = {"ds": lc.dataset_sha256(ds), "src": lc.packaged_source_sha256(${JSON.stringify(r)}, "dummyx")}`,
    ].join("\n"));
    const ds = hashes.out.ds as string;
    const src = hashes.out.src as string;
    const cfg = d4RunConfig(ds, src);
    expect(validateRunConfig(cfg)).toEqual([]);
    const mut = (f: (c: ReturnType<typeof d4RunConfig>) => void): string => {
      const c = d4RunConfig(ds, src);
      f(c);
      return validateRunConfig(c).join("\n");
    };
    expect(mut((c) => { c.sourceSha = "0".repeat(40); })).toMatch(/sourceSha/);
    expect(mut((c) => { c.model.revision = "0".repeat(40); })).toMatch(/revision/);
    expect(mut((c) => {
      c.image.ref = `registry.example/vllm-openai@sha256:${"0".repeat(64)}`;
      c.image.digest = `sha256:${"0".repeat(64)}`;
    })).toMatch(/image/);
    expect(mut((c) => { c.review.reviewer = "   "; })).toMatch(/reviewer/);
    expect(mut((c) => { c.review.reviewed_at = "not-a-date"; })).toMatch(/reviewed_at/);
    expect(mut((c) => { c.review.reviewed_at = " "; })).toMatch(/reviewed_at/);
    // The same rejections hold on the Python side through the explicit
    // TS -> launch-config mapping.
    const fx = join(r, "services", "bot", "fixtures");
    const check = (c: unknown): string[] =>
      app(r, {}, `out = lc.check_launch(json.loads(${JSON.stringify(JSON.stringify(c))}), ${JSON.stringify(fx)}, invoked_dataset="dummyx")`).out as string[];
    expect(check(toLaunchConfig(cfg))).toEqual([]);
    const zeroed = d4RunConfig(ds, src);
    zeroed.sourceSha = "0".repeat(40);
    expect(check(toLaunchConfig(zeroed)).length).toBeGreaterThan(0);
    const blanked = d4RunConfig(ds, src);
    blanked.review.reviewer = "  ";
    expect(check(toLaunchConfig(blanked)).length).toBeGreaterThan(0);
    const undated = d4RunConfig(ds, src);
    undated.review.reviewed_at = "2026-13-45";
    expect(check(toLaunchConfig(undated)).length).toBeGreaterThan(0);
  });

  it("D4-3: launcher drift rejected", () => {
    const r = fakeRepo();
    const { path } = goodConfig(r);
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path };
    const ok = app(r, env, MAIN("dummyx", path));
    expect(ok.out).toBe(null);
    expect(ok.rec.spawn).toEqual([[[ "dummyx", shaFile(path) ], {}]]);
    // Config bytes untouched; only the launcher source drifts after import.
    const drifted = app(r, env, `
with open(${JSON.stringify(join(r, "infra", "modal", "launch_contract.py"))}, "a", encoding="utf-8") as _fh:
    _fh.write("\\n# d4 drift\\n")
try:
    ga.main(dataset="dummyx", config=${JSON.stringify(path)}); out = None
except SystemExit as e:
    out = e.code
`);
    expect(drifted.out).toBe(2);
    expect(drifted.rec.spawn).toEqual([]);
    expect(drifted.record).toBe(null);
  });

  it("D4-4: nondefault dummy settings flow into image, vLLM argv, runner, tokens, retry", async () => {
    const r = fakeRepo();
    const hashes = app(r, {}, [
      `ds = ${JSON.stringify(join(r, "services", "bot", "fixtures", "dummyx"))}`,
      `out = {"ds": lc.dataset_sha256(ds), "src": lc.packaged_source_sha256(${JSON.stringify(r)}, "dummyx")}`,
    ].join("\n"));
    const cfg = d4RunConfig(hashes.out.ds as string, hashes.out.src as string);
    cfg.sourceSha = headSha(r); // launch is bound to the git commit
    expect(validateRunConfig(cfg)).toEqual([]);

    // TS -> flat Python launch config carries the nondefault identities.
    const mapped = toLaunchConfig(cfg);
    expect(mapped.image).toBe(DIGEST_D4);
    expect(mapped.model_revision).toBe(REV_D4);
    expect(mapped.dataset).toBe("dummyx");
    const cfgPath = join(r, "launch-d4.json");
    writeFileSync(cfgPath, JSON.stringify(cfg));

    // Image construction uses the exact configured immutable digest.
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: cfgPath };
    const imp = app(r, env, "out = 1");
    expect(imp.rec.registry.length).toBeGreaterThan(0);
    for (const ref of imp.rec.registry) expect(ref).toBe(DIGEST_D4);

    // vLLM argv uses the exact configured model revision.
    const vllm = app(r, env, CAPTURE_VLLM);
    const cmds: string[][] = vllm.out;
    expect(cmds).toHaveLength(2); // serve + eval_in_container
    for (const c of cmds) {
      const i = c.indexOf("--revision");
      expect(i).toBeGreaterThan(-1);
      expect(c[i + 1]).toBe(REV_D4);
    }

    // The mapped launch config passes the Python contract and launches,
    // recording the consumed config sha and launcher identity.
    const launched = app(r, env, MAIN("dummyx", cfgPath));
    expect(launched.out).toBe(null);
    expect(launched.rec.spawn).toEqual([[[ "dummyx", shaFile(cfgPath) ], {}]]);
    expect(launched.record.config_sha256).toBe(shaFile(cfgPath));
    expect(launched.record.launcher_sha256).toBe(launcherSha(r));

    // TS -> runner/request settings carry concurrency, deadlines, token
    // settings, and the retry budget.
    const settings = toRunnerSettings(cfg);
    expect(settings).toEqual({
      concurrency: 3,
      deadlineMs: 700000,
      requestMs: 60000,
      maxTokens: 512,
      contextTokens: 16384,
      decoding: { temperature: 0.7, seed: 7, reasoning: "high" },
      maxAttempts: 1,
    });
    expect(concurrencyFromRunConfig(cfg)).toBe(3);
    expect(concurrencyFromRunConfig({})).toBe(2);
    expect(concurrencyFromRunConfig({ modal: { concurrency: 0 } })).toBe(2);
    expect(concurrencyFromRunConfig({ modal: { concurrency: 2.5 } })).toBe(2);

    // The runner honors the mapped concurrency: with three rest cases and
    // three workers, all three rest redactors are in flight at once. The
    // barrier loop is capped so a hardcoded smaller concurrency would fail
    // the overlap assertion instead of hanging.
    const outDir = mkdtempSync(join(tmpdir(), "d4-runner-"));
    let calls = 0;
    let restStarted = 0;
    let active = 0;
    let maxActive = 0;
    const res = await runEval({
      cases: ["a", "b", "c", "d"].map((f) => ({ file: `${f}.txt`, entities: [] })),
      readText: async () => "plain text with nothing",
      makeRedactor: () => ({
        redactText: async (t: string) => {
          calls += 1;
          if (calls === 1) return { maskedText: t, spans: [] }; // canary
          restStarted += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            for (let i = 0; i < 1000 && restStarted < 3; i++) {
              await new Promise((r2) => setTimeout(r2, 10));
            }
            return { maskedText: t, spans: [] };
          } finally {
            active -= 1;
          }
        },
      }),
      concurrency: settings.concurrency,
      deadlineMs: settings.deadlineMs,
      runId: "d4-4",
      outDir,
    });
    expect(res.complete).toBe(true);
    expect(maxActive).toBe(3);

    // Retry budget is captured for the proof client.
    expect(sparkProofClientOptions(cfg)).toEqual({ maxAttempts: 1 });

    // redaction-eval.mjs --run-config: a missing file fails fast with a
    // clear error before fixtures or any redactor load.
    const script = join(botDir, "scripts", "redaction-eval.mjs");
    const missing = join(tmpdir(), `d4-missing-${Math.random().toString(36).slice(2)}.json`);
    const bad = spawnSync(process.execPath, [script, "--cases", "dummyx", "--run-config", missing], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "" },
    });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/--run-config/);
    expect(bad.stdout).not.toMatch(/redactor:/);
    const corrupt = join(tmpdir(), `d4-corrupt-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(corrupt, "{oops");
    const badJson = spawnSync(process.execPath, [script, "--cases", "dummyx", "--run-config", corrupt], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "" },
    });
    expect(badJson.status).toBe(2);
    expect(badJson.stderr).toMatch(/--run-config/);
    expect(badJson.stdout).not.toMatch(/redactor:/);
  });

  it("D4-5: alias path same bytes accepted / changed bytes rejected", () => {
    const r = fakeRepo();
    const { path } = goodConfig(r);
    const alias = join(r, "alias-config.json");
    symlinkSync(path, alias);
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path };
    // Alias path, identical bytes: accepted deliberately.
    const ok = app(r, env, MAIN("dummyx", alias));
    expect(ok.out).toBe(null);
    expect(ok.rec.spawn).toEqual([[[ "dummyx", shaFile(path) ], {}]]);
    expect(ok.record.config_sha256).toBe(shaFile(path));
    // Alias replaced by a same-shaped file with different bytes: refused.
    unlinkSync(alias);
    const altered = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(alias, JSON.stringify(altered, null, 2));
    const blocked = app(r, env, MAIN("dummyx", alias));
    expect(blocked.out).toBe(2);
    expect(blocked.rec.spawn).toEqual([]);
    expect(blocked.record).toBe(null);
  });

  it("D4-6: proof request with retryable fake failure => exactly one fake HTTP attempt", async () => {
    const cfg = d4RunConfig("a".repeat(64), "b".repeat(64));
    expect(validateRunConfig(cfg)).toEqual([]);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("overloaded", { status: 503, headers: { "retry-after": "0" } });
    }) as typeof fetch;
    const client = new MuseClient({
      fetchImpl,
      labelTranscriptSegments: true,
      ...sparkProofClientOptions(cfg),
    });
    const gated = await mintLive("approved meeting notes about the renewal");
    await expect(
      client.completeBrief({ meetingId: "m", transcriptText: gated, framesSidecarText: "", fixtureMode: false }),
    ).rejects.toThrow(/failed after retries/);
    expect(calls).toBe(1);
  });
});
