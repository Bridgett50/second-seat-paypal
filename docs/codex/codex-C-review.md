**Verdict: 5.20/10 for the proposed stack, versus 5.10 previously. Fix seven PRs before merging.** The engineering improved; buyer evidence and verified live-model value did not. Approval races and evidence-integrity failures still undermine the product’s central promise.

I verified the nine requested heads and their passing CI runs. The stack-tip CI reports **438 unit tests and 41 Playwright tests**. Those numbers are real; several acceptance claims are nevertheless false. [CI evidence](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40465955365)

I inspected public source and ran isolated, dummy-only probes against selected functions and browser code. I did **not** run the repository suite, access sealed data/manifests, invoke models, or use Modal/Baseten.

## (a) Acceptance audit and (b) merge recommendations

**PASS means the stated criterion is supported—not that the whole PR is safe to merge.** Each section uses its requested head. Later fixes are not credited backward.

### #44 — B1, `c2a5f08`: **FIX FIRST**

| ID | Verdict | Evidence |
|---|---|---|
| B1-1 | PASS | Raw edits increment the response sequence and disable Analyze before debounce. [render.ts:792](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/render.ts#L792) |
| B1-2 | PASS | Preview edits immediately invalidate the UI and disable Copy. [render.ts:792](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/render.ts#L792) |
| B1-3 | PASS | Clearing input clears findings, draft, payload and authorization. [session.ts:350](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/session.ts#L350) |
| B1-4 | PASS | A prior approval response is discarded after a **transcript** edit. The browser test genuinely pauses the clock. [b1-acceptance.spec.ts:116](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/e2e/b1-acceptance.spec.ts#L116) |
| B1-5 | PASS | A pending analysis cannot populate the edited preview’s result. [session.ts:553](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/session.ts#L553) |
| B1-6 | PASS | The deferred fake ignores cancellation; generation checks still discard its result. [b1-acceptance.test.ts:162](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/test/b1-acceptance.test.ts#L162) |
| B1-7 | **FAIL** | Correction recovery loses the edit when the preview blurs before invalidation returns. [render.ts:747](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/render.ts#L747) |
| B1-8 | PASS | Invalidation revokes retained gate capabilities and tokens. [session.ts:352](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/session.ts#L352), [test:211](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/test/b1-acceptance.test.ts#L211) |
| B1-9 | PASS | The ordinary no-edit journey still reaches Copy; the existing paste-to-copy suite supplies the clipboard assertion. [b1-acceptance.spec.ts:189](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/e2e/b1-acceptance.spec.ts#L189) |

Three reproduced gaps:

1. **An old draft approval restores an older draft and enables Copy.** Process approval for “Reply A,” hold its response, edit to “Reply B,” blur, then release the response before advancing debounce. Actual result: **“Reply A” restored; Copy enabled.** Draft edits do not advance `seq`; the old response can overwrite the blurred editor. [render.ts:769](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/render.ts#L769), [render.ts:835](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/render.ts#L835)

2. **A stale correction chain creates new approval after revocation.** Process `/correct` for A but hold its response; edit to B and complete `/invalidate`; release the old correction response. The client then issues `/approve` unconditionally. The server accepts only a session ID, without the expected revision or payload hash. Response-discard logic does not undo this server mutation. [render.ts:832](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/render.ts#L832), [server.ts:423](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/server.ts#L423), [session.ts:477](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/session.ts#L477)

3. **A preview correction disappears after blur.** Edit preview A→B, hold the invalidation response, blur, release it. Actual result: **A replaces B, with Approve enabled.** Invalidation does not save the new preview, and rendering protects it only while focused. [session.ts:462](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/session.ts#L462), [render.ts:747](https://github.com/Bridgett50/second-seat-hackathon/blob/c2a5f08/apps/web/src/render.ts#L747)

These tests need delayed **mutation requests and intermediate responses**, not just delayed final responses.

### #45 — B2, `0cb36a2`: **FIX FIRST**

The transport guard is a substantive repair.

| ID | Verdict | Evidence |
|---|---|---|
| B2-1 | PASS | Approval is checked synchronously immediately before fetch after asynchronous preflight. [gate.ts:115](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/src/private/gate.ts#L115) |
| B2-2 | PASS | Expiry uses the injected gate clock at dispatch. [b2-acceptance.test.ts:166](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/test/b2-acceptance.test.ts#L166) |
| B2-3 | PASS | Every retry re-enters the guard; revocation during fake-timer backoff prevents attempt two. [muse.ts:169](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/src/brief/muse.ts#L169), [test:185](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/test/b2-acceptance.test.ts#L185) |
| B2-4 | PASS | Credential, cost, prompt and token refusals produce no transport receipt. [test:201](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/test/b2-acceptance.test.ts#L201) |
| B2-5 | PASS | Invoked fetch followed by rejection remains a recorded transport attempt. [gate.ts:145](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/src/private/gate.ts#L145) |
| B2-6 | PASS | Receipts survive editing while obsolete results are discarded. [session.ts:333](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/apps/web/src/session.ts#L333), [web test:87](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/apps/web/test/b2-acceptance.test.ts#L87) |
| B2-7 | PASS | The receipt itself contains the correct run, revision, payload hash and dispatch time. [gate.ts:131](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/src/private/gate.ts#L131) |
| B2-8 | PASS | The substantive cases run through Muse, Shield and support clients. [test:146](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/test/b2-acceptance.test.ts#L146) |
| B2-9 | PASS | Forged, fixture and mutated capabilities produce no live transport calls. [test:284](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/test/b2-acceptance.test.ts#L284) |

**Remaining blocker: the payload panel contradicts the receipt.**

Pause fake fetch after invocation, then inspect/render the session. The gate contains a dispatch receipt, but the payload remains **“Prepared (not sent)”** until completion. On success, its timestamp is completion time; on failure/supersession, it uses preflight time. [session.ts:509](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/apps/web/src/session.ts#L509), [session.ts:544](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/apps/web/src/session.ts#L544), [session.ts:632](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/apps/web/src/session.ts#L632), [render.ts:681](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/apps/web/src/render.ts#L681)

Minimal test: preflight at `t0`, fetch at `t1`, completion at `t2`. Every displayed dispatch timestamp must be `t1`; the pending snapshot must say transport invoked, outcome pending.

**The `/tmp` issue is real.** Both older tests use persistent fixed filenames; the cost guard rejects after the stored count reaches 50. Preseed today’s state with `calls:50` and the positive tests fail before fake fetch. New B2 tests are isolated, but the old suites remain non-hermetic. [gate.test.ts:410](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/test/gate.test.ts#L410), [approval-boundary.test.ts:196](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/test/approval-boundary.test.ts#L196), [costGuard.ts:146](https://github.com/Bridgett50/second-seat-hackathon/blob/0cb36a2/services/bot/src/brief/costGuard.ts#L146)

### #46 — B4, `08208ca`: **FIX FIRST**

**Strict replay is optional. That defeats the main purpose of this PR.**

| ID | Verdict | Evidence |
|---|---|---|
| B4-1 | **FAIL** | Omitting `parseAnswer` selects the old path and trusts saved totals. Dummy probe returned **99/1** coverage. [rescore-glimmer-run.mjs:380](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/scripts/rescore-glimmer-run.mjs#L380) |
| B4-2 | **FAIL** | Default replay skips integrity checks. Strict replay hashes only final content, although mutable `error` and `finish_reason` affect scoring. [rescorer:277](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/scripts/rescore-glimmer-run.mjs#L277), [rescorer:304](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/scripts/rescore-glimmer-run.mjs#L304) |
| B4-3 | **FAIL** | Duplicate raw receipts overwrite; malformed raw lines disappear; unexpected raw receipts are ignored. [rescorer:243](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/scripts/rescore-glimmer-run.mjs#L243) |
| B4-4 | PASS | Missing planned records prevent complete status. [rescorer:239](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/scripts/rescore-glimmer-run.mjs#L239), [test:248](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/test/b4-acceptance.test.ts#L248) |
| B4-5 | **FAIL** | Default replay accepts an unknown terminal status. Probe: `status:"weird"` → `ok:true, complete:true`. [rescorer:380](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/scripts/rescore-glimmer-run.mjs#L380) |
| B4-6 | PASS | Client and strict replay share the parser; fenced/plain answers preserve labels and scores. [test:283](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/test/b4-acceptance.test.ts#L283) |
| B4-7 | PASS | Reasoning-only output remains a failure. [redact.ts:593](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/src/private/redact.ts#L593), [test:313](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/test/b4-acceptance.test.ts#L313) |
| B4-8 | PASS | Actual runner/replay tests retain 1/2 completion, 5/5 completed coverage and 5/10 full coverage. [test:328](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/test/b4-acceptance.test.ts#L328) |
| B4-9 | PASS | Valid empty predictions score zero coverage. [test:343](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/test/b4-acceptance.test.ts#L343) |
| B4-10 | PASS | Failed canary writes explicit `not_run` records for the remainder. [runner:372](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/scripts/redaction-eval-runner.mjs#L372) |
| B4-11 | **FAIL** | Truncation changes outer `complete`, but returned `output.complete` and `summary.complete` can remain true. [rescorer:329](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/scripts/rescore-glimmer-run.mjs#L329) |
| B4-12 | PASS | The explicitly selected strict API reproduces unchanged evidence without inference or writes. This does not validate the default API or CLI. [test:131](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/test/b4-acceptance.test.ts#L131) |

Minimal reproductions, executed with newly made-up evidence:

- Call default replay after altering saved coverage → **99/1**.
- Set terminal status to `"weird"` → **complete**.
- Duplicate a raw receipt → **complete, no error**.
- Change only `raw.error`, keeping recorded content hash → coverage changes **1/1→0/1**, without integrity failure.
- Append a torn line after all valid records → outer completion false, nested completion true.

The tests mostly select the strict branch and mutate terminal records rather than raw-receipt cardinality. The truncation test removes a required case, which masks the contradictory-completion bug. [b4-acceptance.test.ts:217](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/test/b4-acceptance.test.ts#L217), [test:371](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/test/b4-acceptance.test.ts#L371)

**At this exact PR head, the CLI also ignores `--run-dir` and runs the historical writer.** #47 fixes that CLI branch; #46 cannot claim it. [rescorer:467](https://github.com/Bridgett50/second-seat-hackathon/blob/08208ca/services/bot/scripts/rescore-glimmer-run.mjs#L467)

### #47 — B5, `b493b6b`: **FIX FIRST**

Compile-checking this app did not establish its launch/download contract.

| ID | Verdict | Evidence |
|---|---|---|
| B5-1 | PASS | Selected dataset feeds packaging and evaluation-command construction. This proves selection wiring, not deployment readiness. [glimmer_app.py:42](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/glimmer_app.py#L42), [app:177](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/glimmer_app.py#L177) |
| B5-2 | PASS | Local gate rejects invoked/configured dataset disagreement and substituted bytes. [launch_contract.py:99](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/launch_contract.py#L99) |
| B5-3 | **FAIL** | A trailing, valueless `--cases` passes the presence check and falls back to development fixtures. [redaction-eval.mjs:39](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/scripts/redaction-eval.mjs#L39) |
| B5-4 | **FAIL** | Actual downloader supplies Modal `FileEntry` objects; helper expects strings. [glimmer_app.py:258](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/glimmer_app.py#L258), [launch_contract.py:139](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/launch_contract.py#L139) |
| B5-5 | **FAIL** | Artificial string-based download replays, but the real wrapper cannot produce that bundle. [b5-acceptance.test.ts:196](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/test/b5-acceptance.test.ts#L196) |
| B5-6 | **FAIL** | Source/image/model pins are checked superficially and then not applied to execution. [launch_contract.py:121](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/launch_contract.py#L121), [glimmer_app.py:244](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/glimmer_app.py#L244) |
| B5-7 | PASS | A completed attestation passes the new helper. The older freeze helper still has a conflicting pending-review requirement. [launch_contract.py:73](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/launch_contract.py#L73), [holdout-freeze.mjs:34](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/scripts/holdout-freeze.mjs#L34) |
| B5-8 | PASS | Fake time genuinely advances; model readiness consumes the work budget. [launch_contract.py:188](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/launch_contract.py#L188), [test:271](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/test/b5-acceptance.test.ts#L271) |
| B5-9 | **FAIL** | Deadline is checked for later cases, but not before the canary after input preparation. [runner:357](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/scripts/redaction-eval-runner.mjs#L357), [runner:395](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/scripts/redaction-eval-runner.mjs#L395) |
| B5-10 | PASS | Local simulated incomplete output is recoverable. This does not prove subprocess-kill or Modal-volume durability. [test:311](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/test/b5-acceptance.test.ts#L311) |
| B5-11 | **FAIL** | Existing suite tests still read/copy sealed fixtures. New check scans only itself and the launch helper. [holdout-freeze.test.ts:30](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/test/holdout-freeze.test.ts#L30), [b5 test:345](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/test/b5-acceptance.test.ts#L345) |
| B5-12 | PASS | Documented command construction agrees, and the new replay CLI exists. Regex/compile checks do not prove the command succeeds end to end. [test:353](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/test/b5-acceptance.test.ts#L353), [rescorer:470](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/scripts/rescore-glimmer-run.mjs#L470) |

Concrete failures:

- **Validated configuration is discarded.** The app still uses `vllm/vllm-openai:muse-glimmer`; its vLLM command contains no model revision; `spawn()` receives only the dataset. A valid-looking frozen configuration does not freeze the actual execution. [glimmer_app.py:29](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/glimmer_app.py#L29), [app:112](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/glimmer_app.py#L112), [app:244](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/glimmer_app.py#L244)

- **Placeholder validation remains bypassable.** Dummy configuration with model revision of forty zeros, reviewer `" "`, and review date `"not-a-date"` returned no blockers. Source validation checks shape, not equality to the built source. [launch_contract.py:73](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/launch_contract.py#L73), [contract:121](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/infra/modal/launch_contract.py#L121)

- **Downloader mock has the wrong contract.** A fake SDK-shaped entry such as `FileEntry(path="run-1/manifest.json", …)` causes `ValueError`. Modal documents entries with `.path`, and recursive listings include directories. The test provides already-normalized strings. [test:172](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/test/b5-acceptance.test.ts#L172), [Modal Volume reference](https://modal.com/docs/sdk/py/latest/Volume)

- **Expired budget still dispatches the canary.** Advance the fake clock past the deadline during input reading. Actual probe: one redactor call, statuses `[ok, not_run]`; expected: zero calls, all `not_run`. [runner:232](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/scripts/redaction-eval-runner.mjs#L232)

- **“No sealed data accessed” is not supported for the reported full-suite command.** One existing test imports a helper that reads sealed inputs; another explicitly copies them. I inspected only those source instructions, not their target files. [holdout-dry-run.test.ts:5](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/test/holdout-dry-run.test.ts#L5), [holdout-freeze.test.ts:36](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/test/holdout-freeze.test.ts#L36)

Also replace the interruption test’s 20,000-iteration polling loop and abandoned promise with an explicit deferred notification and cleanup. [b5-acceptance.test.ts:311](https://github.com/Bridgett50/second-seat-hackathon/blob/b493b6b/services/bot/test/b5-acceptance.test.ts#L311)

### #48 — B3, `067f7ab`: **FIX FIRST**

| ID | Verdict | Evidence |
|---|---|---|
| B3-1 | PASS | `{entries:[]}` without required root fields is rejected. [session.ts:262](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/apps/web/src/session.ts#L262) |
| B3-2 | **FAIL** | Nested citation `region` is only checked as object/null, not against the closed schema. [session.ts:349](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/apps/web/src/session.ts#L349) |
| B3-3 | **FAIL** | Production explicitly accepts wrong meeting ID `"m"`. [session.ts:266](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/apps/web/src/session.ts#L266) |
| B3-4 | PASS | Unknown segment IDs and unsupported frames are rejected. [session.ts:353](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/apps/web/src/session.ts#L353) |
| B3-5 | PASS | Uncited entries require an explicit `missing_source` flag, which is preserved. [session.ts:368](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/apps/web/src/session.ts#L368) |
| B3-6 | PASS | A valid empty response yields the honest empty state. [test:211](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/apps/web/test/b3-acceptance.test.ts#L211) |
| B3-7 | PASS | Invalid/non-JSON live output becomes an error without fixture substitution. [test:219](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/apps/web/test/b3-acceptance.test.ts#L219) |
| B3-8 | PASS | Configured Glimmer, gate and Muse run together through fake HTTP, with approval required before Spark. [test:231](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/apps/web/test/b3-acceptance.test.ts#L231) |
| B3-9 | PASS | Exact segment-prefixed meeting text and the serialized request are checked. [test:301](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/apps/web/test/b3-acceptance.test.ts#L301) |
| B3-10 | PASS | Test mode forces offline despite credentials/live settings. [test:324](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/apps/web/test/b3-acceptance.test.ts#L324) |

Two minimal failing cases were executed against the actual validator:

- Expected meeting `"actual-session"`; otherwise-valid answer has meeting `"m"` → **accepted**.
- Correct meeting; valid `seg-1`; citation has `region: {box:123, unexpected:true}` → **accepted**.

The first is an intentional production exception for old tests. Remove it; fix the fixtures. The second contradicts the shared nested schema. [schema.ts:159](https://github.com/Bridgett50/second-seat-hackathon/blob/067f7ab/packages/core/src/evidence/schema.ts#L159)

### #49 — B6, `2477d2e`: **FIX FIRST**

| ID | Verdict | Evidence |
|---|---|---|
| B6-1 | PASS | Fixture assessments quote a substring of a current approved segment. [session.ts:211](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/session.ts#L211) |
| B6-2 | PASS | Fabricated quotes and wrong/unknown segments are rejected. [test:95](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/test/b6-acceptance.test.ts#L95) |
| B6-3 | PASS | Public development fixtures contain pressure, urgency, negotiation and neutral cases. Their presence is not classifier accuracy. [pressure-dev-cases.json:1](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/fixtures/pressure-dev-cases.json#L1) |
| B6-4 | PASS | A neutral classification produces no badge. [test:126](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/test/b6-acceptance.test.ts#L126) |
| B6-5 | **FAIL** | Editing clears review, but a delayed old acknowledgement can review the new assessment. [session.ts:1004](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/session.ts#L1004) |
| B6-6 | **FAIL** | That stale acknowledgement can enable Copy for the new draft. [session.ts:624](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/session.ts#L624) |
| B6-7 | PASS | Valid zero-pressure cases remain usable. [test:176](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/test/b6-acceptance.test.ts#L176) |
| B6-8 | PASS | Fixture/pattern assessments are labeled offline, without model-accuracy claims. [test:184](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/test/b6-acceptance.test.ts#L184) |

Additional gaps:

1. **Old review requests approve new findings.** Item IDs restart at `p1`. Capture A’s `{sessionId,itemId:"p1"}`, edit and analyze B, then deliver A’s request. Actual probe: B changes from unreviewed to reviewed, enabling its stored draft approval. Bind acknowledgements to **revision and assessment identity**, including same-text reanalysis. [session.ts:226](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/session.ts#L226), [server.ts:513](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/server.ts#L513)

2. **Unchecking “Reviewed” does not revoke review.** The handler returns when unchecked. Minimal browser test: review → approve draft → uncheck → expect Copy disabled and server acknowledgement revoked. Current behavior fails. [render.ts:844](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/render.ts#L844)

3. **Classifier failure becomes an invisible negative assessment.** Throw from the classifier: the catch converts it to `[]`, which becomes `allReviewed:true`; the UI renders nothing. Require a visible unavailable/error state. [session.ts:907](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/session.ts#L907), [render.ts:625](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/render.ts#L625)

4. **Live mode performs no pressure classification by default.** It produces an empty `source:"none"` assessment. This earns no live Meta pressure-analysis credit. [server.ts:205](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/server.ts#L205), [session.ts:935](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/session.ts#L935)

5. **“Unresolved term” can just repeat the pressure sentence.** The default classifier places the entire line in `ask`, then copies it into `unresolvedTerm`. An injected classifier can supply unrelated text. Show “term not identified” unless the term has actual provenance. [session.ts:195](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/session.ts#L195), [session.ts:230](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/src/session.ts#L230)

6. **The default-pattern test can pass without any detection.** It loops over possibly empty items; its sentence matches none of the implemented patterns. Require a known positive’s exact item and a neutral negative. [test:194](https://github.com/Bridgett50/second-seat-hackathon/blob/2477d2e/apps/web/test/b6-acceptance.test.ts#L194)

### #50 — B7, `b536174`: **FIX FIRST**

| ID | Verdict | Evidence |
|---|---|---|
| B7-1 | PASS | A1–A3 criteria are present and explicitly labeled reconstructed. They are not the recovered original wording. [rescue-plan.md:15](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/docs/rescue-plan.md#L15) |
| B7-2 | **FAIL** | Table exists, but blanket A1–A9 “offline verified” is not an accurate acceptance-status account. [README.md:19](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L19) |
| B7-3 | PASS | Offline narration no longer credits its simulated redaction/brief to Glimmer or Spark. [video-script.md:13](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/docs/submission/video-script.md#L13) |
| B7-4 | **FAIL** | “Spark brief + Shield” and the closing pressure claim overstate the connected live workflow. [README.md:51](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L51), [video-script.md:20](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/docs/submission/video-script.md#L20) |
| B7-5 | PASS | Copy-button scope replaces “cannot leave.” The remaining behavioral races are documented above. [README.md:7](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L7) |
| B7-6 | **FAIL** | Remote hosting is named, but README falsely says **approved** text goes to Glimmer. Raw input goes to the redactor before approval; approved text goes to Spark. [README.md:13](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L13), [liveConfig.ts:47](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/apps/web/src/liveConfig.ts#L47) |
| B7-7 | PASS | Historical failures remain visible. I compared the two committed artifact blobs with the baseline: unchanged. The test-time mutation remains a separate defect. [README.md:79](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L79) |
| B7-8 | PASS | Counts match the linked B6-head CI logs: 65/24/200/130 unit tests and 41 browser tests. [README.md:81](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L81), [CI](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40464552140) |
| B7-9 | PASS | README explicitly calls the spending limit estimate-based, not a billing guarantee. Fix the separate allocation-timing wording below. [README.md:89](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L89) |
| B7-10 | PASS | Startup command and `/session` are documented; package script and CI browser-server command agree. [README.md:107](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L107), [playwright.config.ts:12](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/apps/web/playwright.config.ts#L12) |
| B7-11 | PASS | Founder story, observations and video URLs remain pending. [README.md:43](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L43) |

Claims still needing correction:

- **“Second Seat sends nothing.”** It sends browser requests and, in live mode, model requests. Say “It does not send replies to vendors.” [README.md:7](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L7)
- **“In live mode the approved text is sent to the Glimmer endpoint…”** Wrong boundary. Explicitly disclose raw text → private Modal redactor; reviewed redacted text → Spark. [README.md:13](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L13)
- **“Spark brief + Shield.”** Default live pressure classifier is absent. Distinguish Spark analysis from offline pattern checks and advisory draft checks. [README.md:51](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L51)
- **“Other tools summarize your meeting. Second Seat shows who is pressuring you, and how.”** No comparative evidence; intent attribution exceeds a quote-linked assessment. [video-script.md:20](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/docs/submission/video-script.md#L20)
- **“Sealed before generation … seal PENDING.”** Specify which dataset/status each clause describes. I did not inspect the seal. [README.md:85](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L85)
- **“780 s … plus … model load, ready wait…”** Load/readiness consume the work deadline; total billed allocation is a separate measurement. [README.md:89](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L89)
- The video shows pressure items, then enables Copy without explicitly showing their review action. Add that action to the beat sheet. [video-script.md:15](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/docs/submission/video-script.md#L15)
- The reconstructed A-plan still has a **“verbatim”** heading. Label the document’s provenance accurately. [rescue-plan.md:1](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/docs/rescue-plan.md#L1)

**Test weakness:** B7 tests check the existence of words, links and table rows—not their truth. “Pressure,” “review,” and “Copy” on one line cannot prove the described workflow. [b7-docs.test.ts:26](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/apps/web/test/b7-docs.test.ts#L26)

The historical-rescore test still overwrites tracked evidence with a new timestamp; B7 works around that by excluding `generatedAt` from its comparison. Stop the write instead. [glimmer-eval.test.ts:151](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/services/bot/test/glimmer-eval.test.ts#L151), [rescorer:124](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/services/bot/scripts/rescore-glimmer-run.mjs#L124), [b7-docs.test.ts:56](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/apps/web/test/b7-docs.test.ts#L56)

The reported hand-edited status line is **not a technical defect**. “Built with Muse Code” does not claim exclusive authorship. Do not turn it into “every line was written by Muse.” [README.md:95](https://github.com/Bridgett50/second-seat-hackathon/blob/b536174/README.md#L95)

### #51 — B8, `e0721dd`: **MERGE its own documentation changes**

| ID | Verdict | Evidence |
|---|---|---|
| B8-1 | PASS | Scenarios are explicitly fictional and separate from sealed data. [scenarios.md:3](https://github.com/Bridgett50/second-seat-hackathon/blob/e0721dd/docs/buyer-evidence/scenarios.md#L3) |
| B8-2 | PASS | Buyer and review/reply task are defined. [protocol.md:7](https://github.com/Bridgett50/second-seat-hackathon/blob/e0721dd/docs/buyer-evidence/protocol.md#L7) |
| B8-3 | PASS | Baseline/assistant conditions and rotated assignments are specified. Difficulty matching is a design assumption, not measured equivalence. [protocol.md:17](https://github.com/Bridgett50/second-seat-hackathon/blob/e0721dd/docs/buyer-evidence/protocol.md#L17) |
| B8-4 | PASS | Time, mistakes, missed terms, confusion and reuse intent have fields. [evidence-template.md:5](https://github.com/Bridgett50/second-seat-hackathon/blob/e0721dd/docs/buyer-evidence/evidence-template.md#L5) |
| B8-5 | PASS | Negative observations and failures have an explicit section. [evidence-template.md:29](https://github.com/Bridgett50/second-seat-hackathon/blob/e0721dd/docs/buyer-evidence/evidence-template.md#L29) |
| B8-6 | PASS | Observations, quotes and interpretation are separated. [evidence-template.md:15](https://github.com/Bridgett50/second-seat-hackathon/blob/e0721dd/docs/buyer-evidence/evidence-template.md#L15) |
| B8-7 | PASS | Template is blank; fabrication is prohibited; human recruitment is assigned. [protocol.md:30](https://github.com/Bridgett50/second-seat-hackathon/blob/e0721dd/docs/buyer-evidence/protocol.md#L30) |
| B8-8 | PASS | Small usability sample is explicitly not market validation. [protocol.md:40](https://github.com/Bridgett50/second-seat-hackathon/blob/e0721dd/docs/buyer-evidence/protocol.md#L40) |

These are preparation criteria. They earn **no measured-impact credit yet**. Change “matched in difficulty” to “designed to have comparable structure; difficulty not yet validated.” [scenarios.md:5](https://github.com/Bridgett50/second-seat-hackathon/blob/e0721dd/docs/buyer-evidence/scenarios.md#L5)

### #52 — B9/B10 preparation, `059362d`: **MERGE as preparation only**

This PR has no additional B1–B8 acceptance IDs. Its documents honestly leave readiness, execution and release evidence pending. That is appropriate. It does **not** establish B9 readiness or B10 completion. [B9 checklist:13](https://github.com/Bridgett50/second-seat-hackathon/blob/059362d/docs/release/b9-evidence-run-prep.md#L13), [B10 checklist:11](https://github.com/Bridgett50/second-seat-hackathon/blob/059362d/docs/release/b10-demo-freeze-prep.md#L11)

Before using it operationally:

- “`check_launch` returns no blockers” must not substitute for proving that execution consumes the frozen configuration.
- One Spark request with no retries needs an executable configuration and test, not a checklist entry.
- Replace “Second Seat sends nothing” in the freeze checklist.
- Keep actual release/video/link checks pending. [B9:24](https://github.com/Bridgett50/second-seat-hackathon/blob/059362d/docs/release/b9-evidence-run-prep.md#L24), [B9:37](https://github.com/Bridgett50/second-seat-hackathon/blob/059362d/docs/release/b9-evidence-run-prep.md#L37), [B10:15](https://github.com/Bridgett50/second-seat-hackathon/blob/059362d/docs/release/b10-demo-freeze-prep.md#L15)

“Merge” for #51/#52 means their own documentation changes are acceptable. It does not approve merging their broken ancestors wholesale.

**On mutation-test claims:** I did not independently rerun the claimed pre-change mutation suites. Some existing-behavior regression tests legitimately pass pre-change. Conversely, tests failing because a new file did not exist do not establish behavioral protection. The reproduced counterexamples above matter more than the reported mutation totals.

## (c) Rescored rubric

This scores the proposed stack, not unmerged changes as though they were already on main.

| Category | Previous | Now | Reason |
|---|---:|---:|---|
| Impact — 30% | 3.0 | **3.0** | A protocol exists; observed buyer benefit, founder story and adoption evidence remain absent. |
| Meta AI Tooling — 25% | 6.0 | **6.0** | Better adapter tests, but no new live evidence; pressure analysis is absent from default live mode. |
| Technical Depth — 20% | 6.0 | **6.5** | Real dispatch-time authorization and strict replay improvements earn credit. Remaining mutation races, unsafe replay fallback and unapplied runtime pins prevent a higher score. |
| Demo — 25% | 6.0 | **6.0** | The offline journey exists, but stale approvals, pressure-review defects, incorrect narration and no finished video remain. |
| **Weighted total** | **5.10** | **5.20** | **+0.10** |

The biggest obstacle to first place is still **a demonstrated improvement in a buyer’s decision using the actual Meta-powered workflow**. More passing tests alone cannot supply that evidence.

## (d) Smallest ordered next plan

Keep these as focused PRs. All dollar figures below concern infrastructure/model execution; Muse Code authoring usage is separate.

### C1 — Bind every approval mutation to the exact revision

**Scope:** session/store routes, browser handlers, pressure acknowledgements.  
**Estimate:** 3–5 hours; **$0; no live run or human input required.**

Acceptance:

1. Held draft-approval response A cannot overwrite draft B or enable Copy after edit and blur.
2. Held `/correct` response cannot trigger approval after a newer invalidation.
3. A delayed mutation request with an old expected revision/hash is rejected without changing state.
4. Preview B survives blur and delayed invalidation response.
5. Old pressure acknowledgement fails after editing **and after same-text reanalysis**.
6. Unchecking Reviewed revokes it and disables Copy.
7. No-edit paste-to-exact-clipboard control still passes.

Use deferred requests/responses and paused clocks. Test the server mutation as well as the rendered result.

### C2 — Make the payload panel derive from transport receipts

**Scope:** session payload/history and rendering.  
**Estimate:** 1–2 hours; **$0; offline.**

Acceptance:

1. Before fetch: no dispatched receipt.
2. After fetch invocation, before response: visibly “transport invoked; outcome pending.”
3. Preflight `t0`, fetch `t1`, completion `t2`: all dispatch displays use `t1`.
4. Fetch rejection retains attempted dispatch; no success claim.
5. Edit-after-dispatch preserves the historical receipt and discards the obsolete result.
6. Revocation during retry preserves attempt one and prevents attempt two.

### C3 — Enforce the actual shared response schema

**Scope:** analysis validator and fixtures.  
**Estimate:** 1–2 hours; **$0; offline.**

Acceptance:

1. Wrong meeting `"m"` is rejected, just like every other wrong ID.
2. Missing, extra and wrongly typed nested citation-region fields are rejected.
3. Parameterized cases exercise the shared schema rather than a separate approximation.
4. Correct response and valid empty response remain accepted.
5. Existing composed Glimmer→approval→Spark fake-HTTP test still passes.

### C4 — Make strict replay the only new-run replay path

**Scope:** rescorer, receipt schema and runner tests.  
**Estimate:** 2–4 hours; **$0; dummy data only.**

Acceptance:

1. Default API and CLI independently reconstruct totals; altered saved totals cannot yield 99/1.
2. Unknown/missing statuses are rejected.
3. Full scoring-relevant receipt content is integrity checked.
4. Duplicate, unexpected and malformed raw receipts are rejected or explicitly reported incomplete—never silently discarded.
5. Torn trailing data makes **every** completion field false.
6. Unchanged evidence reproduces metrics/report without inference or writes.
7. Legacy replay is explicitly separate and cannot silently overwrite tracked historical evidence.
8. CLI exit/status semantics distinguish integrity failure, incomplete evidence and saved-report mismatch.

### C5 — Test the actual Modal application wiring without Modal

**Scope:** launch configuration, application construction, downloader, deadline/CLI edges.  
**Estimate:** 3–5 hours; **$0; no Modal import that contacts/builds remotely.**

Acceptance:

1. Stubbed image construction receives the frozen digest.
2. Captured vLLM arguments contain the frozen model revision.
3. Recorded source identity matches the packaged code; changing it blocks launch.
4. Missing/valueless `--cases`, zero revision, blank reviewer and invalid review date fail before dispatch.
5. SDK-shaped listing objects, directories and nested files download correctly; escaping paths fail.
6. Downloaded dummy bundle passes C4 replay.
7. Expiry during input preparation produces **zero requests**, including no canary; all cases become `not_run`.
8. Old/new freeze helpers use one consistent attestation contract.
9. A simulated process interruption is cleaned up deterministically and leaves honest incomplete evidence.

The real holdout remains untouched.

### C6 — Make the offline suite hermetic

**Scope:** old holdout tests, shared `/tmp` state, historical writer tests.  
**Estimate:** 1–2 hours; **$0; no sealed access.**

Acceptance:

1. Every development/CI harness test uses newly created dummy data.
2. A filesystem guard fails any attempted read/copy/hash of actual sealed paths.
3. Existing fixed `/tmp` files preseeded at the daily cap do not affect tests and remain unchanged.
4. Two consecutive runs pass.
5. Tracked historical evidence is byte-for-byte unchanged after tests.
6. Replace sleep/poll-loop interruption tests with deferred signals and explicit cleanup.

Do this **before** running the broad suite again under the current restrictions.

### C7 — Make pressure availability honest; connect one useful live result

**Scope:** analysis/pressure contract, renderer and public development tests.  
**Estimate:** 2–4 hours; **$0 for implementation/testing.**

Acceptance:

1. Distinguish `not_run`, `failed`, valid negative and valid positive.
2. Absent/throwing classifier is visible and cannot masquerade as “no pressure found.”
3. An unresolved term has provenance, or displays “not identified.”
4. Actual default-path tests assert an exact nonempty positive and neutral negatives.
5. Browser test covers review, unreview and Copy gating.
6. If pressure is part of the live pitch, include its structured assessment in the **existing approved Spark request**, with fake-HTTP proof. Do not quietly add another paid request.

This is the one product capability worth finishing. Cut additional models, SAM, dashboards and provider migration.

### C8 — Reconcile claims and collect buyer evidence

**Scope:** README/submission documents plus completed observation records.  
**Estimate:** 1–2 hours documentation, plus human sessions; **$0 tooling; human input required.**

Acceptance:

1. Correct raw→Glimmer and approved-redacted→Spark boundaries.
2. Replace blanket verification with criterion-level status.
3. Remove unsupported comparative/intent claims and fixture-latency sales claims.
4. Record at least three intended-buyer task sessions using made-up, nonsealed scenarios.
5. Preserve baseline and assistant results, negative observations, mistakes and missed terms.
6. Show one concrete decision/reply improvement if observed; report failure if none occurs.
7. Founder supplies the actual story. No invented savings, quotes or willingness to pay.

Run the human work alongside C1–C7 once the usable flow is stable.

### C9 — One bounded evidence run, then release

**Scope:** frozen run configuration, receipts/results, final demo and release manifest.  
**Estimate:** approximately half a day preparation/review plus recording; **separate human authorization and live execution required.**

Before authorization:

- C1–C7 pass.
- Independently authorized human review of the actual holdout is complete.
- Actual source/image/model/prompt/scorer/settings are frozen and consumed by execution.
- One-attempt Spark configuration is tested against retryable fake failures.
- Any extra demo redaction request is explicitly included in the allocation plan.

Authorized-run acceptance:

1. One Modal allocation; scored canary; declared concurrency, token limits and deadlines; no automatic rerun.
2. One owner-approved Spark request, no automatic retry.
3. Complete attempt records and truthful dispatch receipts.
4. Downloaded evidence replays independently.
5. Publish failures and full planned denominators.
6. Record actual cost and teardown; partner verification remains pending until received.

Retain the **proposed $2.10 ceiling: $2 Modal + $0.10 Spark**, subject to authorization and actual allocation controls. At current listed rates, 15 minutes of A100-80 GPU time alone is about **$0.62**, excluding CPU, memory and other allocation time. A Spark request capped at 10k input and 16k output tokens is about **$0.081** at standard rates. Neither estimate is a hard billing guarantee. [Modal pricing](https://modal.com/pricing), [Meta pricing](https://dev.meta.ai/models/muse-spark)

Then freeze one release, record a ≤3-minute video showing one buyer’s problem, one meaningful correction, approved payload, resolving citation, exact draft approval and clipboard result. Verify every submission link before **November 4, 3 PM CT**.

**No engineering checklist can promise a first-place score.** C1–C7 remove credibility failures. C8 and C9 determine whether there is a competitive startup entry to show.

END OF FILE
