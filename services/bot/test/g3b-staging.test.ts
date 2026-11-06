// G3b: staging fails closed and a Spark proof makes a single attempt (inert
// modal stub, fake transports, dummy data in tmp dirs). Rehearsal success is
// not model accuracy and not paid-run authorization.
import { MuseClient } from "../src/brief/muse.js";
import { GateApprovalError, createPrivacyGate, type GatedText } from "../src/private/gate.js";
import { sparkProofClientOptions, validateRunConfig } from "../src/release/runConfig.js";
// @ts-expect-error untyped helper module
import { rescoreRun } from "../scripts/rescore-glimmer-run.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const botDir = join(here, "..");
const repoRoot = join(botDir, "..", "..");
const REV = "9f".repeat(20);
const DIGEST = `registry.invalid/dummy@sha256:${"7".repeat(64)}`;
const TEXT = "Call Ana at 555-0100";
const FIXED_RUN = "run-20261027T120000-424242";

// @ts-expect-error untyped helper module
const { runtimeIdentities: g3RuntimeIdentities } = await import("../scripts/frozen-identities.mjs");
const G3_IDS = (await g3RuntimeIdentities()) as { prompt: string; schema: string; scorer: string };

const STUB = String.raw`
import sys, types, json
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

function fakeRepo(): string {
  const r = mkdtempSync(join(tmpdir(), "g3b-repo-"));
  mkdirSync(join(r, "infra", "modal"), { recursive: true });
  for (const f of ["glimmer_app.py", "launch_contract.py"]) copyFileSync(join(repoRoot, "infra", "modal", f), join(r, "infra", "modal", f));
  const bot = join(r, "services", "bot");
  mkdirSync(join(bot, "dist"), { recursive: true });
  writeFileSync(join(bot, "dist", "x.js"), "export const x = 1;\n");
  mkdirSync(join(bot, "scripts"), { recursive: true });
  writeFileSync(join(bot, "scripts", "redaction-eval.mjs"), "// dummy\n");
  writeFileSync(join(bot, "package.json"), "{}\n");
  mkdirSync(join(bot, "fixtures", "dummyx"), { recursive: true });
  writeFileSync(join(bot, "fixtures", "dummyx", "dummyx-01.txt"), TEXT);
  writeFileSync(join(bot, "fixtures", "dummyx", "cases.json"), JSON.stringify([{ file: "dummyx-01.txt", entities: [] }]));
  return r;
}

function appPy(r: string, env: Record<string, string>, body: string): any {
  const prog = [STUB, "import importlib.util, os",
    `spec = importlib.util.spec_from_file_location("glimmer_app", ${JSON.stringify(join(r, "infra", "modal", "glimmer_app.py"))})`,
    "ga = importlib.util.module_from_spec(spec)", "spec.loader.exec_module(ga)", "lc = ga.launch_contract", "out = None", body,
    "print('G3OUT ' + json.dumps({'out': out}, default=str))"].join("\n");
  const res = spawnSync("python3", ["-c", prog], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", ...env } });
  const line = res.stdout.split("\n").find((l) => l.startsWith("G3OUT "));
  if (!line) throw new Error(`python failed (${res.status}): ${res.stderr.slice(-3000)}`);
  return JSON.parse(line.slice(6)).out;
}

function dummyConfig(over: Record<string, unknown> = {}) {
  const ds = { id: "dummyx", sha256: "c".repeat(64) };
  return {
    configVersion: 1, sourceSha: "a".repeat(40), sourceSha256: "b".repeat(64), dataset: ds,
    model: { name: "meta-models/Muse-Glimmer-30B", revision: REV }, image: { ref: DIGEST, digest: `sha256:${"7".repeat(64)}` },
    prompt: { sha256: "c".repeat(64) }, schema: { sha256: "d".repeat(64) }, scorer: { sha256: "f".repeat(64) },
    decoding: { temperature: 0, seed: 1, reasoning: "low" }, tokenLimits: { maxTokens: 256 },
    timeouts: { requestMs: 10000, workDeadlineS: 120, functionTimeoutS: 180 }, retry: { maxAttempts: 1 },
    modal: { allocations: 1, concurrency: 1, maxConcurrency: 2, scoredCanary: true, teardown: true, evidenceDownload: "complete" },
    review: { status: "reviewed", reviewer: "G3b Reviewer", reviewed_at: "2026-10-27", dataset_sha256: ds.sha256 },
    glimmerDemoRequests: 0, budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 }, ...over,
  };
}

// Shared python prelude: tmp roots, fixed clock/pid (deterministic run id).
const FIXED_PRELUDE = (tmpR: string) => [
  "import os, json, builtins, pathlib, types, subprocess as _spmod, datetime as _dt",
  `TmpR = ${JSON.stringify(tmpR)}`,
  `ga._RESULTS_ROOT, ga._BOT_DIR, ga._VLLM_BASE_URL = TmpR, TmpR, "http://127.0.0.1:9"`,
  "class _FDT(_dt.datetime):",
  "    @classmethod",
  "    def now(cls, tz=None): return _dt.datetime(2026, 10, 27, 12, 0, 0, tzinfo=_dt.timezone.utc)",
  "ga.datetime.datetime = _FDT; ga.os.getpid = lambda: 424242",
].join("\n");

function makeBotTree(): string {
  const tree = mkdtempSync(join(tmpdir(), "g3b-tree-"));
  mkdirSync(join(tree, "scripts"), { recursive: true });
  for (const f of ["redaction-eval.mjs", "redaction-eval-runner.mjs", "redaction-eval-lib.mjs", "frozen-identities.mjs", "rescore-glimmer-run.mjs"]) copyFileSync(join(botDir, "scripts", f), join(tree, "scripts", f));
  symlinkSync(join(botDir, "dist"), join(tree, "dist"));
  symlinkSync(join(botDir, "node_modules"), join(tree, "node_modules"));
  mkdirSync(join(tree, "fixtures", "dummyx"), { recursive: true });
  writeFileSync(join(tree, "fixtures", "dummyx", "dummyx-01.txt"), TEXT);
  writeFileSync(join(tree, "fixtures", "dummyx", "cases.json"), JSON.stringify([{ file: "dummyx-01.txt", entities: ["Ana"] }]));
  return tree;
}

function shimSource(): string {
  return String.raw`
