// E2: the frozen run config is consumed by the launcher (review D4-3,
// D4-4, D4-6, F7). The eval command must thread --run-config, the vLLM argv
// must derive --max-model-len/--revision from the run config (not hardcoded
// values or import-time state), and redaction-eval.mjs must validate the run
// config and apply its runner/client settings (maxTokens, maxAttempts).
//
// Isolation: the Python checks spawn `python3 -c` importing ONLY
// infra/modal/launch_contract.py (stdlib only; never modal/glimmer_app, never
// any network). The CLI checks use a --dry-run style path with no network:
// GLIMMER_* env is stripped so even a live redactor cannot be constructed.
// Invented data only.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G3a3: --run-config now refuses placeholder prompt/schema/scorer identities;
// use the frozen runtime identities (same helper as g2-composition.test.ts).
// @ts-expect-error untyped helper module
const { runtimeIdentities: e2RuntimeIdentities } = await import("../scripts/frozen-identities.mjs");
const E2_IDS = (await e2RuntimeIdentities()) as { prompt: string; schema: string; scorer: string };

const here = dirname(fileURLToPath(import.meta.url));
const botDir = join(here, "..");
const repoRoot = join(here, "..", "..", "..");
const launchContractDir = join(repoRoot, "infra", "modal");
const evalScript = join(botDir, "scripts", "redaction-eval.mjs");
const appPath = join(repoRoot, "infra", "modal", "glimmer_app.py");

// Nondefault invented run-config values (hex/ids are dummy placeholders).
const REV_E2 = "deadbeef".repeat(5); // invented 40-hex model revision
const MAX_TOKENS_E2 = 512;
// G3a2: --max-model-len is the frozen whole-context budget, not the output limit.
const CONTEXT_TOKENS_E2 = 4096;
const DATASET_SHA_E2 = "a".repeat(64);

// Minimal clean env for subprocesses: PATH only, so no Glimmer endpoint,
// credentials, or state can leak in (and no network is possible).
function cleanEnv(): Record<string, string> {
  return { PATH: process.env["PATH"] ?? "" };
}

// Full dummy run config in services/bot/src/release/runConfig.ts shape.
function e2RunConfig(): Record<string, unknown> {
  return {
    sourceSha: "b".repeat(40),
    dataset: { id: "dummyx", sha256: DATASET_SHA_E2 },
    model: { name: "meta-models/Muse-Glimmer-30B", revision: REV_E2 },
    image: {
      ref: `registry.example/vllm-openai@sha256:${"c".repeat(64)}`,
      digest: `sha256:${"c".repeat(64)}`,
    },
    prompt: { sha256: E2_IDS.prompt },
    schema: { sha256: E2_IDS.schema },
    scorer: { sha256: E2_IDS.scorer },
    decoding: { temperature: 0, seed: 42, reasoning: "low" },
    tokenLimits: { maxTokens: MAX_TOKENS_E2, contextTokens: CONTEXT_TOKENS_E2 },
    timeouts: { requestMs: 60000, workDeadlineS: 700, functionTimeoutS: 840 },
    retry: { maxAttempts: 1 },
    modal: {
      allocations: 1,
      concurrency: 2,
      maxConcurrency: 4,
      scoredCanary: true,
      teardown: true,
      evidenceDownload: "complete",
    },
    review: {
      status: "reviewed",
      reviewer: "Uma Example",
      reviewed_at: "2026-10-27",
      dataset_sha256: DATASET_SHA_E2,
    },
    glimmerDemoRequests: 0,
    budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 },
  };
}

function writeConfig(cfg: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "e2-")), "run-config.json");
  writeFileSync(p, JSON.stringify(cfg));
  return p;
}

