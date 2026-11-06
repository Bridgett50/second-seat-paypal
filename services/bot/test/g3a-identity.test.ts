// G3a part 3 (criteria G3-6 and G3-7 only). Offline: invented dummy data,
// inert SDK-shaped modal stub via sys.modules (as in g2-composition), fake
// 127.0.0.1 endpoint via a node --import fetch shim. No Modal/GPU, no live
// inference, no real network. No sealed paths. Temp dirs only.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
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
const repoRoot = join(botDir, "..", "..");
const DIGEST = `registry.invalid/dummy@sha256:${"7".repeat(64)}`;
const REV = "9f".repeat(20);
const TEXT = "Call Ana at 555-0100";

// Inert SDK-shaped modal stub. Records @app.function kwargs in REC.
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
    def listdir(self, path, recursive=False): return []
    def read_file(self, path): yield b""
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

// Throwaway git repo with the REAL infra/modal sources and a dummy bot tree.
function fakeRepo(): string {
  const r = mkdtempSync(join(tmpdir(), "g3aid-repo-"));
  mkdirSync(join(r, "infra", "modal"), { recursive: true });
  for (const f of ["glimmer_app.py", "launch_contract.py"])
    copyFileSync(join(repoRoot, "infra", "modal", f), join(r, "infra", "modal", f));
  const bot = join(r, "services", "bot");
  mkdirSync(join(bot, "dist"), { recursive: true });
  mkdirSync(join(bot, "scripts"), { recursive: true });
  writeFileSync(join(bot, "dist", "x.js"), "export const x = 1;\n");
  writeFileSync(join(bot, "scripts", "redaction-eval.mjs"), "// dummy\n");
  writeFileSync(join(bot, "package.json"), "{}\n");
  for (const [name, text] of [["dummyx", TEXT], ["devy", "Mail Bo at 555-0199"]] as const) {
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
    "print('G3AOUT ' + json.dumps({'out': out, 'rec': REC, 'record': ga._LAST_LAUNCH_RECORD, 'blocked': [l for l in _seen if l.startswith('BLOCKED:')]}))",
  ].join("\n");
  const res = spawnSync("python3", ["-c", prog], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
  });
  const line = res.stdout.split("\n").find((l) => l.startsWith("G3AOUT "));
  if (!line) throw new Error(`python failed (${res.status}): ${res.stderr.slice(-3000)}`);
  return JSON.parse(line.slice(7)) as Record<string, any>;
}

