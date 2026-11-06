# Phase 06 — support-grading eval table

Judge: fixture (`synthetic-support-judge-v1`, prompt `support-v1`) standing in
for Spark `muse-spark-1.3` offline. No live calls were made. Live shape
(model, `reasoning_effort: "medium"`, seed, json-schema strict, streaming,
429/5xx retry, cost caps) is implemented in
`services/bot/src/judge/support.ts` (`SparkSupportJudge`) and covered by
shape-only tests.

Commands:

- `pnpm --filter @second-seat/bot support:run` writes
  `eval/results/support-judgments.jsonl` (raw judge outputs, proof).
- `pnpm --filter @second-seat/eval support -- --cases eval/fixtures/support-cases.json --judge eval/results/support-judgments.jsonl`
  verifies `eval/truth/SHA256SUMS` first, then scores.
- Baseline (judge disabled): same scorer with `--baseline` instead of
  `--judge`; suite FAILS (exit 1) because code-only checks pass mutants.

## Results (fixture judge, 2026-10-26)

| group | n | caught | rate | Wilson 95% CI |
|---|---|---|---|---|
| non-control (fixtures + mutants) | 9 | 9 | 1.000 | [0.701, 1] |
| controls (false alarms) | 4 | 0 | 0.000 | [0, 0.49] |

| case | kind | expected | got | missing_qualifier | overlap |
|---|---|---|---|---|---|
| F1-overreach | fixture | unsupported | unsupported | — | 0.444 |
| F2-paraphrase-drift | fixture | partial | partial | — | 0.625 |
| F3-dropped-qualifier | fixture | partial | partial | plus tax and freight | 0.833 |
| F4-confidence-laundering | fixture | partial | partial | projected | — |
| M1-wrong-date | mutant | unsupported | unsupported | — | — |
| M2-wrong-owner | mutant | unsupported | unsupported | — | — |
| M3-dropped-qualifier | mutant | partial | partial | if QA passes | — |
| M4-invented-decision | mutant | unsupported | unsupported | — | — |
| M5-hedge-to-certainty | mutant | partial | partial | — | — |
| C1-control-H-A1 | control | supported | supported | — | — |
| C2-control-H-Q1 | control | supported | supported | — | — |
| C3-control-D2-D1 | control | supported | supported | — | — |
| C4-control-H-U1 | control | supported | supported | — | — |

## Baseline (judge disabled)

Catch 0/9, rate 0.000, Wilson 95% CI [0, 0.299]; suite FAILED as required
(exit 1, 9 mismatches). Controls 0/4 false alarms.

Step 6 (open-weights second judge on Baseten) skipped: credits not approved.
