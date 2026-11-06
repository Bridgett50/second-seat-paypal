# Failure modes

Fixture mode, not production. Each row describes behavior the code actually
has; anything else is marked **not implemented**.

| trigger | behavior | status |
| --- | --- | --- |
| SAM returns zero matches | `segmentShared` returns a full-frame box plus flag `region_spotcheck_failed`; every box is clamped/verified inside the frame (`services/bot/src/vision/sam.ts`) | implemented |
| Muse Spark 504/429 | `postChat` retries 429/5xx up to 4 attempts with backoff plus `Retry-After`, then throws; 400 is never retried; there is no automatic fallback to a fixture and no flag is set (`services/bot/src/brief/muse.ts`) | not implemented (one-retry-then-fixture-plus-flag is not what the code does) |
| Glimmer timeout | Redactor requests carry max_tokens (default 2048) and a 90 s per-request timeout default (`glimmerTimeoutMs` in `services/bot/src/private/redact.ts`, overridable via `GLIMMER_TIMEOUT_MS`); `scripts/redaction-eval.mjs` catches a failed case, prints `case <file>: error ...` and counts its entities as misses | implemented (eval harness) |
| Glimmer timeout (live web) | Live session analyze defaults to a 240 s redaction timeout (`redactTimeoutMs` in `apps/web/src/session.ts`; offline 30 s, `SECOND_SEAT_REDACT_TIMEOUT_MS` overrides) and the live Glimmer client uses 240 s per request unless `GLIMMER_TIMEOUT_MS` is set; a live transcript took ~50 s, over the old 30 s | implemented |
| Glimmer misaligned spans | The model returns entity text + label, not offsets; `findEntityOccurrences` in `services/bot/src/private/redact.ts` computes every occurrence in code (exact, phones by digits, emails case-insensitive), ignores model offsets, and rejects text not in the input (`needsReview`). Live `prepare()` adds a deterministic phone/email regex backstop (`backstopContactSpans` in `gate.ts`) before the strict residual-PII check | implemented |
| cost cap hit | `checkCapsPreCall` refuses the live call by throwing `CostCapExceeded` once the daily call count or the $5/day spend cap is reached; per-call token guard via `checkPerCallTokenCap` (`services/bot/src/brief/costGuard.ts`) | implemented (refuse/stop, no partial call) |
| frame masking fails or is unavailable | the frame is dropped via `requireMasked`; an unmasked frame is never sent (`services/bot/scripts/hero-chain.mjs`). Image/SAM live calls are experimental, outside the core flow, and off by default (`SECOND_SEAT_EXPERIMENTAL_IMAGES=1`) | implemented |
