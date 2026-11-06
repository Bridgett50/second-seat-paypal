// G2b ownership: staging must not collide with the exclusive run dir.
// Stub/server helpers copied (trimmed) from test/g2-composition.test.ts.
// Invented dummy data only, all paths inside mkdtemp dirs.
import { validateRunConfig } from "../src/release/runConfig.js";
// @ts-expect-error untyped helper module
import { runEval } from "../scripts/redaction-eval-runner.mjs";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  mkdirSync as fsMkdirSync,
  openSync as fsOpenSync,
  rmSync as fsRmSync,
  writeFileSync as fsWriteFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const botDir = join(here, "..");
const repoRoot = join(botDir, "..", "..");
const DIGEST = `registry.invalid/dummy@sha256:${"7".repeat(64)}`;
const REV = "9f".repeat(20);
const TEXT = "Call Ana at 555-0100";
const FIXED_RUN = "run-20261027T120000-424242";

// Frozen runtime prompt/schema/scorer identities for dummy configs that run
// the CLI with --run-config (placeholder shas would now refuse).
// @ts-expect-error untyped helper module
const { runtimeIdentities: g2bRuntimeIdentities } = await import("../scripts/frozen-identities.mjs");
const G2B_IDS = (await g2bRuntimeIdentities()) as { prompt: string; schema: string; scorer: string };

const STUB = String.raw`
import sys, types, enum, json
class FileEntryType(enum.IntEnum):
    UNSPECIFIED = 0
    FILE = 1
    DIRECTORY = 2
class FileEntry:
    def __init__(self, path, type, mtime=0, size=0):
        self.path, self.type, self.mtime, self.size = path, type, mtime, size
class Image:
    def __init__(self, ref=None): self.ref = ref
    @staticmethod
    def from_registry(ref, **kw): return Image(ref)
    def _c(self): return Image(self.ref)
    def dockerfile_commands(self, *a, **k): return self._c()
    def entrypoint(self, *a, **k): return self._c()
    def run_commands(self, *a, **k): return self._c()
    def add_local_dir(self, l, r, **k): return self._c()
    def add_local_file(self, l, r, **k): return self._c()
class Volume:
    def __init__(self, name): self.name = name
    @staticmethod
    def from_name(name, **k): return Volume(name)
    def commit(self): pass
class _Call: object_id = "fc-stub"
class Function:
    def __init__(self, f): self.f = f
    def spawn(self, *a, **k): return _Call()
    def local(self, *a, **k): return self.f(*a, **k)
class App:
    def __init__(self, *a, **k): pass
    def function(self, **kw): return lambda f: Function(f)
    def local_entrypoint(self, *a, **k): return lambda f: f
def concurrent(**k): return lambda f: f
def web_server(*a, **k): return lambda f: f
modal = types.ModuleType("modal")
for _n, _v in dict(App=App, Image=Image, Volume=Volume, concurrent=concurrent, web_server=web_server).items(): setattr(modal, _n, _v)
sys.modules["modal"] = modal
`;

function git(r: string, ...args: string[]) {
  const res = spawnSync("git", args, { cwd: r, encoding: "utf8" });
  expect(res.status).toBe(0); return (res.stdout as string).trim();
}

