# New during the hackathon (Oct 26–Nov 4, 2026)

Daily log of work added in this repo. Everything below was built this week;
the earlier Second Seat idea and prototype live elsewhere and are not included.

## Submission facts (Oct 28, 2026)

- Live end-to-end passed 3/3 on main `0365fdb`. Rehearsals passed at `8c00c32` and on the November 15 prompt fix (#116).
- Verification is wired into the session (#113). Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it (#114/#115).
- The public link is demo mode with recorded examples. The live run is labeled as a written run summary (owner-attested, synthetic data), not a screen recording. Organizers confirmed recorded runs are fine if labeled.
- Video URL and user observations: PENDING. Founder story: done.

## Oct 28 — Phase 08 resistance table

- `eval/resistance-table.mjs` prints off, pattern-only, and pattern+Spark catch counts for the public dev fixtures. Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it. `--split heldout` exits before any held-out file is opened. No model call.

## Oct 28 — Phase 04b shield report

- `eval/shield-report.mjs` prints the dev-fixture check. Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it. `--split heldout` is accepted and refused before any held-out file is opened.

## Oct 26 — Phase 01: Repo bootstrap

- Workspace scaffold: root `package.json` (private, pnpm 9), `pnpm-workspace.yaml`, strict `tsconfig.base.json`.
- `packages/core` with transcript types and the outgoing safeguard (`screenOutgoing`, `classifyIncoming`), zero runtime dependencies.
- `services/bot` stub (fixture model client) and `apps/web` stub (hero heading).
- Tests: `outgoing.test.ts`, `core-deps.test.ts`, plus stub tests.
- CI with typecheck, tests, and a secret scan; README, `.env.example`, license pending note.
Truth seal proof: seal commit 3690746 (2026-10-26 12:14:14 -05:00), made before any model run, in squash-merged PR #2 https://github.com/Bridgett50/second-seat-hackathon/pull/2 (main 8abe1d1); SHA256SUMS sha256 at seal 1e68350f2b4a3b50cd1fc7dff67b52ee5eaf7ace3d66247dc0085faaf67b3614.
- Phase 03a: deterministic brief validators (`validateBrief` in `packages/core/src/evidence/validate.ts` plus `test/evidence-regressions.test.ts`).

## Oct 28 — Glimmer date-of-birth prompt

- Owner-approved change to the frozen Glimmer system prompt: only a stated date of birth or birthday is masked as `date_of_birth`. Ordinary meeting dates such as "November 15" stay in the text. The generic `DATE` alias no longer relabels those dates. Real DOB aliases still mask. Prompt hash re-frozen in `config/live/glimmer-launch-config.json` and `eval/results/prompt-freeze.md`. Model revision, image digest, schema, and scorer pins are unchanged. No new live model call in this change.

## Oct 28 — Verification wired into the session

- The session calls `verifyRedaction` before a send and `verifyBrief` after the brief. `verifyClaims` runs when recorded judge verdicts are present. Hard failures stop the step with a fixed "Needs owner review" line. Warnings escalate and do not block. Offline and Demo Mode use the same path. See `VERIFICATION.md`.

## Oct 28 — Clean UI rebuild + AI Twin stage

- Web UI design rebuilt fresh this week, inspired by the earlier prototype's look (soft purple/pink palette, rounded soft-shadow cards, pill badges, header bar). No code from the earlier prototype was copied; the theme is new plain CSS in `apps/web/src/theme.ts`.
- "AI Twin of Bridgett" stage panel beside the brief on `/session` and `/briefs/demo`, with a visible "AI-generated" label. It loads `apps/web/public/ai-self.png` (or `.jpg`) when present and otherwise shows a pastel "BS" initials placeholder.
- `apps/web/public/ai-self.png`: AI-generated image created Oct 28, 2026 by Bridgett with Pika AI Self (her own likeness). Only the image is used; no Pika UI elements.
- Demo Mode switch, both approval gates, and the loading states are unchanged in behavior. Tests: `apps/web/test/clean-ui.test.ts`, `apps/web/e2e/clean-ui.spec.ts`.