// Run python against ONLY launch_contract (stdlib-only module). The program
// must print one `E2OUT <json>` line and exit 0; a null payload means the
// helper under test is absent (failing assertion, not an import error).
function launchContract(prog: string) {
  const prelude = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(launchContractDir)})`,
    "import launch_contract as lc",
  ].join("\n");
  const res = spawnSync("python3", ["-c", `${prelude}\n${prog}`], {
    encoding: "utf8",
    env: cleanEnv(),
  });
  expect(res.status).toBe(0);
  const line = res.stdout.split("\n").find((l) => l.startsWith("E2OUT "));
  expect(line).toBeDefined();
  return JSON.parse(line!.slice(6)) as { cmd: string[] | null; argv: string[] | null };
}

describe("E2 frozen run config reaches the launcher", () => {
  it("E2-1: eval command threads --run-config <path> and --run-config-sha256 <hex>", () => {
    const cfgPath = join(mkdtempSync(join(tmpdir(), "e2-")), "run-config.json");
    const cfgSha = "ab".repeat(32);
    const out = launchContract(
      [
        `cfg_path = ${JSON.stringify(cfgPath)}`,
        `cfg_sha = ${JSON.stringify(cfgSha)}`,
        "try:",
        '    cmd = lc.eval_command("dummyx", "/results", "run-e2-1", cfg_path, cfg_sha)',
        "except TypeError:",
        "    cmd = None",
        'print("E2OUT " + json.dumps({"cmd": cmd, "argv": None}))',
      ].join("\n"),
    );
    expect(out.cmd).toEqual([
      "node",
      "scripts/redaction-eval.mjs",
      "--cases",
      "dummyx",
      "--out-dir",
      "/results",
      "--run-id",
      "run-e2-1",
      "--run-config",
      cfgPath,
      "--run-config-sha256",
      cfgSha,
    ]);
  });

  it("E2-2: vLLM argv derives --max-model-len/--revision from the run config", () => {
    const out = launchContract(
      [
        `cfg = json.loads(${JSON.stringify(JSON.stringify(e2RunConfig()))})`,
        "fn = getattr(lc, 'vllm_argv', None)",
        "argv = list(fn(cfg)) if callable(fn) else None",
        'print("E2OUT " + json.dumps({"cmd": None, "argv": argv}))',
      ].join("\n"),
    );
    expect(out.argv).not.toBe(null);
    const argv = out.argv as string[];
    expect(argv.slice(0, 3)).toEqual(["vllm", "serve", "meta-models/Muse-Glimmer-30B"]);
    const rev = argv.indexOf("--revision");
    expect(rev).toBeGreaterThan(-1);
    expect(argv[rev + 1]).toBe(REV_E2);
    const mml = argv.indexOf("--max-model-len");
    expect(mml).toBeGreaterThan(-1);
    expect(argv[mml + 1]).toBe(String(CONTEXT_TOKENS_E2));
  });

  it("E2-3: redaction-eval --dry-run reports derived runner/client settings", () => {
    const cfgPath = writeConfig(e2RunConfig());
    const res = spawnSync(
      process.execPath,
      [evalScript, "--cases", "dummyx", "--run-config", cfgPath, "--dry-run"],
      { encoding: "utf8", env: cleanEnv() },
    );
    expect(res.status).toBe(0);
    const line = res.stdout.split("\n").find((l) => l.startsWith("DRYRUN "));
    expect(line).toBeDefined();
    const dry = JSON.parse(line!.slice("DRYRUN ".length)) as {
      runner: { maxTokens: number; maxAttempts: number; concurrency: number };
      clientOptions: { maxAttempts: number };
      revision: string;
    };
    expect(dry.runner.maxTokens).toBe(MAX_TOKENS_E2);
    expect(dry.runner.maxAttempts).toBe(1);
    expect(dry.clientOptions).toEqual({ maxAttempts: 1 });
    expect(dry.revision).toBe(REV_E2);
  });

  it("E2-4: redaction-eval rejects an invalid run config fast with no redactor", () => {
    const cfg = e2RunConfig();
    (cfg["retry"] as Record<string, unknown>)["maxAttempts"] = 3;
    const cfgPath = writeConfig(cfg);
    const res = spawnSync(
      process.execPath,
      [evalScript, "--cases", "dummyx", "--run-config", cfgPath],
      { encoding: "utf8", env: cleanEnv() },
    );
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/--run-config/);
    expect(res.stderr).toMatch(/maxAttempts|retry/);
    expect(res.stdout).not.toMatch(/redactor:/);
  });

  it("E2-5: launcher builds vLLM argv and eval command from the run config", () => {
    const src = readFileSync(appPath, "utf8");
    expect(src).toMatch(/vllm_argv\(/);
    expect(src).toMatch(/run_config_path/);
    expect(src).not.toMatch(/"16384"/);
    expect(src).not.toMatch(/--max-model-len/);
  });
});
