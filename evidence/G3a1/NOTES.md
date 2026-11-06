# G3a1 — frozen request timeout, work deadline and concurrency reach execution (G3-1..G3-3)

Parent 97c80bf (#84). Criteria: G3-1, G3-2, G3-3 regressions; G3-2g, G3-3g guards.

- before.txt: test/g3a-runtime.test.ts with redact.ts, redaction-eval-runner.mjs and redaction-eval.mjs restored from 97c80bf (bot rebuilt). G3-1 `timeout-not-applied`, G3-2 `deadline-ignored`, G3-3 `invalid-concurrency-accepted`; guards pass.
- after.txt: 5/5 pass. verify-1.json: passed first attempt (3 certified-regression + 2 guard).
- Full bot suite at head: 297/297.
- Limitation: GlimmerClient now clears its abort timer once fetch resolves (response headers); the later body read is no longer under the same abort. Carried into G3a2's scope (redact.ts) to keep the timer armed through the body read.
- Fake fetch / fake 127.0.0.1 server and fake timers only. No inference, no Modal, no sealed data.
