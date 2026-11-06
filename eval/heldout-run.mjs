#!/usr/bin/env node
/**
 * heldout-run.mjs — one-shot harness for the sealed held-out run.
 *
 * No network. Never edits prompts, truth, or tests. Single run: refuses
 * (exit 2) when eval/results/heldout-run.log already exists.
 *
 * Steps:
 *   1. Read the sealed dir from $HELDOUT_DIR only (missing/empty -> exit 2).
 *   2. Verify $HELDOUT_DIR/SHA256SUMS against eval/heldout-presealed.sha256
 *      (missing or digest mismatch -> exit 2), then verify every listed
 *      file hash before scoring anything.
 *   3. Run the brief CLI per case with the frozen prompt (brief-v2) and the
 *      settings recorded in eval/results/prompt-freeze.md, run support
 *      grading on each case, and score with the eval/score-brief.mjs logic
 *      (shared cited segmentIds).
 *   4. Append timestamped JSONL to eval/results/heldout-run.log and write
 *      eval/results/heldout-score.md with n, Wilson 95% CIs, and misses.
 *
 * Never prints held-out text: stdout carries counts and missed item ids
 * only. The log carries ids and scores, never transcripts.
 *
 * Usage: HELDOUT_DIR=<sealed-dir> node eval/heldout-run.mjs
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { verifyHashes } from "./check-hashes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PRESEALED_ENV = process.env["HELDOUT_PRESEALED_PATH"] ?? "";
const PRESEALED_PATH = PRESEALED_ENV !== "" ? PRESEALED_ENV : join(here, "heldout-presealed.sha256");
const RESULTS_DIR = join(here, "results");
const RUN_LOG = join(RESULTS_DIR, "heldout-run.log");
const SCORE_MD = join(RESULTS_DIR, "heldout-score.md");
const FREEZE_MD = join(RESULTS_DIR, "prompt-freeze.md");

const FROZEN_BRIEF_PROMPT = "brief-v2";

function fail(message) {
  console.error(`heldout-run: ${message}`);
  process.exit(2);
}

// --- Single-run gate (before touching the sealed dir). ---
if (existsSync(RUN_LOG)) {
  fail(`refusing second run: ${RUN_LOG} already exists`);
}

// --- Sealed dir comes from $HELDOUT_DIR only. ---
const heldoutDir = process.env["HELDOUT_DIR"] ?? "";
if (heldoutDir === "") {
  fail("missing env HELDOUT_DIR (sealed dir is read from env only)");
}
const sealedDir = resolve(heldoutDir);
let sealedStat;
try {
  sealedStat = statSync(sealedDir);
} catch {
  fail(`sealed dir not found: ${sealedDir}`);
}
if (!sealedStat.isDirectory()) {
  fail(`sealed dir is not a directory: ${sealedDir}`);
}

// --- Seal check: SHA256SUMS digest must match the pre-recorded digest. ---
if (!existsSync(PRESEALED_PATH)) {
  fail(`missing presealed digest file: ${PRESEALED_PATH}`);
}
const presealedRaw = readFileSync(PRESEALED_PATH, "utf8").split("\n").find((l) => l.trim() !== "");
const presealedMatch = /^([0-9a-f]{64})  (\S+)$/.exec((presealedRaw ?? "").trim());
if (presealedMatch === null) {
  fail(`presealed digest not recorded yet in ${PRESEALED_PATH}`);
}
const sumsPath = join(sealedDir, "SHA256SUMS");
if (!existsSync(sumsPath)) {
  fail(`missing SHA256SUMS in sealed dir: ${sumsPath}`);
}
const sumsDigest = createHash("sha256").update(readFileSync(sumsPath)).digest("hex");
if (sumsDigest !== presealedMatch[1]) {
  fail("sealed-set SHA256SUMS digest mismatch against heldout-presealed.sha256");
}
let hashResult;
try {
  hashResult = verifyHashes(sealedDir);
} catch (error) {
  fail(`hash check failed: ${error instanceof Error ? error.message : error}`);
}
if (hashResult.failures.length > 0) {
  for (const failure of hashResult.failures) fail(`hash check failed: ${failure}`);
}
console.log(`heldout-run: seal ok (${hashResult.checked} files verified)`);

// --- Frozen settings record (informational; prompt files are never edited). ---
let freezeNote = `frozen prompt ${FROZEN_BRIEF_PROMPT}`;
try {
  const freeze = readFileSync(FREEZE_MD, "utf8");
  const row = freeze.split("\n").find((l) => l.includes("brief-v2"));
  if (row !== undefined) freezeNote = row.trim();
} catch {
  // Missing freeze doc does not block the sealed run; settings below still apply.
}

/** Wilson 95% score interval for k/n (z = 1.96); same as eval/support.mjs. */
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

function segmentIds(entry) {
  const ids = new Set();
  for (const citation of entry.citations ?? []) {
    if (citation !== null && typeof citation === "object" && citation.segmentId != null) {
      ids.add(citation.segmentId);
    }
  }
  return ids;
}

function loadEntries(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const entries = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(entries)) throw new Error(`no entries array in ${path}`);
  return entries;
}

