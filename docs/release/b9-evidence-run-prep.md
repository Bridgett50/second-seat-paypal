# B9 evidence run — preparation only

> **Not authorized: no sealed-data access, model execution, Modal activity, or spending. Every box below is unchecked.**

This document prepares — but does not launch — the bounded evidence run.
The sealed dataset is referred to only by role ("the sealed dataset"); no sealed
paths, hashes, or manifests are opened or recorded here.
Existing facts are drawn from [runbook-holdout-run.md](../runbook-holdout-run.md),
[launch_contract.py](../../infra/modal/launch_contract.py), and [README.md](../../README.md).

## 1) Readiness checklist

- [ ] **Criterion 1 — B1–B5 offline acceptance.**
  B1 #44, B2 #45, B3 #48, B4 #46, B5 #47 draft PRs with offline acceptance tests
  passing in CI, not yet merged/reviewed.
  Evidence needed: CI run URLs showing offline acceptance tests passing for each
  of #44, #45, #48, #46, #47; confirmation each is still draft (not merged, not reviewed).
  Status: pending.
- [ ] **Criterion 2 — Independent review of the sealed dataset authorized and completed.**
  Evidence needed: written authorization record plus completed review attestation
  (`review.status: reviewed` with non-empty reviewer, reviewed_at, and dataset hash
  bound to the sealed dataset, as enforced by `review_status_ok` / `check_launch`).
  Status: pending.
- [ ] **Criterion 3 — Exact source, dataset identity, model revision, image digest, prompt/schema, scorer, decoding settings, and retry policy frozen.**
  Evidence needed: frozen JSON config containing all of the above; `check_launch`
  returns no blockers.
  Status: pending.
- [ ] **Criterion 4 — Approved command selects the correct dataset and produces a complete replayable bundle.**
  Evidence needed: the exact approved command recorded verbatim; confirmation it uses
  explicit `--cases <dataset>` selection and yields a unique run dir with a complete
  bundle (fetch + offline rescore reproduces `summary.json` / `report.txt`).
  Status: pending.
- [ ] **Criterion 5 — Plan permits one Modal attempt with scored canary, bounded concurrency, declared token/request limits, and teardown.**
  Evidence needed: plan excerpt showing single attempt, canary-first policy, concurrency
  bound, token/request limits, work deadline / function timeout, and teardown steps.
  Status: pending.
- [ ] **Criterion 6 — Spark proof permits one actual request, no automatic retries, exact owner approval of the redacted payload.**
  Evidence needed: plan excerpt showing one Spark request, `retries=0` (no automatic
  retries), and a record of owner approval of the exact redacted payload before sending.
  Status: pending.
- [ ] **Criterion 7 — Any additional Glimmer request for the demonstration is declared; no hidden second GPU allocation.**
  Evidence needed: written declaration of any extra Glimmer demo request (or "none");
  confirmation of at most the authorized allocation(s).
  Status: pending.
- [ ] **Criterion 8 — Preserve failures and publish them; no undisclosed rerun.**
  Evidence needed: signed publication-rule acknowledgment (incomplete/partial runs
  published as-is with full planned denominator; no rerun cherry-picking).
  Status: pending.
- [ ] **Criterion 9 — Partner verification stays pending until received.**
  Evidence needed: partner verification log showing "pending"; no claim of verification
  before it is received.
  Status: pending.

## 2) Budget / configuration record

Proposed ceiling **$2.10 = $2 Modal + $0.10 Spark** — proposed limit, prices to be
rechecked before authorization; not enforced by the current timeout.

