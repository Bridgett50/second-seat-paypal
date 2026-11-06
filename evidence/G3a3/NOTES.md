# G3a3 — Modal function settings and runtime identities

Parent e6cfa46 (#86). Helper session fca0b475-656d-427e-850a-938bb9d45f28, 1 attempt, verify passed (G3-6, G3-7 certified-regression).

Independent before (parent glimmer_app.py, launch_contract.py, redaction-eval.mjs, redact.ts; frozen-identities.mjs removed; head test): G3-6 FAIL `function-settings-ignored`, G3-7 FAIL `identity-unchecked`. After: 2/2 pass.

Behavior: the frozen run config's Modal function settings (timeout, GPU/allocation, concurrency) are derived by `launch_contract.function_settings()` and applied by glimmer_app; `--run-config` refuses a config whose prompt/schema/scorer sha256 differ from the runtime identities computed by `services/bot/scripts/frozen-identities.mjs` (sha256 of the exact Glimmer system prompt, response schema, and scorer sources; public source only).

Hand edits (maintainer, disclosed, separate commit):
- services/bot/test/e2-runconfig.test.ts: E2-3 dummy config used placeholder identities, which are now (correctly) refused; it now uses runtimeIdentities() like the Muse-updated g2/g3a tests.
- eval/results/prompt-freeze.md regenerated with `node services/bot/scripts/prompt-freeze.mjs` (fixture mode, source only): the inline Glimmer prompt template in redact.ts moved into GLIMMER_SYSTEM_MESSAGE with "text" in place of the `${kind}` placeholder, so the template-source hash changed (87e3c1e7… -> 7211c665…). The bytes sent for text requests are unchanged; image requests substitute the kind as before.
Full bot suite 302/302 after these edits. Muse did not catch E2-3/E14F-3 despite the instruction to run the full suite.

Limitation: the runtime identity check proves the config matches the current source, not that a remote Modal image runs that source. No Modal operation, no inference.
