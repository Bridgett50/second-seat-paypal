# Redaction eval scoring conventions

Applies to `scripts/redaction-eval-lib.mjs` (pure scorers) and
`scripts/redaction-eval-runner.mjs` (`runEval`, serialization, report).

## Case inputs

- `entities`: the legacy per-case PII strings. ONLY these feed the
  `legacy_entity_disappearance` metric (entity text absent from `maskedText`),
  whose historical item count (`n = 39` for `fixtures/pii`) is preserved.
- `names` (fallback: `extra_entities`): separately annotated person names and
  any other supported PII present in the transcript but not in `entities`.
- Span scoring and over-redaction use `entities + names`. The legacy metric
  keeps using ONLY `entities`.

## Offsets

- Offsets are JavaScript string indices: UTF-16 code units into the original
  transcript text, half-open `[start, end)`.
- `annotateOccurrences` finds every (possibly overlapping) occurrence of each
  entity string via `indexOf`; each occurrence is its own expected span.
- Predicted spans are also in original-text coordinates. A gold span counts as
  covered ONLY if 100% of its characters are predicted masked. Masking one
  digit of an account number therefore earns no span credit (only partial
  character coverage).
- Uncovered expected spans are reported as `span_misses` with `{ file, start,
  end, text }` in original-text coordinates.

## Whitespace

- Whitespace characters (`/\s/`) are excluded from every character metric: they
  count as neither PII chars nor non-PII chars, so masking or missing
  whitespace never moves char coverage or over-redaction.

## Zero positives

- A case (or batch) with no expected PII chars has `charCoverage` /
  `char_coverage.completed` = `null`, never 1/perfect.
- `recall_completed` / `recall_end_to_end` are `null` when their denominator
  is 0. The printed report renders nulls as `n/a (no positives)`.

## Completed vs end-to-end

- Planned expectations (text, annotated spans, expected count) are precomputed
  BEFORE any dispatch, so failed (`error`) and `not_run` cases keep their
  planned expected counts in end-to-end denominators.
- `request_completion`: `{ completed, planned }` request counts.
- `recall_completed`: span coverage over completed (`ok`) cases only.
- `recall_end_to_end`: same covered count over ALL planned cases.
- `legacy_entity_disappearance.completed` / `.end_to_end`: same split for the
  legacy entity metric.

## Serialization

- `toRecord` keeps per-case `misses` (legacy `"file: entity"` strings) and
  `span_misses` on every `ok` record. `runEval` returns records and the result
  payload after a `JSON.stringify`/`parse` round-trip identical to the
  `GLIMMER_RESULT_JSON` file payload, which carries top-level `misses` and
  `span_misses` lists alongside the summary.

## Run records (replayable runs)

- Each run gets a unique directory `<outDir>/<runId>/` (`runId` defaults to a
  UTC timestamp plus randomness). Reusing an existing run dir is refused with
  an error, so a repeated run can never append into another run's files.
- `manifest.json`: `run_id`, `started_at`, and `planned` (planned case ids in
  order, each with its `entities`/`names` and the `input_sha256` of the exact
  input text it ran on).
- `records.jsonl`: exactly one terminal record per planned case, with status
  `ok` | `error` | `not_run`. Each record is appended and fsynced as soon as
  its case finishes, before the next case proceeds. A failed canary produces
  one `error` record plus an explicit `not_run` record for every remaining
  planned case.
- `summary.json` / `report.txt`: the summary payload and the printable report.
- `checkRecordIntegrity` (in `redaction-eval-lib.mjs`): missing, duplicate, or
  unexpected case ids force `complete: false` (and `all_valid: false`) with an
  `integrity.reason` naming the offending ids.
- `all_attempted` is true when no case is `not_run` (every case got a response,
  even if some errored); `all_valid` (like `complete`) requires every case
  `ok`.
