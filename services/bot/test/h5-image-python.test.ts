// H5: every Modal Function image must have a Python Modal can detect.
// Regression: with a pinned launch image, eval_in_container's image was built
// straight from the registry image, skipping the python symlink and
// .entrypoint([]) the serve image gets, so `modal deploy` failed with "unable
// to determine the version of Python installed in the Image".
// Offline only: inert recording modal stub via sys.modules, invented dummy
// config, temp dirs. No Modal/GPU, no deploy, no network, no sealed paths.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const appPath = join(repoRoot, "infra", "modal", "glimmer_app.py");
const PINNED = `registry.invalid/dummy@sha256:${"7".repeat(64)}`;
const FALLBACK = "vllm/vllm-openai:muse-glimmer";

// Inert stub: each Image records its build-step chain from the registry base;
// every @app.function records the chain of the image it was given.
const STUB = String.raw`
import sys, types, json
REC = {"functions": {}}
class Image:
    def __init__(self, ops=None): self.ops = list(ops or [])
    @staticmethod
    def from_registry(ref, **kw): return Image([["from_registry", ref]])
    def _c(self, op): return Image(self.ops + [op])
    def dockerfile_commands(self, *a, **k):
        cmds = a[0] if a and isinstance(a[0], (list, tuple)) else list(a)
        return self._c(["dockerfile_commands", list(cmds)])
    def entrypoint(self, args, **k): return self._c(["entrypoint", list(args)])
    def run_commands(self, *a, **k): return self._c(["run_commands", list(a)])
    def pip_install(self, *a, **k): return self._c(["pip_install", list(a)])
    def env(self, *a, **k): return self._c(["env"])
    def add_local_dir(self, l, r, **k): return self._c(["add_local_dir", str(r)])
    def add_local_file(self, l, r, **k): return self._c(["add_local_file", str(r)])
class Volume:
    @staticmethod
    def from_name(name, **k): return Volume()
    def commit(self): pass
class Function:
    def __init__(self, f): self.f = f
class App:
    def __init__(self, *a, **k): pass
    def function(self, **kw):
        def deco(f):
            REC["functions"][f.__name__] = kw["image"].ops
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

type Op = [string, ...unknown[]];

function functionImages(env: Record<string, string>): Record<string, Op[]> {
  const prog = [
    STUB,
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("glimmer_app", ${JSON.stringify(appPath)})`,
    "ga = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(ga)",
    "print('H5OUT ' + json.dumps(REC['functions']))",
  ].join("\n");
  const res = spawnSync("python3", ["-c", prog], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
  });
  const line = res.stdout.split("\n").find((l) => l.startsWith("H5OUT "));
  if (!line) throw new Error(`python failed (${res.status}): ${res.stderr.slice(-3000)}`);
  return JSON.parse(line.slice(6));
}

function pinnedConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "h5-cfg-"));
  const cfgPath = join(dir, "run-config.json");
  writeFileSync(
    cfgPath,
    JSON.stringify({
      configVersion: 1,
      dataset: { id: "dev-briefs", sha256: "c".repeat(64) },
      sourceSha: "d".repeat(40),
      review: { reviewer: "dummy" },
      model: { name: "meta-models/Muse-Glimmer-30B", revision: "ab".repeat(20) },
      image: { ref: PINNED, digest: `sha256:${"7".repeat(64)}` },
      tokenLimits: { maxTokens: 256 },
      timeouts: { requestMs: 10000, workDeadlineS: 523, functionTimeoutS: 611 },
    }),
  );
  return cfgPath;
}

// Modal detects Python by running `python` in the image with no entrypoint:
// the chain must start from the registry base, symlink python, and clear the
// entrypoint before any further build step.
function expectDetectablePython(fn: string, ops: Op[], base: string): void {
  expect(ops[0], fn).toEqual(["from_registry", base]);
  expect(ops.filter((op) => op[0] === "from_registry"), `${fn}: single registry base`).toHaveLength(1);
  const linkAt = ops.findIndex(
    (op) =>
      op[0] === "dockerfile_commands" &&
      (op[1] as string[]).some((c) => /ln -sf .*python3.* \/usr\/local\/bin\/python/.test(c)),
  );
  const entryAt = ops.findIndex((op) => op[0] === "entrypoint" && (op[1] as unknown[]).length === 0);
  expect(linkAt, `${fn}: python symlink step`).toBe(1);
  expect(entryAt, `${fn}: .entrypoint([]) step`).toBe(2);
}

const FUNCTIONS = ["serve", "eval_in_container"];

describe("H5: every Modal Function image has a detectable Python", () => {
  it("H5-1 pinned launch image: serve and eval_in_container both get the python symlink and empty entrypoint", () => {
    const fns = functionImages({ GLIMMER_LAUNCH_CONFIG: pinnedConfig() });
    expect(Object.keys(fns).sort()).toEqual([...FUNCTIONS].sort());
    for (const fn of FUNCTIONS) expectDetectablePython(fn, fns[fn]!, PINNED);
  });

  it("H5-2 pinned launch image with a baked eval dataset: same python setup", () => {
    const fns = functionImages({ GLIMMER_LAUNCH_CONFIG: pinnedConfig(), GLIMMER_EVAL_DATASET: "dev-briefs" });
    for (const fn of FUNCTIONS) expectDetectablePython(fn, fns[fn]!, PINNED);
  });

  it("H5-3 no launch config (fallback image): same python setup", () => {
    const fns = functionImages({});
    for (const fn of FUNCTIONS) expectDetectablePython(fn, fns[fn]!, FALLBACK);
  });
});
