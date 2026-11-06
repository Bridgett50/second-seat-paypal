// H3: the deployed Glimmer container must receive the frozen launch config
// (and launch_contract.py), otherwise serve() starts vLLM with `--revision ''`.
// Offline only: inert SDK-shaped modal stub via sys.modules, invented dummy
// config, temp dirs. No Modal/GPU, no deploy, no network, no sealed paths.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const modalDir = join(repoRoot, "infra", "modal");
const REV = "ab".repeat(20);
const REMOTE_CONFIG = "/root/glimmer-launch-config.json";
const REMOTE_CONTRACT = "/root/launch_contract.py";

// Inert stub: each Image carries the local files added to it, and every
// @app.function records the files of the image it was given.
const STUB = String.raw`
import sys, types, json
REC = {"functions": {}}
class Image:
    def __init__(self, files=None): self.files = list(files or [])
    @staticmethod
    def from_registry(ref, **kw): return Image()
    def _c(self, extra=None): return Image(self.files + ([extra] if extra else []))
    def dockerfile_commands(self, *a, **k): return self._c()
    def entrypoint(self, *a, **k): return self._c()
    def run_commands(self, *a, **k): return self._c()
    def pip_install(self, *a, **k): return self._c()
    def env(self, *a, **k): return self._c()
    def add_local_dir(self, l, r, **k): return self._c()
    def add_local_file(self, l, r, **k): return self._c([str(l), str(r)])
class Volume:
    @staticmethod
    def from_name(name, **k): return Volume()
    def commit(self): pass
class Function:
    def __init__(self, f): self.f = f
    def local(self, *a, **k): return self.f(*a, **k)
class App:
    def __init__(self, *a, **k): pass
    def function(self, **kw):
        def deco(f):
            REC["functions"][f.__name__] = kw["image"].files
            return Function(f)
        return deco
    def local_entrypoint(self, *a, **k): return lambda f: f
def concurrent(**k): return lambda f: f
def web_server(*a, **k): return lambda f: f
modal = types.ModuleType("modal")
for _n, _v in dict(App=App, Image=Image, Volume=Volume, concurrent=concurrent, web_server=web_server).items():
    setattr(modal, _n, _v)
sys.modules["modal"] = modal
`;

function config(): string {
  return JSON.stringify({
    configVersion: 1,
    model: { name: "meta-models/Muse-Glimmer-30B", revision: REV },
    image: { ref: `registry.invalid/dummy@sha256:${"7".repeat(64)}`, digest: `sha256:${"7".repeat(64)}` },
    tokenLimits: { maxTokens: 256 },
    timeouts: { requestMs: 10000, workDeadlineS: 523, functionTimeoutS: 611 },
  });
}

function run(appPath: string, env: Record<string, string>, body: string): any {
  const prog = [
    STUB,
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("glimmer_app", ${JSON.stringify(appPath)})`,
    "ga = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(ga)",
    "out = None",
    body,
    "print('H3OUT ' + json.dumps({'out': out, 'rec': REC}))",
  ].join("\n");
  const res = spawnSync("python3", ["-c", prog], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", ...env } });
  const line = res.stdout.split("\n").find((l) => l.startsWith("H3OUT "));
  if (!line) throw new Error(`python failed (${res.status}): ${res.stderr.slice(-3000)}`);
  return JSON.parse(line.slice(6));
}

// Simulated container root: only what the image ships, laid out like /root.
function containerRoot(withConfig: boolean, bytes: string): string {
  const root = mkdtempSync(join(tmpdir(), "h3-root-"));
  copyFileSync(join(modalDir, "glimmer_app.py"), join(root, "glimmer_app.py"));
  copyFileSync(join(modalDir, "launch_contract.py"), join(root, "launch_contract.py"));
  if (withConfig) writeFileSync(join(root, "glimmer-launch-config.json"), bytes);
  return root;
}

describe("H3: launch config reaches the deployed container", () => {
  it("H3-1 deploy side: serve and eval images ship the config bytes and launch_contract.py", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-cfg-"));
    const cfgPath = join(dir, "run-config.json");
    writeFileSync(cfgPath, config());
    const r = run(join(modalDir, "glimmer_app.py"), { GLIMMER_LAUNCH_CONFIG: cfgPath }, "");
    for (const fn of ["serve", "eval_in_container"]) {
      const files: string[][] = r.rec.functions[fn];
      expect(files, fn).toContainEqual([cfgPath, REMOTE_CONFIG]);
      expect(files, fn).toContainEqual([join(modalDir, "launch_contract.py"), REMOTE_CONTRACT]);
    }
  });

  it("H3-2 container side: with no env var, the baked config drives --revision and the same sha256", () => {
    const bytes = config();
    const root = containerRoot(true, bytes);
    const r = run(join(root, "glimmer_app.py"), {}, [
      "argv = ga.launch_contract.vllm_argv(ga._LAUNCH_CONFIG, host='0.0.0.0', port=8000)",
      "out = {'revision': argv[argv.index('--revision') + 1], 'sha': ga._LAUNCH_CONFIG_SHA256}",
    ].join("\n"));
    expect(r.out.revision).toBe(REV);
    expect(r.out.sha).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("H3-3 serve() refuses to start vLLM without a launch config (no empty --revision)", () => {
    const root = containerRoot(false, "");
    const r = run(join(root, "glimmer_app.py"), {}, [
      "calls = []",
      "ga.subprocess.Popen = lambda cmd, *a, **k: calls.append(cmd)",
      "err = None",
      "try:",
      "    ga.serve.local()",
      "except Exception as e:",
      "    err = str(e)",
      "out = {'calls': calls, 'err': err}",
    ].join("\n"));
    expect(r.out.calls).toEqual([]);
    expect(r.out.err).toMatch(/launch config/i);
  });
});