function fakeRepo(): string {
  const r = mkdtempSync(join(tmpdir(), "g2b-repo-"));
  mkdirSync(join(r, "infra", "modal"), { recursive: true });
  for (const f of ["glimmer_app.py", "launch_contract.py"])
    copyFileSync(join(repoRoot, "infra", "modal", f), join(r, "infra", "modal", f));
  const bot = join(r, "services", "bot");
  mkdirSync(join(bot, "dist"), { recursive: true });
  mkdirSync(join(bot, "scripts"), { recursive: true });
  writeFileSync(join(bot, "dist", "x.js"), "export const x = 1;\n");
  writeFileSync(join(bot, "scripts", "redaction-eval.mjs"), "// dummy\n");
  writeFileSync(join(bot, "package.json"), "{}\n");
  mkdirSync(join(bot, "fixtures", "dummyx"), { recursive: true });
  writeFileSync(join(bot, "fixtures", "dummyx", "dummyx-01.txt"), TEXT);
  writeFileSync(join(bot, "fixtures", "dummyx", "cases.json"), JSON.stringify([{ file: "dummyx-01.txt", entities: [] }]));
  writeFileSync(join(r, ".gitignore"), "__pycache__/\n");
  git(r, "init", "-q");
  const gitId: Array<[string, string]> = [["user.email", "dummy@example.invalid"], ["user.name", "Dummy"], ["commit.gpgsign", "false"]];
  for (const [k, v] of gitId) git(r, "config", k, v);
  git(r, "add", "-A");
  git(r, "commit", "-qm", "dummy commit");
  return r;
}

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
    "print('G2OUT ' + json.dumps({'out': out}))",
  ].join("\n");
  const res = spawnSync("python3", ["-c", prog], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
  });
  const line = res.stdout.split("\n").find((l) => l.startsWith("G2OUT "));
  if (!line) throw new Error(`python failed (${res.status}): ${res.stderr.slice(-3000)}`);
  return JSON.parse(line.slice(6)).out;
}

