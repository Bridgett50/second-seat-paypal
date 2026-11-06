/**
 * Persuasion Shield report (Phase 04b). Dev/public fixtures only.
 * No model calls. A held-out split is refused before any file is opened.
 *
 *   node eval/shield-report.mjs [--split dev]
 *   node eval/shield-report.mjs --split heldout   # exits 2, reads nothing
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toNodeImportSpecifier } from "../services/bot/test/support/import-url.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const core = await import(
  toNodeImportSpecifier(join(here, "..", "packages", "core", "dist", "src", "index.js"))
);
const { detectPressurePatterns, gateApproval } = core;

export const DEV_ROWS = join(here, "shield", "dev-40-55.jsonl");
export const DEV_SPARK = join(here, "shield", "spark-dev.recorded.json");

export function wilson(k, n) {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (center - half) / denom), Math.min(1, (center + half) / denom)];
}

const fmt = (x) => x.toFixed(3);

export function parseArgs(argv) {
  let split = "dev";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--split") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--split needs a value");
      split = value;
      i += 1;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return { split };
}

/** Held-out is a legal split name for a later run. This command does not open it. */
export function resolveSplit(split) {
  if (split === "heldout") {
    return { ok: false, reason: "held-out split is not run by this command" };
  }
  if (split !== "dev") {
    return { ok: false, reason: `unknown split ${split}` };
  }
  if (/heldout|holdout|sealed/i.test(DEV_ROWS) || /heldout|holdout|sealed/i.test(DEV_SPARK)) {
    return { ok: false, reason: "refusing held-out or sealed path" };
  }
  return { ok: true, split: "dev" };
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

function expectedTactics(row) {
  const raw = row.expectedTactic;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((tactic) => tactic !== undefined && tactic !== null && tactic !== "none");
}

export function loadDev() {
  const rows = readJsonl(DEV_ROWS);
  const recorded = JSON.parse(readFileSync(DEV_SPARK, "utf8"));
  const parsed = JSON.parse(recorded.rawText);
  const labels = Array.isArray(parsed.labels) ? parsed.labels : [];
  return { rows, labels, sparkLive: recorded.recordedFromLiveCall === true };
}

function covers(expected, labels) {
  return expected.length > 0 && expected.every((tactic) => labels.some((label) => label.tactic === tactic));
}

function patternLabels(row, index) {
  return detectPressurePatterns(row.text, `seg-${index}`);
}

export function scoreRows(rows, sparkLabels) {
  const bySeg = new Map();
  rows.forEach((_, index) => bySeg.set(`seg-${index}`, []));
  for (const label of sparkLabels) {
    if (bySeg.has(label.segmentId)) bySeg.get(label.segmentId).push(label);
  }
  const positives = [];
  const negatives = [];
  const approvals = [];
  rows.forEach((row, index) => {
    const expected = expectedTactics(row);
    const patterns = patternLabels(row, index);
    const spark = bySeg.get(`seg-${index}`) ?? [];
    const pattern = covers(expected, patterns);
    const sparkHit = covers(expected, spark);
    const held = row.approval === true && gateApproval(row.text).held === true;
    const real = pattern || sparkHit || held;
    const item = { id: String(row.id), pattern, sparkHit, held, real };
    if (expected.length > 0) positives.push(item);
    else negatives.push({ ...item, patternFlag: patterns.some((label) => label.tactic !== "none") });
    if (row.approval === true) approvals.push(item);
  });
  const layer = (name, caught, n) => {
    const [lo, hi] = wilson(caught, n);
    return { name, caught, n, wilson95: [lo, hi] };
  };
  const patternCaught = positives.filter((row) => row.pattern).length;
  const sparkCaught = positives.filter((row) => row.sparkHit).length;
  const gateCaught = approvals.filter((row) => row.held).length;
  const shieldCaught = positives.filter((row) => row.real).length;
  const mutantCaught = 0;
  return {
    split: "dev",
    layers: [
      layer("pattern", patternCaught, positives.length),
      layer("spark", sparkCaught, positives.length),
      layer("gate", gateCaught, approvals.length),
      layer("shield", shieldCaught, positives.length),
    ],
    falseAlarms: layer(
      "pattern-false-alarm",
      negatives.filter((row) => row.patternFlag).length,
      negatives.length,
    ),
    mutation: {
      shield: shieldCaught,
      mutated: mutantCaught,
      n: positives.length,
      shieldOnly: shieldCaught - mutantCaught,
      note: "analytical all-layers-off baseline; not a measured mutant",
    },
  };
}

export function formatReport(score) {
  const lines = [`split: ${score.split}`];
  for (const layer of score.layers) {
    const [lo, hi] = layer.wilson95;
    lines.push(`${layer.name}: ${layer.caught}/${layer.n} Wilson95 [${fmt(lo)}, ${fmt(hi)}]`);
  }
  const [flo, fhi] = score.falseAlarms.wilson95;
  lines.push(
    `false-alarm pattern on neutral: ${score.falseAlarms.caught}/${score.falseAlarms.n} Wilson95 [${fmt(flo)}, ${fmt(fhi)}]`,
  );
  const mutation = score.mutation;
  lines.push(
    `analytical baseline (all layers off): ${mutation.mutated}/${mutation.n}. ${mutation.note}`,
  );
  return `${lines.join("\n")}\n`;
}

export function reportSplit(split) {
  const resolved = resolveSplit(split);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, report: "" };
  const { rows, labels } = loadDev();
  return { ok: true, reason: "", report: formatReport(scoreRows(rows, labels)) };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`shield-report: ${err instanceof Error ? err.message : "bad arguments"}\n`);
    process.exit(2);
  }
  const result = reportSplit(args.split);
  if (!result.ok) {
    process.stderr.write(`shield-report: ${result.reason}\n`);
    process.exit(2);
  }
  process.stdout.write(result.report);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
