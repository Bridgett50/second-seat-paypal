# Muse Code implementation prompt — Second Seat G1–G6

You are implementing the G1–G6 repair cycle for Bridgett50/second-seat-hackathon.

Your objective is a reliable text-only paste-to-copy assistant, a safe offline verification workflow, and a composable, evidence-bound future launch. Implement the repairs below as small, reviewable PRs. Do not add product features.

Starting review:
- docs/codex/codex-E-F-review.md if already present and identical to the supplied review; otherwise use the separately supplied codex-E-F-review.md.
- Reviewed stack tip: e70277faacdf607324bcc2831e2d38d7fb31f044, draft PR #80.
- Previous review score: 5.78/10. This is context, not an implementation acceptance criterion.
- All existing PRs were drafts. Do not merge them.
- Preserve the C/D/E history and all unrelated user changes.
- If the current head differs, inspect ancestry and allowlisted source changes, record the actual starting SHA, and check which defects still exist. Do not reset or force-push to recreate the old state.
- Treat review findings as hypotheses to verify against code. Do not copy a prior verdict into an evidence ledger as a new test result.

## Authorization and hard blocks

AUTHORIZED: implementation, local tests using invented unsealed inputs and fake transports, and preparation of small draft PRs after their automated workflows have been proved safe.

BLOCKED:
1. No live model inference, Modal operation, cloud image build, GPU allocation, Baseten call, Fireworks inference, paid eval, or provider experiment.
2. No reading, listing, opening, copying, hashing, regenerating, packaging, or inspecting actual sealed data or its manifests. This includes eval/heldout/, holdout-v1, /workspace/heldout-sealed, sealed manifest files, and equivalent aliases.
3. Do not run gen/make.py.
4. Do not clone, archive, download, checkout, or create a full worktree of the real repository if doing so materializes sealed content. A checkout followed by exclusions is forbidden.
5. No broad tests, generators, package hooks, or CI trigger until their complete execution path is inspected for sealed access and paid operations.
6. No printing secrets, dumping environment variables, reading .env files, or committing credentials.
7. Do not invoke scripts/muse_pr.sh, another Muse process, nested agents, paid verification helpers, or automatic paid retries. Work within this already authorized coding session. Use the helper's safe offline verifier only after G1.
8. Do not authorize C9, unseal data, populate real holdout identities, or spend the proposed $2.10.
9. Do not merge, deploy, publish the app, submit the entry, send messages, or contact partners.

The exclusion-policy file .sealed-paths may be read as policy metadata. It is not authorization to access any path it names. Never confuse that policy file with an actual sealed manifest.

Readonly GitHub metadata requests needed for G5 are allowed. Use an existing authorized connector/CLI and do not expose credentials. No CI reruns or new pushes until workflow safety is established.

If Muse cannot edit locked .agents/ or .muse/ paths, prepare an exact unified patch and an application/check procedure in a new unsealed handoff directory. A human or authorized maintainer must apply it. Do not weaken sandbox permissions, relocate protections to writable paths, or claim the change landed before it did. Continue independent work where possible; dependent execution stays blocked until the applied locked-file bytes are verified.

## Working and PR rules

Use append-only commits and merge commits to propagate changes through the existing stack. No rebase, squash, amend of published commits, or force-push for this cycle.

Use this order:
G1a → G1b → G2a → G2b → G3a → G3b → G4a → G4b → G5 → G6.

These are proposed small PR labels; use the repository's normal naming convention without renumbering acceptance IDs. If a split is unnecessary because the change is tiny, combine adjacent parts only when the resulting diff remains independently reviewable and every criterion is retained.

Each PR must:
- Identify its exact parent and final head SHA.
- State the concrete broken behavior and resulting behavior.
- List scope, tests actually run, parent failures, head passes, guards, and limitations.
- Include no unrelated refactors, dependency upgrades, dashboard/image features, or historical-artifact rewrites.
- Remain draft and unmerged.
- Trigger CI only after its relevant workflow has a verified nonsealed path.
- Record current CI against the exact head. A merge-forward commit changes the head and needs fresh evidence.
- Preserve failing cases and negative observations.

Before a draft PR can be pushed, verify the workflow it would trigger. If safe pushing cannot be established, leave a local commit plus a concrete draft PR body and report the blocker.

## Failing-first standard

For every NEW BUG REGRESSION:
1. Write the smallest behavioral counterexample.
2. Run that exact case against the relevant parent implementation in an isolated, allowlisted source harness or a newly created dummy repository.
3. Observe the intended failure, not missing files, missing exports, import errors, syntax errors, no-tests-found, setup failures, or a timeout.
4. Apply the repair.
5. Run the same case on the repaired implementation and require the intended assertion to pass.
6. Keep a valid positive control.
7. Record the case ID, exact source identities, harness changes, command, exit status, and decisive assertion for both runs.

Do not run the old unsafe verifier on the actual repository to obtain before-evidence. G1 before-evidence must use a fresh dummy Git repository and copied allowlisted helper source only.

For an EXISTING-BEHAVIOR GUARD:
- It may pass on the parent.
- Label it guard; do not manufacture a parent failure.
- Do not present a file's nonzero exit as proof every test in that file failed.
- Do not count a missing new helper/export as behavioral proof.

Use controlled promises, explicit transport-entry signals, held requests/responses, and clocks the production code actually reads. No timing sleeps, busy polling, or installed-but-still-running clocks masquerading as a paused debounce interval.

Mocks must match actual interfaces. Use an inert Modal SDK-shaped stub; never import the real SDK for these checks. Stub subprocess execution before application import where needed. Install a deny-all network fallback in test harnesses; explicitly injected fake transports are the only permitted inference transports.

Tests must observe behavior at the real caller boundary. A computed settings object, dry-run printout, source-text match, green CI run, or test title is insufficient.

All temporary repositories, sentinel data, state, logs, processes, and timers must be test-owned and cleaned up on success and failure. Verify cleanup targets remain inside the test workspace before recursive deletion.

## G1a — Safe base-tree materialization from the first operation

Scope:
- .muse/verify_pr.sh
- scripts/tests/muse-helper.test.sh
- A small extracted offline helper only if needed.

Defect:
The verifier currently performs git worktree add --detach before applying sparse exclusions. Real sealed files can be copied before the final tree is made sparse.

Required behavior:
Create the worktree without checkout, configure exclusions/allowlisting before materialization, and fail closed if policy setup fails. Preserve the no-copy invariant throughout the entire operation, not merely at the final assertion.

Use a fresh dummy repository with an invented forbidden-fixtures/sentinel.txt tracked in Git and a dummy policy excluding it. No actual sealed path or actual sealed manifest may be used.

Acceptance tests:

G1-1 — Checkout ordering
- Instrument the materialization operation in the dummy repo.
- Assert the forbidden sentinel is never materialized or copied at any intermediate point.
- Parent must fail because ordinary worktree add creates it before sparse setup.
- Head must pass using no-checkout followed by verified policy setup and allowed materialization.
- Assert an allowed source file is materialized correctly, so an empty/no-op checkout cannot pass.

G1-2 — Policy setup failure
- Inject failure in the sparse-policy setup command.
- Assert nonzero verifier result, zero checkout/materialization operations after that failure, zero preparation/test commands, and no forbidden sentinel in the target.
- Do not fall back to a full checkout or ignore the failure.

G1-3 — Policy missing or malformed
- Missing/unreadable/invalid policy must produce an explicit refusal before materialization.
- Test both absent policy and a policy rejected by the chosen parser.
- A valid dummy policy and allowed source positive control must work.

G1-4 — Complete helper path
- Invoke the real corrected verifier on the dummy repo.
- Observe the base worktree creation, test-file copying, preparation, test execution, evidence export, and cleanup.
- Assert none reads or copies the forbidden sentinel.
- Confirm no worktrees/processes/test-owned directories survive, including on injected failure.
- Scope this claim to the inspected commands; do not call regex hooks a general filesystem sandbox.

Do not begin broad real-repository testing until G1a is applied and its bytes are verified.

## G1b — Honest per-case failing-first evidence

Scope:
- .muse/verify_pr.sh
- scripts/tests/muse-helper.test.sh
- Criteria/evidence schema and its focused tests.

Required behavior:
The verifier must distinguish bug regressions from guards and record decisive case-level evidence. It must not certify every test in a file from one aggregate failure.

Acceptance tests:

G1-5 — Empty criteria
- Valid JSON with an empty test list must fail verification explicitly.
- No success summary may be emitted.
- Include a nonempty valid criteria positive control.

G1-6 — One failing test cannot certify two regressions
- A dummy command runs two named cases: case A fails on parent and passes on head; case B passes on both.
- When both are declared new regressions, verification must reject B's missing before-failure.
- When B is explicitly declared a guard, A may certify a repair and B must be reported as a guard.
- Assert exact case identities and statuses in the output.

G1-7 — Wrong failure reason
- Missing module/export, syntax error, no tests found, setup/preparation failure, and timeout must not count as intended behavioral before-failure.
- Test preparation failure separately from a valid test failure.
- A real assertion failure tied to the declared counterexample must be accepted.
- Do not implement this solely as a larger error-message regex.

G1-8 — Assertion weakening
- Replace an important assertion with a vacuous assertion while leaving the test count unchanged.
- The verifier must not label the result proof of the original criterion.
- Either reject the change or require explicit reviewed disclosure and mark the criterion uncertified.
- Do not claim general semantic weakening detection from test-declaration counts.

G1-9 — Evidence identity
- Output parent SHA, tested head/source identity, case ID, command, classification, expected/observed failure, and limitations.
- An aggregate command failure cannot silently populate case-level failures.
- Existing cache-ratio behavior may remain a guard that passes on its parent.

## G2a — One composable canonical execution configuration

Scope:
- services/bot/src/release/runConfig.ts
- infra/modal/launch_contract.py
- infra/modal/glimmer_app.py
- services/bot/scripts/redaction-eval.mjs
- Focused inert integration tests.

Defect:
main accepts a flat Python launch config, but the container stages those same bytes as the nested TypeScript eval config. The actual child CLI rejects it. Pure builders and dry-run tests miss this composition.

Choose one explicit design:
- One canonical config accepted and consumed across boundaries; or
- A canonical execution config plus an explicit bound launch projection.

Do not accept ambiguous hybrid objects with conflicting string/object fields. Preserve all identities and execution settings through the mapping. Keep any legacy compatibility path explicit and outside the frozen-run path.

Acceptance tests:

G2-1 — Real composition
- Create one fully invented valid canonical config and dummy dataset.
- Import the real app under an inert SDK-shaped Modal stub.
- Exercise the local entrypoint and capture image construction and spawn arguments.
- Execute the actual child eval CLI with a fake transport through an explicit test harness.
- Assert one dummy case completes and the recorded run identifies the same config.
- Parent must fail for the actual flat/nested schema mismatch.
- Missing builders/imports are not acceptable before-evidence.

G2-2 — Explicit projection binding
- If separate files/objects are used, capture their identities and exact mapping.
- A changed dataset ID, model revision, image digest, or execution-config identity must block before spawn/eval.
- Parent/head tests must distinguish canonical validation from mapping failure.
- No real dataset identities may be filled in.

G2-3 — Same-path drift
- Import config A, replace its bytes at the same path with config B, then invoke main.
- Assert zero spawns and an explicit drift error.
- Identical-byte aliases must follow the documented policy.
- Keep this as an existing guard if it already passes on the parent.

G2-4 — No downgrade to legacy defaults
- Missing execution config, missing mapped section, unknown required version, and invalid projection must stop.
- Assert zero eval subprocess invocations and zero fake inference requests.
- An explicit legacy CLI mode must never be selected implicitly by a frozen launch.

## G2b — Exclusive run-directory ownership and durable config evidence

Scope:
- infra/modal/glimmer_app.py
- services/bot/scripts/redaction-eval-runner.mjs
- launch/download integration tests.

Defect:
Staging /results/<run_id>/run-config.json creates a directory the runner refuses to reuse.

Acceptance tests:

G2-5 — Fresh run succeeds with config evidence
- Follow the real staging and runner path with an invented config and case.
- Assert a fresh run succeeds, config evidence is retained, raw receipts and terminal records are case-keyed, and strict replay reproduces the result.
- Parent must fail with the existing-directory refusal after staging.
- Keep all filesystem paths inside the dummy workspace.

G2-6 — Reuse protection
- Attempt the same run ID after both a completed run and an interrupted run.
- Assert refusal before inference and no modification of existing evidence.
- Do not remove reuse protection to make G2-5 pass.

G2-7 — Ownership failure
- Inject failure when acquiring/creating the owned run directory.
- Assert no inference, explicit failure evidence, and cleanup only of newly owned temporary resources.
- Never delete another run's directory.

G2-8 — Downloader compatibility
- Download the complete dummy run using SDK-shaped FileEntry objects, including nested files and directories.
- Assert exact bytes and replay equality.
- Reject traversal/absolute paths.
- Label existing passing checks as guards rather than new fixes.

## G3a — Frozen settings reach actual execution

Scope:
- runConfig.ts
- launch_contract.py
- glimmer_app.py
- redaction-eval.mjs
- redaction-eval-runner.mjs
- services/bot/src/private/redact.ts
- Focused configuration/transport tests.

Required behavior:
Every accepted frozen execution field must affect the actual boundary it names, or be rejected as unsupported. A settings object or DRYRUN JSON is insufficient.

Acceptance tests:

G3-1 — Request timeout
- Choose a nondefault invented request timeout.
- Capture the timeout/deadline signal delivered to the real fake transport.
- Hold the response, advance the controlled clock used by the client, and assert termination at that bound.
- No sleep and no real network.

G3-2 — Work deadline includes preparation
- Use a controlled clock advanced during dummy input preparation.
- At expiry, assert zero canary/remainder requests and all planned cases not_run.
- With remaining budget, assert the runner receives the correct remaining deadline rather than an unrelated hardcoded default.
- Keep the existing expired-before-canary guard.

G3-3 — Concurrency
- Hold fake requests behind deferred promises.
- For a nondefault configured concurrency, assert the exact maximum simultaneously entered transports and eventual planned-case completion.
- Include concurrency=1 and an invalid bound refusal.
- Count actual transport entries, not worker array length.

G3-4 — Output, context, and input limits
- Separate server context capacity from maximum generated tokens.
- Capture vLLM argv and actual request max_tokens from one config.
- Assert total input/generation budgeting is coherent; output limit must not be reused as the entire server context limit.
- Use a deterministic fake tokenizer/budget calculator for local tests and document its production counterpart.
- An oversized invented request must refuse before transport.
- No model download or real tokenizer checkpoint access is authorized.

G3-5 — Decoding
- Independently vary accepted temperature, seed, and reasoning settings.
- Assert each in the actual serialized fake request body or explicit validation refusal if unsupported.
- Never accept a value and quietly send a different constant.
- Keep public development policy fixed; do not tune using a holdout.

G3-6 — Function/readiness settings
- Capture the inert app function timeout and readiness/work budget parameters from the validated config.
- Unsupported dynamic settings must be rejected, not merely recorded.
- Assert model load/readiness consumes the work budget.
- Do not claim any of these is a hard dollar cap.

G3-7 — Prompt/schema/scorer identities
- Compute identities only over allowlisted public source or newly invented files.
- Alter the inline prompt, schema, or scorer after a dummy freeze.
- Assert the frozen-run path refuses before inference or requires an explicit new freeze.
- A source hash in a document without runtime comparison does not pass.
- Do not access any prepared real holdout config.

## G3b — Fail closed on staging and prove a single Spark attempt

Scope:
- glimmer_app.py
- The actual future Spark proof-entrypoint configuration path
- services/bot/src/brief/muse.ts only if necessary
- Inert app/fake HTTP tests.

Acceptance tests:

G3-8 — Staging failure
- Inject PermissionError or equivalent when writing the execution config.
- Assert zero eval subprocess invocations and zero fake inference requests.
- Assert explicit failure evidence and termination of the inert vLLM process tree.
- Parent must fail because it continues without --run-config.
- No fallback to defaults or development fixtures.

G3-9 — Cleanup on evidence-write failure
- Inject failure in evidence writing after the inert server starts.
- Assert teardown is still attempted and the failure remains visible.
- Do not claim actual Modal hard-kill durability from a local finally test.

G3-10 — One Spark proof HTTP attempt
- Construct the actual proof client from the same validated proof configuration.
- Return fake 503, fake 429, and a fake transport error in separate cases.
- Assert exactly one HTTP invocation/attempt receipt per case and no scheduled retry.
- Test a valid successful response as a positive control.
- Changing a printed maxAttempts value without changing the actual client must fail.

G3-11 — Approval at dispatch
- Hold real adapter preflight; edit/revoke; release.
- Assert zero outbound requests and zero dispatch receipts.
- On a separate retry-capable development path, fail attempt one, revoke before retry, and assert no second fetch.
- Do not enable retries in the bounded proof path to test this guard.

G3-12 — Complete offline rehearsal
- Through the real composed entrypoint, complete one invented Glimmer eval case and one invented owner-approved Spark proof using only fake transports and the inert SDK.
- Assert actual attempt counts, request settings, launch identity, run ownership, receipt metadata, teardown, download, and replay.
- Do not interpret rehearsal success as model accuracy or paid-run authorization.

## G4a — Coherent negative pressure evidence

Scope:
- apps/web/src/session.ts
- services/bot/src/brief/muse.ts
- packages/core/src/evidence/pressure.ts and relevant schema/types
- Focused unit and fake-transport tests.

Known defect:
tactic=none can bypass segment/span provenance validation and become valid_negative/allReviewed=true.

Choose and document a single negative-result contract. For example, an explicit validated assessment-level negative with no positive labels. Do not leave contradictory none-with-positive-span records silently accepted.

Acceptance tests:

G4-1 — Contradictory none
- Return tactic=none with a nonempty positive span.
- Assert failed/unavailable or explicit invalid evidence, never valid_negative/allReviewed=true.
- Parent must fail semantically, not because a new type is missing.

G4-2 — Invalid negative provenance
- Test none with a bad segment ID, invented text, unknown fields, and a malformed value.
- Assert refusal or visible invalid assessment with Copy blocked.
- Apply the policy at both the session boundary and direct adapter validation.

G4-3 — Mixed evidence
- Return a valid positive plus a contradictory/invalid negative.
- Assert the invalid item cannot be silently dropped to claim a fully valid assessment.
- If partial assessments are supported, give them an explicit state/reason and keep Copy blocked until resolution.

G4-4 — Positive and negative controls
- Valid positive quote/citation requires review.
- A valid explicit negative is visible as negative, not failed.
- Thrown classifier error and absent classifier are distinct from a valid negative.
- Neither an all-invalid array nor an exception may become reviewed success.

G4-5 — Outbound provenance
- Invent an unapproved contact string in every assessment field accepted by the API.
- Assert it is rejected or omitted by a documented safe contract, with no unapproved text in the actual HTTP body.
- For rejected inputs assert zero fetches and receipts.
- Do not falsely claim a none field leaked when the renderer actually omits it.

## G4b — Terms and capability claims match evidence

Scope:
- session.ts
- Pressure rendering/types/tests
- README and relevant video narration only where behavior changes.

Acceptance tests:

G4-6 — Unresolved-term provenance
- A term occurring elsewhere in approved text must not automatically become the unresolved term for an unrelated cited pressure item.
- Require a declared cited-term relation and policy, or display term not identified.
- Test an invented unrelated term, a term from another segment, and the whole cited sentence.
- Verify the selected policy at the rendered UI and outbound boundary.
- Do not claim that substring matching proves semantic unresolvedness.

G4-7 — Pattern disclosure
- The default pattern path stays labeled deterministic pattern detection in offline and live configurations.
- Do not label input conditioning as Spark-returned pressure classification.
- Test a known positive with an exact nonempty quote and current citation; zero detections cannot pass.

G4-8 — No hidden call
- The normal text analysis still makes the declared single Spark request.
- No new classifier call, feature, or paid integration may be added to improve a rubric score.
- If a model-returned assessment is implemented within the existing response, test it through fake HTTP and validate it separately; keep live execution blocked.

## G5 — Exact release evidence and honest verification ledger

Scope:
- README.md
- docs/release/acceptance-registry.md
- docs/release/c9-readiness.md
- docs/submission/video-script.md where needed
- Focused metadata/ledger validation tests.

Acceptance tests:

G5-1 — CI identity mismatch
- Use invented GitHub run metadata with a run head_sha different from the row's tested SHA.
- Validator must reject the pairing.
- An exact match passes.
- A deliberately historical row may pass only when labeled historical with its original tested identity; it must not count as current acceptance.

G5-2 — Real readonly reconciliation
- Fetch the actual current PR/run metadata through an authorized readonly connector.
- Record run ID, full head SHA, conclusion, observation time and source URL.
- Replace stale C-row links or preserve them explicitly as historical.
- Do not rerun or trigger CI during this step.
- Offline metadata fixtures test the validator; they are not themselves proof a current remote run exists.

G5-3 — Probe provenance after merge-forward
- A recorded before/after probe belongs to its exact source identities.
- Change a row's SHA without re-executing the probe: the validator must reject current-proof status or mark it historical/unverified.
- Record any source-equivalence check narrowly; it is not a fabricated rerun.

G5-4 — Complete canonical IDs
- Compare exact sets across the canonical registry and readiness ledger.
- Missing, duplicate, invented or abbreviated-away IDs must fail.
- Retain all existing 113 C/D IDs and add the G criteria explicitly without dropping old unresolved requirements.
- Do not change a canonical criterion merely to make implementation pass.

G5-5 — Per-case classifications
- Each case is bug regression, existing guard, static check, preparation-only, human/pending, or not independently certified.
- A guard that passes on parent cannot be counted as a newly fixed bug.
- Missing-import failure cannot be labeled intended behavioral failure.
- Failed/unexecuted criteria cannot become PASS from CI success alone.

G5-6 — Claim reconciliation
- Text-only flow, deterministic pressure, experimental/off-path SAM, historical cache usage and missing live evidence are described accurately.
- Founder story, buyer observations, partner verification, video and submission URLs stay pending until humans provide evidence.
- C9 stays blocked, budget stays proposed, and historical incomplete runs retain full denominators.
- No mock latency as live performance; no fixture score as model accuracy.

## G6 — Final safe rehearsal and reviewable evidence bundle

Scope:
- Existing text-flow browser tests
- One newly invented public demo scenario
- Focused release checklist and evidence index
- No product features.

Only begin after G1–G5 and the relevant workflow boundary are verified.

Acceptance tests:

G6-1 — Complete paste-to-copy journey
- Use the actual browser UI and actual server/store path.
- Paste invented meeting text, redact, correct the preview, approve, analyze via fake HTTP, review current pressure items, edit a reply, approve that exact draft, and copy.
- Assert exact clipboard bytes, including whitespace/newlines.
- Assert exact outbound approved text and absence of removed invented PII in Spark bodies.
- A stub that bypasses the gate or replaces the copy implementation does not pass.

G6-2 — Held-approval intent matrix
- Process approval A and hold its response.
- Test A→B, A→B→A, and A→empty→A with a genuinely paused debounce clock.
- Assert current text remains visible, Copy stays disabled, and server approval becomes false after the immediate reject is processed.
- Render from a fresh server snapshot to assert no stale approval resurrection.
- Test actual reload/session recovery separately if claiming persistence; do not call setContent(snapshot) a real reload.
- A fresh explicit approval must restore Copy in the positive control.

G6-3 — Stale correction and pressure acknowledgement
- Hold correction A response, edit B, complete invalidation, release A: zero stale approve requests; server stays unapproved.
- Capture A's p1 acknowledgement, analyze B with another p1, deliver A's acknowledgement: B stays unreviewed.
- Repeat after reanalysis of identical text.
- Uncheck Reviewed after draft approval: server review revoked and Copy disabled.

G6-4 — Receipts on the active page
- Hold preflight: UI says prepared/not dispatched; zero fetches/receipts.
- Enter actual fake fetch at t1 and hold provider response: the existing page shows invoked/outcome pending and t1 without manual refresh.
- Finish at t2: payload/history retain t1.
- Throw after invocation: attempted dispatch remains visible as failed/unknown; never claim nothing was sent.
- Edit while a poll response is held: releasing it cannot restore stale result, draft or approval.
- Assert poll/timer cleanup after completion, invalidation and page disposal.

G6-5 — Valid/invalid responses and denominators
- Reject wrong meeting IDs and malformed nested citation regions through the composed fake HTTP path.
- Valid empty response remains an honest empty response.
- Two planned five-span dummy cases with one failure yield completion 1/2, completed coverage 5/5 and full coverage 5/10.
- Reasoning-only/length/malformed output counts as failure; never substitute reasoning text as the answer.
- Preserve terminal not_run/error records, raw receipts and planned denominators.

G6-6 — Strict read-only replay
- Test altered totals, unknown status, duplicate/missing/unexpected receipts, changed error/finish metadata, duplicate/aliased planned IDs, subset summaries and torn trailing records.
- API, CLI, report and nested completion flags agree.
- Missing comparison evidence is not complete_match.
- Verify only dummy bundle bytes/mtime and explicitly unsealed historical outputs are unchanged; do not hash any sealed artifact.

G6-7 — Safe targeted execution
- Run the relevant affected safe suites, clean build and full fake-transport journey at the exact final candidate.
- Run the targeted isolation checks twice.
- Check all test-owned processes/timers/directories are cleaned up.
- Do not run a broad suite merely because it is named in a package script; inspect imports, hooks and subprocesses first.
- Preserve actual failures and environment limitations.

G6-8 — Evidence bundle
- Produce one unsealed evidence index naming candidate SHA, parent identities, cases, commands, classifications, outcomes, CI identities and limitations.
- Include concise decisive assertion output, not secrets or full environment dumps.
- No screenshots/videos or observations may be invented.
- New merge commits require new relevant evidence; do not relabel old output.

G6-1 and any already working positive/negative controls may pass on the parent and must be marked guards. Every newly repaired failure must have its own behavioral before/after proof. Do not sabotage working parent code to satisfy a failing-first checklist.

## Human-only tasks and blocked execution

Keep these separate from implementation PR acceptance:
- A maintainer applies reviewed locked-path patches where Muse cannot.
- Bridgett supplies the real founder story and records the planned buyer tryouts.
- A human records the demo and checks public submission links.
- An independent reviewer accesses/reviews the sealed holdout only after separate explicit authorization.
- The owner separately approves the exact frozen live configuration, redacted Spark payload and spending.
- Partner verification is obtained through the authorized process.
- A release owner publishes/submits and confirms the deadline.

Do not perform those tasks, contact people, invent their evidence, or mark them complete.

The eventual paid-run preparation must account for:
- One declared allocation and scored canary included in the planned set.
- Actual consumed settings, complete raw evidence, teardown and download.
- A single declared Spark proof attempt.
- Any extra Glimmer demo request explicitly included in the budget.
- Current provider rates and an enforceable bound if claiming a literal hard $2.10 ceiling.
- Full denominators and no undisclosed reruns or cherry-picking.

This prompt does not authorize that run, any model call, any Modal operation, or sealed access.

## Final handoff format

After each small PR, report:
1. Exact parent/head and draft PR URL, or local commit plus the concrete blocker to pushing.
2. Scope and resulting behavior.
3. Each acceptance ID with implementation/test file:line.
4. Parent and head result for each new regression; guard results separately.
5. Actual commands and decisive assertions.
6. Unverified cases, platform limitations and remaining blockers.
7. Proof that no paid service or sealed input was used.

At the end, provide:
- A complete G1–G6 acceptance matrix.
- One current release/evidence index.
- The ordered draft PR list using merge commits only.
- Separate pending human tasks.
- A clear statement that C9 paid execution and sealed holdout access remain BLOCKED.

Do not promise a first-place score. Complete the observable engineering repairs and preserve honest evidence of exactly what was tested.

## Independent meta-models ecosystem audit and ranked adoption backlog

Audit date: 2026-10-27. Second Seat comparison baseline: draft PR #80 at [e70277faacdf607324bcc2831e2d38d7fb31f044](https://github.com/Bridgett50/second-seat-hackathon/tree/e70277faacdf607324bcc2831e2d38d7fb31f044). This is an independent source survey added to the G1–G6 implementation prompt. It is not a new execution authorization, a new live-model result, or a revised hackathon score.

### Coverage disclosure — do not represent this as an exhaustive code audit

The request to read every public repository, every branch, every issue, every PR and every commit has NOT been fully satisfied at that depth. The live GitHub repository search returned five public repositories and no second-page results. I enumerated their public branch collections, all-state issue/PR collections, default-branch commit histories, and histories reachable from each listed branch head. I read all five root READMEs, selected relevant recipe documentation and source files, and selected issue discussions. I did not read every file on every branch, every commit diff, every PR diff/review, or every issue comment. Enumerating a commit is not reviewing its patch.

The inventory below covers 107 listed branches, 283 issue/PR entries (164 PRs and 119 non-PR issues), and 557 distinct commits within their respective repositories reachable from those branch heads. Commit counts are unions within each repository, not counts of newly introduced features. Generated documentation history in the SDK contributes many commits. Deleted branches, inaccessible objects, tag-only histories and future changes are outside this inventory. Collections were read sequentially, so this is a pinned-head survey, not an atomic organization-wide snapshot.

The cached organization page showed four repositories; the live repository search exposed the fifth, legal-agent-workshop. That is why the inventory uses live search rather than relying on the cached page.

| Public repository | Pinned main head | Branches | Issues including PR entries | PRs | Reachable commits across listed branches |
|---|---|---:|---:|---:|---:|
| [meta-model-cookbook](https://github.com/meta-models/meta-model-cookbook) | 0a99b987858ec4e49c04fc3f114bf33851e81deb | 32 | 74 | 55 | 106 |
| [meta-oss-cookbook](https://github.com/meta-models/meta-oss-cookbook) | a6c315d703170ac29751eb160eecb977d16e3a88 | 43 | 65 | 64 | 160 |
| [muse-code-sdk](https://github.com/meta-models/muse-code-sdk) | a45cb67cd2e27c8b6b4b55dcbaae6e6341123ea4 | 15 | 113 | 15 | 253 |
| [legal-agent-workshop](https://github.com/meta-models/legal-agent-workshop) | 2a8efc86c70d9a42d76db0afb6ae1511e5a86d8e | 3 | 4 | 3 | 3 |
| [meta-sam](https://github.com/meta-models/meta-sam) | 40318970a81301f31e97cdd7d605117293332b0f | 14 | 27 | 27 | 35 |

No sealed holdout, sealed manifest, workshop ground truth, withheld case world, or solution data was inspected. No model requests, Modal actions, Baseten calls, GPU allocations, provider experiments, generation scripts or upstream recipe commands were executed. Reading a recipe that contains such commands does not authorize running it.

### What Second Seat already uses

Do not sell these as newly discovered missing integrations:

- Glimmer on Modal/vLLM, the muse_glimmer reasoning parser, low reasoning strength, bounded completion settings, strict span validation and label aliases. These are existing paths; their effective configuration and end-to-end success remain the issue.
- Optional constrained JSON for Glimmer, rather than an established guarantee that the frozen run exercises the constraint.
- Spark analysis with streaming, schema validation, token/cached-token reporting and prompt-cache keys.
- The official @meta-sam/parser 0.1.0 dependency and experimental SAM integration. Image/SAM are outside the core text workflow.
- Muse Code development, helper guardrails and restricted execution intent. These do not prove command enforcement or a live successful application flow.
- Approval, receipts, replay and evaluation infrastructure. G1–G6 repair their observable boundaries; a new library does not substitute for those tests.

Comparison evidence: the [reviewed Second Seat tree](https://github.com/Bridgett50/second-seat-hackathon/tree/e70277faacdf607324bcc2831e2d38d7fb31f044), including [bot package dependencies](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/package.json), [Modal host](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/infra/modal/glimmer_app.py), and the G1–G6 findings above. There is no direct Muse Code SDK dependency in the inspected bot/web/root package manifests. Claims of absence below apply to this reviewed source scope, not every historical branch of Second Seat.

### Ranked opportunities: proof and repair first

Effort is an engineering estimate for one contributor already familiar with this codebase. It excludes human approval, live inference, new hardware setup and partner verification. Risk describes implementation and evidence risk, not a measured probability. The ordering is expected value for this deadline, not model capability or a guaranteed rubric-point increase.

Rows marked “fold into G” should strengthen the already authorized repair without creating another architecture. Rows marked “backlog” are proposals, not instructions to implement them in this cycle. No row authorizes paid runs or sealed access.

| Rank | Opportunity and adoption status | Source | Exact action for Second Seat | Estimated effort | Risk / disposition |
|---:|---|---|---|---|---|
| 1 | Prove constrained output is actually requested and validated; partly adopted | [Glimmer structured-output recipe](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/recipes/structured-output/README.md) | Fold into G2/G3: bind schema identity, enabled state and supported request shape to the canonical configuration and captured transport. Reject unsupported/missing constraints when the frozen plan requires them. Preserve semantic span validation after JSON parsing. | 2–4 h | Medium. Syntactic JSON validity does not establish redaction recall; fake transport proves wiring, not runtime compatibility. |
| 2 | Resolve contradictory sampling guidance and expose reasoning exhaustion; partly adopted | [vLLM guide](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/inference-server/vllm.md), [reasoning-effort recipe](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/recipes/reasoning-effort/README.md) | Fold into G3: record the chosen sampling profile with provenance and actual body; do not silently change an already frozen run. Keep reasoning separate from final content. Record finish reason, final-content emptiness and available reasoning/token usage so capped reasoning cannot become a successful answer. | 2–4 h | Medium. The vLLM page warns against greedy decoding while another recipe uses temperature 0. Resolve for the pinned runtime/checkpoint; neither recipe proves this task's accuracy. Live validation remains blocked. |
| 3 | Gate on independently expected replay output, not command success; partly adopted | [deterministic replay recipe](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/02_deterministic_replay/README.md), [gate source](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/02_deterministic_replay/artifacts/replay_gate.sh) | Fold into G1b/G5/G6: committed public invented records plus hand-reviewed expected projections; empty fixtures, partial load, unknown status and nonzero diffs must fail. Mutate a record while preserving its expected result and show the actual gate fails. | 2–4 h | Low. Directly addresses false-green evidence. Replaying records against themselves is still not a golden comparison. |
| 4 | Bind the final outbound action at the handler boundary; existing gate needs proof | [local Glimmer → approved Spark recipe](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/03_use_cases/15_glimmer_api_agent/README.md), [handler source](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/03_use_cases/15_glimmer_api_agent/remote-model/__init__.py) | Strengthen G6 with exact approved text, destination, run/revision and immediate pre-send validation. No fallback provider, hidden history or plugin rewrite may change the approved payload. Show denial, revocation during preparation, payload edit and retry all send zero requests. Reuse Second Seat's gate; do not install Hermes. | 2–4 h | Medium. The recipe is a useful design comparison, not a stronger drop-in privacy boundary; its ledger has weaknesses described below. |
| 5 | Honest intent/attempt/outcome records and interrupted-send semantics; partly adopted | [append-only audit/resume recipe](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/01_append_only_audit_log/README.md) | Fold into receipt evidence: distinguish prepared, authorized intent, transport invocation, response and unknown outcome. An error after transport entry cannot become “nothing sent.” Do not retry an unknown side effect automatically or claim exactly-once delivery without receiver support. | 3–6 h | Medium. Durable-before-send logging is a separate contract from dispatched=true; never set dispatched=true merely because an intent was logged. |
| 6 | Test enforcement separately from prompts and command filters; partly adopted | [contained execution](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/04_contained_execution/README.md), [immutable guardrails](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/05_immutable_guardrails/README.md) | Fold into G1/G5: inspect and test helper argv, cwd, policy and file materialization. Where supported, use an isolated temporary fake workspace to prove OS denial of an invented protected path and blocked network, without accessing a real sealed path. Report unavailable platform enforcement honestly. | 3–6 h | Medium–high across platforms. A regex, agent refusal or sandbox status label does not establish process-level enforcement. Never disable the sandbox to make the proof pass. |
| 7 | Citation integrity and explicit uncertainty; partly adopted, semantic verification not established | [workshop architecture](https://github.com/meta-models/legal-agent-workshop/blob/2a8efc86c70d9a42d76db0afb6ae1511e5a86d8e/README.md), [claim checker source](https://github.com/meta-models/legal-agent-workshop/blob/2a8efc86c70d9a42d76db0afb6ae1511e5a86d8e/agent/verification/verify_claims.py) | Backlog after G6: strengthen deterministic quote/offset checks against the approved redacted snapshot and disclose unsupported conclusions. If adding an uncertainty field, validate it inside the existing Spark result schema using fake responses. Do not add the workshop's extra model-judge call. | 3–5 h | Medium. Exact quote existence is not semantic entailment; the workshop checker fails open on malformed judgments and cannot be copied as a fail-closed verifier. |
| 8 | Typed “needs human review” result for insufficient evidence; not proven as a complete contract | [alert-triage recipe](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/recipes/alert-triage-copilot/README.md) | Backlog: represent missing evidence explicitly, with nullable fields and a review state. Preserve one existing Spark analysis call and the deterministic pressure path. The UI must not show “safe” merely because a model omitted a finding. | 3–5 h | Medium. Do not import its multi-call remediation architecture or treat model self-assessment as calibrated confidence. |
| 9 | One clear local/private → approved remote explanation; partially true for current architecture | [Glimmer approval recipe](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/03_use_cases/15_glimmer_api_agent/README.md) | Fold into G6/docs: show the real boundary. For Second Seat, raw text reaches the team's Modal Glimmer service, then the user reviews the redacted Spark payload. Use “self-hosted service” when applicable; do not claim on-device or that raw text never left the user's computer. | 1–2 h | Low. Stronger honest demo value than another integration. No Hermes or messaging surface is needed. |
| 10 | Shared SAM conformance and object-prompt helpers; parser already adopted | [SAM repository](https://github.com/meta-models/meta-sam/tree/40318970a81301f31e97cdd7d605117293332b0f), [object-prompt PR #18](https://github.com/meta-models/meta-sam/pull/18) | Backlog: remove divergent experimental parser behavior only if maintaining that feature; reuse official conformance cases appropriate to the installed version. Object prompts, graphics and confidence-driven mask display stay out of the core text workflow. | 3–6 h | Medium–high. An image pipeline revives masking, retention and full-frame fallback risks with little value to the current demo. |
| 11 | Direct Muse Code SDK/MSP integration; not installed directly in the inspected manifests | [SDK README](https://github.com/meta-models/muse-code-sdk/blob/a45cb67cd2e27c8b6b4b55dcbaae6e6341123ea4/README.md), [approval update report #10](https://github.com/meta-models/muse-code-sdk/issues/10) | Defer. If ever adopted, pin SDK and host versions, handle approval updates and disconnects with simulated wire events, and prove effective model/settings at the transport. Keeping the existing CLI helper is cheaper for this deadline. | 1–3 days | High. Developer Preview, host coupling and reported session/approval/platform issues; integration alone adds no user outcome. Tests may spawn a real Muse host and must not be run wholesale. |
| 12 | Quantized/alternative-runtime Glimmer for cheaper private serving; not validated for Second Seat | [OSS cookbook](https://github.com/meta-models/meta-oss-cookbook/tree/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer), [current vLLM guide](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/inference-server/vllm.md) | Research backlog only: require exact checkpoint/revision, quant format, runtime/image, GPU kernel support, usable context and an authorized public-development comparison before replacing A100 bf16. Weights fitting is insufficient evidence of serving viability or preserved recall. | 1–2 days plus separately authorized inference | High. Do not promise RTX 6000/L40S FP8 or NVFP4 viability from a cookbook label. This audit performed no hardware test and established no cheaper price. |
| 13 | Hosted inference fallback; not a validated core path | [hosted inference overview](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/hosted/README.md) | Defer. A hosted option might reduce cold-start engineering, but requires a new explicit trust-boundary description, approval scope, provenance and budget. It must never silently replace the approved self-hosted redactor. | 4–8 h wiring plus separate authorization | High privacy/evidence risk. Does not prove the Open Weights infra-partner requirement. Credits are not permission. |
| 14 | Muse Code staged approvals for compound shell commands; helper partly guarded | [staged approvals](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/03_staged_approvals/README.md), [pre-exec binding request #90](https://github.com/meta-models/muse-code-sdk/issues/90) | Preserve strict helper command construction rather than adding a shell language. If commands become compound, all stages must clear before any stage executes. Human/agent approval of displayed shell text alone cannot prove what native spawn resolves. | 4–8 h if helper scope expands | High. SDK #90 requests an additional binding mechanism; an open feature request is not a shipped guarantee. No need to expand the helper now. |
| 15 | API compaction, search grounding, tool loops and long context; not core features | [Model API cookbook catalogue](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/README.md) | Cut from this cycle. Use bounded text and deterministic local citations. Search adds destinations and disclosures; compaction adds provenance and retention questions; larger context raises memory and cost. | 1–3 days per substantial feature | High. More tokens or tools do not establish better privacy or stronger evidence. |
| 16 | Goal judges, subagents, reminders, scheduled loops, side chats and skills | [Muse Code recipes catalogue](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/README.md), [SDK feature/issue collection](https://github.com/meta-models/muse-code-sdk/issues) | Cut from the product. Development-session export may help provenance if already available locally, but do not spawn agents, run judge calls or schedules to obtain it under this blocked authorization. | 0.5–3 days depending on feature | High scope/billing risk. Background or auxiliary calls undermine the one-bounded-run story unless separately accounted for. |
| 17 | Muse Image, voice/realtime, glasses, computer use, robotics, generated visuals | [full API cookbook catalogue](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/README.md) | Cut from the text assistant. They can be future directions, clearly labeled. Do not add them to a three-minute demo as working capability. | Several days or hardware-dependent | Very high scope/privacy risk; mostly unrelated to the current paste-to-copy outcome. |
| 18 | Glimmer SFT/RL and learning across cases | [OSS cookbook catalogue](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/README.md), [workshop learning-loop proposal #4](https://github.com/meta-models/legal-agent-workshop/issues/4) | Cut. No training, no mining holdout mistakes, no regenerating sealed data and no carrying withheld answers into prompts. Fix deterministic plumbing and honest scoring first. | Multiple days and compute | Very high cost and contamination risk; an issue proposing learning is not a released training capability. |

The best single stack improvement is verified constrained Glimmer redaction feeding an exact approved Spark request, backed by replayable receipts. Much of that stack is already present. The missing value is proof that it works under the declared configuration, rather than another Meta logo.

### Upstream recipes are not automatically safe templates

1. **The legal workshop's semantic judge fails open.** In [verify_claims.py:50–54](https://github.com/meta-models/legal-agent-workshop/blob/2a8efc86c70d9a42d76db0afb6ae1511e5a86d8e/agent/verification/verify_claims.py#L50-L54), a malformed JSON judgment returns passed=true. Lines 38–39 also return success for an empty selected findings list. The model call itself is an extra inference request. Transfer the separation of claims from evidence, not this permissive failure policy. A fake malformed judgment must produce unknown/blocked in any future Second Seat verifier; a “proven” finding without valid evidence must fail.

2. **The approval example's egress ledger is best-effort.** [remote-model/__init__.py:60–68](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/03_use_cases/15_glimmer_api_agent/remote-model/__init__.py#L60-L68) swallows an OSError when appending. The request occurs at line 137, and the “sent” row is appended only after a response at lines 143 onward. A successful dispatch followed by a network error is not represented by that successful sent row. Do not copy this as proof of durable dispatch accounting. Its digest-derived approval also does not substitute for Second Seat's run/revision binding and revocation requirements.

3. **Replay viewer success is not regression-gate success.** The [recipe](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/02_deterministic_replay/README.md) explains that the viewer can exit zero despite projection diffs. Raw session inspection without an expected projection is not a golden test. Check load status, schema, fixture count and actual diff content.

4. **The vLLM guide explicitly labels its commands unverified end to end.** Its [status banner and runtime instructions](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/inference-server/vllm.md) are not evidence that Second Seat's pinned Modal image runs them. The guide also distinguishes a published model-specific image from released pip wheels. Verify actual image/runtime identity; do not replace the existing image blindly or claim compile-checking proves GPU compatibility.

5. **Reasoning shares the output budget.** The [reasoning recipe](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/recipes/reasoning-effort/README.md) separates reasoning from final content. Empty final content after length termination is an unsuccessful redaction response, even if reasoning contains plausible spans. Do not turn historical failed reasoning into a final answer or a new success numerator.

6. **Long-context issue reports can correct themselves.** [OSS issue #37](https://github.com/meta-models/meta-oss-cookbook/issues/37) initially says an override is required. Its [author correction](https://github.com/meta-models/meta-oss-cookbook/issues/37#issuecomment-5521985972) states the recommended YaRN flags already lift that cap in the tested build. A [later follow-up](https://github.com/meta-models/meta-oss-cookbook/issues/37#issuecomment-5522429261) discusses scaling and limited quality probes. Do not repeat the original conclusion without its correction, generalize it to vLLM, or copy flags into this short-text workload. This survey did not reproduce those measurements.

7. **Media-retention reports reinforce the text-only cut, not a general retention claim.** [Model cookbook issue #61](https://github.com/meta-models/meta-model-cookbook/issues/61) reports inline image/video account-file persistence for contributor API requests on specific October dates. No comments appeared in the fetched discussion. This is an unreplicated public report, not a verified current policy for all models or text requests. Do not use it to assert that current text is retained or not retained. Keep image uploads disabled.

8. **Accepted configuration can still be ignored downstream.** Historical SDK [model pin #7](https://github.com/meta-models/muse-code-sdk/issues/7) and [reasoning effort #6](https://github.com/meta-models/muse-code-sdk/issues/6) reports are closed, and should not be asserted as current defects. They illustrate why G3 must inspect effective request settings. [Billing-mode report #102](https://github.com/meta-models/muse-code-sdk/issues/102) is version-specific user evidence, not permission to assume free usage or to test billing.

9. **Approval of shell text is not necessarily an execution-plan binding.** [SDK request #90](https://github.com/meta-models/muse-code-sdk/issues/90) explicitly distinguishes displayed command/stages from resolved executable, argv, cwd and environment at spawn. It is a feature request based on a particular integration. Do not claim the SDK or recipe implements its requested pre-exec contract.

### Exact offline checks for the highest-ranked transfers

These are additional proof cases to attach to the relevant G PRs if the behavior is in scope. They do not replace or renumber G1–G6 acceptance IDs. Write them failing-first against the actual parent code; if a case already passes, report it as an existing guard and do not fabricate a regression. Use only tiny invented development records and fake transports. No real host/model launch is needed.

| Audit check | Relevant G work | Decisive test |
|---|---|---|
| META-01 | G2/G3 | Freeze a declared constrained-output profile; capture the actual fake request and compare the schema, mode, model and completion settings. Mutating or omitting one required field must fail readiness or validation before a provider attempt. A request-builder-only test is insufficient if the live adapter uses another builder. |
| META-02 | G3/G6 | Fake a response with reasoning text containing valid-looking spans, empty final content and finish_reason=length. It must remain an invalid/unfinished model response, contribute zero successful redaction cases and preserve the full planned denominator. |
| META-03 | G3/G5 | Supply a declared sampling profile and an incompatible effective body. The verifier must reject the mismatch; merely printing or hashing the declaration does not pass. Do not change a frozen real plan while constructing this invented case. |
| META-04 | G1b/G5 | Give the gate a valid record whose output differs from an independently committed expected projection. Gate exit must be nonzero even when the underlying viewer/tool exits zero. Also fail empty inputs, partial load and unknown statuses. |
| META-05 | G6 | Pause fake preparation with a controllable promise. Revoke approval, alter text or change destination, then release it. Assert transport invocation count is zero and no successful result/draft survives. No timing sleeps. |
| META-06 | G6/receipt evidence | Fake transport entry, then throw before any response. Show attempted/unknown outcome, not “nothing sent” or a completed response. Do not automatically reattempt. A pre-entry failure must remain distinguishable and report no dispatch. |
| META-07 | G1/G5 | In an isolated invented workspace, inspect materialization events and assert the prohibited fake sentinel never appears at any point, including setup before sparse filters. If OS sandbox proof is added, use only a fake protected path and network stub; skip/report unsupported enforcement rather than reporting PASS. |
| META-08 | Optional citation backlog | On invented approved redacted text, reject an unknown citation ID, quote mismatch, wrong snapshot and “proven” result with absent evidence. Exact quotes may pass integrity validation but must not be advertised as proved semantic entailment. |
| META-09 | Optional semantic verifier backlog | A malformed judgment, missing fields, timeout or transport error produces unknown/blocked, not passed=true. No live judge is called. If no semantic verifier is being implemented, mark this not applicable and keep it in backlog. |

### Repository-by-repository judgment

**meta-model-cookbook:** highest immediate value is in the audit, replay, approval and containment recipes. The local Glimmer-to-approved-Spark example is close enough to Second Seat's architecture to be a useful adversarial comparison. Do not import Hermes, WhatsApp, glasses or its permissive ledger behavior. Fundamental API capabilities such as streaming and caching are already partly used.

**meta-oss-cookbook:** highest value is runtime/configuration precision and structured-output/reasoning failure diagnostics. Recipes and branch names are not deployment certification. Quantization, SGLang/llama.cpp, hosted alternatives and training are separate experiments, not quick proof of the existing Modal run.

**muse-code-sdk:** useful protocol and developer-harness references, with a substantial issue history. The root README calls it Developer Preview. Do not migrate the application or helper solely to increase a Meta-tool count. Reported approval/session/platform bugs motivate version pinning and simulated protocol tests if the SDK is ever adopted.

**legal-agent-workshop:** use evidence-linked findings, explicit review and independent checking as design ideas. The actual checker is a model call and can fail open; it is not a privacy or correctness guarantee. No workshop truth, case worlds or solutions were inspected or transferred into Second Seat.

**meta-sam:** the official parser is already integrated experimentally. More mask graphics, confidence display or object-prompt machinery would reopen image scope. Maintain the disabled boundary; do not market it as a proven live privacy feature.

### Implementation decision and human-only follow-up

Complete G1–G6 before optional adoption. Fold applicable META-01 through META-07 into the existing small PRs without silently broadening scope. Keep META-08 and META-09 and ranks 7 onward as explicit proposals unless separately selected. If an added check exposes a distinct defect, make a separate small PR with parent/head evidence and a precise description.

A human may later authorize a pinned live configuration, a total spend bound, provider payload and sealed-data custody workflow. No recipe, free-credit claim, hosted-provider link or upstream example changes that authorization boundary. Do not run the blocked C9 holdout, use a canary outside the declared accounting, or tune against sealed answers.

The honest submission improvement is a complete approved text flow with trustworthy failure accounting and one subsequently authorized, bounded proof run. This audit creates neither that live proof nor a new score.

### Audit inventory ledger — metadata coverage, not full diff review

The following records identify the enumerated public branches, issue/PR entries and reachable commits. They are included so the scope is inspectable. A listed item has not automatically received a full content review. Only the source files and discussions explicitly analyzed above should be treated as detailed review evidence. Branch heads below were pinned when enumerated; later branch movement does not change those recorded SHAs.

#### meta-model-cookbook: branch inventory

| Branch | Pinned head |
|---|---|
| add-codeowners | [f334e2ea7b487c387423a93acac4a6352bc451d1](https://github.com/meta-models/meta-model-cookbook/tree/f334e2ea7b487c387423a93acac4a6352bc451d1) |
| add-muse-image-cookbooks | [908c5bde9e021463135518491caee6d913b8cad8](https://github.com/meta-models/meta-model-cookbook/tree/908c5bde9e021463135518491caee6d913b8cad8) |
| add-muse-image-overview-readme | [eebdf2f23c9a1b5ba3d12ab6b429bbbe9e14d302](https://github.com/meta-models/meta-model-cookbook/tree/eebdf2f23c9a1b5ba3d12ab6b429bbbe9e14d302) |
| add-video-url | [6f4ff31f4f53452e9e2a34e443fccb7240cb1a5a](https://github.com/meta-models/meta-model-cookbook/tree/6f4ff31f4f53452e9e2a34e443fccb7240cb1a5a) |
| add-voice-chess-cua | [a72d3d35ed5376bf78cdc7f4045a238557e12426](https://github.com/meta-models/meta-model-cookbook/tree/a72d3d35ed5376bf78cdc7f4045a238557e12426) |
| ali/muse-robotics-cookbook | [345f44de2c559c134f01f8764a850c0648704470](https://github.com/meta-models/meta-model-cookbook/tree/345f44de2c559c134f01f8764a850c0648704470) |
| ali/muse-robotics-cookbook-remove-tests | [6be43e96f228b0881087fb6880127027266ad53f](https://github.com/meta-models/meta-model-cookbook/tree/6be43e96f228b0881087fb6880127027266ad53f) |
| dependabot/npm_and_yarn/02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks/baseline-browser-mapping-2.11.22 | [b17116e872f9237c799f7105efcfa4cec2e3a67f](https://github.com/meta-models/meta-model-cookbook/tree/b17116e872f9237c799f7105efcfa4cec2e3a67f) |
| dependabot/npm_and_yarn/02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks/body-parser-1.20.6 | [26fe38216c0c756d87264f463b6574b187e9a8f5](https://github.com/meta-models/meta-model-cookbook/tree/26fe38216c0c756d87264f463b6574b187e9a8f5) |
| dependabot/npm_and_yarn/02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks/brace-expansion-1.1.21 | [a7bb6c76cfd110422bd2d7408e1f6adf304b142d](https://github.com/meta-models/meta-model-cookbook/tree/a7bb6c76cfd110422bd2d7408e1f6adf304b142d) |
| dependabot/npm_and_yarn/02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks/browserslist-4.28.8 | [6dd52ec12e1bf77250aeabffeef347df237f2b0e](https://github.com/meta-models/meta-model-cookbook/tree/6dd52ec12e1bf77250aeabffeef347df237f2b0e) |
| dependabot/npm_and_yarn/02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks/handlebars-4.7.10 | [41d6568b49d0181dec1207f1edc490753481e3b8](https://github.com/meta-models/meta-model-cookbook/tree/41d6568b49d0181dec1207f1edc490753481e3b8) |
| dependabot/npm_and_yarn/02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks/js-yaml-3.15.2 | [a8708a72f113c0e1370e9afe9e591bf3885ed1bf](https://github.com/meta-models/meta-model-cookbook/tree/a8708a72f113c0e1370e9afe9e591bf3885ed1bf) |
| dependabot/npm_and_yarn/02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks/multi-fe93483a4d | [a002d4c6c96b9e628ccfc1d79967a42f21ed862e](https://github.com/meta-models/meta-model-cookbook/tree/a002d4c6c96b9e628ccfc1d79967a42f21ed862e) |
| dependabot/npm_and_yarn/02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks/proxy-addr-2.0.8 | [4d2c390b6032e88f7c96c86a2964c5a5914763f2](https://github.com/meta-models/meta-model-cookbook/tree/4d2c390b6032e88f7c96c86a2964c5a5914763f2) |
| dependabot/npm_and_yarn/02_agent_patterns/03_managing_context/proxy_build/multi-d0c2d048a7 | [0836b50e872e207b94848c89ae2a7a41c38f95d6](https://github.com/meta-models/meta-model-cookbook/tree/0836b50e872e207b94848c89ae2a7a41c38f95d6) |
| dependabot/npm_and_yarn/02_agent_patterns/03_managing_context/proxy_build/postcss-8.5.25 | [ffee48670a81fd46c25178de46cad87d25723220](https://github.com/meta-models/meta-model-cookbook/tree/ffee48670a81fd46c25178de46cad87d25723220) |
| dependabot/npm_and_yarn/02_agent_patterns/03_managing_context/proxy_build/source-map-js-1.2.2 | [716b224d482f08c80af4a1e3ec1b71b840086a2f](https://github.com/meta-models/meta-model-cookbook/tree/716b224d482f08c80af4a1e3ec1b71b840086a2f) |
| dependabot/npm_and_yarn/02_agent_patterns/03_managing_context/proxy_build/vite-8.3.5 | [50fe5b780965be4863639ca2dae10c1db7f24dac](https://github.com/meta-models/meta-model-cookbook/tree/50fe5b780965be4863639ca2dae10c1db7f24dac) |
| dependabot/npm_and_yarn/07_sam/03_headlocked_speech_bubble_captions/body-parser-2.4.0 | [0b50238be9806621c603da1990aab32adb0f660f](https://github.com/meta-models/meta-model-cookbook/tree/0b50238be9806621c603da1990aab32adb0f660f) |
| dependabot/npm_and_yarn/07_sam/03_headlocked_speech_bubble_captions/multer-2.5.0 | [3e65e2f9e439334f02170230b009ee5a0f0bf93f](https://github.com/meta-models/meta-model-cookbook/tree/3e65e2f9e439334f02170230b009ee5a0f0bf93f) |
| dependabot/npm_and_yarn/07_sam/03_headlocked_speech_bubble_captions/multi-063a5f277b | [9fd3bedbda9eabbe7429e2ce243bf369dea7983b](https://github.com/meta-models/meta-model-cookbook/tree/9fd3bedbda9eabbe7429e2ce243bf369dea7983b) |
| dependabot/npm_and_yarn/07_sam/03_headlocked_speech_bubble_captions/undici-8.12.3 | [4abf74813087d272818265eb7ee386a7e88b216b](https://github.com/meta-models/meta-model-cookbook/tree/4abf74813087d272818265eb7ee386a7e88b216b) |
| dependabot/npm_and_yarn/07_sam/03_headlocked_speech_bubble_captions/vite-8.3.4 | [84041b0cc7b7541f539057e628c9776c94eefa73](https://github.com/meta-models/meta-model-cookbook/tree/84041b0cc7b7541f539057e628c9776c94eefa73) |
| dependabot/pip/03_use_cases/14_muse_robotics/pillow-13.0.0 | [0dd3266172a5a6906b8a7f16fb6ffd899dcb9fc3](https://github.com/meta-models/meta-model-cookbook/tree/0dd3266172a5a6906b8a7f16fb6ffd899dcb9fc3) |
| dependabot/pip/06_muse_voice/02_voice_chess_cua/setuptools-84.1.0 | [f36e5b18ccd2134e8886aad26de1cfcd23b56dfe](https://github.com/meta-models/meta-model-cookbook/tree/f36e5b18ccd2134e8886aad26de1cfcd23b56dfe) |
| deps/bump-vitest-4 | [cdb5dde7d4e5808c47293dc09fc4cdccf5fb25be](https://github.com/meta-models/meta-model-cookbook/tree/cdb5dde7d4e5808c47293dc09fc4cdccf5fb25be) |
| feat/glimmer-hermes | [c757d3b349b18d421d1411221e0d273168a3fd4f](https://github.com/meta-models/meta-model-cookbook/tree/c757d3b349b18d421d1411221e0d273168a3fd4f) |
| main | [0a99b987858ec4e49c04fc3f114bf33851e81deb](https://github.com/meta-models/meta-model-cookbook/tree/0a99b987858ec4e49c04fc3f114bf33851e81deb) |
| muse-voice-transcribe | [71410bb1f214e9b197b75809dde4de7453dcecde](https://github.com/meta-models/meta-model-cookbook/tree/71410bb1f214e9b197b75809dde4de7453dcecde) |
| trim-voice-chess-readme | [0a6d98ad5de1a8b2422e20e7f838d996245bc69f](https://github.com/meta-models/meta-model-cookbook/tree/0a6d98ad5de1a8b2422e20e7f838d996245bc69f) |
| younghan/metacua-tool-output-parity | [200fb4dd803e6e0e265a888bdd16fb3d1608f320](https://github.com/meta-models/meta-model-cookbook/tree/200fb4dd803e6e0e265a888bdd16fb3d1608f320) |

#### meta-model-cookbook: issue and PR inventory

States below are the API collection state at retrieval, not an assessment that an issue is resolved or a PR is merged. Closed PRs may be unmerged. Comments/reviews and patches were not exhaustively reviewed.

| Item | Type | State | Title |
|---|---|---|---|
| [#74](https://github.com/meta-models/meta-model-cookbook/issues/74) | Issue | closed | Restore deleted messages |
| [#73](https://github.com/meta-models/meta-model-cookbook/pull/73) | PR | open | Bump body-parser from 2.3.0 to 2.4.0 in /07_sam/03_headlocked_speech_bubble_captions |
| [#72](https://github.com/meta-models/meta-model-cookbook/pull/72) | PR | open | Bump @vitest/mocker and vitest in /07_sam/03_headlocked_speech_bubble_captions |
| [#71](https://github.com/meta-models/meta-model-cookbook/pull/71) | PR | open | Bump pillow from 12.3.0 to 13.0.0 in /03_use_cases/14_muse_robotics |
| [#70](https://github.com/meta-models/meta-model-cookbook/pull/70) | PR | open | Bump undici from 8.10.2 to 8.12.3 in /07_sam/03_headlocked_speech_bubble_captions |
| [#69](https://github.com/meta-models/meta-model-cookbook/pull/69) | PR | open | Bump setuptools from 82.0.0 to 84.1.0 in /06_muse_voice/02_voice_chess_cua |
| [#68](https://github.com/meta-models/meta-model-cookbook/pull/68) | PR | open | Bump multer from 2.3.0 to 2.5.0 in /07_sam/03_headlocked_speech_bubble_captions |
| [#67](https://github.com/meta-models/meta-model-cookbook/pull/67) | PR | open | Bump vite from 8.1.4 to 8.3.5 in /02_agent_patterns/03_managing_context/proxy_build |
| [#66](https://github.com/meta-models/meta-model-cookbook/pull/66) | PR | open | Bump vite from 8.3.0 to 8.3.4 in /07_sam/03_headlocked_speech_bubble_captions |
| [#65](https://github.com/meta-models/meta-model-cookbook/pull/65) | PR | open | Bump source-map-js from 1.2.1 to 1.2.2 in /02_agent_patterns/03_managing_context/proxy_build |
| [#64](https://github.com/meta-models/meta-model-cookbook/pull/64) | PR | open | Bump handlebars from 4.7.9 to 4.7.10 in /02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks |
| [#63](https://github.com/meta-models/meta-model-cookbook/pull/63) | PR | open | Bump proxy-addr from 2.0.7 to 2.0.8 in /02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks |
| [#62](https://github.com/meta-models/meta-model-cookbook/pull/62) | PR | closed | Remove tests from the Muse robotics recipe |
| [#61](https://github.com/meta-models/meta-model-cookbook/issues/61) | Issue | open | Model API: inline images and video are saved as permanent account files (user_data, no expiry) |
| [#60](https://github.com/meta-models/meta-model-cookbook/issues/60) | Issue | open | Model API docs: QuickTime (.mov) video is accepted but undocumented; `compact_threshold` minimum and `store: false` compaction are unspecified |
| [#59](https://github.com/meta-models/meta-model-cookbook/issues/59) | Issue | open | Model API: `input_audio` is accepted but dropped on muse-spark-1.2-contributor, with no error |
| [#58](https://github.com/meta-models/meta-model-cookbook/issues/58) | Issue | open | Model API: `POST /v1/responses/input_tokens` does not count images or video |
| [#57](https://github.com/meta-models/meta-model-cookbook/issues/57) | Issue | open | Model API: token logprobs for classification and judging (allow logprobs on the answer with minimal reasoning, or a non-reasoning mode) |
| [#56](https://github.com/meta-models/meta-model-cookbook/issues/56) | Issue | open | Model API: a low-latency completion path for IDE inline suggestions (a FIM endpoint, or a non-reasoning mode that accepts `stop`) |
| [#55](https://github.com/meta-models/meta-model-cookbook/issues/55) | Issue | open | Verify evals on Papers with Code |
| [#54](https://github.com/meta-models/meta-model-cookbook/pull/54) | PR | open | Bump brace-expansion from 1.1.15 to 1.1.21 in /02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks |
| [#53](https://github.com/meta-models/meta-model-cookbook/pull/53) | PR | closed | Add maintainers to CODEOWNERS |
| [#52](https://github.com/meta-models/meta-model-cookbook/pull/52) | PR | closed | Add an end-to-end Muse robotics cookbook recipe |
| [#51](https://github.com/meta-models/meta-model-cookbook/pull/51) | PR | closed | Bump multer from 2.3.0 to 2.4.0 in /07_sam/03_headlocked_speech_bubble_captions |
| [#50](https://github.com/meta-models/meta-model-cookbook/pull/50) | PR | open | fix(router): prefer host-specific routes at equal path prefix |
| [#49](https://github.com/meta-models/meta-model-cookbook/pull/49) | PR | open | fix(proxy): respect retryIdempotentOnly on transport errors |
| [#48](https://github.com/meta-models/meta-model-cookbook/pull/48) | PR | open | feat(recipes): add graph-grounded repository explanations |
| [#47](https://github.com/meta-models/meta-model-cookbook/issues/47) | Issue | open | Recipe proposal: graph-grounded repository explanations |
| [#46](https://github.com/meta-models/meta-model-cookbook/issues/46) | Issue | open | Recipe proposal: constraint-checked multi-agent data-center planning |
| [#45](https://github.com/meta-models/meta-model-cookbook/issues/45) | Issue | open | dev.meta.ai dashboard: API keys page broken by React hydration error #418 |
| [#44](https://github.com/meta-models/meta-model-cookbook/pull/44) | PR | closed | Muse Code for Security Research |
| [#43](https://github.com/meta-models/meta-model-cookbook/issues/43) | Issue | open | Billing country resets to "Puerto Rico" every page load, even with confirmed US location + US-issued card |
| [#42](https://github.com/meta-models/meta-model-cookbook/pull/42) | PR | closed | Use Case 15: Integrate Muse Glimmer and Muse Spark |
| [#41](https://github.com/meta-models/meta-model-cookbook/pull/41) | PR | closed | Add CODEOWNERS so maintainers are requested on every pull request |
| [#40](https://github.com/meta-models/meta-model-cookbook/pull/40) | PR | closed | Restore the full contributing guide and add .env.example |
| [#39](https://github.com/meta-models/meta-model-cookbook/pull/39) | PR | closed | Point Muse Voice section links at the cookbook page |
| [#38](https://github.com/meta-models/meta-model-cookbook/pull/38) | PR | closed | Hash session store images with SHA-256 and split a combined assertion |
| [#37](https://github.com/meta-models/meta-model-cookbook/pull/37) | PR | closed | Point SAM section links at the Segment Anything Model cookbook page |
| [#36](https://github.com/meta-models/meta-model-cookbook/issues/36) | Issue | open | Mobile (iPhone) usability blockers on the dev.meta.ai console |
| [#35](https://github.com/meta-models/meta-model-cookbook/pull/35) | PR | closed | Add SAM 3 section with API basics and two video recipes |
| [#34](https://github.com/meta-models/meta-model-cookbook/pull/34) | PR | open | Add muse image cookbooks |
| [#33](https://github.com/meta-models/meta-model-cookbook/pull/33) | PR | open | Bump js-yaml from 3.15.0 to 3.15.2 in /02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks |
| [#32](https://github.com/meta-models/meta-model-cookbook/pull/32) | PR | open | Bump baseline-browser-mapping from 2.10.38 to 2.11.22 in /02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks |
| [#31](https://github.com/meta-models/meta-model-cookbook/issues/31) | Issue | open | Muse Spark 1.3 and 1.2 reasoning traces truncate minor version numbers in their summarized reasoning traces |
| [#30](https://github.com/meta-models/meta-model-cookbook/pull/30) | PR | open | Bump @vitest/mocker and vitest in /02_agent_patterns/03_managing_context/proxy_build |
| [#29](https://github.com/meta-models/meta-model-cookbook/issues/29) | Issue | open | Muse Spark 1.3: max reasoning returns HTTP 500 for video; xhigh succeeds |
| [#28](https://github.com/meta-models/meta-model-cookbook/pull/28) | PR | open | docs: background computer use with Muse models and Cua Driver |
| [#27](https://github.com/meta-models/meta-model-cookbook/issues/27) | Issue | open | Recipe proposal: background computer use with Muse models and Cua Driver |
| [#26](https://github.com/meta-models/meta-model-cookbook/pull/26) | PR | closed | Update the voice fundamentals sample transcript and input guidance |
| [#25](https://github.com/meta-models/meta-model-cookbook/pull/25) | PR | closed | Add demo video link to README |
| [#24](https://github.com/meta-models/meta-model-cookbook/pull/24) | PR | closed | Trim the Voice Chess recipe README |
| [#23](https://github.com/meta-models/meta-model-cookbook/pull/23) | PR | open | Bump browserslist from 4.28.2 to 4.28.8 in /02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks |
| [#22](https://github.com/meta-models/meta-model-cookbook/pull/22) | PR | open | Bump qs and express in /02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks |
| [#21](https://github.com/meta-models/meta-model-cookbook/pull/21) | PR | closed | Bump setuptools from 82.0.0 to 83.0.0 in /06_muse_voice/02_voice_chess_cua |
| [#20](https://github.com/meta-models/meta-model-cookbook/pull/20) | PR | closed | Update model references from muse-spark-1.1 to muse-spark-1.3 |
| [#19](https://github.com/meta-models/meta-model-cookbook/issues/19) | Issue | open | Muse realtime needs agent-context support or clearer context-biasing guidance |
| [#18](https://github.com/meta-models/meta-model-cookbook/pull/18) | PR | closed | Add Voice Chess CUA recipe |
| [#17](https://github.com/meta-models/meta-model-cookbook/pull/17) | PR | closed | Add Muse Voice Transcribe recipe (06_muse_voice) |
| [#16](https://github.com/meta-models/meta-model-cookbook/issues/16) | Issue | open | Suggested Cookbooks |
| [#15](https://github.com/meta-models/meta-model-cookbook/pull/15) | PR | closed | Add 05_muse_image section overview README |
| [#14](https://github.com/meta-models/meta-model-cookbook/pull/14) | PR | closed | Add Muse Image cookbooks (05_muse_image) |
| [#13](https://github.com/meta-models/meta-model-cookbook/pull/13) | PR | closed | Fix broken cookbook section links |
| [#12](https://github.com/meta-models/meta-model-cookbook/pull/12) | PR | open | docs: add minimal system requirements and run instructions |
| [#11](https://github.com/meta-models/meta-model-cookbook/pull/11) | PR | open | metacua: match the Swift tool-result contract in the Python backend |
| [#10](https://github.com/meta-models/meta-model-cookbook/pull/10) | PR | closed | Update images |
| [#9](https://github.com/meta-models/meta-model-cookbook/pull/9) | PR | closed | chore(deps): bump brace-expansion from 1.1.15 to 1.1.18 in /02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks |
| [#8](https://github.com/meta-models/meta-model-cookbook/pull/8) | PR | closed | Add cookbooks |
| [#7](https://github.com/meta-models/meta-model-cookbook/pull/7) | PR | open | chore(deps-dev): bump postcss from 8.5.16 to 8.5.25 in /02_agent_patterns/03_managing_context/proxy_build |
| [#6](https://github.com/meta-models/meta-model-cookbook/pull/6) | PR | open | chore(deps): bump body-parser from 1.20.5 to 1.20.6 in /02_agent_patterns/02_interleaved_reasoning/reasoning_target_express_callbacks |
| [#5](https://github.com/meta-models/meta-model-cookbook/pull/5) | PR | closed | Bump vitest to ^4.1.10 in proxy_build; refresh transitive lockfile deps |
| [#4](https://github.com/meta-models/meta-model-cookbook/issues/4) | Issue | closed | dev.meta.ai doesnt work |
| [#3](https://github.com/meta-models/meta-model-cookbook/pull/3) | PR | closed | Bump esbuild and vitest in /02_agent_patterns/03_managing_context/proxy_build |
| [#2](https://github.com/meta-models/meta-model-cookbook/pull/2) | PR | closed | Bump vite and vitest in /02_agent_patterns/03_managing_context/proxy_build |
| [#1](https://github.com/meta-models/meta-model-cookbook/pull/1) | PR | closed | Bump vitest from 1.6.1 to 3.2.6 in /02_agent_patterns/03_managing_context/proxy_build |

#### meta-model-cookbook: reachable commit inventory

Commit subjects below are metadata. They do not establish that the described behavior exists in the pinned main tree. All commits are listed once per repository, including commits reachable only from non-main branches.

| Commit | Subject |
|---|---|
| [298bffe2af777070f93b77bbf38eee1f1bebf587](https://github.com/meta-models/meta-model-cookbook/commit/298bffe2af777070f93b77bbf38eee1f1bebf587) | Initial commit: Meta Model API cookbook |
| [cdb5dde7d4e5808c47293dc09fc4cdccf5fb25be](https://github.com/meta-models/meta-model-cookbook/commit/cdb5dde7d4e5808c47293dc09fc4cdccf5fb25be) | chore(deps): bump vitest to ^4.1.10 in proxy_build |
| [0daeef6364dd05797bfe03bd1d98488e354f72ef](https://github.com/meta-models/meta-model-cookbook/commit/0daeef6364dd05797bfe03bd1d98488e354f72ef) | Merge pull request #5 from meta-models/deps/bump-vitest-4 |
| [26fe38216c0c756d87264f463b6574b187e9a8f5](https://github.com/meta-models/meta-model-cookbook/commit/26fe38216c0c756d87264f463b6574b187e9a8f5) | chore(deps): bump body-parser |
| [ffee48670a81fd46c25178de46cad87d25723220](https://github.com/meta-models/meta-model-cookbook/commit/ffee48670a81fd46c25178de46cad87d25723220) | chore(deps-dev): bump postcss |
| [d30bc34b801c13d0af9ff3e5d3de829862661269](https://github.com/meta-models/meta-model-cookbook/commit/d30bc34b801c13d0af9ff3e5d3de829862661269) | Add cookbooks |
| [debc824f6bf7aae2eb256fa009b9e16f09ddbacb](https://github.com/meta-models/meta-model-cookbook/commit/debc824f6bf7aae2eb256fa009b9e16f09ddbacb) | Merge pull request #8 from meta-models/muse_code_cookbooks |
| [9faa831c64de9ff461441a315b76aa1067cef940](https://github.com/meta-models/meta-model-cookbook/commit/9faa831c64de9ff461441a315b76aa1067cef940) | Update images |
| [200fb4dd803e6e0e265a888bdd16fb3d1608f320](https://github.com/meta-models/meta-model-cookbook/commit/200fb4dd803e6e0e265a888bdd16fb3d1608f320) | metacua: match the Swift tool-result contract in the Python backend |
| [e8a3f6877209e0e0cccbb4e8d896224f7cc3205d](https://github.com/meta-models/meta-model-cookbook/commit/e8a3f6877209e0e0cccbb4e8d896224f7cc3205d) | Fix broken cookbook section links |
| [c764e35d5364da980347812e62f0ea00b53b28e2](https://github.com/meta-models/meta-model-cookbook/commit/c764e35d5364da980347812e62f0ea00b53b28e2) | Merge pull request #13 from meta-models/fix-cookbook-section-links |
| [87780e27ab1dc0879c0fd79779f1219c564dac0f](https://github.com/meta-models/meta-model-cookbook/commit/87780e27ab1dc0879c0fd79779f1219c564dac0f) | Add Muse Image cookbooks (05_muse_image) |
| [fec227232043a239e5f5eaac9628621ebf5c1d77](https://github.com/meta-models/meta-model-cookbook/commit/fec227232043a239e5f5eaac9628621ebf5c1d77) | Add Muse Image cookbooks (05_muse_image) |
| [908c5bde9e021463135518491caee6d913b8cad8](https://github.com/meta-models/meta-model-cookbook/commit/908c5bde9e021463135518491caee6d913b8cad8) | Add 05_muse_image section overview README |
| [29c7f4f0c6ab80027c850b4b269f839b94c815ab](https://github.com/meta-models/meta-model-cookbook/commit/29c7f4f0c6ab80027c850b4b269f839b94c815ab) | Add 05_muse_image section overview README |
| [eebdf2f23c9a1b5ba3d12ab6b429bbbe9e14d302](https://github.com/meta-models/meta-model-cookbook/commit/eebdf2f23c9a1b5ba3d12ab6b429bbbe9e14d302) | Add 05_muse_image section overview README |
| [71410bb1f214e9b197b75809dde4de7453dcecde](https://github.com/meta-models/meta-model-cookbook/commit/71410bb1f214e9b197b75809dde4de7453dcecde) | Add Muse Voice Transcribe recipe (06_muse_voice) |
| [fe1c383a79eab4ea9731e0e515b2a3495661f4b2](https://github.com/meta-models/meta-model-cookbook/commit/fe1c383a79eab4ea9731e0e515b2a3495661f4b2) | Merge pull request #17 from meta-models/muse-voice-transcribe |
| [8ebf07dfa0d90ee5c7cfa1265556fdc17d00585b](https://github.com/meta-models/meta-model-cookbook/commit/8ebf07dfa0d90ee5c7cfa1265556fdc17d00585b) | Add Voice Chess CUA recipe |
| [59c60edfd4a591a798925ceb8f055ca36499c6ac](https://github.com/meta-models/meta-model-cookbook/commit/59c60edfd4a591a798925ceb8f055ca36499c6ac) | Update Voice Chess demo framing |
| [4efbd4927df2e9a0ba1e77422e65c7010b64f3ca](https://github.com/meta-models/meta-model-cookbook/commit/4efbd4927df2e9a0ba1e77422e65c7010b64f3ca) | Align Voice Chess grid to accessibility landmarks |
| [70013b7a97d03f1983a157011e91c7bb596d5d8e](https://github.com/meta-models/meta-model-cookbook/commit/70013b7a97d03f1983a157011e91c7bb596d5d8e) | Update model references from muse-spark-1.1 to muse-spark-1.3 |
| [0fe550d346360beab22d21e5f49c0fbd0bafe68d](https://github.com/meta-models/meta-model-cookbook/commit/0fe550d346360beab22d21e5f49c0fbd0bafe68d) | Merge pull request #20 from meta-models/muse-spark-1.3 |
| [a72d3d35ed5376bf78cdc7f4045a238557e12426](https://github.com/meta-models/meta-model-cookbook/commit/a72d3d35ed5376bf78cdc7f4045a238557e12426) | Consolidate Voice Chess modules and resolve click targets through Accessibility |
| [3eb38a221e08133f48a7f338bcf05deb12aa9b1f](https://github.com/meta-models/meta-model-cookbook/commit/3eb38a221e08133f48a7f338bcf05deb12aa9b1f) | Merge pull request #18 from meta-models/add-voice-chess-cua |
| [a002d4c6c96b9e628ccfc1d79967a42f21ed862e](https://github.com/meta-models/meta-model-cookbook/commit/a002d4c6c96b9e628ccfc1d79967a42f21ed862e) | Bump qs and express |
| [6dd52ec12e1bf77250aeabffeef347df237f2b0e](https://github.com/meta-models/meta-model-cookbook/commit/6dd52ec12e1bf77250aeabffeef347df237f2b0e) | Bump browserslist |
| [dd79d86747de029eb1795bb2b66101c6a03ebf17](https://github.com/meta-models/meta-model-cookbook/commit/dd79d86747de029eb1795bb2b66101c6a03ebf17) | Trim the Voice Chess recipe README |
| [0a6d98ad5de1a8b2422e20e7f838d996245bc69f](https://github.com/meta-models/meta-model-cookbook/commit/0a6d98ad5de1a8b2422e20e7f838d996245bc69f) | Drop the untested headphone suggestion from the Voice Chess README |
| [b3e6f1ab03e4593dd43e0f419f9f079da561d7f2](https://github.com/meta-models/meta-model-cookbook/commit/b3e6f1ab03e4593dd43e0f419f9f079da561d7f2) | Merge pull request #24 from meta-models/trim-voice-chess-readme |
| [6f4ff31f4f53452e9e2a34e443fccb7240cb1a5a](https://github.com/meta-models/meta-model-cookbook/commit/6f4ff31f4f53452e9e2a34e443fccb7240cb1a5a) | Add demo video link to README |
| [37aa7f8771652e08a779d93c31cf4973775bbd33](https://github.com/meta-models/meta-model-cookbook/commit/37aa7f8771652e08a779d93c31cf4973775bbd33) | Update the voice fundamentals sample transcript and input guidance |
| [0c83f8e5ed3291232cf8dbbaf62ee157eeb44dec](https://github.com/meta-models/meta-model-cookbook/commit/0c83f8e5ed3291232cf8dbbaf62ee157eeb44dec) | Merge pull request #26 from meta-models/voice-prompt-update |
| [fb440d68f9f1eb735faca57092b0729ad6195d96](https://github.com/meta-models/meta-model-cookbook/commit/fb440d68f9f1eb735faca57092b0729ad6195d96) | Merge pull request #25 from meta-models/add-video-url |
| [0836b50e872e207b94848c89ae2a7a41c38f95d6](https://github.com/meta-models/meta-model-cookbook/commit/0836b50e872e207b94848c89ae2a7a41c38f95d6) | Bump @vitest/mocker and vitest |
| [b17116e872f9237c799f7105efcfa4cec2e3a67f](https://github.com/meta-models/meta-model-cookbook/commit/b17116e872f9237c799f7105efcfa4cec2e3a67f) | Bump baseline-browser-mapping |
| [a8708a72f113c0e1370e9afe9e591bf3885ed1bf](https://github.com/meta-models/meta-model-cookbook/commit/a8708a72f113c0e1370e9afe9e591bf3885ed1bf) | Bump js-yaml |
| [6108702baac0f018a031ef36bffd4583e1d621b2](https://github.com/meta-models/meta-model-cookbook/commit/6108702baac0f018a031ef36bffd4583e1d621b2) | Add SAM 3 section with API basics and two video recipes |
| [c5a9882b4c7f3900e9c93122249d37317c8abff4](https://github.com/meta-models/meta-model-cookbook/commit/c5a9882b4c7f3900e9c93122249d37317c8abff4) | Merge pull request #35 from meta-models/add-sam-recipes |
| [7485344ec23a0881480e29eafb274b7af0de10b6](https://github.com/meta-models/meta-model-cookbook/commit/7485344ec23a0881480e29eafb274b7af0de10b6) | Point SAM section links at the Segment Anything Model cookbook page |
| [28937be0be6e49bfe4928a59f3c26843548118dd](https://github.com/meta-models/meta-model-cookbook/commit/28937be0be6e49bfe4928a59f3c26843548118dd) | Merge pull request #37 from meta-models/sync-sam-section-links |
| [8e7f0c1165d23bd8e2b1331a95da9b05469e5886](https://github.com/meta-models/meta-model-cookbook/commit/8e7f0c1165d23bd8e2b1331a95da9b05469e5886) | Hash session store images with SHA-256 and split a combined assertion |
| [9ab71d264323c5c3d4273c47434beeffeebccab0](https://github.com/meta-models/meta-model-cookbook/commit/9ab71d264323c5c3d4273c47434beeffeebccab0) | Point Muse Voice section links at the cookbook page |
| [a76b580e102091eae9be67205350cb37173711ee](https://github.com/meta-models/meta-model-cookbook/commit/a76b580e102091eae9be67205350cb37173711ee) | Restore the full contributing guide and add .env.example |
| [8d53706cbd85169df381949322f4c80ddff61f9a](https://github.com/meta-models/meta-model-cookbook/commit/8d53706cbd85169df381949322f4c80ddff61f9a) | Merge pull request #38 from meta-models/fix-session-store-digest-and-test |
| [f545ed06183c9c149c8e2a83b0761ebc54c6d636](https://github.com/meta-models/meta-model-cookbook/commit/f545ed06183c9c149c8e2a83b0761ebc54c6d636) | Merge pull request #39 from meta-models/sync-muse-voice-section-links |
| [bcc95e3967104433a6ae7ab4e67de66f8a7fd573](https://github.com/meta-models/meta-model-cookbook/commit/bcc95e3967104433a6ae7ab4e67de66f8a7fd573) | Merge pull request #40 from meta-models/sync-contributing-guide |
| [11867d17a6419feff77bce3e338b662fd2903d08](https://github.com/meta-models/meta-model-cookbook/commit/11867d17a6419feff77bce3e338b662fd2903d08) | Add CODEOWNERS so maintainers are requested on every pull request |
| [0fab2968850804b3c90ab132519f4fad8021282b](https://github.com/meta-models/meta-model-cookbook/commit/0fab2968850804b3c90ab132519f4fad8021282b) | Merge pull request #41 from meta-models/add-codeowners |
| [0102da0e2f1bb4b2809bfd87967ce3b0425084c1](https://github.com/meta-models/meta-model-cookbook/commit/0102da0e2f1bb4b2809bfd87967ce3b0425084c1) | Add placeholder for use case 15: local agent with approved escalation to Muse Spark |
| [44ac34c7dd7dca47ed66c3939a1461034227c49c](https://github.com/meta-models/meta-model-cookbook/commit/44ac34c7dd7dca47ed66c3939a1461034227c49c) | Add use case 15: local agent that asks before calling Muse Spark |
| [c757d3b349b18d421d1411221e0d273168a3fd4f](https://github.com/meta-models/meta-model-cookbook/commit/c757d3b349b18d421d1411221e0d273168a3fd4f) | Fix gaps found installing use case 15 on a second machine |
| [1395c75fdb55c292a687cb8d1b093b6cc6a761b7](https://github.com/meta-models/meta-model-cookbook/commit/1395c75fdb55c292a687cb8d1b093b6cc6a761b7) | Merge pull request #42 from meta-models/feat/glimmer-hermes |
| [0350b98b5a44dc69aecf5e81d254ae80cc43637e](https://github.com/meta-models/meta-model-cookbook/commit/0350b98b5a44dc69aecf5e81d254ae80cc43637e) | Refine language and clarity in README.md |
| [2a893d15fbfa6652f3625bda2ba6bc2fdf2dd383](https://github.com/meta-models/meta-model-cookbook/commit/2a893d15fbfa6652f3625bda2ba6bc2fdf2dd383) | Clean up AI-isms in MCP security tooling recipe |
| [427d971d29eb8834e0a17b215b057e89fce2ab7b](https://github.com/meta-models/meta-model-cookbook/commit/427d971d29eb8834e0a17b215b057e89fce2ab7b) | Add Security research over MCP recipe |
| [85462dfa22efc65328af2608d14961d2c59db71b](https://github.com/meta-models/meta-model-cookbook/commit/85462dfa22efc65328af2608d14961d2c59db71b) | note the Muse Code account requirement and link sign-up |
| [8c70e0f9bccebd80d8df66d2fcbe582ed1c70138](https://github.com/meta-models/meta-model-cookbook/commit/8c70e0f9bccebd80d8df66d2fcbe582ed1c70138) | Merge upstream changes from meta-models/main |
| [acf5ec3dabfa9bb85f72e4e3da86532f499c9732](https://github.com/meta-models/meta-model-cookbook/commit/acf5ec3dabfa9bb85f72e4e3da86532f499c9732) | Add policy/unblock warning to MCP security tooling recipe |
| [f2a4fc0d40c3226db87feea83a15ea15a7111f22](https://github.com/meta-models/meta-model-cookbook/commit/f2a4fc0d40c3226db87feea83a15ea15a7111f22) | minor flow changes and inlined poc |
| [ffb50333bdfb318a7117a8c4841de4f2cd3138d0](https://github.com/meta-models/meta-model-cookbook/commit/ffb50333bdfb318a7117a8c4841de4f2cd3138d0) | update the README file of usecase |
| [49e3f0fb40abeebd5f0f47e3dd8e0602a63c461f](https://github.com/meta-models/meta-model-cookbook/commit/49e3f0fb40abeebd5f0f47e3dd8e0602a63c461f) | update 15th recipe |
| [770e5162522b78708c23e7f8d0dae68c077fc630](https://github.com/meta-models/meta-model-cookbook/commit/770e5162522b78708c23e7f8d0dae68c077fc630) | Add metadata header to robotics recipe |
| [f334e2ea7b487c387423a93acac4a6352bc451d1](https://github.com/meta-models/meta-model-cookbook/commit/f334e2ea7b487c387423a93acac4a6352bc451d1) | Add maintainers to CODEOWNERS |
| [2c6435b969df4217de42d173f5ffd948d29bb23b](https://github.com/meta-models/meta-model-cookbook/commit/2c6435b969df4217de42d173f5ffd948d29bb23b) | Merge pull request #53 from meta-models/add-codeowners |
| [675a151013be494ac021bdede1ddae6f16b4fd65](https://github.com/meta-models/meta-model-cookbook/commit/675a151013be494ac021bdede1ddae6f16b4fd65) | Merge pull request #52 from meta-models/ali/muse-robotics-cookbook |
| [a7bb6c76cfd110422bd2d7408e1f6adf304b142d](https://github.com/meta-models/meta-model-cookbook/commit/a7bb6c76cfd110422bd2d7408e1f6adf304b142d) | Bump brace-expansion |
| [33c6adfe6251403d356a9aa3e6f17c499bbe96d3](https://github.com/meta-models/meta-model-cookbook/commit/33c6adfe6251403d356a9aa3e6f17c499bbe96d3) | Sync MCP security recipe with Bug Bounty hosted version |
| [05a56acc4878499904438c3591c1489e3ab61065](https://github.com/meta-models/meta-model-cookbook/commit/05a56acc4878499904438c3591c1489e3ab61065) | Merge branch 'meta-models:main' into mcp-security-tooling |
| [a69a99cbfc45d98eb5f5aae87786c08ae651c650](https://github.com/meta-models/meta-model-cookbook/commit/a69a99cbfc45d98eb5f5aae87786c08ae651c650) | Merge remote mcp-security-tooling (upstream main) into sync branch |
| [9e05c1875a537fdbfc731ac47312cd073e193106](https://github.com/meta-models/meta-model-cookbook/commit/9e05c1875a537fdbfc731ac47312cd073e193106) | Address PR #44 review feedback for MCP security recipe |
| [18b8fdd476d6fdbe898e8c733523a0882b619a6c](https://github.com/meta-models/meta-model-cookbook/commit/18b8fdd476d6fdbe898e8c733523a0882b619a6c) | Merge pull request #44 from datalocaltmp/mcp-security-tooling |
| [a75cf42fc5a877e2d9515d3f099fa840e34ca557](https://github.com/meta-models/meta-model-cookbook/commit/a75cf42fc5a877e2d9515d3f099fa840e34ca557) | update main readme |
| [2db88031f8bbc7ab3c780b76e382a7ec2229f7e8](https://github.com/meta-models/meta-model-cookbook/commit/2db88031f8bbc7ab3c780b76e382a7ec2229f7e8) | add gitginore |
| [9691fc440a4d42044d693524276913ee374f723c](https://github.com/meta-models/meta-model-cookbook/commit/9691fc440a4d42044d693524276913ee374f723c) | add the README |
| [59f123eb142a6e1495b1514c0edcce862e5840f7](https://github.com/meta-models/meta-model-cookbook/commit/59f123eb142a6e1495b1514c0edcce862e5840f7) | add third party notice |
| [e39f1a3af1409b468f4a5c4122cdcfaf37bdfc17](https://github.com/meta-models/meta-model-cookbook/commit/e39f1a3af1409b468f4a5c4122cdcfaf37bdfc17) | update README file about removed tests |
| [233d41640643877ed929ab03c79a4f0b776fcf38](https://github.com/meta-models/meta-model-cookbook/commit/233d41640643877ed929ab03c79a4f0b776fcf38) | update asset_provenance md file |
| [0a99b987858ec4e49c04fc3f114bf33851e81deb](https://github.com/meta-models/meta-model-cookbook/commit/0a99b987858ec4e49c04fc3f114bf33851e81deb) | Merge pull request #62 from meta-models/ali/muse-robotics-cookbook-remove-tests |
| [699c362d695b6247cdda6993e4df687b0c116c0b](https://github.com/meta-models/meta-model-cookbook/commit/699c362d695b6247cdda6993e4df687b0c116c0b) | add assets and full demo |
| [c585212b391326f88dc2931c81eaecfc459ac392](https://github.com/meta-models/meta-model-cookbook/commit/c585212b391326f88dc2931c81eaecfc459ac392) | remove arch svg file |
| [95d24a720f2af5a4845e568fdce589d0e264b321](https://github.com/meta-models/meta-model-cookbook/commit/95d24a720f2af5a4845e568fdce589d0e264b321) | add planner |
| [adb435f0e72a2cadb0127e97830d0f3a32949395](https://github.com/meta-models/meta-model-cookbook/commit/adb435f0e72a2cadb0127e97830d0f3a32949395) | add plans json files |
| [620d61117f625bd46bf7832fc5e59aa4df81f63b](https://github.com/meta-models/meta-model-cookbook/commit/620d61117f625bd46bf7832fc5e59aa4df81f63b) | add robot run_demo run_full_demo skills py files |
| [398a1d8420ba8a21a142c9c7a1c69120850f7f3b](https://github.com/meta-models/meta-model-cookbook/commit/398a1d8420ba8a21a142c9c7a1c69120850f7f3b) | add requirement.txt file |
| [2b359fe977734d86e02b29754b8d4abd5184a4a6](https://github.com/meta-models/meta-model-cookbook/commit/2b359fe977734d86e02b29754b8d4abd5184a4a6) | remove 1/3 of test files |
| [01f0c40d664c89bd3bf8d691548388f97a02f084](https://github.com/meta-models/meta-model-cookbook/commit/01f0c40d664c89bd3bf8d691548388f97a02f084) | add franka panda assets obj files |
| [63ca7ba97487316a13f5ed06fa4bd914083602a3](https://github.com/meta-models/meta-model-cookbook/commit/63ca7ba97487316a13f5ed06fa4bd914083602a3) | remove 2/3rd of test files |
| [4d2c390b6032e88f7c96c86a2964c5a5914763f2](https://github.com/meta-models/meta-model-cookbook/commit/4d2c390b6032e88f7c96c86a2964c5a5914763f2) | Bump proxy-addr |
| [41d6568b49d0181dec1207f1edc490753481e3b8](https://github.com/meta-models/meta-model-cookbook/commit/41d6568b49d0181dec1207f1edc490753481e3b8) | Bump handlebars |
| [fde10d4cf8f2af735cffa8cc618e897fa31f0691](https://github.com/meta-models/meta-model-cookbook/commit/fde10d4cf8f2af735cffa8cc618e897fa31f0691) | add header to tests |
| [716b224d482f08c80af4a1e3ec1b71b840086a2f](https://github.com/meta-models/meta-model-cookbook/commit/716b224d482f08c80af4a1e3ec1b71b840086a2f) | Bump source-map-js in /02_agent_patterns/03_managing_context/proxy_build |
| [41614b115cdb8ec776423c6eee71061db0d4ab3d](https://github.com/meta-models/meta-model-cookbook/commit/41614b115cdb8ec776423c6eee71061db0d4ab3d) | add tests |
| [fd2950ed65517e3431e42564fd9300e0b5b9c61e](https://github.com/meta-models/meta-model-cookbook/commit/fd2950ed65517e3431e42564fd9300e0b5b9c61e) | add header to full demo |
| [6be43e96f228b0881087fb6880127027266ad53f](https://github.com/meta-models/meta-model-cookbook/commit/6be43e96f228b0881087fb6880127027266ad53f) | delete all test files |
| [f47fd072bf000a31a6b88a3ccccc28c1605976d3](https://github.com/meta-models/meta-model-cookbook/commit/f47fd072bf000a31a6b88a3ccccc28c1605976d3) | add to header to md files |
| [84041b0cc7b7541f539057e628c9776c94eefa73](https://github.com/meta-models/meta-model-cookbook/commit/84041b0cc7b7541f539057e628c9776c94eefa73) | Bump vite in /07_sam/03_headlocked_speech_bubble_captions |
| [641ed30d90cb512599a316216a6ba6daaeae9eee](https://github.com/meta-models/meta-model-cookbook/commit/641ed30d90cb512599a316216a6ba6daaeae9eee) | add header to assets |
| [50fe5b780965be4863639ca2dae10c1db7f24dac](https://github.com/meta-models/meta-model-cookbook/commit/50fe5b780965be4863639ca2dae10c1db7f24dac) | Bump vite in /02_agent_patterns/03_managing_context/proxy_build |
| [3e65e2f9e439334f02170230b009ee5a0f0bf93f](https://github.com/meta-models/meta-model-cookbook/commit/3e65e2f9e439334f02170230b009ee5a0f0bf93f) | Bump multer in /07_sam/03_headlocked_speech_bubble_captions |
| [f36e5b18ccd2134e8886aad26de1cfcd23b56dfe](https://github.com/meta-models/meta-model-cookbook/commit/f36e5b18ccd2134e8886aad26de1cfcd23b56dfe) | Bump setuptools in /06_muse_voice/02_voice_chess_cua |
| [4abf74813087d272818265eb7ee386a7e88b216b](https://github.com/meta-models/meta-model-cookbook/commit/4abf74813087d272818265eb7ee386a7e88b216b) | Bump undici in /07_sam/03_headlocked_speech_bubble_captions |
| [0dd3266172a5a6906b8a7f16fb6ffd899dcb9fc3](https://github.com/meta-models/meta-model-cookbook/commit/0dd3266172a5a6906b8a7f16fb6ffd899dcb9fc3) | Bump pillow from 12.3.0 to 13.0.0 in /03_use_cases/14_muse_robotics |
| [0b50238be9806621c603da1990aab32adb0f660f](https://github.com/meta-models/meta-model-cookbook/commit/0b50238be9806621c603da1990aab32adb0f660f) | Bump body-parser in /07_sam/03_headlocked_speech_bubble_captions |
| [9fd3bedbda9eabbe7429e2ce243bf369dea7983b](https://github.com/meta-models/meta-model-cookbook/commit/9fd3bedbda9eabbe7429e2ce243bf369dea7983b) | Bump @vitest/mocker and vitest |
| [345f44de2c559c134f01f8764a850c0648704470](https://github.com/meta-models/meta-model-cookbook/commit/345f44de2c559c134f01f8764a850c0648704470) | add header to main files |

#### meta-oss-cookbook: branch inventory

| Branch | Pinned head |
|---|---|
| ali/axolotl-sft-recipe | [2ffe534bbf970e7d8b84ef4f086019d374b752b4](https://github.com/meta-models/meta-oss-cookbook/tree/2ffe534bbf970e7d8b84ef4f086019d374b752b4) |
| ali/cookbook-readme-showcase | [5892d1f098cb6da5a769dc1ddf1d048f07f2cd91](https://github.com/meta-models/meta-oss-cookbook/tree/5892d1f098cb6da5a769dc1ddf1d048f07f2cd91) |
| ali/post-training-titanrl | [db0675b4eff0fe33363a467098a4bc993e05c17b](https://github.com/meta-models/meta-oss-cookbook/tree/db0675b4eff0fe33363a467098a4bc993e05c17b) |
| ali/titanrl-recipe-on-main | [ec9be0d5ce81985e367f467baa3390141c0df3ad](https://github.com/meta-models/meta-oss-cookbook/tree/ec9be0d5ce81985e367f467baa3390141c0df3ad) |
| dependabot/npm_and_yarn/muse-glimmer/recipes/voice-agent-macos/apps/web/vite-8.3.5 | [d01f8352aa482273056a5732de68a85efd92b5a9](https://github.com/meta-models/meta-oss-cookbook/tree/d01f8352aa482273056a5732de68a85efd92b5a9) |
| dependabot/uv/muse-glimmer/recipes/voice-agent-macos/aiohttp-3.14.4 | [0a6ff1457a09061b2cd4168929455a37d3f417f7](https://github.com/meta-models/meta-oss-cookbook/tree/0a6ff1457a09061b2cd4168929455a37d3f417f7) |
| dependabot/uv/muse-glimmer/recipes/voice-agent-macos/filelock-4.2.1 | [30297b6b415d79cccf2ab33de4a15b46cce482e3](https://github.com/meta-models/meta-oss-cookbook/tree/30297b6b415d79cccf2ab33de4a15b46cce482e3) |
| dependabot/uv/muse-glimmer/recipes/voice-agent-macos/multidict-6.9.1 | [926366caa6aa049785ea9e7dc8714329869f8abb](https://github.com/meta-models/meta-oss-cookbook/tree/926366caa6aa049785ea9e7dc8714329869f8abb) |
| dependabot/uv/muse-glimmer/recipes/voice-agent-macos/opentelemetry-api-1.45.1 | [9ce9633c7412df02047dc6dbce89e9ad2df6d0ef](https://github.com/meta-models/meta-oss-cookbook/tree/9ce9633c7412df02047dc6dbce89e9ad2df6d0ef) |
| dependabot/uv/muse-glimmer/recipes/voice-agent-macos/pillow-13.0.0 | [93cc07d0ca506fcfcc3788c8d545535e9b8273ab](https://github.com/meta-models/meta-oss-cookbook/tree/93cc07d0ca506fcfcc3788c8d545535e9b8273ab) |
| dependabot/uv/muse-glimmer/recipes/voice-agent-macos/pyjwt-2.15.0 | [0e756c69b719b00dc092af0eca73ae7a31aaaa18](https://github.com/meta-models/meta-oss-cookbook/tree/0e756c69b719b00dc092af0eca73ae7a31aaaa18) |
| dependabot/uv/muse-glimmer/recipes/voice-agent-macos/setuptools-84.1.0 | [ab50dd15ef966924f75150889af7a497a8dbedd7](https://github.com/meta-models/meta-oss-cookbook/tree/ab50dd15ef966924f75150889af7a497a8dbedd7) |
| dependabot/uv/muse-glimmer/recipes/voice-agent-macos/urllib3-2.8.0 | [35924c7a2938d455fcf8e3e250efbdbdcb57f89b](https://github.com/meta-models/meta-oss-cookbook/tree/35924c7a2938d455fcf8e3e250efbdbdcb57f89b) |
| docs/sglang-guide-sync | [0cc6ae0e152eb52e0a91fad41a5ba2dcb0cd1545](https://github.com/meta-models/meta-oss-cookbook/tree/0cc6ae0e152eb52e0a91fad41a5ba2dcb0cd1545) |
| docs/voice-agent-model-artifacts | [e8b9141d6135108e921ff319ffb0852dc396b41b](https://github.com/meta-models/meta-oss-cookbook/tree/e8b9141d6135108e921ff319ffb0852dc396b41b) |
| fix/curl-content-type | [a93a58f15343821ec125be82c0dfa78cabbf9249](https://github.com/meta-models/meta-oss-cookbook/tree/a93a58f15343821ec125be82c0dfa78cabbf9249) |
| fix/vllm-parser-names-and-chat-template | [2d76ee67215a4c34680ff372aee331f513e12bba](https://github.com/meta-models/meta-oss-cookbook/tree/2d76ee67215a4c34680ff372aee331f513e12bba) |
| fix/voice-agent-response-stalls | [a86af0c7fe8fdab5f2b3fe03792bb9cba908eb9f](https://github.com/meta-models/meta-oss-cookbook/tree/a86af0c7fe8fdab5f2b3fe03792bb9cba908eb9f) |
| main | [a6c315d703170ac29751eb160eecb977d16e3a88](https://github.com/meta-models/meta-oss-cookbook/tree/a6c315d703170ac29751eb160eecb977d16e3a88) |
| muse-glimmer/axolotl-chart-names | [22e94a6874eb559e6937a6e012a994cb318ae656](https://github.com/meta-models/meta-oss-cookbook/tree/22e94a6874eb559e6937a6e012a994cb318ae656) |
| muse-spark/sync-launch-docs | [e9c5f1959a0ba6b718c52ac227229e2105064987](https://github.com/meta-models/meta-oss-cookbook/tree/e9c5f1959a0ba6b718c52ac227229e2105064987) |
| muse-spark/sync-post-training | [7c4bc893271096b081db0bf3d0638e165b60d4d4](https://github.com/meta-models/meta-oss-cookbook/tree/7c4bc893271096b081db0bf3d0638e165b60d4d4) |
| nelish/fix-linux-prebuilt-claims | [3b27bc494dc9c5e0f84931e537b9409581b645c4](https://github.com/meta-models/meta-oss-cookbook/tree/3b27bc494dc9c5e0f84931e537b9409581b645c4) |
| nelish/gguf-filename-sync | [6ea982768faf974d23b283705f2651efbdd8bc95](https://github.com/meta-models/meta-oss-cookbook/tree/6ea982768faf974d23b283705f2651efbdd8bc95) |
| restructure/muse-glimmer-muse-spark | [e4742dcdc70c9e2203ab8b997ed53a4dbb21dffa](https://github.com/meta-models/meta-oss-cookbook/tree/e4742dcdc70c9e2203ab8b997ed53a4dbb21dffa) |
| younghan/computer-use-web-dynamic-gguf | [9e289b7e283d41e054338c2c12c1af3679577da3](https://github.com/meta-models/meta-oss-cookbook/tree/9e289b7e283d41e054338c2c12c1af3679577da3) |
| younghan/drop-reasoning-format-flag | [8777eb103f81dfc9665df23471d6a21cf5fe643c](https://github.com/meta-models/meta-oss-cookbook/tree/8777eb103f81dfc9665df23471d6a21cf5fe643c) |
| younghan/executorch-blog-context | [febcfffa7298dd6a33d95a91d6b14db9309ccf96](https://github.com/meta-models/meta-oss-cookbook/tree/febcfffa7298dd6a33d95a91d6b14db9309ccf96) |
| younghan/executorch-gguf-downloads | [26690ad29da9072430005f58ed8fcc900c937b32](https://github.com/meta-models/meta-oss-cookbook/tree/26690ad29da9072430005f58ed8fcc900c937b32) |
| younghan/fix-executorch-downloads | [fa4c464d062275e7c0c3bd6d9c12d71bfd5fe6c6](https://github.com/meta-models/meta-oss-cookbook/tree/fa4c464d062275e7c0c3bd6d9c12d71bfd5fe6c6) |
| younghan/fix-executorch-review | [0e5cbeb6488bf69d74baf21162065e924a9c8fdc](https://github.com/meta-models/meta-oss-cookbook/tree/0e5cbeb6488bf69d74baf21162065e924a9c8fdc) |
| younghan/fix-llamacpp-review | [9c54c9d37ac511a18cf6c7928ed9d5057afb961c](https://github.com/meta-models/meta-oss-cookbook/tree/9c54c9d37ac511a18cf6c7928ed9d5057afb961c) |
| younghan/hosted-together-ai | [e910915b108ac4229065fbedf7204dd08cce0a92](https://github.com/meta-models/meta-oss-cookbook/tree/e910915b108ac4229065fbedf7204dd08cce0a92) |
| younghan/intel-links | [b5ba43c6bb36d2b97254c7a2176a0619ad5d4627](https://github.com/meta-models/meta-oss-cookbook/tree/b5ba43c6bb36d2b97254c7a2176a0619ad5d4627) |
| younghan/llamacpp-gguf-run-notes | [8ae9e24d5a09aee90bef6144560cd3d3a43b6179](https://github.com/meta-models/meta-oss-cookbook/tree/8ae9e24d5a09aee90bef6144560cd3d3a43b6179) |
| younghan/nemoclaw-sandbox | [67098bb9321dc1942668d462031f0b62abd027d3](https://github.com/meta-models/meta-oss-cookbook/tree/67098bb9321dc1942668d462031f0b62abd027d3) |
| younghan/platform-nvidia | [cc4f51c643bfc2b40942060845eefb562a5dbd7c](https://github.com/meta-models/meta-oss-cookbook/tree/cc4f51c643bfc2b40942060845eefb562a5dbd7c) |
| younghan/quickstart-no-quant-scheme | [240cc68a5f481e348ebb0b9fc0469591a5eabddc](https://github.com/meta-models/meta-oss-cookbook/tree/240cc68a5f481e348ebb0b9fc0469591a5eabddc) |
| younghan/recipe-nemoclaw | [488e41fdd91373f8a61a8ae157afccbfc0b7e41d](https://github.com/meta-models/meta-oss-cookbook/tree/488e41fdd91373f8a61a8ae157afccbfc0b7e41d) |
| younghan/release-readme-and-cua-refresh | [512f0068411ee69148428ba30f3434ede730cd9b](https://github.com/meta-models/meta-oss-cookbook/tree/512f0068411ee69148428ba30f3434ede730cd9b) |
| younghan/sglang-partner-matrix | [30963d586c45e187b30b2958f7f5435f0f1d0604](https://github.com/meta-models/meta-oss-cookbook/tree/30963d586c45e187b30b2958f7f5435f0f1d0604) |
| younghan/status-refresh | [0177441c6338bfe9355a1f671ecd96fc8a024a83](https://github.com/meta-models/meta-oss-cookbook/tree/0177441c6338bfe9355a1f671ecd96fc8a024a83) |
| younghan/unsloth-banner | [becda71e97069d5b8f69d25b5ecab1cb219105ce](https://github.com/meta-models/meta-oss-cookbook/tree/becda71e97069d5b8f69d25b5ecab1cb219105ce) |

#### meta-oss-cookbook: issue and PR inventory

States below are the API collection state at retrieval, not an assessment that an issue is resolved or a PR is merged. Closed PRs may be unmerged. Comments/reviews and patches were not exhaustively reviewed.

| Item | Type | State | Title |
|---|---|---|---|
| [#65](https://github.com/meta-models/meta-oss-cookbook/pull/65) | PR | closed | docs: expand the Meta OSS Cookbook landing page |
| [#64](https://github.com/meta-models/meta-oss-cookbook/pull/64) | PR | open | build(deps): bump setuptools from 84.0.0 to 84.1.0 in /muse-glimmer/recipes/voice-agent-macos |
| [#63](https://github.com/meta-models/meta-oss-cookbook/pull/63) | PR | open | build(deps): bump filelock from 3.32.5 to 4.2.1 in /muse-glimmer/recipes/voice-agent-macos |
| [#62](https://github.com/meta-models/meta-oss-cookbook/pull/62) | PR | open | build(deps): bump pillow from 12.3.0 to 13.0.0 in /muse-glimmer/recipes/voice-agent-macos |
| [#61](https://github.com/meta-models/meta-oss-cookbook/pull/61) | PR | open | build(deps): bump opentelemetry-api from 1.44.0 to 1.45.1 in /muse-glimmer/recipes/voice-agent-macos |
| [#60](https://github.com/meta-models/meta-oss-cookbook/pull/60) | PR | open | docs: clarify CoSyn slicing and bounded SFT evaluation |
| [#59](https://github.com/meta-models/meta-oss-cookbook/pull/59) | PR | open | build(deps-dev): bump vite from 8.2.2 to 8.3.5 in /muse-glimmer/recipes/voice-agent-macos/apps/web |
| [#58](https://github.com/meta-models/meta-oss-cookbook/pull/58) | PR | open | build(deps): bump aiohttp from 3.14.3 to 3.14.4 in /muse-glimmer/recipes/voice-agent-macos |
| [#57](https://github.com/meta-models/meta-oss-cookbook/pull/57) | PR | closed | muse-glimmer: tidy the Axolotl and TitanRL recipes |
| [#56](https://github.com/meta-models/meta-oss-cookbook/pull/56) | PR | closed | muse-spark: label the TorchTitan rows and fix the TRL example link |
| [#55](https://github.com/meta-models/meta-oss-cookbook/pull/55) | PR | closed | muse-spark: add TitanRL post-training with pluggable tasks |
| [#54](https://github.com/meta-models/meta-oss-cookbook/pull/54) | PR | closed | muse-spark: sync with the launched docs and add the Mac recipe |
| [#53](https://github.com/meta-models/meta-oss-cookbook/pull/53) | PR | closed | muse-spark: add TorchTitan SFT post-training (text, image, audio) |
| [#52](https://github.com/meta-models/meta-oss-cookbook/pull/52) | PR | open | build(deps-dev): bump pyjwt from 2.13.0 to 2.15.0 in /muse-glimmer/recipes/voice-agent-macos |
| [#51](https://github.com/meta-models/meta-oss-cookbook/pull/51) | PR | open | build(deps): bump urllib3 from 2.7.0 to 2.8.0 in /muse-glimmer/recipes/voice-agent-macos |
| [#50](https://github.com/meta-models/meta-oss-cookbook/pull/50) | PR | open | build(deps): bump multidict from 6.7.1 to 6.9.1 in /muse-glimmer/recipes/voice-agent-macos |
| [#49](https://github.com/meta-models/meta-oss-cookbook/pull/49) | PR | closed | Restructure into muse-glimmer/ and muse-spark/, and add the Muse Spark Open cookbook |
| [#48](https://github.com/meta-models/meta-oss-cookbook/pull/48) | PR | open | Document voice agent model artifacts |
| [#47](https://github.com/meta-models/meta-oss-cookbook/pull/47) | PR | closed | Bump urllib3 from 2.7.0 to 2.8.0 in /recipes/voice-agent-macos |
| [#46](https://github.com/meta-models/meta-oss-cookbook/pull/46) | PR | closed | Bump pyjwt from 2.13.0 to 2.15.0 in /recipes/voice-agent-macos |
| [#45](https://github.com/meta-models/meta-oss-cookbook/pull/45) | PR | closed | post-training/titanrl: run the data-analyst recipe on TorchTitan main |
| [#44](https://github.com/meta-models/meta-oss-cookbook/pull/44) | PR | closed | Prevent local voice agent response stalls |
| [#43](https://github.com/meta-models/meta-oss-cookbook/pull/43) | PR | closed | Add demo and pinned setup for the local voice agent |
| [#42](https://github.com/meta-models/meta-oss-cookbook/pull/42) | PR | closed | build(deps): bump transformers from 5.0.0rc1 to 5.10.1 in /recipes/voice-agent-macos |
| [#41](https://github.com/meta-models/meta-oss-cookbook/pull/41) | PR | closed | build(deps-dev): bump pytest from 8.4.2 to 9.0.3 in /recipes/voice-agent-macos |
| [#40](https://github.com/meta-models/meta-oss-cookbook/pull/40) | PR | closed | Add local macOS voice agent recipe |
| [#39](https://github.com/meta-models/meta-oss-cookbook/pull/39) | PR | closed | Add Axolotl SFT recipe and organize post-training by objective |
| [#38](https://github.com/meta-models/meta-oss-cookbook/pull/38) | PR | closed | post-training: add a new section, and its first recipe (post-train Muse Glimmer with TitanRL) |
| [#37](https://github.com/meta-models/meta-oss-cookbook/issues/37) | Issue | open | llama-cpp.md: the n_ctx_train cap was relocated, not removed — `-c` alone silently serves 131072 (correction: YaRN flags alone lift it; --override-kv only needed without scaling) |
| [#36](https://github.com/meta-models/meta-oss-cookbook/pull/36) | PR | closed | docs: sync remaining GGUF filenames to the HF repo |
| [#35](https://github.com/meta-models/meta-oss-cookbook/pull/35) | PR | closed | Update ExecuTorch GGUF download options |
| [#34](https://github.com/meta-models/meta-oss-cookbook/pull/34) | PR | closed | add quants and webui to llama.cpp guide |
| [#33](https://github.com/meta-models/meta-oss-cookbook/pull/33) | PR | closed | Add Ollama guide for Muse Glimmer |
| [#32](https://github.com/meta-models/meta-oss-cookbook/pull/32) | PR | closed | Add the NVIDIA B300 page and the sandboxed-agent demo |
| [#31](https://github.com/meta-models/meta-oss-cookbook/pull/31) | PR | closed | docs(sglang): install without [all], note the cargo prerequisite, verify at t=1 |
| [#30](https://github.com/meta-models/meta-oss-cookbook/pull/30) | PR | closed | inference-server: make the SGLang guide runtime-specific |
| [#29](https://github.com/meta-models/meta-oss-cookbook/pull/29) | PR | closed | platform: add the NVIDIA B300 page |
| [#28](https://github.com/meta-models/meta-oss-cookbook/pull/28) | PR | closed | quickstart: stop naming the quantization scheme |
| [#27](https://github.com/meta-models/meta-oss-cookbook/pull/27) | PR | closed | docs(llama.cpp): correct Linux prebuilt claims, add Ampere arch |
| [#26](https://github.com/meta-models/meta-oss-cookbook/pull/26) | PR | closed | inference-server: fix the ExecuTorch download commands |
| [#25](https://github.com/meta-models/meta-oss-cookbook/pull/25) | PR | closed | llama.cpp changes |
| [#24](https://github.com/meta-models/meta-oss-cookbook/pull/24) | PR | closed | docs(computer-use-web): serve the dynamic GGUF, drop the numbers that don't transfer |
| [#23](https://github.com/meta-models/meta-oss-cookbook/pull/23) | PR | closed | docs: correct the recipe verification claim, refresh the computer-use-web recipe |
| [#22](https://github.com/meta-models/meta-oss-cookbook/pull/22) | PR | closed | README: vision is supported today, not a fast-follow |
| [#21](https://github.com/meta-models/meta-oss-cookbook/pull/21) | PR | closed | hosted: add Together AI, corrected against their published model page |
| [#20](https://github.com/meta-models/meta-oss-cookbook/pull/20) | PR | closed | inference-server: say why ExecuTorch, and what it cannot do yet |
| [#19](https://github.com/meta-models/meta-oss-cookbook/pull/19) | PR | closed | docs: drop a redundant reasoning-format flag from the serve commands |
| [#18](https://github.com/meta-models/meta-oss-cookbook/pull/18) | PR | closed | llama.cpp: replace master-only guidance with a b10353 version floor |
| [#17](https://github.com/meta-models/meta-oss-cookbook/pull/17) | PR | closed | llama.cpp: add CLI usage, per-slot context, and reasoning-budget notes |
| [#16](https://github.com/meta-models/meta-oss-cookbook/pull/16) | PR | closed | sglang: restore closed PR #7 work, then fold in SGLang's platform matrix |
| [#15](https://github.com/meta-models/meta-oss-cookbook/pull/15) | PR | closed | inference-server: fill sglang.md gaps, add missing unsloth.md sections (recreates #7) |
| [#14](https://github.com/meta-models/meta-oss-cookbook/pull/14) | PR | closed | vLLM: switch install path from pip to Docker, correct parser/sampling/VRAM guidance (recreates #11) |
| [#13](https://github.com/meta-models/meta-oss-cookbook/pull/13) | PR | closed | fix: Intel deploy commands — unrunnable -tp placeholder, model path, parser names (recreates #5) |
| [#12](https://github.com/meta-models/meta-oss-cookbook/pull/12) | PR | closed | intel: link Intel's day-0 Muse Glimmer guide; fill blank Xeon memory cell |
| [#11](https://github.com/meta-models/meta-oss-cookbook/pull/11) | PR | closed | vLLM: switch install path from pip to Docker, correct parser/sampling/VRAM guidance |
| [#10](https://github.com/meta-models/meta-oss-cookbook/pull/10) | PR | closed | docs: make inference-server README a plain page list, remove README 404 |
| [#9](https://github.com/meta-models/meta-oss-cookbook/pull/9) | PR | closed | docs: add Muse Glimmer 30B banner to Unsloth page |
| [#8](https://github.com/meta-models/meta-oss-cookbook/pull/8) | PR | closed | llama.cpp: build from upstream, drop private fork reference |
| [#7](https://github.com/meta-models/meta-oss-cookbook/pull/7) | PR | closed | inference-server: fill sglang.md gaps, add missing unsloth.md sections |
| [#6](https://github.com/meta-models/meta-oss-cookbook/pull/6) | PR | closed | executorch.md: add missing export_dflash command, correct drifted serve guidance |
| [#5](https://github.com/meta-models/meta-oss-cookbook/pull/5) | PR | closed | fix: Intel deploy commands — unrunnable -tp placeholder, model path, parser names |
| [#4](https://github.com/meta-models/meta-oss-cookbook/pull/4) | PR | closed | fix: correct vLLM parser names and drop the unresolvable --chat-template flag |
| [#3](https://github.com/meta-models/meta-oss-cookbook/pull/3) | PR | closed | fix: add Content-Type: application/json to OpenAI-compatible curl examples |
| [#2](https://github.com/meta-models/meta-oss-cookbook/pull/2) | PR | closed | fix: add Content-Type: application/json to OpenAI-compatible curl examples |
| [#1](https://github.com/meta-models/meta-oss-cookbook/pull/1) | PR | closed | Update the README |

#### meta-oss-cookbook: reachable commit inventory

Commit subjects below are metadata. They do not establish that the described behavior exists in the pinned main tree. All commits are listed once per repository, including commits reachable only from non-main branches.

| Commit | Subject |
|---|---|
| [ea7419bf2f42acd815aba40355bf8f6c4c31b362](https://github.com/meta-models/meta-oss-cookbook/commit/ea7419bf2f42acd815aba40355bf8f6c4c31b362) | Initial commit: Meta OSS cookbook |
| [27d2b45791a575d38bbd689db2b8f7dcb676fcf9](https://github.com/meta-models/meta-oss-cookbook/commit/27d2b45791a575d38bbd689db2b8f7dcb676fcf9) | Update the README |
| [0144e7c346b125b25185b6ffb29393853a7471e0](https://github.com/meta-models/meta-oss-cookbook/commit/0144e7c346b125b25185b6ffb29393853a7471e0) | Merge pull request #1 from HamidShojanazeri/patch-1 |
| [a93a58f15343821ec125be82c0dfa78cabbf9249](https://github.com/meta-models/meta-oss-cookbook/commit/a93a58f15343821ec125be82c0dfa78cabbf9249) | fix: add Content-Type: application/json to OpenAI-compatible curl examples |
| [d2365cbd4b6bacd90cb5b51b872eab94d9e0c62d](https://github.com/meta-models/meta-oss-cookbook/commit/d2365cbd4b6bacd90cb5b51b872eab94d9e0c62d) | Merge pull request #3 from meta-models/fix/curl-content-type |
| [2d76ee67215a4c34680ff372aee331f513e12bba](https://github.com/meta-models/meta-oss-cookbook/commit/2d76ee67215a4c34680ff372aee331f513e12bba) | fix: correct vLLM parser names and drop the unresolvable --chat-template flag |
| [fbf91c77ad83de6333a72fb410b7d5820f15661c](https://github.com/meta-models/meta-oss-cookbook/commit/fbf91c77ad83de6333a72fb410b7d5820f15661c) | executorch.md: add missing export_dflash command, correct drifted serve guidance |
| [6f39015160de9f55a7a6712b089e197c938356e0](https://github.com/meta-models/meta-oss-cookbook/commit/6f39015160de9f55a7a6712b089e197c938356e0) | executorch.md: state the prebuilt-PTE caveats explicitly |
| [9c54c9d37ac511a18cf6c7928ed9d5057afb961c](https://github.com/meta-models/meta-oss-cookbook/commit/9c54c9d37ac511a18cf6c7928ed9d5057afb961c) | llama.cpp: build from upstream, drop private fork reference |
| [becda71e97069d5b8f69d25b5ecab1cb219105ce](https://github.com/meta-models/meta-oss-cookbook/commit/becda71e97069d5b8f69d25b5ecab1cb219105ce) | docs: add Muse Glimmer 30B banner to Unsloth page |
| [31fdba6b1179bb0c773cf93d202d3ea617e92ed6](https://github.com/meta-models/meta-oss-cookbook/commit/31fdba6b1179bb0c773cf93d202d3ea617e92ed6) | executorch.md: cite the upstream on-device agentic AI announcement |
| [2505ad29ec6b50292f8a883c77b057d70a7305c9](https://github.com/meta-models/meta-oss-cookbook/commit/2505ad29ec6b50292f8a883c77b057d70a7305c9) | docs: refresh inference-server status table, drop README 404 |
| [af8e97b2b0981a8be15d30f4f0d149632738fb8f](https://github.com/meta-models/meta-oss-cookbook/commit/af8e97b2b0981a8be15d30f4f0d149632738fb8f) | llama.cpp: build from upstream, drop private fork reference |
| [0177441c6338bfe9355a1f671ecd96fc8a024a83](https://github.com/meta-models/meta-oss-cookbook/commit/0177441c6338bfe9355a1f671ecd96fc8a024a83) | docs: replace inference-server status table with a plain page list |
| [b5ba43c6bb36d2b97254c7a2176a0619ad5d4627](https://github.com/meta-models/meta-oss-cookbook/commit/b5ba43c6bb36d2b97254c7a2176a0619ad5d4627) | intel: link Intel's day-0 Muse Glimmer guide; fill blank Xeon memory cell |
| [9bdf5e34b691fe10272b439a928b4572d731bb3c](https://github.com/meta-models/meta-oss-cookbook/commit/9bdf5e34b691fe10272b439a928b4572d731bb3c) | docs: add Muse Glimmer 30B banner to Unsloth page (#9) |
| [35776b1fc139e09ce227d144eb1f795ad1a7d5f3](https://github.com/meta-models/meta-oss-cookbook/commit/35776b1fc139e09ce227d144eb1f795ad1a7d5f3) | docs: make inference-server README a plain page list |
| [8a3af8f5d3e272c752c8c5e143211e1dd52e2a11](https://github.com/meta-models/meta-oss-cookbook/commit/8a3af8f5d3e272c752c8c5e143211e1dd52e2a11) | executorch.md: document the 16 prebuilt PTE variants and their download |
| [a122ee33764238857dfe979e41b671775589f048](https://github.com/meta-models/meta-oss-cookbook/commit/a122ee33764238857dfe979e41b671775589f048) | intel: link Intel's day-0 Muse Glimmer guide; fill blank Xeon memory cell |
| [0e5cbeb6488bf69d74baf21162065e924a9c8fdc](https://github.com/meta-models/meta-oss-cookbook/commit/0e5cbeb6488bf69d74baf21162065e924a9c8fdc) | executorch.md: name the prebuilt PTE repo in the intro |
| [f12568656690c23847dfa77c4579751b8bdd7a76](https://github.com/meta-models/meta-oss-cookbook/commit/f12568656690c23847dfa77c4579751b8bdd7a76) | executorch.md |
| [c034a26382654a60c055144550c43e3e587cefaa](https://github.com/meta-models/meta-oss-cookbook/commit/c034a26382654a60c055144550c43e3e587cefaa) | inference-server: restore sglang.md work from closed PR #7 |
| [30963d586c45e187b30b2958f7f5435f0f1d0604](https://github.com/meta-models/meta-oss-cookbook/commit/30963d586c45e187b30b2958f7f5435f0f1d0604) | sglang: fold in SGLang's seven-platform verification matrix |
| [8ae9e24d5a09aee90bef6144560cd3d3a43b6179](https://github.com/meta-models/meta-oss-cookbook/commit/8ae9e24d5a09aee90bef6144560cd3d3a43b6179) | llama.cpp: add CLI usage, per-slot context, and reasoning-budget notes |
| [692d19bd626ce3199a585ef272ce0db9a727b2ed](https://github.com/meta-models/meta-oss-cookbook/commit/692d19bd626ce3199a585ef272ce0db9a727b2ed) | llama.cpp: replace master-only guidance with a b10353 version floor (#18) |
| [400c1831c1869d8c891ed87c4cb44b3a2be550ff](https://github.com/meta-models/meta-oss-cookbook/commit/400c1831c1869d8c891ed87c4cb44b3a2be550ff) | fix: Intel deploy commands - unrunnable -tp placeholder, model path, parser names (#13) |
| [11d7b5d7a8af9319ab7c606965731330e637c224](https://github.com/meta-models/meta-oss-cookbook/commit/11d7b5d7a8af9319ab7c606965731330e637c224) | vLLM: switch install path from pip to Docker, correct parser/sampling/VRAM guidance (#14) |
| [b73530db138e70af91476b300c807bbbc7bc2801](https://github.com/meta-models/meta-oss-cookbook/commit/b73530db138e70af91476b300c807bbbc7bc2801) | inference-server: fill sglang.md gaps, add SGLang platform matrix, complete unsloth.md (#15) |
| [8777eb103f81dfc9665df23471d6a21cf5fe643c](https://github.com/meta-models/meta-oss-cookbook/commit/8777eb103f81dfc9665df23471d6a21cf5fe643c) | docs: drop a redundant reasoning-format flag from the serve commands |
| [febcfffa7298dd6a33d95a91d6b14db9309ccf96](https://github.com/meta-models/meta-oss-cookbook/commit/febcfffa7298dd6a33d95a91d6b14db9309ccf96) | inference-server: say why ExecuTorch, and what it cannot do yet |
| [293c707158aadb244737d2d0b91018cd075805c6](https://github.com/meta-models/meta-oss-cookbook/commit/293c707158aadb244737d2d0b91018cd075805c6) | docs: drop a redundant reasoning-format flag from the llama.cpp commands (#19) |
| [38eeef5c1904c1c2b28e1b6db84918a9c3e9636c](https://github.com/meta-models/meta-oss-cookbook/commit/38eeef5c1904c1c2b28e1b6db84918a9c3e9636c) | docs(llama.cpp): add GGUF run notes for CLI usage, per-slot context, and reasoning budget (#17) |
| [0575e6dac15f275a141dcb7ebd5b5d35cde79eba](https://github.com/meta-models/meta-oss-cookbook/commit/0575e6dac15f275a141dcb7ebd5b5d35cde79eba) | inference-server: say why ExecuTorch, and what it cannot do yet (#20) |
| [e910915b108ac4229065fbedf7204dd08cce0a92](https://github.com/meta-models/meta-oss-cookbook/commit/e910915b108ac4229065fbedf7204dd08cce0a92) | hosted: add Together AI, corrected against their published model page |
| [2c176c20721585b74126c3cf4a2ce6ff73a7e508](https://github.com/meta-models/meta-oss-cookbook/commit/2c176c20721585b74126c3cf4a2ce6ff73a7e508) | hosted: add Together AI, corrected against their published model page (#21) |
| [9e3b220164ebd315b00267c54e799715922b8cb6](https://github.com/meta-models/meta-oss-cookbook/commit/9e3b220164ebd315b00267c54e799715922b8cb6) | README: vision is supported today, not a fast-follow (#22) |
| [512f0068411ee69148428ba30f3434ede730cd9b](https://github.com/meta-models/meta-oss-cookbook/commit/512f0068411ee69148428ba30f3434ede730cd9b) | docs: correct the recipe verification claim, refresh the computer-use-web recipe |
| [edd771264761d4642318340b8179aa6905f34233](https://github.com/meta-models/meta-oss-cookbook/commit/edd771264761d4642318340b8179aa6905f34233) | docs: correct the recipe verification claim, refresh the computer-use-web recipe (#23) |
| [9e289b7e283d41e054338c2c12c1af3679577da3](https://github.com/meta-models/meta-oss-cookbook/commit/9e289b7e283d41e054338c2c12c1af3679577da3) | docs(computer-use-web): serve the dynamic GGUF, drop the numbers that don't transfer |
| [71e60d3f546ea0899389a4b6b763c7d068cf9e37](https://github.com/meta-models/meta-oss-cookbook/commit/71e60d3f546ea0899389a4b6b763c7d068cf9e37) | docs(computer-use-web): serve the dynamic GGUF, drop the numbers that don't transfer (#24) |
| [3b27bc494dc9c5e0f84931e537b9409581b645c4](https://github.com/meta-models/meta-oss-cookbook/commit/3b27bc494dc9c5e0f84931e537b9409581b645c4) | docs(llama.cpp): correct Linux prebuilt claims, add Ampere arch |
| [fa4c464d062275e7c0c3bd6d9c12d71bfd5fe6c6](https://github.com/meta-models/meta-oss-cookbook/commit/fa4c464d062275e7c0c3bd6d9c12d71bfd5fe6c6) | inference-server: fix the ExecuTorch download commands |
| [53e20e08cf8dca5f9a473a1e1a60bae8cb3c6c98](https://github.com/meta-models/meta-oss-cookbook/commit/53e20e08cf8dca5f9a473a1e1a60bae8cb3c6c98) | inference-server: fix the ExecuTorch download commands (#26) |
| [240cc68a5f481e348ebb0b9fc0469591a5eabddc](https://github.com/meta-models/meta-oss-cookbook/commit/240cc68a5f481e348ebb0b9fc0469591a5eabddc) | quickstart: stop naming the quantization scheme |
| [cc4f51c643bfc2b40942060845eefb562a5dbd7c](https://github.com/meta-models/meta-oss-cookbook/commit/cc4f51c643bfc2b40942060845eefb562a5dbd7c) | platform: add the NVIDIA B300 page |
| [a5d73f724189421b700a111c9a334ce26b743722](https://github.com/meta-models/meta-oss-cookbook/commit/a5d73f724189421b700a111c9a334ce26b743722) | docs(llama.cpp): correct Linux prebuilt claims, add Ampere arch (#27) |
| [2e3f0c3763e890c979b6999ab7c6e64f9f7031cd](https://github.com/meta-models/meta-oss-cookbook/commit/2e3f0c3763e890c979b6999ab7c6e64f9f7031cd) | quickstart: stop naming the quantization scheme (#28) |
| [0cc6ae0e152eb52e0a91fad41a5ba2dcb0cd1545](https://github.com/meta-models/meta-oss-cookbook/commit/0cc6ae0e152eb52e0a91fad41a5ba2dcb0cd1545) | inference-server: make the SGLang guide runtime-specific |
| [063e7b6209a936203542554b3a1b5a0f02ff0b23](https://github.com/meta-models/meta-oss-cookbook/commit/063e7b6209a936203542554b3a1b5a0f02ff0b23) | Merge pull request #30 from meta-models/docs/sglang-guide-sync |
| [23f24a408261a8b5b74f27ca6296345c8c471d05](https://github.com/meta-models/meta-oss-cookbook/commit/23f24a408261a8b5b74f27ca6296345c8c471d05) | docs(sglang): install without [all], note the cargo prerequisite, verify at t=1 |
| [5f3b65d2b0b6555207ed68956221b5083cac6053](https://github.com/meta-models/meta-oss-cookbook/commit/5f3b65d2b0b6555207ed68956221b5083cac6053) | docs(sglang): install without [all], note the cargo prerequisite, verify at t=1 |
| [eb7f2f00409ef5d5119282412c96ab023fb3a77a](https://github.com/meta-models/meta-oss-cookbook/commit/eb7f2f00409ef5d5119282412c96ab023fb3a77a) | llama.cpp changes (#25) |
| [488e41fdd91373f8a61a8ae157afccbfc0b7e41d](https://github.com/meta-models/meta-oss-cookbook/commit/488e41fdd91373f8a61a8ae157afccbfc0b7e41d) | Add the NVIDIA B300 page and the sandboxed-agent demo |
| [fbd1044f573dc94213db2c451d39b6f5f8232a2c](https://github.com/meta-models/meta-oss-cookbook/commit/fbd1044f573dc94213db2c451d39b6f5f8232a2c) | Merge pull request #31 from muthu-kumaravel/docs/sglang-install-and-verify-fixes |
| [99278368ff6754cd5b9e919fe9fbb4186255d568](https://github.com/meta-models/meta-oss-cookbook/commit/99278368ff6754cd5b9e919fe9fbb4186255d568) | Remove Together AI page metadata |
| [dccf68e9a54bf054a4714e1fcd01776a5e994ae6](https://github.com/meta-models/meta-oss-cookbook/commit/dccf68e9a54bf054a4714e1fcd01776a5e994ae6) | docs |
| [858c87c4c074221bb69a65fb443741181980cfbb](https://github.com/meta-models/meta-oss-cookbook/commit/858c87c4c074221bb69a65fb443741181980cfbb) | Merge pull request #32 from meta-models/younghan/recipe-nemoclaw |
| [2b36f85d5f1dce1c9229c9297d40c4ffd306de96](https://github.com/meta-models/meta-oss-cookbook/commit/2b36f85d5f1dce1c9229c9297d40c4ffd306de96) | add quants and webui |
| [99c53a19d855a73dce5b5001d9e8e2fc6617afb4](https://github.com/meta-models/meta-oss-cookbook/commit/99c53a19d855a73dce5b5001d9e8e2fc6617afb4) | Add Ollama guide for Muse Glimmer (#33) |
| [26690ad29da9072430005f58ed8fcc900c937b32](https://github.com/meta-models/meta-oss-cookbook/commit/26690ad29da9072430005f58ed8fcc900c937b32) | docs(executorch): update GGUF download options |
| [f984de362960aafe79ec851cb4000c783fef05b9](https://github.com/meta-models/meta-oss-cookbook/commit/f984de362960aafe79ec851cb4000c783fef05b9) | docs(executorch): update GGUF download options |
| [67422484267f63dd640a57cf64c501ede2374d9c](https://github.com/meta-models/meta-oss-cookbook/commit/67422484267f63dd640a57cf64c501ede2374d9c) | Revert "docs(executorch): update GGUF download options" |
| [67098bb9321dc1942668d462031f0b62abd027d3](https://github.com/meta-models/meta-oss-cookbook/commit/67098bb9321dc1942668d462031f0b62abd027d3) | Rename sandboxed agent recipe to NemoClaw Sandbox |
| [2c3987e834e63cdda6cd1cb6b9e5760d2130e8ae](https://github.com/meta-models/meta-oss-cookbook/commit/2c3987e834e63cdda6cd1cb6b9e5760d2130e8ae) | Update ExecuTorch GGUF download options (#35) |
| [3f236abcff53bfb72224d066e027b099f0ae568f](https://github.com/meta-models/meta-oss-cookbook/commit/3f236abcff53bfb72224d066e027b099f0ae568f) | Update inference-server/llama-cpp.md |
| [6ea982768faf974d23b283705f2651efbdd8bc95](https://github.com/meta-models/meta-oss-cookbook/commit/6ea982768faf974d23b283705f2651efbdd8bc95) | docs: sync remaining GGUF filenames to the HF repo |
| [804f171373ebaf8c2d32b2c4ed26234702459d0a](https://github.com/meta-models/meta-oss-cookbook/commit/804f171373ebaf8c2d32b2c4ed26234702459d0a) | docs: sync remaining GGUF filenames to the HF repo |
| [aa353232a83e406ecb7661c9a4b8b7c4f533df06](https://github.com/meta-models/meta-oss-cookbook/commit/aa353232a83e406ecb7661c9a4b8b7c4f533df06) | Revert "docs: sync remaining GGUF filenames to the HF repo" |
| [478a8ab7b07d490a551b0c329014d85c9b824b11](https://github.com/meta-models/meta-oss-cookbook/commit/478a8ab7b07d490a551b0c329014d85c9b824b11) | Merge pull request #36 from meta-models/nelish/gguf-filename-sync |
| [499ad7422c2175cf47dbad5df37c4c8f6c11f924](https://github.com/meta-models/meta-oss-cookbook/commit/499ad7422c2175cf47dbad5df37c4c8f6c11f924) | Merge pull request #34 from merveenoyan/main |
| [460f290cc7e1a4b6d2071c1b4b9eab5674430172](https://github.com/meta-models/meta-oss-cookbook/commit/460f290cc7e1a4b6d2071c1b4b9eab5674430172) | add recipe for titanRL |
| [ab38a62badb05acc952156a4befe8afd1a466650](https://github.com/meta-models/meta-oss-cookbook/commit/ab38a62badb05acc952156a4befe8afd1a466650) | add README file for post training |
| [f20c9596ff0124b83a30969abd2cb38de1b6b44b](https://github.com/meta-models/meta-oss-cookbook/commit/f20c9596ff0124b83a30969abd2cb38de1b6b44b) | add README for data analyst |
| [f65f3d9f0a3fcda7b14c261187adea358219dfb7](https://github.com/meta-models/meta-oss-cookbook/commit/f65f3d9f0a3fcda7b14c261187adea358219dfb7) | add config registry for TitanRL |
| [a75d07e162931747aca0afde26b67c31240c2473](https://github.com/meta-models/meta-oss-cookbook/commit/a75d07e162931747aca0afde26b67c31240c2473) | add README for titanRL data anaylyst |
| [df2db9aa0044118bc986eaa322de18e01a9a6c79](https://github.com/meta-models/meta-oss-cookbook/commit/df2db9aa0044118bc986eaa322de18e01a9a6c79) | add data.py for titanrl recipe |
| [73f3ae1966ef7ec17b451e62dc42958eba5fe903](https://github.com/meta-models/meta-oss-cookbook/commit/73f3ae1966ef7ec17b451e62dc42958eba5fe903) | add env py titanrl |
| [9e3d8c391e77b2260917776fac3919a52d7b10dd](https://github.com/meta-models/meta-oss-cookbook/commit/9e3d8c391e77b2260917776fac3919a52d7b10dd) | add rollouter for titanrl recipe |
| [8b7019df95c1fcf84411736131634455dc1a7675](https://github.com/meta-models/meta-oss-cookbook/commit/8b7019df95c1fcf84411736131634455dc1a7675) | add rubruc for titan rl |
| [bcadf774939fc9ec43e6681806d6f41125e3bf86](https://github.com/meta-models/meta-oss-cookbook/commit/bcadf774939fc9ec43e6681806d6f41125e3bf86) | add tests for that |
| [cb22cea0fd839b7c8f095e00acf5e0369bb19445](https://github.com/meta-models/meta-oss-cookbook/commit/cb22cea0fd839b7c8f095e00acf5e0369bb19445) | update readme by adding plots |
| [7941d6bf524e7d42ea85655aaffdb899c98af62f](https://github.com/meta-models/meta-oss-cookbook/commit/7941d6bf524e7d42ea85655aaffdb899c98af62f) | add the plots in assets |
| [db0675b4eff0fe33363a467098a4bc993e05c17b](https://github.com/meta-models/meta-oss-cookbook/commit/db0675b4eff0fe33363a467098a4bc993e05c17b) | add examples before and after |
| [3d33cb1eae658cf92b134ec20530aeb1b32c31f1](https://github.com/meta-models/meta-oss-cookbook/commit/3d33cb1eae658cf92b134ec20530aeb1b32c31f1) | Merge pull request #38 from meta-models/ali/post-training-titanrl |
| [152e574a33d928371764ef43d3c24f007f64a0a1](https://github.com/meta-models/meta-oss-cookbook/commit/152e574a33d928371764ef43d3c24f007f64a0a1) | update README file |
| [347e5c72321ec0b612fc2bd6da4b554b4ebcb61a](https://github.com/meta-models/meta-oss-cookbook/commit/347e5c72321ec0b612fc2bd6da4b554b4ebcb61a) | update post training README file |
| [da5bd85790effdc6643ddabf0da7b0d90ff76e63](https://github.com/meta-models/meta-oss-cookbook/commit/da5bd85790effdc6643ddabf0da7b0d90ff76e63) | Add local macOS voice agent recipe (#40) |
| [37b043f02f9536a31871cb462979c79f79202fcd](https://github.com/meta-models/meta-oss-cookbook/commit/37b043f02f9536a31871cb462979c79f79202fcd) | Add demo and pinned setup for the local voice agent (#43) |
| [af5c3f09e7de20552460e54c25bc6b8517262c70](https://github.com/meta-models/meta-oss-cookbook/commit/af5c3f09e7de20552460e54c25bc6b8517262c70) | Merge pull request #39 from meta-models/ali/axolotl-sft-recipe |
| [412531bc6ce29ea41af506a1698184889f8f4071](https://github.com/meta-models/meta-oss-cookbook/commit/412531bc6ce29ea41af506a1698184889f8f4071) | delete old file structure |
| [83cd619062eb74df21d9274af33efabc8881f7f5](https://github.com/meta-models/meta-oss-cookbook/commit/83cd619062eb74df21d9274af33efabc8881f7f5) | Prevent voice agent response stalls |
| [a86af0c7fe8fdab5f2b3fe03792bb9cba908eb9f](https://github.com/meta-models/meta-oss-cookbook/commit/a86af0c7fe8fdab5f2b3fe03792bb9cba908eb9f) | Reset stale Metal compiler cache at startup |
| [e1527d4eca11a7ddcc9fb30b7b7119d53b3423a5](https://github.com/meta-models/meta-oss-cookbook/commit/e1527d4eca11a7ddcc9fb30b7b7119d53b3423a5) | Prevent local voice agent response stalls (#44) |
| [96eacdc13a06f9e0023a7339b046d78f236e5196](https://github.com/meta-models/meta-oss-cookbook/commit/96eacdc13a06f9e0023a7339b046d78f236e5196) | delete old file structure |
| [b9af97f452a0781b82fe143b22a5c075fe71347a](https://github.com/meta-models/meta-oss-cookbook/commit/b9af97f452a0781b82fe143b22a5c075fe71347a) | delete old file structure |
| [3ce3508c22caa310845e38a1704d68a8252c314e](https://github.com/meta-models/meta-oss-cookbook/commit/3ce3508c22caa310845e38a1704d68a8252c314e) | add glimmer-data-analyst-outcomes.png file |
| [8dd852b026c7441d3cab985334e2a6f9c53351c6](https://github.com/meta-models/meta-oss-cookbook/commit/8dd852b026c7441d3cab985334e2a6f9c53351c6) | add assetsglimmer-data-analyst-reward.png |
| [8b6599644be1a55bca59572068c7689791f824ba](https://github.com/meta-models/meta-oss-cookbook/commit/8b6599644be1a55bca59572068c7689791f824ba) | post-training/README.md |
| [d65d66c43e8a4df8d5a1d36e5be6d80f2c8902e1](https://github.com/meta-models/meta-oss-cookbook/commit/d65d66c43e8a4df8d5a1d36e5be6d80f2c8902e1) | add post-training/rl/titanrl/README.md |
| [475630492f8513cae9822e27f66833d662ee0bc6](https://github.com/meta-models/meta-oss-cookbook/commit/475630492f8513cae9822e27f66833d662ee0bc6) | post-training/rl/titanrl/data-analyst/README.md |
| [ec9be0d5ce81985e367f467baa3390141c0df3ad](https://github.com/meta-models/meta-oss-cookbook/commit/ec9be0d5ce81985e367f467baa3390141c0df3ad) | update titanrl from experiments folder to main track |
| [614df88e9415800d56ccfdb8baec7095cec8334a](https://github.com/meta-models/meta-oss-cookbook/commit/614df88e9415800d56ccfdb8baec7095cec8334a) | Merge pull request #45 from meta-models/ali/titanrl-recipe-on-main |
| [68e5e5a52559321aae93151a03866055bc694681](https://github.com/meta-models/meta-oss-cookbook/commit/68e5e5a52559321aae93151a03866055bc694681) | delete old file structure |
| [af80d66f7bbc7eadfb4bfa38859044a994ee5ad1](https://github.com/meta-models/meta-oss-cookbook/commit/af80d66f7bbc7eadfb4bfa38859044a994ee5ad1) | delete old file structure |
| [1e689c05cca4dd33f9f2fade7948f47c882db45c](https://github.com/meta-models/meta-oss-cookbook/commit/1e689c05cca4dd33f9f2fade7948f47c882db45c) | delete old file structure |
| [45b69332f2d3afb0a669f47be065dff0a3643919](https://github.com/meta-models/meta-oss-cookbook/commit/45b69332f2d3afb0a669f47be065dff0a3643919) | delete old file structure |
| [047ced568cd0133d44d740f35cda4fd6bb448f00](https://github.com/meta-models/meta-oss-cookbook/commit/047ced568cd0133d44d740f35cda4fd6bb448f00) | update SFT README |
| [b94e7b5b729b33c1309ea5ed690ba089aa8f0530](https://github.com/meta-models/meta-oss-cookbook/commit/b94e7b5b729b33c1309ea5ed690ba089aa8f0530) | add assets |
| [8b84199740e600f2a5fe7365d5f343c1aa768be3](https://github.com/meta-models/meta-oss-cookbook/commit/8b84199740e600f2a5fe7365d5f343c1aa768be3) | update gitignore for sft |
| [4a5a5d60a5bf6b6306f4d63c247d85da89d36ab0](https://github.com/meta-models/meta-oss-cookbook/commit/4a5a5d60a5bf6b6306f4d63c247d85da89d36ab0) | update README for sft |
| [692fe9e8d69decc043b908e39808ad77727b22ed](https://github.com/meta-models/meta-oss-cookbook/commit/692fe9e8d69decc043b908e39808ad77727b22ed) | add configs for SFT |
| [64d4da02b6339a43f5564af90b3121e7690a62e3](https://github.com/meta-models/meta-oss-cookbook/commit/64d4da02b6339a43f5564af90b3121e7690a62e3) | add data and how to prep |
| [a9f09938daea62368b54127bb3c816b6d6430254](https://github.com/meta-models/meta-oss-cookbook/commit/a9f09938daea62368b54127bb3c816b6d6430254) | add results updates |
| [5407750eb2795a3935675e4caa38b6f24829b2e4](https://github.com/meta-models/meta-oss-cookbook/commit/5407750eb2795a3935675e4caa38b6f24829b2e4) | add plot scripts |
| [f0f3eead0cc3962b27ab720186c9cd070bf407a1](https://github.com/meta-models/meta-oss-cookbook/commit/f0f3eead0cc3962b27ab720186c9cd070bf407a1) | Document voice agent model artifacts |
| [e8b9141d6135108e921ff319ffb0852dc396b41b](https://github.com/meta-models/meta-oss-cookbook/commit/e8b9141d6135108e921ff319ffb0852dc396b41b) | List voice agent source models and downloads |
| [92bed9cfaeaa3b1ee408a24a99b2a0381481a5db](https://github.com/meta-models/meta-oss-cookbook/commit/92bed9cfaeaa3b1ee408a24a99b2a0381481a5db) | add tests for sft |
| [7e8e0bc4e283075ba60d32842285fbeb8251fba2](https://github.com/meta-models/meta-oss-cookbook/commit/7e8e0bc4e283075ba60d32842285fbeb8251fba2) | add rl post training README |
| [62ab044a179e1a4ab7364fc3397ff7bb537c0485](https://github.com/meta-models/meta-oss-cookbook/commit/62ab044a179e1a4ab7364fc3397ff7bb537c0485) | update titanRL README |
| [ba33b04a2c79fdb74788a7ee237b17dbd03ddeac](https://github.com/meta-models/meta-oss-cookbook/commit/ba33b04a2c79fdb74788a7ee237b17dbd03ddeac) | moved data analyst README |
| [62cbeb447783542967774d8529a3c96f2f2182d2](https://github.com/meta-models/meta-oss-cookbook/commit/62cbeb447783542967774d8529a3c96f2f2182d2) | move config |
| [26eba135b8e212eda14b53eaa5834e18e2440e23](https://github.com/meta-models/meta-oss-cookbook/commit/26eba135b8e212eda14b53eaa5834e18e2440e23) | move README |
| [0d9e8eb757167c3d766a3ded74c07780abbb92ff](https://github.com/meta-models/meta-oss-cookbook/commit/0d9e8eb757167c3d766a3ded74c07780abbb92ff) | move titanrl files |
| [33f35a80811e959b6908a4d48839efa6d90de42f](https://github.com/meta-models/meta-oss-cookbook/commit/33f35a80811e959b6908a4d48839efa6d90de42f) | restructure: move the Muse Glimmer cookbook under muse-glimmer/ |
| [8ff4d2ef86df47d0cfb720ee86318a7c87dd8790](https://github.com/meta-models/meta-oss-cookbook/commit/8ff4d2ef86df47d0cfb720ee86318a7c87dd8790) | restructure: keep ignoring the Muse Glimmer agent workspace after the move |
| [78297b1fde97a5d3ba08409ee8e9c3f1fae302c1](https://github.com/meta-models/meta-oss-cookbook/commit/78297b1fde97a5d3ba08409ee8e9c3f1fae302c1) | muse-spark: add the Muse Spark Open cookbook from the dev.meta.ai docs |
| [3d0de186808c9b43302f478126a283d8b5512a97](https://github.com/meta-models/meta-oss-cookbook/commit/3d0de186808c9b43302f478126a283d8b5512a97) | muse-glimmer: fix the inference-server links in the vendor template |
| [e635ab2c79f95b21d3c453a5de25ee8ab9f2f6f9](https://github.com/meta-models/meta-oss-cookbook/commit/e635ab2c79f95b21d3c453a5de25ee8ab9f2f6f9) | muse-spark: add MLX on Apple silicon |
| [e4742dcdc70c9e2203ab8b997ed53a4dbb21dffa](https://github.com/meta-models/meta-oss-cookbook/commit/e4742dcdc70c9e2203ab8b997ed53a4dbb21dffa) | muse-spark: add Together AI post-training |
| [f5b8e36aabf61752925ea8895c059d9f573dbfdf](https://github.com/meta-models/meta-oss-cookbook/commit/f5b8e36aabf61752925ea8895c059d9f573dbfdf) | Merge pull request #49 from meta-models/restructure/muse-glimmer-muse-spark |
| [926366caa6aa049785ea9e7dc8714329869f8abb](https://github.com/meta-models/meta-oss-cookbook/commit/926366caa6aa049785ea9e7dc8714329869f8abb) | build(deps): bump multidict in /muse-glimmer/recipes/voice-agent-macos |
| [35924c7a2938d455fcf8e3e250efbdbdcb57f89b](https://github.com/meta-models/meta-oss-cookbook/commit/35924c7a2938d455fcf8e3e250efbdbdcb57f89b) | build(deps): bump urllib3 in /muse-glimmer/recipes/voice-agent-macos |
| [0e756c69b719b00dc092af0eca73ae7a31aaaa18](https://github.com/meta-models/meta-oss-cookbook/commit/0e756c69b719b00dc092af0eca73ae7a31aaaa18) | build(deps-dev): bump pyjwt in /muse-glimmer/recipes/voice-agent-macos |
| [8ec675e62d573181c9c98c447c905c001e5b5578](https://github.com/meta-models/meta-oss-cookbook/commit/8ec675e62d573181c9c98c447c905c001e5b5578) | muse-spark: add TorchTitan SFT post-training (text, image, audio) |
| [babb518f2bc3cf03687c462824c9095617c1b47c](https://github.com/meta-models/meta-oss-cookbook/commit/babb518f2bc3cf03687c462824c9095617c1b47c) | muse-spark: clarify the TorchTitan SFT intro |
| [361a27bdf09cf0c31a073e1a9d68c3e56076a046](https://github.com/meta-models/meta-oss-cookbook/commit/361a27bdf09cf0c31a073e1a9d68c3e56076a046) | muse-spark: start the TorchTitan SFT README with what the recipe does |
| [9226d08d24d19ecc26c6bf740edeaace4cfb453a](https://github.com/meta-models/meta-oss-cookbook/commit/9226d08d24d19ecc26c6bf740edeaace4cfb453a) | muse-spark: frame the TorchTitan SFT recipe as a starting point |
| [4b9ac6ce74cd3fb2c9ad71a805b8411a7b3fb4ea](https://github.com/meta-models/meta-oss-cookbook/commit/4b9ac6ce74cd3fb2c9ad71a805b8411a7b3fb4ea) | muse-spark: sync with the launched dev.meta.ai docs |
| [e9c5f1959a0ba6b718c52ac227229e2105064987](https://github.com/meta-models/meta-oss-cookbook/commit/e9c5f1959a0ba6b718c52ac227229e2105064987) | muse-spark: add the Muse Spark Open on Mac recipe |
| [cb6c2fb5193fee47b5f76f4e6f4a0c104dc9bdb9](https://github.com/meta-models/meta-oss-cookbook/commit/cb6c2fb5193fee47b5f76f4e6f4a0c104dc9bdb9) | muse-spark: add TitanRL post-training with pluggable tasks |
| [759ce4650991bdcf3ca7383075a8d5a21bbb3fe6](https://github.com/meta-models/meta-oss-cookbook/commit/759ce4650991bdcf3ca7383075a8d5a21bbb3fe6) | Merge pull request #53 from HosseinKaviani-H/Muse-sft |
| [daa47bbc3e8eaf7dbd7e39682d1529791141362d](https://github.com/meta-models/meta-oss-cookbook/commit/daa47bbc3e8eaf7dbd7e39682d1529791141362d) | Merge pull request #54 from meta-models/muse-spark/sync-launch-docs |
| [ba457250d5500e36454e7d761d816ab657635340](https://github.com/meta-models/meta-oss-cookbook/commit/ba457250d5500e36454e7d761d816ab657635340) | muse-spark: rename rl/titanrl to rl/torchtitan to match sft/torchtitan |
| [567d7d0f29192c33f9b48fb9135c932b475ea7c5](https://github.com/meta-models/meta-oss-cookbook/commit/567d7d0f29192c33f9b48fb9135c932b475ea7c5) | Merge pull request #55 from HosseinKaviani-H/Muse-RL |
| [2ffe534bbf970e7d8b84ef4f086019d374b752b4](https://github.com/meta-models/meta-oss-cookbook/commit/2ffe534bbf970e7d8b84ef4f086019d374b752b4) | move titanrl files |
| [175ded7a6f47836446f38fea840d102ed7207229](https://github.com/meta-models/meta-oss-cookbook/commit/175ded7a6f47836446f38fea840d102ed7207229) | muse-spark: sync post-training with the docs |
| [7c4bc893271096b081db0bf3d0638e165b60d4d4](https://github.com/meta-models/meta-oss-cookbook/commit/7c4bc893271096b081db0bf3d0638e165b60d4d4) | muse-spark: drop the TorchTitan fine-tuning section |
| [839712a3536a1cedbcd56b615c7059c97e19b29f](https://github.com/meta-models/meta-oss-cookbook/commit/839712a3536a1cedbcd56b615c7059c97e19b29f) | Merge pull request #56 from meta-models/muse-spark/sync-post-training |
| [48cb0407143b9f39f7d9315f14fee9613905f108](https://github.com/meta-models/meta-oss-cookbook/commit/48cb0407143b9f39f7d9315f14fee9613905f108) | muse-glimmer: give the Axolotl QLoRA charts distinct file names |
| [c6beaa1a109d8b836042fb2f7bdc951586b9e50a](https://github.com/meta-models/meta-oss-cookbook/commit/c6beaa1a109d8b836042fb2f7bdc951586b9e50a) | muse-glimmer: use inline links in the Axolotl recipe |
| [22e94a6874eb559e6937a6e012a994cb318ae656](https://github.com/meta-models/meta-oss-cookbook/commit/22e94a6874eb559e6937a6e012a994cb318ae656) | muse-glimmer: name the agentic fundamentals link in the TitanRL recipe |
| [d8968a1488ddbcb681e9bc8e85d1151423ef1678](https://github.com/meta-models/meta-oss-cookbook/commit/d8968a1488ddbcb681e9bc8e85d1151423ef1678) | Merge pull request #57 from meta-models/muse-glimmer/axolotl-chart-names |
| [0a6ff1457a09061b2cd4168929455a37d3f417f7](https://github.com/meta-models/meta-oss-cookbook/commit/0a6ff1457a09061b2cd4168929455a37d3f417f7) | build(deps): bump aiohttp in /muse-glimmer/recipes/voice-agent-macos |
| [d01f8352aa482273056a5732de68a85efd92b5a9](https://github.com/meta-models/meta-oss-cookbook/commit/d01f8352aa482273056a5732de68a85efd92b5a9) | build(deps-dev): bump vite |
| [9ce9633c7412df02047dc6dbce89e9ad2df6d0ef](https://github.com/meta-models/meta-oss-cookbook/commit/9ce9633c7412df02047dc6dbce89e9ad2df6d0ef) | build(deps): bump opentelemetry-api |
| [93cc07d0ca506fcfcc3788c8d545535e9b8273ab](https://github.com/meta-models/meta-oss-cookbook/commit/93cc07d0ca506fcfcc3788c8d545535e9b8273ab) | build(deps): bump pillow in /muse-glimmer/recipes/voice-agent-macos |
| [30297b6b415d79cccf2ab33de4a15b46cce482e3](https://github.com/meta-models/meta-oss-cookbook/commit/30297b6b415d79cccf2ab33de4a15b46cce482e3) | build(deps): bump filelock in /muse-glimmer/recipes/voice-agent-macos |
| [ab50dd15ef966924f75150889af7a497a8dbedd7](https://github.com/meta-models/meta-oss-cookbook/commit/ab50dd15ef966924f75150889af7a497a8dbedd7) | build(deps): bump setuptools in /muse-glimmer/recipes/voice-agent-macos |
| [5892d1f098cb6da5a769dc1ddf1d048f07f2cd91](https://github.com/meta-models/meta-oss-cookbook/commit/5892d1f098cb6da5a769dc1ddf1d048f07f2cd91) | update the README of main |
| [a6c315d703170ac29751eb160eecb977d16e3a88](https://github.com/meta-models/meta-oss-cookbook/commit/a6c315d703170ac29751eb160eecb977d16e3a88) | Merge pull request #65 from meta-models/ali/cookbook-readme-showcase |

#### muse-code-sdk: branch inventory

| Branch | Pinned head |
|---|---|
| automated_fixup_code_of_conduct_file_exists | [cf3bc059331e0469588f54b4cd59d78ab160510c](https://github.com/meta-models/muse-code-sdk/tree/cf3bc059331e0469588f54b4cd59d78ab160510c) |
| automated_fixup_contributing_file_exists | [877a0ee9868a759938d430d62a93d752cef80027](https://github.com/meta-models/muse-code-sdk/tree/877a0ee9868a759938d430d62a93d752cef80027) |
| cleanup-publish-anchor-notes | [98ec125a3d3ab9cdf1701125b6a3732131efc254](https://github.com/meta-models/muse-code-sdk/tree/98ec125a3d3ab9cdf1701125b6a3732131efc254) |
| dependabot/pip/python/clients/setuptools-84.1.0 | [948ffd406850c52306b776a504e7a893323b10c1](https://github.com/meta-models/muse-code-sdk/tree/948ffd406850c52306b776a504e7a893323b10c1) |
| fix-quickstart-link | [e4c42a74254ac71c000be989ce4cf86c607c5d37](https://github.com/meta-models/muse-code-sdk/tree/e4c42a74254ac71c000be989ce4cf86c607c5d37) |
| gh-pages | [0576e278e45d7986d467486869813cbe223d4ab5](https://github.com/meta-models/muse-code-sdk/tree/0576e278e45d7986d467486869813cbe223d4ab5) |
| main | [a45cb67cd2e27c8b6b4b55dcbaae6e6341123ea4](https://github.com/meta-models/muse-code-sdk/tree/a45cb67cd2e27c8b6b4b55dcbaae6e6341123ea4) |
| npm-1.3.0-published | [56d25c1681a11da666bb83f85260f6b585e79804](https://github.com/meta-models/muse-code-sdk/tree/56d25c1681a11da666bb83f85260f6b585e79804) |
| pypi-metadata-scrub | [386a4f41702aa4e2c9452269781c453056903c8a](https://github.com/meta-models/muse-code-sdk/tree/386a4f41702aa4e2c9452269781c453056903c8a) |
| python-1.3.0-publish-rows | [174cc98fac376b13d1bd00fb485a9f746def6a19](https://github.com/meta-models/muse-code-sdk/tree/174cc98fac376b13d1bd00fb485a9f746def6a19) |
| python-sdk-tree | [3a74bfb30a3c43e6ac86e0a56a7e6b758f0026b1](https://github.com/meta-models/muse-code-sdk/tree/3a74bfb30a3c43e6ac86e0a56a7e6b758f0026b1) |
| python-tree-audience-gate | [6cd1a052b379cacb0c42facfded4f465bc1c2e1b](https://github.com/meta-models/muse-code-sdk/tree/6cd1a052b379cacb0c42facfded4f465bc1c2e1b) |
| remirror-python-1.3.1 | [6573bebfd83ea668ac0c388720bc20a0c1b7f698](https://github.com/meta-models/muse-code-sdk/tree/6573bebfd83ea668ac0c388720bc20a0c1b7f698) |
| remove-duplicate-checker | [bf2fc138f0c0d451d9a898d9c185ee9ec0a23845](https://github.com/meta-models/muse-code-sdk/tree/bf2fc138f0c0d451d9a898d9c185ee9ec0a23845) |
| ts-1.3.0-remirror | [c52c1fc7159804a25f367d8ceb279c40801fb946](https://github.com/meta-models/muse-code-sdk/tree/c52c1fc7159804a25f367d8ceb279c40801fb946) |

#### muse-code-sdk: issue and PR inventory

States below are the API collection state at retrieval, not an assessment that an issue is resolved or a PR is merged. Closed PRs may be unmerged. Comments/reviews and patches were not exhaustively reviewed.

| Item | Type | State | Title |
|---|---|---|---|
| [#121](https://github.com/meta-models/muse-code-sdk/issues/121) | Issue | open | session/resume reports a completed turn as activeTurnId (status running) after session/compact, 1.4.12 and 1.4.13 |
| [#120](https://github.com/meta-models/muse-code-sdk/issues/120) | Issue | open | session/fork over muse serve always fails resolving branch creation time, while TUI /fork on the same machine succeeds |
| [#119](https://github.com/meta-models/muse-code-sdk/pull/119) | PR | open | Bump setuptools from 84.0.0 to 84.1.0 in /python/clients |
| [#118](https://github.com/meta-models/muse-code-sdk/issues/118) | Issue | open | [CLI Linux 1.4.12] `muse login` is treated as a Meta Quest login and blocked by the Arkansas age-verification gate |
| [#117](https://github.com/meta-models/muse-code-sdk/issues/117) | Issue | open | Session becomes unusable after reading an image whose bytes do not match its extension; |
| [#116](https://github.com/meta-models/muse-code-sdk/issues/116) | Issue | open | [Host 1.4.11] Built-in reminder agents repeatedly submit invalid decision payloads |
| [#115](https://github.com/meta-models/muse-code-sdk/issues/115) | Issue | open | [CLI Linux 1.4.11] Active subscription: catalog empty and every model refused, worked the day before |
| [#114](https://github.com/meta-models/muse-code-sdk/pull/114) | PR | closed | README: fix the quickstart link |
| [#113](https://github.com/meta-models/muse-code-sdk/issues/113) | Issue | closed | Question: does the process-local Contributor override cover auxiliary requests? |
| [#112](https://github.com/meta-models/muse-code-sdk/issues/112) | Issue | open | [muse serve 1.4.11] After resuming a compacted session, no new mcp.startup is recorded and turns fail with "MCP startup audit failed; MCP is disabled for this runtime" |
| [#111](https://github.com/meta-models/muse-code-sdk/issues/111) | Issue | open | [Feature]: A typed MSP signal when a turn fails because the context window is exceeded |
| [#110](https://github.com/meta-models/muse-code-sdk/issues/110) | Issue | open | [CLI macOS 1.4.10] Active Power subscription: catalog and prompts unauthorized after successful login and token refresh |
| [#109](https://github.com/meta-models/muse-code-sdk/issues/109) | Issue | open | [Power] muse-wonder-1.0 / muse-wonder-full-1.0 fail from 2nd turn: "does not exist or you lack access" |
| [#108](https://github.com/meta-models/muse-code-sdk/issues/108) | Issue | open | [Native host] Idle interactive TUI sustains ~3–6% CPU indefinitely (1.4.9, 1.4.10, Linux) |
| [#107](https://github.com/meta-models/muse-code-sdk/issues/107) | Issue | open | Windows serve reports setup_required despite ready sandbox check (1.4.8 and 1.4.9) |
| [#106](https://github.com/meta-models/muse-code-sdk/issues/106) | Issue | closed | Muse CLI not showing any models. |
| [#105](https://github.com/meta-models/muse-code-sdk/issues/105) | Issue | open | [CLI macOS 1.4.7] Keychain credential waits freeze startup and block other sessions; OSStatus -67701 |
| [#104](https://github.com/meta-models/muse-code-sdk/issues/104) | Issue | open | macOS: `session/userShell` fails with "managed shell sandbox is unavailable" under every sandboxed posture (1.4.2) |
| [#103](https://github.com/meta-models/muse-code-sdk/issues/103) | Issue | open | `session/fork` during a running turn copies that turn into the branch, past the cut it reports (1.4.2) |
| [#102](https://github.com/meta-models/muse-code-sdk/issues/102) | Issue | open | 1.4.6: muse serve without --contributor-mode bills at standard rates, ignoring contributor_mode_enabled and MUSE_CONTRIBUTOR_MODE |
| [#101](https://github.com/meta-models/muse-code-sdk/issues/101) | Issue | open | 1.4.6 MSP integration: ephemeral view support and effective reviewer posture |
| [#100](https://github.com/meta-models/muse-code-sdk/issues/100) | Issue | open | After the 1.4.3 → 1.4.4 update, resume refuses a healthy view written by 1.4.3 (`projectionUnavailable`, empty cursor) and no events reach the client; a missing view is rebuilt fine (1.4.4) |
| [#99](https://github.com/meta-models/muse-code-sdk/issues/99) | Issue | open | Headless `muse exec` waits forever when the approval reviewer escalates a tool call (1.4.4) |
| [#98](https://github.com/meta-models/muse-code-sdk/pull/98) | PR | closed | Add issue triage guidance |
| [#97](https://github.com/meta-models/muse-code-sdk/issues/97) | Issue | open | `session/fork` rejects every completed turn except the latest as `cutPoint.lastTurnId` (`forkBoundaryInvalid: InvalidCut`, 1.4.3 and 1.4.4) |
| [#96](https://github.com/meta-models/muse-code-sdk/issues/96) | Issue | open | [Windows] Sandbox ACL publication lock stays stuck for hours: every shell call times out after 120 s, and `muse exec --disable-approval` keeps running a turn that can never execute (1.4.3) |
| [#95](https://github.com/meta-models/muse-code-sdk/pull/95) | PR | closed | Remove duplicate checker script; point test at the remaining copy |
| [#94](https://github.com/meta-models/muse-code-sdk/issues/94) | Issue | open | Records already reported are lost when the host is killed; the next resume marks the session view unavailable and no item events reach the client anymore (1.4.2) |
| [#93](https://github.com/meta-models/muse-code-sdk/issues/93) | Issue | open | userShell is granted under --disable-shell; session/userShell is accepted, then fails as policy-denied (1.4.2) |
| [#92](https://github.com/meta-models/muse-code-sdk/issues/92) | Issue | open | A request_user_input question from a turn lost with its engine stays listed and is re-sent after session/resume; every answer is refused (1.4.2) |
| [#91](https://github.com/meta-models/muse-code-sdk/issues/91) | Issue | open | [Windows] HTTPS fails in the sandboxed shell under --sandbox-network enabled: Schannel SEC_E_NO_CREDENTIALS for the sandbox account (1.4.2) |
| [#90](https://github.com/meta-models/muse-code-sdk/issues/90) | Issue | open | [Feature]: bind shell approval to the exact process Muse Code starts (approval-time execution-plan binding or a blocking pre-exec hook) |
| [#89](https://github.com/meta-models/muse-code-sdk/issues/89) | Issue | open | muse exec fails the whole run on 'function_call_arguments.done name mismatch' instead of retrying the attempt |
| [#88](https://github.com/meta-models/muse-code-sdk/issues/88) | Issue | open | [Windows] Sandboxed powershell tool starts in a verbatim \\?\ location, so cmdlets with relative paths fail (1.4.2) |
| [#87](https://github.com/meta-models/muse-code-sdk/pull/87) | PR | closed | Clean the publish anchor notes and remove the duplicate schema copy |
| [#86](https://github.com/meta-models/muse-code-sdk/issues/86) | Issue | open | [Feature]: File-tool writes that no approval covers: ask before writes outside the workspace roots when the shell sandbox is off, let denyUnmatched (or a selectable Read-only profile) stop file writes, and protect other agents' configuratio |
| [#85](https://github.com/meta-models/muse-code-sdk/issues/85) | Issue | open | [Feature]: Hooks fire for Muse Code's own reminder agents with no link to the parent session: say so in the docs, and add the parent session and turn (and agent_id/agent_type) to child-session payloads |
| [#84](https://github.com/meta-models/muse-code-sdk/issues/84) | Issue | open | [Docs]: Hook pages are still for 1.3.0: document `Interrupt`, `SessionFork` and the PostToolUseFailure `updatedInput` correction, say which events are not run yet, and publish versioned docs |
| [#83](https://github.com/meta-models/muse-code-sdk/issues/83) | Issue | open | [Feature]: A lightweight completion request over MSP (no agent turn), so IDE clients can offer inline suggestions on the subscription |
| [#82](https://github.com/meta-models/muse-code-sdk/issues/82) | Issue | open | [Bug]: interactive CLI /compact answers "no compactable run is available" in 1.4.2 despite the 1.4.0 fix |
| [#81](https://github.com/meta-models/muse-code-sdk/issues/81) | Issue | open | [Bug]: muse serve takes commands one at a time and slows as a turn grows: item/readOutput and approval/decide queue for 60–80 s during long turns |
| [#80](https://github.com/meta-models/muse-code-sdk/issues/80) | Issue | open | [Feature]: an approval judge for muse serve (or a reviewer/profile field over MSP), so onRequest is reviewed as in the interactive CLI |
| [#79](https://github.com/meta-models/muse-code-sdk/issues/79) | Issue | open | [Bug]: event log fails after a compaction checkpoint ("Origin read requires valid checkpoint-suffix…"), every later turn/start fails ("event id … conflicts with an existing event"), then muse serve stops answering |
| [#78](https://github.com/meta-models/muse-code-sdk/issues/78) | Issue | open | Too many open files (os error 24) on every shell spawn, across all sessions, with no agent-side recovery |
| [#77](https://github.com/meta-models/muse-code-sdk/issues/77) | Issue | open | CLI host leaks tool-output spool FDs until EMFILE (1.4.2) |
| [#68](https://github.com/meta-models/muse-code-sdk/issues/68) | Issue | open | [Windows] install.ps1 fails from PowerShell 7: muse.cmd shim leaks pwsh PSModulePath into powershell.exe 5.1, so Get-FileHash is missing |
| [#67](https://github.com/meta-models/muse-code-sdk/pull/67) | PR | closed | Re-mirror the SDK closure for 1.4.2 (lockstep) |
| [#66](https://github.com/meta-models/muse-code-sdk/issues/66) | Issue | open | MSP drops mid-turn assistant commentary that Codex App Server and ACP agents deliver |
| [#65](https://github.com/meta-models/muse-code-sdk/issues/65) | Issue | open | [Feature]: Per-run instructions and MCP servers for the CLI (--append-system-prompt, --mcp-config), without touching global settings |
| [#64](https://github.com/meta-models/muse-code-sdk/issues/64) | Issue | open | session/resume leaves the session unable to launch workflows (workflow_launch_unavailable), 1.4.0 |
| [#63](https://github.com/meta-models/muse-code-sdk/issues/63) | Issue | closed | denyUnmatched denies Muse's own submit_reminder_decision, so every turn stays open ~60 s after the answer (1.4.0) |
| [#62](https://github.com/meta-models/muse-code-sdk/issues/62) | Issue | open | [Windows] Sandbox admission rejected on standard consumer C:\ ACLs — Authenticated Users inheritable write ACEs at volume root |
| [#61](https://github.com/meta-models/muse-code-sdk/issues/61) | Issue | open | Docs: a page listing clients built on the SDK? |
| [#60](https://github.com/meta-models/muse-code-sdk/issues/60) | Issue | open | Session view silently stops projecting mid-session in long workflow/sub-agent runs, then reports viewHealthChanged unavailable (projectionUnavailable) |
| [#59](https://github.com/meta-models/muse-code-sdk/issues/59) | Issue | closed | session/start fails with "deletion registry authority is unavailable: UnsafePath" when the data directory is group-writable (host 1.4.0-R4302.1) |
| [#58](https://github.com/meta-models/muse-code-sdk/issues/58) | Issue | open | Native muse exec: diagnostics for recurring model stream idle timeout after 180000ms (R4161.1) |
| [#57](https://github.com/meta-models/muse-code-sdk/issues/57) | Issue | open | The model's powershell tool never returns under the Windows sandbox (host 1.3.0) |
| [#56](https://github.com/meta-models/muse-code-sdk/issues/56) | Issue | closed | No approval requests are ever raised in ask/onRequest posture — tools run silently (host 1.3.0) |
| [#55](https://github.com/meta-models/muse-code-sdk/issues/55) | Issue | open | session/fork fails with forkBoundaryInvalid WriteFailed on sessions with sub-agent lanes (host 1.3.0) |
| [#54](https://github.com/meta-models/muse-code-sdk/issues/54) | Issue | closed | `muse login` / `muse auth set` cannot persist credentials on Linux: keychain write failed (internal error -2147483648) |
| [#53](https://github.com/meta-models/muse-code-sdk/issues/53) | Issue | open | [CLI] Windows: credential write always fails with "keychain write failed (internal error -2147483648)" |
| [#52](https://github.com/meta-models/muse-code-sdk/issues/52) | Issue | open | [Feature]: Voice input over MSP: let clients use the subscription's voice mode (streamed transcription), and say where it is available |
| [#51](https://github.com/meta-models/muse-code-sdk/issues/51) | Issue | open | [Feature]: Session housekeeping over MSP: archive, unarchive and delete, text search in `session/list`, and export |
| [#50](https://github.com/meta-models/muse-code-sdk/issues/50) | Issue | open | [Feature]: Bundled and built-in commands over MSP (`command/list`, `/loop`, `/recap`, `/deep-research`, `/init`, `/rules import`, feedback) and workflow pause, resume and saved workflows |
| [#49](https://github.com/meta-models/muse-code-sdk/issues/49) | Issue | open | [Feature]: Hook visibility over MSP: `hooks/list` with load warnings, and `hook/started` / `hook/completed` events tied to the items they gate |
| [#48](https://github.com/meta-models/muse-code-sdk/issues/48) | Issue | open | [Feature]: File input parts on `turn/start` (PDF, text and other documents), structured `@` mentions, a chunked upload path, and input modalities on `model/list` |
| [#47](https://github.com/meta-models/muse-code-sdk/issues/47) | Issue | open | [Feature]: Scheduled prompts (`/loop`, cron jobs) over MSP: list, create and delete without a model turn, a schedule notification, and the origin of a fired turn |
| [#46](https://github.com/meta-models/muse-code-sdk/issues/46) | Issue | open | [Feature]: Memory and instruction files over MSP: list, read, write and delete notes by scope, `memory/changed`, and what a session loaded |
| [#45](https://github.com/meta-models/muse-code-sdk/issues/45) | Issue | open | [Feature]: MCP server status and management over MSP (list with tools and auth state, OAuth sign-in and out, reconnect, enable or disable) |
| [#44](https://github.com/meta-models/muse-code-sdk/issues/44) | Issue | open | [Feature]: Account and usage for embedding clients: a stable `account/*`, the billing lane in effect, subscription usage without a prior turn, and a usage-limit turn error |
| [#43](https://github.com/meta-models/muse-code-sdk/issues/43) | Issue | open | [Feature]: Permission profiles, the approval judge, workspace trust and worktree sessions on `session/start` (plan / read-only parity) |
| [#42](https://github.com/meta-models/muse-code-sdk/issues/42) | Issue | open | [Feature]: Conversation rewind and side chats over MSP (`session/rewind` with availability, `session/side/start`) |
| [#41](https://github.com/meta-models/muse-code-sdk/issues/41) | Issue | open | [Feature]: Live view fidelity: `modelVisibleContent` on the stream, a `background` flag for model-backgrounded calls, a stoppable user shell, turn origin, the full goal block, and structured tool results |
| [#40](https://github.com/meta-models/muse-code-sdk/issues/40) | Issue | open | [Feature]: Let MSP clients see a session's tool set and turn on the tools `muse serve` leaves off (image_generation, web_fetch, artifact, monitor, code mode, tool_search), with their billing documented |
| [#39](https://github.com/meta-models/muse-code-sdk/issues/39) | Issue | open | [Feature]: Read and write settings over MSP, per-session config overrides, and a host status query (config layers, managed policy, sandbox readiness) |
| [#38](https://github.com/meta-models/muse-code-sdk/issues/38) | Issue | closed | muse login 1.4.0 can't save the credential on Windows and headless Linux: keychain write failed (internal error -2147483648) |
| [#37](https://github.com/meta-models/muse-code-sdk/issues/37) | Issue | open | Muse Code drops video input: model catalog has supports_video=false for every model, so the request carries "[video omitted ...]" (the same muse-spark-1.3 reads the same video via the API) |
| [#36](https://github.com/meta-models/muse-code-sdk/issues/36) | Issue | open | [Feature]: Remote Control: continue a local Muse Code session from muse.ai and the Muse mobile apps |
| [#35](https://github.com/meta-models/muse-code-sdk/issues/35) | Issue | open | `Connection.command` keeps every command's full payload (image base64 included) for the life of the connection |
| [#34](https://github.com/meta-models/muse-code-sdk/issues/34) | Issue | open | `spawnMspConnection` spawns `muse serve` without `windowsHide` and offers no option for it |
| [#33](https://github.com/meta-models/muse-code-sdk/issues/33) | Issue | open | @ file mention shows 'Large workspace — type a path' instead of file picker |
| [#32](https://github.com/meta-models/muse-code-sdk/issues/32) | Issue | open | TUI bottom bar: usage, tokens/context, git branch segments |
| [#31](https://github.com/meta-models/muse-code-sdk/issues/31) | Issue | open | Windows: `session/fork` fails with "invalid fork boundary for session …: WriteFailed", with or without a cutPoint |
| [#30](https://github.com/meta-models/muse-code-sdk/issues/30) | Issue | open | Windows: `session/rename` fails with "session name rename authority is unavailable: … Resolve(UnsupportedPlatform)" |
| [#29](https://github.com/meta-models/muse-code-sdk/issues/29) | Issue | closed | Windows: `approval/decide` applies the decision, then answers "approval ledger durability fence … retained acknowledgement fence left records unflushed" |
| [#28](https://github.com/meta-models/muse-code-sdk/issues/28) | Issue | open | Linux sandbox selects system bwrap 0.9.0 (no --ro-bind-symlink) and fails with exit 125 instead of using the embedded bubblewrap |
| [#27](https://github.com/meta-models/muse-code-sdk/issues/27) | Issue | closed | [Native host] Excessive RAM: long sessions hold multiple GB; leftover muse-bin processes stay resident |
| [#26](https://github.com/meta-models/muse-code-sdk/issues/26) | Issue | open | Windows sandbox: shell tool runs in C:\Windows\System32\WindowsPowerShell\v1.0 instead of a workspace under C:\Users\&lt;user&gt; (after ~34 s) |
| [#25](https://github.com/meta-models/muse-code-sdk/pull/25) | PR | closed | python/: carry check-sdk-py-external-audience.py per closure manifest |
| [#24](https://github.com/meta-models/muse-code-sdk/pull/24) | PR | closed | Re-mirror the Python SDK closure (1.3.1 lockstep) |
| [#23](https://github.com/meta-models/muse-code-sdk/issues/23) | Issue | open | [Native host] Muse 1.3.0-R3401.1 sustains ~100% CPU after long subagent fan-out |
| [#22](https://github.com/meta-models/muse-code-sdk/issues/22) | Issue | open | [Feature]: let `muse exec` restrict the main agent to an explicit tool allowlist; `--disable-shell`/`--disable-write` still advertise the disabled tools |
| [#21](https://github.com/meta-models/muse-code-sdk/issues/21) | Issue | open | [Feature]: task/list (or task lifecycle events) so orchestrators can observe background tasks |
| [#20](https://github.com/meta-models/muse-code-sdk/issues/20) | Issue | closed | [Feature]: toggle key to return to the open side chat (Codex-style Ctrl+/) |
| [#19](https://github.com/meta-models/muse-code-sdk/pull/19) | PR | open | Record the @muse-code/sdk@1.3.0 npm publication receipt |
| [#18](https://github.com/meta-models/muse-code-sdk/issues/18) | Issue | open | Support form gives error, account case - pls help |
| [#17](https://github.com/meta-models/muse-code-sdk/pull/17) | PR | closed | Re-mirror the TypeScript SDK closure (1.3.0 lockstep, scrubbed README) |
| [#16](https://github.com/meta-models/muse-code-sdk/pull/16) | PR | closed | Re-mirror python/: PyPI metadata scrub + external-audience publish gate |
| [#15](https://github.com/meta-models/muse-code-sdk/issues/15) | Issue | closed | `muse mcp login` registers a new OAuth client on every login, omits `scope` at registration, and never answers the callback tab |
| [#14](https://github.com/meta-models/muse-code-sdk/pull/14) | PR | open | python/: re-mirror at the 1.3.0 publish integration commit |
| [#13](https://github.com/meta-models/muse-code-sdk/issues/13) | Issue | open | `Item.childSessionId` is documented as readable but `session/read`, `view/page` and `session/resume` all reject it with `-32020` |
| [#12](https://github.com/meta-models/muse-code-sdk/pull/12) | PR | closed | Python SDK tier: python/ closure tree + publish-pypi.yml (prepared, not armed) |
| [#11](https://github.com/meta-models/muse-code-sdk/issues/11) | Issue | open | Native serve initialization repeatedly traverses populated session history before SDK handshake |
| [#10](https://github.com/meta-models/muse-code-sdk/issues/10) | Issue | closed | SDK onApproval is not rerouted when approval/updated advances a multi-stage requirement |
| [#9](https://github.com/meta-models/muse-code-sdk/issues/9) | Issue | open | POST /muse-code/key stopped returning subs_usage (2026-09-11) |
| [#8](https://github.com/meta-models/muse-code-sdk/issues/8) | Issue | open | Question: supported SDK boundary for a single-user personal assistant |
| [#7](https://github.com/meta-models/muse-code-sdk/issues/7) | Issue | closed | serve ignores the session model pin: provider calls always use muse-spark-1.3-contributor |
| [#6](https://github.com/meta-models/muse-code-sdk/issues/6) | Issue | closed | MSP turn/start reasoningEffort is accepted but never forwarded to the provider |
| [#5](https://github.com/meta-models/muse-code-sdk/issues/5) | Issue | closed | MSP turn/start rejects reasoningEffort max though CLI, catalog, and provider all accept it |
| [#4](https://github.com/meta-models/muse-code-sdk/issues/4) | Issue | open | [Feature]: let hooks receive selected environment variables (allowlist) so orchestrators can attribute events |
| [#3](https://github.com/meta-models/muse-code-sdk/issues/3) | Issue | open | Any plans to release `@muse-code/acp`? |
| [#2](https://github.com/meta-models/muse-code-sdk/pull/2) | PR | closed | Adding Code of Conduct file |
| [#1](https://github.com/meta-models/muse-code-sdk/pull/1) | PR | closed | Adding Contributing file |

#### muse-code-sdk: reachable commit inventory

Commit subjects below are metadata. They do not establish that the described behavior exists in the pinned main tree. All commits are listed once per repository, including commits reachable only from non-main branches.

| Commit | Subject |
|---|---|
| [8c9c4324a6e20c8a3704d241806c6d7ccc27bd22](https://github.com/meta-models/muse-code-sdk/commit/8c9c4324a6e20c8a3704d241806c6d7ccc27bd22) | Initial public release: @muse-code/sdk source, MSP wire schema, and developer documentation |
| [877a0ee9868a759938d430d62a93d752cef80027](https://github.com/meta-models/muse-code-sdk/commit/877a0ee9868a759938d430d62a93d752cef80027) | OSS Automated Fix: Addition of Contributing |
| [cf3bc059331e0469588f54b4cd59d78ab160510c](https://github.com/meta-models/muse-code-sdk/commit/cf3bc059331e0469588f54b4cd59d78ab160510c) | OSS Automated Fix: Addition of Code of Conduct |
| [4a2a06cf27cb6ba6952bc9dadf7a256dcfe66792](https://github.com/meta-models/muse-code-sdk/commit/4a2a06cf27cb6ba6952bc9dadf7a256dcfe66792) | Re-mirror SDK source at the @muse-code rename (tbh #26066) |
| [04de949db27f034244971ffc9b1d2d293d64fc49](https://github.com/meta-models/muse-code-sdk/commit/04de949db27f034244971ffc9b1d2d293d64fc49) | README: @muse-code/sdk is on npm; refresh for the public repo |
| [5f80be8b37680fa4179f4b04dc876e7f78c2d076](https://github.com/meta-models/muse-code-sdk/commit/5f80be8b37680fa4179f4b04dc876e7f78c2d076) | Re-mirror SDK source closure at D-053 (tbh #26186) |
| [fbce769ccb75ab971d00e01a00fe076de4c773fc](https://github.com/meta-models/muse-code-sdk/commit/fbce769ccb75ab971d00e01a00fe076de4c773fc) | Re-mirror SDK source closure at the docs cohort head (tbh #26230/#26772/#26724) |
| [495b0791956b59fdf127896b65e8db3586bafdd2](https://github.com/meta-models/muse-code-sdk/commit/495b0791956b59fdf127896b65e8db3586bafdd2) | Publish the Muse Code developer documentation site |
| [3a74bfb30a3c43e6ac86e0a56a7e6b758f0026b1](https://github.com/meta-models/muse-code-sdk/commit/3a74bfb30a3c43e6ac86e0a56a7e6b758f0026b1) | Python SDK tier: python/ closure tree at tbh@9973510 + publish-pypi.yml (one-timers 4+5) |
| [94e98141a8074d50d2ac418de7acb5b16d8024fa](https://github.com/meta-models/muse-code-sdk/commit/94e98141a8074d50d2ac418de7acb5b16d8024fa) | Merge pull request #12 from meta-models/python-sdk-tree |
| [174cc98fac376b13d1bd00fb485a9f746def6a19](https://github.com/meta-models/muse-code-sdk/commit/174cc98fac376b13d1bd00fb485a9f746def6a19) | python/: re-mirror at the 1.3.0 publish integration commit |
| [9878b685de2e2dce50c9cb5e2e62de3462890bc8](https://github.com/meta-models/muse-code-sdk/commit/9878b685de2e2dce50c9cb5e2e62de3462890bc8) | Publish the Muse Code developer documentation site: /next/ |
| [da066846841f516d48d98281620d6014e5ffc280](https://github.com/meta-models/muse-code-sdk/commit/da066846841f516d48d98281620d6014e5ffc280) | Re-mirror the python/ tree at tbh@efdde4e: PyPI metadata scrub + external-audience publish gate |
| [611625ab9e6e80d99a0b1e06fc94fe0a4298dbda](https://github.com/meta-models/muse-code-sdk/commit/611625ab9e6e80d99a0b1e06fc94fe0a4298dbda) | Scrub internal identifiers from the whole python/ tree; two-tier audience gate |
| [386a4f41702aa4e2c9452269781c453056903c8a](https://github.com/meta-models/muse-code-sdk/commit/386a4f41702aa4e2c9452269781c453056903c8a) | Carry the gate script's prose fixes; re-anchor at the current upstream scrub head |
| [84b91cd73ee91ca2352b876c8907ce72787bdd7e](https://github.com/meta-models/muse-code-sdk/commit/84b91cd73ee91ca2352b876c8907ce72787bdd7e) | Re-mirror the TypeScript SDK closure at tbh@79af1ae (1.3.0 lockstep) |
| [17b4bdaf3277e52616571e72ce2f57fb706929d1](https://github.com/meta-models/muse-code-sdk/commit/17b4bdaf3277e52616571e72ce2f57fb706929d1) | Publish the Muse Code developer documentation site: /next/ |
| [c52c1fc7159804a25f367d8ceb279c40801fb946](https://github.com/meta-models/muse-code-sdk/commit/c52c1fc7159804a25f367d8ceb279c40801fb946) | Re-mirror the TypeScript SDK closure at tbh@e5e52c4 (scrubbed npm README, --npm-source gate) |
| [4dc252c1a31b02ff676dce0358d297ffbc5d8784](https://github.com/meta-models/muse-code-sdk/commit/4dc252c1a31b02ff676dce0358d297ffbc5d8784) | Re-mirror the TypeScript SDK closure at tbh@e5e52c4 (1.3.0 lockstep, scrubbed README) (#17) |
| [56d25c1681a11da666bb83f85260f6b585e79804](https://github.com/meta-models/muse-code-sdk/commit/56d25c1681a11da666bb83f85260f6b585e79804) | Record the @muse-code/sdk@1.3.0 npm publication in publish-anchor.json |
| [6573bebfd83ea668ac0c388720bc20a0c1b7f698](https://github.com/meta-models/muse-code-sdk/commit/6573bebfd83ea668ac0c388720bc20a0c1b7f698) | Re-mirror the Python SDK closure at tbh@6713ff0 (1.3.1 lockstep) |
| [68ed328d5e8319c7d7c5d5f9ef0e36e876dd523a](https://github.com/meta-models/muse-code-sdk/commit/68ed328d5e8319c7d7c5d5f9ef0e36e876dd523a) | Merge pull request #24 from meta-models/remirror-python-1.3.1 |
| [6cd1a052b379cacb0c42facfded4f465bc1c2e1b](https://github.com/meta-models/muse-code-sdk/commit/6cd1a052b379cacb0c42facfded4f465bc1c2e1b) | python/: carry scripts/check-sdk-py-external-audience.py per closure manifest |
| [a7c10c5dd3f66be412077d29f9d11111af70317b](https://github.com/meta-models/muse-code-sdk/commit/a7c10c5dd3f66be412077d29f9d11111af70317b) | Merge pull request #25 from meta-models/python-tree-audience-gate |
| [cd4134968074ec9aa6c55e0a4c9daf0b5bea2ee1](https://github.com/meta-models/muse-code-sdk/commit/cd4134968074ec9aa6c55e0a4c9daf0b5bea2ee1) | Re-mirror the SDK closure at tbh@fda770f (1.4.2 lockstep) |
| [bb44be3d36de46d2411bd9eaa4aee99006092546](https://github.com/meta-models/muse-code-sdk/commit/bb44be3d36de46d2411bd9eaa4aee99006092546) | Merge pull request #67 from meta-models/sdk-1.4.2-remirror |
| [a58caeaf3b8092f86a24189e243f82f916042713](https://github.com/meta-models/muse-code-sdk/commit/a58caeaf3b8092f86a24189e243f82f916042713) | docs: publish /next/ from mslsrc/tbh@81cd1fb592ca6bfb8ceb20799de4ca2f42a191d7 |
| [e896a8497c3f61edca380e861f20feb6dd917a4b](https://github.com/meta-models/muse-code-sdk/commit/e896a8497c3f61edca380e861f20feb6dd917a4b) | docs: complete /next/ publish from mslsrc/tbh@81cd1fb592ca6bfb8ceb20799de4ca2f42a191d7 |
| [28cf0a9868d326465d9404fe07ea70ec6ef51a52](https://github.com/meta-models/muse-code-sdk/commit/28cf0a9868d326465d9404fe07ea70ec6ef51a52) | docs: publish /next/ from mslsrc/tbh@d7d3350c9660a527a2b91071807a83a3606e1e32 |
| [6b0963146681d0b19830613de885029a7c8c1ae8](https://github.com/meta-models/muse-code-sdk/commit/6b0963146681d0b19830613de885029a7c8c1ae8) | docs: publish /next/ from mslsrc/tbh@0d7e1862da9dc1c819dc4f2d4f01cc6638e40081 |
| [d4fb8d2f739502ed54caa1ceff13dee69d6e2c73](https://github.com/meta-models/muse-code-sdk/commit/d4fb8d2f739502ed54caa1ceff13dee69d6e2c73) | docs: publish /next/ from mslsrc/tbh@36ceef074cc4e78762ba6c873e8fd8055d2ef737 |
| [d9d50d285268f7dc4fa4d61378fc753efcb69c5d](https://github.com/meta-models/muse-code-sdk/commit/d9d50d285268f7dc4fa4d61378fc753efcb69c5d) | docs: publish /next/ from mslsrc/tbh@4a915248fcf17aa09fa8f0ece9ee43df18448f1e |
| [caac686f9c399d9a88f496a6f9105943c905faab](https://github.com/meta-models/muse-code-sdk/commit/caac686f9c399d9a88f496a6f9105943c905faab) | docs: publish /next/ from mslsrc/tbh@08c4735beb3b36847c50091572ec44bcbc6cc5d4 |
| [343366f2d760318769312c858b439ae086e2fb9a](https://github.com/meta-models/muse-code-sdk/commit/343366f2d760318769312c858b439ae086e2fb9a) | docs: publish /next/ from mslsrc/tbh@b52b74f03daf9435b70e466b19dfa544277492b6 |
| [cb447da1888d8706a69af5aa423361b3d6d3b67b](https://github.com/meta-models/muse-code-sdk/commit/cb447da1888d8706a69af5aa423361b3d6d3b67b) | docs: publish /next/ from mslsrc/tbh@4a00a6ab9bf241979b45edf152a796c1e6559e71 |
| [4304463e00e57f15e0341df65298118db2b4dd6d](https://github.com/meta-models/muse-code-sdk/commit/4304463e00e57f15e0341df65298118db2b4dd6d) | docs: publish /next/ from mslsrc/tbh@e18191e42a07b258bcad23b1c4129810e45985a3 |
| [5791b085bac6db4458fa1c1320e39fc2f11783bf](https://github.com/meta-models/muse-code-sdk/commit/5791b085bac6db4458fa1c1320e39fc2f11783bf) | docs: publish /next/ from mslsrc/tbh@d6b7b959ea51676b32baf6210cbbe2763adb98ae |
| [cf7e3b16e5215ffafe2e8a396766e0d4f40aa875](https://github.com/meta-models/muse-code-sdk/commit/cf7e3b16e5215ffafe2e8a396766e0d4f40aa875) | docs: publish /next/ from mslsrc/tbh@5c68adc75aa3ae94fce07eada5c8396d4d216b81 |
| [ea3b7220dd88cd11a40a1ea9c1cfeac9e0f0cc5a](https://github.com/meta-models/muse-code-sdk/commit/ea3b7220dd88cd11a40a1ea9c1cfeac9e0f0cc5a) | docs: publish /next/ from mslsrc/tbh@683bbecb4f3e38dc5a1584408fe79dca77ba9af6 |
| [8331274dd61ae717a718afddda0e3497a37eb488](https://github.com/meta-models/muse-code-sdk/commit/8331274dd61ae717a718afddda0e3497a37eb488) | docs: publish /next/ from mslsrc/tbh@403656a2b148a0c7492145005fbf94548c46d596 |
| [370a6f2f2d8508f57c63bd17b812e7847d99b25a](https://github.com/meta-models/muse-code-sdk/commit/370a6f2f2d8508f57c63bd17b812e7847d99b25a) | docs: publish /next/ from mslsrc/tbh@da9b0567a85c161a220e18e0a98420410230c13d |
| [750b8efedb9930b681c7b3b01ef2703856974d8e](https://github.com/meta-models/muse-code-sdk/commit/750b8efedb9930b681c7b3b01ef2703856974d8e) | docs: publish /next/ from mslsrc/tbh@0f602d46c3a64143f5140f38f256bddb0cd7029c |
| [8dd66cea2bdd2eda856e61e682dfb7199c5bfcde](https://github.com/meta-models/muse-code-sdk/commit/8dd66cea2bdd2eda856e61e682dfb7199c5bfcde) | docs: publish /next/ from mslsrc/tbh@ca413434b296989ccae2e3a6fc30fa571bed19fa |
| [9b3688aa32d47fcf3912dc15aa449d8344b195ef](https://github.com/meta-models/muse-code-sdk/commit/9b3688aa32d47fcf3912dc15aa449d8344b195ef) | docs: publish /next/ from mslsrc/tbh@fc5e3f6b4485ae08119100533320b0eff83c3848 |
| [3f4aac1e3546114fd6b81bf1b5a185d55a7446b2](https://github.com/meta-models/muse-code-sdk/commit/3f4aac1e3546114fd6b81bf1b5a185d55a7446b2) | docs: publish /next/ from mslsrc/tbh@61387046efacf89df6a9aa659f63b26268ebd67f |
| [3b4954d1857245e95764df09f8fe75ea46a012c8](https://github.com/meta-models/muse-code-sdk/commit/3b4954d1857245e95764df09f8fe75ea46a012c8) | docs: publish /next/ from mslsrc/tbh@79194240c835a1a25789bee29b40636559a06369 |
| [ddf1043e9803526f918fb914e810506744289807](https://github.com/meta-models/muse-code-sdk/commit/ddf1043e9803526f918fb914e810506744289807) | docs: publish /next/ from mslsrc/tbh@f9c5860e47c9d660ae34c9f4b99e48fafca90f13 |
| [9cffd7dadfd0c460bc2d263d23ed60aec9e121bc](https://github.com/meta-models/muse-code-sdk/commit/9cffd7dadfd0c460bc2d263d23ed60aec9e121bc) | docs: publish /next/ from mslsrc/tbh@e58d8f9fab4077bcd55de1ac96cd4d2955ed5269 |
| [a1bb4e346c8a859725e1e9b0a75ab1300fc37e10](https://github.com/meta-models/muse-code-sdk/commit/a1bb4e346c8a859725e1e9b0a75ab1300fc37e10) | docs: publish /next/ from mslsrc/tbh@58ff3e33960325a53a44624cb35493609f675611 |
| [359c3f75ea3719b4094ce9bab9c2f0c8d05e05c8](https://github.com/meta-models/muse-code-sdk/commit/359c3f75ea3719b4094ce9bab9c2f0c8d05e05c8) | docs: publish /next/ from the internal source tree (tracked internally) |
| [1da439af0efdbd5d75c08529fb61d7a3f779e8ac](https://github.com/meta-models/muse-code-sdk/commit/1da439af0efdbd5d75c08529fb61d7a3f779e8ac) | docs: publish /next/ from the internal source tree (tracked internally) |
| [bdec981c0e96b9bfa30369200eba764ce7b28be6](https://github.com/meta-models/muse-code-sdk/commit/bdec981c0e96b9bfa30369200eba764ce7b28be6) | docs: publish /next/ from the internal source tree (tracked internally) |
| [77a77875dbaa6e73d7923d31009453287aae26b4](https://github.com/meta-models/muse-code-sdk/commit/77a77875dbaa6e73d7923d31009453287aae26b4) | docs: publish /next/ from the internal source tree (tracked internally) |
| [44cf5601223354b7e7892f7ab1fb68b57b56eba9](https://github.com/meta-models/muse-code-sdk/commit/44cf5601223354b7e7892f7ab1fb68b57b56eba9) | docs: publish /next/ from the internal source tree (tracked internally) |
| [98ec125a3d3ab9cdf1701125b6a3732131efc254](https://github.com/meta-models/muse-code-sdk/commit/98ec125a3d3ab9cdf1701125b6a3732131efc254) | Remove the duplicate stable-schema copy and clean an anchor note |
| [53e1ec712c0c428ab8f6ad1cd24b3cd0a6270c17](https://github.com/meta-models/muse-code-sdk/commit/53e1ec712c0c428ab8f6ad1cd24b3cd0a6270c17) | Merge pull request #87 from meta-models/cleanup-publish-anchor-notes |
| [80508b365f9ea5f0528071bcedf2fae588a4ad6b](https://github.com/meta-models/muse-code-sdk/commit/80508b365f9ea5f0528071bcedf2fae588a4ad6b) | docs: publish /next/ from the internal source tree (tracked internally) |
| [23ddf3eafc254c9cfa7edec5dd17e3eeb30c085d](https://github.com/meta-models/muse-code-sdk/commit/23ddf3eafc254c9cfa7edec5dd17e3eeb30c085d) | docs: publish /next/ from the internal source tree (tracked internally) |
| [fa68c3253c93ce50eed80004ad5660c456b5ca7d](https://github.com/meta-models/muse-code-sdk/commit/fa68c3253c93ce50eed80004ad5660c456b5ca7d) | docs: publish /next/ from the internal source tree (tracked internally) |
| [53d9f9d1287d9a609f0c12a6c4eb92a1456e7854](https://github.com/meta-models/muse-code-sdk/commit/53d9f9d1287d9a609f0c12a6c4eb92a1456e7854) | docs: publish /next/ from the internal source tree (tracked internally) |
| [475027339f635c85c5873b211a5d5a7fbb993910](https://github.com/meta-models/muse-code-sdk/commit/475027339f635c85c5873b211a5d5a7fbb993910) | docs: publish /next/ from the internal source tree (tracked internally) |
| [e69f1beffa639999862e5266909ac08c97983e3c](https://github.com/meta-models/muse-code-sdk/commit/e69f1beffa639999862e5266909ac08c97983e3c) | docs: publish /next/ from the internal source tree (tracked internally) |
| [8f258ab79a9e7e29e3c9b0c0cb511ce813d6987f](https://github.com/meta-models/muse-code-sdk/commit/8f258ab79a9e7e29e3c9b0c0cb511ce813d6987f) | docs: publish /next/ from the internal source tree (tracked internally) |
| [27ed1ddcf015fd79a0ff2217a60d17d63e583b9d](https://github.com/meta-models/muse-code-sdk/commit/27ed1ddcf015fd79a0ff2217a60d17d63e583b9d) | docs: publish /next/ from the internal source tree (tracked internally) |
| [36467937b86d96f5b30f59d29bda39b2e9b499c9](https://github.com/meta-models/muse-code-sdk/commit/36467937b86d96f5b30f59d29bda39b2e9b499c9) | docs: publish /next/ from the internal source tree (tracked internally) |
| [972bee4c3024802b010c66f005e2fe61e10689de](https://github.com/meta-models/muse-code-sdk/commit/972bee4c3024802b010c66f005e2fe61e10689de) | docs: publish /next/ from the internal source tree (tracked internally) |
| [dbea3a327419a1194aa0d9064c909b2bf15e3dc0](https://github.com/meta-models/muse-code-sdk/commit/dbea3a327419a1194aa0d9064c909b2bf15e3dc0) | docs: publish /next/ from the internal source tree (tracked internally) |
| [01d8f6a8ab6a278ab2a6369e6285835359928e30](https://github.com/meta-models/muse-code-sdk/commit/01d8f6a8ab6a278ab2a6369e6285835359928e30) | docs: publish /next/ from the internal source tree (tracked internally) |
| [c9a0c0a017ea7ed03915135f7188724b7f9a8ef1](https://github.com/meta-models/muse-code-sdk/commit/c9a0c0a017ea7ed03915135f7188724b7f9a8ef1) | docs: publish /next/ from the internal source tree (tracked internally) |
| [2fdbb12fa0ce26c714e4c33ea2abcec3d801c403](https://github.com/meta-models/muse-code-sdk/commit/2fdbb12fa0ce26c714e4c33ea2abcec3d801c403) | docs: publish /next/ from the internal source tree (tracked internally) |
| [6c24b27fa71e8a416128f95a0629aee26b0c9f15](https://github.com/meta-models/muse-code-sdk/commit/6c24b27fa71e8a416128f95a0629aee26b0c9f15) | docs: publish /next/ from the internal source tree (tracked internally) |
| [8b1bb585450911d7e4e3b6fbcf5a7e69eba347cc](https://github.com/meta-models/muse-code-sdk/commit/8b1bb585450911d7e4e3b6fbcf5a7e69eba347cc) | docs: publish /next/ from the internal source tree (tracked internally) |
| [afc93871a8b1b677c09e9baa4b13c4e0a1f15b1a](https://github.com/meta-models/muse-code-sdk/commit/afc93871a8b1b677c09e9baa4b13c4e0a1f15b1a) | Remove duplicate audience checker script |
| [bf2fc138f0c0d451d9a898d9c185ee9ec0a23845](https://github.com/meta-models/muse-code-sdk/commit/bf2fc138f0c0d451d9a898d9c185ee9ec0a23845) | Point publish test at the remaining checker copy |
| [912061bb125b4bff60c9f3089a21cd23b53c6b4f](https://github.com/meta-models/muse-code-sdk/commit/912061bb125b4bff60c9f3089a21cd23b53c6b4f) | Merge pull request #95 from meta-models/remove-duplicate-checker |
| [52d47dea48359dc1af01cd4ce4a8c0435994de9d](https://github.com/meta-models/muse-code-sdk/commit/52d47dea48359dc1af01cd4ce4a8c0435994de9d) | docs: publish /next/ from the internal source tree (tracked internally) |
| [ae58bd0ab12d55becb9c687000c50a8f86bbb2b5](https://github.com/meta-models/muse-code-sdk/commit/ae58bd0ab12d55becb9c687000c50a8f86bbb2b5) | docs: publish /next/ from the internal source tree (tracked internally) |
| [882f2dc916076ca29309747539e5ceb1767af98c](https://github.com/meta-models/muse-code-sdk/commit/882f2dc916076ca29309747539e5ceb1767af98c) | docs: publish /next/ from the internal source tree (tracked internally) |
| [3a4a65425004a535e7c06a780d33ec97a1227492](https://github.com/meta-models/muse-code-sdk/commit/3a4a65425004a535e7c06a780d33ec97a1227492) | docs: publish /next/ from the internal source tree (tracked internally) |
| [469bdac4c83922af9f64f3ab0a1e2155c0538f6e](https://github.com/meta-models/muse-code-sdk/commit/469bdac4c83922af9f64f3ab0a1e2155c0538f6e) | docs: publish /next/ from the internal source tree (tracked internally) |
| [1a56aaae496da755af1cde699e9ae5e98c462f03](https://github.com/meta-models/muse-code-sdk/commit/1a56aaae496da755af1cde699e9ae5e98c462f03) | docs: publish /next/ from the internal source tree (tracked internally) |
| [3f03feb22c4f6346755778327b59d887af9032a0](https://github.com/meta-models/muse-code-sdk/commit/3f03feb22c4f6346755778327b59d887af9032a0) | docs: publish /next/ from the internal source tree (tracked internally) |
| [f054bf34b88a614dcf1b84f2bc75cd3798a747c9](https://github.com/meta-models/muse-code-sdk/commit/f054bf34b88a614dcf1b84f2bc75cd3798a747c9) | docs: publish /next/ from the internal source tree (tracked internally) |
| [6bb6145777e65f26d0840b958ae5568d2ed81936](https://github.com/meta-models/muse-code-sdk/commit/6bb6145777e65f26d0840b958ae5568d2ed81936) | docs: publish /next/ from the internal source tree (tracked internally) |
| [79586806bb961a6555f4c458d21b8c0ed4fac8e6](https://github.com/meta-models/muse-code-sdk/commit/79586806bb961a6555f4c458d21b8c0ed4fac8e6) | docs: publish /next/ from the internal source tree (tracked internally) |
| [0cbb00a5a865bc466acaca4ffed5a439c61fb790](https://github.com/meta-models/muse-code-sdk/commit/0cbb00a5a865bc466acaca4ffed5a439c61fb790) | docs: publish /next/ from the internal source tree (tracked internally) |
| [b457ecd540a437eb2ec8588627e9b7e4defccbb5](https://github.com/meta-models/muse-code-sdk/commit/b457ecd540a437eb2ec8588627e9b7e4defccbb5) | docs: publish /next/ from the internal source tree (tracked internally) |
| [2638e0a8ec0a9696ae2d02e06f8e5fef93d72e45](https://github.com/meta-models/muse-code-sdk/commit/2638e0a8ec0a9696ae2d02e06f8e5fef93d72e45) | docs: publish /next/ from the internal source tree (tracked internally) |
| [eae2c52d0b7686aa348f43682eb8ec3e69f3db74](https://github.com/meta-models/muse-code-sdk/commit/eae2c52d0b7686aa348f43682eb8ec3e69f3db74) | docs: publish /next/ from the internal source tree (tracked internally) |
| [1435bda3d3fd076c97e5aadf732a43104a38122a](https://github.com/meta-models/muse-code-sdk/commit/1435bda3d3fd076c97e5aadf732a43104a38122a) | docs: publish /next/ from the internal source tree (tracked internally) |
| [537cc8dc72cf1347c16063fc13dcb93f9cde7f6e](https://github.com/meta-models/muse-code-sdk/commit/537cc8dc72cf1347c16063fc13dcb93f9cde7f6e) | remirror: 1.4.4 from the internal source tree (tracked internally) |
| [8718ae9bb16565b178d020583098a9d01c92a564](https://github.com/meta-models/muse-code-sdk/commit/8718ae9bb16565b178d020583098a9d01c92a564) | docs: publish /1.4/ from mslsrc/tbh@57b4e77890b730db14011134a95fa0b40031f1d8 |
| [8a7325e9cb585a13d8700cbc87aee313e0161e7d](https://github.com/meta-models/muse-code-sdk/commit/8a7325e9cb585a13d8700cbc87aee313e0161e7d) | docs: publish /next/ from the internal source tree (tracked internally) |
| [983a18e19e01d84aafe62a094ef95d229d8848e1](https://github.com/meta-models/muse-code-sdk/commit/983a18e19e01d84aafe62a094ef95d229d8848e1) | docs: publish /next/ from the internal source tree (tracked internally) |
| [2641f091d120b491e76c631edb0468fe55e2d2ec](https://github.com/meta-models/muse-code-sdk/commit/2641f091d120b491e76c631edb0468fe55e2d2ec) | docs: publish /next/ from the internal source tree (tracked internally) |
| [06a4175267c22516de7388d9371ad7a3e0528cd9](https://github.com/meta-models/muse-code-sdk/commit/06a4175267c22516de7388d9371ad7a3e0528cd9) | docs: publish /next/ from the internal source tree (tracked internally) |
| [335f472bdca560b226a0c9e391885c02ff85c372](https://github.com/meta-models/muse-code-sdk/commit/335f472bdca560b226a0c9e391885c02ff85c372) | docs: publish /next/ from the internal source tree (tracked internally) |
| [c0661d0fa18d39e8946cf4b5a83fa145cae26ce8](https://github.com/meta-models/muse-code-sdk/commit/c0661d0fa18d39e8946cf4b5a83fa145cae26ce8) | docs: publish /next/ from the internal source tree (tracked internally) |
| [ef75ea971f213c10462d7b3b56a59f8b62edbf0b](https://github.com/meta-models/muse-code-sdk/commit/ef75ea971f213c10462d7b3b56a59f8b62edbf0b) | docs: publish /next/ from the internal source tree (tracked internally) |
| [984228618fcfadcf06f2aacf98a9f02aebb61bf5](https://github.com/meta-models/muse-code-sdk/commit/984228618fcfadcf06f2aacf98a9f02aebb61bf5) | Add public issue triage guidance |
| [77c0bd1304847eb4d87e687d5f8d71b70869302d](https://github.com/meta-models/muse-code-sdk/commit/77c0bd1304847eb4d87e687d5f8d71b70869302d) | docs: publish /next/ from the internal source tree (tracked internally) |
| [13187353f96584b9438de0d160b6dbbcc90050dc](https://github.com/meta-models/muse-code-sdk/commit/13187353f96584b9438de0d160b6dbbcc90050dc) | docs: publish /next/ from the internal source tree (tracked internally) |
| [54b1b65ed891832b996f7142041e7692b1c7877f](https://github.com/meta-models/muse-code-sdk/commit/54b1b65ed891832b996f7142041e7692b1c7877f) | docs: publish /next/ from the internal source tree (tracked internally) |
| [eefbc24f61689b91e3a1bcad280ed22d6270e221](https://github.com/meta-models/muse-code-sdk/commit/eefbc24f61689b91e3a1bcad280ed22d6270e221) | docs: publish /next/ from the internal source tree (tracked internally) |
| [8b77bffea9a482b59177a174777f3c1c7d882fd1](https://github.com/meta-models/muse-code-sdk/commit/8b77bffea9a482b59177a174777f3c1c7d882fd1) | Merge pull request #98 from theesh91/public-issue-triage-guidance |
| [3bf8543d64580a0eb7e1e6365b9fa9742c3e0fe1](https://github.com/meta-models/muse-code-sdk/commit/3bf8543d64580a0eb7e1e6365b9fa9742c3e0fe1) | docs: publish /next/ from the internal source tree (tracked internally) |
| [cbfb05159370b2fe53e5ec8499c7670678f03bcb](https://github.com/meta-models/muse-code-sdk/commit/cbfb05159370b2fe53e5ec8499c7670678f03bcb) | docs: publish /next/ from the internal source tree (tracked internally) |
| [b16583fa5f42ac11b94418069ff4c6ed3a72e2fa](https://github.com/meta-models/muse-code-sdk/commit/b16583fa5f42ac11b94418069ff4c6ed3a72e2fa) | docs: publish /next/ from the internal source tree (tracked internally) |
| [42e06cf8b6822236f56db1e76ea385c76c473ac0](https://github.com/meta-models/muse-code-sdk/commit/42e06cf8b6822236f56db1e76ea385c76c473ac0) | docs: publish /next/ from the internal source tree (tracked internally) |
| [29953403d7003b624ba9a383e5577f0129fd93c0](https://github.com/meta-models/muse-code-sdk/commit/29953403d7003b624ba9a383e5577f0129fd93c0) | docs: publish /next/ from the internal source tree (tracked internally) |
| [49cf81829ebbd5c040a9d31e6290eef52b77ee49](https://github.com/meta-models/muse-code-sdk/commit/49cf81829ebbd5c040a9d31e6290eef52b77ee49) | docs: publish /next/ from the internal source tree (tracked internally) |
| [05a1a5a14f4fa44f166415af53793f250db8f2e4](https://github.com/meta-models/muse-code-sdk/commit/05a1a5a14f4fa44f166415af53793f250db8f2e4) | docs: publish /next/ from the internal source tree (tracked internally) |
| [9ba1eec8c9ce4488d70dc71b4f168bf29cf35da4](https://github.com/meta-models/muse-code-sdk/commit/9ba1eec8c9ce4488d70dc71b4f168bf29cf35da4) | docs: publish /next/ from the internal source tree (tracked internally) |
| [d805193c371dbdc0cdac4c1f3d62d8a422f05987](https://github.com/meta-models/muse-code-sdk/commit/d805193c371dbdc0cdac4c1f3d62d8a422f05987) | docs: publish /next/ from the internal source tree (tracked internally) |
| [89abe576a9c8e61a94004082fa90cd08d0e76126](https://github.com/meta-models/muse-code-sdk/commit/89abe576a9c8e61a94004082fa90cd08d0e76126) | docs: publish /next/ from the internal source tree (tracked internally) |
| [560ac21f86407b3a8a471f14a37c90ffb34770e2](https://github.com/meta-models/muse-code-sdk/commit/560ac21f86407b3a8a471f14a37c90ffb34770e2) | docs: publish /next/ from the internal source tree (tracked internally) |
| [5c2ef612c58ace91fbac8a34ed065649e8c90ef8](https://github.com/meta-models/muse-code-sdk/commit/5c2ef612c58ace91fbac8a34ed065649e8c90ef8) | docs: publish /next/ from the internal source tree (tracked internally) |
| [2f0010c8e2cede757d9f058ec41efa9e88f53827](https://github.com/meta-models/muse-code-sdk/commit/2f0010c8e2cede757d9f058ec41efa9e88f53827) | docs: publish /next/ from the internal source tree (tracked internally) |
| [10e455595659b087f9af59acd77c9a76d29ba3da](https://github.com/meta-models/muse-code-sdk/commit/10e455595659b087f9af59acd77c9a76d29ba3da) | docs: publish /next/ from the internal source tree (tracked internally) |
| [02aae100ce852af499f5ba8173d3e9430020a6fc](https://github.com/meta-models/muse-code-sdk/commit/02aae100ce852af499f5ba8173d3e9430020a6fc) | docs: publish /next/ from the internal source tree (tracked internally) |
| [ea88c8221d381de7cb28281be8bc6b8b1507ba72](https://github.com/meta-models/muse-code-sdk/commit/ea88c8221d381de7cb28281be8bc6b8b1507ba72) | remirror: 1.4.6 from the internal source tree (tracked internally) |
| [7e43ff4f878a201a8e6a92688bdf3f0dc7268e12](https://github.com/meta-models/muse-code-sdk/commit/7e43ff4f878a201a8e6a92688bdf3f0dc7268e12) | docs: publish /1.4/ from mslsrc/tbh@db2475a6bd32831a854b97282a12b867123d6520 |
| [bcc5a43100be12ad4f17498a07c1509167a8e625](https://github.com/meta-models/muse-code-sdk/commit/bcc5a43100be12ad4f17498a07c1509167a8e625) | docs: publish /next/ from the internal source tree (tracked internally) |
| [a7486616c9a182529cc9f0ff04947d9da8218b46](https://github.com/meta-models/muse-code-sdk/commit/a7486616c9a182529cc9f0ff04947d9da8218b46) | docs: publish /next/ from the internal source tree (tracked internally) |
| [63920d772eaa828e9f2fa76e50b80cc4c4c6d419](https://github.com/meta-models/muse-code-sdk/commit/63920d772eaa828e9f2fa76e50b80cc4c4c6d419) | docs: publish /next/ from the internal source tree (tracked internally) |
| [0b230e991f79a90dc3cf8b5ab7de083b51f78567](https://github.com/meta-models/muse-code-sdk/commit/0b230e991f79a90dc3cf8b5ab7de083b51f78567) | docs: publish /next/ from the internal source tree (tracked internally) |
| [48909b6db81d4b72356e89345a7482b74f9d0dc3](https://github.com/meta-models/muse-code-sdk/commit/48909b6db81d4b72356e89345a7482b74f9d0dc3) | docs: publish /next/ from the internal source tree (tracked internally) |
| [69e7690a8be1172412f37a5b40e682cf2e63effd](https://github.com/meta-models/muse-code-sdk/commit/69e7690a8be1172412f37a5b40e682cf2e63effd) | docs: publish /next/ from the internal source tree (tracked internally) |
| [86e91a4b1fe9486a946f3f533385167fe9a0c2d9](https://github.com/meta-models/muse-code-sdk/commit/86e91a4b1fe9486a946f3f533385167fe9a0c2d9) | docs: publish /next/ from the internal source tree (tracked internally) |
| [a0c8611b382584eb5091942b477f30e92e1c8d18](https://github.com/meta-models/muse-code-sdk/commit/a0c8611b382584eb5091942b477f30e92e1c8d18) | remirror: 1.4.7 from the internal source tree (tracked internally) |
| [8fa0eca42955ebd2bfb60002aca0b5c647426e74](https://github.com/meta-models/muse-code-sdk/commit/8fa0eca42955ebd2bfb60002aca0b5c647426e74) | docs: publish /1.4/ from mslsrc/tbh@d8c53d25bd30cda15ab32b18b9bb9961df9c4be0 |
| [47fd2b96c8a5d3457bf790187d289a074f8db64c](https://github.com/meta-models/muse-code-sdk/commit/47fd2b96c8a5d3457bf790187d289a074f8db64c) | docs: publish /next/ from the internal source tree (tracked internally) |
| [06cb2cc3fbb5b227b161cec1f97afda6eeabf558](https://github.com/meta-models/muse-code-sdk/commit/06cb2cc3fbb5b227b161cec1f97afda6eeabf558) | docs: publish /next/ from the internal source tree (tracked internally) |
| [8682141896f597e617595c1d1bd05eefd4b5529a](https://github.com/meta-models/muse-code-sdk/commit/8682141896f597e617595c1d1bd05eefd4b5529a) | docs: publish /next/ from the internal source tree (tracked internally) |
| [61caf23a9db9d5dc69fee0bb14d42127216939be](https://github.com/meta-models/muse-code-sdk/commit/61caf23a9db9d5dc69fee0bb14d42127216939be) | docs: publish /next/ from the internal source tree (tracked internally) |
| [1ee1e5dee1f5c4d9aad22c9182205ccb5648b2dd](https://github.com/meta-models/muse-code-sdk/commit/1ee1e5dee1f5c4d9aad22c9182205ccb5648b2dd) | docs: publish /next/ from the internal source tree (tracked internally) |
| [de275a06d4ad47a4e1150c41ad473bb8594d6780](https://github.com/meta-models/muse-code-sdk/commit/de275a06d4ad47a4e1150c41ad473bb8594d6780) | docs: publish /next/ from the internal source tree (tracked internally) |
| [aa077d8bf131fa7bdbd7c8da40da7ff08aff4732](https://github.com/meta-models/muse-code-sdk/commit/aa077d8bf131fa7bdbd7c8da40da7ff08aff4732) | docs: publish /next/ from the internal source tree (tracked internally) |
| [6165d629f0c3f7034fa4ba9444ffd724d108f3a3](https://github.com/meta-models/muse-code-sdk/commit/6165d629f0c3f7034fa4ba9444ffd724d108f3a3) | docs: publish /next/ from the internal source tree (tracked internally) |
| [a13e49f357635a67689a8fae8db5356fc82080dc](https://github.com/meta-models/muse-code-sdk/commit/a13e49f357635a67689a8fae8db5356fc82080dc) | docs: publish /next/ from the internal source tree (tracked internally) |
| [d6260b79032a1d1d0d32003baf87c1ed54b618bd](https://github.com/meta-models/muse-code-sdk/commit/d6260b79032a1d1d0d32003baf87c1ed54b618bd) | docs: publish /next/ from the internal source tree (tracked internally) |
| [136f14cb6c16afcdcb85959bf9d8dd56a637bbe8](https://github.com/meta-models/muse-code-sdk/commit/136f14cb6c16afcdcb85959bf9d8dd56a637bbe8) | docs: publish /next/ from the internal source tree (tracked internally) |
| [3acecb470b6c546aedcdb73edb6c2349162ab6ab](https://github.com/meta-models/muse-code-sdk/commit/3acecb470b6c546aedcdb73edb6c2349162ab6ab) | docs: publish /next/ from the internal source tree (tracked internally) |
| [818e9cdb7dd68ca35169ecf036ffa49ec4284625](https://github.com/meta-models/muse-code-sdk/commit/818e9cdb7dd68ca35169ecf036ffa49ec4284625) | docs: publish /next/ from the internal source tree (tracked internally) |
| [3bf90b4414f060e96efaa350c9c4c21bfede5041](https://github.com/meta-models/muse-code-sdk/commit/3bf90b4414f060e96efaa350c9c4c21bfede5041) | docs: publish /next/ from the internal source tree (tracked internally) |
| [838d36aa71f0c7fc610adef5e23ab6141fc0b318](https://github.com/meta-models/muse-code-sdk/commit/838d36aa71f0c7fc610adef5e23ab6141fc0b318) | remirror: 1.4.8 from the internal source tree (tracked internally) |
| [36c666ade8bc2f52546ad08618593a1fdb62297e](https://github.com/meta-models/muse-code-sdk/commit/36c666ade8bc2f52546ad08618593a1fdb62297e) | docs: publish /1.4/ from mslsrc/tbh@40c7658b12790fedfe6f206beaecb6d43423577b |
| [faf98e109f2f76e62026e45ee2eacfd6b026e6eb](https://github.com/meta-models/muse-code-sdk/commit/faf98e109f2f76e62026e45ee2eacfd6b026e6eb) | docs: publish /next/ from the internal source tree (tracked internally) |
| [3f95ff18b8a2fcce2de960b8d2129ea12e6a38a1](https://github.com/meta-models/muse-code-sdk/commit/3f95ff18b8a2fcce2de960b8d2129ea12e6a38a1) | docs: publish /next/ from the internal source tree (tracked internally) |
| [f03ea60978f29b83394231f3caa94f9fcd44f007](https://github.com/meta-models/muse-code-sdk/commit/f03ea60978f29b83394231f3caa94f9fcd44f007) | docs: publish /next/ from the internal source tree (tracked internally) |
| [e77653fd4724f837cca08d2498c38e7ca1478208](https://github.com/meta-models/muse-code-sdk/commit/e77653fd4724f837cca08d2498c38e7ca1478208) | docs: publish /next/ from the internal source tree (tracked internally) |
| [da6ae157357ef43ffc7b2ab60a4f73ea014d8ecc](https://github.com/meta-models/muse-code-sdk/commit/da6ae157357ef43ffc7b2ab60a4f73ea014d8ecc) | docs: publish /next/ from the internal source tree (tracked internally) |
| [e7ab6f3affbd4647c7c7184f7ea4fa01311aac21](https://github.com/meta-models/muse-code-sdk/commit/e7ab6f3affbd4647c7c7184f7ea4fa01311aac21) | docs: publish /next/ from the internal source tree (tracked internally) |
| [5094dda8afc0e031ab25a33b5078c6d43df53296](https://github.com/meta-models/muse-code-sdk/commit/5094dda8afc0e031ab25a33b5078c6d43df53296) | docs: publish /next/ from the internal source tree (tracked internally) |
| [c92e5c209a5d988ffe732f591070ec77040d499b](https://github.com/meta-models/muse-code-sdk/commit/c92e5c209a5d988ffe732f591070ec77040d499b) | docs: publish /next/ from the internal source tree (tracked internally) |
| [bb863c9071d42d9f67fcc3561690425646f727c8](https://github.com/meta-models/muse-code-sdk/commit/bb863c9071d42d9f67fcc3561690425646f727c8) | remirror: 1.4.9 from the internal source tree (tracked internally) |
| [6534a24936f1b435979352b705c3bbae216eb5e3](https://github.com/meta-models/muse-code-sdk/commit/6534a24936f1b435979352b705c3bbae216eb5e3) | docs: publish /1.4/ from mslsrc/tbh@633e270c4b4c2e680c215786759c5cf6ba47513d |
| [c150fcc9b262843800a7ce6502c2eb766355c366](https://github.com/meta-models/muse-code-sdk/commit/c150fcc9b262843800a7ce6502c2eb766355c366) | docs: publish /next/ from the internal source tree (tracked internally) |
| [dc7b257a2eaec09f1d20a027d9d956b292ac4786](https://github.com/meta-models/muse-code-sdk/commit/dc7b257a2eaec09f1d20a027d9d956b292ac4786) | docs: publish /next/ from the internal source tree (tracked internally) |
| [3746e4989640f53788599eab3a63db0276a61719](https://github.com/meta-models/muse-code-sdk/commit/3746e4989640f53788599eab3a63db0276a61719) | docs: publish /next/ from the internal source tree (tracked internally) |
| [6633d3fcfb427531bc9dcf36f4c5f7875a2f9709](https://github.com/meta-models/muse-code-sdk/commit/6633d3fcfb427531bc9dcf36f4c5f7875a2f9709) | docs: publish /next/ from the internal source tree (tracked internally) |
| [e4e4e6fafef66f4abd936a82da1e1c17ae76fa1f](https://github.com/meta-models/muse-code-sdk/commit/e4e4e6fafef66f4abd936a82da1e1c17ae76fa1f) | docs: publish /next/ from the internal source tree (tracked internally) |
| [ae469342dfe6ccd5142947af5f7dcdd5d50ccc18](https://github.com/meta-models/muse-code-sdk/commit/ae469342dfe6ccd5142947af5f7dcdd5d50ccc18) | remirror: 1.4.10 from the internal source tree (tracked internally) |
| [729b6eee69e71a22722b680bed518d3081600cbb](https://github.com/meta-models/muse-code-sdk/commit/729b6eee69e71a22722b680bed518d3081600cbb) | docs: publish /1.4/ from mslsrc/tbh@98c762468d5746a17e31a05cc923592d4e6124d3 |
| [0c0afcfc69781dccb3c866966378820392795886](https://github.com/meta-models/muse-code-sdk/commit/0c0afcfc69781dccb3c866966378820392795886) | docs: publish /next/ from the internal source tree (tracked internally) |
| [75581ae378e4766154309aac11420230f43ab9fc](https://github.com/meta-models/muse-code-sdk/commit/75581ae378e4766154309aac11420230f43ab9fc) | docs: publish /next/ from the internal source tree (tracked internally) |
| [0317f1aab61f5b15e57c332d975cd04411ea8ab8](https://github.com/meta-models/muse-code-sdk/commit/0317f1aab61f5b15e57c332d975cd04411ea8ab8) | docs: publish /next/ from the internal source tree (tracked internally) |
| [b214160f223f034f7f40771b8f2c92610579958c](https://github.com/meta-models/muse-code-sdk/commit/b214160f223f034f7f40771b8f2c92610579958c) | docs: publish /next/ from the internal source tree (tracked internally) |
| [0d8f1dcaa60524b2484f91a40b6f0bd32a828baf](https://github.com/meta-models/muse-code-sdk/commit/0d8f1dcaa60524b2484f91a40b6f0bd32a828baf) | docs: publish /next/ from the internal source tree (tracked internally) |
| [51a95e2bfe2b37ab234184f179c8b7b86780cbd5](https://github.com/meta-models/muse-code-sdk/commit/51a95e2bfe2b37ab234184f179c8b7b86780cbd5) | docs: publish /next/ from the internal source tree (tracked internally) |
| [13d8f0ad606feb2a3801aaa2dedc2e328cee992e](https://github.com/meta-models/muse-code-sdk/commit/13d8f0ad606feb2a3801aaa2dedc2e328cee992e) | docs: publish /next/ from the internal source tree (tracked internally) |
| [ae8c7aafe105b6d03d1642864ee92318fc5898ff](https://github.com/meta-models/muse-code-sdk/commit/ae8c7aafe105b6d03d1642864ee92318fc5898ff) | docs: publish /next/ from the internal source tree (tracked internally) |
| [358f2db7cb025afe599558c1493ed2b59c6eb14f](https://github.com/meta-models/muse-code-sdk/commit/358f2db7cb025afe599558c1493ed2b59c6eb14f) | docs: publish /next/ from the internal source tree (tracked internally) |
| [69cdcf0b542d02eea39ebf335f5231382c14655d](https://github.com/meta-models/muse-code-sdk/commit/69cdcf0b542d02eea39ebf335f5231382c14655d) | docs: publish /next/ from the internal source tree (tracked internally) |
| [eb3093b2c256a3fa64d6df5aef43a728f597a7a0](https://github.com/meta-models/muse-code-sdk/commit/eb3093b2c256a3fa64d6df5aef43a728f597a7a0) | docs: publish /next/ from the internal source tree (tracked internally) |
| [1b771cb3fd4ab7aaad90eb2d59d7f61f31a2782c](https://github.com/meta-models/muse-code-sdk/commit/1b771cb3fd4ab7aaad90eb2d59d7f61f31a2782c) | docs: publish /next/ from the internal source tree (tracked internally) |
| [55ec9f29d1c85b30066dfd50abe56f54b257155f](https://github.com/meta-models/muse-code-sdk/commit/55ec9f29d1c85b30066dfd50abe56f54b257155f) | docs: publish /next/ from the internal source tree (tracked internally) |
| [0e4e1224ab5b81530ba8f2098c031e1c9e8e8334](https://github.com/meta-models/muse-code-sdk/commit/0e4e1224ab5b81530ba8f2098c031e1c9e8e8334) | docs: publish /next/ from the internal source tree (tracked internally) |
| [5c6b0e4081193baa4dabaf0cef4114112040faf8](https://github.com/meta-models/muse-code-sdk/commit/5c6b0e4081193baa4dabaf0cef4114112040faf8) | docs: publish /next/ from the internal source tree (tracked internally) |
| [8c984f1e4921e655c4ba5daee756c3cdfae7317c](https://github.com/meta-models/muse-code-sdk/commit/8c984f1e4921e655c4ba5daee756c3cdfae7317c) | docs: publish /next/ from the internal source tree (tracked internally) |
| [7c015d26aeed5ff8db685622e16286ea5683dba3](https://github.com/meta-models/muse-code-sdk/commit/7c015d26aeed5ff8db685622e16286ea5683dba3) | docs: publish /next/ from the internal source tree (tracked internally) |
| [077907f8061aefe149dbed91b1652c1439eb2e95](https://github.com/meta-models/muse-code-sdk/commit/077907f8061aefe149dbed91b1652c1439eb2e95) | docs: publish /next/ from the internal source tree (tracked internally) |
| [d2d89a7dc4e7f00723334992f73970ff2cd16364](https://github.com/meta-models/muse-code-sdk/commit/d2d89a7dc4e7f00723334992f73970ff2cd16364) | Create publish-crates.yml |
| [1c2e79db0fa5e58430f5145bb87722b8b6048922](https://github.com/meta-models/muse-code-sdk/commit/1c2e79db0fa5e58430f5145bb87722b8b6048922) | docs: publish /next/ from the internal source tree (tracked internally) |
| [8ced995cf35aaeaf4b21f7f737076acac628d58a](https://github.com/meta-models/muse-code-sdk/commit/8ced995cf35aaeaf4b21f7f737076acac628d58a) | docs: publish /next/ from the internal source tree (tracked internally) |
| [672ab2c545c54b8d449b80b43896933ba6c8d44e](https://github.com/meta-models/muse-code-sdk/commit/672ab2c545c54b8d449b80b43896933ba6c8d44e) | docs: publish /next/ from the internal source tree (tracked internally) |
| [841f1de26b213893e40247990ce49ac03e5b4eed](https://github.com/meta-models/muse-code-sdk/commit/841f1de26b213893e40247990ce49ac03e5b4eed) | docs: publish /next/ from the internal source tree (tracked internally) |
| [22a8a56103c106009f7452c4ef5631e58cb8485c](https://github.com/meta-models/muse-code-sdk/commit/22a8a56103c106009f7452c4ef5631e58cb8485c) | remirror: 1.4.11 from the internal source tree (tracked internally) |
| [8a7db848238fdb576b36aa82200c78cdc9516f87](https://github.com/meta-models/muse-code-sdk/commit/8a7db848238fdb576b36aa82200c78cdc9516f87) | docs: publish /1.4/ from mslsrc/tbh@d654f64987ba0a6f60980e9e89351223c1e4095c |
| [89df25d7b0e765643055632be18de932d76f6ab2](https://github.com/meta-models/muse-code-sdk/commit/89df25d7b0e765643055632be18de932d76f6ab2) | docs: publish /next/ from the internal source tree (tracked internally) |
| [21fd1917d6bc9883bbd1cc8f5697088226bd2a2c](https://github.com/meta-models/muse-code-sdk/commit/21fd1917d6bc9883bbd1cc8f5697088226bd2a2c) | docs: publish /next/ from the internal source tree (tracked internally) |
| [180db2bb2cca223495cecb6f023c01c97bca1ab7](https://github.com/meta-models/muse-code-sdk/commit/180db2bb2cca223495cecb6f023c01c97bca1ab7) | docs: publish /next/ from the internal source tree (tracked internally) |
| [289caec947736ac0219f06d80a1cf3df78e56f91](https://github.com/meta-models/muse-code-sdk/commit/289caec947736ac0219f06d80a1cf3df78e56f91) | docs: publish /next/ from the internal source tree (tracked internally) |
| [cef1d7c7f23b3a186eae4dabfed944d468464208](https://github.com/meta-models/muse-code-sdk/commit/cef1d7c7f23b3a186eae4dabfed944d468464208) | docs: publish /next/ from the internal source tree (tracked internally) |
| [2c590e3f693ddafbaa6b119d6d96ddcf41711a04](https://github.com/meta-models/muse-code-sdk/commit/2c590e3f693ddafbaa6b119d6d96ddcf41711a04) | docs: publish /next/ from the internal source tree (tracked internally) |
| [cf6f11e694dd49238c7ef6948062a981c22c1926](https://github.com/meta-models/muse-code-sdk/commit/cf6f11e694dd49238c7ef6948062a981c22c1926) | docs: publish /next/ from the internal source tree (tracked internally) |
| [4d64c06f3bb7c9291ac7cc7f6aba430140103591](https://github.com/meta-models/muse-code-sdk/commit/4d64c06f3bb7c9291ac7cc7f6aba430140103591) | docs: publish /next/ from the internal source tree (tracked internally) |
| [38ff384f8d1862cf5715813f5dfb6feffd03927c](https://github.com/meta-models/muse-code-sdk/commit/38ff384f8d1862cf5715813f5dfb6feffd03927c) | docs: publish /next/ from the internal source tree (tracked internally) |
| [d5ba5a986b33cdd882f1379fb606c0da5e3e69eb](https://github.com/meta-models/muse-code-sdk/commit/d5ba5a986b33cdd882f1379fb606c0da5e3e69eb) | docs: publish /next/ from the internal source tree (tracked internally) |
| [8b53dbc1692530fdf0b6fb1149786d6b55d28818](https://github.com/meta-models/muse-code-sdk/commit/8b53dbc1692530fdf0b6fb1149786d6b55d28818) | docs: publish /next/ from the internal source tree (tracked internally) |
| [e165aaac4ed254c6166ffa7b0be82dc0625cb750](https://github.com/meta-models/muse-code-sdk/commit/e165aaac4ed254c6166ffa7b0be82dc0625cb750) | docs: publish /next/ from the internal source tree (tracked internally) |
| [4795b0f8117a4ed7b7bffd847d350aa1f96ce5f8](https://github.com/meta-models/muse-code-sdk/commit/4795b0f8117a4ed7b7bffd847d350aa1f96ce5f8) | docs: publish /next/ from the internal source tree (tracked internally) |
| [7e594ab1b2c95d938bb37dd8b9e0c367e86a0b71](https://github.com/meta-models/muse-code-sdk/commit/7e594ab1b2c95d938bb37dd8b9e0c367e86a0b71) | docs: publish /next/ from the internal source tree (tracked internally) |
| [e5fe32bc0fa61256df7c4b50ef975207656c66ed](https://github.com/meta-models/muse-code-sdk/commit/e5fe32bc0fa61256df7c4b50ef975207656c66ed) | docs: publish /next/ from the internal source tree (tracked internally) |
| [14cac747f5bc07739822c46bcc5e7d2310b54902](https://github.com/meta-models/muse-code-sdk/commit/14cac747f5bc07739822c46bcc5e7d2310b54902) | docs: publish /next/ from the internal source tree (tracked internally) |
| [47335f308f312e96289947836e5e8a393872ab65](https://github.com/meta-models/muse-code-sdk/commit/47335f308f312e96289947836e5e8a393872ab65) | docs: publish /next/ from the internal source tree (tracked internally) |
| [e4c42a74254ac71c000be989ce4cf86c607c5d37](https://github.com/meta-models/muse-code-sdk/commit/e4c42a74254ac71c000be989ce4cf86c607c5d37) | README: fix the quickstart link |
| [6021725108f9fe2b7259d979431d001153fc9080](https://github.com/meta-models/muse-code-sdk/commit/6021725108f9fe2b7259d979431d001153fc9080) | Merge pull request #114 from meta-models/fix-quickstart-link |
| [502c96ce6dcbcdcd8729e8e6abb04af65da47ebc](https://github.com/meta-models/muse-code-sdk/commit/502c96ce6dcbcdcd8729e8e6abb04af65da47ebc) | docs: publish /next/ from the internal source tree (tracked internally) |
| [83c65818daaafb8e03d64fba3578f3bb1ad2c4b9](https://github.com/meta-models/muse-code-sdk/commit/83c65818daaafb8e03d64fba3578f3bb1ad2c4b9) | docs: publish /next/ from the internal source tree (tracked internally) |
| [86bcbac2f06c349e9e0b9fb522e728e1064cd6cd](https://github.com/meta-models/muse-code-sdk/commit/86bcbac2f06c349e9e0b9fb522e728e1064cd6cd) | docs: publish /next/ from the internal source tree (tracked internally) |
| [ff06388010a1952619de9ff73ec26d8d1d587d85](https://github.com/meta-models/muse-code-sdk/commit/ff06388010a1952619de9ff73ec26d8d1d587d85) | docs: publish /next/ from the internal source tree (tracked internally) |
| [ccb2fb3a92cad65ec67f523e5902be716a59d4dc](https://github.com/meta-models/muse-code-sdk/commit/ccb2fb3a92cad65ec67f523e5902be716a59d4dc) | docs: publish /next/ from the internal source tree (tracked internally) |
| [15db33766f8274204fa0145a1bd79f408723b648](https://github.com/meta-models/muse-code-sdk/commit/15db33766f8274204fa0145a1bd79f408723b648) | docs: publish /next/ from the internal source tree (tracked internally) |
| [65cba886819445d2b2deb0db4441908bd2be7a0c](https://github.com/meta-models/muse-code-sdk/commit/65cba886819445d2b2deb0db4441908bd2be7a0c) | docs: publish /next/ from the internal source tree (tracked internally) |
| [09d67eca616b7b02a2d060271123c1fedbdb8fb7](https://github.com/meta-models/muse-code-sdk/commit/09d67eca616b7b02a2d060271123c1fedbdb8fb7) | remirror: 1.4.12 from the internal source tree (tracked internally) |
| [8277307b1c4f0bafdbbfb976d5b6dd6f9c4cc24f](https://github.com/meta-models/muse-code-sdk/commit/8277307b1c4f0bafdbbfb976d5b6dd6f9c4cc24f) | docs: publish /1.4/ from mslsrc/tbh@80d5266d8a4cb84d6d4ec595a4ef39cc596fa128 |
| [65e2a8dc735c128e13e3829f5917352201cf7c9e](https://github.com/meta-models/muse-code-sdk/commit/65e2a8dc735c128e13e3829f5917352201cf7c9e) | docs: publish /next/ from the internal source tree (tracked internally) |
| [3918cc8a7041aa9880a61130137048f1274af07a](https://github.com/meta-models/muse-code-sdk/commit/3918cc8a7041aa9880a61130137048f1274af07a) | docs: publish /next/ from the internal source tree (tracked internally) |
| [1cfb366b088cb9eb6e124b7a1e0ff3b9b14df914](https://github.com/meta-models/muse-code-sdk/commit/1cfb366b088cb9eb6e124b7a1e0ff3b9b14df914) | docs: publish /next/ from the internal source tree (tracked internally) |
| [03b89304c1020796a50db499b884afa9ba149374](https://github.com/meta-models/muse-code-sdk/commit/03b89304c1020796a50db499b884afa9ba149374) | docs: publish /next/ from the internal source tree (tracked internally) |
| [28ad49af0a9915f43397a1ee2bd717efb3435011](https://github.com/meta-models/muse-code-sdk/commit/28ad49af0a9915f43397a1ee2bd717efb3435011) | docs: publish /next/ from the internal source tree (tracked internally) |
| [fa17d430e042db5576bc698548b2244f1c387f80](https://github.com/meta-models/muse-code-sdk/commit/fa17d430e042db5576bc698548b2244f1c387f80) | docs: publish /next/ from the internal source tree (tracked internally) |
| [e5e27534a39c88ac0111b7a096f2a72c1fadbe11](https://github.com/meta-models/muse-code-sdk/commit/e5e27534a39c88ac0111b7a096f2a72c1fadbe11) | docs: publish /next/ from the internal source tree (tracked internally) |
| [b75a57d559c5dbc0398cd2dae05a17dc4972140b](https://github.com/meta-models/muse-code-sdk/commit/b75a57d559c5dbc0398cd2dae05a17dc4972140b) | docs: publish /next/ from the internal source tree (tracked internally) |
| [b1be968f369d85113dc90e5e992999ae8e698370](https://github.com/meta-models/muse-code-sdk/commit/b1be968f369d85113dc90e5e992999ae8e698370) | docs: publish /next/ from the internal source tree (tracked internally) |
| [911eba878e705e548eaf536a3b74541abe0170c8](https://github.com/meta-models/muse-code-sdk/commit/911eba878e705e548eaf536a3b74541abe0170c8) | docs: publish /next/ from the internal source tree (tracked internally) |
| [3dce908f556bd8b3dfc9cd7f28f442b0504d74a4](https://github.com/meta-models/muse-code-sdk/commit/3dce908f556bd8b3dfc9cd7f28f442b0504d74a4) | remirror: 1.4.13 from the internal source tree (tracked internally) |
| [6d60e724a53a74da8456add21a848aaea0df5a01](https://github.com/meta-models/muse-code-sdk/commit/6d60e724a53a74da8456add21a848aaea0df5a01) | docs: publish /1.4/ from mslsrc/tbh@39490bd065c800195489caec34473582f7650b54 |
| [6c234e38778a836b86b72aba0c87f83996d9b397](https://github.com/meta-models/muse-code-sdk/commit/6c234e38778a836b86b72aba0c87f83996d9b397) | docs: publish /next/ from the internal source tree (tracked internally) |
| [948ffd406850c52306b776a504e7a893323b10c1](https://github.com/meta-models/muse-code-sdk/commit/948ffd406850c52306b776a504e7a893323b10c1) | Bump setuptools from 84.0.0 to 84.1.0 in /python/clients |
| [3db06050a36d3314093ee5646d1be3c68bc78a48](https://github.com/meta-models/muse-code-sdk/commit/3db06050a36d3314093ee5646d1be3c68bc78a48) | docs: publish /next/ from the internal source tree (tracked internally) |
| [6c480170294136b0eac96706b05d1d742829b7ac](https://github.com/meta-models/muse-code-sdk/commit/6c480170294136b0eac96706b05d1d742829b7ac) | docs: publish /next/ from the internal source tree (tracked internally) |
| [0f1179f62136d447234f80c552e63ac9bf8a4bae](https://github.com/meta-models/muse-code-sdk/commit/0f1179f62136d447234f80c552e63ac9bf8a4bae) | docs: publish /next/ from the internal source tree (tracked internally) |
| [0d67c402e70a4fe53a54bedf8bc8d48fed689875](https://github.com/meta-models/muse-code-sdk/commit/0d67c402e70a4fe53a54bedf8bc8d48fed689875) | docs: publish /next/ from the internal source tree (tracked internally) |
| [312d32e8a92d0de927e6d7d547c55e4cd1b86d4e](https://github.com/meta-models/muse-code-sdk/commit/312d32e8a92d0de927e6d7d547c55e4cd1b86d4e) | docs: publish /next/ from the internal source tree (tracked internally) |
| [6af50952b4b27e92b6857a5004b6079ea350f494](https://github.com/meta-models/muse-code-sdk/commit/6af50952b4b27e92b6857a5004b6079ea350f494) | docs: publish /next/ from the internal source tree (tracked internally) |
| [5fa6fc80e0d8350ac12788982e79bde634c1b0ad](https://github.com/meta-models/muse-code-sdk/commit/5fa6fc80e0d8350ac12788982e79bde634c1b0ad) | docs: publish /next/ from the internal source tree (tracked internally) |
| [4bdac3eb85423f15a9340a108ccb92fc198f5720](https://github.com/meta-models/muse-code-sdk/commit/4bdac3eb85423f15a9340a108ccb92fc198f5720) | docs: publish /next/ from the internal source tree (tracked internally) |
| [7fcab900f6e96af42c6bb46a2da9381eaecfe8fe](https://github.com/meta-models/muse-code-sdk/commit/7fcab900f6e96af42c6bb46a2da9381eaecfe8fe) | docs: publish /next/ from the internal source tree (tracked internally) |
| [b44e008210473d1488157b9a11b915a5ee490240](https://github.com/meta-models/muse-code-sdk/commit/b44e008210473d1488157b9a11b915a5ee490240) | docs: publish /next/ from the internal source tree (tracked internally) |
| [d227782b0954b1c45f74420b69a660f675af3a5b](https://github.com/meta-models/muse-code-sdk/commit/d227782b0954b1c45f74420b69a660f675af3a5b) | docs: publish /next/ from the internal source tree (tracked internally) |
| [d62abd0ed78dbb6c7ee6de32150fa9ed787c1162](https://github.com/meta-models/muse-code-sdk/commit/d62abd0ed78dbb6c7ee6de32150fa9ed787c1162) | docs: publish /next/ from the internal source tree (tracked internally) |
| [b7757b60800cd6bb675f9d4d2637977f544c8d1f](https://github.com/meta-models/muse-code-sdk/commit/b7757b60800cd6bb675f9d4d2637977f544c8d1f) | docs: publish /next/ from the internal source tree (tracked internally) |
| [bd0bad3638ee52e686927266a688e5b761838165](https://github.com/meta-models/muse-code-sdk/commit/bd0bad3638ee52e686927266a688e5b761838165) | docs: publish /next/ from the internal source tree (tracked internally) |
| [2c65c0311f32ea0b6d2d9239ae5c0129e1e9cf87](https://github.com/meta-models/muse-code-sdk/commit/2c65c0311f32ea0b6d2d9239ae5c0129e1e9cf87) | docs: publish /next/ from the internal source tree (tracked internally) |
| [8410e8e89e432344ccab4a760f9b031b7d5b7e38](https://github.com/meta-models/muse-code-sdk/commit/8410e8e89e432344ccab4a760f9b031b7d5b7e38) | docs: publish /next/ from the internal source tree (tracked internally) |
| [a78b6c707138faf3a48bc458a272660b32fe420b](https://github.com/meta-models/muse-code-sdk/commit/a78b6c707138faf3a48bc458a272660b32fe420b) | docs: publish /next/ from the internal source tree (tracked internally) |
| [71c290b4c6e08b415856bf9126e11df30d887537](https://github.com/meta-models/muse-code-sdk/commit/71c290b4c6e08b415856bf9126e11df30d887537) | docs: publish /next/ from the internal source tree (tracked internally) |
| [f32df659a83e7367ad72e536ad88f7151737c6c9](https://github.com/meta-models/muse-code-sdk/commit/f32df659a83e7367ad72e536ad88f7151737c6c9) | docs: publish /next/ from the internal source tree (tracked internally) |
| [859132f62aeda1f4d7c9a5e981b30e432306d3b1](https://github.com/meta-models/muse-code-sdk/commit/859132f62aeda1f4d7c9a5e981b30e432306d3b1) | docs: publish /next/ from the internal source tree (tracked internally) |
| [a45cb67cd2e27c8b6b4b55dcbaae6e6341123ea4](https://github.com/meta-models/muse-code-sdk/commit/a45cb67cd2e27c8b6b4b55dcbaae6e6341123ea4) | remirror: 1.4.14 from the internal source tree (tracked internally) |
| [0576e278e45d7986d467486869813cbe223d4ab5](https://github.com/meta-models/muse-code-sdk/commit/0576e278e45d7986d467486869813cbe223d4ab5) | docs: publish /1.4/ from mslsrc/tbh@dec7d7497fecdad135ec5835a8161dbc92e55b58 |

#### legal-agent-workshop: branch inventory

| Branch | Pinned head |
|---|---|
| automated_fixup_code_of_conduct_file_exists | [56f0ab93a9b560ccb5ae4fe2b33f4e7e3e063962](https://github.com/meta-models/legal-agent-workshop/tree/56f0ab93a9b560ccb5ae4fe2b33f4e7e3e063962) |
| automated_fixup_contributing_file_exists | [85fb4326302c9c4c38ff96bc7d2939b5c7e12b9e](https://github.com/meta-models/legal-agent-workshop/tree/85fb4326302c9c4c38ff96bc7d2939b5c7e12b9e) |
| main | [2a8efc86c70d9a42d76db0afb6ae1511e5a86d8e](https://github.com/meta-models/legal-agent-workshop/tree/2a8efc86c70d9a42d76db0afb6ae1511e5a86d8e) |

#### legal-agent-workshop: issue and PR inventory

States below are the API collection state at retrieval, not an assessment that an issue is resolved or a PR is merged. Closed PRs may be unmerged. Comments/reviews and patches were not exhaustively reviewed.

| Item | Type | State | Title |
|---|---|---|---|
| [#4](https://github.com/meta-models/legal-agent-workshop/issues/4) | Issue | open | Idea: a learning loop that carries across cases |
| [#3](https://github.com/meta-models/legal-agent-workshop/pull/3) | PR | closed | Add workshop details for Cerebral Valley Live Session |
| [#2](https://github.com/meta-models/legal-agent-workshop/pull/2) | PR | open | Adding Code of Conduct file |
| [#1](https://github.com/meta-models/legal-agent-workshop/pull/1) | PR | open | Adding Contributing file |

#### legal-agent-workshop: reachable commit inventory

Commit subjects below are metadata. They do not establish that the described behavior exists in the pinned main tree. All commits are listed once per repository, including commits reachable only from non-main branches.

| Commit | Subject |
|---|---|
| [2a8efc86c70d9a42d76db0afb6ae1511e5a86d8e](https://github.com/meta-models/legal-agent-workshop/commit/2a8efc86c70d9a42d76db0afb6ae1511e5a86d8e) | Legal agent workshop |
| [85fb4326302c9c4c38ff96bc7d2939b5c7e12b9e](https://github.com/meta-models/legal-agent-workshop/commit/85fb4326302c9c4c38ff96bc7d2939b5c7e12b9e) | OSS Automated Fix: Addition of Contributing |
| [56f0ab93a9b560ccb5ae4fe2b33f4e7e3e063962](https://github.com/meta-models/legal-agent-workshop/commit/56f0ab93a9b560ccb5ae4fe2b33f4e7e3e063962) | OSS Automated Fix: Addition of Code of Conduct |

#### meta-sam: branch inventory

| Branch | Pinned head |
|---|---|
| dependabot/npm_and_yarn/typescript/examples/api-playground/multi-063a5f277b | [c46a4470e8cb6cc5c4424efd357a8fff0dd1d624](https://github.com/meta-models/meta-sam/tree/c46a4470e8cb6cc5c4424efd357a8fff0dd1d624) |
| dependabot/npm_and_yarn/typescript/examples/api-playground/source-map-js-1.2.2 | [7e80d6889f614f623040c9cb798a6eec36fe9236](https://github.com/meta-models/meta-sam/tree/7e80d6889f614f623040c9cb798a6eec36fe9236) |
| dependabot/npm_and_yarn/typescript/examples/api-playground/vite-8.3.5 | [bb48b860b300203962a2694326c0652782439cf9](https://github.com/meta-models/meta-sam/tree/bb48b860b300203962a2694326c0652782439cf9) |
| dependabot/npm_and_yarn/typescript/launch-editor-2.14.2 | [48392fccce4086c8a318f64fca03f948f91b010e](https://github.com/meta-models/meta-sam/tree/48392fccce4086c8a318f64fca03f948f91b010e) |
| dependabot/npm_and_yarn/typescript/shell-quote-1.12.0 | [2c2100db7fe1d9a36cc7d658a2130357316dc24f](https://github.com/meta-models/meta-sam/tree/2c2100db7fe1d9a36cc7d658a2130357316dc24f) |
| dependabot/npm_and_yarn/typescript/vite-8.3.4 | [5386ccbe2476593d390169700f5ebd492c758d8d](https://github.com/meta-models/meta-sam/tree/5386ccbe2476593d390169700f5ebd492c758d8d) |
| main | [40318970a81301f31e97cdd7d605117293332b0f](https://github.com/meta-models/meta-sam/tree/40318970a81301f31e97cdd7d605117293332b0f) |
| raedle/fix-video-frame-index-preroll | [f4b448e757b92e7d3423200e8867bd4bb4edf6d1](https://github.com/meta-models/meta-sam/tree/f4b448e757b92e7d3423200e8867bd4bb4edf6d1) |
| raedle/improve-playground-onboarding | [387f099efab6e2b3636dacd34227606753cd91bf](https://github.com/meta-models/meta-sam/tree/387f099efab6e2b3636dacd34227606753cd91bf) |
| raedle/playground-confidence-labels | [56f70cd9de137ff1dee481a8a37b9a815d122025](https://github.com/meta-models/meta-sam/tree/56f70cd9de137ff1dee481a8a37b9a815d122025) |
| raedle/playground-score-threshold | [56ead6fb9c2e5f9ebefc4f634c3c26b90eb13e31](https://github.com/meta-models/meta-sam/tree/56ead6fb9c2e5f9ebefc4f634c3c26b90eb13e31) |
| raedle/rebuild-api-playground-vite | [9a1532d7537a9a2f38e45d075af2e36e1c2f1a60](https://github.com/meta-models/meta-sam/tree/9a1532d7537a9a2f38e45d075af2e36e1c2f1a60) |
| raedle/sam-box-labels | [7131f4d0e103a64885533abb409a7ee47bd21bf1](https://github.com/meta-models/meta-sam/tree/7131f4d0e103a64885533abb409a7ee47bd21bf1) |
| raedle/sam-parser-confidence | [35618d37113183e971b1923f6608b71a66437b65](https://github.com/meta-models/meta-sam/tree/35618d37113183e971b1923f6608b71a66437b65) |

#### meta-sam: issue and PR inventory

States below are the API collection state at retrieval, not an assessment that an issue is resolved or a PR is merged. Closed PRs may be unmerged. Comments/reviews and patches were not exhaustively reviewed.

| Item | Type | State | Title |
|---|---|---|---|
| [#30](https://github.com/meta-models/meta-sam/pull/30) | PR | open | Bump launch-editor from 2.14.1 to 2.14.2 in /typescript |
| [#29](https://github.com/meta-models/meta-sam/pull/29) | PR | open | Bump @vitest/mocker and vitest in /typescript/examples/api-playground |
| [#28](https://github.com/meta-models/meta-sam/pull/28) | PR | open | Bump vite from 8.3.0 to 8.3.5 in /typescript/examples/api-playground |
| [#27](https://github.com/meta-models/meta-sam/pull/27) | PR | open | Bump vite from 8.3.0 to 8.3.4 in /typescript |
| [#26](https://github.com/meta-models/meta-sam/pull/26) | PR | closed | chore: version packages |
| [#25](https://github.com/meta-models/meta-sam/pull/25) | PR | closed | Let the renderer take custom object colors |
| [#24](https://github.com/meta-models/meta-sam/pull/24) | PR | closed | Update the conformance case counts in the READMEs |
| [#23](https://github.com/meta-models/meta-sam/pull/23) | PR | closed | chore: version packages |
| [#22](https://github.com/meta-models/meta-sam/pull/22) | PR | open | Bump shell-quote from 1.10.0 to 1.12.0 in /typescript |
| [#21](https://github.com/meta-models/meta-sam/pull/21) | PR | open | Bump source-map-js from 1.2.1 to 1.2.2 in /typescript/examples/api-playground |
| [#20](https://github.com/meta-models/meta-sam/pull/20) | PR | closed | Choose the tracking direction in the API playground |
| [#19](https://github.com/meta-models/meta-sam/pull/19) | PR | closed | Prompt the API playground with boxes and points |
| [#18](https://github.com/meta-models/meta-sam/pull/18) | PR | closed | Build object-prompt text in TypeScript and Python |
| [#17](https://github.com/meta-models/meta-sam/pull/17) | PR | closed | Document box and point prompts in the protocol |
| [#16](https://github.com/meta-models/meta-sam/pull/16) | PR | closed | Document out-of-order frames and per-frame confidence |
| [#14](https://github.com/meta-models/meta-sam/pull/14) | PR | closed | Document how to request confidence |
| [#13](https://github.com/meta-models/meta-sam/pull/13) | PR | closed | Ask for confidence from the API playground |
| [#12](https://github.com/meta-models/meta-sam/pull/12) | PR | closed | chore: version packages |
| [#11](https://github.com/meta-models/meta-sam/pull/11) | PR | closed | chore: version packages |
| [#9](https://github.com/meta-models/meta-sam/pull/9) | PR | closed | Add an image score threshold to the API playground |
| [#8](https://github.com/meta-models/meta-sam/pull/8) | PR | closed | Show confidence and box labels in the API playground |
| [#7](https://github.com/meta-models/meta-sam/pull/7) | PR | closed | Draw box labels with the noun phrase, object ID, and confidence |
| [#6](https://github.com/meta-models/meta-sam/pull/6) | PR | closed | Parse SAM API records tolerantly and expose optional confidence |
| [#4](https://github.com/meta-models/meta-sam/pull/4) | PR | closed | Simplify API playground setup |
| [#3](https://github.com/meta-models/meta-sam/pull/3) | PR | closed | Rebuild the API playground with Vite and TypeScript |
| [#2](https://github.com/meta-models/meta-sam/pull/2) | PR | closed | chore: version packages |
| [#1](https://github.com/meta-models/meta-sam/pull/1) | PR | closed | Fix video frame indexes for decode preroll |

#### meta-sam: reachable commit inventory

Commit subjects below are metadata. They do not establish that the described behavior exists in the pinned main tree. All commits are listed once per repository, including commits reachable only from non-main branches.

| Commit | Subject |
|---|---|
| [0cd91a1ea1eb943282d6dc34f579a56c9ea0ed69](https://github.com/meta-models/meta-sam/commit/0cd91a1ea1eb943282d6dc34f579a56c9ea0ed69) | Initial public release of meta-sam |
| [f4b448e757b92e7d3423200e8867bd4bb4edf6d1](https://github.com/meta-models/meta-sam/commit/f4b448e757b92e7d3423200e8867bd4bb4edf6d1) | Fix video frame indexes for decode preroll |
| [97c6bc51e99f813fa7e66e24aaa41d64f2205bc6](https://github.com/meta-models/meta-sam/commit/97c6bc51e99f813fa7e66e24aaa41d64f2205bc6) | Fix video frame indexes for decode preroll (#1) |
| [885ba29508c0a27c79bd62c8474b6c20e3505667](https://github.com/meta-models/meta-sam/commit/885ba29508c0a27c79bd62c8474b6c20e3505667) | chore: version packages (#2) |
| [9a1532d7537a9a2f38e45d075af2e36e1c2f1a60](https://github.com/meta-models/meta-sam/commit/9a1532d7537a9a2f38e45d075af2e36e1c2f1a60) | Rebuild the API playground with Vite and TypeScript |
| [387f099efab6e2b3636dacd34227606753cd91bf](https://github.com/meta-models/meta-sam/commit/387f099efab6e2b3636dacd34227606753cd91bf) | Simplify API playground setup |
| [88cbc57bbf1f80e587608b015862443ab4c4fd01](https://github.com/meta-models/meta-sam/commit/88cbc57bbf1f80e587608b015862443ab4c4fd01) | Rebuild the API playground with Vite and TypeScript (#3) |
| [f2560ec8b40d40bb779865620619ac54b1868f1e](https://github.com/meta-models/meta-sam/commit/f2560ec8b40d40bb779865620619ac54b1868f1e) | Simplify API playground setup (#4) |
| [35618d37113183e971b1923f6608b71a66437b65](https://github.com/meta-models/meta-sam/commit/35618d37113183e971b1923f6608b71a66437b65) | Parse SAM API records tolerantly and expose optional confidence |
| [56f70cd9de137ff1dee481a8a37b9a815d122025](https://github.com/meta-models/meta-sam/commit/56f70cd9de137ff1dee481a8a37b9a815d122025) | Show confidence and box labels in the API playground |
| [7131f4d0e103a64885533abb409a7ee47bd21bf1](https://github.com/meta-models/meta-sam/commit/7131f4d0e103a64885533abb409a7ee47bd21bf1) | Draw box labels with the noun phrase, object ID, and confidence |
| [56ead6fb9c2e5f9ebefc4f634c3c26b90eb13e31](https://github.com/meta-models/meta-sam/commit/56ead6fb9c2e5f9ebefc4f634c3c26b90eb13e31) | Add an image score threshold to the API playground |
| [e8c74a3e3fb63673ee710a89e9a2eeb512d98e55](https://github.com/meta-models/meta-sam/commit/e8c74a3e3fb63673ee710a89e9a2eeb512d98e55) | Parse SAM API records tolerantly and expose optional confidence (#6) |
| [dfa691409de81e54504576a3388f335da6802101](https://github.com/meta-models/meta-sam/commit/dfa691409de81e54504576a3388f335da6802101) | chore: version packages (#11) |
| [479fe51bcef834d22ff5bf0f7d7ae7316ee30d53](https://github.com/meta-models/meta-sam/commit/479fe51bcef834d22ff5bf0f7d7ae7316ee30d53) | Draw box labels with the noun phrase, object ID, and confidence (#7) |
| [972e97cf6c627f2a637e5df2bebf387cccc01cff](https://github.com/meta-models/meta-sam/commit/972e97cf6c627f2a637e5df2bebf387cccc01cff) | chore: version packages (#12) |
| [2629597fcead1ed14c0df5ab7a4a691b508d5d8a](https://github.com/meta-models/meta-sam/commit/2629597fcead1ed14c0df5ab7a4a691b508d5d8a) | Add an image score threshold to the API playground (#9) |
| [4e4055a7a5121dd5a89bc002950bd7cd5c63c4fc](https://github.com/meta-models/meta-sam/commit/4e4055a7a5121dd5a89bc002950bd7cd5c63c4fc) | Show confidence and box labels in the API playground (#8) |
| [38473ccc2fc47f83f4d56326e0afe927b817b162](https://github.com/meta-models/meta-sam/commit/38473ccc2fc47f83f4d56326e0afe927b817b162) | Ask for confidence from the API playground (#13) |
| [9cce2987edefb882001b57f135872e889a694bbc](https://github.com/meta-models/meta-sam/commit/9cce2987edefb882001b57f135872e889a694bbc) | Document how to request confidence (#14) |
| [6094372c98c856c081ea67456dbb1560dcf953ab](https://github.com/meta-models/meta-sam/commit/6094372c98c856c081ea67456dbb1560dcf953ab) | Document out-of-order frames and per-frame confidence (#16) |
| [6bfaa17337c4973332172620087ecc5bf9b2b683](https://github.com/meta-models/meta-sam/commit/6bfaa17337c4973332172620087ecc5bf9b2b683) | Document box and point prompts in the protocol (#17) |
| [07b7fdbaa4fad4d338ec20794a3c9dd0cc69c8b7](https://github.com/meta-models/meta-sam/commit/07b7fdbaa4fad4d338ec20794a3c9dd0cc69c8b7) | Build object-prompt text in TypeScript and Python (#18) |
| [8103d68d18eac0d9ade419630a8deca8f48b02ed](https://github.com/meta-models/meta-sam/commit/8103d68d18eac0d9ade419630a8deca8f48b02ed) | Prompt the API playground with boxes and points (#19) |
| [8cfec6a1e906f95ad39a639d825edd08c78f86ef](https://github.com/meta-models/meta-sam/commit/8cfec6a1e906f95ad39a639d825edd08c78f86ef) | Choose the tracking direction in the API playground (#20) |
| [7e80d6889f614f623040c9cb798a6eec36fe9236](https://github.com/meta-models/meta-sam/commit/7e80d6889f614f623040c9cb798a6eec36fe9236) | Bump source-map-js in /typescript/examples/api-playground |
| [2c2100db7fe1d9a36cc7d658a2130357316dc24f](https://github.com/meta-models/meta-sam/commit/2c2100db7fe1d9a36cc7d658a2130357316dc24f) | Bump shell-quote from 1.10.0 to 1.12.0 in /typescript |
| [cdf2e8b5625a3471e6dab3be7127b80fa83beb0d](https://github.com/meta-models/meta-sam/commit/cdf2e8b5625a3471e6dab3be7127b80fa83beb0d) | chore: version packages (#23) |
| [45ffffa8eb2e11f2d3773d95a0129dc77bd8ee5c](https://github.com/meta-models/meta-sam/commit/45ffffa8eb2e11f2d3773d95a0129dc77bd8ee5c) | Update the conformance case counts in the READMEs (#24) |
| [5dbc7b01ee7c3a9c2aef659a46766243df49ab8f](https://github.com/meta-models/meta-sam/commit/5dbc7b01ee7c3a9c2aef659a46766243df49ab8f) | Let the renderer take custom object colors (#25) |
| [40318970a81301f31e97cdd7d605117293332b0f](https://github.com/meta-models/meta-sam/commit/40318970a81301f31e97cdd7d605117293332b0f) | chore: version packages (#26) |
| [5386ccbe2476593d390169700f5ebd492c758d8d](https://github.com/meta-models/meta-sam/commit/5386ccbe2476593d390169700f5ebd492c758d8d) | Bump vite from 8.3.0 to 8.3.4 in /typescript |
| [bb48b860b300203962a2694326c0652782439cf9](https://github.com/meta-models/meta-sam/commit/bb48b860b300203962a2694326c0652782439cf9) | Bump vite from 8.3.0 to 8.3.5 in /typescript/examples/api-playground |
| [c46a4470e8cb6cc5c4424efd357a8fff0dd1d624](https://github.com/meta-models/meta-sam/commit/c46a4470e8cb6cc5c4424efd357a8fff0dd1d624) | Bump @vitest/mocker and vitest in /typescript/examples/api-playground |
| [48392fccce4086c8a318f64fca03f948f91b010e](https://github.com/meta-models/meta-sam/commit/48392fccce4086c8a318f64fca03f948f91b010e) | Bump launch-editor from 2.14.1 to 2.14.2 in /typescript |

### Remaining audit scope

To claim the user's requested exhaustive review, a future review would still need to inspect the full unsealed file content at each relevant branch, all 557 commit patches, all 164 PR patches and review threads, and all remaining issue discussions, with explicit exclusions for sealed or withheld material. The ledger is not a substitute for that work. Do not label this artifact “all branches and all commits fully reviewed.” No conclusion here guarantees that every unused Meta capability was found.

Paid execution and sealed holdout access remain BLOCKED.

## Continuation review — 2026-10-27

**Status: incomplete; not exhaustive.** This continuation closes the returned discussion-comment coverage and expands the source/patch survey. It does not close the requested full branch-file and commit/PR-diff review. The distinction below supersedes the earlier “selected issue discussions” coverage description. The original G1–G6 instructions, rankings and safety blocks remain in force.

### Completed discussion reading and expanded retrieval

I read the bodies of all 168 issue/PR conversation comments returned by the repository-wide REST comment collections, all 25 returned inline PR comments, and all 67 returned submitted review records (including records with empty review bodies). The SDK conversation collection required two pages: 100 then 26; the other collections ended below 100. I also checked the submitted-review endpoint for each of the 164 inventoried PRs; no review endpoint required a second page.

This does not include linked attachments, externally hosted logs, videos, private references, deleted comments, or information added after collection. The complete issue/PR opening-body review remains unfinished; the earlier opening-body collection is not a claim that every body received substantive review.

I retrieved untruncated recursive tree listings for the 104 pinned branch heads across the four repositories outside legal-agent-workshop. Those trees contain 6,918 distinct blob identities within their respective repositories, totaling 600,796,295 bytes. Of those, 5,398 match a broad text/source-extension filter, totaling 455,278,686 bytes. These are candidates, not 5,398 reviewed source files. Generated HTML/documentation, lockfiles, fixtures and media contribute heavily. Duplicate blob identities were counted once per repository; no file content was hashed to obtain those identities.

I retrieved all changed-file pages for the 161 inventoried PRs outside legal-agent-workshop: 1,915 file entries. A file entry can lack a patch, and retrieving it is not a complete diff review. There were seven additional pages after the initial pages.

I retrieved first-page commit details for all 554 inventoried commits outside legal-agent-workshop: 19,478 file entries. I then completed file pagination for non-documentation-publish commits requiring additional pages: 28 more pages and 1,655 additional entries. **106 SDK documentation-publish histories still have additional file pages pending.** Patch omissions, binary changes and full source review remain separate gaps. No inference or upstream build/test command was executed.

| Repository | Pinned branch tree listings retrieved | Distinct listed blobs | Conversation comments read | Inline comments read | Submitted reviews read | PR changed-file entries retrieved | Commit details first pages retrieved |
|---|---:|---:|---:|---:|---:|---:|---:|
| meta-model-cookbook | 32 | 851 | 19 | 5 | 27 | 601 | 106 |
| meta-oss-cookbook | 43 | 372 | 23 | 14 | 34 | 609 | 160 |
| muse-code-sdk | 15 | 5207 | 126 | 6 | 6 | 438 | 253 |
| legal-agent-workshop | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| meta-sam | 14 | 488 | 0 | 0 | 0 | 267 | 35 |

The workshop's generic source files discussed in the earlier audit remain reviewed, but its broad branch trees and history/PR patches were deliberately not fetched because those operations could return withheld case/truth/solution content. This is an explicit safety exclusion, not a completed review or a request to remove the sealed-data block.

### Corrections from the completed discussion pass

- **SDK staged approval bug #10 has a stated shipped fix.** The [maintainer closure](https://github.com/meta-models/muse-code-sdk/issues/10#issuecomment-5941525138) identifies @muse-code/sdk 1.3.0. The [detailed update](https://github.com/meta-models/muse-code-sdk/issues/10#issuecomment-5943595608) explains refreshed requirement handling and per-stage deduplication. This historical report should motivate regression coverage, not a claim that the pinned current SDK lacks all staged-approval handling.
- **SDK model pin #7 and reasoning forwarding #6 also have stated fixes.** The [model-pin closure](https://github.com/meta-models/muse-code-sdk/issues/7#issuecomment-5941523224) names host 1.3.0-R3401.1. The [reasoning update](https://github.com/meta-models/muse-code-sdk/issues/6#issuecomment-5943588851) describes per-turn/session forwarding in 1.2.1 while identifying a separately tracked serve settings-default arm. Do not collapse distinct settings paths into one “fixed” or “broken” label. None of these claims was independently rerun here.
- **An open issue does not necessarily mean all original symptoms remain.** The [SDK #11 follow-up](https://github.com/meta-models/muse-code-sdk/issues/11#issuecomment-6394869840) reports most populated-history startup cost gone in 1.4.12, with a higher empty-history baseline. The [#97 follow-up](https://github.com/meta-models/muse-code-sdk/issues/97#issuecomment-6394869577) reports earlier-turn boundaries accepted on macOS 1.4.12. These are reporter measurements, not new Second Seat tests.
- **Approval readiness must be tested behaviorally.** The [#56 retest](https://github.com/meta-models/muse-code-sdk/issues/56#issuecomment-5999607360) corrects an original echo-based inference: an allowlisted read-only command need not ask. It reports real staged decisions and stale-requirement rejection on 1.4.2. “No card appeared for echo” is not evidence of an approval bypass.
- **Windows readiness and enforcement are separate observations.** [SDK #107's standalone report](https://github.com/meta-models/muse-code-sdk/issues/107#issuecomment-6431350435) distinguishes a ready status from serve initialization reporting unavailable. The [workaround comparison](https://github.com/meta-models/muse-code-sdk/issues/107#issuecomment-6431772111) explicitly disables the sandbox and says that does not fix enforcement. Do not adopt that workaround for the protected verification workflow. These remain public reports, not a test of this user's host.
- **Unknown outcome must not become “nothing happened.”** The [#94 discussion](https://github.com/meta-models/muse-code-sdk/issues/94#issuecomment-6018772208) describes a decision error despite an applied action in one build. This strengthens rank 5's receipt semantics. Do not copy the comment's retry workaround into Second Seat without its own idempotency and revocation proof.
- **Doc schemas, stable host support and feature requests differ.** The [#49 discussion](https://github.com/meta-models/muse-code-sdk/issues/49#issuecomment-5984184305) contrasts next-doc hook types with a tested host's generated schema. A symbol in next docs or an “internally tracked” reply is insufficient evidence of a supported runtime capability.
- **An upstream approval is not an independent behavioral result.** Several submitted reviews contain only approval shorthand. The substantive [OSS #5 review](https://github.com/meta-models/meta-oss-cookbook/pull/5#pullrequestreview-4898836148) initially endorsed an incorrect relative-path rationale; its [later correction](https://github.com/meta-models/meta-oss-cookbook/pull/5#issuecomment-5243510443) retracts it. The [OSS #16 merge correction](https://github.com/meta-models/meta-oss-cookbook/pull/16#issuecomment-5247279062) also retracts a supposedly clean merge based on an inadequate probe. Keep the G5 requirement for a decisive assertion rather than trusting approval state, grep output or a syntax check.

### Additional source and patch findings

**1. The current SDK provides a useful offline race-test pattern; it is not an excuse to migrate.**

I read the complete pinned [approval router](https://github.com/meta-models/muse-code-sdk/blob/a45cb67cd2e27c8b6b4b55dcbaae6e6341123ea4/clients/sdk-ts/src/facade/approval.ts), [approval-resend test source](https://github.com/meta-models/muse-code-sdk/blob/a45cb67cd2e27c8b6b4b55dcbaae6e6341123ea4/clients/sdk-ts/test/facade-approval-resend.test.ts), and [public gap-recovery transcript](https://github.com/meta-models/muse-code-sdk/blob/a45cb67cd2e27c8b6b4b55dcbaae6e6341123ea4/schema/msp/transcripts/gap-recovery-reanchor/transcript.ndjson). I did not run them.

The router latches a stage before awaiting at [line 216](https://github.com/meta-models/muse-code-sdk/blob/a45cb67cd2e27c8b6b4b55dcbaae6e6341123ea4/clients/sdk-ts/src/facade/approval.ts#L216), avoids advancing a terminal approval at lines 252/291, and records a terminal acknowledgement at line 397. The resend tests assert actual emitted decide frames, same-chunk resume behavior, duplicate suppression, malformed requests and gap-fill overlap. These are stronger models for G6 tests than sleeps or text assertions.

Transfer the test method into Second Seat's own state machine, not its protocol types or persistent-approval policy. A received request receipt is not a user approval, an approval ACK is not application egress, and an SDK-side stage latch does not prove Second Seat's final HTTP boundary.

**Ranking update:** place this test-pattern transfer alongside ranks 3–5, ahead of optional features: estimated 2–4 hours, medium integration risk, no new dependency or model call. Direct SDK migration remains deferred.

**2. The structured-output recipe has unbounded application-level defaults for this workload.**

I read the complete [structured_output.py](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/recipes/structured-output/structured_output.py). The client at line 76 has no explicit application timeout; the parse call at lines 79–84 has no explicit completion cap and sets temperature=0.0. SDK/server defaults may impose limits, but they are not the bounded eval contract Second Seat needs.

Keep META-01's schema wiring and G3's explicit cap/deadline/actual-body tests. Do not paste the example's call defaults or interpret “schema-valid” as a guarantee of semantic extraction correctness. This reinforces ranks 1–2 and adds no new live-run authorization.

**3. Quantized runtime support must name the GPU generation and engine.**

I read the complete pinned [SGLang guide](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/inference-server/sglang.md), including its hardware matrix and caveats. It attributes NVFP4 configurations to SGLang on B300, B200, RTX 5090, RTX PRO 6000 and DGX Spark. The RTX PRO 6000 row explicitly names 96 GB GDDR7 at line 52. That is not evidence for every card sold under “RTX 6000,” or for L40S or the pinned vLLM image.

The guide distinguishes required language-model-only behavior for the NVFP4 checkpoint from its rejected use on the GGUF path. It uses SGLang parser name muse and reasoning_content, unlike the vLLM path's muse_glimmer and reasoning. It describes tool-calling verification as not performed by that cookbook. An OpenAI-compatible URL does not make parser fields and runtime flags interchangeable.

Rank 12 stays research-only. Require exact engine, checkpoint, hardware identity, server response contract and an independently authorized accuracy comparison before changing deployment.

**4. DFlash is a distinct unused optimization candidate, with poor deadline value.**

The [SGLang speculative-decoding section](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/inference-server/sglang.md#speculative-decoding-dflash) describes an assistant checkpoint and target-specific flags, extra memory needs, and a silent draft-loading failure yielding no speedup. I read that section, but did not validate its measurements or runtime behavior.

Add to the deferred backlog after rank 12: **1–2 days plus separately authorized inference; high risk.** It is a possible later optimization for generation latency. It does not remove cold-start time, ensure JSON validity, or establish lower total cost for eight short requests. Do not add a draft checkpoint to the current bounded launch.

**5. NVIDIA's benchmark settings are not a production-redaction recipe.**

I read the complete pinned [NVIDIA platform page](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/platform/nvidia.md). It attributes single-GPU B300 measurements to a specific development runtime and separately identifies the public container route. Its profiling command forces minimum/maximum lengths and ignore_eos; those settings serve a throughput measurement, not faithful task termination.

This resolves a potential false inference: a temperature=0 benchmark command does not demonstrate that greedy decoding is the best accuracy setting for Second Seat. Do not transfer its B300 throughput, free-form “FP8 works” row, or benchmark flags into a claimed A100/quantized eval result.

**6. SAM's confidence tolerance is not privacy coverage.**

I reviewed the relevant source patches in [SAM PR #1](https://github.com/meta-models/meta-sam/pull/1), [#6](https://github.com/meta-models/meta-sam/pull/6), [#18](https://github.com/meta-models/meta-sam/pull/18), and [#20](https://github.com/meta-models/meta-sam/pull/20), rather than treating their titles as proof. This is a source-patch review of the specified changes, not a complete review of every file/test in those PRs.

The parser change in #6 permits unknown fields/tokens with diagnostics and keeps records whose invalid confidence is omitted. That is a forward-compatibility choice; missing confidence is not zero or permission to expose pixels. The object-prompt builder validates coordinates and canonical IDs, and converts half-open box edges to inclusive wire edges. The video change skips negative timestamp preroll. The playground adds explicit propagation-direction validation for video object prompts.

These improve an experimental SAM path; none proves that all sensitive pixels are found. If image support is ever reopened, require mask coverage/error policy independent of parser acceptance and never discard a privacy mask merely because confidence is absent. Rank 10 remains deferred.

**7. An external sandbox demonstration is not inherited enforcement.**

I read the complete [sandboxed-agent walkthrough](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/recipes/sandboxed-agent/README.md). It expressly says the cookbook has not reproduced the contributed demonstration. The useful design principle is enforcing credential/egress boundaries outside the model. Installing or naming NemoClaw/OpenShell would not prove Second Seat's gate, file policy or host enforcement.

Rank 6 remains a proof task using the existing architecture. Do not add a new harness, messaging integration, real credential probe or external upload attempt.

### Additional exact offline acceptance checks

These supplement applicable G work; they do not authorize an SDK migration or media feature.

- **META-10 — duplicate event and terminal race:** feed the same invented pending approval through two delivery paths in one deterministic turn. Exactly one action decision may be produced. Then deliver a terminal state before a delayed duplicate/stage update; no new action may start and no stale successful draft may reappear. Assert emitted application actions, not merely handler call text.
- **META-11 — reconnect/resume before handler registration:** simulate an approval/receipt update delivered in the same chunk as restoring an invented session. The state and required callbacks must be ready before applying it. Unknown sessions and malformed identities cannot trigger a send.
- **META-12 — bounded structured-output transport:** capture the actual adapter request and timer/deadline inputs under a required schema profile. Missing completion cap, unsupported response format or a deadline that does not constrain the attempt must fail. Keep retries inside the declared total attempt budget. Do not invoke the upstream OpenAI client against a live endpoint.
- **META-13 — optional SAM guard, only if maintaining the disabled experiment:** parse an invented record with absent/invalid confidence. Parser acceptance must not make the application label the whole frame safe or remove required masking. Keep all image entry points off in the text assistant.

### What remains unfinished

The requested full review is not complete. Specifically:

1. Most of the 6,918 listed branch blobs have not received full content review. The 5,398 text-extension candidates are not reviewed simply because the tree lists them.
2. Every PR's changed-file list outside the workshop has been retrieved, but substantive review of all 1,915 file entries, omitted patches and corresponding tests remains unfinished.
3. First-page commit data exists for all 554 non-workshop commits, but the 106 generated SDK documentation-publish histories listed below still need further file pages. Substantive review of the complete commit diffs also remains unfinished, including retrieved patches.
4. The opening bodies of all inventoried issues/PRs are not all substantively reviewed. Discussion-comment coverage is complete only for the returned REST collections described above; attachments and external/private references remain excluded.
5. Broad workshop branch/history review remains excluded to preserve the sealed/withheld-data boundary. No claim of unrestricted exhaustive review is compatible with ignoring that exclusion.
6. Binary/media contents have not been exhaustively viewed, and the pinned inventory is not a claim about future repository changes, deleted refs or inaccessible history.

These gaps are not marked PASS, and no ranking is presented as a complete census of every unused capability. The new findings strengthen the repair priorities without changing the absence of a new live Second Seat result.

### Pending SDK commit file pagination

Each link below still has additional changed-file pages pending after its first 100 file entries. This list tracks retrieval, not semantic review.

- [495b0791956b59fdf127896b65e8db3586bafdd2](https://github.com/meta-models/muse-code-sdk/commit/495b0791956b59fdf127896b65e8db3586bafdd2)
- [9878b685de2e2dce50c9cb5e2e62de3462890bc8](https://github.com/meta-models/muse-code-sdk/commit/9878b685de2e2dce50c9cb5e2e62de3462890bc8)
- [17b4bdaf3277e52616571e72ce2f57fb706929d1](https://github.com/meta-models/muse-code-sdk/commit/17b4bdaf3277e52616571e72ce2f57fb706929d1)
- [a58caeaf3b8092f86a24189e243f82f916042713](https://github.com/meta-models/muse-code-sdk/commit/a58caeaf3b8092f86a24189e243f82f916042713)
- [d4fb8d2f739502ed54caa1ceff13dee69d6e2c73](https://github.com/meta-models/muse-code-sdk/commit/d4fb8d2f739502ed54caa1ceff13dee69d6e2c73)
- [28cf0a9868d326465d9404fe07ea70ec6ef51a52](https://github.com/meta-models/muse-code-sdk/commit/28cf0a9868d326465d9404fe07ea70ec6ef51a52)
- [d9d50d285268f7dc4fa4d61378fc753efcb69c5d](https://github.com/meta-models/muse-code-sdk/commit/d9d50d285268f7dc4fa4d61378fc753efcb69c5d)
- [6b0963146681d0b19830613de885029a7c8c1ae8](https://github.com/meta-models/muse-code-sdk/commit/6b0963146681d0b19830613de885029a7c8c1ae8)
- [343366f2d760318769312c858b439ae086e2fb9a](https://github.com/meta-models/muse-code-sdk/commit/343366f2d760318769312c858b439ae086e2fb9a)
- [cf7e3b16e5215ffafe2e8a396766e0d4f40aa875](https://github.com/meta-models/muse-code-sdk/commit/cf7e3b16e5215ffafe2e8a396766e0d4f40aa875)
- [370a6f2f2d8508f57c63bd17b812e7847d99b25a](https://github.com/meta-models/muse-code-sdk/commit/370a6f2f2d8508f57c63bd17b812e7847d99b25a)
- [8dd66cea2bdd2eda856e61e682dfb7199c5bfcde](https://github.com/meta-models/muse-code-sdk/commit/8dd66cea2bdd2eda856e61e682dfb7199c5bfcde)
- [3f4aac1e3546114fd6b81bf1b5a185d55a7446b2](https://github.com/meta-models/muse-code-sdk/commit/3f4aac1e3546114fd6b81bf1b5a185d55a7446b2)
- [bdec981c0e96b9bfa30369200eba764ce7b28be6](https://github.com/meta-models/muse-code-sdk/commit/bdec981c0e96b9bfa30369200eba764ce7b28be6)
- [a1bb4e346c8a859725e1e9b0a75ab1300fc37e10](https://github.com/meta-models/muse-code-sdk/commit/a1bb4e346c8a859725e1e9b0a75ab1300fc37e10)
- [77a77875dbaa6e73d7923d31009453287aae26b4](https://github.com/meta-models/muse-code-sdk/commit/77a77875dbaa6e73d7923d31009453287aae26b4)
- [23ddf3eafc254c9cfa7edec5dd17e3eeb30c085d](https://github.com/meta-models/muse-code-sdk/commit/23ddf3eafc254c9cfa7edec5dd17e3eeb30c085d)
- [53d9f9d1287d9a609f0c12a6c4eb92a1456e7854](https://github.com/meta-models/muse-code-sdk/commit/53d9f9d1287d9a609f0c12a6c4eb92a1456e7854)
- [27ed1ddcf015fd79a0ff2217a60d17d63e583b9d](https://github.com/meta-models/muse-code-sdk/commit/27ed1ddcf015fd79a0ff2217a60d17d63e583b9d)
- [8f258ab79a9e7e29e3c9b0c0cb511ce813d6987f](https://github.com/meta-models/muse-code-sdk/commit/8f258ab79a9e7e29e3c9b0c0cb511ce813d6987f)
- [36467937b86d96f5b30f59d29bda39b2e9b499c9](https://github.com/meta-models/muse-code-sdk/commit/36467937b86d96f5b30f59d29bda39b2e9b499c9)
- [972bee4c3024802b010c66f005e2fe61e10689de](https://github.com/meta-models/muse-code-sdk/commit/972bee4c3024802b010c66f005e2fe61e10689de)
- [2fdbb12fa0ce26c714e4c33ea2abcec3d801c403](https://github.com/meta-models/muse-code-sdk/commit/2fdbb12fa0ce26c714e4c33ea2abcec3d801c403)
- [c9a0c0a017ea7ed03915135f7188724b7f9a8ef1](https://github.com/meta-models/muse-code-sdk/commit/c9a0c0a017ea7ed03915135f7188724b7f9a8ef1)
- [6c24b27fa71e8a416128f95a0629aee26b0c9f15](https://github.com/meta-models/muse-code-sdk/commit/6c24b27fa71e8a416128f95a0629aee26b0c9f15)
- [8b1bb585450911d7e4e3b6fbcf5a7e69eba347cc](https://github.com/meta-models/muse-code-sdk/commit/8b1bb585450911d7e4e3b6fbcf5a7e69eba347cc)
- [ae58bd0ab12d55becb9c687000c50a8f86bbb2b5](https://github.com/meta-models/muse-code-sdk/commit/ae58bd0ab12d55becb9c687000c50a8f86bbb2b5)
- [3a4a65425004a535e7c06a780d33ec97a1227492](https://github.com/meta-models/muse-code-sdk/commit/3a4a65425004a535e7c06a780d33ec97a1227492)
- [469bdac4c83922af9f64f3ab0a1e2155c0538f6e](https://github.com/meta-models/muse-code-sdk/commit/469bdac4c83922af9f64f3ab0a1e2155c0538f6e)
- [882f2dc916076ca29309747539e5ceb1767af98c](https://github.com/meta-models/muse-code-sdk/commit/882f2dc916076ca29309747539e5ceb1767af98c)
- [1a56aaae496da755af1cde699e9ae5e98c462f03](https://github.com/meta-models/muse-code-sdk/commit/1a56aaae496da755af1cde699e9ae5e98c462f03)
- [2638e0a8ec0a9696ae2d02e06f8e5fef93d72e45](https://github.com/meta-models/muse-code-sdk/commit/2638e0a8ec0a9696ae2d02e06f8e5fef93d72e45)
- [b457ecd540a437eb2ec8588627e9b7e4defccbb5](https://github.com/meta-models/muse-code-sdk/commit/b457ecd540a437eb2ec8588627e9b7e4defccbb5)
- [0cbb00a5a865bc466acaca4ffed5a439c61fb790](https://github.com/meta-models/muse-code-sdk/commit/0cbb00a5a865bc466acaca4ffed5a439c61fb790)
- [8718ae9bb16565b178d020583098a9d01c92a564](https://github.com/meta-models/muse-code-sdk/commit/8718ae9bb16565b178d020583098a9d01c92a564)
- [06a4175267c22516de7388d9371ad7a3e0528cd9](https://github.com/meta-models/muse-code-sdk/commit/06a4175267c22516de7388d9371ad7a3e0528cd9)
- [eefbc24f61689b91e3a1bcad280ed22d6270e221](https://github.com/meta-models/muse-code-sdk/commit/eefbc24f61689b91e3a1bcad280ed22d6270e221)
- [77c0bd1304847eb4d87e687d5f8d71b70869302d](https://github.com/meta-models/muse-code-sdk/commit/77c0bd1304847eb4d87e687d5f8d71b70869302d)
- [13187353f96584b9438de0d160b6dbbcc90050dc](https://github.com/meta-models/muse-code-sdk/commit/13187353f96584b9438de0d160b6dbbcc90050dc)
- [cbfb05159370b2fe53e5ec8499c7670678f03bcb](https://github.com/meta-models/muse-code-sdk/commit/cbfb05159370b2fe53e5ec8499c7670678f03bcb)
- [b16583fa5f42ac11b94418069ff4c6ed3a72e2fa](https://github.com/meta-models/muse-code-sdk/commit/b16583fa5f42ac11b94418069ff4c6ed3a72e2fa)
- [49cf81829ebbd5c040a9d31e6290eef52b77ee49](https://github.com/meta-models/muse-code-sdk/commit/49cf81829ebbd5c040a9d31e6290eef52b77ee49)
- [42e06cf8b6822236f56db1e76ea385c76c473ac0](https://github.com/meta-models/muse-code-sdk/commit/42e06cf8b6822236f56db1e76ea385c76c473ac0)
- [05a1a5a14f4fa44f166415af53793f250db8f2e4](https://github.com/meta-models/muse-code-sdk/commit/05a1a5a14f4fa44f166415af53793f250db8f2e4)
- [d805193c371dbdc0cdac4c1f3d62d8a422f05987](https://github.com/meta-models/muse-code-sdk/commit/d805193c371dbdc0cdac4c1f3d62d8a422f05987)
- [89abe576a9c8e61a94004082fa90cd08d0e76126](https://github.com/meta-models/muse-code-sdk/commit/89abe576a9c8e61a94004082fa90cd08d0e76126)
- [560ac21f86407b3a8a471f14a37c90ffb34770e2](https://github.com/meta-models/muse-code-sdk/commit/560ac21f86407b3a8a471f14a37c90ffb34770e2)
- [a7486616c9a182529cc9f0ff04947d9da8218b46](https://github.com/meta-models/muse-code-sdk/commit/a7486616c9a182529cc9f0ff04947d9da8218b46)
- [bcc5a43100be12ad4f17498a07c1509167a8e625](https://github.com/meta-models/muse-code-sdk/commit/bcc5a43100be12ad4f17498a07c1509167a8e625)
- [7e43ff4f878a201a8e6a92688bdf3f0dc7268e12](https://github.com/meta-models/muse-code-sdk/commit/7e43ff4f878a201a8e6a92688bdf3f0dc7268e12)
- [63920d772eaa828e9f2fa76e50b80cc4c4c6d419](https://github.com/meta-models/muse-code-sdk/commit/63920d772eaa828e9f2fa76e50b80cc4c4c6d419)
- [0b230e991f79a90dc3cf8b5ab7de083b51f78567](https://github.com/meta-models/muse-code-sdk/commit/0b230e991f79a90dc3cf8b5ab7de083b51f78567)
- [8fa0eca42955ebd2bfb60002aca0b5c647426e74](https://github.com/meta-models/muse-code-sdk/commit/8fa0eca42955ebd2bfb60002aca0b5c647426e74)
- [06cb2cc3fbb5b227b161cec1f97afda6eeabf558](https://github.com/meta-models/muse-code-sdk/commit/06cb2cc3fbb5b227b161cec1f97afda6eeabf558)
- [1ee1e5dee1f5c4d9aad22c9182205ccb5648b2dd](https://github.com/meta-models/muse-code-sdk/commit/1ee1e5dee1f5c4d9aad22c9182205ccb5648b2dd)
- [de275a06d4ad47a4e1150c41ad473bb8594d6780](https://github.com/meta-models/muse-code-sdk/commit/de275a06d4ad47a4e1150c41ad473bb8594d6780)
- [aa077d8bf131fa7bdbd7c8da40da7ff08aff4732](https://github.com/meta-models/muse-code-sdk/commit/aa077d8bf131fa7bdbd7c8da40da7ff08aff4732)
- [136f14cb6c16afcdcb85959bf9d8dd56a637bbe8](https://github.com/meta-models/muse-code-sdk/commit/136f14cb6c16afcdcb85959bf9d8dd56a637bbe8)
- [818e9cdb7dd68ca35169ecf036ffa49ec4284625](https://github.com/meta-models/muse-code-sdk/commit/818e9cdb7dd68ca35169ecf036ffa49ec4284625)
- [d6260b79032a1d1d0d32003baf87c1ed54b618bd](https://github.com/meta-models/muse-code-sdk/commit/d6260b79032a1d1d0d32003baf87c1ed54b618bd)
- [36c666ade8bc2f52546ad08618593a1fdb62297e](https://github.com/meta-models/muse-code-sdk/commit/36c666ade8bc2f52546ad08618593a1fdb62297e)
- [faf98e109f2f76e62026e45ee2eacfd6b026e6eb](https://github.com/meta-models/muse-code-sdk/commit/faf98e109f2f76e62026e45ee2eacfd6b026e6eb)
- [da6ae157357ef43ffc7b2ab60a4f73ea014d8ecc](https://github.com/meta-models/muse-code-sdk/commit/da6ae157357ef43ffc7b2ab60a4f73ea014d8ecc)
- [3f95ff18b8a2fcce2de960b8d2129ea12e6a38a1](https://github.com/meta-models/muse-code-sdk/commit/3f95ff18b8a2fcce2de960b8d2129ea12e6a38a1)
- [6534a24936f1b435979352b705c3bbae216eb5e3](https://github.com/meta-models/muse-code-sdk/commit/6534a24936f1b435979352b705c3bbae216eb5e3)
- [b214160f223f034f7f40771b8f2c92610579958c](https://github.com/meta-models/muse-code-sdk/commit/b214160f223f034f7f40771b8f2c92610579958c)
- [0c0afcfc69781dccb3c866966378820392795886](https://github.com/meta-models/muse-code-sdk/commit/0c0afcfc69781dccb3c866966378820392795886)
- [13d8f0ad606feb2a3801aaa2dedc2e328cee992e](https://github.com/meta-models/muse-code-sdk/commit/13d8f0ad606feb2a3801aaa2dedc2e328cee992e)
- [69cdcf0b542d02eea39ebf335f5231382c14655d](https://github.com/meta-models/muse-code-sdk/commit/69cdcf0b542d02eea39ebf335f5231382c14655d)
- [358f2db7cb025afe599558c1493ed2b59c6eb14f](https://github.com/meta-models/muse-code-sdk/commit/358f2db7cb025afe599558c1493ed2b59c6eb14f)
- [1b771cb3fd4ab7aaad90eb2d59d7f61f31a2782c](https://github.com/meta-models/muse-code-sdk/commit/1b771cb3fd4ab7aaad90eb2d59d7f61f31a2782c)
- [077907f8061aefe149dbed91b1652c1439eb2e95](https://github.com/meta-models/muse-code-sdk/commit/077907f8061aefe149dbed91b1652c1439eb2e95)
- [8ced995cf35aaeaf4b21f7f737076acac628d58a](https://github.com/meta-models/muse-code-sdk/commit/8ced995cf35aaeaf4b21f7f737076acac628d58a)
- [180db2bb2cca223495cecb6f023c01c97bca1ab7](https://github.com/meta-models/muse-code-sdk/commit/180db2bb2cca223495cecb6f023c01c97bca1ab7)
- [89df25d7b0e765643055632be18de932d76f6ab2](https://github.com/meta-models/muse-code-sdk/commit/89df25d7b0e765643055632be18de932d76f6ab2)
- [21fd1917d6bc9883bbd1cc8f5697088226bd2a2c](https://github.com/meta-models/muse-code-sdk/commit/21fd1917d6bc9883bbd1cc8f5697088226bd2a2c)
- [8a7db848238fdb576b36aa82200c78cdc9516f87](https://github.com/meta-models/muse-code-sdk/commit/8a7db848238fdb576b36aa82200c78cdc9516f87)
- [cef1d7c7f23b3a186eae4dabfed944d468464208](https://github.com/meta-models/muse-code-sdk/commit/cef1d7c7f23b3a186eae4dabfed944d468464208)
- [289caec947736ac0219f06d80a1cf3df78e56f91](https://github.com/meta-models/muse-code-sdk/commit/289caec947736ac0219f06d80a1cf3df78e56f91)
- [2c590e3f693ddafbaa6b119d6d96ddcf41711a04](https://github.com/meta-models/muse-code-sdk/commit/2c590e3f693ddafbaa6b119d6d96ddcf41711a04)
- [8b53dbc1692530fdf0b6fb1149786d6b55d28818](https://github.com/meta-models/muse-code-sdk/commit/8b53dbc1692530fdf0b6fb1149786d6b55d28818)
- [d5ba5a986b33cdd882f1379fb606c0da5e3e69eb](https://github.com/meta-models/muse-code-sdk/commit/d5ba5a986b33cdd882f1379fb606c0da5e3e69eb)
- [e165aaac4ed254c6166ffa7b0be82dc0625cb750](https://github.com/meta-models/muse-code-sdk/commit/e165aaac4ed254c6166ffa7b0be82dc0625cb750)
- [7e594ab1b2c95d938bb37dd8b9e0c367e86a0b71](https://github.com/meta-models/muse-code-sdk/commit/7e594ab1b2c95d938bb37dd8b9e0c367e86a0b71)
- [e5fe32bc0fa61256df7c4b50ef975207656c66ed](https://github.com/meta-models/muse-code-sdk/commit/e5fe32bc0fa61256df7c4b50ef975207656c66ed)
- [47335f308f312e96289947836e5e8a393872ab65](https://github.com/meta-models/muse-code-sdk/commit/47335f308f312e96289947836e5e8a393872ab65)
- [ff06388010a1952619de9ff73ec26d8d1d587d85](https://github.com/meta-models/muse-code-sdk/commit/ff06388010a1952619de9ff73ec26d8d1d587d85)
- [86bcbac2f06c349e9e0b9fb522e728e1064cd6cd](https://github.com/meta-models/muse-code-sdk/commit/86bcbac2f06c349e9e0b9fb522e728e1064cd6cd)
- [ccb2fb3a92cad65ec67f523e5902be716a59d4dc](https://github.com/meta-models/muse-code-sdk/commit/ccb2fb3a92cad65ec67f523e5902be716a59d4dc)
- [65cba886819445d2b2deb0db4441908bd2be7a0c](https://github.com/meta-models/muse-code-sdk/commit/65cba886819445d2b2deb0db4441908bd2be7a0c)
- [8277307b1c4f0bafdbbfb976d5b6dd6f9c4cc24f](https://github.com/meta-models/muse-code-sdk/commit/8277307b1c4f0bafdbbfb976d5b6dd6f9c4cc24f)
- [3db06050a36d3314093ee5646d1be3c68bc78a48](https://github.com/meta-models/muse-code-sdk/commit/3db06050a36d3314093ee5646d1be3c68bc78a48)
- [6c234e38778a836b86b72aba0c87f83996d9b397](https://github.com/meta-models/muse-code-sdk/commit/6c234e38778a836b86b72aba0c87f83996d9b397)
- [6d60e724a53a74da8456add21a848aaea0df5a01](https://github.com/meta-models/muse-code-sdk/commit/6d60e724a53a74da8456add21a848aaea0df5a01)
- [0f1179f62136d447234f80c552e63ac9bf8a4bae](https://github.com/meta-models/muse-code-sdk/commit/0f1179f62136d447234f80c552e63ac9bf8a4bae)
- [6c480170294136b0eac96706b05d1d742829b7ac](https://github.com/meta-models/muse-code-sdk/commit/6c480170294136b0eac96706b05d1d742829b7ac)
- [0d67c402e70a4fe53a54bedf8bc8d48fed689875](https://github.com/meta-models/muse-code-sdk/commit/0d67c402e70a4fe53a54bedf8bc8d48fed689875)
- [6af50952b4b27e92b6857a5004b6079ea350f494](https://github.com/meta-models/muse-code-sdk/commit/6af50952b4b27e92b6857a5004b6079ea350f494)
- [5fa6fc80e0d8350ac12788982e79bde634c1b0ad](https://github.com/meta-models/muse-code-sdk/commit/5fa6fc80e0d8350ac12788982e79bde634c1b0ad)
- [b44e008210473d1488157b9a11b915a5ee490240](https://github.com/meta-models/muse-code-sdk/commit/b44e008210473d1488157b9a11b915a5ee490240)
- [d62abd0ed78dbb6c7ee6de32150fa9ed787c1162](https://github.com/meta-models/muse-code-sdk/commit/d62abd0ed78dbb6c7ee6de32150fa9ed787c1162)
- [b7757b60800cd6bb675f9d4d2637977f544c8d1f](https://github.com/meta-models/muse-code-sdk/commit/b7757b60800cd6bb675f9d4d2637977f544c8d1f)
- [8410e8e89e432344ccab4a760f9b031b7d5b7e38](https://github.com/meta-models/muse-code-sdk/commit/8410e8e89e432344ccab4a760f9b031b7d5b7e38)
- [2c65c0311f32ea0b6d2d9239ae5c0129e1e9cf87](https://github.com/meta-models/muse-code-sdk/commit/2c65c0311f32ea0b6d2d9239ae5c0129e1e9cf87)
- [bd0bad3638ee52e686927266a688e5b761838165](https://github.com/meta-models/muse-code-sdk/commit/bd0bad3638ee52e686927266a688e5b761838165)
- [0576e278e45d7986d467486869813cbe223d4ab5](https://github.com/meta-models/muse-code-sdk/commit/0576e278e45d7986d467486869813cbe223d4ab5)

Paid execution, model requests, cloud builds, provider experiments and sealed holdout access remain BLOCKED.

## Further continuation — whole-text inspection and reproduced upstream failures

**The full requested review remains incomplete.** This section records further work; it does not turn retrieval, parsing or automated scans into a claim that all branch files and diffs have received substantive review.

### Coverage advanced in this continuation

- Cached and verified **5,514 selected public text blobs, totaling 455,946,512 bytes**, from the four non-workshop repositories. Each was fetched by an already recorded branch ref/path and checked against its public Git blob identity. No provider credentials were used. This is a text-candidate filter, not a claim that binary/media contents or every extension were reviewed.
- Performed whole-text static inspection of those 5,514 cached candidates: Python AST parsing; JSON/notebook, NDJSON and TOML parsing where applicable; generated-HTML article extraction; and source-boundary/transport/process-policy signals. Nothing was built or imported as a live application. The five strict-JSON exceptions were inspected: they are TypeScript configuration files using comments, not five established product bugs.
- Deduplicated generated documentation into 985 distinct article bodies and 16,221 distinct paragraphs (1,625,364 paragraph bytes). Navigation, scripts and other boilerplate were not treated as independently reviewed semantic content. Those extracted bodies still need substantive review.
- Retrieved and statically inspected **441 complete unified diff responses**, totaling 9,552,859,885 bytes. The stream inspector found 2,746 unique source-hunk sections and 645 unique generated-document bodies. These are inspection units, not 441 completed adversarial PR/commit reviews. Binary notices were catalogued, not decoded into inspected assets.
- The direct PR-patch endpoint returned HTTP 429. That retrieval path was stopped. One commit response returned HTTP 503. Across the 715 non-workshop commit/PR diff targets, the direct-response ledger currently contains 441 successful responses, 71 failed targets and 203 not yet attempted. The earlier GitHub API PR-file data remains available, with its patch-omission limitations.
- Reviewed an additional **51 source variants**: source cells and exact branch-source deltas for all ten API fundamentals notebooks (30 blobs); twelve orchestration/security recipe documents or variants; and nine Glimmer reference/runtime Python source variants outside voice/post-training. The notebook comparison found both documentation-link changes and model-ID changes between Muse Spark 1.3 and 1.1 examples. Stored notebook outputs were not rerun or promoted into new measurements.

The durable local indexes distinguish these levels: source-cache.jsonl, static-inspection.json, semantic-review.json, diff-cache.jsonl and diff-inspection.json under work/meta-models-audit/. The semantic ledger for this continuation marks only the 51 newly reviewed variants as reviewed; its other rows remain pending. It is not a retroactive inventory of every file read in earlier turns.

Large raw generated diffs were an inefficient cache representation. They are being preserved losslessly as verified gzip files before removing only their redundant uncompressed copies inside this task's own cache. This is storage cleanup, not evidence deletion or a reduction of the pending review scope.

### New findings — reproduced without any model or provider call

These are findings in the pinned public Meta examples. They are **not asserted to be vulnerabilities in Second Seat** unless a corresponding Second Seat path is separately demonstrated.

#### U1 — an unterminated reasoning channel can produce an executable-looking tool call

Source: [response_parser.py:30](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/agentic-fundamentals/response_parser.py#L30), [scan at lines 79–85](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/agentic-fundamentals/response_parser.py#L79).

The reasoning-strip regex requires a closing eom marker. An unfinished reasoning span therefore remains in the text scanned for invoke markup. The reference agent loop subsequently dispatches parsed calls through its registry.

The offline parser-only probe used an invented_tool invocation and observed:

| Invented input | Parsed tool names | Final content present |
|---|---|---|
| Closed reasoning channel containing the invocation | [] | false |
| Same reasoning channel without the closing marker | [invented_tool] | false |
| Unscoped prose presenting the invocation as an example | [invented_tool] | true |

Reproduction: work/meta-models-audit/probe_parser.py. The fully inspected parser module uses only standard-library parsing/types; no model, network, registry dispatch or tool was run.

**Second Seat implication:** do not add this raw tool parser or a Glimmer agent loop to redaction. A truncated thinking block remains an unsuccessful response. If a future tool path is introduced, require complete authenticated message/channel structure, a validated registered name/arguments and the application approval boundary before execution. Existing G3/G6 requirements must survive such a change.

#### U2 — the reference read/write “sandbox” permits sibling-prefix escapes

Source: [run_agent.py:42–47](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/agentic-fundamentals/run_agent.py#L42), [write boundary at lines 132–141](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/agentic-fundamentals/run_agent.py#L132).

Both boundaries compare resolved paths with string startswith. A sibling whose name begins with the intended root is accepted even though it is outside that directory.

The offline probe created only invented temporary directories inside this audit workspace. For a root named root, ../root-neighbor/example.txt was accepted. For workspace, ../workspace-neighbor/example.txt was written successfully. All three decisive observations were true: sibling read path accepted, sibling write succeeded, file exists outside the intended workspace but inside the invented scratch directory.

Reproduction: work/meta-models-audit/probe_path_boundary.py. Only the two inspected helper definitions were evaluated; model imports, decorators and the application entrypoint were excluded. No actual private or sealed directory was touched.

**Second Seat implication:** strengthen G1 path tests with sibling-prefix cases and resolved-path containment. Prompts and a variable named sandbox do not enforce directory ancestry. This does not establish that Second Seat currently uses this faulty helper.

#### U3 — the reasoning demo's accuracy check accepts wrong answers

Source: [reasoning_effort.py:55](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/recipes/reasoning-effort/reasoning_effort.py#L55).

The criterion is EXPECTED in answer, where EXPECTED is the string 60. With a fake transport, all three answers were marked correct: 160; “60 is not the correct answer”; and 60. The script can therefore select a supposedly cheapest correct setting using an invalid correctness predicate.

Reproduction: work/meta-models-audit/probe_reasoning_score.py. Only the inspected ask helper ran against an in-memory fake client. No provider request occurred.

**Second Seat implication:** do not use this demo's accuracy result or evaluator as evidence for redaction quality or sampling selection. Keep exact semantic span/character scoring, full denominators, failure statuses and the frozen scorer. A number containing a target string is not a correct answer.

#### U4 — the streaming helper returns interrupted partial text without a completion-state result

Source: [02_streaming.ipynb](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/01_api_fundamentals/02_streaming.ipynb), function stream_completion.

The helper catches timeout/connection exceptions, prints a warning and returns the accumulated string. An ordinary caller receives a string rather than a typed partial/failed result. That is acceptable as an educational display example but unsuitable as an automatic “completed valid brief” contract.

The offline fake iterator emitted synthetic partial, then raised an invented timeout. The helper returned that partial string. No completion-state object was returned.

Reproduction: work/meta-models-audit/probe_notebook_helpers.py. Setup/ping cells were never executed. Only selected inspected helper definitions ran with fake classes and an in-memory iterator.

**Second Seat implication:** keep partial output separate from a final validated brief/draft. Do not enable copy as a completed result because some deltas arrived. A retry must respect current approval and the total attempt budget.

#### U5 — the circuit-breaker example permits multiple half-open calls before the trial settles

Source: [09_error_handling.ipynb](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/01_api_fundamentals/09_error_handling.ipynb), class CircuitBreaker, method allow.

After cooldown, allow clears opened_at before the trial reports success or failure. A second caller arriving before that record sees the breaker as closed and is also allowed. The advertised single-trial behavior is not maintained across outstanding calls.

The deterministic fake-clock probe recorded two failures, advanced past cooldown, called allow twice without recording the trial outcome, and observed true both times. No sleeping or network call was needed.

Reproduction: work/meta-models-audit/probe_notebook_helpers.py.

**Second Seat implication:** do not add this breaker as a presumed concurrency or spend fence. A breaker is also separate from a hard attempt counter, a deadline and approval revocation. This is a helper edge case, not evidence of a currently connected Second Seat breaker bug.

#### U6 — a zero history allowance retains all turns

Source: [08_long_context.ipynb](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/01_api_fundamentals/08_long_context.ipynb), function trim_history.

The helper computes keep=max(0, max_messages-len(instructions)) and returns instructions+turns[-keep:]. In Python, -0 is 0, so a zero allowance returns every turn.

An invented history with one developer instruction, twenty user turns and max_messages=1 returned 21 messages. The probe used only that function; no input-token endpoint or model was called.

Reproduction: work/meta-models-audit/probe_notebook_helpers.py.

**Second Seat implication:** include zero/exhausted capacity in G3 context-limit tests. Message counts are not token counts, and a helper called trim_history is not proof that the effective request fits the frozen context.

### Additional source-review conclusions

1. **Staged approvals and cancellation remain separate.** The [fanout recipe](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/06_subagent_fanout/README.md) explicitly describes cooperative cancellation and late writes. A cancel acknowledgement cannot prove that an already dispatched effect did not occur. Its private worktree example also does not prove that sealed files were excluded before checkout. No agents or worktrees were created during this review.

2. **Do not copy permissive launch flags.** The reviewed [goal](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/07_goal_tracking/README.md), [skills](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/08_bundled_skills/README.md) and [side-chat](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/10_side_chats/README.md) examples include yolo launches. These examples do not override this prompt's sandbox, approval, paid-run or sealed-access blocks. A completion audit is not independent evidence unless its oracle actually establishes the requested behavior.

3. **MCP does not inherit the shell sandbox.** The [security-tooling recipe](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/11_mcp_security_tooling/README.md) explicitly distinguishes MCP tool processes and their own approval layers. Its optional-server advice improves availability in that walkthrough, not fail-closed privacy. Do not make a privacy-critical validator optional or add these security tools to Second Seat. Nothing in the recipe was installed, launched or pointed at a target.

4. **Scheduling is not an enforceable deadline service.** The [loop/cron recipe](https://github.com/meta-models/meta-model-cookbook/blob/0a99b987858ec4e49c04fc3f114bf33851e81deb/04_muse_code/09_loop_and_cron/README.md) describes an active-process requirement, session scope, seven-day recurring lifetime and forward jitter. It is unsuitable as a GPU kill switch or hard budget. No schedule was created.

5. **Self-assessed structured triage does not validate case identity or completeness.** The fully reviewed [alert_triage.py](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/recipes/alert-triage-copilot/alert_triage.py) uses arbitrary string IDs and list fields, and exits before remediation/self-assessment when none are paged. Schema validity alone does not prove that every original case is represented exactly once. Do not transfer that control flow into eval completion accounting.

6. **Platform validation is documentation validation.** Both reviewed [validate.py variants](https://github.com/meta-models/meta-oss-cookbook/blob/a6c315d703170ac29751eb160eecb977d16e3a88/muse-glimmer/platform/validate.py) check frontmatter, tables, labels and section structure. They do not boot a server or validate a GPU claim. The branch variant changes command paths in the docstring. A clean validator exit is not deployment or throughput evidence.

7. **Cache keys, search annotations and token-count endpoints are not privacy proof.** The source-reviewed API notebooks describe those features, but their example setup cells make live pings and their examples send additional requests. None was run. A cache hint does not establish retention policy; a citation annotation does not prove entailment; a remote token-count request is still a disclosure boundary. Keep these outside the approved text payload unless explicitly included and authorized.

### Ranking adjustments and exact additional checks

The findings reinforce the existing G1/G3/G6 proof work. They do not justify another runtime, model call, agent framework, vision feature or training run.

| Check | Scope | Exact failing-first condition |
|---|---|---|
| META-14 | G1 path ownership | In an invented scratch tree, reject a sibling sharing the allowed root's textual prefix, an absolute sibling path, and parent traversal. Assert the target was neither read nor written. Test any link/reparse-point behavior supported by the actual platform; disclose untested cases. |
| META-15 | Future parser guard only if such a path exists | An invocation inside incomplete reasoning, quoted final content or unscoped prose must never dispatch a tool. Keep final-content-only redaction and do not add a tool loop just to satisfy this test. |
| META-16 | Eval/scoring guards | Wrong numeric containment, duplicate IDs, omitted planned IDs, unknown statuses and plausible-looking invalid output cannot increase the success numerator. Use public invented records; never open a sealed case to write the test. |
| META-17 | G6 streaming | Emit a valid-looking prefix, then fail the fake stream before a successful terminal and schema validation. No completed brief/draft or copyable “success” may appear. Retry after revocation sends nothing. |
| META-18 | G3 context | Test zero, exactly exhausted and exceeded context allowance at the actual request boundary. A zero allowance cannot fall through to “all history,” and message trimming alone cannot substitute for the declared token/context policy. |
| META-19 | Optional breaker only if present | After cooldown, hold the one allowed fake trial unresolved. A second concurrent call must remain blocked. Regardless of breaker state, total attempts and wall deadline remain bounded by the frozen run configuration. |

These checks are transfer safeguards, not claims that the corresponding Second Seat failures have been reproduced. Existing guards must be reported as guards; do not manufacture parent failures.

### Remaining work is still explicit

The 441 unified responses now close retrieval gaps for those individual targets beyond their first API pages, but they do not close all diff retrieval or substantive review. The former list of 106 pending SDK pagination targets is a historical checkpoint, not the current authoritative status; use the current per-target ledger. Targets without a complete diff remain pending even if some API file pages exist.

Most source blobs, generated document bodies, unique source hunks and the remaining diffs still lack substantive review. Public binary/media contents and attachments have not received a complete content review. The workshop's withheld areas remain excluded. No exhaustive-review claim is made, and the user's requested full review is not marked complete.

No paid execution, model inference, Modal operation, Baseten call or sealed holdout access occurred. All such actions remain BLOCKED.

## Final wrap-up at the owner's request

The owner asked to wrap up before the full corpus review was finished. **This is an incomplete review, not an exhaustive one.** Earlier progress counts are historical checkpoints; this section and work/meta-models-audit/final-status.json record the final state.

### Last completed source-review slice: SAM TypeScript parser

The twelve distinct source blobs under typescript/packages/parser/src/ in the inventoried branch heads were read, including the older export/segmentation variants. This completes that source-directory slice, not the SAM repository, its test suite or its live API validation.

Relevant pinned sources:
- [Stream state machine](https://github.com/meta-models/meta-sam/blob/40318970a81301f31e97cdd7d605117293332b0f/typescript/packages/parser/src/stream.ts)
- [Segmentation parser](https://github.com/meta-models/meta-sam/blob/40318970a81301f31e97cdd7d605117293332b0f/typescript/packages/parser/src/segmentation.ts)
- [Mask decoder](https://github.com/meta-models/meta-sam/blob/40318970a81301f31e97cdd7d605117293332b0f/typescript/packages/parser/src/mask-codec.ts)
- [Raster/RLE conversion](https://github.com/meta-models/meta-sam/blob/40318970a81301f31e97cdd7d605117293332b0f/typescript/packages/parser/src/mask-conversion.ts)
- [Object-prompt builder](https://github.com/meta-models/meta-sam/blob/40318970a81301f31e97cdd7d605117293332b0f/typescript/packages/parser/src/object-prompt.ts)

A pure offline probe fed invented Responses events containing a valid one-pixel box and an invalid mask payload. The result was:

~~~json
{"outcome":"completed","boxRecords":1,"maskRecords":0,"diagnosticCodes":["invalid_mask_payload"],"modelCalls":0,"networkCalls":0}
~~~

This is a distinction in the library's contract, not an assertion that the library promises valid privacy coverage: transport completion and segmentation diagnostics are separate fields. An application must inspect both. It cannot promote a completed response, a box-only result or missing confidence into “safe to share.”

The mask decoder validates structural dimensions and payloads but explicitly provides no project-specific quota ceiling. Any future application image path must own resolution, payload, record-count and time limits. Valid decoding still does not establish that sensitive regions were detected. Image support remains deferred/off; no live SAM request or image was sent.

The probe used five fully inspected parser modules copied into this task's audit scratch directory, with only local import suffixes adjusted for Node's TypeScript loader. No upstream package scripts, generators, test suites or application entrypoints were run. The reproducible helper is work/meta-models-audit/sam-parser-probe/probe.mjs. This does not count as a Glimmer, Spark or SAM model result.

### Final coverage and outstanding scope

| Unit | Final state |
|---|---|
| Public repository inventory | Five discovered repositories; pinned inventory retained |
| Branch listings | 107 inventoried; recursive text-source inventory for 104 non-workshop heads |
| Selected public text candidates | 5,514 cached and Git-identity verified |
| Whole-text automated inspection | 5,514 candidates; parsing/signals/article extraction, not full semantic review |
| Newly substantively reviewed variants tracked in this continuation's ledger | 63 |
| Other candidates still pending substantive review in that continuation ledger | 5,451; some files read in earlier turns are documented separately, so this is not an all-history unread count |
| Direct unified diff responses retrieved and statically inspected | 441 |
| Direct diff targets failed | 71: rate-limited PR responses and one server-error response |
| Direct diff targets not attempted | 203 |
| Earlier API PR changed-file inventory | 161 non-workshop PRs, 1,915 entries; missing patches and incomplete substantive review still matter |
| Remaining generated-document review | Extracted distinct bodies/paragraphs are available; not all semantically reviewed |
| Workshop withheld areas | Excluded and untouched |
| Binary/media/linked attachments | Not exhaustively content-reviewed |
| New live Second Seat eval evidence | None |
| Paid inference/cloud/GPU operations | None |
| Sealed holdout access | None |

The continuation's source ledger is intentionally conservative: it marks the 63 newly reviewed variants rather than retroactively crediting every source mentioned in earlier sections. No entire PR or commit receives a completed adversarial-review verdict merely because its diff was downloaded or statically scanned.

The cache cleanup finished: 51 large public diff files representing 9,486,976,451 original bytes were compressed to 881,835,631 bytes, with decompression size and SHA-256 equality verified before deleting only their redundant uncompressed copies inside the owned audit cache. The evidence remains losslessly available. No sealed file was read or hashed in this process.

### What to do with this report

Keep the original G1–G6 small-PR plan as the implementation priority. The highest-value transfers remain exact approval/dispatch boundaries, actual frozen-setting consumption, trustworthy replay/scoring, context/budget edge cases and one complete text-only flow. The reproduced upstream failures make those checks more necessary; they do not justify importing an agent framework, changing the frozen model profile, reopening images, or treating cookbook examples as validated deployment evidence.

The ranking is an evidence-backed backlog from the reviewed material, not a claim that every unused capability in every repository has been found. No hackathon score is increased on the basis of this upstream survey. No implementation change to Second Seat was made during this review.

Paid execution, model inference, Modal/Baseten operations and sealed holdout access remain BLOCKED. The requested full branch-file/diff review remains unfinished, and no exhaustive-review claim is made.

END OF FILE