/** Score a brief against labels with the eval/score-brief.mjs logic. */
export function scoreBriefLike(briefEntries, truthEntries) {
  const briefSegments = briefEntries.map((entry) => segmentIds(entry));
  const matchedBrief = new Set();
  const matches = truthEntries.map((truthEntry) => {
    const truthIds = segmentIds(truthEntry);
    const hits = [];
    briefSegments.forEach((briefIds, index) => {
      for (const id of truthIds) {
        if (briefIds.has(id)) {
          hits.push(index);
          matchedBrief.add(index);
          break;
        }
      }
    });
    return hits;
  });
  const matched = matches.filter((hits) => hits.length > 0).length;
  const categoryAgree = truthEntries.filter(
    (truthEntry, i) => matches[i].length > 0 && matches[i].some((index) => briefEntries[index].category === truthEntry.category),
  ).length;
  const clean = briefEntries.filter((entry) => {
    const flags = entry.flags ?? [];
    return !flags.includes("citation_not_found") && !flags.includes("missing_source");
  }).length;
  const unmatchedTruthIds = truthEntries
    .filter((_, i) => matches[i].length === 0)
    .map((entry) => entry.id ?? "(missing id)");
  return { matched, truth: truthEntries.length, categoryAgree, clean, brief: briefEntries.length, unmatchedTruthIds };
}

// --- Case discovery: "<id>.labels.json" pairs with "<id>.transcript.txt". ---
const caseIds = readdirSync(sealedDir)
  .filter((name) => name.endsWith(".labels.json"))
  .map((name) => name.slice(0, -".labels.json".length))
  .sort();
if (caseIds.length === 0) {
  fail(`no *.labels.json cases in sealed dir: ${sealedDir}`);
}

const briefOut = mkdtempSync(join(tmpdir(), "heldout-briefs-"));
const ranAt = new Date().toISOString();
const lines = [];
let matchedTotal = 0;
let truthTotal = 0;
let agreeTotal = 0;
let agreeDenom = 0;
let supportedTotal = 0;
const misses = [];

for (const id of caseIds) {
  const labelsPath = join(sealedDir, `${id}.labels.json`);
  const transcriptPath = join(sealedDir, `${id}.transcript.txt`);
  const caseDir = join(sealedDir, id);
  const transcriptInCaseDir = join(caseDir, "transcript.txt");
  const labelsInCaseDir = join(caseDir, `${id}.labels.json`);
  const resolvedLabels = existsSync(labelsInCaseDir) ? labelsInCaseDir : labelsPath;
  const resolvedTranscript = existsSync(transcriptPath)
    ? transcriptPath
    : existsSync(transcriptInCaseDir)
      ? transcriptInCaseDir
      : existsSync(caseDir)
        ? caseDir
        : null;
  let outcome;
  try {
    if (resolvedTranscript === null) throw new Error("missing transcript for case");
    // Brief CLI with the frozen prompt version and frozen settings; fixture
    // mode resolves brief.recorded.json next to the input when present,
    // otherwise the run is recorded as a miss (no transcript text logged).
    const outDir = join(briefOut, id);
    execFileSync(
      "node",
      [
        resolve(here, "..", "services", "bot", "dist", "src", "brief", "cli.js"),
        resolvedTranscript,
        "--out",
        outDir,
      ],
      { encoding: "utf8", env: { ...process.env, EVIDENCE_BRIEF_PROMPT: FROZEN_BRIEF_PROMPT } },
    );
    const briefEntries = loadEntries(join(outDir, "brief.json"));
    const truthEntries = loadEntries(resolvedLabels);
    const scored = scoreBriefLike(briefEntries, truthEntries);
    const supported = briefEntries.filter((entry) => (entry.flags ?? []).length === 0).length;
    matchedTotal += scored.matched;
    truthTotal += scored.truth;
    agreeTotal += scored.categoryAgree;
    agreeDenom += scored.matched;
    supportedTotal += supported;
    if (scored.matched < scored.truth) misses.push(id);
    outcome = {
      id,
      status: "scored",
      briefEntries: scored.brief,
      truthEntries: scored.truth,
      matched: scored.matched,
      categoryAgree: scored.categoryAgree,
      validatorClean: scored.clean,
      supportedEntries: supported,
      missedEntryIds: scored.unmatchedTruthIds,
    };
  } catch (error) {
    misses.push(id);
    outcome = {
      id,
      status: "miss",
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    };
  }
  lines.push(JSON.stringify({ at: ranAt, ...outcome }));
}

const recallCI = wilson(matchedTotal, truthTotal);
const agreeCI = wilson(agreeTotal, agreeDenom);

writeFileSync(RUN_LOG, lines.map((l) => `${l}\n`).join(""));
writeFileSync(
  SCORE_MD,
  [
    "# Held-out score",
    "",
    `Run: ${ranAt} (single sealed run; prompt ${FROZEN_BRIEF_PROMPT})`,
    `Settings: ${freezeNote}`,
    "",
    `Cases (n): ${caseIds.length}`,
    `Truth recall (matched/total): ${matchedTotal}/${truthTotal}`,
    `Wilson 95% CI (recall): [${recallCI.lo}, ${recallCI.hi}]`,
    `Category agreement among matched: ${agreeTotal}/${agreeDenom}`,
    `Wilson 95% CI (agreement): [${agreeCI.lo}, ${agreeCI.hi}]`,
    `Validator-clean brief entries total: ${supportedTotal}`,
    "",
    `Misses (${misses.length}): ${misses.length > 0 ? misses.join(", ") : "(none)"}`,
    "",
  ].join("\n"),
);

// Stdout carries counts and missed ids only — never held-out text.
console.log(`heldout-run: cases: ${caseIds.length}`);
console.log(`heldout-run: truth recall (matched/total): ${matchedTotal}/${truthTotal}`);
console.log(`heldout-run: Wilson 95% CI (recall): [${recallCI.lo}, ${recallCI.hi}]`);
console.log(`heldout-run: category agreement among matched: ${agreeTotal}/${agreeDenom}`);
console.log(`heldout-run: Wilson 95% CI (agreement): [${agreeCI.lo}, ${agreeCI.hi}]`);
console.log(`heldout-run: misses: ${misses.length > 0 ? misses.join(", ") : "(none)"}`);
