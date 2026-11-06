/**
 * Resistance table (Phase 08): off / pattern-only / pattern+Spark.
 * Dev/public fixtures only. No model calls.
 *
 * pattern+Spark uses the recorded Spark labels when that file is present.
 * If it is missing, the cell is "pending live run".
 *
 *   node eval/resistance-table.mjs [--split dev]
 *   node eval/resistance-table.mjs --split heldout   # exits 2, reads nothing
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toNodeImportSpecifier } from "../services/bot/test/support/import-url.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const core = await import(
  toNodeImportSpecifier(join(here, "..", "packages", "core", "dist", "src", "index.js"))
);
const { detectPressurePatterns } = core;

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

export function resolveSplit(split) {
  if (split === "heldout") {
    return { ok: false, reason: "held-out split is not run by this command" };
  }
  if (split !== "dev") return { ok: false, reason: `unknown split ${split}` };
  if (/heldout|holdout|sealed/i.test(DEV_ROWS) || /heldout|holdout|sealed/i.test(DEV_SPARK)) {
    return { ok: false, reason: "refusing held-out or sealed path" };
  }
  return { ok: true };
}

function expectedTactics(row) {
  const raw = row.expectedTactic;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((tactic) => tactic !== undefined && tactic !== null && tactic !== "none");
}

function covers(expected, labels) {
  return expected.length > 0 && expected.every((tactic) => labels.some((label) => label.tactic === tactic));
}

export function loadDevSpark() {
  if (!existsSync(DEV_SPARK)) return { labels: null, pending: true };
  const recorded = JSON.parse(readFileSync(DEV_SPARK, "utf8"));
  if (typeof recorded.rawText !== "string") return { labels: null, pending: true };
  const parsed = JSON.parse(recorded.rawText);
  return { labels: Array.isArray(parsed.labels) ? parsed.labels : [], pending: false };
}

export function resistanceTable(rows, sparkLabels) {
  const bySeg = new Map();
  rows.forEach((_, index) => bySeg.set(`seg-${index}`, []));
  if (sparkLabels !== null) {
    for (const label of sparkLabels) {
      if (bySeg.has(label.segmentId)) bySeg.get(label.segmentId).push(label);
    }
  }
  const positives = rows
    .map((row, index) => ({ row, index, expected: expectedTactics(row) }))
    .filter((item) => item.expected.length > 0);
  const n = positives.length;
  let pattern = 0;
  let both = 0;
  for (const item of positives) {
    const patterns = detectPressurePatterns(item.row.text, `seg-${item.index}`);
    const patternHit = covers(item.expected, patterns);
    if (patternHit) pattern += 1;
    const spark = bySeg.get(`seg-${item.index}`) ?? [];
    if (patternHit || covers(item.expected, spark)) both += 1;
  }
  const cell = (name, caught) => {
    const [lo, hi] = wilson(caught, n);
    return { name, caught, n, wilson95: [lo, hi], pending: false };
  };
  return {
    split: "dev",
    columns: [
      cell("off", 0),
      cell("pattern-only", pattern),
      sparkLabels === null
        ? { name: "pattern+Spark", caught: null, n, wilson95: null, pending: true }
        : cell("pattern+Spark", both),
    ],
  };
}

export function formatTable(table) {
  const lines = [
    `split: ${table.split}`,
    "| column | caught | n | Wilson 95% |",
    "|---|---|---|---|",
  ];
  for (const column of table.columns) {
    if (column.pending) {
      lines.push(`| ${column.name} | pending live run | ${column.n} | — |`);
    } else {
      const [lo, hi] = column.wilson95;
      lines.push(`| ${column.name} | ${column.caught} | ${column.n} | [${fmt(lo)}, ${fmt(hi)}] |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function reportSplit(split) {
  const resolved = resolveSplit(split);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, report: "" };
  const rows = readFileSync(DEV_ROWS, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
  const spark = loadDevSpark();
  return { ok: true, reason: "", report: formatTable(resistanceTable(rows, spark.pending ? null : spark.labels)) };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`resistance-table: ${err instanceof Error ? err.message : "bad arguments"}\n`);
    process.exit(2);
  }
  const result = reportSplit(args.split);
  if (!result.ok) {
    process.stderr.write(`resistance-table: ${result.reason}\n`);
    process.exit(2);
  }
  process.stdout.write(result.report);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
