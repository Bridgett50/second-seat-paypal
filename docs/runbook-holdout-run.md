# Runbook: frozen holdout run (PREPARE ONLY — DO NOT RUN)

Status: PREPARED, NOT AUTHORIZED. The launch and cleanup steps below are
written but marked DO NOT RUN. Do not launch them without separate
authorization of this exact frozen config AND a separate budget approval.

Partner verification: pending. No partner has verified any result
because no run has happened.

A valid evaluation may produce a poor result. Acceptance depends on
trustworthy measurement, not a favorable percentage.

## Frozen config

| Item | Frozen value |
|---|---|
| Dataset selection | Explicit `--cases <dataset>` only; launch mode refuses to run without it. Frozen dataset name + `dataset_sha256` recorded in the JSON config; `check_launch` blocks on selection missing, mismatch, or hash mismatch |
| Review attestation | `review.status: reviewed` with non-empty `reviewer`, `reviewed_at`, and `review.dataset_sha256` equal to the frozen `dataset_sha256`; enforced by `review_status_ok` / `check_launch` |
| Source SHA | Full `git rev-parse HEAD` (40 lowercase hex, not all zeros, no placeholder) in the JSON config (`source_sha`); packaged source identity `source_sha256` (`packaged_source_sha256` over the eval image inputs) in the JSON config |
| Container image | Pinned digest form `name@sha256:<64 hex>` in the JSON config (mutable tags blocked) |
| Model revision | 40-char hex revision in the JSON config (unpinned values blocked) |
| Scorer | `services/bot/scripts/redaction-eval-lib.mjs` |
| Runner | `services/bot/scripts/redaction-eval-runner.mjs` (`runEval`: canary-first, concurrency 2, unique run dir, `rescoreRun` for offline rescoring) |
| Prompt | Inline system prompt in `services/bot/src/private/redact.ts`; no separate redaction prompt file |
| Response schema | Inline JSON schema (`spans[{start,end,label}]`, `boxes[]`) in the same file |
| Decoding | `temperature 0.0, no top_p/top_k, reasoning_strength low` (E10, draft PR #76; greedy decoding only per the structured-output recipe) |
| Token cap | `max_tokens 2048` (`GLIMMER_MAX_TOKENS` unset → `GLIMMER_MAX_TOKENS_DEFAULT`) |
| Work deadline | 780 s (`deadline = func_start + 780`; see timing note) |
| Function timeout | 840 s (`timeout=840` on the Modal `eval_in_container` function) |
| Ready wait | Up to 300 s for vLLM `/health`, capped by the work deadline; 30 s + 5 s reserve held back (`remaining_ms - 30_000`, `remaining_s - 5`); per-request timeout `min(90000, remaining budget)` |
| Canary policy | Case 1 runs first and is scored; if it errors, the eval stops, exits 2, and every remaining case is recorded `not_run` |
| Retry policy | None (`retries=0`; no rerun cherry-picking — see publish rules) |
| Architecture | Existing `.spawn()` + Volume architecture (`eval_in_container.spawn(dataset)`, `glimmer-weights` + `glimmer-results` Volumes); scale-to-zero; one unique run dir `/results/<run_id>/` per run, never reused |

Any prepared holdout config must be re-frozen before a launch — re-freeze it after the E10 decoding and inline-prompt change, which alters the frozen inline redaction prompt hash and decoding row (E10, draft PR #76; hashed by the E14 prompt-freeze).

### Timeouts vs billed allocation time

Model load and the readiness wait happen INSIDE the 780 s work deadline
(they consume it): `wait_ready` polls only until
`min(func_start + 300, deadline)` and the eval runs on what remains.
Billed allocation additionally covers container start/image pull before
function start and teardown, up to the 840 s function timeout plus startup.
Budget approval must cover the whole allocation, not just 780 s.

## Launch steps (DO NOT RUN without separate authorization of this frozen config and a budget)

1. Verify the freeze (`review.status: reviewed`, dataset hash, pinned image digest, model revision); `check_launch` must return no blockers.
2. Record the source SHA in the table above.
3. Build: `cd services/bot && pnpm build`.
4. Deploy: `python3 -m modal deploy infra/modal/glimmer_app.py`; record the image digest.
5. Launch the bounded run: `GLIMMER_LAUNCH_CONFIG=<config> GLIMMER_EVAL_DATASET=<dataset> python3 -m modal run --detach infra/modal/glimmer_app.py --dataset <dataset> --config <config>`. Here `<config>` is the canonical nested run config (runConfig.ts shape, configVersion 1).
6. Container eval command: `node scripts/redaction-eval.mjs --cases <dataset> --out-dir /results --run-id <run_id> --run-config <config> --run-config-sha256 <config_sha256>`.
7. Fetch results: `python3 -m modal run infra/modal/glimmer_app.py::fetch --run-id <run_id>`.
8. Offline rescore without inference: `node services/bot/scripts/rescore-glimmer-run.mjs --run-dir <run_dir>`; the rescore must reproduce `summary.json`/`report.txt` exactly for a complete run.

## Cleanup steps (DO NOT RUN without the same authorization)

1. `python3 -m modal app stop second-seat-glimmer`.
2. Confirm scale-to-zero (no resident containers) before closing the budget.
3. Publish per the rules below — including incomplete results — then close out.

## What gets published if the canary fails

Publish the incomplete run as-is: the one `error` record for the first case
plus explicit `not_run` records for the rest, with the full planned
denominator retained (`complete: false`, exit code 2). Do NOT rerun, do NOT
cherry-pick the remaining cases into a new run, and do NOT present
completed-case metrics as the batch result.

## What gets published if the remaining batch fails

Publish the partial run as-is: each planned case keeps exactly one terminal
status (`ok` / `error` / `not_run`), completed-case metrics stay labelled
completed, and end-to-end metrics keep the FULL planned denominator
(`complete: false`). Offline `rescoreRun(runDir)` output is published
alongside the saved `summary.json` / `report.txt`. Missing, duplicate, or
unexpected case ids force `complete: false` with the integrity reason named.
No rerun cherry-picking.

## Verification record

- CPU dry run (offline, fake redactor, no network): `node services/bot/scripts/holdout-dry-run.mjs` — success, failing-canary, and interrupted modes.
- Live execution: NOT RUN (requires the separate authorizations above).
- Partner verification: pending.
