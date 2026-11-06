// Re-score the recorded glimmer-run predictions against fixtures/pii inputs.
// Offline only: never contacts a model, never reads held-out data.
//
// CLI usage: node rescore-glimmer-run.mjs --run-dir <existing run dir>
//   (--legacy-glimmer-run [--out <path>] re-scores the historical fixture;
//   --help prints usage and exit codes).
// CLI exit codes: 0 complete_match | 1 integrity_failure | 3 incomplete |
//   4 mismatch | 5 complete_uncompared (complete reconstruction but saved
//   summary.json or report.txt is missing, so there is nothing to compare
//   against) | 2 usage error.
//
// Two entry points:
//
// 1. Legacy CLI (run as a script): rescores fixtures/glimmer-run
//    (eval-summary.json + glimmer-raw.jsonl, which carry NO case ids and are
//    not in case order, so predictions are NEVER paired to cases by best
//    score/coverage — that would be circular). Span coverage / over-redaction
//    are re-scored ONLY for a prediction record carrying a `file` field that
//    matches a planned input file; otherwise they are reported as null with a
//    reason. Writes fixtures/glimmer-run/rescore.json.
// 2. rescoreRun(runDir): offline rescoring for new run dirs written by
//    runEval (<outDir>/<runId>/{manifest.json,records.jsonl}). Recomputes the
//    summary + report from saved records + case files with no redactor and no
//    network. Tolerates interrupted runs (truncated trailing partial line,
//    missing summary.json): missing cases become explicit not_run records and
//    the result reports complete:false with a reason.
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  annotateOccurrences,
  checkRecordIntegrity,
  scoreSpans,
  summarize,
  summarizeWithIntegrity,
} from "./redaction-eval-lib.mjs";
import { annotationSha256, buildOkRecord, caseEntities, formatReport, receiptIntegrityHash, sha256Hex } from "./redaction-eval-runner.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const piiDir = join(here, "..", "fixtures", "pii");
const legacyRunDir = join(here, "..", "fixtures", "glimmer-run");

