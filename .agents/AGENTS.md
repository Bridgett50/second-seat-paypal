# AGENTS.md — Muse Code helper rules (Second Seat)

Model: `muse-spark-1.3`, Standard mode. Expected cost ~$3 per PR.

## Scope

- Edit only files listed in `.muse/scope.txt`. Anything else: STOP and report.
- Never read, list, grep, or cat paths in `.sealed-paths`, anything matching
  `heldout-sealed` / `holdout-v1` / `eval/heldout`, `*.sealed*`, or `.env*`.
- Never print environment variables, secrets, or keys.

## Tests

- Failing test first: each new test must fail on the parent/base tree for the
  real bug (not a missing file/import), then pass with the fix.
- Never delete or weaken existing tests.

## Limits

- Do not commit, push, or open PRs, and do not add dependencies, unless asked.

## Report

For each run report: files changed, commands run, fail-then-pass test output,
and limitations.

The hooks in `.muse/hooks.json` (`.muse/guard.sh`) enforce part of
this: `pre` blocks sealed-path access and out-of-scope edits; `stop` blocks
stopping while `.muse/verify_pr.sh` fails (at most twice per session).