// Canonical dummy config with nondefault frozen timeouts 611/523.
function canonicalTimeoutConfig(r: string, modalOver: Record<string, unknown> = {}): { path: string } {
  const res = app(r, {}, [
    `ds = ${JSON.stringify(join(r, "services", "bot", "fixtures", "dummyx"))}`,
    `out = {"ds": lc.dataset_sha256(ds), "src": lc.packaged_source_sha256(${JSON.stringify(r)}, "dummyx")}`,
  ].join("\n"));
  const cfg: Record<string, unknown> = {
    configVersion: 1, sourceSha: git(r, "rev-parse", "HEAD"), sourceSha256: res.out.src,
    dataset: { id: "dummyx", sha256: res.out.ds },
    model: { name: "meta-models/Muse-Glimmer-30B", revision: REV },
    image: { ref: DIGEST, digest: `sha256:${"7".repeat(64)}` },
    prompt: { sha256: "c".repeat(64) }, schema: { sha256: "d".repeat(64) }, scorer: { sha256: "f".repeat(64) },
    decoding: { temperature: 0, seed: 1, reasoning: "low" }, tokenLimits: { maxTokens: 256 },
    timeouts: { requestMs: 10000, workDeadlineS: 523, functionTimeoutS: 611 }, retry: { maxAttempts: 1 },
    modal: { allocations: 1, concurrency: 1, maxConcurrency: 2, scoredCanary: true, teardown: true, evidenceDownload: "complete", ...modalOver },
    review: { status: "reviewed", reviewer: "G3a Reviewer", reviewed_at: "2026-10-27", dataset_sha256: res.out.ds },
    glimmerDemoRequests: 0, budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 },
  };
  const p = join(r, `g3aid-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(cfg));
  return { path: p };
}

// Temp bot tree: REAL scripts copied, dist COPIED (alterable), node_modules
// symlinked. One invented dummyx case.
function makeBotTree(): string {
  const tree = mkdtempSync(join(tmpdir(), "g3aid-tree-"));
  mkdirSync(join(tree, "scripts"), { recursive: true });
  for (const f of ["redaction-eval.mjs", "redaction-eval-runner.mjs", "redaction-eval-lib.mjs", "frozen-identities.mjs"]) {
    const src = join(botDir, "scripts", f);
    if (existsSync(src)) copyFileSync(src, join(tree, "scripts", f));
  }
  cpSync(join(botDir, "dist"), join(tree, "dist"), { recursive: true });
  symlinkSync(join(botDir, "node_modules"), join(tree, "node_modules"));
  mkdirSync(join(tree, "fixtures", "dummyx"), { recursive: true });
  writeFileSync(join(tree, "fixtures", "dummyx", "dummyx-01.txt"), TEXT);
  writeFileSync(join(tree, "fixtures", "dummyx", "cases.json"), JSON.stringify([{ file: "dummyx-01.txt", entities: ["Ana"] }]));
  return tree;
}

// Fake 127.0.0.1 endpoint via a node --import fetch shim (bind() is blocked).
function startFakeEndpoint(): { url: string; shimPath: string; countPath: string; requests: () => number } {
  const dir = mkdtempSync(join(tmpdir(), "g3aid-fake-"));
  const countPath = join(dir, "requests.log");
  const shimPath = join(dir, "fake-shim.mjs");
  writeFileSync(shimPath, String.raw`
const countPath = process.env["G3AID_FAKE_COUNT"] ?? "";
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (!url.startsWith("http://127.0.0.1:")) throw new Error("g3aid-fake: network blocked for " + url);
  const u = new URL(url);
  if ((init?.method ?? "GET").toUpperCase() === "POST" && u.pathname === "/v1/chat/completions") {
    const { appendFileSync } = await import("node:fs");
    if (countPath !== "") appendFileSync(countPath, "1\n");
    const body = JSON.parse(String(init?.body ?? "{}"));
    const user = (body.messages ?? []).find((m) => m?.role === "user");
    const text = typeof user?.content === "string" ? user.content : "";
    const idx = text.indexOf("Ana");
    const spans = idx >= 0 ? [{ start: idx, end: idx + 3, label: "person" }] : [];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ spans, boxes: [] }) }, finish_reason: "stop" }] }), {
      status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("g3aid-fake: unsupported " + url);
};
`);
  const requests = (): number => {
    try {
      return readFileSync(countPath, "utf8").split("\n").filter((l) => l.trim() !== "").length;
    } catch {
      return 0;
    }
  };
  return { url: "http://127.0.0.1:18011", shimPath, countPath, requests };
}

// Dummy freeze in the temp tree (missing on the parent: the expect below
// fails with the token, never a raw import error).
function frozenIdentities(tree: string): { prompt: string; schema: string; scorer: string } {
  const res = spawnSync(process.execPath, ["scripts/frozen-identities.mjs"], {
    cwd: tree, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" },
  });
  expect(res.status, `identity-unchecked: frozen-identities CLI failed (status=${res.status} stderr=${res.stderr.slice(-1000)}); runtime identities are never compared`).toBe(0);
  const line = res.stdout.split("\n").find((l) => l.trim().startsWith("{"));
  expect(line, "identity-unchecked: frozen-identities CLI printed no JSON; identities are never compared").toBeDefined();
  return JSON.parse(line as string) as { prompt: string; schema: string; scorer: string };
}

function frozenConfig(ids: { prompt: string; schema: string; scorer: string }): string {
  const cfg: Record<string, unknown> = {
    configVersion: 1, sourceSha: "1".repeat(40), sourceSha256: "b".repeat(64),
    dataset: { id: "dummyx", sha256: "a".repeat(64) },
    model: { name: "meta-models/Muse-Glimmer-30B", revision: "9".repeat(40) },
    image: { ref: `registry.invalid/dummy@sha256:${"7".repeat(64)}`, digest: `sha256:${"7".repeat(64)}` },
    prompt: { sha256: ids.prompt }, schema: { sha256: ids.schema }, scorer: { sha256: ids.scorer },
    decoding: { temperature: 0, seed: 1, reasoning: "low" }, tokenLimits: { maxTokens: 256 },
    timeouts: { requestMs: 10000, workDeadlineS: 120, functionTimeoutS: 180 }, retry: { maxAttempts: 1 },
    modal: { allocations: 1, concurrency: 1, maxConcurrency: 2, scoredCanary: true, teardown: true, evidenceDownload: "complete" },
    review: { status: "reviewed", reviewer: "G3a Reviewer", reviewed_at: "2026-10-27", dataset_sha256: "a".repeat(64) },
    glimmerDemoRequests: 0, budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 },
  };
  const p = join(mkdtempSync(join(tmpdir(), "g3aid-cfg-")), "run-config.json");
  writeFileSync(p, JSON.stringify(cfg));
  return p;
}

function runEvalCli(tree: string, cfgPath: string, outParent: string, runId: string, fake: { url: string; shimPath: string; countPath: string }) {
  return spawnSync(process.execPath,
    ["--import", fake.shimPath, "scripts/redaction-eval.mjs", "--cases", "dummyx", "--run-config", cfgPath, "--out-dir", outParent, "--run-id", runId],
    { cwd: tree, encoding: "utf8", timeout: 90000,
      env: { PATH: process.env["PATH"] ?? "", GLIMMER_BASE_URL: fake.url, G3AID_FAKE_COUNT: fake.countPath } });
}

describe("G3a frozen settings reach execution (part 3)", () => {
  it("G3-6", { timeout: 120000 }, async () => {
    const r = fakeRepo();
    const { path } = canonicalTimeoutConfig(r);
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path };
    const imp = app(r, env, "out = REC['fn_kwargs']");
    const timeouts = (imp.out as Array<Record<string, unknown>>).map((k) => k["timeout"]);
    expect(timeouts, `function-settings-ignored: eval_in_container timeout not 611, got ${JSON.stringify(timeouts)}`).toContain(611);
    expect(timeouts, `function-settings-ignored: literal default 840 still staged, got ${JSON.stringify(timeouts)}`).not.toContain(840);
    const captured = app(r, env, [
      "import tempfile",
      "CAP = {}",
      "def _wr(*a, **k):",
      "    CAP.update(k)",
      "    return {'ready': False, 'remaining_ms': 0, 'remaining_s': 0}",
      "lc.wait_ready = _wr",
      "class _P:",
      "    pid = 999999",
      "    def poll(self): return 0",
      "    def wait(self, timeout=None): return 0",
      "ga.subprocess.Popen = lambda *a, **k: _P()",
      "ga.subprocess.run = lambda *a, **k: None",
      "import pathlib",
      "_tmp = tempfile.mkdtemp()",
      "_orig = pathlib.Path",
      "ga.Path = lambda p, *a: _orig(_tmp) / str(p).lstrip('/') if str(p).startswith('/results') else _orig(p, *a)",
      "ga._RESULTS_ROOT = _tmp",
      "_res = ga.eval_in_container.local('dummyx', ga._LAUNCH_CONFIG_SHA256)",
      "out = dict(CAP)",
    ].join("\n"));
    expect(captured.out?.work_budget_s, `function-settings-ignored: wait_ready work_budget_s not 523, got ${JSON.stringify(captured.out)}`).toBe(523);
    const bad = canonicalTimeoutConfig(r, { allocations: 2 });
    const blocked = app(r, { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: bad.path }, [
      "try:",
      `    ga.main(dataset="dummyx", config=${JSON.stringify(bad.path)}); out = None`,
      "except SystemExit as e:",
      "    out = e.code",
    ].join("\n"));
    expect(blocked.out, `function-settings-ignored: modal.allocations=2 launched (spawn=${JSON.stringify(blocked.rec.spawn)})`).toBe(2);
    expect(blocked.rec.spawn, `function-settings-ignored: modal.allocations=2 spawned ${JSON.stringify(blocked.rec.spawn)}`).toEqual([]);
    expect((blocked.blocked as string[]).join(" "),
      `function-settings-ignored: no blocker names the unsupported modal setting, got ${(blocked.blocked as string[]).join(" | ")}`,
    ).toMatch(/unsupported: modal\.allocations/);
  });

  it("G3-7", { timeout: 180000 }, async () => {
    const pristine = makeBotTree();
    const ids = frozenIdentities(pristine);
    const cfgPath = frozenConfig(ids);
    const fake = startFakeEndpoint();
    const outParent = mkdtempSync(join(tmpdir(), "g3aid-out-"));
    const ok = runEvalCli(pristine, cfgPath, outParent, "g3aid-run-0", fake);
    expect(ok.status, `identity-unchecked: unaltered frozen run exited ${ok.status} stderr=${ok.stderr.slice(-2000)}`).toBe(0);
    expect(existsSync(join(outParent, "g3aid-run-0")), "identity-unchecked: unaltered frozen run left no run dir").toBe(true);
    const alterations: Array<[string, (tree: string) => void]> = [
      ["prompt", (tree) => {
        const p = join(tree, "dist", "src", "private", "redact.js");
        const src = readFileSync(p, "utf8");
        expect(src.includes("Call Ana"), "identity-unchecked: prompt probe text missing from dist redact.js").toBe(true);
        writeFileSync(p, src.replace("Call Ana", "Call Zed"));
      }],
      ["scorer", (tree) => {
        const p = join(tree, "scripts", "redaction-eval-lib.mjs");
        writeFileSync(p, `${readFileSync(p, "utf8")}\n// g3aid probe\n`);
      }],
      ["schema", (tree) => {
        const p = join(tree, "dist", "src", "private", "redact.js");
        const src = readFileSync(p, "utf8");
        expect(src.includes("glimmer_redaction"), "identity-unchecked: schema probe text missing from dist redact.js").toBe(true);
        writeFileSync(p, src.replace("glimmer_redaction", "glimmer_redactionX"));
      }],
    ];
    for (const [name, alter] of alterations) {
      const tree = makeBotTree();
      alter(tree);
      const out = mkdtempSync(join(tmpdir(), "g3aid-out-"));
      const runId = `g3aid-run-${name}`;
      const before = fake.requests();
      const child = runEvalCli(tree, cfgPath, out, runId, fake);
      expect(child.status, `identity-unchecked: altered ${name} still ran (status=${child.status} stderr=${child.stderr.slice(-2000)})`).toBe(2);
      expect(child.stderr, `identity-unchecked: altered ${name} names no frozen identity mismatch`).toMatch(/frozen identity mismatch/);
      expect(fake.requests() - before, `identity-unchecked: altered ${name} made fake inference requests`).toBe(0);
      expect(existsSync(join(out, runId)), `identity-unchecked: altered ${name} left a run dir`).toBe(false);
    }
  });
});
