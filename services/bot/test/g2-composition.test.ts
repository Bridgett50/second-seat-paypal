// G2a composition: the canonical NESTED RunConfig (runConfig.ts shape) is the
// ONLY frozen input file; the flat launch dict is an explicit, bound
// PROJECTION computed from it. The real infra/modal/glimmer_app.py is
// exercised against an inert SDK-shaped `modal` stub (injected via
// sys.modules, never the real SDK). Dummy datasets in tmp repos only; no
// Modal/GPU, no live inference, no network except a fake HTTP server on
// 127.0.0.1 started inside the test. All configs and datasets are invented
// dummies. No sealed paths.
import { toLaunchConfig, validateRunConfig } from "../src/release/runConfig.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const botDir = join(here, "..");
const DIGEST_G2 = `registry.invalid/dummy@sha256:${"7".repeat(64)}`;
const REV_G2 = "9f".repeat(20);
const G2_TEXT = "Call Ana at 555-0100";

// Frozen runtime prompt/schema/scorer identities for dummy configs that run
// the CLI with --run-config (placeholder shas would now refuse).
// @ts-expect-error untyped helper module
const { runtimeIdentities: g2RuntimeIdentities } = await import("../scripts/frozen-identities.mjs");
const G2_IDS = (await g2RuntimeIdentities()) as { prompt: string; schema: string; scorer: string };

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
  const r = mkdtempSync(join(tmpdir(), "g2-repo-"));
  mkdirSync(join(r, "infra", "modal"), { recursive: true });
  for (const f of ["glimmer_app.py", "launch_contract.py"]) copyFileSync(join(botDir, "..", "..", "infra", "modal", f), join(r, "infra", "modal", f));
  const bot = join(r, "services", "bot");
  mkdirSync(join(bot, "dist"), { recursive: true });
  mkdirSync(join(bot, "scripts"), { recursive: true });
  writeFileSync(join(bot, "dist", "x.js"), "export const x = 1;\n");
  writeFileSync(join(bot, "scripts", "redaction-eval.mjs"), "// dummy\n");
  writeFileSync(join(bot, "package.json"), "{}\n");
  for (const [name, text] of [["dummyx", G2_TEXT], ["devy", "Mail Bo at 555-0199"]] as const) {
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
// repo, then run body; body assigns `out`. BLOCKED lines printed by main()
// are captured alongside the launch record and spawn records.
function app(r: string, env: Record<string, string>, body: string): any {
  const prog = [
    STUB,
    "import importlib.util, os",
    `spec = importlib.util.spec_from_file_location("glimmer_app", ${JSON.stringify(join(r, "infra", "modal", "glimmer_app.py"))})`,
    "ga = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(ga)",
    "lc = ga.launch_contract",
    "import builtins",
    "_seen = []",
    "_orig_print = builtins.print",
    "def _cap(*a, **k):",
    "    _seen.append(' '.join(str(x) for x in a))",
    "    return _orig_print(*a, **k)",
    "builtins.print = _cap",
    "out = None",
    body,
    "print('G2OUT ' + json.dumps({'out': out, 'rec': REC, 'record': ga._LAST_LAUNCH_RECORD, 'blocked': [l for l in _seen if l.startswith('BLOCKED:')]}))",
  ].join("\n");
  const res = spawnSync("python3", ["-c", prog], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
  });
  const line = res.stdout.split("\n").find((l) => l.startsWith("G2OUT "));
  if (!line) throw new Error(`python failed (${res.status}): ${res.stderr.slice(-3000)}`);
  const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
  parsed["stdout"] = res.stdout;
  parsed["stderr"] = res.stderr;
  return parsed;
}

