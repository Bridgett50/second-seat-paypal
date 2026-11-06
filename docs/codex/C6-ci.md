# C6 CI separation

Default CI ([ci.yml](../../.github/workflows/ci.yml)) runs only hermetic
offline steps: `pnpm install`, `pnpm -r typecheck`, `pnpm -r test`,
`pnpm -r build`, Playwright, and the secret scan.

- No sealed-data checks: the `node eval/check-hashes.mjs` truth-hash seal
  step was removed from the default job.
- No paid operations: `EVIDENCE_BRIEF_MODE=fixture` and all model access in
  tests is stubbed or guarded; package hooks (`pretest`/`prebuild`) only run
  `tsc` builds of workspace packages.

Sealed verification lives in
[sealed-verify.yml](../../.github/workflows/sealed-verify.yml), which runs
only via `workflow_dispatch` (manual authorization). Run it explicitly from
the Actions tab when a sealed check is authorized; never as part of ordinary
`push`/`pull_request` tests.
