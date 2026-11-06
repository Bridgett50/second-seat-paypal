# Second Seat — adversarial re-review of C1–C9

**Verdict: 5.55/10, up 0.35 from 5.20. The stack repairs several real failures, but approval, payload provenance, live UI receipts, and run identity still have reproducible gaps. Do not authorize C9 yet.**

This is a review of the specified draft heads, not an endorsement of main or a prediction of the hackathon result. The increase is for demonstrated engineering repairs and a more usable offline flow. There is no new live-model, partner-verification, customer-demand, or outcome evidence credited here.

## 1. Scope, score, and verification standard

### Exact revisions

| PR | Work | Reviewed head | Immediate base | CI observed at that head |
|---|---|---|---|---|
| [#53](https://github.com/Bridgett50/second-seat-hackathon/pull/53) | C6 isolation | `7efcae01fa594a564165a69a2d065f86d9c15d03` | `059362d9e43186b2cf4b3207e3b3ee242549877b` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40477442184) |
| [#54](https://github.com/Bridgett50/second-seat-hackathon/pull/54) | C1 approval revisions | `8d1ca970b1993b34112f1276b9915eb2219b0b7a` | `7efcae01fa594a564165a69a2d065f86d9c15d03` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40479067260) |
| [#55](https://github.com/Bridgett50/second-seat-hackathon/pull/55) | C2 receipts | `2617b7978363963e5126d8e4ca643f176cecfd5f` | `8d1ca970b1993b34112f1276b9915eb2219b0b7a` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40479898486) |
| [#56](https://github.com/Bridgett50/second-seat-hackathon/pull/56) | C3 response validation | `fb4c216d60b08aef4308a05f25250b5f8adfa925` | `2617b7978363963e5126d8e4ca643f176cecfd5f` | [failure](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40480594570) |
| [#57](https://github.com/Bridgett50/second-seat-hackathon/pull/57) | C4 replay | `b383e12615b5df48866c7f276d1095d7f116850c` | `fb4c216d60b08aef4308a05f25250b5f8adfa925` | [failure](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40484194423) |
| [#58](https://github.com/Bridgett50/second-seat-hackathon/pull/58) | C5 launch/download | `789ab3c3475145404484f39c428883dcc78557b7` | `b383e12615b5df48866c7f276d1095d7f116850c` | [failure](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40484954956) |
| [#59](https://github.com/Bridgett50/second-seat-hackathon/pull/59) | C7 pressure + build repair | `1153dd8f6aae575a8f46788b9bf3432d28e43817` | `789ab3c3475145404484f39c428883dcc78557b7` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40486174227) |
| [#60](https://github.com/Bridgett50/second-seat-hackathon/pull/60) | C8 documentation | `f7a91a15571c179d5cc5bf4a3c86e866576bb7dd` | `1153dd8f6aae575a8f46788b9bf3432d28e43817` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40486722259) |
| [#61](https://github.com/Bridgett50/second-seat-hackathon/pull/61) | C9 preparation | `c6829e3c2a1b12de73878b2462d6d3014542bdac` | `f7a91a15571c179d5cc5bf4a3c86e866576bb7dd` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40487213560) |

All nine PRs were open drafts when inspected. #53 is immediately based on the earlier B-stack tip, 059362d, not directly on cd0223a. Main cd0223a is the stated underlying baseline. I used the preceding relevant implementation for behavioral before/after comparisons; comparing every C fix only with main would conflate B and C changes.

I read the full supplied verification prompt and the C implementation prompt. The verification prompt's obsolete PR #44–#52/B-table scope is superseded by your explicit #53–#61 scope; its adversarial method and all 28 counterexamples are applied below.

### What I actually did

- Fetched allowlisted source, public tests, configuration, documentation, PR metadata, and CI metadata at the pinned commits. No whole-repository clone.
- Compared the key session, renderer, replay, Modal application, launch contract, workflow, README, and video-script sources with c6829e3. The cited defects in those files persist at the tip.
- Executed isolated Node probes against transpiled, pinned TypeScript modules and the real embedded browser JavaScript. Imports were relocated into an isolated source-only harness; production decision logic was retained. Browser probes used a minimal DOM/fetch harness, not a claimed Playwright run.
- Used controlled deferred responses and a timer queue that was **not advanced** for the draft/preview races. This explicitly exercised the pre-debounce interval.
- Executed the replay API and CLI with newly invented dummy bundles and fake Glimmer HTTP responses. Tested old default replay and, where relevant, the old optional strict branch.
- Imported the actual old/new Python application files under an inert SDK-shaped Modal stub. Captured image references and vLLM argument lists, exercised the download wrapper, and tested config drift. No real Modal SDK, model process, image build, allocation, or remote call was used.
- Executed fake Spark transport probes for unapproved auxiliary text and the one-attempt proof configuration.
- Inspected the failed #56 job: typecheck and unit tests passed; build failed with “Cannot find module …/apps/web/dist/src/build.js”; browser tests were skipped. This matches the relative-import/output-root defect.

**Limits:** I did not run the full repository suite, named Vitest suites, or Playwright. I did not run every named regression on both historical checkouts. “Before/after confirmed” below means an independently executed equivalent behavioral probe, not a claim that the repository's named test was run. Static checks and unexecuted regressions are identified explicitly. I cannot honestly certify old-fail/new-pass for all 28 cases.

No sealed input, sealed manifest, or holdout was opened, copied, hashed, regenerated, or inspected. No gen/make.py, paid inference, Modal operation, or Baseten call was performed. All probe meeting content was invented. The guard probe only classified nonexistent path strings; it did not read those paths.

### Rescored rubric

| Judge | Previous | Now | Weighted contribution | Basis |
|---|---:|---:|---:|---|
| Impact, 30% | 3.0 | **3.0** | 0.90 | A buyer problem is asserted, but founder story, user observations, and video remain explicitly pending: [README.md:46](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/README.md#L46). No demonstrated adoption, avoided loss, or time saving earns points. |
| Meta AI Tooling, 25% | 6.0 | **6.0** | 1.50 | Real adapter architecture and historical Glimmer evidence exist, but the repaired live path is explicitly unexecuted: [README.md:13](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/README.md#L13). Default pressure detection is deterministic code, not a new demonstrated Meta-model capability: [apps/web/src/session.ts:984](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L984). |
| Technical Depth, 20% | 6.5 | **7.0** | 1.40 | Actual fixes to identity-bound reviews, strict response validation, raw-evidence replay, and deadline handling deserve credit. The reproduced auxiliary-field bypass, config drift, and approval resurrection prevent a higher score. See findings F1–F8. |
| Demo, 25% | 6.0 | **7.0** | 1.75 | The original preview/draft races are materially improved; the script now includes review and exact-draft copy in one session: [docs/submission/video-script.md:12](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/docs/submission/video-script.md#L12). This is credit for the implemented flow and improved script, not an unseen finished video or a live demonstration. |

**Weighted total:** 0.30×3 + 0.25×6 + 0.20×7 + 0.25×7 = **5.55/10**, versus **5.20/10**.

This is still far from a 9+ startup submission. More tests alone will not close the impact gap. The missing evidence is that an intended buyer makes a better decision with this assistant, together with an honest, complete execution of the actual Meta-model path.

## 2. All 28 counterexamples

“Blocked” is scoped to the stated counterexample, not a claim that the whole subsystem is correct. “Partly blocked” means a narrower repair works but the full boundary or a newly introduced path remains open. The last column separates execution from source inspection.

| # | Counterexample | Stack verdict | Exact implementation and repository test | Independent result / limitation |
|---:|---|---|---|---|
| 1 | Hold draft approval A; edit B; blur; release before debounce. | **Blocked** | #54 [apps/web/src/render.ts:809](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/src/render.ts#L809) preserves locally changed draft text and checks equality before Copy. Test: [apps/web/e2e/c1-races.spec.ts:54](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/e2e/c1-races.spec.ts#L54), C1-1. | **Before/after confirmed.** 059362d restored A and enabled Copy; 8d1ca97 retained B and disabled Copy with zero debounce callbacks executed. The adjacent A→B→A case remains open: F4. The repository test installs a clock but does not explicitly pause it. |
| 2 | Hold correction A response; edit B; complete invalidation; release A. | **Blocked** | #54 [apps/web/src/render.ts:947](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/src/render.ts#L947) captures the preview and invalidation sequence before chaining approval. Test: [apps/web/e2e/c1-races.spec.ts:79](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/e2e/c1-races.spec.ts#L79), C1-2. | **Before/after confirmed.** Old handler issued one stale approve and restored A; new handler issued zero approves, retained B, and left server state review_required. |
| 3 | Edit preview A→B; hold invalidation; blur; release. | **Blocked** | #54 [apps/web/src/render.ts:783](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/src/render.ts#L783) compares local preview with the last acknowledged value. Test: [apps/web/e2e/c1-races.spec.ts:101](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/e2e/c1-races.spec.ts#L101), C1-4. | **Before/after confirmed.** Old handler restored the previous server preview; new handler retained Corrected B. |
| 4 | Deliver A's pressure acknowledgement after B has a different p1. | **Blocked** | #54 revision/assessment checks: [apps/web/src/session.ts:1056](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/src/session.ts#L1056); route contract: [apps/web/src/server.ts:581](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/src/server.ts#L581). Tests: [apps/web/test/c1-revisions.test.ts:49](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/test/c1-revisions.test.ts#L49), C1-5, and line 69, C1-6. | **Before/after confirmed at store boundary.** Old store reviewed B's p1; new store rejected the old request and kept reviewed=[] despite repeated item ID. HTTP regression inspected, not run. |
| 5 | Uncheck Reviewed after approving the draft. | **Blocked** | #54 [apps/web/src/session.ts:1076](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/src/session.ts#L1076) implements unreview; renderer sends reviewed:false. Tests: [apps/web/test/c1-revisions.test.ts:86](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/test/c1-revisions.test.ts#L86) and [apps/web/e2e/c1-races.spec.ts:135](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/e2e/c1-races.spec.ts#L135), C1-7. | New store probe confirmed draft.approved=false after unreview. Old absence/ignored-uncheck behavior was inspected; I did not run an old/new real-browser checkbox test. This is not a claim that the stored approval hash is destroyed. |
| 6 | After fetch invocation, panel still says prepared/not sent. | **Partly blocked** | #55 [apps/web/src/session.ts:655](https://github.com/Bridgett50/second-seat-hackathon/blob/2617b7978363963e5126d8e4ca643f176cecfd5f/apps/web/src/session.ts#L655) fixes snapshots. Test [apps/web/test/c2-receipts.test.ts:124](https://github.com/Bridgett50/second-seat-hackathon/blob/2617b7978363963e5126d8e4ca643f176cecfd5f/apps/web/test/c2-receipts.test.ts#L124) manually renders a fresh snapshot. Actual tip handler: [apps/web/src/render.ts:987](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/apps/web/src/render.ts#L987). | **Reproduced remaining UI bug.** Held fake transport: store says invoked, browser says “Prepared (not dispatched).” No state request is made while analyze is pending. Old/new snapshot probe passes; full UI criterion fails. F3. |
| 7 | Preflight=t0, dispatch=t1, completion=t2: report t1. | **Blocked** | #55 [apps/web/src/session.ts:907](https://github.com/Bridgett50/second-seat-hackathon/blob/2617b7978363963e5126d8e4ca643f176cecfd5f/apps/web/src/session.ts#L907) derives send/history time from the first fresh receipt. Tests [apps/web/test/c2-receipts.test.ts:124](https://github.com/Bridgett50/second-seat-hackathon/blob/2617b7978363963e5126d8e4ca643f176cecfd5f/apps/web/test/c2-receipts.test.ts#L124) and [apps/web/test/c2-receipts.test.ts:162](https://github.com/Bridgett50/second-seat-hackathon/blob/2617b7978363963e5126d8e4ca643f176cecfd5f/apps/web/test/c2-receipts.test.ts#L162), C2-3/C2-5. | **Before/after confirmed.** Old superseded history used 10:00:00; new payload/history used receipt time 10:00:05 despite completion at 10:00:09. Browser refresh limitation remains #6. |
| 8 | Wrong meetingId “m” accepted for a real session. | **Blocked** | #56 [apps/web/src/session.ts:457](https://github.com/Bridgett50/second-seat-hackathon/blob/fb4c216d60b08aef4308a05f25250b5f8adfa925/apps/web/src/session.ts#L457) validates exact meeting identity. Test [apps/web/test/c3-contract.test.ts:48](https://github.com/Bridgett50/second-seat-hackathon/blob/fb4c216d60b08aef4308a05f25250b5f8adfa925/apps/web/test/c3-contract.test.ts#L48), C3-1. | **Before/after confirmed.** 2617b79 accepted m; fb4c216 rejected it. Valid complete response remained accepted. #56 still needs its build fix. |
| 9 | Valid citation ID but region:{box:123,unexpected:true}. | **Blocked** | #56 shared-schema walk: [apps/web/src/session.ts:403](https://github.com/Bridgett50/second-seat-hackathon/blob/fb4c216d60b08aef4308a05f25250b5f8adfa925/apps/web/src/session.ts#L403). Tests [apps/web/test/c3-contract.test.ts:56](https://github.com/Bridgett50/second-seat-hackathon/blob/fb4c216d60b08aef4308a05f25250b5f8adfa925/apps/web/test/c3-contract.test.ts#L56) and line 70, C3-3/C3-4. | **Before/after confirmed.** Old validator accepted; new rejected the malformed nested region. This proves schema enforcement, not factual correctness of a citation. |
| 10 | Default replay trusts saved totals or status:weird. | **Blocked** | #57 [services/bot/scripts/rescore-glimmer-run.mjs:427](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/scripts/rescore-glimmer-run.mjs#L427) always enters strict reconstruction; status allowlist at line 239. Tests [services/bot/test/c4-replay.test.ts:94](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/test/c4-replay.test.ts#L94) and line 112, C4-1/C4-2. | **Before/after confirmed.** Old default returned impossible legacy 100/2 from altered records and accepted weird as complete. New recomputed 2/2 and rejected weird with integrity_failure; CLI exited 1 for weird. |
| 11 | Duplicate raw receipts silently overwrite. | **Blocked** | #57 [services/bot/scripts/rescore-glimmer-run.mjs:267](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/scripts/rescore-glimmer-run.mjs#L267) rejects repeated receipt keys. Test [services/bot/test/c4-replay.test.ts:144](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/test/c4-replay.test.ts#L144), C4-4. | **Before/after confirmed**, including old optional strict mode: old ok=true; new integrity_failure, duplicate-receipt error, all completion flags false. Duplicate *manifest plans* are a separate remaining defect, F8. |
| 12 | Change error/finish metadata while leaving content hash unchanged. | **Blocked** | #57 [services/bot/scripts/rescore-glimmer-run.mjs:304](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/scripts/rescore-glimmer-run.mjs#L304) checks receipt integrity covering scoring metadata. Test [services/bot/test/c4-replay.test.ts:127](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/test/c4-replay.test.ts#L127), C4-3. | **Before/after confirmed.** Old strict replay changed outcome without integrity failure. New separately detected changed error and changed finish_reason as receipt integrity failures. |
| 13 | Torn trailing record after all expected records. | **Blocked** | #57 [services/bot/scripts/rescore-glimmer-run.mjs:366](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/scripts/rescore-glimmer-run.mjs#L366) forces summary/output incomplete before report creation. Test [services/bot/test/c4-replay.test.ts:162](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/test/c4-replay.test.ts#L162), C4-5. | **Before/after confirmed for the old strict-branch defect.** Old outer complete=false but summary.complete=true; new both false and CLI incomplete/exit 3. Old legacy/default branch already marked the tail incomplete; it must not be counted as a newly fixed default-branch failure. |
| 14 | --run-dir ignores the selected bundle. | **Blocked** | #57 [services/bot/scripts/rescore-glimmer-run.mjs:552](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/scripts/rescore-glimmer-run.mjs#L552) dispatches the explicit directory. Test [services/bot/test/c4-replay.test.ts:224](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/test/c4-replay.test.ts#L224), C4-10. | Current CLI executed on distinct dummy runs and returned their respective IDs/statuses. This was already fixed before the C cycle; I did not rerun the historical PR46 CLI. No new-regression credit claimed. |
| 15 | Valueless --cases falls back to dev fixtures. | **Blocked** | #58 [services/bot/scripts/redaction-eval.mjs:39](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/services/bot/scripts/redaction-eval.mjs#L39) rejects before importing the redactor or reading cases. Test [services/bot/test/c5-wiring.test.ts:244](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/services/bot/test/c5-wiring.test.ts#L244), C5-5. | Executed current CLI: exit 2, “--cases <dataset> required,” no fixture/redactor access. Old fallback inspected from prior implementation context, not re-executed in this review. |
| 16 | Frozen image/model config exists but application ignores it. | **Partly blocked** | #58 [infra/modal/glimmer_app.py:36](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/glimmer_app.py#L36), lines 53, 100, 141 use imported values; main re-reads config at line 257. Tests [services/bot/test/c5-wiring.test.ts:186](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/services/bot/test/c5-wiring.test.ts#L186) and line 194, C5-1/C5-2. | **Before/after confirmed for unchanged config.** Old captured a mutable image/no revision; new captured exact digest and revision in both commands. **New counterexample reproduced:** same-path config replacement validates new values but spawns the old imported configuration. F2. |
| 17 | Zero revision, whitespace reviewer, invalid review date. | **Partly blocked** | Python contract [infra/modal/launch_contract.py:116](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/launch_contract.py#L116) and line 160; test [services/bot/test/c5-wiring.test.ts:255](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/services/bot/test/c5-wiring.test.ts#L255), C5-6. New TS schema [services/bot/src/release/runConfig.ts:52](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/services/bot/src/release/runConfig.ts#L52) and line 79. | **Before/after confirmed in Python:** all three old inputs accepted, all three now rejected. **New C9 path remains open:** sourceSha=all-zero, model.revision=all-zero, and all-zero image digest validate successfully. F7. |
| 18 | SDK FileEntry objects/directories break download. | **Blocked** | #58 [infra/modal/glimmer_app.py:298](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/glimmer_app.py#L298) adapts object entries and skips directories. Test [services/bot/test/c5-wiring.test.ts:279](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/services/bot/test/c5-wiring.test.ts#L279), C5-7. | **Before/after confirmed through actual wrapper.** Old raised unsafe-rel-path on FileEntry; new downloaded nested dummy bytes exactly. This is SDK-shaped stub evidence, not a real Modal Volume download. |
| 19 | Budget expires during input prep but canary still dispatches. | **Blocked** | #58 [services/bot/scripts/redaction-eval-runner.mjs:397](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/services/bot/scripts/redaction-eval-runner.mjs#L397) checks remaining deadline before the canary. Test [services/bot/test/c5-wiring.test.ts:356](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/services/bot/test/c5-wiring.test.ts#L356), C5-10. | **Before/after confirmed using the clock actually read by runner.** Old made one call; new made zero and returned every case not_run. |
| 20 | Shared /tmp daily-cap state poisons unrelated tests. | **Blocked, static evidence only** | #53 [services/bot/test/gate.test.ts:412](https://github.com/Bridgett50/second-seat-hackathon/blob/7efcae01fa594a564165a69a2d065f86d9c15d03/services/bot/test/gate.test.ts#L412) and [services/bot/test/approval-boundary.test.ts:193](https://github.com/Bridgett50/second-seat-hackathon/blob/7efcae01fa594a564165a69a2d065f86d9c15d03/services/bot/test/approval-boundary.test.ts#L193) now use fresh test-owned state paths and cleanup. | Specific old fixed-file dependency is removed in those tests. I did not preseed machine-global paths or execute the named suites twice. Full C6-3/C6-4 certification remains unverified; new tests elsewhere also leave temp directories behind. |
| 21 | Tests overwrite tracked historical rescore.json. | **Blocked, static evidence only** | #53 [services/bot/test/glimmer-eval.test.ts:151](https://github.com/Bridgett50/second-seat-hackathon/blob/7efcae01fa594a564165a69a2d065f86d9c15d03/services/bot/test/glimmer-eval.test.ts#L151) directs legacy output to a temp path. #57 separates historical writer behind an explicit flag at [services/bot/scripts/rescore-glimmer-run.mjs:537](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/scripts/rescore-glimmer-run.mjs#L537). Tests C4-9/C4-10 at lines 207/224. | The inspected legacy test no longer targets the tracked output. Current synthetic replay API is read-only; I did not hash historical artifacts or run the entire suite to certify every writer. |
| 22 | Existing imports/CI still access sealed material despite guard test. | **Partly blocked** | #53 rewrites the holdout helper tests to dummy inputs; guard test [services/bot/test/c6-hermetic.test.ts:29](https://github.com/Bridgett50/second-seat-hackathon/blob/7efcae01fa594a564165a69a2d065f86d9c15d03/services/bot/test/c6-hermetic.test.ts#L29). But [.github/workflows/ci.yml:14](https://github.com/Bridgett50/second-seat-hackathon/blob/7efcae01fa594a564165a69a2d065f86d9c15d03/.github/workflows/ci.yml#L14) uses full checkout and line 38 scans all tracked files; guard [services/bot/test/support/sealed-guard.mjs:50](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/services/bot/test/support/sealed-guard.mjs#L50) only compares lexical paths. | No actual sealed access attempted. Source shows Git/non-Node operations are outside the guard. Pure path probe: normal spelling true, Windows uppercase equivalent false, parent path false. Existing full-suite safety is **not certified**. F9. |
| 23 | Classifier failure becomes invisible/reviewed empty output. | **Partly blocked** | #59 explicit failure states at [apps/web/src/session.ts:305](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L305); semantic rejection still falls through to valid_negative at line 279. Tests [apps/web/test/c7-pressure.test.ts:60](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/test/c7-pressure.test.ts#L60) and line 205, C7-2/C7-8. | **Before/after confirmed for thrown error:** old allReviewed=true; new failed/allReviewed=false. **Remaining failure reproduced:** an array with a nonexistent quoted span yields valid_negative/allReviewed=true. Unknown tactic strings are also accepted. F5. |
| 24 | Default live mode actually classifies pressure. | **Partly blocked** | #59 [apps/web/src/session.ts:984](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L984) runs deterministic patterns by default; line 1015 computes before Spark; line 1043 passes it into the request. Test [apps/web/test/c7-pressure.test.ts:190](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/test/c7-pressure.test.ts#L190), C7-7. | Source proves connected **pattern classification**. It does not prove Spark classifies pressure or returns the assessment. The test inspects input text and supplies a brief without a model pressure assessment. Narrow “one request carries structured assessment” criterion is met by this design; Meta-model capability credit is not. |
| 25 | “Unresolved term” is just the whole pressure sentence. | **Partly blocked** | #59 [apps/web/src/session.ts:211](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L211) leaves pattern ask empty; [apps/web/src/session.ts:242](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L242) requires a verbatim approved-text substring and rejects exact whole cited segment. Test [apps/web/test/c7-pressure.test.ts:76](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/test/c7-pressure.test.ts#L76), C7-3. | The original whole-line default is removed. This is string provenance, not validation that the term is unresolved or belongs to the cited segment. Test deliberately accepts net-45 from a different segment. No independent old/new term-specific execution claimed. F10. |
| 26 | Positive-pattern test can pass with zero detections. | **Blocked** | #59 [apps/web/test/c7-pressure.test.ts:100](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/test/c7-pressure.test.ts#L100), C7-4, asserts valid_positive and an exact nonempty item array with quote/citation. | Assertion inspected; independent default-path probe produced a positive item. The literal old named test was not mutation-run. A positive phrase already worked on old code, so this is stronger test coverage rather than proof every positive became newly detectable. |
| 27 | README confuses raw Glimmer input with approved Spark input. | **Blocked for documentation distinction** | #60 [README.md:13](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/README.md#L13) explicitly separates raw remote Glimmer input from approved redacted Spark input. Test [apps/web/test/c8-docs.test.ts:18](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/apps/web/test/c8-docs.test.ts#L18), C8-1. | Exact text inspected. No behavioral “old-fail/new-pass” claim for a prose correction. The new auxiliary-field bypass prevents treating the sentence as a universal adapter guarantee; F1. |
| 28 | README/video describe intended rather than connected implementation. | **Partly blocked** | #60 [README.md:15](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/README.md#L15) correctly labels patterns; script [docs/submission/video-script.md:16](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/docs/submission/video-script.md#L16) adds pressure review. Remaining claims at README line 7 and video lines 17/31. Test [apps/web/test/c8-docs.test.ts:38](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/apps/web/test/c8-docs.test.ts#L38) is prose matching. | Offline/live labels and pending evidence are much better. “Any edit … clears the approval” fails A→B→A; model table can imply live Shield wiring; script retains blanket “criteria met” and a whole-sentence pressure quote. Details F11. |

### What the before/after results mean

The original A→B races, stale p1 acknowledgement, wrong-meeting exception, malformed region, raw receipt duplication, metadata tampering, torn strict-replay summary, missing canary deadline check, immutable-reference consumption, attestation validation, and FileEntry adaptation were tested behaviorally against old and new implementations.

That does **not** mean all repository regressions are mutation-tested. Cases 5, 14, 15, 20–22, 24–28 have the narrower evidence described in their rows. A test that already guarded working behavior need not fail on old code. A prose assertion cannot stand in for a transport or browser assertion.

## 3. PR-by-PR merge decision

“Fix first” means the direction is usable but this exact head is not approved for merge. “Block” means a central authorization/evidence boundary has a reproduced defect and should not advance as accepted. These are review recommendations, not assertions about GitHub branch-protection settings.

| PR | Verdict at its exact head | What must change |
|---|---|---|
| #53 C6, 7efcae0 | **Fix first** | Keep the fresh temp-state and dummy-harness changes. Close the actual workflow/guard boundary: full checkout and repository-wide Git scan are outside the Node guard; Windows aliases are not rejected. Make the nonsealed repair workflow explicitly safe. Add missing C6-7 workflow acceptance and cleanup checks. Evidence: F9, [.github/workflows/ci.yml:14](https://github.com/Bridgett50/second-seat-hackathon/blob/7efcae01fa594a564165a69a2d065f86d9c15d03/.github/workflows/ci.yml#L14), [services/bot/test/c6-hermetic.test.ts:49](https://github.com/Bridgett50/second-seat-hackathon/blob/7efcae01fa594a564165a69a2d065f86d9c15d03/services/bot/test/c6-hermetic.test.ts#L49). |
| #54 C1, 8d1ca97 | **Fix first** | Preserve the repaired A→B and stale-assessment behavior. Add a local draft-edit generation so A→B→A cannot resurrect a held approval; invalidate immediately rather than relying only on text equality/debounce. Make the browser clock explicitly paused before testing the 300 ms window. Evidence: F4, [apps/web/src/render.ts:960](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/src/render.ts#L960), [apps/web/e2e/c1-races.spec.ts:55](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/e2e/c1-races.spec.ts#L55). |
| #55 C2, 2617b79 | **Fix first** | Keep receipt-derived snapshot/history times. Wire receipt updates into the actual pending page through revision-aware polling or a stream, with cleanup and stale-response guards. Add a held-provider browser test that reads the existing page without manually rendering a new snapshot. Evidence: F3, [apps/web/test/c2-receipts.test.ts:124](https://github.com/Bridgett50/second-seat-hackathon/blob/2617b7978363963e5126d8e4ca643f176cecfd5f/apps/web/test/c2-receipts.test.ts#L124). |
| #56 C3, fb4c216 | **Fix first** | Move the package import correction from #59 into this PR. Use @second-seat/core, not a relative source import across package boundaries. Prove a clean build emits and starts the expected web entry point. Validator logic addresses the reviewed C3 bugs. Evidence: F6, [apps/web/test/c3-contract.test.ts:3](https://github.com/Bridgett50/second-seat-hackathon/blob/fb4c216d60b08aef4308a05f25250b5f8adfa925/apps/web/test/c3-contract.test.ts#L3). |
| #57 C4, b383e12 | **Fix first** | Restack on corrected #56. Retain strict default replay. Reject malformed/duplicate planned identities before scoring, and distinguish complete reconstruction from comparison with a missing saved summary/report. Add API and CLI regressions. Evidence: F8, [services/bot/scripts/rescore-glimmer-run.mjs:164](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/scripts/rescore-glimmer-run.mjs#L164) and line 377. |
| #58 C5, 789ab3c | **Block** | Restack on corrected build. Bind validation to the exact config object/bytes used to construct images and command arguments; refuse same-path replacement. Bind or explicitly disavow the claimed source commit, and cover launcher/config identity as well as packaged bot bytes. Evidence: F2, [infra/modal/glimmer_app.py:36](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/glimmer_app.py#L36), line 257, [infra/modal/launch_contract.py:204](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/launch_contract.py#L204). |
| #59 C7, 1153dd8 | **Block** | Remove the unapproved pressureAssessment text channel at the adapter boundary. Reject semantically invalid pressure labels as failed, not valid_negative. Keep patterns explicitly labeled; do not credit them as Spark pressure classification. Relocate the import repair into #56 and restack. Evidence: F1/F5, [services/bot/src/brief/muse.ts:309](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/services/bot/src/brief/muse.ts#L309), [apps/web/src/session.ts:279](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L279). |
| #60 C8 docs, f7a91a1 | **Fix first** | Reconcile the “any edit” promise with actual revision semantics, separate current pattern detection from standalone/historical Shield model use, correct the whole-sentence pressure proof shot, replace blanket “criteria met,” and include the full criterion list rather than truncated ranges. Evidence: F11 and F12. No invented founder/customer evidence. |
| #61 C9 prep, c6829e3 | **Fix first; execution remains blocked** | Keep the explicit blocked/proposed checklist and the working maxAttempts=1 option. Reject zero/placeholder identities in the schema; restore omitted criterion IDs; specify/test a single mapping from run config to real launch/request parameters. Do not mistake schema validation for runtime binding. Evidence: F7/F12, [services/bot/src/release/runConfig.ts:52](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/services/bot/src/release/runConfig.ts#L52) and [docs/release/c9-readiness.md:11](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/docs/release/c9-readiness.md#L11). |

### Must #56–#58 each be green?

**Yes, each PR should be fixed and independently green before you merge it. Do not merge the three known broken heads merely because #59 repairs the eventual tip.**

The specific failure is not hypothetical. At #56 the test imports core source by relative path, while [apps/web/tsconfig.json:6](https://github.com/Bridgett50/second-seat-hackathon/blob/fb4c216d60b08aef4308a05f25250b5f8adfa925/apps/web/tsconfig.json#L6) includes test files in the build. That changes TypeScript's inferred output root; the build command then cannot find dist/src/build.js. The failed job's browser tests did not run. #57 and #58 inherit the same defect. #59's [apps/web/test/c3-contract.test.ts:3](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/test/c3-contract.test.ts#L3) changes the import to the package name and its CI is green.

The minimal repair is **one change moved earlier**: amend #56, then rebase/restack #57–#61 on it and rerun checks at their new heads. It is not three independent copies of the same patch. Update reviewed SHAs and evidence links after the restack.

Git can mechanically merge a temporarily broken sequence, and a separately reviewed atomic combined change is another workflow option. Neither fact makes these three exact red heads acceptable as individually reviewed PRs. A clean build from an empty build-output directory is the relevant acceptance test; stale local dist files can hide the failure.

## 4. Findings, ranked by severity

### F1 — P1: a new unapproved text field bypasses the adapter's privacy contract

**First present in this review at #59; persists in #61. Reproduced with fake HTTP.**

Locations: [services/bot/src/brief/muse.ts:49](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/services/bot/src/brief/muse.ts#L49), [services/bot/src/brief/muse.ts:105](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/services/bot/src/brief/muse.ts#L105), [services/bot/src/brief/muse.ts:294](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/services/bot/src/brief/muse.ts#L294); tip [services/bot/src/brief/muse.ts:309](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/services/bot/src/brief/muse.ts#L309).

The adapter requires gate-minted transcript/sidecar values, but accepts pressureAssessment as an arbitrary string. It appends that string to the user message while the guarded values and payload log cover only transcript/sidecar. This adds another path for meeting-derived text without binding it to the approval.

**Minimal reproduction:**

1. Create a live gate with a dummy redactor.
2. Prepare and approve “Approved neutral notes.”
3. Inside gate.send, call the real MuseClient with that GatedText, empty sidecar, and pressureAssessment set to “Unapproved invented contact: uma@example.invalid.”
4. Inject a fake fetch that records the request body.

**Expected:** reject the unapproved auxiliary text before HTTP invocation, or construct the assessment internally from a validated structure bound to the same approval.

**Observed:** one fake HTTP invocation; its user message contained uma@example.invalid. No model request was made.

This is an **adapter-boundary bypass**, not proof that the current browser exposes an arbitrary pressureAssessment input to an unauthenticated attacker. The current default session constructs pattern quotes from approved text. That limits the presently demonstrated exploit path, but does not repair the public live adapter contract or protect future callers/injected classifier output.

**Why tests miss it:** C7-7 checks that expected assessment text is included in the outbound body. It does not inject unapproved auxiliary text or verify that every meeting-derived field is covered by approval. C9-P4 likewise exercises retries, not body provenance.

**Minimal fix/test:** derive and validate assessment fields from the approved transcript inside the trusted boundary, or require a separately validated/bound value. Add a fake-transport test with the invented contact above; assert zero fetches and zero dispatch receipts on refusal. Add a valid assessment positive control and a mutation/revocation test between preflight and dispatch.

### F2 — P1: validation and execution can use different configuration at the same path

**#58; persists at tip. Reproduced through the actual app under the inert Modal stub.**

Locations: [infra/modal/glimmer_app.py:36](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/glimmer_app.py#L36), [infra/modal/glimmer_app.py:44](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/glimmer_app.py#L44), [infra/modal/glimmer_app.py:257](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/glimmer_app.py#L257), [infra/modal/glimmer_app.py:267](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/glimmer_app.py#L267), [infra/modal/glimmer_app.py:284](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/glimmer_app.py#L284).

At import, image construction and _MODEL_REVISION use _LAUNCH_CONFIG. main subsequently reopens the file and validates a fresh cfg. The equality check compares paths, not the configuration that was consumed earlier.

**Minimal reproduction using a newly invented dummy dataset/config:**

1. Set GLIMMER_LAUNCH_CONFIG to config.json with image A and revision C.
2. Import glimmer_app under the inert SDK stub.
3. Replace config.json at the **same path** with valid image B and revision E.
4. Call main(dataset="dummyx", config=the_same_path).
5. Inspect captured image/command configuration and the spawn record.

**Observed:** validation accepted revision E and image B, then one spawn occurred while the imported application still held revision C and image A. Both old and new revisions were syntactically valid dummy identities. The application did not reject drift.

The unchanged-config test is real: compared with the old implementation, #58 does consume the selected digest and puts --revision in both captured vLLM commands. That is progress. It does not close this time-of-check/time-of-use gap.

**Related source-identity gap:** [infra/modal/launch_contract.py:204](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/launch_contract.py#L204) verifies source_sha syntax/nonzero, not that it names the checked-out source. The dummy app test is accepted in a directory with no Git checkout using a fabricated nonzero source SHA. packaged_source_sha256 at line 74 covers bot dist/scripts/selected fixtures/package.json; it does not cover the launcher itself. That hash is useful packaged-byte evidence, but it is not proof of the claimed Git commit or complete launch implementation.

**Why tests miss it:** C5-4 changes to a *different* config path. C5-3 changes a packaged dist file. Neither replaces bytes at the same config path after import, nor changes launcher code outside the packaged-byte hash.

**Minimal fix/test:** use one canonical validated configuration to construct and execute the app, or reject any subsequent config-content mismatch. Record the exact consumed configuration identity and launcher/source identity. The same-path replacement must result in zero spawns. A clean unchanged config must produce exactly the captured image/revision/arguments that were validated. These tests can remain entirely inert and synthetic.

### F3 — P2: receipt-aware snapshots do not reach the page while the request is pending

**#55; persists at tip. Reproduced against the embedded page handlers and actual store with fake transport.**

Locations: [apps/web/src/session.ts:655](https://github.com/Bridgett50/second-seat-hackathon/blob/2617b7978363963e5126d8e4ca643f176cecfd5f/apps/web/src/session.ts#L655), tip [apps/web/src/render.ts:930](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/apps/web/src/render.ts#L930) and [apps/web/src/render.ts:987](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/apps/web/src/render.ts#L987).

The server now correctly reports transport invocation. The browser waits for the POST /api/session/analyze response and does not fetch state while that response is pending.

**Minimal reproduction:**

1. Prepare/approve a normal invented session.
2. Click Analyze in the embedded page.
3. Let the fake provider fetch be invoked; hold its response.
4. Inspect both store.getState and the existing page's payload-status element.

**Observed:**

- Server payload.status: invoked.
- Server payload.sentAt: populated from the receipt.
- Existing page: **“Prepared (not dispatched)”**.
- Browser request history: session creation, initial state request, analyze request; no intervening state update.

**Why tests miss it:** C2-2/C2-3 at [apps/web/test/c2-receipts.test.ts:124](https://github.com/Bridgett50/second-seat-hackathon/blob/2617b7978363963e5126d8e4ca643f176cecfd5f/apps/web/test/c2-receipts.test.ts#L124) manually calls getState and renderSessionPage. That tests what a refreshed snapshot *would* show, not what the already-open page sees.

**Minimal fix/test:** add a revision-aware pending-state update mechanism and stop it on completion/invalidation/navigation. Test the actual page with a held provider response. Before releasing it, assert “Transport invoked … outcome pending” appears without manual refresh; verify the t1 timestamp; verify an edit cannot let an older polling response restore findings or approval.

### F4 — P2: A→B→A resurrects a held draft approval before debounce

**#54; persists at tip. Reproduced with no timer advancement.**

Locations: [apps/web/src/render.ts:809](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/src/render.ts#L809), [apps/web/src/render.ts:832](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/src/render.ts#L832), [apps/web/src/render.ts:960](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/src/render.ts#L960); tip [apps/web/src/render.ts:839](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/apps/web/src/render.ts#L839) and line 989.

The repair protects a locally different string. It does not bind the pending approval response to the local edit generation.

**Minimal reproduction:**

1. Draft is A; process approval A on the server but hold its response.
2. Type B, then type A again, without running the 300 ms draft-save callback.
3. Blur the field.
4. Release the held approval response.

**Expected under the stated “any edit clears approval” contract:** approval remains invalidated until a new deliberate approval; Copy stays disabled.

**Observed:** A is visible and Copy is enabled. The old approval response is accepted because current text equals serverDraft. The pre-debounce probe executed zero debounce callbacks.

This does not copy a different byte string from the originally approved A. The defect is stale approval resurrection after a new edit intent, directly contradicting the claimed invalidation rule and leaving authorization dependent on a race window.

**Why tests miss it:** C1-1 covers A→B only. It also calls page.clock.install without explicitly pausing progression, so the named test is weaker than its “before debounce” description.

**Minimal fix/test:** increment a draft edit generation synchronously on every input; invalidate locally immediately; require approval responses to match the captured generation and exact text. Add A→B→A and A→empty→A tests with a genuinely paused clock, then a positive case in which a fresh approval enables Copy and the clipboard receives the exact current draft.

### F5 — P2: semantically invalid pressure output becomes a reviewed negative

**#59; persists at tip. Reproduced.**

Locations: [apps/web/src/session.ts:253](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L253), [apps/web/src/session.ts:279](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L279), [apps/web/src/session.ts:319](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L319), [apps/web/src/session.ts:333](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L333).

The new code distinguishes thrown/non-array failure, but its array validator checks mostly string types. verifyPressureLabels drops bad segment/span references, then declares an empty result valid_negative with allReviewed=true.

**Minimal reproduction:** configure an injected classifier to return:

```json
[{"segmentId":"seg-1","tactic":"scarcity","span":"not in transcript","ask":"","target":"owner"}]
```

Use an invented current transcript that does not contain that span.

**Observed:** status=valid_negative, items=[], allReviewed=true. A separate probe using tactic="invented" and a valid quote was accepted as valid_positive. By contrast, an actual thrown classifier error is now failed/allReviewed=false, which is the correct repair for that narrower case.

**Why tests miss it:** C7-8 supplies “not-an-array.” C7-2 throws. Neither supplies a structurally shaped but semantically invalid array.

**Minimal fix/test:** reject unknown tactics, invalid IDs, empty/missing quotes, and invalid positive-label provenance. A rejected positive must not be converted into a confident negative. Assert failed/unavailable, visible reason, and disabled Copy for an all-invalid array and a mixed valid/invalid array, unless an explicit partial-state policy is implemented and tested. A true negative needs an explicit valid negative contract.

### F6 — P1 for the affected PR heads: #56–#58 cannot build the intended web artifact

**At #56, #57, #58; fixed at #59. Verified by source and CI job evidence, not a local full build.**

Location: [apps/web/test/c3-contract.test.ts:3](https://github.com/Bridgett50/second-seat-hackathon/blob/fb4c216d60b08aef4308a05f25250b5f8adfa925/apps/web/test/c3-contract.test.ts#L3) and [apps/web/tsconfig.json:6](https://github.com/Bridgett50/second-seat-hackathon/blob/fb4c216d60b08aef4308a05f25250b5f8adfa925/apps/web/tsconfig.json#L6). Fix: [apps/web/test/c3-contract.test.ts:3](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/test/c3-contract.test.ts#L3).

The cross-package relative source import expands the inferred compilation root. The build script expects dist/src/build.js, which is absent in the clean CI build. #56's recorded build job failed there after tests passed; Playwright was skipped.

**Minimal reproduction/acceptance:** on an isolated nonsealed source checkout with no old build output, build all required packages, then assert the expected web build/start file exists and starts the offline session endpoint. The relative-import version must fail this check; the package-import version must pass. Do not count a stale dist tree as success.

**Fix:** move the import repair into #56, restack descendants, and validate each new exact head. No paid work is involved.

### F7 — P2: the C9 schema accepts placeholders and does not bind execution

**#61. Placeholder acceptance and one-attempt behavior independently executed; runtime disconnection established from source.**

Locations: [services/bot/src/release/runConfig.ts:52](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/services/bot/src/release/runConfig.ts#L52), line 79, line 250; tests [apps/web/test/c9-prep.test.ts:58](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/apps/web/test/c9-prep.test.ts#L58) and line 96; launch reader [infra/modal/glimmer_app.py:252](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/infra/modal/glimmer_app.py#L252); eval concurrency [services/bot/scripts/redaction-eval.mjs:70](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/services/bot/scripts/redaction-eval.mjs#L70).

**Observed:**

- The provided dummy config uses sourceSha consisting of forty zeros and validates.
- Replacing model.revision with forty zeros and both image digest representations with sixty-four zeros also returns no errors.
- The TS schema uses nested camelCase fields; the Python launcher consumes a different flat snake_case config.
- The eval CLI still supplies concurrency:2 independently of the TS config, whose test fixture specifies concurrency:4.
- sparkProofClientOptions only returns maxAttempts. It does not connect the rest of the config to image construction, model arguments, prompts, token settings, or the eval runner.

**Positive control:** with the proposed maxAttempts=1 option, the old MuseClient made four fake retryable HTTP attempts; the #61 client made one. That transport option is a genuine working repair. The option's existence does not prove the eventual proof-run entrypoint selects it.

Preparation documents correctly leave execution blocked. I am not treating their unchecked boxes as claims that a run already happened. But C9-P3 cannot be certified as actual configuration binding merely because a shape validator exists.

**Minimal fix/test:** reject placeholders consistently with the Python contract. Define one canonical config or a validated explicit mapping. With dummy values, capture actual image construction, vLLM arguments, runner concurrency/deadlines, request token/decoding settings, prompt/schema/scorer identity, and actual HTTP attempts from the same entrypoint. Mutating one frozen field must change the consumed setting or block launch. Do not access real holdout identities to do this.

### F8 — P2: replay still conflates missing comparison evidence and accepts duplicate planned identities

**#57; persists at tip. Reproduced on dummy bundles.**

Locations: [services/bot/scripts/rescore-glimmer-run.mjs:164](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/scripts/rescore-glimmer-run.mjs#L164), [services/bot/scripts/rescore-glimmer-run.mjs:377](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/scripts/rescore-glimmer-run.mjs#L377), [services/bot/scripts/rescore-glimmer-run.mjs:398](https://github.com/Bridgett50/second-seat-hackathon/blob/b383e12615b5df48866c7f276d1095d7f116850c/services/bot/scripts/rescore-glimmer-run.mjs#L398).

Two distinct gaps remain:

1. **Missing summary:** create a valid complete dummy run, remove summary.json, then call default rescoreRun. It returns complete_match. The comparison block only runs if a saved summary exists, so no saved summary means no mismatches. Reconstruction can be complete without a saved summary; calling it a verified *match* is inaccurate. The CLI's zero status has the same ambiguity.
2. **Duplicate plan:** duplicate a planned entry in manifest.json without adding another receipt or record. Replay returned ok=true, no integrity errors, and recomputed 3/3 coverage from two unique cases. It was marked incomplete because other count checks disagreed, so this was **not** a false fully-complete run. It still failed to classify the manifest identity defect and emitted distorted metrics.

**Why tests miss it:** C4-4 duplicates raw receipts, not manifest planned entries. C4-9 assumes saved summary/report exist. C4-11's status coverage does not exercise an absent comparison target.

**Minimal fix/tests:** validate manifest shape, nonempty run identity, unique planned case IDs, and safe relative input paths before scoring. Duplicate plan must be integrity_failure with no publishable aggregate. Distinguish complete reconstruction/uncompared from complete_match, or explicitly reject missing comparison files when the CLI's success meaning is “complete and matching.” Preserve interrupted-run reconstruction without inventing a comparison.

### F9 — P2 engineering / authorization blocker: the sealed guard is not the whole execution boundary

**#53; persists at tip. Workflow/source inspection plus a pure path-predicate probe. No sealed file access performed.**

Locations: [.github/workflows/ci.yml:14](https://github.com/Bridgett50/second-seat-hackathon/blob/7efcae01fa594a564165a69a2d065f86d9c15d03/.github/workflows/ci.yml#L14), line 38; [services/bot/test/support/sealed-guard.mjs:39](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/services/bot/test/support/sealed-guard.mjs#L39), line 50, line 73, line 188; test [services/bot/test/c6-hermetic.test.ts:49](https://github.com/Bridgett50/second-seat-hackathon/blob/7efcae01fa594a564165a69a2d065f86d9c15d03/services/bot/test/c6-hermetic.test.ts#L49).

The specific legacy holdout tests were rewritten to build dummy inputs; the shared-state fixes are sensible. The broader safety claim is not established:

- Full checkout is not a sparse allowlist and can copy tracked sealed material.
- The Git secret-scan command addresses all tracked files except its own workflow. Node's monkey patch cannot intercept Git reading them.
- The guard normalizes lexically and compares case-sensitively. On Windows, uppercasing an equivalent protected path made isSealedPath return false in the pure string probe.
- Parent-directory copy/list operations are not classified as sealed merely because they contain a sealed descendant. Symlink/realpath aliases are not canonicalized.
- NODE_OPTIONS propagation covers inheriting Node children, not arbitrary native/Python tools or children launched with a replacement environment.

The test probes direct protected-path strings and one Node child. That is useful, but cannot prove every relevant subprocess and packaging operation is covered.

**Minimal safe reproduction:** pass equivalent nonexistent path spellings to isSealedPath; no disk read is necessary. For recursion/native-tool coverage, build a fresh fake repository with dummy forbidden sentinels and an access spy. Never use the real sealed tree as a test fixture.

**Fix:** make the repair CI's checkout/build/scan path explicitly nonsealed, and separately authorize actual sealed verification. Use exclusion/allowlist boundaries that apply to native tools; do not present a Node monkey patch as a filesystem sandbox. Add C6-7 workflow acceptance. The safe test suite should clean its owned temporary directories; C2/C4/C5/C7/C9 tests create directories without comprehensive removal, so C6-6 is also not fully satisfied.

### F10 — P2 claim quality: substring provenance is not unresolved-term validation or model reasoning

**#59; persists at tip. Statically demonstrated.**

Locations: [apps/web/src/session.ts:242](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L242), [apps/web/src/session.ts:984](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L984), [apps/web/test/c7-pressure.test.ts:76](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/test/c7-pressure.test.ts#L76) and line 190.

The whole-sentence default is correctly removed. A term now must occur somewhere in the approved text and differ from the entire cited segment. That is a useful minimum. It does not establish that the term is unresolved, that the pressure item concerns it, or that its citation identifies the term's source. The regression deliberately cites seg-2 while taking net-45 terms from another segment.

Default pressure is computed before Spark. The brief schema and response parser do not obtain the pressure assessment from Spark. Passing a deterministic assessment to Spark is valid input conditioning; it is not evidence that Spark performed that classification.

**Fix choices:** retain the cheap pattern feature and label it narrowly, show “term not identified” unless provenance is explicit, and make no model-pressure claim; or, if that capability is central to the pitch, use one structured Spark response with separately validated pressure and term citation fields. Do not add a hidden second model call. An output-driven fake test should make the visible assessment follow the validated response, not a precomputed input string.

### F11 — P2: remaining README/video claims exceed the connected proof

**#60; persists at tip. Exact claims inspected; no unseen video or result is credited.**

1. **“any edit to the draft or transcript clears the approval.”** [README.md:7](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/README.md#L7) and [docs/submission/video-script.md:17](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/docs/submission/video-script.md#L17). A→B→A contradicts the draft part. Fix the implementation and test it before retaining this universal sentence.
2. **“Each item carries a status of not_run, failed, valid_negative, or valid_positive.”** [README.md:15](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/README.md#L15). The status belongs to the assessment; not_run/failed generally have no items. Correct the data-model description.
3. **“muse-spark-1.3 | Shield classifier”.** [README.md:73](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/README.md#L73). A standalone/historical classifier may exist, but the selected session path uses patterns. Label the row's scope explicitly so the live demo is not credited with a disconnected model capability.
4. **“Statuses spoken accurately: A1–A9 merged, criteria met on the tested commits …”** [docs/submission/video-script.md:31](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/docs/submission/video-script.md#L31). This remains a blanket acceptance claim while the README correctly labels A1–A3 criteria reconstructed and the current review finds remaining gaps. Replace it with specific demonstrated behaviors and exact release identity.
5. The scripted pressure proof shot quotes the entire long sentence at [docs/submission/video-script.md:15](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/docs/submission/video-script.md#L15). The default implementation emits the matched pattern substring, not that whole sentence: [apps/web/src/session.ts:211](https://github.com/Bridgett50/second-seat-hackathon/blob/1153dd8f6aae575a8f46788b9bf3432d28e43817/apps/web/src/session.ts#L211). Record the actual current UI output on a public invented scenario.
6. Criterion ranges in the README omit actual acceptance IDs: [README.md:38](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/README.md#L38) lists C1 only through C1-8 and line 41 lists C4 only through C4-6. A linked green run plus a range is not a criterion-by-criterion verdict.
7. “Only the owner-reviewed, approved redacted text goes to Spark” at [README.md:13](https://github.com/Bridgett50/second-seat-hackathon/blob/f7a91a15571c179d5cc5bf4a3c86e866576bb7dd/README.md#L13) accurately describes the intended default session text path, but must not be generalized to all live adapter inputs while F1 exists.

The old “raw transcript never left our server” promise is now expressly rejected in the script. The raw-Glimmer/approved-Spark distinction, no-vendor-send wording, historical incomplete-run disclosure, offline labels, and pending human evidence are meaningful improvements. Do not undo them.

The historical model metrics, license/competition eligibility, authorship, and external demand claims were not independently re-executed or audited in this C repair review. Nothing here converts them into new verified claims.

### F12 — P2 release gate: C9 readiness silently drops original acceptance IDs

**#61; some truncated ranges also appear in #60. Statically demonstrated against the supplied full C1–C9 plan.**

Locations: [docs/release/c9-readiness.md:11](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/docs/release/c9-readiness.md#L11), line 12, line 14, line 16.

The readiness checklist omits:

- **C1-9:** the positive paste-to-copy browser journey and exact clipboard bytes.
- **C2-7:** credential, cost, prompt, and token refusal with zero dispatch.
- **C4-7 through C4-11:** partial-run denominators, reasoning/empty/fenced output, read-only replay equality, explicit CLI selection, and status/exit semantics.
- **C6-7:** actual CI/package-hook execution path performs no unauthorized sealed checks or paid work.

These are not cosmetic omissions. They remove the positive product flow, refusal path, scoring safeguards, and workflow boundary from the final gate. The doc-check tests look for strings and sections; they do not compare the complete canonical acceptance-ID set.

**Minimal fix/test:** extract the required IDs from a maintained canonical acceptance registry and compare exact sets with the readiness matrix. No missing IDs, no invented substitutions, no abbreviated ranges hiding unreviewed items. Each row needs tested commit, test/probe reference, result, and any execution limitation.

### Test-quality verdict

**Real behavioral improvements:** C1's server revision/assessment checks; C3's recursive shared-schema walk; C4's raw-receipt/default replay mutations; C5's actual application import under an inert SDK-shaped stub; C7's exact nonempty positive assertion; C9's actual transport-attempt option.

**Useful but narrower than their labels:**

- C1-1's page.clock.install does not explicitly freeze the pre-debounce interval. My handler probe did.
- C1-8 in [apps/web/test/c1-revisions.test.ts:101](https://github.com/Bridgett50/second-seat-hackathon/blob/8d1ca970b1993b34112f1276b9915eb2219b0b7a/apps/web/test/c1-revisions.test.ts#L101) uses an offline/custom analyzer; its superseded-state assertion does not itself prove actual HTTP receipts. C2's live-adapter fake-transport tests supply that missing boundary.
- C2-2 manually renders a fresh state; it does not prove the active page updates.
- C7-7 proves assessment data in a request, not a model assessment in a response.
- C7-8's non-array input misses shaped-but-invalid labels.
- C5-11 at [services/bot/test/c5-wiring.test.ts:381](https://github.com/Bridgett50/second-seat-hackathon/blob/789ab3c3475145404484f39c428883dcc78557b7/services/bot/test/c5-wiring.test.ts#L381) honestly calls its SIGTERM test local-only. It does not prove Modal hard-kill Volume durability.
- C8 prose tests are suitable for wording checks, not for certifying the behavior described by those words.
- C9 configuration tests prove field validation and a retry option, not a frozen end-to-end launch.

**No blanket mutation-testing certificate:** I have reported exactly which equivalent probes ran on old/new code. I did not use CI success or PR-body mutation claims as substitutes.

## 5. What remains before C9 and final submission

### Smallest ordered repair plan — free/offline first

These are focused changes to the existing flow, not another broad feature cycle. Estimated hours are planning estimates, not measured implementation times. Repository edits, restacking, and tests are recommendations only; none were performed by this review.

| Order | Small PR / scope | Exact acceptance tests | Effort | Cost / authorization |
|---|---|---|---:|---|
| D1 | Close pressure payload provenance and semantic validation. services/bot/src/brief/muse.ts; apps/web/src/session.ts; focused fake-transport tests. | D1-1: approved neutral transcript plus unapproved invented email in pressureAssessment yields zero fetches and zero receipts. D1-2: valid assessment bound to the same approved text produces exactly one request containing only permitted derived fields. D1-3: revoke/edit while preflight is held; release it; zero requests. D1-4: unknown tactic, unknown segment, missing/empty/nonmatching quote, and mixed valid/invalid arrays remain visibly failed and cannot enable Copy. D1-5: valid positive and explicit valid negative controls still work. | 2–4 h | $0 provider spend; dummy data/fake HTTP. |
| D2 | Finish draft intent invalidation and the active receipt panel. apps/web/src/render.ts; session mutation integration; browser tests. | D2-1: paused-clock A→B held approval keeps B and disables Copy. D2-2: A→B→A and A→empty→A also stay unapproved until a new click. D2-3: held /correct A followed by B emits zero stale approve requests and server stays unapproved. D2-4: after real fake-fetch invocation, the existing page shows invoked/pending with t1 before provider completion, without manual reload. D2-5: edit while a state refresh is held; its response cannot restore result, draft, pressure review, or approval. D2-6: one complete paste→redact→correct→approve→analyze→review→edit→approve→copy browser test asserts exact clipboard bytes and expected fake transport bodies. | 3–5 h | $0; local browser and fake transport. |
| D3 | Repair the actual nonsealed CI boundary, then move the build fix into #56 and restack. workflows, safe source packaging, guard tests, c3-contract.test.ts. | D3-1: fake repository has dummy forbidden sentinels; exercise checkout/package/scan/test commands and assert no sentinel content read/copied. D3-2: case aliases, symlink aliases where supported, parent recursive copies, and relevant child processes are refused/excluded before access. D3-3: original shared counter files in a test-owned mirror are preseeded at cap; affected tests use fresh state and leave mirrors unchanged. D3-4: run the safe affected suites twice; no owned temp directories/processes/timers survive. D3-5: from no previous dist output, every restacked head builds the expected web entrypoint and serves the offline session page. | 2–4 h | $0 model spend; normal CI resource use only if already authorized and workflow proven nonsealed. |
| D4 | Freeze the config actually consumed. infra/modal/glimmer_app.py; launch_contract.py; runConfig.ts; eval CLI; inert integration test. | D4-1: import config A, overwrite same file with B, then call entrypoint: zero spawns, or a single canonical object makes both validated and consumed values B; no mixed configuration. D4-2: all-zero source/model/image identities and blank review data rejected. D4-3: source/launcher/build drift after freeze rejected. D4-4: dummy nondefault settings are captured at image construction, vLLM argv, runner concurrency/deadlines, request token/decoding configuration, and retry loop. D4-5: config path aliases with identical bytes behave deliberately; changed bytes do not pass by path equality. D4-6: one proof request fails retryably; exactly one actual fake HTTP attempt. | 3–5 h | $0; inert Modal stub only. No SDK/cloud invocation. |
| D5 | Close replay manifest/status gaps. rescore-glimmer-run.mjs and synthetic bundle tests. | D5-1: duplicate planned case IDs are integrity_failure, not duplicated metrics. D5-2: missing/invalid run ID, unsafe case paths, and wrong manifest shape fail before reading arbitrary inputs. D5-3: missing summary/report cannot yield a falsely verified complete_match; API and CLI expose the same declared policy. D5-4: unchanged complete bundle matches exactly; one failure keeps full planned denominator; removed record and torn tail remain incomplete. D5-5: altered totals, status, raw content, finish/error metadata, duplicate/missing/unexpected receipts remain rejected/recomputed correctly, with no input writes. | 1–3 h | $0; newly invented bundles only. |
| D6 | Restore the complete acceptance ledger and reconcile the pitch. readiness doc, README, video script, acceptance registry. | D6-1: exact canonical ID-set equality includes C1-9, C2-7, C4-7..C4-11, C6-7. D6-2: each row names exact tested head, behavioral test/probe, outcome and limitation; no CI-only PASS. D6-3: model rows distinguish current session patterns, standalone/historical model paths, and live verification. D6-4: video proof shot matches an actually recorded public-dummy session; approval language agrees with D2. D6-5: pending founder/customer/partner facts remain pending until supplied. | 1–2 h | $0; human evidence is separate. |

Do not let a documentation PR declare D1–D5 complete before the tests exist and pass. Do not turn a blocker into a softer adjective to preserve an acceptance claim.

### C9 readiness: current state

| Gate | Status now | Evidence / next requirement |
|---|---|---|
| Complete acceptance set | **Not ready** | Readiness omits original IDs: F12. |
| Approval and body provenance | **Not ready** | Auxiliary-field bypass and A→B→A resurrection: F1/F4. |
| Accurate visible dispatch | **Not ready** | Snapshot repaired; active pending page still stale: F3. |
| Valid raw-evidence replay | **Substantially improved; not final** | Original corruption probes now caught; manifest/comparison states need F8. |
| Frozen runtime configuration | **Not ready** | Same-path drift, incomplete source binding, TS/Python disconnect: F2/F7. |
| Clean mergeable implementation | **Not ready** | #56–#58 fail their own builds; restack required. |
| Safe automated review workflow | **Not certified** | Node guard is not the native Git/package boundary: F9. |
| Actual sealed holdout review | **Blocked / not inspected** | Requires separate authorization and an independent reviewer. I make no claim about annotation quality, seal validity, or contamination. |
| Live execution | **Not performed in this review** | Repair verification does not create a Glimmer or Spark result. |
| $2.10 ceiling | **Proposed, not demonstrated** | [docs/release/c9-readiness.md:38](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/docs/release/c9-readiness.md#L38) explicitly says pricing/resource assumptions/enforcement must be checked. |
| Infra-partner verification | **Pending** | [docs/release/c9-readiness.md:42](https://github.com/Bridgett50/second-seat-hackathon/blob/c6829e3c2a1b12de73878b2462d6d3014542bdac/docs/release/c9-readiness.md#L42). A successful local replay or screenshot is not partner confirmation. |

### The one bounded live run to authorize later

**This is a future authorization package, not permission to run it now. Sealed access and spending remain blocked.**

1. **Freeze one corrected release identity.** Record the reviewed source commit, built package identity, launcher identity, image digest, actual model revision, prompt/schema/scorer identities, decoding/token settings, timeouts, retries, concurrency, request count, and declared demo requests. Verify consumption with the D4 inert test first.
2. **Independently review the holdout only after separate authorization.** The reviewer verifies labels and declared case list without tuning against model outputs. Keep the public development set separate. Freeze before inference; no post-result prompt/label edits disguised as the original run.
3. **Use one declared Modal allocation for Glimmer.** One scored canary is part of the planned set, not an unreported warmup success. If it fails the fixed parse/validation contract, stop; record every remaining planned case not_run. The remainder uses the single frozen bounded concurrency. Do not create an undeclared second allocation or silently rerun failures.
4. **Keep generation bounded and explicit.** The current client defaults include 2048 tokens and a finite request timeout, but the historically observed length/empty-content failure means those defaults are not evidence of model reliability. Set the final token/reasoning policy on public development material before the holdout, capture what the server actually consumes, and count length/empty/malformed replies as failures. Do not parse hidden reasoning as a substitute answer or add an undisclosed retry.
5. **Make one Spark proof request with one actual HTTP attempt.** Use a separately identified public invented demonstration meeting, owner-review its redaction, and approve the exact payload. Select the tested maxAttempts=1 option in the real proof-run entrypoint. Use the frozen response schema and validate the returned meeting/citations/pressure fields according to the actual chosen capability. This is a smoke/proof request, not an accuracy benchmark.
6. **Declare any extra Glimmer demo redaction.** If the Spark proof needs a fresh Glimmer-redacted demo transcript, that request must be included in the config and the same allocation budget. Do not improvise a “quick second run” after finishing the holdout. If no extra request is authorized, do not make one.
7. **Download and replay the entire result.** Preserve planned manifest, inputs/annotations under the authorized evidence policy, raw case-keyed receipts, terminal records, summary/report, launch identity, timing, error/finish metadata, and the proof-request receipt. Verify byte-complete download and strict replay. A killed/partial run must remain partial.
8. **Confirm teardown, actual cost, and partner evidence.** Record allocation identifiers and observable termination; reconcile provider usage/billing and obtain the partner's required verification. Do not declare the Open Weights condition met merely because your own run completed.

**Budget:** retain **PROPOSED $2.00 Modal + $0.10 Spark = $2.10**. I did not check live prices or certify a billing cap. A function timeout bounds function work, not all startup, image build, storage, idle, teardown, or provider billing. Before authorization, calculate the maximum billable allocation under current rates and include every declared request and resource. If $2.10 is a literal hard ceiling, require an enforceable provider/account cap or equivalent verified control; otherwise explicitly present a conservative estimate and do not call it a guarantee. If the bound cannot be demonstrated, the run remains blocked.

A run counts only if its configuration, planned denominator, actual attempts, raw outputs, failures, download, replay, spend, and partner status are all traceable to the same release. A better numerator with an unverifiable denominator does not count.

### Human work that code cannot replace

These tasks must be supplied by people; no agent should invent them.

- **Founder:** provide the real vendor-pressure incident and an identifiable intended buyer role. State the decision at risk and what the assistant should help them notice. Keep demo meeting data invented.
- **Three intended users/buyers:** observe a short public synthetic scenario with and without the assistant. Record completed actions, missed terms, incorrect suggestions, confusion, time, and willingness to reuse. Preserve negative observations. Three observations are exploratory evidence, not a market-size claim.
- **Independent holdout reviewer:** after separate authorization, review frozen annotations and record the review scope. This review did not do that.
- **Owner:** approve the precise paid-run configuration and redacted proof payload after the offline blockers close.
- **Infra partner:** confirm whatever verification the prize requires. Do not substitute self-attestation.
- **Founder/editor:** record the real 20-second story and one successful paste-to-copy flow with persistent execution-mode labeling. Keep the final video within the stated three-minute limit. Historical metrics belong in a concise evidence card, not most of the demo.
- **Release owner:** use one release SHA across README, CI, replay artifacts, screenshots, and video; check public links from a signed-out browser; submit before the user's November 4, 3 PM CT target. No submission was made by this review.

### What stands between this and first place

The largest remaining competitive gap is **proof of a useful buyer outcome from the real connected system**. At present the repository explicitly has no founder story or user observations, and the repaired live path has no new verified execution. That is why Impact remains 3/10 and Meta tooling does not rise just because the test suite grew.

The winning proof shot is small: an intended user nearly accepts a bad term in an invented negotiation, Second Seat shows the exact evidence and limitation, the user corrects/reviews the redaction and decision, then deliberately approves and copies the exact reply. Beside that shot, show an honest complete run record—or an honest partial one—with the full denominator and verified execution identity. Do not lead with a dashboard, test count, mock latency, or a list of Meta product names.

**Cut from the remaining scope:** image/SAM work, new dashboards, a second classifier call, extra model integrations, broad UI redesign, and additional GPU attempts intended to fish for a better score. Keep the text-only assistant, accurate approval/dispatch evidence, valid evaluation, buyer observations, and the final recording.

The repair cycle has earned a higher engineering score. It has not yet earned a privacy guarantee, a completed C9 run, partner verification, or a first-place claim. Close the specific boundaries above, then spend once on a run whose failures you are prepared to publish.

END OF FILE
