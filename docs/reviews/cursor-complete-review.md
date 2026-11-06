# Complete review of PRs #53–#80

Review only. No commits, no pull requests, no model calls, no sealed data opened.
Head: `e70277faacdf607324bcc2831e2d38d7fb31f044`.
Stack base (immediate parent of #53): `059362d9e43186b2cf4b3207e3b3ee242549877b`.
Diff `059362d..e70277f`: 182 files.
Codex review B scored this head **5.78** and said its branch-file review was unfinished. This file finishes that file review. It does not replace 5.78.

## What Codex already covered

Codex cited these 23 files with a line. They are not re-reviewed here except where a later line in the same file was needed to trace a caller:

`.github/workflows/ci.yml`, `.muse/verify_pr.sh`, `README.md`, `apps/web/src/render.ts`, `apps/web/src/session.ts`, `apps/web/test/c3-contract.test.ts`, `docs/release/acceptance-registry.md`, `docs/release/c9-readiness.md`, `infra/modal/glimmer_app.py`, `infra/modal/launch_contract.py`, `scripts/ci/secret-scan.sh`, `scripts/muse_pr.sh`, `scripts/verify_pr.sh`, `services/bot/scripts/prompt-freeze.mjs`, `services/bot/scripts/redaction-eval-runner.mjs`, `services/bot/scripts/redaction-eval.mjs`, `services/bot/scripts/rescore-glimmer-run.mjs`, `services/bot/src/brief/muse.ts`, `services/bot/src/private/redact.ts`, `services/bot/src/promptCache.ts` (citation only; the comment is revisited below), `services/bot/src/release/runConfig.ts`, `services/bot/src/vision/sam.ts`, `services/bot/test/support/sealed-guard.mjs`.

EF-1 through EF-9 stand. This review does not re-derive them.

## Agreement and disagreement

Agree with Codex:

- The score arithmetic is internally consistent: Impact 3.0×0.30 = 0.900, Tooling 6.5×0.25 = 1.625, Depth 7.5×0.20 = 1.500, Demo 7.0×0.25 = 1.750, sum 5.775, displayed 5.78. Do not average it with the earlier 5.75 review of a different head.
- #76, #77, and #78 pass on the behavior Codex named. At this head, redaction temperature is 0.0 with the vLLM conflict disclosed, the live SAM path feeds `response.content_part.done` into `parseImageStream`, and cache keys are per family (`second-seat-brief`, `second-seat-shield`, `second-seat-support`).
- `services/bot/scripts/prompt-freeze.mjs` hashes the inline Glimmer system template, not only `prompts/*.txt`.
- A later repair does not make an earlier head's acceptance claim true. Per-PR verdicts stay attached to the head Codex judged.
- Green CI on every listed head is metadata. It is not acceptance.

Disagree, or add what Codex did not open:

- The earlier narrow review of head `9761e86` is stale. Do not use it to overturn #76–#78. Those three behavior passes are right at `e70277f`.
- `services/bot/scripts/holdout-freeze.mjs` was not cited. It is a real **fix** (CR-1). A manifest entry can pin bytes outside the dataset directory, and a failure can exit before it prints earlier hash failures. A mismatch also prints the annotation string.
- `.muse/guard.sh` was not cited. Codex's #79 limitation (regex hooks are narrower than a sandbox) is right, and the file confirms a sharper fact: a `bash` tool skips the scope check and the hook exits 0 (CR-3). That is evidence for the existing #79 **fix**, not a new block class.
- `services/bot/src/judge/support.ts:205` and `services/bot/src/shield/classify.ts:159` hardcode four attempts. `sparkProofClientOptions` never reaches them (CR-2). The web server does not construct these clients, so this does not move the text-demo path. It is still a **fix** for any live support or shield call.
- `services/bot/src/promptCache.ts:2` cites `meta-docs/general/prompt-caching.md:66`, which is not a file in this tree or in the public docs. The keys themselves match the public caching page (one stable key per shared prefix). This does not overturn the #78 pass. It is a comment defect (CR-4).
- The G1–G6 prompt does not name CR-1, CR-2, or CR-3. Additions are G7–G9 below. One instruction in that prompt conflicts with its own scope rule: folding META-01–META-07 into the G pull requests adds product work the G sections forbid. Do not do that inside G1–G6.

No category is rescored. EF-1–EF-5 already hold Technical Depth at 7.5. CR-1–CR-4 are additional fix items on files the score writeup never executed. A future full rescore may weigh them. This file does not publish a new number.

## How the remaining files were reviewed

Source was read with `git show e70277f:path`. Nothing was checked out. Reproductions used copied scripts and invented files under `/tmp`. No path named by `.sealed-paths` was opened. `eval/heldout-run.mjs`, `holdout-freeze.mjs`, and `holdout-dry-run.mjs` were not pointed at a real dataset. `eval/check-hashes.mjs` was not run. The product test suite was not run. The published SAM parser was not re-run against this head's fixture.

| Class | Disposition |
| --- | --- |
| Production source Codex did not cite | Read. Verdicts below. |
| `eval/heldout-run.mjs` | Control flow only. Not executed. |
| Tests, evidence JSON, screenshots, `pnpm-lock.yaml`, historical review docs | Listed, not line-reviewed. No new defect is claimed from them. Codex's test-evidence audit already classified the named suites and did not rerun them. |

## New defects

### CR-1 — fix (P1 for the freeze helper)

`services/bot/scripts/holdout-freeze.mjs:44` hashes `readFileSync(join(dir, file))` with no confinement. `file` comes from the manifest. `join("/tmp/hf-dummy", "../hf-outside.txt")` resolves outside the dataset, and a matching hash is accepted. The unpinned scan at `:54` is `readdirSync(dir)` only, so a file reached by `../` is never seen as extra.

Observed, dummy directory only:

- Manifest entry `../hf-outside.txt` with a wrong hash.
- Exit 1.
- First line: `holdout-freeze: hash mismatch ../hf-outside.txt`.
- That line exists only because the script read the outside file.

Two related failures in the same file:

- `:62–64` calls `process.exit(1)` when `cases.json` cannot be read, without printing failures already collected. Observed: a wrong hash for `ok.txt` plus a missing `cases.json` printed only `cannot read cases.json` and exited 1.
- `:75` prints the annotation on mismatch: `annotation not verbatim in note.txt: "INVENTED-ENTITY-NOT-IN-TEXT"`. Pointed at a real manifest, that line would print sealed strings. Do not run this script on a sealed directory.

`holdout-dry-run.mjs` is a different script. It requires `--dir`, installs a throwing `fetch`, and was not run. Its `sleep(25)` plus `deadlineMs: 1` is a timing probe, which the playbook does not treat as proof. No separate defect.

Block is the wrong label. This helper does not launch C9. It must not be treated as evidence that a dataset is pinned until G7 lands.

### CR-2 — fix (P2, off the web paste path)

`services/bot/src/judge/support.ts:205` and `services/bot/src/shield/classify.ts:159` set `const maxAttempts = 4`. Retries cover 429 and status ≥ 500. Each attempt calls `dispatchGuarded` again, which is the right revalidation shape, and the cap is still not the proof cap.

`services/bot/src/release/runConfig.ts:253` rejects a Spark proof config unless `retry.maxAttempts` is 1, and `:321` exports `sparkProofClientOptions`. Neither client imports it. `SparkSupportJudge` is selected only when `SUPPORT_JUDGE_MODE=live` (`support.ts:149`). `SparkPressureClassifier` follows `EVIDENCE_BRIEF_MODE=live` (`classify.ts:99`). `apps/web/src/server.ts:219` builds the live session store with a redactor, a gate, and an analyzer. It does not pass `pressureClassifier`. With the classifier argument omitted, `session.ts:1043` uses the deterministic patterns Codex already filed as EF-8.

So the text demo does not make these four-attempt calls. A live support or shield invocation does, and it ignores the frozen proof cap. Thrown errors also embed up to 500 characters of the provider body (`support.ts:221`, `classify.ts:175`). That body can echo submitted text. The web analyze route does not currently throw these errors.

This extends EF-4. It does not replace it. The eval path's "printed but not consumed" bug remains the launch blocker.

### CR-3 — fix (confirms #79; file was uncovered)

`.muse/guard.sh:74`: if the tool name does not match `write|edit|patch|apply|create|delete|move|rename`, the hook exits 0. The sealed-path regex still runs earlier for every tool. The scope check does not.

Observed, copied hook, invented JSON, no repo checkout:

- Input tool name `bash`, command `echo hi > /tmp/not-sealed.txt`.
- Exit 0. No deny.

The sealed regex was not shown to be bypassable. A split-string attempt still contained the contiguous sealed spelling and was denied. Do not claim a regex bypass from this review. Codex already said the hook is narrower than a sandbox. The missing piece was this line and this exit code. #79 stays **fix**.

### CR-4 — fix (comment only; #78 behavior stays pass)

`services/bot/src/promptCache.ts:2` points at `meta-docs/general/prompt-caching.md:66`. That path is not in the repository. The public page is `https://dev.meta.ai/docs/features/prompt-caching`. The constants at `:4–8` are stable and per family, which is what that page asks for. No behavior change is required. The comment should cite the public page or be deleted.

## Uncovered production files with no new defect

| File | Verdict | Why |
| --- | --- | --- |
| `AGENTS.md` | pass | Three-line pointer to `.agents/AGENTS.md`. No fictional path. |
| `apps/web/src/server.ts` | pass | POST allowlist rejects unknown fields (`validatePostBody`). `/api/test/outbound` and `/api/test/expire-approvals` return 404 unless `SECOND_SEAT_TEST_MODE=1` (`:270–274`). Live store does not attach the Spark pressure client. |
| `apps/web/src/cacheRatio.ts` | pass | Sums numeric `cachedTokens` / `inputTokens` and renders them. Percent is null when input is 0. Values are numbers, so the HTML interpolation is not an injection sink. |
| `apps/web/src/loadFixtures.ts` (usage slice) | pass | Cache usage is taken only when both token fields are numbers (`:426–429`). Historical 0-of-2271 display is a recorded fixture, consistent with Codex E12. |
| `.github/workflows/sealed-verify.yml` | pass, do not run | `workflow_dispatch` only (`:4–5`). Comment says it is the separately authorized path. Checkout is full (`:11`), unlike `ci.yml`'s sparse checkout. That is the point of this job and also why G work must not dispatch it. Not a new block. |
| `scripts/ci/repeat-check.sh` | pass | CI passes two explicit vitest files. Not executed here. |
| `scripts/ci/clean-build-check.sh` | pass | Rebuild plus `GET /briefs/demo` under `SECOND_SEAT_TEST_MODE=1`. Not executed here. |
| `eval/heldout-run.mjs` | pass on the live-call question, not certified | The brief CLI throws if `EVIDENCE_BRIEF_MODE=live` (`services/bot/src/brief/cli.ts` live branch), so inheriting the environment cannot turn this scorer into a paid brief call. The script was not run. It writes per-case error text and missed ids into a log. Leave it unused. |
| `services/bot/scripts/holdout-dry-run.mjs` | no new defect | Requires `--dir`. Replaces `fetch` with a throw. Not run. |

`eval/check-hashes.mjs` defaults to `eval/truth`. It was not opened beyond that fact and was not run.

SAM `mask_encoding: "one_bit"` is still sent and is still undefined by `protocol/sam3.md`. Codex passed #77 with the experiment kept off the core path. That residual stays inside the #77 pass. `services/bot/scripts/hero-chain.mjs` still has its own parser. Do not add a port of it.

## G1–G6 conflicts and gaps

No conflict with the repair order G1a → G1b → G2a → G2b → G3a → G3b → G4a → G4b → G5 → G6, the append-only commit rule, the sealed-data ban, or the $0 provider-spend rule.

Conflicts:

- The ecosystem half says to fold META-01–META-07 into the G pull requests. The G half says not to add product features and to keep each PR small. Follow the G half. META items stay proposals until G1–G9 are done.
- G1's scope is `verify_pr.sh` checkout order and the helper's case evidence. It does not mention `.muse/guard.sh`. CR-3 would survive G1.
- G2 and G3 name the eval CLI, the run directory, and the proof client. They do not name `holdout-freeze.mjs` or the support/shield `postChat` functions. CR-1 and CR-2 would survive G2–G3.
- G6's "targeted suites" must not include `sealed-verify.yml`, `holdout-freeze.mjs`, `holdout-dry-run.mjs`, or `eval/heldout-run.mjs`.

`promptCache.ts`'s dead citation belongs in G5's claim reconciliation, as a one-line comment fix, not a new behavior PR.

## G7 — confine the holdout freeze checker

Scope: `services/bot/scripts/holdout-freeze.mjs` only. One append-only commit. No product feature. Do not point the script at a sealed directory, a real manifest, or any path named by `.sealed-paths`.

Defect: CR-1. `join(dir, file)` accepts `..`. Failure output prints annotation text. A missing `cases.json` discards earlier hash failures.

Required behavior:

- Resolve every manifest path and every case file path and require the resolved real path to stay inside the dataset directory. A `..` segment, an absolute path, or a symlink that leaves the directory is a failure.
- On that failure, do not read the outside file. The outside file's bytes must be unchanged and unread.
- Print every collected failure, then exit nonzero. A missing `cases.json` does not hide an earlier hash mismatch.
- Failure text names the relative path and the failure class. It does not print file bytes or annotation strings.

Acceptance, all offline, invented directory under `/tmp`:

- G7-1. Parent: manifest entry `../outside.txt` whose hash equals that outside file. The parent exits 0 or reports a hash match, which means it read outside. Head: exit 1, message class is path-escape, outside file not read.
- G7-2. Parent: wrong hash for `ok.txt` and no `cases.json`. The parent prints only the `cases.json` error. Head: prints the hash mismatch and the missing-file error, exit 1.
- G7-3. Parent: annotation string absent from the note. The parent prints the annotation. Head: prints the path and `annotation-mismatch`, and the annotation string does not appear.
- G7-4. A clean invented directory with every file pinned, `inference_runs` 0, review pending, and annotations that are verbatim still exits 0. This guard may pass on the parent. Label it a guard.

The before-evidence must be the path read or the dropped failure, not a missing script.

## G8 — scope-check shell tools in the Muse hook

Scope: `.muse/guard.sh` only. One append-only commit. Do not run the hook against the real repository. Do not weaken the sealed-path regex.

Defect: CR-3. After the sealed check, a tool name that is not an edit verb exits 0 at `.muse/guard.sh:74`, so a shell command is never compared with `.muse/scope.txt`.

Required behavior:

- A shell, bash, or exec tool whose command string creates, writes, deletes, moves, or redirects into a path is judged against `.muse/scope.txt` the same way an edit tool's path is.
- Missing scope file still denies edits, including those shell writes.
- A shell command with no write (for example `git status`) is not a scope violation.
- The sealed-path deny still runs first for every tool, including shell.
- Do not pretend the regex is a sandbox. The acceptance text must say a command that hides a sealed path from the regex is still outside this fix. G1 remains the checkout-order fix. G8 is the scope hole.

Acceptance, copied hook, invented JSON, dummy scope file:

- G8-1. Parent: `tool_name` `bash`, command redirects outside the scope file's roots, sealed regex does not match. Exit 0. Head: deny, reason class `out of scope`.
- G8-2. Same command with a path the scope file allows. Head exits 0. Parent already exits 0. Label it a guard.
- G8-3. `tool_name` `bash` whose command string contains a sealed spelling. Parent already denies. Head still denies. Label it a guard.
- G8-4. Edit-like tool name and a path outside scope. Parent already denies. Head still denies. Label it a guard.

## G9 — one attempt cap for support and shield

Scope: `services/bot/src/judge/support.ts` and `services/bot/src/shield/classify.ts`, plus a test that constructs those classes with a fake `fetch`. Do not add a new call from `apps/web/src/server.ts`. Do not change the session's default of "no classifier" (`session.ts:1043`). One append-only commit.

Defect: CR-2. Both `postChat` functions hardcode four attempts. The proof helper's `maxAttempts: 1` is not an input.

Required behavior:

- Each client takes `maxAttempts` from its constructor. The default used when a caller is explicitly building a proof client is 1.
- The existing development default may stay 4 only on a constructor argument that the test names as development, not as the implicit default of `new SparkSupportJudge()` / `new SparkPressureClassifier()`.
- A 429 or 500 response is retried only while attempts remain. Attempt 1 with `maxAttempts: 1` does not call `fetch` again.
- Each attempt still goes through `dispatchGuarded`. A revoked approval throws before the next fetch.
- The error thrown to callers does not include the provider body. It includes the status code.
- `createWebServer` still does not pass a pressure classifier. A regression test fails if the live session options gain `pressureClassifier`.

Acceptance, fake `fetch`, invented gated text, no network:

- G9-1. Parent: one 429 then a 200, default constructor. Two fetches. Head: default constructor, one fetch, then the failure.
- G9-2. Head with an explicit development `maxAttempts: 4` still retries a 429. Parent already does. Label the "retries when asked" case a guard only if the parent already honors an argument. Today the parent has no argument, so the parent of G9-2 cannot show this. Write G9-2 as a head-only positive after G9-1, and do not call it a parent regression.
- G9-3. Approval revoked after the first attempt. Head does not issue the second fetch. If the parent already revalidates, mark the revalidation a guard and still require the cap change.
- G9-4. A 400 response's thrown message contains the status and does not contain a sentinel planted in the fake body.

## What this review did not do

- Did not rerun Codex's probes for EF-1–EF-9.
- Did not run the product suite, Playwright, or the Muse helper.
- Did not open sealed paths, truth files, or presealed manifests.
- Did not rescore 5.78.
- Did not rewrite `office-hours-questions.md`. Codex's office-hours list in review B is a different set and is not adopted here.

END OF FILE
