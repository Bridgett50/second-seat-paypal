# G2b — exclusive run-dir ownership and durable config evidence

Parent d34ecd4 (#83; helper base f3789bd + merged fixture fix). Criteria: G2-5..G2-8 regressions, G2-8g guard.

- before.txt: test/g2b-ownership.test.ts with the four source files restored from f3789bd. G2-5 `staging-reuse-refusal` (fresh frozen run exits 1 at the runner's "run dir already exists" refusal), G2-6 `evidence-modified` (reused run id still starts the node eval), G2-7 `no-failure-evidence`, G2-8 `silent-entry-drop`; G2-8g guard passes.
- after.txt: 5/5 pass. verify-1.json: passed, 4 certified-regression + 1 guard.
- Hand edits (Grok Bot, after the helper run): c5-wiring and d4-config CAPTURE_VLLM harnesses set `ga._RESULTS_ROOT = _tmp` (the old harness only patched `Path`, and staging now uses os.makedirs under _RESULTS_ROOT before vLLM starts, so C5-2 saw one vLLM command instead of two). Harness only, no assertion changed.
- Known limitation carried to G3-8: a staging OSError is reported with the "run dir reuse refused" prefix; G3-8 gives staging failure its own explicit evidence.
- Fake 127.0.0.1 server, inert modal stub, temp dirs only. No inference, no Modal, no sealed data.