function writeCfg(r: string, cfg: unknown): string {
  const p = join(r, `g2cfg-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(cfg));
  return p;
}

// Complete nested canonical dummy config, valid under the real
// validateRunConfig, with configVersion 1. ds/src are the measured fake-repo
// hashes so the projected launch config passes the Python contract too.
function canonicalConfig(r: string): { cfg: Record<string, unknown>; path: string; ds: string; src: string } {
  const res = app(r, {}, [
    `ds = ${JSON.stringify(join(r, "services", "bot", "fixtures", "dummyx"))}`,
    `out = {"ds": lc.dataset_sha256(ds), "src": lc.packaged_source_sha256(${JSON.stringify(r)}, "dummyx")}`,
  ].join("\n"));
  const ds = res.out.ds as string;
  const src = res.out.src as string;
  const cfg: Record<string, unknown> = {
    configVersion: 1,
    sourceSha: headSha(r),
    sourceSha256: src,
    dataset: { id: "dummyx", sha256: ds },
    model: { name: "meta-models/Muse-Glimmer-30B", revision: REV_G2 },
    image: { ref: DIGEST_G2, digest: `sha256:${"7".repeat(64)}` },
    prompt: { sha256: G2_IDS.prompt },
    schema: { sha256: G2_IDS.schema },
    scorer: { sha256: G2_IDS.scorer },
    decoding: { temperature: 0, seed: 1, reasoning: "low" },
    tokenLimits: { maxTokens: 256 },
    timeouts: { requestMs: 10000, workDeadlineS: 120, functionTimeoutS: 180 },
    retry: { maxAttempts: 1 },
    modal: { allocations: 1, concurrency: 1, maxConcurrency: 2, scoredCanary: true, teardown: true, evidenceDownload: "complete" },
    review: { status: "reviewed", reviewer: "G2 Reviewer", reviewed_at: "2026-10-27", dataset_sha256: ds },
    glimmerDemoRequests: 0,
    budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 },
  };
  const errors = validateRunConfig(cfg);
  expect(errors, `positive control: canonical dummy config must validate, got: ${errors.join("; ")}`).toEqual([]);
  return { cfg, path: writeCfg(r, cfg), ds, src };
}

// Call main() and report SystemExit code (or null) plus spawn records.
const MAIN = (ds: string, cfg: string) => `
try:
    ga.main(dataset=${JSON.stringify(ds)}, config=${JSON.stringify(cfg)}); out = None
except SystemExit as e:
    out = e.code
`;

function shaFile(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

describe("G2a canonical config composition", () => {
  it("G2-1", { timeout: 120000 }, async () => {
    const r = fakeRepo();
    const { cfg, path } = canonicalConfig(r);
    const sha = shaFile(path);
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path };
    const ok = app(r, env, MAIN("dummyx", path));
    expect(ok.record, `flat-nested-mismatch: main blocked a canonical nested config (code=${ok.out} blockers=${(ok.blocked as string[]).join(" | ")} stdout=${(ok.stdout as string).slice(-2000)})`).not.toBe(null);
    expect(ok.out, `flat-nested-mismatch: main exited ${ok.out}, blockers=${(ok.blocked as string[]).join(" | ")}`).toBe(null);
    expect((ok.blocked as string[]), `flat-nested-mismatch: unexpected blockers ${(ok.blocked as string[]).join(" | ")}`).toEqual([]);
    expect((ok.rec.spawn as unknown[]).length, `flat-nested-mismatch: expected exactly one spawn, got ${JSON.stringify(ok.rec.spawn)}`).toBe(1);
    for (const ref of ok.rec.registry as string[]) {
      expect(ref, `flat-nested-mismatch: image registry ${ref} != canonical image.ref ${(cfg["image"] as { ref: string }).ref}`).toBe((cfg["image"] as { ref: string }).ref);
    }
    expect((ok.rec.registry as string[]).length, "flat-nested-mismatch: no image construction recorded").toBeGreaterThan(0);
    expect((ok.rec.spawn as unknown[])[0], `flat-nested-mismatch: spawn args must be [dataset, config_sha256], got ${JSON.stringify(ok.rec.spawn)}`).toEqual([["dummyx", sha], {}]);
    expect(ok.record.config_sha256, `flat-nested-mismatch: record.config_sha256 ${ok.record.config_sha256} != sha256(config bytes) ${sha}`).toBe(sha);

    // Build the exact child argv with the REAL launch-contract builder, run
    // through app() python so it is the real builder, not a reimplementation.
    const harness = app(r, {}, [
      "import tempfile, hashlib",
      `_cfgBytes = open(${JSON.stringify(path)}, "rb").read()`,
      "_cfg = json.loads(_cfgBytes.decode('utf-8'))",
      "_fn = getattr(lc, 'project_launch', None)",
      "out = None",
      "if _fn is not None:",
      "    _flat, _errs = _fn(_cfg)",
      "    if not _errs:",
      "        _tmpout = tempfile.mkdtemp()",
      "        _stageDir = tempfile.mkdtemp()",
      "        _stage = os.path.join(_stageDir, 'run-config.json')",
      "        open(_stage, 'wb').write(_cfgBytes)",
      "        _sha = hashlib.sha256(_cfgBytes).hexdigest()",
      "        _argv = None",
      "        try:",
      "            _argv = lc.eval_command(_flat['dataset'], _tmpout, 'g2-run', _stage, _sha)",
      "        except TypeError as _e:",
      "            _argv = None",
      "        out = {'flat': _flat, 'errs': _errs, 'argv': _argv, 'tmpout': _tmpout, 'stage': _stage, 'sha': _sha}",
      "    else:",
      "        out = {'flat': _flat, 'errs': _errs, 'argv': None}",
    ].join("\n"));
    expect(harness.out, "flat-nested-mismatch: real project_launch/eval_command builder unavailable (parent has no projection)").not.toBe(null);
    expect(harness.out.errs, `flat-nested-mismatch: projection errors ${(harness.out.errs as string[] ?? []).join(" | ")}`).toEqual([]);
    const argv = harness.out.argv as string[] | null;
    expect(argv, "flat-nested-mismatch: real eval_command gave no argv (parent returns a bare legacy command without --run-config-sha256)").not.toBe(null);

    // Execute the argv with node from a temp bot tree: the REAL
    // redaction-eval scripts, symlinked real dist + node_modules, and a
    // dummyx fixture with one invented dummy case.
    const tree = mkdtempSync(join(tmpdir(), "g2-tree-"));
    mkdirSync(join(tree, "scripts"), { recursive: true });
    for (const f of ["redaction-eval.mjs", "redaction-eval-runner.mjs", "redaction-eval-lib.mjs", "frozen-identities.mjs"]) {
      copyFileSync(join(botDir, "scripts", f), join(tree, "scripts", f));
    }
    symlinkSync(join(botDir, "dist"), join(tree, "dist"));
    symlinkSync(join(botDir, "node_modules"), join(tree, "node_modules"));
    mkdirSync(join(tree, "fixtures", "dummyx"), { recursive: true });
    writeFileSync(join(tree, "fixtures", "dummyx", "dummyx-01.txt"), G2_TEXT);
    writeFileSync(join(tree, "fixtures", "dummyx", "cases.json"), JSON.stringify([{ file: "dummyx-01.txt", entities: ["Ana"] }]));
    const fake = startFakeEndpoint();
    try {
      const resultPath = join(mkdtempSync(join(tmpdir(), "g2-res-")), "result.json");
      const withShim = ["--import", fake.shimPath, ...(argv as string[]).slice(1)];
      const child = spawnSync(process.execPath, withShim, {
        cwd: tree,
        encoding: "utf8",
        timeout: 90000,
        env: {
          PATH: process.env["PATH"] ?? "",
          GLIMMER_BASE_URL: fake.url,
          GLIMMER_RESULT_JSON: resultPath,
          G2_FAKE_COUNT: join(dirname(fake.shimPath), "requests.log"),
        },
      });
      expect(child.status, `flat-nested-mismatch: child eval exited ${child.status} (parent exits 2: staged flat bytes fail nested validateRunConfig) stderr=${child.stderr.slice(-2000)}`).toBe(0);
      const runDir = join((harness.out.tmpout as string), "g2-run");
      const records = readFileSync(join(runDir, "records.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
      expect(records.length, `flat-nested-mismatch: expected one completed case, got ${records.length}`).toBe(1);
      expect(records[0].status, `flat-nested-mismatch: case did not complete: ${JSON.stringify(records[0]).slice(0, 500)}`).toBe("ok");
      const summary = JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8")) as { complete?: boolean };
      expect(summary.complete, `flat-nested-mismatch: run not complete: ${JSON.stringify(summary).slice(0, 500)}`).toBe(true);
      expect(fake.requests(), "flat-nested-mismatch: fake inference server got zero requests").toBeGreaterThan(0);
      const identity = JSON.parse(readFileSync(join(runDir, "run-config-identity.json"), "utf8")) as { configSha256?: string; datasetId?: string };
      expect(identity.configSha256, `flat-nested-mismatch: identity configSha256 ${identity.configSha256} != staged config sha ${harness.out.sha}`).toBe(harness.out.sha);
      expect(identity.datasetId, `flat-nested-mismatch: identity datasetId ${identity.datasetId} != dummyx`).toBe("dummyx");
      const resultJson = JSON.parse(readFileSync(resultPath, "utf8")) as { runConfigSha256?: string };
      expect(resultJson.runConfigSha256, `flat-nested-mismatch: GLIMMER_RESULT_JSON missing runConfigSha256 ${harness.out.sha}`).toBe(harness.out.sha);
    } finally {
      fake.close();
    }
  });

  it("G2-2", { timeout: 120000 }, async () => {
    const r = fakeRepo();
    const { cfg } = canonicalConfig(r);

    // The Python projection must equal the TS projection exactly.
    const eq = app(r, {}, [
      `_cfg = json.loads(${JSON.stringify(JSON.stringify(cfg))})`,
      "_fn = getattr(lc, 'project_launch', None)",
      "out = None",
      "if _fn is not None:",
      "    _flat, _errs = _fn(_cfg)",
      "    out = {'flat': _flat, 'errs': _errs}",
    ].join("\n"));
    expect(eq.out, "no-projection-binding: lc.project_launch is missing (parent has no projection)").not.toBe(null);
    expect(eq.out.errs, `no-projection-binding: projection of the canonical config failed: ${(eq.out.errs as string[]).join(" | ")}`).toEqual([]);
    expect(eq.out.flat, "no-projection-binding: lc.project_launch(cfg) != TS toLaunchConfig(cfg)").toEqual(toLaunchConfig(cfg as never));

    // Legacy flat and hybrid dicts are refused explicitly.
    const flatCfg = {
      dataset: "dummyx",
      dataset_sha256: (cfg["dataset"] as { sha256: string }).sha256,
      source_sha: cfg["sourceSha"],
      source_sha256: cfg["sourceSha256"],
      image: (cfg["image"] as { ref: string }).ref,
      model: (cfg["model"] as { name: string }).name,
      model_revision: (cfg["model"] as { revision: string }).revision,
      review: cfg["review"],
    };
    const hybridCfg = { ...(cfg as Record<string, unknown>), model_revision: REV_G2, dataset_sha256: (cfg["dataset"] as { sha256: string }).sha256 };
    for (const [name, bad] of [["flat", flatCfg], ["hybrid", hybridCfg]] as const) {
      const refused = app(r, {}, [
        `_cfg = json.loads(${JSON.stringify(JSON.stringify(bad))})`,
        "_fn = getattr(lc, 'project_launch', None)",
        "out = None",
        "if _fn is not None:",
        "    _flat, _errs = _fn(_cfg)",
        "    out = {'flat': _flat, 'errs': _errs}",
      ].join("\n"));
      expect(refused.out, `no-projection-binding: project_launch missing for ${name} dict`).not.toBe(null);
      expect(
        (refused.out.errs as string[]).some((e) => e.includes("projection: legacy flat launch config refused")),
        `no-projection-binding: ${name} dict not refused as legacy, errs=${JSON.stringify(refused.out.errs)}`,
      ).toBe(true);
    }

    // Changed dataset.id blocks before spawn (dataset binding).
    const dsCfg = JSON.parse(JSON.stringify(cfg)) as Record<string, any>;
    dsCfg["dataset"]["id"] = "othery";
    const dsPath = writeCfg(r, dsCfg);
    const dsBlocked = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: dsPath }, MAIN("dummyx", dsPath));
    expect(dsBlocked.out, `no-projection-binding: changed dataset.id launched (spawn=${JSON.stringify(dsBlocked.rec.spawn)})`).toBe(2);
    expect((dsBlocked.rec.spawn as unknown[]), `no-projection-binding: changed dataset.id spawned ${JSON.stringify(dsBlocked.rec.spawn)}`).toEqual([]);
    expect((dsBlocked.blocked as string[]).join(" "), `no-projection-binding: changed dataset.id blocker does not name the dataset binding`).toMatch(/dataset/i);

    // Changed model.revision (invalid placeholder) blocks before spawn.
    const revCfg = JSON.parse(JSON.stringify(cfg)) as Record<string, any>;
    revCfg["model"]["revision"] = "0".repeat(40);
    const revPath = writeCfg(r, revCfg);
    const revBlocked = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: revPath }, MAIN("dummyx", revPath));
    expect(revBlocked.out, `no-projection-binding: changed model.revision launched (spawn=${JSON.stringify(revBlocked.rec.spawn)})`).toBe(2);
    expect((revBlocked.rec.spawn as unknown[]), `no-projection-binding: changed model.revision spawned ${JSON.stringify(revBlocked.rec.spawn)}`).toEqual([]);
    expect((revBlocked.blocked as string[]).join(" "), `no-projection-binding: changed model.revision blocker does not name the revision`).toMatch(/revision/i);

    // Changed image.digest only (ref/digest disagree): canonical validation
    // flags it AND the mapping failure is reported distinctly.
    const digCfg = JSON.parse(JSON.stringify(cfg)) as Record<string, any>;
    digCfg["image"]["digest"] = `sha256:${"8".repeat(64)}`;
    expect(validateRunConfig(digCfg).length, "no-projection-binding: canonical validation missed the ref/digest disagreement").toBeGreaterThan(0);
    const digPath = writeCfg(r, digCfg);
    const digBlocked = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: digPath }, MAIN("dummyx", digPath));
    expect(digBlocked.out, `no-projection-binding: mismatched image digest launched (spawn=${JSON.stringify(digBlocked.rec.spawn)})`).toBe(2);
    expect((digBlocked.rec.spawn as unknown[]), `no-projection-binding: mismatched image digest spawned ${JSON.stringify(digBlocked.rec.spawn)}`).toEqual([]);
    expect(
      (digBlocked.blocked as string[]).some((b) => b.includes("projection: image digest mismatch")),
      `no-projection-binding: expected the distinct mapping failure "projection: image digest mismatch", got blockers=${(digBlocked.blocked as string[]).join(" | ")}`,
    ).toBe(true);

    // A spawn-time config_sha256 mismatch makes zero eval subprocess.run
    // calls: eval_in_container.local with a patched run, nothing real starts.
    const patched = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: canonicalConfig(r).path }, [
      "import subprocess as _sp, tempfile, pathlib",
      "RUN_CMDS = []",
      "class _P:",
      "    pid = 999999",
      "    def poll(self): return 0",
      "    def wait(self, timeout=None): return 0",
      "def _popen(cmd, **k): return _P()",
      "def _run(cmd, **k):",
      "    RUN_CMDS.append(list(cmd))",
      "    class _R: returncode = 0; stdout = ''; stderr = ''",
      "    return _R()",
      "ga.subprocess.Popen = _popen",
      "ga.subprocess.run = _run",
      "lc.wait_ready = lambda *a, **k: {'ready': True, 'remaining_ms': 60000, 'remaining_s': 60}",
      "_tmp = tempfile.mkdtemp()",
      "_orig = pathlib.Path",
      "ga.Path = lambda p, *a: _orig(_tmp) / str(p).lstrip('/') if str(p).startswith('/results') else _orig(p, *a)",
      "try:",
      "    _res = ga.eval_in_container.local('dummyx', '0' * 64)",
      "    out = {'threw': None, 'res': _res, 'runs': RUN_CMDS}",
      "except Exception as _e:",
      "    out = {'threw': f'{type(_e).__name__}: {_e}', 'runs': RUN_CMDS}",
    ].join("\n"));
    expect(patched.out.threw, `no-projection-binding: eval_in_container.local threw ${patched.out.threw}`).toBe(null);
    expect(patched.out.runs, `no-projection-binding: mismatched config_sha256 still ran eval subprocesses ${JSON.stringify(patched.out.runs)}`).toEqual([]);
    expect(String(patched.out.res.eval_stderr ?? ""), `no-projection-binding: no explicit identity error recorded: ${JSON.stringify(patched.out.res).slice(0, 500)}`).toMatch(/config|sha256/i);
  });

  it("G2-3", { timeout: 120000 }, async () => {
    const r = fakeRepo();
    const a = canonicalConfig(r);
    const bCfg = JSON.parse(JSON.stringify(a.cfg)) as Record<string, any>;
    bCfg["decoding"]["seed"] = 999;
    const bBytes = JSON.stringify(bCfg);
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: a.path };
    const drifted = app(r, env, [
      `open(${JSON.stringify(a.path)}, "w").write(${JSON.stringify(bBytes)})`,
      "try:",
      `    ga.main(dataset="dummyx", config=${JSON.stringify(a.path)}); out = None`,
      "except SystemExit as e:",
      "    out = e.code",
    ].join("\n"));
    expect(drifted.out).toBe(2);
    expect(drifted.rec.spawn).toEqual([]);
    expect((drifted.blocked as string[]).some((bl) => /drift|changed bytes/i.test(bl))).toBe(true);
  });

  it("G2-4", { timeout: 120000 }, async () => {
    const r = fakeRepo();
    const { cfg, ds } = canonicalConfig(r);

    // Missing GLIMMER_LAUNCH_CONFIG blocks with zero spawns.
    const missing = app(r, { GLIMMER_EVAL_DATASET: "dummyx" }, MAIN("dummyx", join(r, "g2-no-such-config.json")));
    expect(missing.out, `legacy-downgrade: missing GLIMMER_LAUNCH_CONFIG launched (spawn=${JSON.stringify(missing.rec.spawn)})`).toBe(2);
    expect(missing.rec.spawn, `legacy-downgrade: missing GLIMMER_LAUNCH_CONFIG spawned ${JSON.stringify(missing.rec.spawn)}`).toEqual([]);

    // Config missing the model section blocks with zero spawns.
    const noModel = JSON.parse(JSON.stringify(cfg)) as Record<string, any>;
    delete noModel["model"];
    const noModelPath = writeCfg(r, noModel);
    const noModelBlocked = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: noModelPath }, MAIN("dummyx", noModelPath));
    expect(noModelBlocked.out, `legacy-downgrade: model-less config launched (spawn=${JSON.stringify(noModelBlocked.rec.spawn)})`).toBe(2);
    expect(noModelBlocked.rec.spawn, `legacy-downgrade: model-less config spawned ${JSON.stringify(noModelBlocked.rec.spawn)}`).toEqual([]);

    // Unknown configVersion blocks with zero spawns.
    const v2 = JSON.parse(JSON.stringify(cfg)) as Record<string, any>;
    v2["configVersion"] = 2;
    const v2Path = writeCfg(r, v2);
    const v2Blocked = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: v2Path }, MAIN("dummyx", v2Path));
    expect(v2Blocked.out, `legacy-downgrade: configVersion 2 launched (spawn=${JSON.stringify(v2Blocked.rec.spawn)})`).toBe(2);
    expect(v2Blocked.rec.spawn, `legacy-downgrade: configVersion 2 spawned ${JSON.stringify(v2Blocked.rec.spawn)}`).toEqual([]);

    // A flat legacy dict blocks with zero spawns (no silent downgrade).
    const flatCfg = {
      dataset: "dummyx",
      dataset_sha256: ds,
      source_sha: headSha(r),
      source_sha256: (cfg as Record<string, any>)["sourceSha256"],
      image: DIGEST_G2,
      model: "meta-models/Muse-Glimmer-30B",
      model_revision: REV_G2,
      review: (cfg as Record<string, any>)["review"],
    };
    const flatPath = writeCfg(r, flatCfg);
    const flatBlocked = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: flatPath }, MAIN("dummyx", flatPath));
    expect(flatBlocked.out, `legacy-downgrade: flat legacy config launched (spawn=${JSON.stringify(flatBlocked.rec.spawn)})`).toBe(2);
    expect(flatBlocked.rec.spawn, `legacy-downgrade: flat legacy config spawned ${JSON.stringify(flatBlocked.rec.spawn)}`).toEqual([]);

    // eval_in_container.local with absent config bytes: zero node
    // subprocess.run calls and zero fake-server requests.
    const fake = startFakeEndpoint();
    try {
      const local = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_BASE_URL: fake.url, GLIMMER_LAUNCH_CONFIG: flatPath }, [
        "import subprocess as _sp, tempfile, pathlib",
        "ga._LAUNCH_CONFIG_BYTES = None",
        "RUN_CMDS = []",
        "class _P:",
        "    pid = 999999",
        "    def poll(self): return 0",
        "    def wait(self, timeout=None): return 0",
        "def _popen(cmd, **k): return _P()",
        "def _run(cmd, **k):",
        "    RUN_CMDS.append(list(cmd))",
        "    class _R: returncode = 0; stdout = ''; stderr = ''",
        "    return _R()",
        "ga.subprocess.Popen = _popen",
        "ga.subprocess.run = _run",
        "lc.wait_ready = lambda *a, **k: {'ready': True, 'remaining_ms': 60000, 'remaining_s': 60}",
        "_tmp = tempfile.mkdtemp()",
        "_orig = pathlib.Path",
        "ga.Path = lambda p, *a: _orig(_tmp) / str(p).lstrip('/') if str(p).startswith('/results') else _orig(p, *a)",
        "try:",
        "    _res = ga.eval_in_container.local('dummyx', 'f' * 64)",
        "    out = {'threw': None, 'res': _res, 'runs': RUN_CMDS}",
        "except Exception as _e:",
        "    out = {'threw': f'{type(_e).__name__}: {_e}', 'runs': RUN_CMDS}",
      ].join("\n"));
      expect(local.out.threw, `legacy-downgrade: eval_in_container.local threw ${local.out.threw}`).toBe(null);
      expect(local.out.runs, `legacy-downgrade: absent config bytes still ran eval subprocesses ${JSON.stringify(local.out.runs)}`).toEqual([]);
      expect(fake.requests(), "legacy-downgrade: fake inference server got requests with absent config bytes").toBe(0);
    } finally {
      fake.close();
    }

    // The frozen eval builder requires both the config path and its sha.
    const bare = app(r, {}, [
      "import tempfile",
      "_out = tempfile.mkdtemp()",
      "try:",
      "    _cmd = lc.eval_command('dummyx', _out, 'run-g2', None, None)",
      "    out = {'raised': False, 'cmd': _cmd}",
      "except ValueError as _e:",
      "    out = {'raised': True, 'err': str(_e), 'kind': 'ValueError'}",
      "except TypeError as _e:",
      "    out = {'raised': True, 'err': str(_e), 'kind': 'TypeError'}",
    ].join("\n"));
    expect(bare.out.raised, `legacy-downgrade: eval_command(ds, out, run, None, None) returned a bare legacy command ${JSON.stringify(bare.out.cmd)} instead of raising`).toBe(true);
    expect(bare.out.kind, `legacy-downgrade: eval_command raised ${bare.out.kind}, want ValueError`).toBe("ValueError");
  });
});

// Fake OpenAI-compatible inference endpoint implementing exactly what
// liveRedactor (src/private/redact.ts) calls: POST /v1/chat/completions,
// returning a valid redaction for the invented dummy text. It is served at a
// 127.0.0.1 URL but in-process via a node --import fetch shim, because this
// sandbox forbids bind() (listen on 127.0.0.1/0.0.0.0 raises EPERM). No real
// network happens: any non-127.0.0.1 fetch throws. Requests are counted in a
// file so the separate child process can report them.
function startFakeEndpoint(): { url: string; shimPath: string; requests: () => number; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "g2-fake-"));
  const countPath = join(dir, "requests.log");
  const shimPath = join(dir, "fake-shim.mjs");
  writeFileSync(shimPath, String.raw`
const countPath = process.env["G2_FAKE_COUNT"] ?? "";
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (!url.startsWith("http://127.0.0.1:")) throw new Error("g2-fake: network blocked for " + url);
  const u = new URL(url);
  if ((init?.method ?? "GET").toUpperCase() === "POST" && u.pathname === "/v1/chat/completions") {
    const { appendFileSync } = await import("node:fs");
    if (countPath !== "") appendFileSync(countPath, "1\n");
    const body = JSON.parse(String(init?.body ?? "{}"));
    const user = (body.messages ?? []).find((m) => m?.role === "user");
    const text = typeof user?.content === "string" ? user.content : "";
    const idx = text.indexOf("Ana");
    const spans = idx >= 0 ? [{ start: idx, end: idx + 3, label: "person" }] : [];
    const content = JSON.stringify({ spans, boxes: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error("g2-fake: unsupported " + url);
};
`);
  const requests = (): number => {
    try {
      return readFileSync(countPath, "utf8").split("\n").filter((l) => l.trim() !== "").length;
    } catch {
      return 0;
    }
  };
  return { url: "http://127.0.0.1:18001", shimPath, requests, close: () => {} };
}
