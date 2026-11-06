# Live launch config (confirmed by Bridgett Sanders, 2026-10-28)

`glimmer-launch-config.json` is the canonical nested run config (`services/bot/src/release/runConfig.ts` shape, configVersion 1) for the live Glimmer deploy:

```sh
GLIMMER_LAUNCH_CONFIG=config/live/glimmer-launch-config.json python3 -m modal deploy infra/modal/glimmer_app.py
```

With #99 (H3), the deploy ships these exact bytes into the container as `/root/glimmer-launch-config.json`.

**Status: confirmed.** Bridgett Sanders confirmed the pinned revision and image digest on 2026-10-28, so `review.status` is `reviewed`, `review.reviewer` is `Bridgett Sanders` and `review.reviewed_at` is `2026-10-28`. `validateRunConfig` now accepts this file. (It was drafted by Grok Bot as `PENDING-BRIDGETT-CONFIRMATION`; the review was recorded on Bridgett's explicit approval.)

**Re-freeze (2026-10-28, after #104):** #104 changed the Glimmer prompt and response schema, so the prompt and schema sha256 pins were recomputed with `frozen-identities.mjs` and updated. Bridgett Sanders approved the re-freeze for PR #104 (recorded in `review.note`). The model revision, image digest, dataset, scorer and `sourceSha` are unchanged. `validateRunConfig` returns VALID and `redaction-eval.mjs --run-config … --dry-run` no longer exits 2 with `re-freeze required`.

**Re-freeze (2026-10-28, 1:48 PM CT):** Bridgett Sanders approved a prompt-only change so `date_of_birth` is only a stated date of birth or birthday. Ordinary meeting dates stay unmasked. `prompt.sha256` was recomputed with `frozen-identities.mjs` (`287f1971666026c1df1f14628157873521a32f2e1d528ae882ccc05a8a92d1b5`). Schema, scorer, model revision, and image digest are unchanged.

Note: `serve()` reads only `model.revision`, the image ref/digest and `tokenLimits.contextTokens`, so a deploy would *not* stop on an unreviewed config. Validate before deploying (step 2 of the morning runbook):

```sh
node -e 'import("./services/bot/dist/src/release/runConfig.js").then(m=>{const e=m.validateRunConfig(JSON.parse(require("fs").readFileSync("config/live/glimmer-launch-config.json","utf8")));console.log(e.length?e:"VALID");process.exit(e.length?1:0)})'
```

## Where each value comes from (verified Oct 27, 2026, about 10:30 PM CT)

| Field | Value | Source |
|---|---|---|
| model.revision | `cec94fcfd6512f2cfe708138c32533b346ea4f69` | HF commit list for meta-models/Muse-Glimmer-30B (main head, Oct 21: "Create .eval_results folder and add mmi results #68") and `huggingface.co/api/models/meta-models/Muse-Glimmer-30B/revision/<sha>`. The repo is public (not gated), so no HF token is needed. |
| image.digest | `sha256:413c8fbecb1204a218117c77a4ea4b3a211d5686ff99c31d82ba6dd0cec8c5a6` | Docker Hub tag `vllm/vllm-openai:muse-glimmer` (last updated Aug 11, 2026), confirmed by the registry `Docker-Content-Digest` header. It is a multi-arch index (amd64 + arm64). |
| sourceSha | `ff2d63f…` | main when drafted (after #98). |
| dataset | `pii`, sha256 of `services/bot/fixtures/pii` | Public made-up dev fixtures. It is used only because the schema requires a dataset; serving doesn't use it. It is not the sealed holdout. |
| prompt/schema/scorer | `node services/bot/scripts/frozen-identities.mjs` | Scorer unchanged (`ba0a0756…`). Schema unchanged (`fa3842b7…`). Prompt re-frozen on 2026-10-28 1:48 PM CT to `287f1971…` after the owner-approved date-of-birth prompt change. |
| tokenLimits | 2048 / 16384 | `GLIMMER_MAX_TOKENS_DEFAULT` and the historical `--max-model-len`. |
| decoding | temp 0, seed 1, reasoning low | Historical extraction defaults, plus a fixed seed. |