| Item | Value to record | Frozen reference (from runbook / contract) |
|---|---|---|
| Source (commit) | ____ | full 40-char `git rev-parse HEAD`, not zeros/placeholder (`check_launch`) |
| Dataset identity | ____ | the sealed dataset; explicit `--cases <dataset>` only, launch refuses without it |
| `dataset_sha256` | ____ | recorded in JSON config; `check_launch` blocks on missing/mismatch |
| Model revision | ____ | 40-char hex revision (unpinned values blocked) |
| Image digest | ____ (`name@sha256:` + 64 hex) | pinned digest form; mutable tags blocked |
| Prompt hash | ____ | inline system prompt in `services/bot/src/private/redact.ts` (no separate file) |
| Response-schema hash | ____ | inline JSON schema (`spans[{start,end,label}]`, `boxes[]`) in same file |
| Scorer version | ____ | `services/bot/scripts/redaction-eval-lib.mjs` (+ runner `redaction-eval-runner.mjs`: canary-first, concurrency 2, unique run dir) |
| Decoding settings | ____ | `temperature 0.0, no top_p/top_k, reasoning_strength low` (E10, draft PR #76) |
| Retry policy | ____ | none (`retries=0`; no rerun cherry-picking) |
| Concurrency | ____ | 2 (runner); one unique run dir `/results/<run_id>/`, never reused |
| Token / request limits | ____ | `max_tokens 2048`; 90 s per-request timeout default; work deadline 780 s; function timeout 840 s; ready wait up to 300 s inside deadline |
| Canary case | ____ | case 1 runs first and is scored; on error the eval stops, exits 2, rest recorded `not_run` |
| Teardown | ____ | `python3 -m modal app stop second-seat-glimmer`; confirm scale-to-zero before closing budget |
| Proposed ceiling | $2.10 ($2 Modal + $0.10 Spark) | proposed limit, prices to be rechecked before authorization; not enforced by the current timeout |
| Actual cost | ____ | to be filled from receipt after an authorized run |

Any prepared holdout config must be re-frozen before launch — re-freeze it after the E10 decoding/prompt change (the frozen inline redaction prompt hash and decoding row change; E10, draft PR #76; hashed by the E14 prompt-freeze).

## 3) Execution checklist (do not run — preparation only)

- [ ] `check_launch` on the exact frozen config returns no blockers (dataset selected,
  hash matches, review attestation complete, source SHA valid, image pinned, model
  revision pinned).
- [ ] Single Modal attempt only — no second attempt without new authorization.
- [ ] Scored canary first (case 1); stop the eval on canary failure (exit 2, remaining
  cases recorded `not_run`).
- [ ] One Spark request only, with no automatic retries (`retries=0`).
- [ ] Owner approves the exact redacted payload before the Spark request is sent.
- [ ] Any extra Glimmer demo request is declared in writing; no hidden second GPU allocation.
- [ ] Teardown confirmed: app stopped, scale-to-zero confirmed, budget closed.
- [ ] Results fetched and offline rescore reproduces `summary.json` / `report.txt`
  for a complete run (for incomplete runs, partial-rescore artifacts published as-is).

## 4) Receipt template (all fields blank until an authorized run)

```text
B9 evidence-run receipt
authorization ref: ____
start time (CT): ____
end time (CT): ____
commit: ____
config hash: ____
dataset identity: the sealed dataset (____)
requests sent: ____
requests completed: ____
failures with reasons: ____
cost actual (Modal): ____
cost actual (Spark): ____
bundle path: ____
replay command: ____
replay result (match / mismatch + detail): ____
teardown confirmed (scale-to-zero): ____
publisher: ____
```

## 5) Publication checklist

- [ ] Publish failures as-is: canary-fail bundle (one `error` + explicit `not_run`
  records, `complete: false`, exit 2) or partial-batch bundle (each planned case keeps
  exactly one terminal status; end-to-end metrics keep the FULL planned denominator).
  Evidence needed: published bundle link. Status: pending.
- [ ] No undisclosed rerun: a disappointing run is never replaced with an undisclosed
  rerun; no cherry-picking remaining cases into a new run; no presenting
  completed-case metrics as the batch result.
  Evidence needed: run-id continuity log. Status: pending.
- [ ] A poor reproducible result is valid evidence and not proof of privacy or quality:
  acceptance depends on trustworthy measurement, not a favorable percentage.
  Evidence needed: results reported with limitations stated. Status: pending.
- [ ] Partner verification stays pending until received: no claim of partner verification
  before it arrives.
  Evidence needed: partner verification record. Status: pending.