- `rescoreRun(runDir)` (in `rescore-glimmer-run.mjs`) is the strict default:
  read-only replay from `manifest.json`, `inputs/`, `glimmer-raw.jsonl`, and
  `records.jsonl`, with `parseAnswer` defaulting to `parseGlimmerAnswer`. It
  never trusts saved hits/spans/totals. `rescoreLegacyRecords(runDir)` is the
  explicitly named trust-saved-records path. Strict replay ignores a
  truncated trailing partial line (`truncated: true`), keeps full planned
  denominators when records are missing, and reproduces the saved
  `summary.json`/`report.txt` exactly for unchanged complete runs.
  Interrupted runs rescore as `complete: false`.
- Strict replay status (`status` on the result; CLI exit codes in parentheses):
  `integrity_failure` (1, any error: hash mismatch, bad status, duplicate /
  unexpected / wrong-identity / unparseable receipt, missing evidence),
  `incomplete` (3, no errors but not complete: truncated tail, `error` or
  `not_run` cases), `mismatch` (4, complete but the saved `summary.json` or
  `report.txt` differs), `complete_match` (0, complete and matching). Exit 2
  is usage error (no args, unknown args, missing `--run-dir` value, or a
  non-directory). Exit zero therefore always means complete AND matching,
  never just complete. The CLI accepts ONLY `--run-dir <existing dir>` for
  strict replay (one JSON line:
  `{run_id, status, ok, complete, truncated, errors, mismatches}`); the
  historical writer needs the explicit `--legacy-glimmer-run` flag.
- `complete`, `output.complete`, and `summary.complete` always agree (a torn
  tail forces all three false with `all_valid: false`). The printable report
  starts with a `complete: true|false` line and `completion: <ok>/<planned>`
  uses the full planned count.
- Every file record with a raw receipt carries `receipt_sha256`
  (`receiptIntegrityHash`: sha256 over the receipt `content`, `error`, and
  `finish_reason` — all scoring-relevant receipt data), plus the legacy
  `raw_sha256` over `content`. Strict replay verifies both, plus the
  `input_sha256` / `annotation_sha256` hashes. Raw receipts with duplicate
  keys, unplanned cases, a wrong `run_id`, or unparseable lines are errors.

## Raw-response receipts

- Every model response is logged as one receipt keyed by `run_id`, `case_id`,
  and `input_sha256`. Receipts preserve the final `content`, per-span original
  (`original_label`) and canonical (`label`) labels, `finish_reason`, `usage`,
  `latency_ms`, and `error` (failures write an error receipt instead of a
  success receipt).
- Reasoning content is stored ONLY in the receipt's separate `reasoning`
  field. The answer is `message.content` only: a reply whose reasoning
  contains a valid JSON answer but whose content is empty/invalid is a case
  `error`, never a scored answer.
- The raw log lives under the run dir (`<runDir>/glimmer-raw.jsonl`), opened
  with exclusive create, so repeats cannot append into another run's file.

## Development vs holdout inputs

- `fixtures/pii` and `fixtures/pii-scoring` are DEVELOPMENT sets: iterate on
  them freely, tune prompts and thresholds against them, and run the eval CLI
  against them by default (`node scripts/redaction-eval.mjs`, `--cases pii`).
- `fixtures/holdout-v1` is the frozen holdout: newly authored, fully synthetic
  transcripts pinned by `MANIFEST.json` (`inference_runs: 0`,
  `review.status: pending-manual-review`). It is used ONLY when explicitly
  named (`--cases holdout-v1`), and only under the frozen config in
  `docs/runbook-holdout-run.md`. Verify it any time with
  `node scripts/holdout-freeze.mjs` (offline hash + verbatim-annotation check).
- Never tune prompts, patterns, or thresholds against holdout misses. A valid
  evaluation may produce a poor result; acceptance depends on trustworthy
  measurement, not a favorable percentage.

## Logging boundary

- Raw-response logging writes NOTHING unless `GLIMMER_RAW_DIR` is explicitly
  set. Application (non-eval) paths therefore never write transcript or reply
  text by default.
- Synthetic evaluation artifacts (receipts, manifests, records under a run
  dir) may contain synthetic text from the eval inputs. That is expected for
  eval replay and must not be inherited by application logging.