function writeCfg(r: string, cfg: unknown): string {
  const p = join(r, `g2bcfg-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(cfg)); return p;
}

function canonicalConfig(r: string): { path: string; sha: string } {
  const hashed = app(r, {}, [
    `ds = ${JSON.stringify(join(r, "services", "bot", "fixtures", "dummyx"))}`,
    `out = {"ds": lc.dataset_sha256(ds), "src": lc.packaged_source_sha256(${JSON.stringify(r)}, "dummyx")}`,
  ].join("\n"));
  const head = git(r, "rev-parse", "HEAD");
  const cfg: Record<string, unknown> = {
    configVersion: 1, sourceSha: head, sourceSha256: hashed.src,
    dataset: { id: "dummyx", sha256: hashed.ds },
    model: { name: "meta-models/Muse-Glimmer-30B", revision: REV },
    image: { ref: DIGEST, digest: `sha256:${"7".repeat(64)}` },
    prompt: { sha256: G2B_IDS.prompt }, schema: { sha256: G2B_IDS.schema }, scorer: { sha256: G2B_IDS.scorer },
    decoding: { temperature: 0, seed: 1, reasoning: "low" }, tokenLimits: { maxTokens: 256 },
    timeouts: { requestMs: 10000, workDeadlineS: 120, functionTimeoutS: 180 }, retry: { maxAttempts: 1 },
    modal: { allocations: 1, concurrency: 1, maxConcurrency: 2, scoredCanary: true, teardown: true, evidenceDownload: "complete" },
    review: { status: "reviewed", reviewer: "G2b Reviewer", reviewed_at: "2026-10-27", dataset_sha256: hashed.ds },
    glimmerDemoRequests: 0, budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 },
  };
  expect(validateRunConfig(cfg as never), "positive control: canonical dummy config must validate").toEqual([]);
  const path = writeCfg(r, cfg);
  return { path, sha: createHash("sha256").update(readFileSync(path)).digest("hex") };
}

function makeBotTree(): string {
  const tree = mkdtempSync(join(tmpdir(), "g2b-tree-"));
  mkdirSync(join(tree, "scripts"), { recursive: true });
  for (const f of ["redaction-eval.mjs", "redaction-eval-runner.mjs", "redaction-eval-lib.mjs", "frozen-identities.mjs", "rescore-glimmer-run.mjs"])
    copyFileSync(join(botDir, "scripts", f), join(tree, "scripts", f));
  symlinkSync(join(botDir, "dist"), join(tree, "dist"));
  symlinkSync(join(botDir, "node_modules"), join(tree, "node_modules"));
  mkdirSync(join(tree, "fixtures", "dummyx"), { recursive: true });
  writeFileSync(join(tree, "fixtures", "dummyx", "dummyx-01.txt"), TEXT);
  writeFileSync(join(tree, "fixtures", "dummyx", "cases.json"), JSON.stringify([{ file: "dummyx-01.txt", entities: ["Ana"] }]));
  return tree;
}

function startFakeEndpoint(): { url: string; shimPath: string; countPath: string; requests: () => number } {
  const dir = mkdtempSync(join(tmpdir(), "g2b-fake-"));
  const countPath = join(dir, "requests.log");
  const shimPath = join(dir, "fake-shim.mjs");
  writeFileSync(shimPath, String.raw`
const countPath = process.env["G2_FAKE_COUNT"] ?? ""; const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (!url.startsWith("http://127.0.0.1:")) throw new Error("g2b-fake: blocked " + url);
  const u = new URL(url);
  if ((init?.method ?? "GET").toUpperCase() !== "POST" || u.pathname !== "/v1/chat/completions") throw new Error("g2b-fake: unsupported " + url);
  const { appendFileSync } = await import("node:fs");
  if (countPath !== "") appendFileSync(countPath, "1\n");
  const body = JSON.parse(String(init?.body ?? "{}"));
  const user = (body.messages ?? []).find((m) => m?.role === "user");
  const text = typeof user?.content === "string" ? user.content : "";
  const idx = text.indexOf("Ana");
  const spans = idx >= 0 ? [{ start: idx, end: idx + 3, label: "person" }] : [];
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ spans, boxes: [] }) }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });
};
`);
  const requests = (): number => (tryRead(countPath) ?? "").split("\n").filter((l) => l.trim() !== "").length;
  return { url: "http://127.0.0.1:18001", shimPath, countPath, requests };
}

// Prelude for eval_in_container.local: fixed run id, inert vLLM/readiness,
// /results + /app literals redirected into tmp dirs, real node subprocess
// against the fake shim with request counting.
function evalPrelude(tmpR: string, tree: string, fake: { url: string; shimPath: string }): string {
  const J = JSON.stringify;
  return [
    "import os, json, hashlib, pathlib, builtins, subprocess as _spmod, datetime as _dt",
    `TmpR, Tree, Fake, Shim = ${J(tmpR)}, ${J(tree)}, ${J(fake.url)}, ${J(fake.shimPath)}`,
    "ga._RESULTS_ROOT, ga._BOT_DIR, ga._VLLM_BASE_URL = TmpR, Tree, Fake",
    "class _FDT(_dt.datetime):",
    "    @classmethod",
    "    def now(cls, tz=None): return _dt.datetime(2026, 10, 27, 12, 0, 0, tzinfo=_dt.timezone.utc)",
    "ga.datetime.datetime = _FDT; ga.os.getpid = lambda: 424242",
    "lc.wait_ready = lambda *a, **k: {'ready': True, 'remaining_ms': 60000, 'remaining_s': 60}",
    "class _P:",
    "    pid = 999999",
    "    def poll(self): return 0",
    "    def wait(self, timeout=None): return 0",
    "_REAL_POPEN = _spmod.Popen; ga.subprocess.Popen = lambda *a, **k: _P(); _REAL_RUN = _spmod.run; RUN_CMDS = []",
    "def _redir(p): return TmpR + p[len('/results'):] if isinstance(p, str) and p.startswith('/results') else p",
    "_orig_open, _orig_makedirs, _orig_Path = builtins.open, os.makedirs, pathlib.Path",
    "os.makedirs = lambda p, *a, **k: _orig_makedirs(_redir(p), *a, **k)",
    "builtins.open = lambda p, *a, **k: _orig_open(_redir(p), *a, **k) if isinstance(p, str) and p.startswith('/results') else _orig_open(p, *a, **k)",
    "ga.Path = lambda p, *a: _orig_Path(_redir(p), *a) if isinstance(p, str) and p.startswith('/results') else _orig_Path(p, *a)",
    "def _wrap(cmd, **k):",
    "    _cmd = [_redir(c) if isinstance(c, str) else c for c in cmd]",
    "    k['env'] = {**(k.get('env', {}) or {}), 'GLIMMER_BASE_URL': Fake, 'G2_FAKE_COUNT': os.environ.get('G2_FAKE_COUNT', ''), 'PATH': os.environ.get('PATH', '')}",
    "    if isinstance(k.get('cwd'), str) and k['cwd'].startswith('/app'): k['cwd'] = Tree",
    "    _ni = [i for i, c in enumerate(_cmd) if c == 'node']",
    "    if _ni: _cmd[_ni[0] + 1:_ni[0] + 1] = ['--import', Shim]",
    "    RUN_CMDS.append(list(_cmd))",
    "    _spmod.Popen = _REAL_POPEN",
    "    try: return _REAL_RUN(_cmd, **k)",
    "    finally: _spmod.Popen = lambda *a, **k: _P()",
    "ga.subprocess.run = _wrap",
  ].join("\n");
}

const EVAL_CALL = (sha: string) => [
  "try:",
  `    _res = ga.eval_in_container.local('dummyx', ${JSON.stringify(sha)})`,
  "    out = {'threw': None, 'res': _res, 'runs': RUN_CMDS}",
  "except Exception as _e:",
  "    out = {'threw': f'{type(_e).__name__}: {_e}', 'runs': RUN_CMDS}",
].join("\n");

function tryRead(p: string): string | null {
  try { return readFileSync(p, "utf8"); } catch { return null; }
}

function snapDir(dir: string): { files: string[]; hashes: Record<string, string> } {
  const files: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      const rp = rel === "" ? name : `${rel}/${name}`;
      if (statSync(join(d, name)).isDirectory()) walk(join(d, name), rp);
      else files.push(rp);
    }
  };
  walk(dir, "");
  const hashes: Record<string, string> = {};
  for (const f of files) hashes[f] = createHash("sha256").update(readFileSync(join(dir, f))).digest("hex");
  return { files, hashes };
}

function lcOut(repo: string, body: string[]): any {
  const prog = [
    "import importlib.util, json, types",
    `spec = importlib.util.spec_from_file_location("lc", ${JSON.stringify(join(repo, "infra", "modal", "launch_contract.py"))})`,
    "lc = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(lc)",
    ...body,
  ].join("\n");
  const res = spawnSync("python3", ["-c", prog], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" } });
  const line = res.stdout.split("\n").find((l) => l.startsWith("G2BOUT "));
  if (!line) throw new Error(`python failed (${res.status}): ${res.stderr.slice(-2000)}`);
  return JSON.parse(line.slice(7));
}

describe("G2b run-directory ownership", () => {
  it("G2-5", { timeout: 180000 }, async () => {
    const r = fakeRepo();
    const { path, sha } = canonicalConfig(r);
    const frozen = readFileSync(path);
    const tree = makeBotTree(), tmpR = mkdtempSync(join(tmpdir(), "g2b-results-"));
    const fake = startFakeEndpoint();
    const env = { G2_FAKE_COUNT: fake.countPath, GLIMMER_LAUNCH_CONFIG: path, GLIMMER_EVAL_DATASET: "dummyx" };
    const out = app(r, env, [evalPrelude(tmpR, tree, fake), EVAL_CALL(sha)].join("\n"));
    expect(out.threw, `staging-reuse-refusal: eval_in_container.local threw ${out.threw}`).toBe(null);
    const res = out.res;
    expect(res.eval_returncode, `staging-reuse-refusal: fresh run failed rc=${res.eval_returncode} node-runs=${out.runs.length} stderr=${String(res.eval_stderr ?? "").slice(-1500)}`).toBe(0);
    const runDir = join(tmpR, res.run_id);
    let staged: Buffer | null = null;
    try { staged = readFileSync(join(runDir, "run-config.json")); } catch { staged = null; }
    expect(staged, "staging-reuse-refusal: run dir has no run-config.json config evidence").not.toBe(null);
    expect((staged as Buffer).equals(frozen), "staging-reuse-refusal: staged run-config.json bytes != frozen config bytes").toBe(true);
    const recsText = tryRead(join(runDir, "records.jsonl"));
    const recs: any[] | null = recsText === null ? null : recsText.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
    expect(recs, "staging-reuse-refusal: records.jsonl missing or unreadable after a fresh run").not.toBe(null);
    expect((recs as any[]).length, "staging-reuse-refusal: expected one terminal record").toBe(1);
    expect((recs as any[])[0].status, `staging-reuse-refusal: case not ok: ${JSON.stringify((recs as any[])[0]).slice(0, 300)}`).toBe("ok");
    expect((recs as any[])[0].run_id, "staging-reuse-refusal: record not keyed by run_id").toBe(res.run_id);
    expect((recs as any[])[0].case_id, "staging-reuse-refusal: record not keyed by case_id").toBe("dummyx-01.txt");
    const rs = spawnSync("node", ["scripts/rescore-glimmer-run.mjs", "--run-dir", runDir], { cwd: tree, encoding: "utf8", timeout: 60000 });
    expect(rs.status, `staging-reuse-refusal: strict rescore exited ${rs.status} stderr=${(rs.stderr as string).slice(-1000)}`).toBe(0);
  });

  it("G2-6", { timeout: 180000 }, async () => {
    const r = fakeRepo();
    const { path: cfgPath, sha } = canonicalConfig(r);
    const tree = makeBotTree(), tmpR = mkdtempSync(join(tmpdir(), "g2b-results-"));
    const fake = startFakeEndpoint();
    const completed = {
      "manifest.json": JSON.stringify({ run_id: FIXED_RUN, planned: [] }),
      "records.jsonl": JSON.stringify({ file: "dummyx-01.txt", status: "ok" }) + "\n",
      "summary.json": "{}", "report.txt": "complete: true\n", "run-config.json": JSON.stringify({ old: "evidence" }),
    };
    const interrupted = { "manifest.json": JSON.stringify({ run_id: FIXED_RUN, planned: [{ file: "dummyx-01.txt" }] }) };
    const scenarios: Array<[string, Record<string, string>]> = [["completed", completed], ["interrupted", interrupted]];
    for (const [label, files] of scenarios) {
      rmSync(join(tmpR, FIXED_RUN), { recursive: true, force: true });
      mkdirSync(join(tmpR, FIXED_RUN), { recursive: true });
      for (const [name, text] of Object.entries(files)) writeFileSync(join(tmpR, FIXED_RUN, name), text);
      const before = snapDir(join(tmpR, FIXED_RUN)), base = fake.requests();
      const env = { G2_FAKE_COUNT: fake.countPath, GLIMMER_LAUNCH_CONFIG: cfgPath, GLIMMER_EVAL_DATASET: "dummyx" };
      const out = app(r, env, [evalPrelude(tmpR, tree, fake), EVAL_CALL(sha)].join("\n"));
      expect(out.threw, `evidence-modified: ${label} run threw ${out.threw}`).toBe(null);
      expect(String(out.res.eval_stderr ?? ""), `evidence-modified: ${label} run not refused: ${JSON.stringify(out.res).slice(0, 400)}`).toMatch(/refus/i);
      expect(out.runs.length, `evidence-modified: ${label} run started ${out.runs.length} node eval subprocesses`).toBe(0);
      expect(fake.requests() - base, `evidence-modified: ${label} run made fake inference requests`).toBe(0);
      expect(snapDir(join(tmpR, FIXED_RUN)), `evidence-modified: ${label} run evidence modified (staging wrote into the existing run dir)`).toEqual(before);
    }
  });

  it("G2-7", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "g2b-eval-")), runId = "run-g2b7-probe";
    mkdirSync(join(outDir, "run-sibling"), { recursive: true });
    writeFileSync(join(outDir, "run-sibling", "keep.txt"), "keep");
    const cases = [{ file: "dummyx-01.txt", entities: ["Ana"] }];
    let calls = 0;
    const fsImpl = {
      mkdirSync: fsMkdirSync,
      writeFileSync: ((p: string, ...a: any[]) => {
        if (String(p).endsWith("manifest.json")) throw new Error("injected manifest failure");
        return (fsWriteFileSync as any)(p, ...a);
      }) as typeof fsWriteFileSync,
      openSync: fsOpenSync,
      rmSync: fsRmSync,
    };
    const err = await runEval({
      cases,
      readText: async () => TEXT,
      makeRedactor: () => { calls += 1; return { redactText: async () => ({ spans: [] }) }; },
      outDir,
      runId,
      fsImpl,
    } as any).then(() => null, (e: unknown) => e);
    expect(String((err as Error)?.message ?? err ?? ""), `no-failure-evidence: runEval did not throw an ownership failure (err=${String((err as Error)?.message ?? err ?? "").slice(0, 300)})`).toMatch(/ownership failure at \S*manifest/i);
    expect(calls, `no-failure-evidence: makeRedactor called ${calls} times during an ownership failure`).toBe(0);
    const failure = JSON.parse(tryRead(join(outDir, `${runId}.ownership-failure.json`)) ?? "null");
    expect(failure, "no-failure-evidence: <outDir>/<runId>.ownership-failure.json missing").not.toBe(null);
    expect(String(failure?.stage ?? ""), "no-failure-evidence: ownership-failure.json has no stage").toMatch(/manifest/);
    expect(existsSync(join(outDir, runId)), "no-failure-evidence: the newly created run dir was not removed").toBe(false);
    expect(readFileSync(join(outDir, "run-sibling", "keep.txt"), "utf8"), "no-failure-evidence: sibling pre-existing run dir touched").toBe("keep");
  });

  it("G2-8", async () => {
    const r = fakeRepo();
    const out = lcOut(r, [
      "NS = types.SimpleNamespace",
      "FIL = NS(name='FILE', value=1); DIR = NS(name='DIRECTORY', value=2)",
      "E = lambda p, t: NS(path=p, type=t)",
      "has = hasattr(lc, 'rels_from_entries')",
      "out = {'has': has}",
      "if has:",
      "    out['rels'] = lc.rels_from_entries([E('r1/a.json', FIL), E('r1/nested', DIR), E('r1/nested/b.jsonl', FIL)], 'r1')",
      "    out['bad'] = {}",
      "    for _b in ['/abs/x.json', 'other/x.json', 'r1/../evil.json', 'r1/sub/../../evil.json']:",
      "        try:",
      "            lc.rels_from_entries([E(_b, FIL)], 'r1'); out['bad'][_b] = 'no-raise'",
      "        except ValueError: out['bad'][_b] = 'raised'",
      "print('G2BOUT ' + json.dumps(out))",
    ]);
    expect(out.has, "silent-entry-drop: lc.rels_from_entries is missing (fetch silently drops out-of-prefix entries)").toBe(true);
    expect(out.rels, "silent-entry-drop: nested rels wrong").toEqual(["a.json", "nested/b.jsonl"]);
    for (const [rel, outcome] of Object.entries(out.bad as Record<string, string>))
      expect(outcome, `silent-entry-drop: rel ${rel} did not raise`).toBe("raised");
  });

  it("G2-8g", async () => {
    const r = fakeRepo();
    const outDir = join(mkdtempSync(join(tmpdir(), "g2b-dl-")), "out");
    const out = lcOut(r, [
      "FILES = {'r1/a.json': b'hello', 'r1/nested/b.jsonl': b'{\"x\":1}\\n'}",
      "def _ls(rid): return [k.split('/', 1)[1] for k in sorted(FILES) if k.startswith(rid + '/')]",
      "def _rd(remote): return FILES[remote]",
      `done = lc.download_run(_ls, _rd, 'r1', ${JSON.stringify(outDir)})`,
      "try:",
      "    lc.download_run(lambda rid: ['../evil', 'r1/ok.json'], lambda remote: b'x', 'r1', __import__('tempfile').mkdtemp()); trav = 'no-raise'",
      "except ValueError: trav = 'raised'",
      "print('G2BOUT ' + json.dumps({'done': sorted(done), 'trav': trav}))",
    ]);
    expect(out.done).toEqual(["a.json", "nested/b.jsonl"]);
    expect(readFileSync(join(outDir, "a.json"), "utf8")).toBe("hello");
    expect(readFileSync(join(outDir, "nested", "b.jsonl"), "utf8")).toBe('{"x":1}\n');
    expect(out.trav).toBe("raised");
  });
});
