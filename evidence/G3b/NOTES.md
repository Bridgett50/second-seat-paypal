# G3b — staging fail-closed and single Spark attempt teardown

Parent c441fc7 (#87). Helper session f1876237-8a3c-45e3-ad3f-e7b63b8bee78, 1 attempt, verify passed (G3-8, G3-9 certified-regression; G3-10g, G3-11g, G3-12g guards).

Independent before (parent glimmer_app.py, head test): G3-8 FAIL `no-staging-evidence`, G3-9 FAIL `teardown-skipped`; guards 3/3 pass. After: 5/5. Full bot suite 307/307 (run by maintainer).

Behavior: an OSError while creating the staging dir or writing the frozen config is now a distinct `staging failed:` result. It removes only the staging dir this call created, writes and commits evidence, and never starts vLLM or the eval. On the run path the vLLM process group is torn down before the evidence write. An evidence-write failure is recorded as `evidence_write_error` and re-raised after commit. It is never silent.

Review note: on the normal path the `GLIMMER_RESULT_JSON` stdout line is now printed twice, once in the finally block and once at the original return. No consumer parses that stdout line (the file payload is the contract), so this is cosmetic. Left as-is and disclosed. No hand edits in this PR.

Tests run the module under fakes (no Modal, no vLLM, no inference).
