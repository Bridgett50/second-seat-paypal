// Redaction eval: measured recall over labelled PII fixtures, misses listed.
//
// Env:
//   GLIMMER_DEADLINE_MS  global budget in ms from eval start (default: none).
//   GLIMMER_RESULT_JSON   path for the JSON summary (optional).
//   GLIMMER_OUT_DIR       parent dir for the unique run dir (default: ./eval-runs).
//   GLIMMER_RUN_ID        run id (default: timestamp + randomness).
//
// Flags:
//   --cases <name>       fixtures/<name> input set (required, no default).
//                        (--cases-dir is kept as an alias.)
//   --out-dir <dir>      parent dir for the unique run dir.
//   --run-id <id>        run id; an existing <out-dir>/<id> is refused.
//   --run-config <path>  run config JSON (services/bot/src/release/runConfig.ts
//                        shape); validated with validateRunConfig before any
//                        import or fixture work. Worker concurrency, request
//                        deadlines, token/decoding settings, and the proof
//                        retry budget (maxAttempts) come from it instead of the
//                        defaults; the token limit drives the live client via
//                        GLIMMER_MAX_TOKENS.
//   --run-config-sha256 <hex>
//                        sha256 of the --run-config file bytes; must match or
//                        the run exits 2 before any import or fixture work.
//                        --cases must equal runConfig.dataset.id.
//   --dry-run            resolve and print the derived runner/client settings
//                        as a DRYRUN JSON line, then exit 0 without running
//                        the eval or touching the network.
//
// Protocol: case 1 runs first as a scored canary; if it errors, stop and
// exit 2, with explicit not_run records for every remaining case. Remaining
// cases run with concurrency 2 (or modal.concurrency from --run-config when
// given), each request timeout =
// min(requestMs, remaining budget) where requestMs is timeouts.requestMs
// from --run-config or the 90000 default. Cases not started before the
// deadline are "not_run". Recall/wilson95 cover completed ("ok") cases only.
// Exit 0 only if every case completed without execution failure, else 1
// (canary failure exits 2).
//
// Every run writes <out-dir>/<run-id>/{manifest.json,records.jsonl,
// summary.json,report.txt}; the raw-response log lives under the run dir.
// Thin CLI around scripts/redaction-eval-runner.mjs (offline except for the
// injected live redactor, same as before).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliArgs = process.argv.slice(2);
function flagValue(name) {
  const i = cliArgs.indexOf(name);
  return i !== -1 && cliArgs[i + 1] !== undefined ? cliArgs[i + 1] : undefined;
}
// An explicit dataset selection is always required: never default to dev
// fixtures. Fail before importing dist or creating anything.
const __casesVal = flagValue("--cases") ?? flagValue("--cases-dir");
if (__casesVal === undefined || __casesVal === "" || __casesVal.startsWith("--")) {
  console.error("error: --cases <dataset> required");
  process.exit(2);
}

// A provided run config is loaded before any import or fixture work so a
// missing/unparseable file fails fast with a clear error. Its sha256 is
// bound here too: when --run-config-sha256 is given, the file bytes must
// hash to it or the run exits 2 before any import or fixture work.
const runConfigPath = flagValue("--run-config");
const runConfigSha256 = flagValue("--run-config-sha256");
let runConfig = null;
let runConfigBytes = null;
let runConfigBytesSha256 = null;
if (runConfigSha256 !== undefined && runConfigPath === undefined) {
  console.error("error: --run-config-sha256 requires --run-config");
  process.exit(2);
}
if (runConfigPath !== undefined) {
  let raw;
  try {
    raw = readFileSync(runConfigPath);
  } catch (err) {
    console.error(`error: cannot load --run-config ${JSON.stringify(runConfigPath)}: ${err?.message ?? err}`);
    process.exit(2);
  }
  runConfigBytes = raw;
  runConfigBytesSha256 = createHash("sha256").update(raw).digest("hex");
  if (runConfigSha256 !== undefined && runConfigBytesSha256 !== runConfigSha256) {
    console.error(
      `error: --run-config-sha256 mismatch for ${JSON.stringify(runConfigPath)}: file sha256 ${runConfigBytesSha256} != ${runConfigSha256}`,
    );
    process.exit(2);
  }
  try {
    runConfig = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    console.error(`error: cannot load --run-config ${JSON.stringify(runConfigPath)}: ${err?.message ?? err}`);
    process.exit(2);
  }
}

// The frozen run config is validated (services/bot/src/release/runConfig.ts
// shape) before any import or fixture work, so an invalid config fails fast
// naming the offending keys. The schema module is pure: no side effects, no
// network.
let runnerSettings = null;
let clientOptions = null;
let runRevision = null;
let runtimeIds = null;
if (runConfig !== null) {
  const { validateRunConfig, toRunnerSettings, sparkProofClientOptions } = await import(
    "../dist/src/release/runConfig.js"
  );
  const errors = validateRunConfig(runConfig);
  if (errors.length > 0) {
    console.error(`error: invalid --run-config ${JSON.stringify(runConfigPath)}: ${errors.join("; ")}`);
    process.exit(2);
  }
  runnerSettings = toRunnerSettings(runConfig);
  clientOptions = sparkProofClientOptions(runConfig);
  runRevision = runConfig?.model?.revision ?? null;
  // The frozen token/decoding limits drive the live client, which reads
  // GLIMMER_MAX_TOKENS / GLIMMER_TEMPERATURE / GLIMMER_SEED /
  // GLIMMER_REASONING / GLIMMER_CONTEXT_TOKENS per request; the frozen
  // config is authoritative.
  process.env["GLIMMER_MAX_TOKENS"] = String(runnerSettings.maxTokens);
  process.env["GLIMMER_TEMPERATURE"] = String(runnerSettings.decoding.temperature);
  process.env["GLIMMER_SEED"] = String(runnerSettings.decoding.seed);
  process.env["GLIMMER_REASONING"] = String(runnerSettings.decoding.reasoning);
  process.env["GLIMMER_CONTEXT_TOKENS"] = String(runnerSettings.contextTokens);
  // The eval dataset is bound to the frozen config: --cases must name the
  // configured dataset id.
  const configuredDataset = runConfig?.dataset?.id;
  if (__casesVal !== configuredDataset) {
    console.error(`error: --cases ${JSON.stringify(__casesVal)} != run config dataset.id ${JSON.stringify(configuredDataset)}`);
    process.exit(2);
  }
}

