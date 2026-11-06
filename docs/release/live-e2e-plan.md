# Live end-to-end run

Status: performed Oct 28, 2026 on main `0365fdb`, 3/3 passed. Rehearsals passed at `8c00c32` and on the November 15 prompt fix (#116). The commands below are the procedure for that run. This file does not authorize another live call. The sealed held-out run is scheduled for Nov 2; this plan does not open it.

Data: only the made-up transcript in [RECORDING_SCRIPT.md](../../RECORDING_SCRIPT.md).

## Exact commands

```sh
# 0. Build (offline)
pnpm install && pnpm -r build

# 1. Deploy the Glimmer vLLM server on Modal (A100-80GB, scale-to-zero).
#    GLIMMER_LAUNCH_CONFIG must name a canonical nested run config
#    (runConfig.ts shape, configVersion 1) with model.revision set.
#    The deploy ships those exact bytes into the container (H3).
GLIMMER_LAUNCH_CONFIG=config/live/glimmer-launch-config.json python3 -m modal deploy infra/modal/glimmer_app.py

# 2. Point the app at the endpoint Modal prints for the `serve` function,
#    then warm both models (one tiny request each).
export GLIMMER_BASE_URL=<https://…--second-seat-glimmer-serve.modal.run>
scripts/warmup.sh

# 3. Run the session live and walk RECORDING_SCRIPT.md in the browser:
#    http://localhost:4173/session?mode=live&demo=1
SECOND_SEAT_MODE=live pnpm --filter @second-seat/web serve

# 4. Stop the GPU as soon as you're done (don't rely on the scaledown window).
python3 -m modal app stop second-seat-glimmer
```

`META_API_KEY` must already be set in the shell. Never print it.

## Expected cost (estimate, not a billing cap)

| Item | Basis | Estimate |
|---|---|---|
| Modal A100-80GB | $0.000694/s (modal.com/pricing, checked Oct 27, 2026), about $2.50/h. Billable time: cold start and model load, the session, plus the 300 s scaledown window. Roughly 15–25 min. | $0.62–$1.04 |
| Spark brief | Live dev briefs averaged about $0.018 each (`eval/results/dev-briefs.md`). One brief plus one warmup ping. | about $0.02 |
| **Total** | | **about $0.65–$1.10. Proposed ceiling $1.50.** |

Worst case: a stuck container can bill until the 1500 s startup timeout, or up to the 3600 s function timeout, about $2.50. Step 4 is what prevents that. The code's cost guard covers estimated Spark spend only, not Modal.

## What would make it fail

1. **Launch config (fixed by the H3 PR; still needs a real config file).** Before H3, the deployed `serve` container never got `GLIMMER_LAUNCH_CONFIG` or `launch_contract.py`, so vLLM would have started with `--revision ''`. H3 ships both into the image at `/root/` with `Image.add_local_file`, and `serve()` now refuses to start without a pinned revision. The config with the verified revision and image digest is in `config/live/glimmer-launch-config.json` (H4 PR). Bridgett Sanders confirmed it on 2026-10-28 and its review fields are recorded, so `validateRunConfig` accepts it (see `config/live/README.md`). `serve()` itself does not check the review, so validate before deploying.
2. **Cold start.** If the weights volume `glimmer-weights` is empty, the first start downloads the 30B weights and can exceed the 1500 s startup timeout. The client/batch Glimmer timeout default is 90 s. The web session default is 240 s.
3. **Glimmer output.** The historical run completed 6/8. The two failures were invalid JSON and a length finish with empty output. Either one fails redaction.
4. **Residual PII.** If Glimmer misses the phone or email, the privacy gate refuses Analyze ("residual PII detected"). The owner must fix the preview first.
5. **Spark.** A 429 or 5xx gets 4 attempts total (at most 3 retries). The cost guard refuses past an estimated $5/day or 50 accounted completions per day. That is not a Modal cap.
6. **Config.** `SECOND_SEAT_TEST_MODE=1` forces offline even if live credentials are present. With `SECOND_SEAT_MODE` unset, the server stays offline. With `SECOND_SEAT_MODE=live` and `GLIMMER_BASE_URL` or `META_API_KEY` missing, server startup throws. It does not silently fall back to a fixture after live was requested.
7. **Auth.** The box needs a Modal token, and the key must be valid for `muse-spark-1.3`. The Glimmer client sends no auth header. If Modal proxy auth is enabled on the endpoint, Glimmer calls get 401. If it isn't, the endpoint is publicly reachable while it's up. That is a security note, not a fix made here.
8. **Oct 28 result.** The live session path passed 3/3 at `0365fdb`. The public link is demo mode with recorded examples. That live run is labeled as a written run summary (owner-attested, synthetic data), not a screen recording. Organizers confirmed recorded runs are fine if labeled.
