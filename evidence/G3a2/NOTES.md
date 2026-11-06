# G3a2 — output limit vs context, input bound, frozen decoding

Parent d6d8138 (#85). Helper session 2846b4fb-35ca-4c95-8da3-02c71d054302, 1 attempt, verify passed (G3-4, G3-5 certified-regression; G3-4g guard).

Independent before (parent sources of runConfig.ts, redact.ts, launch_contract.py, redaction-eval.mjs; head test): G3-4 FAIL `output-as-context`, G3-5 FAIL `decoding-constant`, G3-4g PASS. After: 3/3 pass. Full bot suite 300/300 after the hand edit below.

Also carried from G3a1: the GlimmerClient abort timer now stays armed through the response body read (clearTimeout moved after `res.text()`).

Hand edit (maintainer, disclosed, separate commit): services/bot/test/e2-runconfig.test.ts E2-2 asserted `--max-model-len == maxTokens (512)`, i.e. it encoded the G3-4 defect. It now sets `tokenLimits.contextTokens: 4096` and expects `--max-model-len 4096`. Muse's run did not run the full suite and missed this.

Limitations: the local input bound is a deterministic UTF-8 byte count (an upper bound on tokens, conservative), not the vLLM tokenizer; the server-side --max-model-len remains the enforcing limit. No live inference; fake fetch only.