function rescoreLegacyGlimmerRun(outPath) {
  const cases = JSON.parse(readFileSync(join(piiDir, "cases.json"), "utf8"));
  // Planned batch = the 8 basic cases.
  const plannedInputs = cases.filter((c) => /^basic-\d+\.txt$/.test(c.file));
  if (plannedInputs.length !== 8) {
    console.error(`expected 8 basic cases, found ${plannedInputs.length}`);
    process.exit(2);
  }
  const planned = plannedInputs.map((c) => {
    const text = readFileSync(join(piiDir, c.file), "utf8");
    return { file: c.file, total: c.entities.length, expected: annotateOccurrences(text, c.entities).length };
  });

  const recorded = JSON.parse(readFileSync(join(legacyRunDir, "eval-summary.json"), "utf8"));
  const recordedByFile = new Map((recorded.cases ?? []).map((c) => [c.file, c]));
  const records = planned.map((p) => {
    const r = recordedByFile.get(p.file);
    if (r === undefined) return { file: p.file, hits: 0, total: p.total, status: "not_run" };
    if (r.status === "ok") return { file: p.file, hits: r.hits, total: r.total, status: "ok" };
    if (r.status === "not_run") return { file: p.file, hits: 0, total: p.total, status: "not_run" };
    return { file: p.file, hits: 0, total: p.total, status: "error", error: r.error ?? "unknown error" };
  });

  // Span re-score: only predictions keyed to a case file via a `file` field.
  let keyedPredictions = 0;
  try {
    const raw = readFileSync(join(legacyRunDir, "glimmer-raw.jsonl"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const file = obj?.file;
      if (typeof file !== "string" || !recordedByFile.has(file)) continue;
      const target = records.find((r) => r.file === file);
      if (target === undefined || target.status !== "ok") continue;
      let spans = obj.spans;
      if (!Array.isArray(spans) && typeof obj.content === "string") {
        try {
          const inner = JSON.parse(obj.content);
          if (Array.isArray(inner.spans)) spans = inner.spans;
        } catch {
          /* no keyed spans on this line */
        }
      }
      if (!Array.isArray(spans)) continue;
      const input = plannedInputs.find((c) => c.file === file);
      const text = readFileSync(join(piiDir, file), "utf8");
      const scored = scoreSpans(text, annotateOccurrences(text, input.entities), spans);
      target.span = {
        covered: scored.covered,
        expected: scored.expected,
        piiChars: scored.piiChars,
        piiCharsMasked: scored.piiCharsMasked,
        nonPii: scored.nonPii,
        nonPiiMasked: scored.nonPiiMasked,
      };
      keyedPredictions += 1;
    }
  } catch (err) {
    console.error(`cannot read glimmer-raw.jsonl: ${err?.message ?? err}`);
  }

  const summary = summarize(records, planned);
  const legacy = summary.legacy_entity_disappearance;
  const payload = {
    planned: planned.map((p) => p.file),
    request_completion: summary.request_completion,
    legacy_entity_disappearance: legacy,
    // Deprecated alias of legacy completed recall.
    recall: summary.recall,
    span_coverage: null,
    span_coverage_reason: "predictions not keyed to case files; not re-scorable",
    char_coverage: null,
    over_redaction_rate: null,
    keyed_predictions: keyedPredictions,
    cases: summary.cases.map((c) => ({
      file: c.file,
      hits: c.hits,
      total: c.total,
      status: c.status,
      ...(c.error !== undefined ? { error: c.error } : {}),
    })),
    failures: summary.failures,
    not_run: summary.not_run,
    generatedAt: new Date().toISOString(),
  };

  const out = outPath ?? join(legacyRunDir, "rescore.json");
  writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
  const rc = summary.request_completion;
  console.log(`requests: ${rc.completed}/${rc.planned}`);
  console.log(`legacy completed: ${legacy.completed.k}/${legacy.completed.n}`);
  console.log(`legacy end-to-end: ${legacy.end_to_end.k}/${legacy.end_to_end.n}`);
  console.log(`span_coverage: null (${payload.span_coverage_reason})`);
  console.log(`rescore: ${out}`);
}

function readSavedSummary(runDir) {
  try {
    return JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8"));
  } catch {
    return null;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Offline replay from immutable evidence. Read-only: never writes.
// Recomputes ONLY from manifest.json, inputs/, glimmer-raw.jsonl and
// records.jsonl (record keys/status only; never trust saved hits/spans).
//
// Returns { ok, complete, errors, mismatches, truncated, records, output,
// report, run_id, summary, misses, span_misses, integrity, status } where
// status is one of integrity_failure | incomplete | mismatch |
// complete_match | complete_uncompared. complete_uncompared means a complete
// reconstruction with no saved summary.json/report.txt to compare against.
// A manifest that fails shape validation yields integrity_failure with
// output/summary/report all null (no aggregate metrics are published) and
// no further reads of case inputs, records, receipts, or saved outputs.
const RUN_ID_RE = /^[A-Za-z0-9._-]+$/;
const CASE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

// True when absPath itself or any path component at or below base is a
// symlink (lstat, never follows the final link). Read-only check.
function hasSymlink(absPath, base) {
  let cur = absPath;
  while (typeof cur === "string" && cur.length >= base.length && cur.startsWith(base) && cur !== base) {
    try {
      if (lstatSync(cur).isSymbolicLink()) return true;
    } catch {
      return false;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

function manifestShapeErrors(manifest) {
  const errors = [];
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["invalid manifest: manifest.json must be an object"];
  }
  const runId = manifest.run_id;
  if (typeof runId !== "string" || runId === "" || !RUN_ID_RE.test(runId)) {
    errors.push(
      "invalid manifest: run_id must be a nonempty id matching /^[A-Za-z0-9._-]+$/",
    );
  }
  const planned = manifest.planned;
  if (!Array.isArray(planned)) {
    errors.push("invalid manifest: planned must be an array");
    return errors;
  }
  const seen = new Set();
  const seenNorm = new Set();
  planned.forEach((c, idx) => {
    const where = `planned[${idx}]`;
    if (c === null || typeof c !== "object" || Array.isArray(c)) {
      errors.push(`invalid manifest: ${where} must be an object`);
      return;
    }
    const file = c.file;
    if (typeof file !== "string" || file === "") {
      errors.push(`invalid manifest: ${where} is missing its case id`);
      return;
    }
    let flaw = null;
    if (file.includes("\\")) flaw = "backslash";
    else if (file.startsWith("/")) flaw = "absolute path";
    else if (file.split("/").includes("..")) flaw = '".." segment';
    else if (file.split("/").includes(".")) flaw = '"." segment';
    else if (!file.split("/").every((seg) => CASE_SEGMENT_RE.test(seg))) flaw = "unsafe characters";
    if (flaw !== null) {
      errors.push(`invalid manifest: unsafe case path ${JSON.stringify(file)} (${flaw})`);
      return;
    }
    if (seen.has(file)) {
      errors.push(`invalid manifest: duplicate planned case id ${JSON.stringify(file)}`);
      return;
    }
    let norm = file;
    try {
      norm = posix.normalize(file);
    } catch {
      norm = file;
    }
    if (seenNorm.has(norm)) {
      errors.push(`invalid manifest: duplicate planned case id ${JSON.stringify(file)} (normalizes to ${JSON.stringify(norm)})`);
      return;
    }
    seen.add(file);
    seenNorm.add(norm);
  });
  return errors;
}

async function rescoreStrict(runDir, { parseAnswer } = {}) {
  let manifest = null;
  let manifestReadError = null;
  try {
    manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  } catch (err) {
    manifestReadError = err?.message ?? String(err);
  }
  const shapeErrors =
    manifestReadError !== null
      ? [`invalid manifest: cannot read manifest.json: ${manifestReadError}`]
      : manifestShapeErrors(manifest);
  if (shapeErrors.length > 0) {
    const fallbackId =
      manifest !== null && typeof manifest.run_id === "string" && manifest.run_id !== ""
        ? manifest.run_id
        : basename(runDir);
    const reason = shapeErrors.join("; ");
    return {
      ok: false,
      complete: false,
      errors: shapeErrors,
      mismatches: [],
      truncated: false,
      records: [],
      output: null,
      report: null,
      run_id: fallbackId,
      summary: null,
      misses: [],
      span_misses: [],
      integrity: { ok: false, reason },
      status: "integrity_failure",
    };
  }
  let parse = parseAnswer;
  if (typeof parse !== "function") {
    ({ parseGlimmerAnswer: parse } = await import("../dist/src/private/redact.js"));
  }
  const errors = [];
  // A planned case with no record line stays incomplete, not an integrity
  // failure: these notices surface in errors without flipping ok/status.
  const missingRecordNotices = [];
  const runId = manifest.run_id;
  const plannedCases = manifest.planned;
  const plannedByFile = new Map(plannedCases.map((c) => [c.file, c]));

  // Immutable inputs + annotation hashes.
  const texts = new Map();
  for (const c of plannedCases) {
    const inputPath = join(runDir, "inputs", c.file);
    if (hasSymlink(inputPath, runDir)) {
      errors.push(`symlinked input file ${c.file}: inputs/${c.file} must be a regular file`);
      texts.set(c.file, "");
      continue;
    }
    let text = null;
    try {
      text = readFileSync(inputPath, "utf8");
    } catch (err) {
      errors.push(`missing input file ${c.file}: ${err?.message ?? err}`);
      texts.set(c.file, "");
      continue;
    }
    texts.set(c.file, text);
    if (sha256Hex(text) !== c.input_sha256) {
      errors.push(`input hash mismatch for ${c.file}: inputs/${c.file} does not match manifest input_sha256`);
    }
    const expectedAnnot = annotationSha256({ entities: c.entities, names: c.names, extra_entities: c.extra_entities });
    if (typeof c.annotation_sha256 !== "string" || c.annotation_sha256 !== expectedAnnot) {
      errors.push(`annotation hash mismatch for ${c.file}: manifest annotation_sha256 does not match entities/names/extra_entities`);
    }
  }

  // Records: truncated/unparseable last line is ignored with truncated=true.
  let truncated = false;
  let parsed = [];
  if (hasSymlink(join(runDir, "records.jsonl"), runDir)) {
    errors.push("symlinked records file records.jsonl: must be a regular file");
  } else try {
    const raw = readFileSync(join(runDir, "records.jsonl"), "utf8");
    const segments = raw.split("\n");
    // Drop the single trailing empty segment from a file ending in newline.
    if (segments.length > 0 && segments[segments.length - 1] === "") segments.pop();
    const lines = segments.filter((l) => l.trim() !== "");
    lines.forEach((line, idx) => {
      const last = idx === lines.length - 1;
      try {
        parsed.push(JSON.parse(line));
      } catch {
        if (last) truncated = true;
        else errors.push(`unparseable records.jsonl line ${idx + 1}`);
      }
    });
  } catch (err) {
    errors.push(`missing records.jsonl: ${err?.message ?? err}`);
  }

  // Record key verification.
  const seen = new Set();
  const firstByFile = new Map();
  for (const r of parsed) {
    const file = r?.file;
    if (typeof file !== "string") {
      errors.push(`record missing case id: ${JSON.stringify(r)?.slice(0, 80)}`);
      continue;
    }
    if (seen.has(file)) {
      errors.push(`duplicate record for ${file}`);
      continue;
    }
    seen.add(file);
    if (!firstByFile.has(file)) firstByFile.set(file, r);
    if (!plannedByFile.has(file)) {
      errors.push(`unexpected record case ${file}: not in planned manifest`);
      continue;
    }
    const plannedEntry = plannedByFile.get(file);
    if (r?.run_id !== runId) {
      errors.push(`run_id mismatch for ${file}: record run_id does not match manifest run_id`);
    }
    if (r?.case_id !== file) {
      errors.push(`case mismatch for ${file}: record case_id does not match file`);
    }
    if (typeof r?.input_sha256 !== "string" || r.input_sha256 !== plannedEntry.input_sha256) {
      errors.push(`input hash mismatch for ${file}: record input_sha256 does not match manifest`);
    }
    const status = r?.status;
    if (status !== "ok" && status !== "error" && status !== "not_run") {
      errors.push(`invalid status for ${file}: ${JSON.stringify(status)}`);
    }
  }
  // A planned case with no record line (removed record, receipt still
  // present) is an incomplete run, not an integrity failure: report it via
  // missingRecordNotices (surfaced in errors at return) so ok stays true and
  // summarizeWithIntegrity marks the reconstruction incomplete with the full
  // planned denominator.
  // Duplicate/unexpected records and bad identities above stay errors.

  // Raw receipts keyed by run_id + case_id + input_sha256. Duplicates,
  // unexpected cases, wrong identities, and malformed lines are all errors.
  const receiptsByKey = new Map();
  try {
    const raw = readFileSync(join(runDir, "glimmer-raw.jsonl"), "utf8");
    const rawLines = raw.split("\n");
    rawLines.forEach((line, idx) => {
      if (line.trim() === "") return;
      let obj = null;
      try {
        obj = JSON.parse(line);
      } catch {
        errors.push(`unparseable receipt line ${idx + 1}: not JSON in glimmer-raw.jsonl`);
        return;
      }
      if (obj === null || typeof obj !== "object") {
        errors.push(`invalid receipt line ${idx + 1}: not an object in glimmer-raw.jsonl`);
        return;
      }
      const key = `${obj.run_id}\n${obj.case_id}\n${obj.input_sha256}`;
      if (receiptsByKey.has(key)) {
        errors.push(`duplicate receipt for ${obj.case_id ?? "?"}: repeated run_id+case_id+input_sha256 in glimmer-raw.jsonl`);
        return;
      }
      if (obj.run_id !== runId) {
        errors.push(`receipt run_id mismatch for ${obj.case_id ?? "?"}: receipt run_id does not match manifest run_id`);
      }
      if (typeof obj.case_id !== "string" || !plannedByFile.has(obj.case_id)) {
        errors.push(`unexpected receipt case ${obj.case_id ?? "?"}: receipt not in planned manifest`);
      } else {
        const plannedEntry = plannedByFile.get(obj.case_id);
        if (obj.input_sha256 !== plannedEntry.input_sha256) {
          errors.push(`receipt input hash mismatch for ${obj.case_id}: receipt input_sha256 does not match manifest`);
        }
      }
      if (!receiptsByKey.has(key)) receiptsByKey.set(key, obj);
    });
  } catch {
    /* no raw file: records carrying raw hashes will error below */
  }
  const receiptFor = (run_id, case_id, input_sha256) =>
    receiptsByKey.get(`${run_id}\n${case_id}\n${input_sha256}`) ?? null;

  for (const r of parsed) {
    if (typeof r?.file !== "string" || !plannedByFile.has(r.file)) continue;
    if (r.status !== "ok" && r.status !== "error") continue;
    const receipt = receiptFor(r.run_id, r.case_id, r.input_sha256);
    if (receipt === null) {
      errors.push(`missing raw receipt for ${r.file}: no glimmer-raw.jsonl entry for run_id+case_id+input_sha256`);
      continue;
    }
    if (typeof r.raw_sha256 === "string") {
      if (typeof receipt.content !== "string" || sha256Hex(receipt.content) !== r.raw_sha256) {
        errors.push(`raw hash mismatch for ${r.file}: receipt content does not match record raw_sha256`);
      }
    }
    if (typeof r.receipt_sha256 === "string") {
      let expected = null;
      try {
        expected = receiptIntegrityHash(receipt);
      } catch {
        expected = null;
      }
      if (expected === null || expected !== r.receipt_sha256) {
        errors.push(`receipt integrity mismatch for ${r.file}: raw receipt content/error/finish_reason does not match record receipt_sha256`);
      }
    } else {
      errors.push(`missing receipt integrity for ${r.file}: record carries no receipt_sha256`);
    }
  }

  // Per-case recompute from raw evidence only. Missing planned cases get no
  // synthesized record (the missing error forces incomplete); truncated tails
  // are already dropped above.
  const recomputed = [];
  for (const c of plannedCases) {
    const text = texts.get(c.file) ?? "";
    const saved = firstByFile.get(c.file);
    const total = (c.entities ?? []).length;
    if (saved === undefined) {
      missingRecordNotices.push(`missing record for ${c.file}`);
      continue;
    }
    if (saved.status === "not_run") {
      recomputed.push({ file: c.file, hits: 0, total, status: "not_run" });
      continue;
    }
    if (saved.status !== "ok" && saved.status !== "error") {
      recomputed.push({ file: c.file, hits: 0, total, status: "error", error: `invalid status ${JSON.stringify(saved.status)}` });
      continue;
    }
    const receipt = receiptFor(saved.run_id, saved.case_id, saved.input_sha256);
    if (receipt === null) {
      recomputed.push({ file: c.file, hits: 0, total, status: "error", error: `missing raw receipt for ${c.file}` });
      continue;
    }
    if (typeof receipt.error === "string" && receipt.error !== "") {
      recomputed.push({ file: c.file, hits: 0, total, status: "error", error: receipt.error });
      continue;
    }
    let spans;
    try {
      const out = parse(text, receipt.content, receipt.finish_reason ?? "stop");
      spans = out?.spans ?? out;
      if (!Array.isArray(spans)) throw new Error("glimmer: no JSON in reply");
    } catch (err) {
      recomputed.push({ file: c.file, hits: 0, total, status: "error", error: err?.message ?? String(err) });
      continue;
    }
    recomputed.push(buildOkRecord({ file: c.file, entities: c.entities, names: c.names, extra_entities: c.extra_entities }, text, spans));
  }

  const planned = plannedCases.map((c) => {
    const text = texts.get(c.file) ?? "";
    return {
      file: c.file,
      total: (c.entities ?? []).length,
      expected: annotateOccurrences(text, caseEntities(c)).length,
    };
  });

  const summary = summarizeWithIntegrity(recomputed, planned);
  if (errors.length > 0 || truncated || missingRecordNotices.length > 0) {
    summary.complete = false;
    summary.all_valid = false;
  }
  const misses = recomputed.flatMap((r) => r.misses ?? []);
  const spanMisses = recomputed.flatMap((r) => r.span_misses ?? []);
  const output = JSON.parse(JSON.stringify({ run_id: runId, ...summary, misses, span_misses: spanMisses }));
  if (errors.length > 0 || truncated || missingRecordNotices.length > 0) output.complete = false;
  const report = formatReport(recomputed, summary, misses, spanMisses);

  let savedSummary = null;
  if (hasSymlink(join(runDir, "summary.json"), runDir)) {
    errors.push("symlinked summary file summary.json: must be a regular file");
  } else {
    savedSummary = readSavedSummary(runDir);
  }
  const savedSummaryValid =
    savedSummary !== null && typeof savedSummary === "object" && !Array.isArray(savedSummary);
  let savedReport = null;
  try {
    savedReport = readFileSync(join(runDir, "report.txt"), "utf8");
  } catch {
    savedReport = null;
  }
  const mismatches = [];
  if (savedSummaryValid) {
    const keys = new Set([...Object.keys(output), ...Object.keys(savedSummary)]);
    for (const key of keys) {
      if (!deepEqual(savedSummary[key], output[key])) mismatches.push(key);
    }
    if (savedReport !== null && savedReport !== `${report}\n`) {
      if (!mismatches.includes("report")) mismatches.push("report");
    }
  }

  const ok = errors.length === 0;
  const complete = output.complete === true && summary.complete === true;
  // A missing saved summary.json or report.txt means there is nothing to
  // compare against: a complete reconstruction reports complete_uncompared,
  // never complete_match. The API and the CLI share this policy.
  const compared = savedSummaryValid && savedReport !== null;
  let status = "complete_match";
  if (!ok) status = "integrity_failure";
  else if (!complete) status = "incomplete";
  else if (!compared) status = "complete_uncompared";
  else if (mismatches.length > 0) status = "mismatch";
  return {
    ok,
    complete,
    errors: [...errors, ...missingRecordNotices],
    mismatches,
    truncated,
    records: recomputed,
    output,
    report,
    run_id: runId,
    summary,
    misses,
    span_misses: spanMisses,
    integrity: summary.integrity,
    status,
  };
}

// Default strict replay for a runEval run dir: read-only reconstruction
// from manifest.json, inputs/, glimmer-raw.jsonl, and records.jsonl with
// parseAnswer defaulting to parseGlimmerAnswer (lazily imported). Never
// trusts saved hits/spans/totals.
//
// Returns { run_id, records, summary, misses, span_misses, output, report,
// complete, truncated, integrity, status, ok, errors, mismatches }.
export async function rescoreRun(runDir, { parseAnswer } = {}) {
  return rescoreStrict(runDir, { parseAnswer });
}

// Explicit legacy path: trust the saved records.jsonl lines (hits/spans as
// written) instead of reconstructing from raw receipts. Kept for old
// callers that inject readText; never the default.
//
// Returns { run_id, records, summary, misses, span_misses, output, report,
// complete, truncated, integrity, status, ok, errors, mismatches }.
export async function rescoreLegacyRecords(runDir, { readText } = {}) {
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const plannedCases = manifest.planned ?? [];
  const read = readText ?? (async (c) => readFileSync(join(piiDir, c.file), "utf8"));

  const planned = [];
  for (const c of plannedCases) {
    const text = await read(c);
    planned.push({
      file: c.file,
      total: (c.entities ?? []).length,
      expected: annotateOccurrences(text, caseEntities(c)).length,
    });
  }

  const raw = readFileSync(join(runDir, "records.jsonl"), "utf8");
  const contentLines = raw.split("\n").filter((l) => l.trim() !== "");
  const parsed = [];
  let truncated = false;
  let malformed = null;
  contentLines.forEach((line, idx) => {
    const last = idx === contentLines.length - 1;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      if (last) truncated = true;
      else if (malformed === null) malformed = `unparseable records.jsonl line ${idx + 1}`;
    }
  });

  const integrity = checkRecordIntegrity(parsed, plannedCases);
  const reasons = [];
  if (!integrity.ok) reasons.push(integrity.reason);
  if (malformed !== null) reasons.push(malformed);
  if (truncated) reasons.push("truncated partial last line ignored");
  const combined = reasons.length > 0
    ? { ok: false, reason: reasons.join("; ") }
    : { ok: true, reason: null };

  // Exactly one terminal record per planned case, in planned order. Missing
  // cases (including the interrupted tail) become explicit not_run records.
  const firstByFile = new Map();
  for (const r of parsed) {
    if (typeof r?.file === "string" && !firstByFile.has(r.file)) firstByFile.set(r.file, r);
  }
  const ordered = plannedCases.map((c) => {
    const r = firstByFile.get(c.file);
    if (r !== undefined) return r;
    return { file: c.file, hits: 0, total: (c.entities ?? []).length, status: "not_run" };
  });

  const summary = summarizeWithIntegrity(ordered, planned);
  if (!combined.ok) {
    summary.complete = false;
    summary.all_valid = false;
    summary.integrity = combined;
  }
  const misses = ordered.flatMap((r) => r.misses ?? []);
  const spanMisses = ordered.flatMap((r) => r.span_misses ?? []);
  const output = JSON.parse(JSON.stringify({ run_id: manifest.run_id, ...summary, misses, span_misses: spanMisses }));
  if (!combined.ok) output.complete = false;
  const report = formatReport(ordered, summary, misses, spanMisses);
  const savedSummary = readSavedSummary(runDir);
  const mismatches = [];
  if (savedSummary !== null && typeof savedSummary === "object") {
    for (const key of Object.keys(savedSummary)) {
      if (!deepEqual(savedSummary[key], output[key])) mismatches.push(key);
    }
  }
  const errors = combined.ok ? [] : [combined.reason];
  const ok = combined.ok;
  const complete = output.complete === true && summary.complete === true;
  let status = "complete_match";
  if (!ok) status = "integrity_failure";
  else if (!complete) status = "incomplete";
  else if (mismatches.length > 0) status = "mismatch";
  return {
    ok,
    errors,
    mismatches,
    run_id: manifest.run_id,
    records: ordered,
    summary,
    misses,
    span_misses: spanMisses,
    output,
    report,
    complete,
    truncated,
    integrity: summary.integrity,
    status,
  };
}

const isMainEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainEntry) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`usage: rescore-glimmer-run.mjs --run-dir <existing run dir>
  Reconstructs a run's metrics from manifest.json, inputs/,
  glimmer-raw.jsonl and records.jsonl (read-only; never writes into the
  input dir) and compares against the saved summary.json/report.txt.
  exit codes: 0 complete_match | 1 integrity_failure | 3 incomplete |
    4 mismatch | 5 complete_uncompared | 2 usage error
  complete_uncompared: the reconstruction is complete but saved summary.json
    or report.txt is missing, so there is nothing to compare against.`);
    process.exit(0);
  }
  const legacyFlag = argv.indexOf("--legacy-glimmer-run");
  if (legacyFlag !== -1) {
    const rest = [...argv.slice(0, legacyFlag), ...argv.slice(legacyFlag + 1)];
    const outFlag = rest.indexOf("--out");
    let outPath;
    if (outFlag !== -1) {
      outPath = rest[outFlag + 1];
      if (outPath === undefined) {
        console.error("error: --out <path> required");
        process.exit(2);
      }
      rest.splice(outFlag, 2);
    }
    if (rest.length > 0) {
      console.error(`error: unknown args: ${rest.join(" ")}`);
      process.exit(2);
    }
    rescoreLegacyGlimmerRun(outPath);
  } else if (argv.length === 2 && argv[0] === "--run-dir" && typeof argv[1] === "string" && argv[1] !== "") {
    const runDir = argv[1];
    let stat = null;
    try {
      const { statSync } = await import("node:fs");
      stat = statSync(runDir);
    } catch {
      stat = null;
    }
    if (stat === null || !stat.isDirectory()) {
      console.error("error: --run-dir <existing dir> required");
      process.exit(2);
    }
    let re;
    try {
      re = await rescoreRun(runDir);
    } catch (err) {
      const message = err?.message ?? String(err);
      console.log(JSON.stringify({ run_id: runDir.split("/").pop() ?? runDir, status: "integrity_failure", ok: false, complete: false, truncated: false, errors: [message], mismatches: [] }));
      process.exit(1);
    }
    console.log(JSON.stringify({ run_id: re.run_id, status: re.status, ok: re.ok, complete: re.complete, truncated: re.truncated, errors: re.errors, mismatches: re.mismatches }));
    const code = re.status === "complete_match" ? 0 : re.status === "integrity_failure" ? 1 : re.status === "incomplete" ? 3 : re.status === "mismatch" ? 4 : re.status === "complete_uncompared" ? 5 : 1;
    process.exit(code);
  } else {
    if (argv.includes("--run-dir")) console.error("error: --run-dir <existing dir> required");
    else if (argv.length === 0) console.error("error: --run-dir <existing dir> required (historical writer needs --legacy-glimmer-run)");
    else console.error(`error: unknown args: ${argv.join(" ")}`);
    process.exit(2);
  }
}
