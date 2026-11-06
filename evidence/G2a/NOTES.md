# G2a — canonical nested RunConfig is the only frozen launch input

Parent e681551 (#82). Criteria: G2-1, G2-2, G2-4 regressions; G2-3 guard.

- before.txt: test/g2-composition.test.ts run with the four source files restored to e681551 (tests from head). G2-1 fails `flat-nested-mismatch` (parent main() blocks a canonical nested config: dataset/source_sha/model_revision read from flat keys), G2-2 fails `no-projection-binding` (no project_launch), G2-4 fails `legacy-downgrade` (parent eval_in_container cannot bind a config sha; failure surfaces as a signature TypeError, which is a weaker failure reason than a behavioral downgrade — disclosed). G2-3 (drift) passes on both.
- after.txt: 4/4 pass on head.
- verify-1.json: helper attempt 1 (G2-1 still failing on head); verify-2.json: passed, G2-1/2/4 certified-regression, G2-3 guard.
- Fixture migration: flat configs in d4-config, c5-wiring, e8-gitsha, e2-runconfig, b5-acceptance tests moved to the canonical nested form (test lines removed; disclosed).
- Fake local HTTP server and temp bot tree only; no inference, no Modal, no sealed data.
- Hand edits: none to code; NOTES/cost/before/after written by hand.
- Hand edit (Grok Bot, after the helper run): added configVersion: 1 to d4RunConfig() in test/d4-config.test.ts; the helper's migration missed it, so D4-4 failed in the full suite (fullci and GitHub CI). Fixture-only, no assertion changed.