const countPath = process.env["G3_FAKE_COUNT"] ?? ""; const bodiesPath = process.env["G3_FAKE_BODIES"] ?? "";
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (!url.startsWith("http://127.0.0.1:") || (init?.method ?? "GET").toUpperCase() !== "POST" || new URL(url).pathname !== "/v1/chat/completions") throw new Error("g3b-fake: unsupported " + url);
  const { appendFileSync } = await import("node:fs");
  const body = JSON.parse(String(init?.body ?? "{}"));
  if (countPath !== "") appendFileSync(countPath, "1\n");
  if (bodiesPath !== "") appendFileSync(bodiesPath, JSON.stringify({ max_tokens: body.max_tokens, temperature: body.temperature }) + "\n");
  const text = String((body.messages ?? []).find((m) => m?.role === "user")?.content ?? "");
  const idx = text.indexOf("Ana");
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ spans: idx >= 0 ? [{ start: idx, end: idx + 3, label: "person" }] : [], boxes: [] }) }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });
};
`;
}

beforeEach(() => {
  const d = mkdtempSync(join(tmpdir(), "g3b-"));
  vi.stubEnv("GLIMMER_BASE_URL", "http://127.0.0.1:9");
  vi.stubEnv("META_API_KEY", "test-key-not-a-secret");
  vi.stubEnv("MUSE_STATE_FILE", join(d, "state.json"));
  vi.stubEnv("MUSE_COST_LOG_FILE", join(d, "cost.jsonl"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function stubRedactor() {
  return { label: "stub", redactText: async (t: string) => ({ maskedText: t, spans: [] }), redactImage: async () => { throw new Error("no images"); }, health: async () => ({ ok: true, label: "stub" }) };
}
async function approvedGate(text: string) {
  const gate = createPrivacyGate({ mode: "live", redactor: stubRedactor() as never });
  const prepared = await gate.prepare(text);
  return { gate, runId: prepared.runId, token: gate.approve(prepared.runId, prepared.redactedText) };
}
function sse(content: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
}
async function flush(until: () => boolean): Promise<void> {
  for (let i = 0; i < 20000 && !until(); i += 1) await new Promise<void>((r) => setImmediate(r));
  expect(until()).toBe(true);
}

describe("G3b staging fail-closed and single Spark attempt", () => {
  it("G3-8", { timeout: 120000 }, () => {
    const dir = fakeRepo();
    const cfgPath = join(dir, "cfg.json");
    writeFileSync(cfgPath, JSON.stringify(dummyConfig()));
    const sha = createHash("sha256").update(readFileSync(cfgPath)).digest("hex");
    const tmpR = mkdtempSync(join(tmpdir(), "g3b8-results-"));
    const out = appPy(dir, { GLIMMER_LAUNCH_CONFIG: cfgPath }, [FIXED_PRELUDE(tmpR),
      "POPEN = []; RUNS = []; COMMITS = []",
      "ga.results.commit = lambda: COMMITS.append(1)",
      "def _popen(*a, **k): POPEN.append(1); raise AssertionError('vLLM must not start')",
      "def _run(*a, **k): RUNS.append(1); raise AssertionError('eval must not run')",
      "ga.subprocess.Popen = _popen; ga.subprocess.run = _run",
      "_orig_open = builtins.open",
      "def _open(p, *a, **k):",
      '    if isinstance(p, str) and p.endswith("run-config.json"): raise PermissionError("injected staging failure")',
      "    return _orig_open(p, *a, **k)",
      "builtins.open = _open",
      "try:",
      `    _res = ga.eval_in_container.local('dummyx', ${JSON.stringify(sha)})`,
      "    out = {'threw': None, 'res': _res, 'popen': len(POPEN), 'runs': len(RUNS), 'commits': len(COMMITS)}",
      "except Exception as _e:",
      "    out = {'threw': f'{type(_e).__name__}: {_e}', 'popen': len(POPEN), 'runs': len(RUNS), 'commits': len(COMMITS)}",
    ].join("\n"));
    expect(out.threw, `no-staging-evidence: eval_in_container.local threw ${out.threw}`).toBe(null);
    expect(out.popen, "no-staging-evidence: vLLM Popen started during a staging failure").toBe(0);
    expect(out.runs, "no-staging-evidence: eval subprocess started during a staging failure").toBe(0);
    const ev = JSON.parse(readFileSync(join(tmpR, "glimmer-live-eval.json"), "utf8"));
    expect(String(ev.eval_stderr ?? "").startsWith("staging failed:"), `no-staging-evidence: eval_stderr missing staging prefix: ${String(ev.eval_stderr ?? "").slice(0, 200)}`).toBe(true);
    expect(out.commits, "no-staging-evidence: results.commit was not called").toBeGreaterThan(0);
    expect(existsSync(join(tmpR, ".staging", FIXED_RUN)), "no-staging-evidence: staging dir left behind").toBe(false);
  });

  it("G3-9", { timeout: 120000 }, () => {
    const dir = fakeRepo();
    const cfgPath = join(dir, "cfg.json");
    writeFileSync(cfgPath, JSON.stringify(dummyConfig()));
    const sha = createHash("sha256").update(readFileSync(cfgPath)).digest("hex");
    const tmpR = mkdtempSync(join(tmpdir(), "g3b9-results-"));
    const out = appPy(dir, { GLIMMER_LAUNCH_CONFIG: cfgPath }, [FIXED_PRELUDE(tmpR),
      "KILLPG = []; COMMITS = []",
      "_P = types.SimpleNamespace(pid=424242, poll=lambda: None, wait=lambda timeout=None: 0)",
      "ga.subprocess.Popen = lambda *a, **k: _P",
      "lc.wait_ready = lambda *a, **k: {'ready': True, 'remaining_ms': 60000, 'remaining_s': 60}",
      "ga.subprocess.run = lambda *a, **k: types.SimpleNamespace(returncode=0, stdout='', stderr='')",
      "ga.results.commit = lambda: COMMITS.append(1)",
      "ga.os.killpg = lambda pid, sig: KILLPG.append([int(pid), int(sig)])",
      "_RealPath = pathlib.Path",
      "class _FW:",
      "    def __init__(self, p): self._p = _RealPath(p); self.parent = self._p.parent",
      "    def write_text(self, *a, **k): raise OSError('injected evidence-write failure')",
      "ga.Path = lambda p, *a: _FW(str(p)) if str(p).endswith('glimmer-live-eval.json') else _RealPath(p, *a)",
      "try:",
      `    _res = ga.eval_in_container.local('dummyx', ${JSON.stringify(sha)})`,
      "    out = {'threw': None, 'res': _res, 'killpg': KILLPG, 'commits': len(COMMITS)}",
      "except Exception as _e:",
      "    out = {'threw': f'{type(_e).__name__}: {_e}', 'killpg': KILLPG, 'commits': len(COMMITS)}",
    ].join("\n"));
    expect(out.killpg.length, `teardown-skipped: killpg never called (threw=${out.threw}) after the evidence write failed`).toBeGreaterThan(0);
    expect(out.killpg[0][1], "teardown-skipped: first teardown signal was not SIGTERM").toBe(15);
    expect(out.commits, "teardown-skipped: results.commit was skipped").toBeGreaterThan(0);
    const surfaced = typeof out.threw === "string" && out.threw.startsWith("OSError");
    const visible = surfaced || (out.res !== undefined && out.res !== null && out.res.evidence_write_error !== undefined);
    expect(visible, "teardown-skipped: evidence-write failure is hidden (no OSError, no evidence_write_error)").toBe(true);
  });

  it("G3-10g", async () => {
    const cfg = dummyConfig();
    expect(validateRunConfig(cfg as never), "guard setup: dummy config must validate").toEqual([]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (const label of ["503", "429", "transport"]) {
      let fetchCalls = 0;
      const fetchImpl = (async () => {
        fetchCalls += 1;
        if (label === "503") return new Response("overloaded", { status: 503, headers: { "retry-after": "0" } });
        if (label === "429") return new Response("limited", { status: 429, headers: { "retry-after": "0" } });
        throw new TypeError("boom");
      }) as typeof fetch;
      const { gate, runId, token } = await approvedGate("approved meeting notes about the renewal");
      const client = new MuseClient({ fetchImpl, ...sparkProofClientOptions(cfg as never) });
      await expect(gate.send(runId, token, (g: GatedText) =>
        client.completeBrief({ meetingId: "m", transcriptText: g, framesSidecarText: "", fixtureMode: false })),
      `G3-10g ${label}: expected rejection`).rejects.toThrow();
      expect(fetchCalls, `G3-10g ${label}: expected exactly 1 fetch`).toBe(1);
      expect(gate.receipts(runId).length, `G3-10g ${label}: expected exactly 1 attempt receipt`).toBe(1);
      expect(vi.getTimerCount(), `G3-10g ${label}: retry scheduled`).toBe(0);
    }
    let fetchCalls = 0;
    const content = JSON.stringify({ entries: [] });
    const { gate, runId, token } = await approvedGate("approved meeting notes about the renewal");
    const client = new MuseClient({ fetchImpl: (async () => { fetchCalls += 1; return sse(content); }) as typeof fetch, ...sparkProofClientOptions(cfg as never) });
    const res = await gate.send(runId, token, (g: GatedText) =>
      client.completeBrief({ meetingId: "m", transcriptText: g, framesSidecarText: "", fixtureMode: false }));
    expect(res.rawText, "G3-10g success control: streamed content mismatch").toBe(content);
    expect(fetchCalls, "G3-10g success control: expected exactly 1 fetch").toBe(1);
    expect(validateRunConfig({ ...cfg, retry: { maxAttempts: 2 } } as never).length, "G3-10g: maxAttempts 2 must fail validation").toBeGreaterThan(0);
  });

  it("G3-11g", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let fetchCalls = 0;
    const held = await approvedGate("approved meeting notes about the renewal");
    let entered = false;
    let resolveHold!: () => void;
    const hold = new Promise<void>((r) => { resolveHold = r; });
    const heldClient = new MuseClient({
      fetchImpl: (async () => { fetchCalls += 1; return sse("{}"); }) as typeof fetch,
      preflight: () => { entered = true; return hold; },
    });
    const p = held.gate.send(held.runId, held.token, (g: GatedText) =>
      heldClient.completeBrief({ meetingId: "m", transcriptText: g, framesSidecarText: "", fixtureMode: false }));
    p.catch(() => undefined);
    await flush(() => entered);
    held.gate.revoke(held.runId);
    resolveHold();
    await expect(p, "G3-11g: revoked preflight must reject").rejects.toThrow(GateApprovalError);
    expect(fetchCalls, "G3-11g: fetch after revoke").toBe(0);
    expect(held.gate.receipts(held.runId), "G3-11g: dispatch receipt after revoke").toEqual([]);
    let retryCalls = 0;
    const retry = await approvedGate("approved meeting notes about the renewal");
    const retryClient = new MuseClient({
      fetchImpl: (async () => { retryCalls += 1; return new Response("busy", { status: 503, headers: { "retry-after": "0" } }); }) as typeof fetch,
      maxAttempts: 2,
    });
    const p2 = retry.gate.send(retry.runId, retry.token, (g: GatedText) =>
      retryClient.completeBrief({ meetingId: "m", transcriptText: g, framesSidecarText: "", fixtureMode: false }));
    p2.catch(() => undefined);
    await flush(() => retryCalls === 1 && vi.getTimerCount() > 0);
    retry.gate.revoke(retry.runId);
    await vi.runAllTimersAsync();
    await expect(p2, "G3-11g: revoked retry must reject").rejects.toThrow(GateApprovalError);
    expect(retryCalls, "G3-11g: second fetch after revoke").toBe(1);
  });

  it("G3-12g", { timeout: 180000 }, async () => {
    const r = fakeRepo();
    const hashed = appPy(r, {}, [
      `ds = ${JSON.stringify(join(r, "services", "bot", "fixtures", "dummyx"))}`,
      `out = {"ds": lc.dataset_sha256(ds), "src": lc.packaged_source_sha256(${JSON.stringify(r)}, "dummyx")}`,
    ].join("\n"));
    const cfg = dummyConfig({ sourceSha256: hashed.src, dataset: { id: "dummyx", sha256: hashed.ds }, review: { status: "reviewed", reviewer: "G3b Reviewer", reviewed_at: "2026-10-27", dataset_sha256: hashed.ds }, prompt: { sha256: G3_IDS.prompt }, schema: { sha256: G3_IDS.schema }, scorer: { sha256: G3_IDS.scorer } });
    expect(validateRunConfig(cfg as never), "guard setup: rehearsal config must validate").toEqual([]);
    const frozen = Buffer.from(JSON.stringify(cfg));
    const cfgPath = join(r, "launch-g3b.json");
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const sha = createHash("sha256").update(readFileSync(cfgPath)).digest("hex");
    const tree = makeBotTree(), tmpR = mkdtempSync(join(tmpdir(), "g3b12-results-")), dlDir = mkdtempSync(join(tmpdir(), "g3b12-dl-"));
    const bodiesPath = join(tmpdir(), `g3b12-bodies-${Math.random().toString(36).slice(2)}.log`);
    const shimPath = join(tmpdir(), `g3b12-shim-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(shimPath, shimSource());
    const J = JSON.stringify;
    const out = appPy(r, { G2_FAKE_BODIES: bodiesPath, GLIMMER_LAUNCH_CONFIG: cfgPath, GLIMMER_EVAL_DATASET: "dummyx" }, [FIXED_PRELUDE(tmpR),
      `Tree, Fake, Shim, Dl = ${J(tree)}, "http://127.0.0.1:18001", ${J(shimPath)}, ${J(dlDir)}`,
      "ga._BOT_DIR = Tree",
      "CMDS = []; RUN_CMDS = []; KILLPG = []; KILLED = [False]",
      "_P = types.SimpleNamespace(pid=5150, poll=lambda: None if not KILLED[0] else 0, wait=lambda timeout=None: 0)",
      "_REAL_POPEN = _spmod.Popen",
      "def _popen(cmd, **k): CMDS.append(list(cmd)); return _P",
      "ga.subprocess.Popen = _popen",
      "ga.os.killpg = lambda pid, sig: (KILLPG.append([int(pid), int(sig)]), KILLED.__setitem__(0, True))",
      "lc.wait_ready = lambda *a, **k: {'ready': True, 'remaining_ms': 60000, 'remaining_s': 60}",
      "_REAL_RUN = _spmod.run",
      "def _wrap(cmd, **k):",
      "    _cmd = list(cmd)",
      "    k['env'] = {**(k.get('env', {}) or {}), 'GLIMMER_BASE_URL': Fake, 'G3_FAKE_BODIES': os.environ.get('G2_FAKE_BODIES', ''), 'PATH': os.environ.get('PATH', '')}",
      "    if isinstance(k.get('cwd'), str) and k['cwd'].startswith('/app'): k['cwd'] = Tree",
      "    _ni = [i for i, c in enumerate(_cmd) if c == 'node']",
      "    if _ni: _cmd[_ni[0] + 1:_ni[0] + 1] = ['--import', Shim]",
      "    RUN_CMDS.append(list(_cmd))",
      "    _spmod.Popen = _REAL_POPEN",
      "    try: return _REAL_RUN(_cmd, **k)",
      "    finally: _spmod.Popen = _popen",
      "ga.subprocess.run = _wrap",
      "import pathlib as _pl",
      "try:",
      `    _res = ga.eval_in_container.local('dummyx', ${J(sha)})`,
      "    _run = _pl.Path(TmpR) / (_res.get('run_id') or 'norun')",
      "    _recs = (_run / 'records.jsonl')",
      "    _recs_before = _recs.read_bytes() if _recs.exists() else None",
      `    _done = lc.download_run(lambda rid: sorted([p.relative_to(_pl.Path(TmpR) / rid).as_posix() for p in (_pl.Path(TmpR) / rid).rglob('*') if p.is_file()]), lambda remote: (_pl.Path(TmpR) / remote).read_bytes(), _res['run_id'], Dl) if _res.get('eval_returncode') == 0 else []`,
      "    _after = _recs.read_bytes() if _recs.exists() else None",
      "    out = {'threw': None, 'res': _res, 'cmds': CMDS, 'killpg': KILLPG, 'runs': RUN_CMDS, 'done': sorted(_done), 'recs_same': _after == _recs_before and _recs_before is not None}",
      "except Exception as _e:",
      "    out = {'threw': f'{type(_e).__name__}: {_e}', 'cmds': CMDS, 'killpg': KILLPG, 'runs': RUN_CMDS}",
    ].join("\n"));
    expect(out.threw, `rehearsal: eval_in_container.local threw ${out.threw}`).toBe(null);
    const res = out.res;
    expect(res.eval_returncode, `rehearsal: eval failed rc=${res.eval_returncode} stderr-head=${String(res.eval_stderr ?? "").slice(0, 1500)}`).toBe(0);
    const vllm: string[] = out.cmds[0];
    expect(vllm[vllm.indexOf("--revision") + 1], "rehearsal: vLLM --revision != config revision").toBe(REV);
    expect(vllm[vllm.indexOf("--max-model-len") + 1], "rehearsal: --max-model-len != config context default").toBe("16384");
    expect(out.runs.length, "rehearsal: no eval subprocess ran").toBe(1);
    const bodies = readFileSync(bodiesPath, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
    expect(bodies.length, "rehearsal: no fake vLLM requests").toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b.max_tokens, "rehearsal: max_tokens != run config").toBe(256);
      expect(b.temperature, "rehearsal: temperature != run config").toBe(0);
    }
    const runDir = join(tmpR, res.run_id);
    expect(readFileSync(join(runDir, "run-config.json")), "rehearsal: staged run-config.json != frozen bytes").toEqual(frozen);
    expect(JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8")).run_id, "rehearsal: manifest run_id != result run_id").toBe(res.run_id);
    expect(out.killpg.length, "rehearsal: vLLM teardown not executed").toBeGreaterThan(0);
    expect(out.done, "rehearsal: download incomplete").toContain("manifest.json");
    expect(out.recs_same, "rehearsal: replay read mutated records.jsonl").toBe(true);
    const replay = await rescoreRun(join(dlDir));
    expect(replay.status, `rehearsal: downloaded replay status ${replay.status}`).toBe("complete_match");
    expect(replay.output, "rehearsal: replay output differs").toEqual((await rescoreRun(runDir)).output);
    let sparkCalls = 0;
    const content = JSON.stringify({ entries: [] });
    const { gate, runId, token } = await approvedGate("approved meeting notes about the renewal");
    const proof = new MuseClient({ fetchImpl: (async () => { sparkCalls += 1; return sse(content); }) as typeof fetch, ...sparkProofClientOptions(cfg as never) });
    const brief = await gate.send(runId, token, (g: GatedText) =>
      proof.completeBrief({ meetingId: "m", transcriptText: g, framesSidecarText: "", fixtureMode: false }));
    expect(brief.rawText, "rehearsal: spark proof content mismatch").toBe(content);
    expect(sparkCalls, "rehearsal: spark proof fetch count != 1").toBe(1);
    expect(gate.receipts(runId), "rehearsal: spark proof receipt count != 1").toHaveLength(1);
  });
});
