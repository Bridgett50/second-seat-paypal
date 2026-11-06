// E8 regressions: launch is bound to the git commit (D4-3, F7 remainder).
// The real infra/modal/glimmer_app.py is exercised against an inert
// SDK-shaped `modal` stub (injected via sys.modules, never the real SDK).
// Dummy datasets in tmp git repos only; no Modal, no network, no models.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const botDir = join(here, "..");
const DIGEST = `registry.example/vllm-openai@sha256:${"b".repeat(64)}`;
const REV = "c".repeat(40);

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

// A throwaway repo that IS a real git checkout: real infra/modal sources
// copied in, dummy bot tree, plus a tracked README.md outside the packaged
// dirs. Everything is committed so HEAD covers the whole tree.
function fakeRepo(): string {
  const r = mkdtempSync(join(tmpdir(), "e8-repo-"));
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
  writeFileSync(join(r, "README.md"), "# dummy repo\n");
  writeFileSync(join(r, ".gitignore"), "__pycache__/\n");
  git(r, "init", "-q");
  git(r, "config", "user.email", "dummy@example.invalid");
  git(r, "config", "user.name", "Dummy");
  git(r, "config", "commit.gpgsign", "false");
  git(r, "add", "-A");
  git(r, "commit", "-qm", "dummy commit");
  return r;
}

function headSha(r: string): string {
  return git(r, "rev-parse", "HEAD");
}

function shaFile(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
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
    "print('E8OUT ' + json.dumps({'out': out, 'rec': REC, 'record': ga._LAST_LAUNCH_RECORD}))",
  ].join("\n");
  const res = spawnSync("python3", ["-c", prog], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
  });
  const line = res.stdout.split("\n").find((l) => l.startsWith("E8OUT "));
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

describe("E8 launch bound to the git commit", () => {
  it("E8-1: clean repo + source_sha == HEAD spawns once", () => {
    const r = fakeRepo();
    const { path } = goodConfig(r);
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path };
    const ok = app(r, env, MAIN("dummyx", path));
    expect(ok.out).toBe(null);
    expect(ok.rec.spawn).toEqual([[[ "dummyx", shaFile(path) ], {}]]);
    expect(ok.record).not.toBe(null);
  });

  it("E8-2: fabricated source_sha (valid hex, not HEAD) is refused", () => {
    const r = fakeRepo();
    const { path } = goodConfig(r, { sourceSha: "a".repeat(40) });
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path };
    const blocked = app(r, env, MAIN("dummyx", path));
    expect(blocked.out).toBe(2);
    expect(blocked.rec.spawn).toEqual([]);
    expect(blocked.record).toBe(null);
  });

  it("E8-3: tracked modification outside the packaged dirs is refused", () => {
    const r = fakeRepo();
    const { path } = goodConfig(r);
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path };
    // README.md is committed but outside the packaged dirs: dirtying it
    // after import must refuse the launch even though the packaged hash
    // still matches.
    const blocked = app(r, env, `
with open(${JSON.stringify(join(r, "README.md"))}, "a", encoding="utf-8") as _fh:
    _fh.write("unreviewed line\\n")
try:
    ga.main(dataset="dummyx", config=${JSON.stringify(path)}); out = None
except SystemExit as e:
    out = e.code
`);
    expect(blocked.out).toBe(2);
    expect(blocked.rec.spawn).toEqual([]);
    expect(blocked.record).toBe(null);
  });

  it("E8-4: untracked file outside the packaged dirs is refused", () => {
    const r = fakeRepo();
    const { path } = goodConfig(r);
    const env = { GLIMMER_EVAL_DATASET: "dummyx", GLIMMER_LAUNCH_CONFIG: path };
    // A new untracked file (not the config) after import must refuse the
    // launch even though the packaged hash still matches.
    const blocked = app(r, env, `
with open(${JSON.stringify(join(r, "NOTES.txt"))}, "w", encoding="utf-8") as _fh:
    _fh.write("scratch\\n")
try:
    ga.main(dataset="dummyx", config=${JSON.stringify(path)}); out = None
except SystemExit as e:
    out = e.code
`);
    expect(blocked.out).toBe(2);
    expect(blocked.rec.spawn).toEqual([]);
    expect(blocked.record).toBe(null);
  });
});
