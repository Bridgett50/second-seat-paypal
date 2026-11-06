# Model configuration (names only, no keys)

Live model calls never live in `packages/core`. All clients sit behind the
`ModelClient` interface in `services/bot`, run in fixture mode by default,
and log tokens and cost with a $5/day spend cap plus a daily call-count cap
(refuse-and-stop; see `services/bot/src/brief/costGuard.ts` and
[docs/failure-modes.md]).

Live mode is chosen ONLY by `SECOND_SEAT_MODE=live` together with
`GLIMMER_BASE_URL` and `META_API_KEY`; `SECOND_SEAT_TEST_MODE=1` always
forces offline (`apps/web/src/liveConfig.ts`). Live end-to-end was verified
on Oct 28, 2026 on `main` at `0365fdb`: 3/3 runs passed (Glimmer on Modal A100
redaction about 12.5 s, Spark `muse-spark-1.3` brief 13–19 s, all names/phones/emails
masked, about $0.22 GPU). The owner's private run summary
(`second-seat-live3-run-summary.md`, Drive) is the record. Rehearsals passed
at `8c00c32` and on the November 15 prompt fix (#116). The public link is demo
mode with recorded examples. The Oct 28 live run is labeled as a written
run summary (owner-attested, synthetic data), not a screen recording. The sealed held-out run is scheduled for Nov 2.

## Pinned models

- `muse-spark-1.3` — brief, Shield classifier, and support judge
  (`BRIEF_MODEL` in `services/bot/src/brief/muse.ts`).
  Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it.
- `meta-models/Muse-Glimmer-30B` — redaction (`GLIMMER_MODEL` in
  `services/bot/src/private/redact.ts`); served as
  `--served-model-name meta-models/Muse-Glimmer-30B` from image
  `vllm/vllm-openai:muse-glimmer` (`infra/modal/glimmer_app.py`).
- `sam-3.1` — experimental, outside the text-only core flow, off by default
  (live calls require `SECOND_SEAT_EXPERIMENTAL_IMAGES=1`).

## Optional models (later phases)

- `muse-voice-transcribe-1.0`
- `muse-wonder-1.0`
- `muse-image-1.0` — experimental, outside the text-only core flow, off by
  default (live calls require `SECOND_SEAT_EXPERIMENTAL_IMAGES=1`).

## Local setup

`export MODEL_API_KEY="$META_API_KEY"` (never print either value).
