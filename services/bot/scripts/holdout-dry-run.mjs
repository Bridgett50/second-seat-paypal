// CPU-only dry run over an explicit dataset dir: exercises the real runEval +
// rescoreRun paths with a local fake redactor. Offline: installs a throwing
// global fetch guard and asserts it is never called. Writes only into a temp
// dir. Never runs Modal, never calls a model.
//
// Usage: node scripts/holdout-dry-run.mjs --dir <dataset-dir> [--mode success|canary-fail|interrupted|all]
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { annotateOccurrences } from "./redaction-eval-lib.mjs";
import { caseEntities, runEval } from "./redaction-eval-runner.mjs";
import { rescoreRun } from "./rescore-glimmer-run.mjs";

export function loadDataset(datasetDir) {
  const cases = JSON.parse(readFileSync(join(datasetDir, "cases.json"), "utf8"));
  const texts = new Map(
    cases.map((c) => [c.file, readFileSync(join(datasetDir, c.file), "utf8")]),
  );
  const readText = async (c) => texts.get(c.file);
  return { cases, texts, readText };
}

// Network guard: any fetch attempt throws and is counted.
let fetchCount = 0;
globalThis.fetch = async () => {
  fetchCount += 1;
  throw new Error("holdout-dry-run: network forbidden (fetch called)");
};
export function fetchCalls() {
  return fetchCount;
}

// Fake redactor: masks every annotated occurrence, never touches the network.
function maskAll(text, c) {
  const spans = annotateOccurrences(text, caseEntities(c));
  let maskedText = text;
  const needles = [...new Set(caseEntities(c))].sort((a, b) => b.length - a.length);
  for (const needle of needles) {
    if (needle.length > 0) maskedText = maskedText.split(needle).join("[REDACTED]");
  }
  return { maskedText, spans };
}

function successRedactorFor(cases, texts) {
  return () => ({
    label: "dry-run-fake",
    timeoutMs: 0,
    async redactText(text) {
      const c = cases.find((k) => texts.get(k.file) === text);
      return maskAll(text, c);
    },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function oneLine(result) {
  const { k, n } = result.summary.recall_end_to_end ?? {};
  return (
    `completion ok=${result.records.filter((r) => r.status === "ok").length}` +
    `/${result.records.length} end_to_end=${k}/${n} complete=${result.summary.complete}`
  );
}

export async function drySuccess(datasetDir, outParent) {
  const { cases, texts, readText } = loadDataset(datasetDir);
  const outDir = mkdtempSync(join(outParent, "dry-success-"));
  const result = await runEval({
    cases,
    readText,
    makeRedactor: successRedactorFor(cases, texts),
    concurrency: 2,
    runId: "dry-success",
    outDir,
  });
  console.log(`[success] ${oneLine(result)} run=${result.runDir}`);
  return result;
}

export async function dryCanaryFail(datasetDir, outParent) {
  const { cases, readText } = loadDataset(datasetDir);
  const outDir = mkdtempSync(join(outParent, "dry-canary-"));
  const result = await runEval({
    cases,
    readText,
    makeRedactor: () => ({
      label: "dry-run-fake-canary-fail",
      timeoutMs: 0,
      async redactText() {
        throw new Error("dry-run canary failure");
      },
    }),
    concurrency: 2,
    runId: "dry-canary-fail",
    outDir,
  });
  console.log(
    `[canary-fail] canaryFailed=${result.canaryFailed} ` +
      `not_run=${result.summary.not_run.length} complete=${result.summary.complete} run=${result.runDir}`,
  );
  return result;
}

export async function dryInterrupted(datasetDir, outParent) {
  const { cases, texts, readText } = loadDataset(datasetDir);
  const outDir = mkdtempSync(join(outParent, "dry-interrupted-"));
  // Abort mid-batch: an already-expired budget lets the canary finish but
  // marks every remaining case not_run; then rescore the partial dir offline.
  const result = await runEval({
    cases,
    readText,
    makeRedactor: () => ({
      label: "dry-run-fake-slow",
      timeoutMs: 0,
      async redactText(text) {
        await sleep(25);
        const c = cases.find((k) => texts.get(k.file) === text);
        return maskAll(text, c);
      },
    }),
    concurrency: 2,
    deadlineMs: 1,
    runId: "dry-interrupted",
    outDir,
  });
  const rescore = await rescoreRun(result.runDir, { readText });
  console.log(
    `[interrupted] ${oneLine(result)} rescore_complete=${rescore.complete} ` +
      `rescore_not_run=${rescore.summary.not_run.length} run=${result.runDir}`,
  );
  return { result, rescore };
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith("holdout-dry-run.mjs") &&
  process.argv[1].endsWith("holdout-dry-run.mjs");
if (isMain) {
  const argv = process.argv.slice(2);
  const flagValue = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const datasetDir = flagValue("--dir");
  if (datasetDir === undefined || datasetDir === "") {
    console.error("holdout-dry-run: missing required --dir <dataset-dir>");
    process.exit(2);
  }
  const modeFlag = flagValue("--mode") ?? "all";
  const modes =
    modeFlag === "all" ? ["success", "canary-fail", "interrupted"] : [modeFlag];
  if (modes.some((m) => !["success", "canary-fail", "interrupted"].includes(m))) {
    console.error(`unknown --mode ${JSON.stringify(modeFlag)}`);
    process.exit(2);
  }
  const parent = mkdtempSync(join(tmpdir(), "holdout-dry-"));
  for (const m of modes) {
    if (m === "success") await drySuccess(datasetDir, parent);
    else if (m === "canary-fail") await dryCanaryFail(datasetDir, parent);
    else await dryInterrupted(datasetDir, parent);
  }
  console.log(`fetch calls: ${fetchCalls()} (must be 0)`);
  if (fetchCalls() !== 0) process.exit(1);
}
