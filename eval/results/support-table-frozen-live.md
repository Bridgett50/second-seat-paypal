hash check ok: 16 files verified
mode: judge outputs
cases: 13 (9 non-control, 4 control)
| group | n | caught | rate | Wilson 95% CI |
|---|---|---|---|---|
| non-control (fixtures + mutants) | 9 | 9 | 1.000 | [0.701, 1] |
| controls (false alarms) | 4 | 0 | 0.000 | [0, 0.49] |
| fixture | 4 | 4 | 1.000 | |
| mutant:M1 | 1 | 1 | 1.000 | |
| mutant:M2 | 1 | 1 | 1.000 | |
| mutant:M3 | 1 | 1 | 1.000 | |
| mutant:M4 | 1 | 1 | 1.000 | |
| mutant:M5 | 1 | 1 | 1.000 | |
| control | 4 | 0 | 0.000 | |
| case F1-overreach (fixture) | 1 | 1 | expected unsupported, got unsupported | exact |
| case F2-paraphrase-drift (fixture) | 1 | 1 | expected partial, got partial + mq="We'll try to" | exact |
| case F3-dropped-qualifier (fixture) | 1 | 1 | expected partial, got partial + mq="plus tax and freight, freight quoted separately" | exact |
| case F4-confidence-laundering (fixture) | 1 | 1 | expected partial, got unsupported | MISMATCH |
| case M1-wrong-date (mutant) | 1 | 1 | expected unsupported, got unsupported | exact |
| case M2-wrong-owner (mutant) | 1 | 1 | expected unsupported, got unsupported | exact |
| case M3-dropped-qualifier (mutant) | 1 | 1 | expected partial, got partial + mq="conditional on QA sign-off" | MISMATCH |
| case M4-invented-decision (mutant) | 1 | 1 | expected unsupported, got unsupported | exact |
| case M5-hedge-to-certainty (mutant) | 1 | 1 | expected partial, got partial + mq="expect it in about a week" | exact |
| case C1-control-H-A1 (control) | 1 | 0 | expected supported, got supported | exact |
| case C2-control-H-Q1 (control) | 1 | 0 | expected supported, got supported | exact |
| case C3-control-D2-D1 (control) | 1 | 0 | expected supported, got supported | exact |
| case C4-control-H-U1 (control) | 1 | 0 | expected supported, got supported | exact |
json written to /workspace/ss-fix2/eval/results/support-score-frozen-live.json
SUPPORT SUITE FAILED: 2 case(s) mismatched