// With --run-config, the frozen prompt/schema/scorer identities are compared
// against the runtime before any fixture read or redactor construction: a
// changed inline prompt, response schema, or scorer refuses with exit 2
// until it is explicitly re-frozen.
if (runConfig !== null) {
  const { runtimeIdentities } = await import("./frozen-identities.mjs");
  runtimeIds = await runtimeIdentities();
  const frozen = {
    prompt: runConfig?.prompt?.sha256,
    schema: runConfig?.schema?.sha256,
    scorer: runConfig?.scorer?.sha256,
  };
  for (const name of ["prompt", "schema", "scorer"]) {
    if (frozen[name] !== runtimeIds[name]) {
      console.error(`error: frozen identity mismatch: ${name} (re-freeze required)`);
      process.exit(2);
    }
  }
}

// --dry-run: report the resolved runner/client settings derived from the
// frozen run config (or defaults when none was given) without importing the
// redactor, reading fixtures, or touching the network.
if (cliArgs.includes("--dry-run")) {
  console.log(
    "DRYRUN " +
      JSON.stringify({
        dryRun: true,
        runConfig: runConfigPath ?? null,
        configSha256: runConfigBytesSha256,
        concurrency: runnerSettings?.concurrency ?? 2,
        runner: runnerSettings,
        clientOptions,
        revision: runRevision,
        identities: runtimeIds,
      }),
  );
  process.exit(0);
}

const { runEval, concurrencyFromRunConfig } = await import("./redaction-eval-runner.mjs");
const { liveRedactor } = await import("../dist/src/private/redact.js");
const casesDir = __casesVal;
if (casesDir.includes("/") || casesDir.includes("\\") || casesDir.includes("..")) {
  console.error(`refusing cases dir outside fixtures/: ${JSON.stringify(casesDir)}`);
  process.exit(2);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", casesDir);
const cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));

const budgetRaw = process.env["GLIMMER_DEADLINE_MS"] ?? "";
const budgetMs = Number.parseInt(budgetRaw, 10);

const outDir = flagValue("--out-dir") ?? process.env["GLIMMER_OUT_DIR"] ?? "eval-runs";
const runId = flagValue("--run-id") ?? process.env["GLIMMER_RUN_ID"] ?? undefined;

const first = liveRedactor();
console.log(`redactor: ${first.label}`);
if (runnerSettings !== null && clientOptions !== null) {
  console.log(
    `client: maxAttempts=${clientOptions.maxAttempts} maxTokens=${runnerSettings.maxTokens} ` +
      `requestMs=${runnerSettings.requestMs} decoding=${JSON.stringify(runnerSettings.decoding)}`,
  );
}

// The frozen timeouts reach the runner: requestMs comes from the run config,
// and the deadline is the tighter of GLIMMER_DEADLINE_MS (when positive)
// and the frozen timeouts.workDeadlineS. Without a config, both keep their
// historical defaults.
const envBudgetMs = Number.isInteger(budgetMs) && budgetMs > 0 ? budgetMs : undefined;
const result = await runEval({
  cases,
  readText: async (c) => readFileSync(join(dir, c.file), "utf8"),
  makeRedactor: () => liveRedactor(),
  ...(runConfig === null
    ? { deadlineMs: envBudgetMs }
    : {
        requestMs: runnerSettings.requestMs,
        deadlineMs: envBudgetMs !== undefined ? Math.min(envBudgetMs, runnerSettings.deadlineMs) : runnerSettings.deadlineMs,
      }),
  concurrency: runConfig === null ? 2 : concurrencyFromRunConfig(runConfig),
  ...(runId !== undefined ? { runId } : {}),
  outDir,
  // Durable config evidence: the exact frozen bytes the eval consumed,
  // written into the run dir right after manifest.json.
  ...(runConfigBytes !== null ? { evidenceFiles: { "run-config.json": runConfigBytes } } : {}),
});

console.log(result.report);
console.log(`run: ${result.runDir}`);

// Bind the run to the frozen config it consumed: the run dir carries the
// config identity file, and the JSON summary names the config sha too.
if (runConfig !== null) {
  writeFileSync(
    join(result.runDir, "run-config-identity.json"),
    JSON.stringify(
      {
        configSha256: runConfigBytesSha256,
        datasetId: runConfig?.dataset?.id ?? null,
        modelRevision: runConfig?.model?.revision ?? null,
        imageRef: runConfig?.image?.ref ?? null,
      },
      null,
      2,
    ),
  );
  result.output = { ...result.output, runConfigSha256: runConfigBytesSha256 };
}

const out = process.env["GLIMMER_RESULT_JSON"] ?? "";
if (out !== "") {
  writeFileSync(out, JSON.stringify(result.output, null, 2));
  console.log(`summary: ${out}`);
}
process.exit(result.canaryFailed ? 2 : result.complete ? 0 : 1);
