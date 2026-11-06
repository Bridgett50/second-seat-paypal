// Testable evaluation runner for scripts/redaction-eval.mjs (offline only).
//
// runEval() owns the whole eval flow: precompute planned expectations BEFORE
// any dispatch, run the canary + the concurrent remainder, serialize records
// through the same JSON round-trip used for GLIMMER_RESULT_JSON, and build the
// summary + printable report. The CLI in redaction-eval.mjs is a thin wrapper
// that supplies live file/redactor factories.
//
// Span scoring and over-redaction use entities + names (c.names, falling back
// to c.extra_entities). The legacy entity-disappearance metric uses ONLY
// c.entities so the historical item count is preserved.
//
// Run records: every run gets a unique directory <outDir>/<runId>/ holding
// manifest.json (run_id, planned case ids, input sha256 per case, started_at,
// request_ms, deadline_ms with null when no deadline),
// records.jsonl (one terminal record per planned case, appended + fsynced as
// soon as the case finishes), summary.json, and report.txt. An existing run
// dir is never reused (runEval throws). The raw-response log lives under the
// run dir too, so a repeated run can never append into another run's file.
import {
  annotateOccurrences,
  scoreSpans,
  summarizeWithIntegrity,
} from "./redaction-eval-lib.mjs";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

// Every supported PII string for span purposes: legacy entities plus the
// separately annotated names/extra entities.
export function caseEntities(c) {
  return [...(c.entities ?? []), ...(c.names ?? c.extra_entities ?? [])];
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Immutable annotation hash: sha256 of JSON.stringify({entities, names,
// extra_entities}) with undefined fields omitted consistently.
export function annotationSha256(c) {
  return sha256Hex(JSON.stringify({ entities: c.entities ?? [], names: c.names, extra_entities: c.extra_entities }));
}

// Shared scoring: ok record from spans, exactly like runCase (maskText +
// scoreSpans). Both the runner and offline replay use this helper.
export function maskSpans(text, spans) {
  const sorted = [...(spans ?? [])]
    .filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const s of sorted) {
    const cur = merged[merged.length - 1];
    if (cur === undefined) merged.push({ start: s.start, end: s.end, label: s.label });
    else if (s.start < cur.end) {
      if (s.end > cur.end) cur.end = s.end;
    } else merged.push({ start: s.start, end: s.end, label: s.label });
  }
  let out = "";
  let cur = 0;
  for (const s of merged) {
    if (s.start < 0 || s.end > text.length || s.end <= s.start) throw new Error("maskText: span out of range");
    out += text.slice(cur, s.start);
    out += `[REDACTED_${s.label}]`;
    cur = s.end;
  }
  out += text.slice(cur);
  return out;
}

export function buildOkRecord(c, text, spans, maskedText) {
  const masked = typeof maskedText === "string" ? maskedText : maskSpans(text, spans ?? []);
  let hits = 0;
  const misses = [];
  for (const e of c.entities ?? []) {
    if (!masked.includes(e)) hits += 1;
    else misses.push(`${c.file}: ${e}`);
  }
  const expected = annotateOccurrences(text, caseEntities(c));
  const scored = scoreSpans(text, expected, spans ?? []);
  const span = {
    covered: scored.covered,
    expected: scored.expected,
    piiChars: scored.piiChars,
    piiCharsMasked: scored.piiCharsMasked,
    nonPii: scored.nonPii,
    nonPiiMasked: scored.nonPiiMasked,
  };
  const span_misses = scored.missed.map((m) => ({
    file: c.file,
    start: m.start,
    end: m.end,
    text: text.slice(m.start, m.end),
  }));
  return { file: c.file, hits, total: (c.entities ?? []).length, status: "ok", misses, span_misses, span };
}

// Concurrency from a provided run config (services/bot/src/release/runConfig.ts
// shape): a positive integer modal.concurrency wins, anything else falls back
// to the historical default of 2.
export function concurrencyFromRunConfig(runConfig, defaultValue = 2) {
  const c = runConfig?.modal?.concurrency;
  if (typeof c === "number" && Number.isInteger(c) && c >= 1) return c;
  return defaultValue;
}

// Default run id: UTC timestamp plus randomness, unique per run.
export function defaultRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `run-${stamp}-${randomBytes(6).toString("hex")}`;
}

// Serialized per-case record. ok records always carry misses (legacy entity
// misses as "file: entity" strings) and span_misses (uncovered expected spans
// with original-text offsets), even when both are empty.
export function toRecord(r) {
  if (r.status === "ok") {
    return {
      file: r.file,
      hits: r.hits,
      total: r.total,
      status: "ok",
      misses: r.misses ?? [],
      span_misses: r.span_misses ?? [],
      span: r.span,
    };
  }
  if (r.status === "not_run") return { file: r.file, hits: 0, total: r.total, status: "not_run" };
  return { file: r.file, hits: 0, total: r.total, status: "error", error: r.error };
}

function errorRecord(c, err) {
  return {
    file: c.file,
    hits: 0,
    total: (c.entities ?? []).length,
    status: "error",
    error: err?.message ?? String(err),
  };
}

function notRunRecord(c) {
  return {
    file: c.file,
    hits: 0,
    total: (c.entities ?? []).length,
    status: "not_run",
  };
}

async function runCase(c, text, redactor) {
  const result = await redactor.redactText(text);
  return buildOkRecord(c, text, result.spans ?? [], result.maskedText);
}

function ratio(k, n) {
  return n ? (k / n).toFixed(3) : "n/a (no positives)";
}

// Integrity hash over ALL scoring-relevant receipt data (everything
// parseAnswer/scoring reads: final content, error metadata, finish reason).
// Written on every record with a raw receipt and verified on strict replay.
export function receiptIntegrityHash(receipt) {
  const content = typeof receipt?.content === "string" ? receipt.content : "";
  const error = typeof receipt?.error === "string" ? receipt.error : "";
  const finish = typeof receipt?.finish_reason === "string" ? receipt.finish_reason : "";
  return sha256Hex(JSON.stringify({ content, error, finish_reason: finish }));
}

// Printable report lines. Completed-case metrics and full-batch (end-to-end)
// metrics are labelled separately; null recalls print as "n/a (no positives)".
// The first line is `complete: true|false` (mirrors summary.complete) and
// `completion:` uses the full planned denominator so missing planned records
// keep denominators.
export function formatReport(records, summary, misses, spanMisses) {
  const lines = [];
  lines.push(`complete: ${summary.complete}`);
  const { k, n } = summary.recall;
  const [lo, hi] = summary.wilson95;
  lines.push(`recall: ${k}/${n} = ${ratio(k, n)}`);
  lines.push(`wilson95: [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
  const rc = summary.recall_completed;
  const re = summary.recall_end_to_end;
  lines.push(`span_coverage_completed: ${rc ? `${rc.k}/${rc.n} = ${ratio(rc.k, rc.n)}` : "n/a (no positives)"}`);
  lines.push(`span_coverage_end_to_end: ${re ? `${re.k}/${re.n} = ${ratio(re.k, re.n)}` : "n/a (no positives)"}`);
  const cc = summary.char_coverage;
  lines.push(`char_coverage: ${cc.masked}/${cc.total} = ${cc.completed === null ? "n/a (no positives)" : cc.completed.toFixed(3)}`);
  lines.push(`over_redaction_rate: ${summary.over_redaction_rate.toFixed(3)}`);
  for (const r of records) {
    if (r.status === "ok") lines.push(`case ${r.file}: ${r.hits}/${r.total}`);
    else if (r.status === "error") lines.push(`case ${r.file}: error ${r.error}`);
    else lines.push(`case ${r.file}: not_run`);
  }
  const completed = records.filter((r) => r.status === "ok").length;
  const plannedCount =
    typeof summary?.request_completion?.planned === "number"
      ? summary.request_completion.planned
      : records.length;
  lines.push(`completion: ${completed}/${plannedCount}`);
  lines.push(`execution_failures: ${summary.failures.length}`);
  for (const f of summary.failures) lines.push(` - ${f}`);
  lines.push(`not_run: ${summary.not_run.length}`);
  for (const f of summary.not_run) lines.push(` - ${f}`);
  if (misses.length === 0 && spanMisses.length === 0) {
    lines.push("misses: none");
  } else {
    lines.push("misses:");
    for (const m of misses) lines.push(` - ${m}`);
    lines.push("span_misses:");
    for (const m of spanMisses) lines.push(` - ${m.file} [${m.start},${m.end}): ${JSON.stringify(m.text)}`);
  }
  return lines.join("\n");
}

// Key one redactor for a single case so its raw-response receipts carry
// run_id, case_id, and input_sha256. Fake redactors without setReceiptContext
// are left alone.
function keyRedactor(redactor, receipt) {
  if (redactor !== null && typeof redactor === "object" && typeof redactor.setReceiptContext === "function") {
    redactor.setReceiptContext(receipt);
  }
}

// Run the eval over planned cases with an injected redactor factory.
//
//   cases:        parsed cases.json entries ({ file, entities, names? })
//   readText:     async (case) => transcript text
//   makeRedactor: () => redactor with redactText(text) and optional timeoutMs
//   deadlineMs:   global budget in ms from eval start (optional)
//   requestMs:    per-request timeout in ms (positive integer, default 90000);
//                 each request gets min(requestMs, remaining budget). Invalid
//                 values throw before any request.
//   concurrency:  worker count for the non-canary remainder (default 2);
//                 must be an integer >= 1, else throws before readText and
//                 makeRedactor are called.
//   runId:        unique id for this run (default: timestamp + randomness)
//   outDir:       parent dir for the run dir; when set, runEval writes
//                 <outDir>/<runId>/{manifest.json,records.jsonl,summary.json,
//                 report.txt} and points GLIMMER_RAW_DIR there for the run.
//                 An existing run dir is refused (throws).
//   evidenceFiles: optional {relName: Buffer|string} files written into the
//                 run dir right after manifest.json with exclusive create.
//                 Names must be non-empty and free of "/", "\\" and "..".
//   fsImpl:       optional {mkdirSync, writeFileSync, openSync, rmSync}
//                 overrides for the run-dir ownership steps (fault injection
//                 in tests); defaults to the node:fs functions above.
//
// Ownership failures after the run dir is created never call makeRedactor:
// they write <outDir>/<runId>.ownership-failure.json ({run_id, stage,
// error}), remove only the run dir this call created, and throw
// "runEval: ownership failure at <stage>: ...".
//
// Returns { records, summary, misses, span_misses, output, report, complete,
// canaryFailed, runId, runDir }. records and output have been through the same
// JSON.stringify/parse round-trip as the GLIMMER_RESULT_JSON file payload.
export async function runEval({
  cases,
  readText,
  makeRedactor,
  deadlineMs,
  requestMs = 90_000,
  concurrency = 2,
  runId = defaultRunId(),
  outDir,
  evidenceFiles,
  fsImpl,
}) {
  const fs = {
    mkdirSync,
    writeFileSync,
    openSync,
    rmSync,
    ...(fsImpl ?? {}),
  };
  if (typeof runId !== "string" || runId === "" || runId.includes("/") || runId.includes("\\")) {
    throw new Error(`runEval: invalid runId ${JSON.stringify(runId)}`);
  }
  if (!Number.isInteger(requestMs) || requestMs <= 0) {
    throw new Error("runEval: invalid requestMs");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`runEval: invalid concurrency ${String(concurrency)}`);
  }
  const startedAt = Date.now();
  const deadline =
    Number.isInteger(deadlineMs) && deadlineMs > 0 ? startedAt + deadlineMs : Infinity;
  const remainingMs = () => deadline - Date.now();
  const applyTimeout = (redactor) => {
    const perRequest = Math.min(requestMs, remainingMs());
    if (redactor !== null && typeof redactor === "object" && "timeoutMs" in redactor) {
      redactor.timeoutMs = perRequest;
    } else {
      process.env["GLIMMER_TIMEOUT_MS"] = String(perRequest);
    }
  };

  // Precompute every planned case's text, annotated spans and expected count
  // BEFORE any dispatch, so failed/not_run cases keep planned denominators.
  const texts = new Map();
  const planned = [];
  const manifestCases = [];
  for (const c of cases) {
    const text = await readText(c);
    texts.set(c.file, text);
    planned.push({
      file: c.file,
      total: (c.entities ?? []).length,
      expected: annotateOccurrences(text, caseEntities(c)).length,
    });
    manifestCases.push({
      file: c.file,
      entities: c.entities ?? [],
      ...(c.names !== undefined ? { names: c.names } : {}),
      ...(c.extra_entities !== undefined ? { extra_entities: c.extra_entities } : {}),
      input_sha256: sha256Hex(text),
      annotation_sha256: annotationSha256(c),
    });
  }

  // Unique run dir, claimed with one atomic exclusive mkdir: a pre-existing
  // dir throws EEXIST and is refused before makeRedactor is called.
  let runDir = null;
  let recordsFd = null;
  if (outDir !== undefined && outDir !== null && outDir !== "") {
    const failOwnership = (stage, err) => {
      const detail = err?.message ?? String(err);
      try {
        fs.writeFileSync(
          join(outDir, `${runId}.ownership-failure.json`),
          `${JSON.stringify({ run_id: runId, stage, error: detail }, null, 2)}\n`,
          { flag: "wx" },
        );
      } catch {
        /* failure evidence itself is best effort */
      }
      try {
        fs.rmSync(runDir, { recursive: true, force: true });
      } catch {
        /* cleanup is best effort */
      }
      throw new Error(`runEval: ownership failure at ${stage}: ${detail}`);
    };
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch (err) {
      throw new Error(`runEval: ownership failure at mkdir-out-dir: ${err?.message ?? String(err)}`);
    }
    runDir = join(outDir, runId);
    try {
      fs.mkdirSync(runDir);
    } catch (err) {
      if (err?.code === "EEXIST") {
        throw new Error(`runEval: run dir already exists (refusing reuse): ${runDir}`);
      }
      throw new Error(`runEval: ownership failure at mkdir-run-dir: ${err?.message ?? String(err)}`);
    }
    // The run dir is owned from here: every later ownership failure records
    // <outDir>/<runId>.ownership-failure.json, removes only this run dir,
    // and never calls makeRedactor.
    try {
      fs.mkdirSync(join(runDir, "inputs"), { recursive: true });
      for (const c of cases) {
        const dest = join(runDir, "inputs", c.file);
        fs.mkdirSync(dirname(dest), { recursive: true });
        fs.writeFileSync(dest, texts.get(c.file) ?? "");
      }
    } catch (err) {
      failOwnership("write-inputs", err);
    }
    const manifest = {
      run_id: runId,
      started_at: new Date(startedAt).toISOString(),
      planned: manifestCases,
      request_ms: requestMs,
      deadline_ms: Number.isInteger(deadlineMs) && deadlineMs > 0 ? deadlineMs : null,
    };
    try {
      fs.writeFileSync(join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    } catch (err) {
      failOwnership("write-manifest", err);
    }
    if (evidenceFiles !== undefined && evidenceFiles !== null) {
      for (const name of Object.keys(evidenceFiles)) {
        if (typeof name !== "string" || name === "" || name.includes("/") || name.includes("\\") || name.includes("..")) {
          failOwnership("write-evidence", new Error(`invalid evidence file name ${JSON.stringify(name)}`));
        }
      }
      try {
        for (const [name, data] of Object.entries(evidenceFiles)) {
          fs.writeFileSync(join(runDir, name), data, { flag: "wx" });
        }
      } catch (err) {
        failOwnership("write-evidence", err);
      }
    }
    // Exclusive create: a repeated run can never append into this file.
    try {
      recordsFd = fs.openSync(join(runDir, "records.jsonl"), "wx");
    } catch (err) {
      failOwnership("open-records", err);
    }
  }

  // Raw-response log goes under the run dir so repeats can never append into
  // another run's raw file. Restored afterwards.
  const prevRawDir = process.env["GLIMMER_RAW_DIR"];
  if (runDir !== null) process.env["GLIMMER_RAW_DIR"] = runDir;

  // Deadline already passed while preparing inputs: zero redactor requests
  // (no canary) and every planned case is recorded not_run.
  const __finishAllNotRun = () => {
    const allNotRun = cases.map(notRunRecord);
    for (const rec of allNotRun) persist(rec);
    return finish(allNotRun, false);
  };

  const rawShaOf = (redactor) => {
    try {
      const receipt = redactor?.lastReceipt ?? null;
      if (receipt !== null && typeof receipt === "object" && typeof receipt.content === "string") {
        return sha256Hex(receipt.content);
      }
    } catch {
      /* no raw evidence */
    }
    return undefined;
  };

  const receiptHashOf = (redactor) => {
    try {
      const receipt = redactor?.lastReceipt ?? null;
      if (receipt !== null && typeof receipt === "object" && typeof receipt.content === "string") {
        return receiptIntegrityHash(receipt);
      }
    } catch {
      /* no raw evidence */
    }
    return undefined;
  };

  // Durable save: append one JSON line per finished case and fsync before
  // proceeding, so an interrupted run stays readable and honestly incomplete.
  // File records carry run_id, case_id (=file), input_sha256, raw_sha256,
  // and receipt_sha256 when the redactor produced a raw receipt; in-memory
  // records keep the legacy shape so summary/report output is unchanged.
  const persist = (rec, redactor) => {
    if (recordsFd === null) return;
    const base = toRecord(rec);
    const file = rec.file;
    const extra = {
      run_id: runId,
      case_id: file,
      input_sha256: sha256Hex(texts.get(file) ?? ""),
    };
    const rawSha = redactor !== undefined ? rawShaOf(redactor) : undefined;
    if (rawSha !== undefined) extra.raw_sha256 = rawSha;
    const receiptHash = redactor !== undefined ? receiptHashOf(redactor) : undefined;
    if (receiptHash !== undefined) extra.receipt_sha256 = receiptHash;
    writeSync(recordsFd, `${JSON.stringify({ ...base, ...extra })}\n`);
    fsyncSync(recordsFd);
  };

  const finish = (allRecords, canaryFailed) => {
    const records = JSON.parse(JSON.stringify(allRecords.map(toRecord)));
    const summary = summarizeWithIntegrity(records, planned);
    const misses = records.flatMap((r) => r.misses ?? []);
    const spanMisses = records.flatMap((r) => r.span_misses ?? []);
    const output = JSON.parse(JSON.stringify({ run_id: runId, ...summary, misses, span_misses: spanMisses }));
    const report = formatReport(records, summary, misses, spanMisses);
    if (runDir !== null) {
      writeFileSync(join(runDir, "summary.json"), `${JSON.stringify(output, null, 2)}\n`);
      writeFileSync(join(runDir, "report.txt"), `${report}\n`);
    }
    return {
      records,
      summary,
      misses,
      span_misses: spanMisses,
      output,
      report,
      complete: summary.complete,
      canaryFailed,
      runId,
      runDir,
    };
  };

  try {
    if (Date.now() >= deadline) return __finishAllNotRun();
    // Canary: case 1 runs first; an execution error stops the eval, and every
    // remaining planned case gets an explicit not_run record.
    const records = [];
    let canaryRedactor;
    try {
      canaryRedactor = makeRedactor();
      applyTimeout(canaryRedactor);
      keyRedactor(canaryRedactor, {
        runId,
        caseId: cases[0].file,
        inputSha256: sha256Hex(texts.get(cases[0].file)),
      });
      const rec = await runCase(cases[0], texts.get(cases[0].file), canaryRedactor);
      persist(rec, canaryRedactor);
      records.push(rec);
    } catch (err) {
      const rec = errorRecord(cases[0], err);
      persist(rec, canaryRedactor);
      records.push(rec);
      for (const c of cases.slice(1)) {
        const nr = notRunRecord(c);
        persist(nr);
        records.push(nr);
      }
      return finish(records, true);
    }

    // Remaining cases run concurrently; each record is persisted as soon as
    // its case finishes, before the next case proceeds.
    const rest = cases.slice(1);
    const results = new Array(rest.length);
    let next = 0;
    async function worker() {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= rest.length) return;
        const c = rest[i];
        if (Date.now() >= deadline) {
          const nr = { file: c.file, hits: 0, total: (c.entities ?? []).length, status: "not_run" };
          persist(nr);
          results[i] = nr;
          continue;
        }
        let redactor;
        try {
          redactor = makeRedactor();
          applyTimeout(redactor);
          keyRedactor(redactor, { runId, caseId: c.file, inputSha256: sha256Hex(texts.get(c.file)) });
          const rec = await runCase(c, texts.get(c.file), redactor);
          persist(rec, redactor);
          results[i] = rec;
        } catch (err) {
          const rec = errorRecord(c, err);
          persist(rec, redactor);
          results[i] = rec;
        }
      }
    }
    const workers = [];
    for (let w = 0; w < concurrency; w++) workers.push(worker());
    await Promise.all(workers);
    records.push(...results);
    return finish(records, false);
  } finally {
    if (recordsFd !== null) closeSync(recordsFd);
    if (prevRawDir === undefined) delete process.env["GLIMMER_RAW_DIR"];
    else process.env["GLIMMER_RAW_DIR"] = prevRawDir;
  }
}
