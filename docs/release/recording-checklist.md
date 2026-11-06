# Recording checklist (one page)

Run from the repo root. Never show `META_API_KEY`, `MODAL_TOKEN_ID` or `MODAL_TOKEN_SECRET` on screen, and never run `env` or `printenv` while recording. Set secrets in the shell before you start screen capture.

## 0. Build once

```bash
pnpm install --frozen-lockfile
pnpm --filter @second-seat/web build
```

## 1. Live take

Timing: a cold start took 203 s on Oct 28. Modal scales the GPU to zero 300 s after the last request (`scaledown_window=300`). **Start recording within about 5 minutes of the last warmup request**, or keep it warm (step 3).

```bash
# Deploy the Glimmer server (A100-80GB, scale-to-zero). Skip if it is already deployed.
GLIMMER_LAUNCH_CONFIG=config/live/glimmer-launch-config.json python3 -m modal deploy infra/modal/glimmer_app.py

# Point the app at the URL Modal prints for the `serve` function. Set META_API_KEY in this shell too (not on camera).
export GLIMMER_BASE_URL=<https://…--second-seat-glimmer-serve.modal.run>

# Warm both models about 5 minutes before recording. Wait for "warmup: done".
scripts/warmup.sh            # all; or: scripts/warmup.sh glimmer | scripts/warmup.sh spark

# Serve the live app.
SECOND_SEAT_MODE=live pnpm --filter @second-seat/web serve
```

Open:
- Tab 1: http://localhost:4173/session?mode=live&demo=1
- Tab 2: http://localhost:4173/briefs/demo?demo=1

Check before you press record:
- The header says Live (not "Offline demo") and the **Demo Mode** switch shows **ON**.
- Redact shows "Redacting on Meta Glimmer (GPU)…" with elapsed seconds (about 12 s when warm).
- Analyze shows "Writing brief with Meta Muse Spark…" (about 13–20 s).
- Both approval buttons (Approve redacted text, Approve draft) are visible. Approve each one on camera.

## 2. Offline take (default and fallback, no keys, $0)

```bash
SECOND_SEAT_TEST_MODE=1 pnpm --filter @second-seat/web serve
```

Open http://localhost:4173/session?demo=1 and http://localhost:4173/briefs/demo?demo=1. The page labels itself "Offline demo". Say "offline demo" in the voiceover, not "live".

## 3. Keep-alive (only if recording slips past 5 minutes)

```bash
# Each request resets the 300 s scaledown. Every 4 minutes until you are done; Ctrl-C to end.
while true; do scripts/warmup.sh glimmer; sleep 240; done
```

## 4. Stop (always, right after the last take)

```bash
# Ctrl-C the web server, then stop the GPU app so it bills nothing further.
python3 -m modal app stop second-seat-glimmer
```

On-screen date note: the Oct 28 owner-attested run summary at `0365fdb` still shows the contract date "November 15" masked as `[REDACTED_date_of_birth]`, because that run used the previous prompt. PR #116 leaves ordinary meeting dates unmasked. The #116 rehearsal is an owner-attested live call, not an independently verified summary in this repo, and it is not a screen-recorded video. The current client in `services/bot/src/private/redact.ts` already sends the new prompt on each redaction request. `infra/modal/glimmer_app.py` does not reference that prompt. Redeploying Modal does not activate it. See README "Known Issues", [fr9-offline-rehearsal.md](fr9-offline-rehearsal.md), and [final-repair-acceptance.md](final-repair-acceptance.md). This checklist is not a statement that the Windows recording machine has passed.
