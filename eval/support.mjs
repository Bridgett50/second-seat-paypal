#!/usr/bin/env node
/**
 * Score support-judge outputs against support cases.
 * No model calls, no network. Never reads held-out data: any path
 * containing "heldout" is refused.
 *
 * The judge can only ADD flags: a case counts as "caught" when its grade
 * is not `supported` or a missing_qualifier is set. Controls (unmutated
 * originals) measure the false-alarm rate.
 *
 * Hash gate: verifies eval/truth/SHA256SUMS first and aborts (exit 2)
 * on any mismatch, before reading cases or judgments.
 *
 * Usage: node support.mjs --cases <cases.json> (--judge <judgments.jsonl> | --baseline)
 *        [--truth <truthDir>] [--json <outPath>]
 *   --judge <path>  raw JSONL of judge outputs (proof artifact)
 *   --baseline      judge disabled: grade every case `supported`
 *
 * Exit 0 when every non-control case is caught, every control is clean,
 * and every exact expected grade matches. Exit 1 when the suite FAILS
 * (e.g. judge disabled: mutants pass the code-only checks). Exit 2 on
 * hash mismatch or bad inputs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyHashes } from "./check-hashes.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function refuseHeldout(path) {
  if (path.toLowerCase().includes("heldout")) {
    console.error("refusing to read held-out data");
    process.exit(2);
  }
}

const rawArgs = process.argv.slice(2);
function flag(name) {
  const i = rawArgs.indexOf(name);
  return i === -1 ? null : (rawArgs[i + 1] ?? null);
}
const baseline = rawArgs.includes("--baseline");
const casesPath = flag("--cases") ?? join(here, "fixtures", "support-cases.json");
const judgePath = flag("--judge");
const truthDir = flag("--truth") ?? join(here, "truth");
const jsonOut = flag("--json");
for (const p of [casesPath, judgePath, truthDir, jsonOut]) {
  if (p !== null) refuseHeldout(p);
}

// --- Hash gate: abort before scoring anything. ---
let hashResult;
try {
  hashResult = verifyHashes(truthDir);
} catch (error) {
  console.error(`hash check failed: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}
if (hashResult.failures.length > 0) {
  for (const failure of hashResult.failures) {
    console.error(`hash check failed: ${failure}`);
  }
  process.exit(2);
}
console.log(`hash check ok: ${hashResult.checked} files verified`);

if (!baseline && judgePath === null) {
  console.error("usage: node support.mjs --cases <cases.json> (--judge <judgments.jsonl> | --baseline)");
  process.exit(2);
}

const cases = JSON.parse(readFileSync(casesPath, "utf8")).cases;
if (!Array.isArray(cases) || cases.length === 0) {
  console.error("no cases to score");
  process.exit(2);
}

let verdicts;
if (baseline) {
  verdicts = new Map(cases.map((c) => [c.id, { grade: "supported", missingQualifier: null, overlap: null }]));
} else {
  verdicts = new Map();
  const lines = readFileSync(resolve(judgePath), "utf8").split("\n");
  for (const raw of lines) {
    if (raw.trim() === "") continue;
    const v = JSON.parse(raw);
    verdicts.set(v.entryId, v);
  }
}

function isFlagged(v) {
  return v.grade !== "supported" || v.missingQualifier !== null;
}

/** Wilson 95% score interval for k/n (z = 1.96). */
export function wilson(k, n) {
  if (n === 0) return { lo: 0, hi: 0 };
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + (z * z) / (4 * n * n))) / denom;
  const round = (x) => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000;
  return { lo: round(center - half), hi: round(center + half) };
}

const rows = [];
let exactMismatches = 0;
for (const c of cases) {
  const v = verdicts.get(c.id);
  if (v === undefined) {
    console.error(`missing judge output for case ${c.id}`);
    process.exit(2);
  }
  const flagged = isFlagged(v);
  const gradeMatch = v.grade === c.expected.grade;
  let qualifierMatch = true;
  if (c.expected.missingQualifier !== null) {
    qualifierMatch =
      typeof v.missingQualifier === "string" &&
      v.missingQualifier.toLowerCase().includes(c.expected.missingQualifier.toLowerCase());
  }
  const exact = gradeMatch && qualifierMatch;
  if (c.kind !== "control" && !exact) exactMismatches += 1;
  if (c.kind === "control" && flagged) exactMismatches += 1;
  rows.push({
    id: c.id,
    kind: c.kind,
    mutation: c.mutation ?? null,
    expected: c.expected.grade,
    grade: v.grade,
    missingQualifier: v.missingQualifier,
    overlap: v.overlap ?? null,
    flagged,
    exact,
  });
}

const targets = rows.filter((r) => r.kind !== "control");
const controls = rows.filter((r) => r.kind === "control");
const caught = targets.filter((r) => r.flagged).length;
const falseAlarms = controls.filter((r) => r.flagged).length;
const catchCI = wilson(caught, targets.length);
const faCI = wilson(falseAlarms, controls.length);

const byKind = {};
for (const r of rows) {
  const key = r.kind === "mutant" ? `mutant:${r.mutation}` : r.kind;
  byKind[key] = byKind[key] ?? { n: 0, caught: 0 };
  byKind[key].n += 1;
  if (r.flagged) byKind[key].caught += 1;
}

const table = [
  "| group | n | caught | rate | Wilson 95% CI |",
  "|---|---|---|---|---|",
  `| non-control (fixtures + mutants) | ${targets.length} | ${caught} | ${(caught / targets.length).toFixed(3)} | [${catchCI.lo}, ${catchCI.hi}] |`,
  `| controls (false alarms) | ${controls.length} | ${falseAlarms} | ${(falseAlarms / controls.length).toFixed(3)} | [${faCI.lo}, ${faCI.hi}] |`,
  ...Object.entries(byKind).map(
    ([k, s]) => `| ${k} | ${s.n} | ${s.caught} | ${(s.caught / s.n).toFixed(3)} | |`,
  ),
  ...rows.map(
    (r) =>
      `| case ${r.id} (${r.kind}) | 1 | ${r.flagged ? 1 : 0} | expected ${r.expected}, got ${r.grade}${r.missingQualifier ? ` + mq=${JSON.stringify(r.missingQualifier)}` : ""} | ${r.exact ? "exact" : "MISMATCH"} |`,
  ),
].join("\n");

console.log(`mode: ${baseline ? "baseline (judge disabled)" : "judge outputs"}`);
console.log(`cases: ${rows.length} (${targets.length} non-control, ${controls.length} control)`);
console.log(table);

if (jsonOut !== null) {
  writeFileSync(
    resolve(jsonOut),
    JSON.stringify(
      { mode: baseline ? "baseline" : "judge", catch: { k: caught, n: targets.length, ci: catchCI }, falseAlarm: { k: falseAlarms, n: controls.length, ci: faCI }, rows },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`json written to ${resolve(jsonOut)}`);
}

if (exactMismatches > 0) {
  console.error(`SUPPORT SUITE FAILED: ${exactMismatches} case(s) mismatched`);
  process.exit(1);
}
console.log("SUPPORT SUITE PASSED");
