# Second Seat — review through PR #80

**Verdict: 5.78/10, versus 5.55 previously (+0.23). The text assistant and validation boundaries have improved; the proposed C9 launch still has concrete offline-reproducible failures. Do not authorize the paid run or sealed access.**

Reviewed final head: **e70277faacdf607324bcc2831e2d38d7fb31f044**. Review date: October 27, 2026, America/Chicago. No merges, deployments, paid calls, model execution, Modal operations, Baseten calls, gen/make.py execution, or sealed holdout access occurred.

## 1. Scope, evidence, and score

I executed the attached review brief. PR descriptions, previous reviews, and ledgers were treated as claims to investigate. I fetched selected public source and tests at each current PR head, checked the stack relationships, inspected the final production paths, and ran isolated probes on invented inputs. I did not clone the repository.

### Exact heads and CI

These are the heads observed during this review. All are open draft PRs. Their immediate bases match the preceding listed head, except #53, whose base is 059362d9e43186b2cf4b3207e3b3ee242549877b. Thus “stacked on main cd0223a” describes ancestry, not each PR's immediate base.

| PR | Head | Immediate base | CI at that head |
|---|---|---|---|
| [#53](https://github.com/Bridgett50/second-seat-hackathon/pull/53) | `7af1d4b077a68d4063546fc94553bb73aa271397` | `059362d9e43186b2cf4b3207e3b3ee242549877b` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40538906424) |
| [#54](https://github.com/Bridgett50/second-seat-hackathon/pull/54) | `077c7d35d1fa7fd8a967f179187e137fb45831b5` | `7af1d4b077a68d4063546fc94553bb73aa271397` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40538954196) |
| [#55](https://github.com/Bridgett50/second-seat-hackathon/pull/55) | `b63c1cf28a6973cfea1ef6cd827164553aa36e5d` | `077c7d35d1fa7fd8a967f179187e137fb45831b5` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40539018422) |
| [#56](https://github.com/Bridgett50/second-seat-hackathon/pull/56) | `de50552b66c25f5c920dff50b2d5252782ec2c39` | `b63c1cf28a6973cfea1ef6cd827164553aa36e5d` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40538898708) |
| [#57](https://github.com/Bridgett50/second-seat-hackathon/pull/57) | `1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a` | `de50552b66c25f5c920dff50b2d5252782ec2c39` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40538893040) |
| [#58](https://github.com/Bridgett50/second-seat-hackathon/pull/58) | `9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8` | `1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40538946207) |
| [#59](https://github.com/Bridgett50/second-seat-hackathon/pull/59) | `7442f77538494fd35e0778d104e19aca694fc5d5` | `9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40538956801) |
| [#60](https://github.com/Bridgett50/second-seat-hackathon/pull/60) | `d1cd7e1e6814933ead71cbd9750b5cb9a2714f28` | `7442f77538494fd35e0778d104e19aca694fc5d5` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40539022389) |
| [#61](https://github.com/Bridgett50/second-seat-hackathon/pull/61) | `dd7c8c69244872f04515d1a20b07a2625b6dcddb` | `d1cd7e1e6814933ead71cbd9750b5cb9a2714f28` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40538880140) |
| [#62](https://github.com/Bridgett50/second-seat-hackathon/pull/62) | `a23b46295c302113a294713adace48d10f97030a` | `dd7c8c69244872f04515d1a20b07a2625b6dcddb` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40540135341) |
| [#63](https://github.com/Bridgett50/second-seat-hackathon/pull/63) | `b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe` | `a23b46295c302113a294713adace48d10f97030a` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40540141326) |
| [#64](https://github.com/Bridgett50/second-seat-hackathon/pull/64) | `6b37061ee2d1726077961e1ac077de20e954a02c` | `b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40540145966) |
| [#65](https://github.com/Bridgett50/second-seat-hackathon/pull/65) | `9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1` | `6b37061ee2d1726077961e1ac077de20e954a02c` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40545644222) |
| [#66](https://github.com/Bridgett50/second-seat-hackathon/pull/66) | `1d19da07260166909d4f7d21ee82f9576923fb64` | `9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40545652471) |
| [#67](https://github.com/Bridgett50/second-seat-hackathon/pull/67) | `7b65505b5991bafd6b0e82d9e3de84e6d712e7d3` | `1d19da07260166909d4f7d21ee82f9576923fb64` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40554811059) |
| [#68](https://github.com/Bridgett50/second-seat-hackathon/pull/68) | `456e81329de7f1b7b7e793a0f5081255e09a7b76` | `7b65505b5991bafd6b0e82d9e3de84e6d712e7d3` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40557478635) |
| [#69](https://github.com/Bridgett50/second-seat-hackathon/pull/69) | `ac87009eaed8e0cf8c9217908c01c8c9611d2dcc` | `456e81329de7f1b7b7e793a0f5081255e09a7b76` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40557485114) |
| [#70](https://github.com/Bridgett50/second-seat-hackathon/pull/70) | `a02b6de1b09c94f9e35b347480a7aa44c00bdecb` | `ac87009eaed8e0cf8c9217908c01c8c9611d2dcc` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40557487516) |
| [#71](https://github.com/Bridgett50/second-seat-hackathon/pull/71) | `bbaba54426d6e0a331480f77bdd96350fbff366d` | `a02b6de1b09c94f9e35b347480a7aa44c00bdecb` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40557496289) |
| [#72](https://github.com/Bridgett50/second-seat-hackathon/pull/72) | `a4948cebfcb04e2779c05b1dde2719ae1313f094` | `bbaba54426d6e0a331480f77bdd96350fbff366d` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40558880093) |
| [#73](https://github.com/Bridgett50/second-seat-hackathon/pull/73) | `497e36a28cb3578375b1c7eb20b31ab7cdbaaef6` | `a4948cebfcb04e2779c05b1dde2719ae1313f094` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40562147904) |
| [#74](https://github.com/Bridgett50/second-seat-hackathon/pull/74) | `28f56e6bc8ef283b31a2939aa25d6065adbb673e` | `497e36a28cb3578375b1c7eb20b31ab7cdbaaef6` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40562879264) |
| [#75](https://github.com/Bridgett50/second-seat-hackathon/pull/75) | `37e5efaa5a073310ff5aeed3119e0ab9d3c926d0` | `28f56e6bc8ef283b31a2939aa25d6065adbb673e` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40564609016) |
| [#76](https://github.com/Bridgett50/second-seat-hackathon/pull/76) | `3fa1bf9c7a30e690e01e81f173e7098a869253a9` | `37e5efaa5a073310ff5aeed3119e0ab9d3c926d0` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40579285735) |
| [#77](https://github.com/Bridgett50/second-seat-hackathon/pull/77) | `749a11844aaabf5a2b72e32d6bf5ba97a17d856c` | `3fa1bf9c7a30e690e01e81f173e7098a869253a9` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40579334125) |
| [#78](https://github.com/Bridgett50/second-seat-hackathon/pull/78) | `e387c2967a7e10fd0056b02ed5b0c9b4e7eed22c` | `749a11844aaabf5a2b72e32d6bf5ba97a17d856c` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40579340675) |
| [#79](https://github.com/Bridgett50/second-seat-hackathon/pull/79) | `1edcd2c2632c15d3c427bac7435d4f1eed409c8d` | `e387c2967a7e10fd0056b02ed5b0c9b4e7eed22c` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40579344729) |
| [#80](https://github.com/Bridgett50/second-seat-hackathon/pull/80) | `e70277faacdf607324bcc2831e2d38d7fb31f044` | `1edcd2c2632c15d3c427bac7435d4f1eed409c8d` | [success](https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40580555318) |

The claim that current PR heads have green CI is supported by GitHub run metadata. That does not establish that each acceptance criterion is satisfied. The old #56–#58 build failure is fixed in the current restacked heads; I do not carry that obsolete blocker forward.

### What was independently executed

All transports below were fake; all source files and datasets used by probes were explicitly allowlisted and unsealed.

- Parent/head body comparison: #75 Glimmer code sends temperature 1/top_p 0.95; final code sends temperature 0 with top_p absent.
- Parent/head E1 boundary comparison: #67 buildUserMessage accepts an unknown input key and a pressure label citing nonexistent seg-99; final code rejects both. The old unknown key was not itself serialized in this particular probe; rejection hardening must not be described as a demonstrated leak of that key.
- Parent/head E4 replay: an unchanged dummy bundle is complete_match on both implementations; an empty saved summary is complete_match on #69 and mismatch on final; a dot-segment alias is incomplete/ok=true on #69 and integrity_failure/ok=false on final.
- Parent/head E7 handler probe: with approval response held, A→B→A, and no debounce callbacks executed, #72 keeps Copy disabled locally but server draft approval remains true; final code keeps Copy disabled and server draft approval becomes false.
- Actual current eval CLI with a mapped flat launch config: rejects it with exit 2, including “dataset must be an object,” “model must be an object,” and missing nested configuration sections.
- Actual runEval with a dummy run-config file already staged in its run directory: refuses reuse before making any redactor calls.
- Actual current Glimmer client with fake HTTP: confirmed max_tokens=2048 default, temperature=0, reasoning_strength=low, no seed, no top_p.
- Actual current positive pressure validation rejects an invented contact not quoted in its bound segment. A tactic=none label with invalid segment/nonmatching span is accepted; session assessment becomes valid_negative/allReviewed=true. This is the disclosed known defect, not a newly discovered one.
- Real Git operations on a fresh dummy repository: clean matching HEAD passes git_binding_blockers; wrong source SHA and tracked drift are refused.
- Real Git worktree operation on that dummy repository: ordinary worktree add materializes a tracked forbidden dummy sentinel before any sparse exclusion. No real sealed path or manifest was involved.

The modules used by Node probes were transpiled with Node's TypeScript transformer; import paths were relocated in an isolated harness. Shared tactic constants came from the pinned core declaration. Browser behavior was exercised through the real embedded script with a small DOM/fetch harness and controlled promises, **not** a claimed Playwright run. The E7 fake server included the new reject route; without that route a harness would misdiagnose the repair.

I did not execute the repository's full suite, the complete Muse helper, the SAM package's tests, or every named test against every immediate parent. The helper itself has an unsafe checkout order, so executing it on the real repository would violate this review's restrictions. I do not certify the requested universal “every new test failed behaviorally on its parent” claim. The acceptance annex explicitly distinguishes independent execution, source evidence, and unverified execution.

### Rubric

| Category | Previous | Now | Weighted contribution | Judgment |
|---|---:|---:|---:|---|
| Impact, 30% | 3.0 | **3.0** | 0.900 | Founder story, observations, and video remain pending at [README.md:68](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/README.md#L68). Scheduled tryouts are not completed evidence. No invented market demand or savings credit. |
| Meta AI Tooling, 25% | 6.0 | **6.5** | 1.625 | Better real API-shape integration, explicit structured-output behavior, parser integration, and per-family cache keys. But image/SAM is outside the core text flow; cache hits and the repaired live model path remain unmeasured. |
| Technical Depth & Execution, 20% | 7.0 | **7.5** | 1.500 | E1 provenance checks, E4 replay corrections, E7 server revocation, and E8 Git binding address actual failures. The launch/config composition and helper checkout defects remain material. |
| Demo, 25% | 7.0 | **7.0** | 1.750 | The copy flow is stronger, but there is no finished video, buyer observation, or new live execution to raise this score. A newly correct parser for an off-path feature does not improve the core demo by itself. |

**Total: 0.900 + 1.625 + 1.500 + 1.750 = 5.775, rounded to 5.78/10.** Cursor's 5.75 was a different review of a different stage; it is not an independent measurement to average into this score.

A 9+ startup entry needs demonstrated user benefit and a clear model-enabled result, not just a larger repair stack. The biggest competitive deficit remains unchanged: no verified buyer outcome from the connected system.

## 2. Blocking findings and known limitations

### EF-1 — P1: the launcher passes a config shape the eval CLI rejects

**Newly identified composition failure. Present by #69 and still at #80.**

Evidence: [services/bot/src/release/runConfig.ts:357](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/src/release/runConfig.ts#L357), [infra/modal/glimmer_app.py:70](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/infra/modal/glimmer_app.py#L70), [infra/modal/launch_contract.py:263](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/infra/modal/launch_contract.py#L263), [infra/modal/glimmer_app.py:198](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/infra/modal/glimmer_app.py#L198), [services/bot/scripts/redaction-eval.mjs:75](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/scripts/redaction-eval.mjs#L75).

There are two different formats:

- The Python launch contract requires dataset as a string, image as a string, model_revision, source_sha, and other flat fields.
- The TypeScript eval validator requires dataset/model/image objects, sourceSha, prompt/schema/scorer sections, decoding, timeouts, retry, modal, and budget.

toLaunchConfig deliberately converts the nested form into the flat one and drops many execution settings. glimmer_app stages the exact imported **flat launch bytes**, then tells redaction-eval to validate those bytes as the nested form.

**Minimal reproduction, executed:** construct a valid invented nested config; verify validateRunConfig returns []; map it through the real toLaunchConfig; save the output to an unsealed temporary file; execute the real eval CLI with --cases dummyx --run-config that-file --dry-run.

**Observed:** exit 2; missing sourceSha/prompt/schema/scorer/decoding/tokenLimits/timeouts/retry/modal/budget; dataset/model/image wrong types. No fixtures or model endpoint were accessed.

The reverse substitution is not a repair: passing the nested config to main fails the flat Python checks and its image selection. The same dataset key cannot simultaneously be a string and the required object.

**Why green tests miss it:** E2-3 validates a nested dummy config directly in --dry-run. E2-1/E2-2 exercise pure builders. E2-5 checks source strings. They do not compose the accepted main configuration with the container's actual eval CLI.

**Required fix:** define one canonical configuration or explicitly stage both a validated execution config and its bound launch projection. A single inert integration test must carry one invented config through main → app construction → eval command → real eval CLI validation. No paid run is needed to find or fix this.

### EF-2 — P1: staging run-config inside the run directory makes runEval reject the run

**Newly identified, independent of EF-1. Present by #69; persists.**

Evidence: [infra/modal/glimmer_app.py:198](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/infra/modal/glimmer_app.py#L198) creates /results/<run_id>/run-config.json before invoking Node. [services/bot/scripts/redaction-eval-runner.mjs:298](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/scripts/redaction-eval-runner.mjs#L298) refuses any existing runDir to prevent reuse.

**Minimal reproduction, executed:** create <dummy-out>/<run-id>/run-config.json, then invoke the real runEval with the same outDir/runId and an invented case/fake redactor.

**Observed:** “runEval: run dir already exists (refusing reuse),” zero redactor calls.

If EF-1 is fixed alone, this is the next failure. It must be tested independently. Do not “fix” it by removing the runner's reuse protection globally.

**Required fix:** stage configuration outside the exclusively owned run directory, or let the runner create the directory and record configuration as part of a single deliberate ownership protocol. Test fresh success, config evidence preservation, and refusal to reuse an existing completed or interrupted run.

### EF-3 — P1 for the repair workflow: the helper copies a full base tree before excluding sealed data

**Newly identified. Originates in #67, survives relocation in #79.**

Evidence: [.muse/verify_pr.sh:220](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/.muse/verify_pr.sh#L220) invokes git worktree add --detach. Sparse exclusion is applied only at [.muse/verify_pr.sh:234](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/.muse/verify_pr.sh#L234). The earlier helper has the same order in scripts/verify_pr.sh at #67.

A non-sparse Git worktree checkout materializes tracked files immediately. Excluding them afterwards does not undo an unauthorized copy. Locking the script against agent edits does not repair its operation order.

**Minimal reproduction, executed on invented data only:** create a fresh dummy Git repository with README.md and forbidden-dummy/sentinel.txt tracked; perform the helper's ordinary worktree-add operation; before applying exclusions, check existence of the sentinel in the new checkout.

**Observed:** forbiddenDummyExists=true.

I did not run this helper on Second Seat, did not read any real sealed path, and did not run its model driver.

**Required fix:** create the worktree without checkout, install a verified nonsealed sparse policy, then materialize only allowed files. Fail if exclusion setup fails. Test the whole sequence with dummy sentinels and an access/copy observer; testing only the final sparse tree is insufficient.

The main CI workflow now has sparse checkout and a separately excluded secret scan; that is a real improvement over the C review ([.github/workflows/ci.yml:18](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/.github/workflows/ci.yml#L18), [scripts/ci/secret-scan.sh:11](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/scripts/ci/secret-scan.sh#L11)). It does not excuse this separate helper path.

### EF-4 — P1 for C9 evidence validity: several “frozen” settings are only calculated or printed

**Continuation of the disclosed D4-4/D4-6 gap; #69 does not fully close it.**

Evidence: [services/bot/scripts/redaction-eval.mjs:84](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/scripts/redaction-eval.mjs#L84), [services/bot/scripts/redaction-eval.mjs:128](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/scripts/redaction-eval.mjs#L128), [services/bot/scripts/redaction-eval.mjs:135](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/scripts/redaction-eval.mjs#L135), [services/bot/src/private/redact.ts:658](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/src/private/redact.ts#L658), [infra/modal/glimmer_app.py:141](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/infra/modal/glimmer_app.py#L141), [infra/modal/glimmer_app.py:170](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/infra/modal/glimmer_app.py#L170).

What reaches execution:

- maxTokens is exported through GLIMMER_MAX_TOKENS.
- concurrency is passed to runEval.

What is not established by the current wiring:

- runnerSettings.deadlineMs does not become the runner deadline; it still comes from GLIMMER_DEADLINE_MS.
- runnerSettings.requestMs is not passed as the per-request limit; runner applies its existing 90-second/remaining-time policy.
- frozen temperature, seed, and reasoning settings do not drive Glimmer's actual body. The real body still fixes temperature=0 and reasoning_strength=low and has no seed.
- clientOptions.maxAttempts is computed using sparkProofClientOptions and printed, but makeRedactor remains () => liveRedactor(). No Spark proof client is constructed here.
- function timeout remains 840; readiness/work deadline uses the helper defaults rather than the full frozen configuration.

Do not confuse the current Glimmer client's absence of a retry loop with a tested Spark proof maxAttempts path. They are different call families.

**Independent evidence:** a valid dummy config maps requestMs=10000 and maxTokens=512 into settings, while the live Glimmer body probe without a corresponding env export still shows its defaults. The decisive source trace is that the CLI passes neither requestMs nor decoding to its factories. This is not a claim that every ignored setting caused a live failure.

**Additional model-context problem:** launch_contract derives --max-model-len directly from tokenLimits.maxTokens ([infra/modal/launch_contract.py:82](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/infra/modal/launch_contract.py#L82)). An output-token cap and the server's total context limit are different settings. Giving both the same value leaves no reserved room for the input. Add a separate context limit and validate input/output budgeting before a paid attempt.

**Required fix:** capture actual request bodies, runner timeouts/concurrency, and server arguments from the same canonical configuration. Changing an accepted frozen field must change the consumed behavior or be rejected. A DRYRUN JSON report is not execution evidence.

### EF-5 — P1 evidence-policy failure: staging failure silently falls back to an unfrozen eval

Evidence: [infra/modal/glimmer_app.py:190](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/infra/modal/glimmer_app.py#L190) says configuration staging is best effort. The exception handler resets run_config_path=None and still calls eval_command.

**Trigger:** make the configuration staging write fail in an inert application test.

**Expected:** exit/failure evidence, zero eval subprocess invocations, and cleanup of the fake vLLM process.

**Code behavior:** proceed without --run-config and use defaults. This was statically demonstrated, not fault-injected against a real container.

This fallback violates a frozen-run contract even when it happens to produce valid output. It should stop rather than quietly change configuration. Keep failure receipts and teardown in finally; do not publish the resulting attempt as the frozen run.

### EF-6 — P2: current ledger commit/CI pairings are not evidence of the same revision

**Known disclosed issue, confirmed rather than counted as new.**

Evidence: [README.md:38](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/README.md#L38) pairs restacked C1 head 077c7d3… with run 40479067260 from the old C1 head. Similar C rows retain old run IDs. The current correct C1 run is 40538954196 (or the current-head push run); see the exact-head table above.

The existing CI results can now replace those stale links. Do not label an old failure as the status of the new head, or pair a new commit with an old success. The acceptance registry also attributes prior before/after observations to newly restacked commits without independently recreating all of those observations. Preserve original tested identity or rerun safely and record the new identity.

Tests that merely require a SHA and an actions URL do not verify the relationship. Fetch each run's head_sha and compare it with the row's tested commit.

### EF-7 — P2: tactic=none bypasses provenance checks

**Known disclosed “defect #8”; confirmed, not new.**

Evidence: [services/bot/src/brief/muse.ts:202](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/src/brief/muse.ts#L202) continues before validating segment/span; [apps/web/src/session.ts:297](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/apps/web/src/session.ts#L297) similarly skips none.

**Executed probe:** an invalid segment and unquoted invented contact with tactic=none pass assertBoundPressureLabels. The session reports valid_negative, items=[], allReviewed=true for a shaped none output.

The outbound renderer omits none labels; this probe does **not** show that the contact is sent to Spark. The problem is invalid classifier evidence being treated as a reviewed negative. Require a coherent explicit negative contract, or validate every field before interpreting none. Reject contradictory none-with-span output; test all-invalid and mixed arrays.

### EF-8 — P2 product/claim gap: default pressure remains patterns and “unresolved term” remains weak provenance

**Known F10, still open.**

Evidence: [apps/web/src/session.ts:248](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/apps/web/src/session.ts#L248) accepts an ask substring anywhere in approved text, and [apps/web/src/session.ts:1043](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/apps/web/src/session.ts#L1043) selects deterministic patterns by default. The assessment is prepared before Spark.

The code can honestly say “pattern matches linked to current text.” It cannot claim that the connected Spark response discovers pressure or establishes that a term is unresolved. A different segment containing the same term does not establish its relationship to a particular pressure item.

Keep this advisory and narrowly labeled, or put one structured pressure/term assessment in the already authorized model response and validate exact citations. Do not add a second classifier call solely for a stack-counting benefit.

### EF-9 — P2 test-verification limitations in the helper

Evidence: [.muse/verify_pr.sh:186](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/.muse/verify_pr.sh#L186), [.muse/verify_pr.sh:195](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/.muse/verify_pr.sh#L195), [.muse/verify_pr.sh:205](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/.muse/verify_pr.sh#L205).

The helper judges the exit status of each configured **command**, not necessarily each test within it. One failing test can make an entire file fail on base while its other tests already pass. Its weak-error regex catches common import failures but does not prove the remaining failure is the intended assertion. Preparation failures are allowed to continue before the base command.

It also assesses weakening by counting test declarations, which cannot detect a removed assertion, a weaker expectation, or a vacuous replacement with the same count. Zero configured tests can leave no failing-first checks at all.

These are limitations of verification evidence, not a reason to discard all existing tests. Require per-case failure identity and an explicit guard/new-regression distinction. The disclosed #78 ratio test passing its parent is appropriate for an existing-behavior guard; it should not be relabeled a new fix.

### Repairs that deserve credit

- **E1:** positive labels now reject unknown keys, nonexistent segments, short/nonmatching spans, and invalid meeting IDs. Direct buildUserMessage also validates. A legacy pressureAssessment key may be stripped under its narrow compatibility rule; that is not the former arbitrary-string outbound channel. [services/bot/src/brief/muse.ts:145](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/src/brief/muse.ts#L145) and line 179.
- **E4:** replay compares the complete saved-summary key set and rejects dot-segment aliases/symlinks. The independent subset-summary and alias probes confirm real behavior changes, not missing exports.
- **E7:** synchronous local edit intent now sends a revision-aware reject when approved or approving; the old held response cannot leave server approval true after the reject completes. My controlled parent/head probe confirms it. [apps/web/src/render.ts:1013](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/apps/web/src/render.ts#L1013).
- **E8:** HEAD equality and working-tree checks genuinely reject wrong SHA and tracked drift in a dummy real Git repository. [infra/modal/launch_contract.py:320](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/infra/modal/launch_contract.py#L320). This is not an atomic snapshot of all build inputs, but it closes the particular earlier fabricated-SHA acceptance.
- **E10:** temperature and prompt/validator changes are real request-level improvements. Official sources do conflict: the [structured-output recipe](https://github.com/meta-models/meta-oss-cookbook/blob/main/muse-glimmer/recipes/structured-output/README.md) recommends greedy extraction while the [vLLM guide](https://github.com/meta-models/meta-oss-cookbook/blob/main/muse-glimmer/inference-server/vllm.md) warns against greedy generation. The README now discloses the choice. That choice remains unvalidated on a new live run.
- **E11:** the live SAM client feeds parsed SSE events into parseImageStream and requests include_confidence. The test supplies content_part.done without deltas and asserts an exact box, then checks fixture mask dimensions. These are relevant assertions against the [official parser contract](https://github.com/meta-models/meta-sam/blob/main/typescript/packages/parser/README.md), not just an import-name check. I did not run the package tests locally. The separately disclosed hero-chain parser remains separate; do not claim universal migration.
- **E12:** distinct stable per-family cache keys are actually used in brief, Shield, and support bodies. Stored usage drives the ratio display. No live cache-hit evidence exists, and the ratio guard appropriately may pass before its test rewrite.
- **E13:** the driver explicitly prepends locked rules to first and retry prompts and exits before Muse if those rules are absent. Root-pointer load precedence is therefore not being mistaken for automatic rule loading. This is separate from EF-3.
- **E14:** the freeze script hashes the inline redaction template source and has meaningful mutation/equality tests. This source hash does not itself enforce launch freshness; C9 must compare the actual frozen configuration to consumed identities.

## 3. Per-PR verdicts

A **pass** means the focused code change is supported by inspected implementation and relevant evidence, subject to the stated limitation; it is not a universal test-execution certificate. **Fix** means a concrete acceptance/evidence issue remains. **Block** means an authorization, sealed-access, or launch boundary should not advance as accepted.

Earlier heads are judged at their own code. A later fix can make the final stack usable without retroactively making an earlier acceptance claim true.

| PR | Verdict | Exact evidence at that head | Reason / required action |
|---|---|---|---|
| #53 | **pass** | [.github/workflows/ci.yml:18](https://github.com/Bridgett50/second-seat-hackathon/blob/7af1d4b077a68d4063546fc94553bb73aa271397/.github/workflows/ci.yml#L18) | Restacked nonsealed CI, lexical/canonical guard and excluded secret scan are useful scope repairs. This is not approval of the later helper checkout. |
| #54 | **pass** | [apps/web/src/session.ts:1](https://github.com/Bridgett50/second-seat-hackathon/blob/077c7d35d1fa7fd8a967f179187e137fb45831b5/apps/web/src/session.ts#L1) | Revision/assessment-bound mutations and original A→B protections are sound for their stated cases. A→B→A was still open here and is credited only to later D2/E7. |
| #55 | **fix** | [apps/web/src/session.ts:1](https://github.com/Bridgett50/second-seat-hackathon/blob/b63c1cf28a6973cfea1ef6cd827164553aa36e5d/apps/web/src/session.ts#L1) | Snapshot receipts improve; this head alone lacks the active pending-page update. Require D2 behavior before release; do not credit it to C2. |
| #56 | **pass** | [apps/web/test/c3-contract.test.ts:3](https://github.com/Bridgett50/second-seat-hackathon/blob/de50552b66c25f5c920dff50b2d5252782ec2c39/apps/web/test/c3-contract.test.ts#L3) | Current restacked test imports the package rather than crossing into core source. The formerly broken build is no longer a current-head blocker. |
| #57 | **fix** | [services/bot/scripts/rescore-glimmer-run.mjs:1](https://github.com/Bridgett50/second-seat-hackathon/blob/1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a/services/bot/scripts/rescore-glimmer-run.mjs#L1) | Strict default replay is valuable, but this head still needs the manifest/comparison repairs in D5/E4. Accept final replay only after those successors. |
| #58 | **fix** | [infra/modal/glimmer_app.py:1](https://github.com/Bridgett50/second-seat-hackathon/blob/9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8/infra/modal/glimmer_app.py#L1) | Actual SDK-shaped download adapter improves; imported-config drift and incomplete execution binding require later D4/E8 and EF-1–EF-5 repairs. |
| #59 | **block** | [apps/web/src/session.ts:1](https://github.com/Bridgett50/second-seat-hackathon/blob/7442f77538494fd35e0778d104e19aca694fc5d5/apps/web/src/session.ts#L1) | At this head the unbound pressureAssessment channel remains. D1/E1 repairs are later work, not evidence that this head was safe. |
| #60 | **fix** | [README.md:7](https://github.com/Bridgett50/second-seat-hackathon/blob/d1cd7e1e6814933ead71cbd9750b5cb9a2714f28/README.md#L7) | Historical/execution labels improve, but acceptance evidence/approval claims remain stale. Replace with the verified release ledger. |
| #61 | **fix** | [services/bot/src/release/runConfig.ts:1](https://github.com/Bridgett50/second-seat-hackathon/blob/dd7c8c69244872f04515d1a20b07a2625b6dcddb/services/bot/src/release/runConfig.ts#L1) | Preparation-only status is correct. Its validator/config helpers do not establish actual launch binding; later settings work remains incomplete. |
| #62 | **fix** | [services/bot/src/brief/muse.ts:1](https://github.com/Bridgett50/second-seat-hackathon/blob/a23b46295c302113a294713adace48d10f97030a/services/bot/src/brief/muse.ts#L1) | Structured provenance is directionally correct but the E1 follow-up is needed for exact segment/key validation. None semantics still need EF-7. |
| #63 | **fix** | [infra/modal/glimmer_app.py:1](https://github.com/Bridgett50/second-seat-hackathon/blob/b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe/infra/modal/glimmer_app.py#L1) | Same-path byte/launcher drift checks improve. Its composed launch path remains incomplete, and source-SHA binding is only added later. |
| #64 | **pass** | [services/bot/scripts/rescore-glimmer-run.mjs:1](https://github.com/Bridgett50/second-seat-hackathon/blob/6b37061ee2d1726077961e1ac077de20e954a02c/services/bot/scripts/rescore-glimmer-run.mjs#L1) | Manifest-first validation and complete_uncompared policy improve replay. Dot aliases/subset summaries still need E4; this is a focused implementation pass, not full replay certification. |
| #65 | **fix** | [apps/web/src/render.ts:1](https://github.com/Bridgett50/second-seat-hackathon/blob/9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1/apps/web/src/render.ts#L1) | Edit generations and polling fix the open page, but this head still leaves server approval true in the A→B→A held-response case; E7 is required. |
| #66 | **fix** | [docs/release/acceptance-registry.md:1](https://github.com/Bridgett50/second-seat-hackathon/blob/1d19da07260166909d4f7d21ee82f9576923fb64/docs/release/acceptance-registry.md#L1) | Complete ID registry is useful; copied probe provenance and current/old commit evidence need correction. A new ledger must not silently retag old observations. |
| #67 | **block** | [scripts/verify_pr.sh:1](https://github.com/Bridgett50/second-seat-hackathon/blob/7b65505b5991bafd6b0e82d9e3de84e6d712e7d3/scripts/verify_pr.sh#L1) | Full worktree checkout precedes sparse exclusions. Fix EF-3 before this helper is used against a repository with sealed files. Its command-level verifier is not per-test mutation proof. |
| #68 | **pass** | [services/bot/src/brief/muse.ts:179](https://github.com/Bridgett50/second-seat-hackathon/blob/456e81329de7f1b7b7e793a0f5081255e09a7b76/services/bot/src/brief/muse.ts#L179) | Rejects unknown input/label keys and binds positive spans to exact seg-N segments; direct renderer validation is also present. Known none semantics remain separately open. |
| #69 | **block** | [infra/modal/glimmer_app.py:1](https://github.com/Bridgett50/second-seat-hackathon/blob/ac87009eaed8e0cf8c9217908c01c8c9611d2dcc/infra/modal/glimmer_app.py#L1) | Pure builders/dry-run do not compose. Flat/nested mismatch, precreated run-dir collision, ignored settings, and silent config fallback block C9. |
| #70 | **pass** | [services/bot/scripts/rescore-glimmer-run.mjs:1](https://github.com/Bridgett50/second-seat-hackathon/blob/a02b6de1b09c94f9e35b347480a7aa44c00bdecb/services/bot/scripts/rescore-glimmer-run.mjs#L1) | E4 alias and saved-summary corrections are behaviorally confirmed versus its parent implementation. Symlink assertions are relevant but not locally rerun. |
| #71 | **pass** | [services/bot/test/support/sealed-guard.mjs:1](https://github.com/Bridgett50/second-seat-hackathon/blob/bbaba54426d6e0a331480f77bdd96350fbff366d/services/bot/test/support/sealed-guard.mjs#L1) | Guard recognizes concatenated inline paths and symlink aliases; compile-cache isolation and CI repeat-check are wired. Regex/text checks remain narrower than a sandbox or Node-22 behavioral before-run. |
| #72 | **fix** | [docs/release/acceptance-registry.md:1](https://github.com/Bridgett50/second-seat-hackathon/blob/a4948cebfcb04e2779c05b1dde2719ae1313f094/docs/release/acceptance-registry.md#L1) | Known commit/CI mismatch remains; reconcile exact evidence identities instead of retaining old CI IDs beside new heads. |
| #73 | **pass** | [apps/web/src/render.ts:1](https://github.com/Bridgett50/second-seat-hackathon/blob/497e36a28cb3578375b1c7eb20b31ab7cdbaaef6/apps/web/src/render.ts#L1) | Held-approval A→B→A now revokes server approval before debounce. Independently reproduced versus #72. This is not proof of session persistence across a real reload. |
| #74 | **pass** | [infra/modal/launch_contract.py:320](https://github.com/Bridgett50/second-seat-hackathon/blob/28f56e6bc8ef283b31a2939aa25d6065adbb673e/infra/modal/launch_contract.py#L320) | Real Git HEAD/clean-tree check closes the fabricated-SHA/tracked-drift acceptance. Does not make the run config formats compose or create a billing guarantee. |
| #75 | **fix** | [docs/release/c9-readiness.md:1](https://github.com/Bridgett50/second-seat-hackathon/blob/37e5efaa5a073310ff5aeed3119e0ab9d3c926d0/docs/release/c9-readiness.md#L1) | Correctly calls E7/E8 drafts, but inherits stale evidence pairings and a very long historical-status narrative. Produce one concise current release matrix. |
| #76 | **pass** | [services/bot/src/private/redact.ts:645](https://github.com/Bridgett50/second-seat-hackathon/blob/3fa1bf9c7a30e690e01e81f173e7098a869253a9/services/bot/src/private/redact.ts#L645) | Actual request temperature and empty-answer prompt match the intended extraction shape. Live quality remains unknown; document the official guidance conflict. |
| #77 | **pass** | [services/bot/src/vision/sam.ts:299](https://github.com/Bridgett50/second-seat-hackathon/blob/749a11844aaabf5a2b72e32d6bf5ba97a17d856c/services/bot/src/vision/sam.ts#L299) | Official parser is now on the live SSE path with confidence and terminal content-part coverage. Keep this experimental/off-core; do not imply hero-chain migrated. |
| #78 | **pass** | [services/bot/src/promptCache.ts:1](https://github.com/Bridgett50/second-seat-hackathon/blob/e387c2967a7e10fd0056b02ed5b0c9b4e7eed22c/services/bot/src/promptCache.ts#L1) | Per-family keys are used at all three bodies; ratio display is data-derived and explicitly historical. No cache-performance claim is earned. |
| #79 | **fix** | [scripts/muse_pr.sh:24](https://github.com/Bridgett50/second-seat-hackathon/blob/1edcd2c2632c15d3c427bac7435d4f1eed409c8d/scripts/muse_pr.sh#L24) | Locked location and prompt injection are correct improvements, but the relocated verifier retains EF-3. Also retain explicit limits of shell/regex-based guarding. |
| #80 | **fix** | [services/bot/scripts/prompt-freeze.mjs:20](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/services/bot/scripts/prompt-freeze.mjs#L20) | Source-prompt hashing and re-freeze notes are valuable. Do not mark C9 ready; correct the surviving commit/CI pairings and link the actual runtime blockers. |

### Test evidence audit

| Change / named regression | What the assertion proves | Parent/head status independently established here |
|---|---|---|
| E1-a..c3, e1-adapter.test.ts | Unknown top-level/label keys, invalid segment/quote, meeting-ID charset, direct renderer checks | Equivalent buildUserMessage unknown-key and nonexistent-segment probes run on #67 and final; other named cases inspected, not individually rerun. No blanket nine-test mutation certificate. |
| E2-1 | eval_command accepts/threads a config argument | Parent lacking the argument is an API-shape failure; not proof of runtime binding. |
| E2-2 | pure vllm_argv builder derives its flags | Parent missing the builder is weak before-evidence. Output-token/context conflation remains. |
| E2-3/E2-4 | nested config dry-run output and invalid retry rejection | Tests do not use the flat config accepted by main. Independent composition probe fails on final. |
| E2-5 | glimmer_app source mentions builder/config variable | Text-level assertion; misses EF-1/EF-2/EF-5. |
| E4-1 | dot-alias planned path rejected | Equivalent parent/head behavior run and confirmed. |
| E4-2 | empty/subset summaries cannot be complete_match | Equivalent empty-summary parent/head behavior run and confirmed. |
| E4-3 | symlinked input/records/summary refused | Test assertions and lstat validation inspected; symlink test not executed locally. |
| E5-repeat/E5-ci | script isolates compile cache; workflow names repeat-check | The parent already passes on the disclosed Node-20 host. Text assertions do not establish a failing Node-22 parent. Current CI invocation is independently visible. |
| E5-concat/E5-symlink | child-argument guards recognize those spellings/aliases | Implementation and focused tests inspected; no current local parent/head execution claim. Do not run arbitrary shell payloads against real sealed paths. |
| E3-1 in #73 | paused clock; held approval; server approved:false; new snapshot render Copy disabled | Equivalent real-handler/server-store probe run versus #72, confirmed. The test uses setContent(renderSessionPage(snapshot)), not actual browser reload/session recovery. |
| E3-2 | normal deliberate approval creates no reject or 409 | Useful existing-behavior positive control; no requirement that it fail on the parent. Inspected, not locally Playwright-run. |
| E8-1..4 | clean real Git HEAD passes; wrong SHA, tracked drift, untracked drift refused | Clean/wrong-SHA/tracked-drift helper behavior independently run on a dummy Git repo. No full old/new four-test application-stub run claimed. |
| E10-1/E10-2 | outgoing sampling settings for text/image | Text body compared against #75 and final. Image-specific named test inspected, not executed locally. |
| E10-3 follow-up | prompt-advertised JSON literals pass actual validator | Assertion is behavioral and relevant; local named old/new literal-loop run not performed. Official recipe conflict separately verified from primary sources. |
| E11-1..5 | real package API, confidence request, terminal-only/delta streams, fixture mask/box consistency | Source and exact test assertions inspected against official API contract. Package not installed/run in this isolated harness; no new local parent/head certificate. |
| E12 family key test | three distinct family keys; repeated brief key remains stable | Uses actual client bodies in the repository test; source wiring independently checked in all three clients. Not locally rerun across parents. |
| E12 ratio rewrite | arbitrary usage aggregation, data-derived HTML, synthetic 25% | Correctly disclosed as an existing-behavior guard that passes its parent. No new implementation-fix credit. |
| H10–H12 | locked layout, injected rules, missing-rules refusal, resolvable pointer | Relevant helper tests; not executed because the real verifier's checkout sequence is unsafe. Code/source inspected. |
| E14F-1..3 | row exists, source-prompt mutation changes hash, committed output matches a fresh isolated run | Meaningful source-hash tests. Not locally rerun; no proof that C9 consumes that hash. |
| E6/E9/E14 prose tests | wording, links, sampling/re-freeze notes exist | Text checks are appropriate for text, insufficient to verify CI-to-SHA identity or a successful launch. |

**Important distinction:** before-evidence based only on absent files/exports, one nonzero suite exit, or a string appearing in a script does not satisfy “each new test fails for the real reason.” This review does not repeat that claim from PR descriptions.

## 4. Ranked repair plan and merge order

### Focused free/offline PRs

| Priority | Small PR / files | Acceptance criteria and failing-first test |
|---:|---|---|
| 1 | **G1: make helper checkout nonsealed from the first filesystem operation.** .muse/verify_pr.sh; scripts/tests/muse-helper.test.sh | In a fresh dummy Git repo, track a forbidden sentinel. Instrument checkout/copy operations. Parent materializes it; corrected verifier never does, including during sparse setup failure. Use no-checkout before exclusions; fail closed on setup errors. Also reject empty criteria and report each intended failing assertion rather than claiming a whole file is per-test evidence. No real sealed paths or model driver execution. |
| 2 | **G2: one composable launch/execution configuration and run-directory ownership.** runConfig.ts; launch_contract.py; glimmer_app.py; redaction-eval.mjs; inert integration test | A valid invented canonical config passes main's projection and the actual CLI validator unchanged or through an explicit bound mapping. Capture an inert image/argv, run the real CLI with fake transport, and complete one dummy case. Stage config without precreating the owned run directory. Parent fails schema composition or reuse; head succeeds. Reusing a prior run still fails. |
| 3 | **G3: consume every accepted frozen setting and refuse staging failure.** same runtime files plus redaction client/runner | Mutate request timeout, work deadline, concurrency, output cap, seed, temperature and reasoning independently. Each changes the actual consumed setting or validation refuses it. Separate context limit from output limit. Force config staging to fail: zero eval invocations and cleanup evidence. Hold/reject a fake Spark proof response: exactly one HTTP attempt. Test without a GPU, vLLM process, or real endpoint. |
| 4 | **G4: coherent negative pressure contract; narrow term claims.** session.ts; brief/muse.ts; shared pressure types/tests | tactic=none with nonempty positive span, bad ID, invented text or unknown fields must not become valid_negative/allReviewed=true. Include mixed positive/invalid arrays and an explicit valid-negative control. For unresolved terms, require a cited provenance policy or render term not identified. Parent must fail these semantic assertions. Keep patterns labeled as patterns. |
| 5 | **G5: release evidence tied to actual commits.** README; acceptance-registry.md; c9-readiness.md; docs tests | Every CI link resolves to a run with head_sha equal to tested head, or is explicitly labeled historical with its original SHA. Do not relabel old probe observations after restacking. Replace broad before/after claims with per-case results and guard classifications. Exact canonical ID-set equality remains required. |
| 6 | **G6: one final safe proof rehearsal and release bundle.** existing text-flow browser tests; public invented demo fixture; release checklist | On the corrected final commit, run one complete fake-transport paste→redact→correct→approve→analyze→review→edit→approve→copy test. Assert exact outgoing approved bytes, receipt time, failed/unknown states, stale-response discard and exact clipboard bytes. Re-run the targeted original regressions only after the workflow is proven nonsealed. Produce one current evidence index. Do not add features. |

Estimated effort: G1 1–2 hours; G2 2–4 hours; G3 2–4 hours; G4 1–2 hours; G5 1 hour; G6 1–2 hours plus recording. These are planning estimates, not measured costs or promises. Provider spend for G1–G6 should be **$0**.

Human work stays separate: founder story, October 30 buyer tryouts, independent authorized holdout review, exact paid-run/payload approval, partner confirmation, recording and submission. Do not fabricate or mark those complete through code.

### Merge commits only

Do not squash, rebase, or force-push merely to implement this recommendation. No merge was performed here.

1. Add fixes on their owning stacked branches, preserving history, and merge those changes forward in order. In particular, repair #67/#69 before treating their helper/launcher as accepted. Updating only the final tip would leave misleading per-PR claims.
2. Refresh dependent branches with merge commits and rerun exact-head checks. The current green runs belong to the currently listed SHAs, not future merge commits.
3. Merge into main in dependency order: **#53 → #54 → … → #80**, including corrections that belong to those branches, then any final focused repair PRs that cannot be included earlier.
4. If #44–#52 are still required unmerged ancestors, they must be handled before #53. This review did not approve those older PRs for merge; do not bypass their outstanding review because they are ancestors.
5. Require the final aggregate merge result to pass safe targeted checks, a clean build and the complete text-flow fake-transport test. Individual pass verdicts do not authorize skipping the block verdicts elsewhere.

A full-stack tip may inherit corrected behavior from successors; an old PR's own acceptance record must still identify what was and was not true at that head.

### C9: not ready for authorization

The $2.10 live run should remain blocked **even if a separate spending approval were offered now**. EF-1 and EF-2 are deterministic pre-inference failures. EF-4 and EF-5 make the recorded configuration unreliable. EF-3 prevents trusting the helper to run freely around real sealed data.

Before requesting authorization:

- Demonstrate G1–G3 with dummy data and the actual composed entrypoint.
- Freeze the corrected release source, build, launcher, model, image, prompt, schema, scorer and consumed settings.
- Re-freeze any prepared holdout configuration after #76/#80. Do not inspect its current contents during these repairs.
- Obtain independent, separately authorized holdout review; declare the full planned denominator and a scored canary counted within it.
- Declare one allocation, concurrency, failure-stop policy, teardown, download and any extra demonstration request.
- Prove a single Spark proof HTTP attempt with an owner-approved payload; no hidden retry or additional classifier call.
- Preserve raw receipts, finish reasons, errors, incomplete cases, input identity and strict replay status. Publish the full denominator even if the result is poor.
- Verify the partner's required Open Weights attestation and budget controls.

**$2.00 Modal + $0.10 Spark remains a proposed ceiling, not a demonstrated hard billing cap.** A function timeout alone does not cap startup, resource lifetime, platform replay, or all billing. Current [Modal timeout documentation](https://modal.com/docs/guide/timeouts) distinguishes execution duration from scheduling/startup; [preemption documentation](https://modal.com/docs/guide/preemption) describes platform restarts. Obtain a supported bound for the exact deployment and include all declared resources before calling it a hard ceiling.

Fixing these gates still does not award impact points. A modest honest complete run plus three real observed user sessions is worth more than more integrations or another unverified benchmark headline.

## 5. Public office-hours questions

These are generic platform questions. Do not add the project name, problem statement, features, architecture, data type, request contents, run counts, or benchmark results when posting them. No message was sent.

Use the requested **9–10 AM America/Chicago** window. The [official event page](https://dev.meta.ai/events/global-hackathon) confirms Discord office hours during the event, but I did not find public confirmation of the exact weekday time or which staff attend each date. The day assignments below are a proposed order, not confirmed staffing appointments. Confirm the channel announcement privately before posting.

I read the linked primary documents. The questions ask about the narrow gaps left by those sources rather than fees, basic API fields, ZDR availability, eligibility, or rules already stated publicly. I cannot inspect an inaccessible participant-only FAQ or guarantee no later announcement answers them; recheck those before posting. If a source or staff answer already resolves a question, drop it rather than re-ask.

| Day / staff | Copy-paste question | Documentation already checked; remaining gap |
|---|---|---|
| **Wed Oct 28 — Meta** | “The official Glimmer structured-output recipe recommends temperature 0, while the official vLLM guide warns against greedy decoding. Which recommendation should take precedence for constrained generation, and is there a versioned compatibility note identifying the model/runtime combinations behind those recommendations?” | [Structured-output recipe](https://github.com/meta-models/meta-oss-cookbook/blob/main/muse-glimmer/recipes/structured-output/README.md), line 56, and [vLLM guide](https://github.com/meta-models/meta-oss-cookbook/blob/main/muse-glimmer/inference-server/vllm.md), line 112, were independently read and conflict. Ask for precedence/version scope, not a repeat of either instruction. |
| **Thu Oct 29 — Modal** | “The docs distinguish application retries from platform recovery after container failure or preemption. For a logical input that must not be executed twice, is there a supported at-most-once mode, or should correctness always be implemented with application-level idempotency? Which documented invocation identity remains stable across recovery?” | [Retries](https://modal.com/docs/guide/retries), [preemption](https://modal.com/docs/guide/preemption), and [function invocation](https://modal.com/docs/guide/function-invocation-methods). Basic retry settings are documented; ask about the exact execution/identity contract across platform recovery. |
| **Fri Oct 30 — Baseten** | “The streaming example shows token delivery, but not the disconnect lifecycle. Across managed serving and custom Docker deployments, does a client disconnect propagate cancellation to generation, and what terminal server-side signal distinguishes completed, cancelled, and unknown outcomes?” | [Official streaming example](https://docs.baseten.co/examples/streaming) and [custom-serving overview](https://docs.baseten.co/examples/overview). The checked streaming example contains no disconnect contract. Ask for backend-specific guarantees, not how to enable streaming. |
| **Mon Nov 2 — Fireworks** | “Which supported response or deployment metadata identifies the exact served checkpoint, tokenizer, and chat-template revision when an endpoint is updated? Is there a stable identity suitable for distinguishing a backend change from ordinary sampling variation?” | [Chat-completion API reference](https://docs.fireworks.ai/api-reference/post-chatcompletions) and [serverless overview](https://docs.fireworks.ai/serverless/overview). The inspected API page did not establish a complete immutable weights/tokenizer/template identity. Do not assume an undocumented system_fingerprint is available or sufficient. |
| **Mon Nov 2 — Modal, after the previous question if staff are available** | “The Volume docs describe background commits and explicit commits. Is there a documented transaction or recovery marker for publishing a consistent set of several files, and after successful commit acknowledgement what guarantees apply if the container is immediately preempted?” | [Volume commits/consistency](https://modal.com/docs/guide/volumes) and [preemption](https://modal.com/docs/guide/preemption). Do not ask whether commit exists; ask about multi-file publication and acknowledged durability boundaries. |
| **Tue Nov 3 — Meta** | “The Glimmer prompting guide documents separate self/user turns and reasoning-strength controls. Is there a maintained serving conformance test that verifies final-answer extraction and finish-reason behavior when a generation budget is exhausted, across the supported runtimes?” | [Glimmer prompting guide](https://dev.meta.ai/docs/muse-glimmer/prompting). Reasoning channels and strengths are already documented; the requested gap is a versioned cross-runtime test/expected terminal behavior, not a list of template arguments. |

If only one slot is available, prioritize the contradictory Glimmer guidance and the provider execution/identity question most relevant to the chosen platform. Do not disclose the project to make a generic question sound more urgent.

## 6. Complete C/D acceptance-ID audit

The final registry contains **113 C/D acceptance IDs**. The table below covers every ID without accepting the registry's verdicts as fact. The linked registry row is the identity/criterion reference, not a substitute for code evidence.

Terminology:

- **Executed equivalent:** this review ran the stated relevant behavior on isolated source/dummy evidence. It is not a claim that the repository's named test command ran.
- **Source-supported:** the implementation and inspected assertions support the criterion, but a fresh named parent/head test run is not certified.
- **Partial/open:** a concrete gap or scope limitation remains.
- **Not independently certified:** the complete execution demanded by that criterion was not performed. No PASS is inferred from CI.

PR-level evidence and exact head identities appear above. The later E fixes do not retroactively become evidence at older C/D heads.

| ID | Current review disposition | Reason / exact evidence or limitation |
|---|---|---|
| C1-1 | **Source-supported** | Original A→B preservation remains; E7 adjacent A→B→A behavior was independently probed. Renderer input/approval logic: apps/web/src/render.ts:1013. Criterion reference: [docs/release/acceptance-registry.md:60](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L60) |
| C1-2 | **Source-supported** | Preview/invalidation generation check before chained approve remains at render.ts:1003; named test not rerun. Criterion reference: [docs/release/acceptance-registry.md:61](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L61) |
| C1-3 | **Not independently certified** | Revision checks exist, but no fresh actual HTTP delayed-request matrix was run on this tip. Criterion reference: [docs/release/acceptance-registry.md:62](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L62) |
| C1-4 | **Source-supported** | Renderer preserves locally changed preview; full fresh held-invalidation browser test not rerun. Criterion reference: [docs/release/acceptance-registry.md:63](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L63) |
| C1-5 | **Source-supported** | Session pressure review uses assessment/revision checks; no fresh repeated-p1 route test. Criterion reference: [docs/release/acceptance-registry.md:64](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L64) |
| C1-6 | **Source-supported** | Assessment identity changes; fresh same-text reanalysis/late-ack test not rerun. Criterion reference: [docs/release/acceptance-registry.md:65](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L65) |
| C1-7 | **Source-supported** | Unreview method/revision gate present; fresh checkbox/clipboard test not rerun. Criterion reference: [docs/release/acceptance-registry.md:66](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L66) |
| C1-8 | **Partial** | Provider cancellation/late result must retain actual receipts; do not substitute an offline analyzer assertion for this boundary. Criterion reference: [docs/release/acceptance-registry.md:67](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L67) |
| C1-9 | **Not independently certified** | No full browser clipboard journey executed by this review; CI alone is not an exact-clipboard certificate. Criterion reference: [docs/release/acceptance-registry.md:68](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L68) |
| C2-1 | **Source-supported** | Prepared status derives from receipts; preflight/browser matrix not rerun. Criterion reference: [docs/release/acceptance-registry.md:69](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L69) |
| C2-2 | **Source-supported** | D2 adds startPoll during Analyze; no fresh held-provider page test executed here. Criterion reference: [docs/release/acceptance-registry.md:70](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L70) |
| C2-3 | **Source-supported** | Receipt-derived time retained; fresh t0/t1/t2 probe not rerun on this tip. Criterion reference: [docs/release/acceptance-registry.md:71](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L71) |
| C2-4 | **Source-supported** | Failure states remain distinct from success; fake throw/browser case not rerun. Criterion reference: [docs/release/acceptance-registry.md:72](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L72) |
| C2-5 | **Source-supported** | Generation checks and historical receipt logic remain; fresh post-edit late completion not rerun. Criterion reference: [docs/release/acceptance-registry.md:73](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L73) |
| C2-6 | **Not independently certified** | No fresh revoke-during-backoff test executed on this tip. Criterion reference: [docs/release/acceptance-registry.md:74](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L74) |
| C2-7 | **Not independently certified** | All credential/cost/prompt/token refusals require actual zero-fetch assertions; not jointly rerun here. Criterion reference: [docs/release/acceptance-registry.md:75](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L75) |
| C3-1 | **Source-supported** | Shared schema validation and exact meeting/citation checks remain; named parent/head case not re-executed. Criterion reference: [docs/release/acceptance-registry.md:76](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L76) |
| C3-2 | **Source-supported** | Shared schema validation and exact meeting/citation checks remain; named parent/head case not re-executed. Criterion reference: [docs/release/acceptance-registry.md:77](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L77) |
| C3-3 | **Source-supported** | Shared schema validation and exact meeting/citation checks remain; named parent/head case not re-executed. Criterion reference: [docs/release/acceptance-registry.md:78](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L78) |
| C3-4 | **Source-supported** | Shared schema validation and exact meeting/citation checks remain; named parent/head case not re-executed. Criterion reference: [docs/release/acceptance-registry.md:79](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L79) |
| C3-5 | **Source-supported** | Shared schema validation and exact meeting/citation checks remain; named parent/head case not re-executed. Criterion reference: [docs/release/acceptance-registry.md:80](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L80) |
| C3-6 | **Source-supported** | Shared schema validation and exact meeting/citation checks remain; named parent/head case not re-executed. Criterion reference: [docs/release/acceptance-registry.md:81](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L81) |
| C3-7 | **Not independently certified** | Composed live fake-transport case not executed in this review. Criterion reference: [docs/release/acceptance-registry.md:82](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L82) |
| C3-8 | **Not independently certified** | Test-mode outbound blocking was not re-executed across all entrypoints. Criterion reference: [docs/release/acceptance-registry.md:83](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L83) |
| C4-1 | **Source-supported** | Strict replay reconstructs raw evidence; current unchanged bundle was executed, altered-total mutation not rerun. Criterion reference: [docs/release/acceptance-registry.md:84](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L84) |
| C4-2 | **Source-supported** | Terminal-status allowlist retained; current unknown/missing-status cases not rerun. Criterion reference: [docs/release/acceptance-registry.md:85](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L85) |
| C4-3 | **Source-supported** | Receipt integrity includes finish/error metadata; full tampering matrix not rerun. Criterion reference: [docs/release/acceptance-registry.md:86](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L86) |
| C4-4 | **Source-supported** | Duplicate/unexpected raw receipt validation retained; full mutation matrix not rerun. Criterion reference: [docs/release/acceptance-registry.md:87](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L87) |
| C4-5 | **Source-supported** | Torn-tail completeness logic retained; fresh tail attack not rerun. Criterion reference: [docs/release/acceptance-registry.md:88](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L88) |
| C4-6 | **Source-supported** | Planned denominator reconstruction retained; fresh missing-record attack not rerun. Criterion reference: [docs/release/acceptance-registry.md:89](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L89) |
| C4-7 | **Not independently certified** | Exact 1/2, 5/5, 5/10 fixture was not executed anew here. Criterion reference: [docs/release/acceptance-registry.md:90](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L90) |
| C4-8 | **Partial** | New Glimmer empty-answer prompt/body inspected; reasoning-only/fenced/empty scoring matrix not executed anew. Criterion reference: [docs/release/acceptance-registry.md:91](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L91) |
| C4-9 | **Executed equivalent, partial scope** | Unchanged newly invented bundle returned complete_match; historical artifact byte/mtime invariance not broadly rechecked. Criterion reference: [docs/release/acceptance-registry.md:92](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L92) |
| C4-10 | **Source-supported** | Explicit --run-dir branch remains; CLI directory-selection matrix not rerun. Criterion reference: [docs/release/acceptance-registry.md:93](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L93) |
| C4-11 | **Partial** | E4 repairs missing-key match semantics; full API/CLI exit-code matrix not rerun. Criterion reference: [docs/release/acceptance-registry.md:94](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L94) |
| C5-1 | **Source-supported** | App uses imported image digest; no new inert construction capture across every config case. Criterion reference: [docs/release/acceptance-registry.md:95](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L95) |
| C5-2 | **Partial/open** | Builder consumes model revision, but canonical config composition is broken (EF-1); output/context limit conflated (EF-4). Criterion reference: [docs/release/acceptance-registry.md:96](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L96) |
| C5-3 | **Partial** | E8 real Git binding verified on dummy repo; whole launcher/build identity path not fully rerun. Criterion reference: [docs/release/acceptance-registry.md:97](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L97) |
| C5-4 | **Partial/open** | Dataset packaging helper remains; accepted flat config fails actual child CLI (EF-1). Criterion reference: [docs/release/acceptance-registry.md:98](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L98) |
| C5-5 | **Source-supported** | Valueless --cases rejects before imports; named regression not rerun this cycle. Criterion reference: [docs/release/acceptance-registry.md:99](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L99) |
| C5-6 | **Source-supported** | Python placeholder/review checks remain and TS validation improved; full cross-language negative matrix not rerun. Criterion reference: [docs/release/acceptance-registry.md:100](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L100) |
| C5-7 | **Source-supported** | SDK-shaped download wrapper retained; current full object/path traversal matrix not rerun. Criterion reference: [docs/release/acceptance-registry.md:101](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L101) |
| C5-8 | **Not independently certified** | Downloaded byte tree → strict replay roundtrip not executed anew. Criterion reference: [docs/release/acceptance-registry.md:102](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L102) |
| C5-9 | **Partial/open** | Readiness load is inside default work budget; accepted timeouts are not all consumed (EF-4). Criterion reference: [docs/release/acceptance-registry.md:103](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L103) |
| C5-10 | **Source-supported** | Runner pre-canary deadline check remains; fresh deadline probe not rerun. Criterion reference: [docs/release/acceptance-registry.md:104](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L104) |
| C5-11 | **Partial** | Local interruption test is not proof of Modal hard-kill Volume durability. No actual platform test authorized. Criterion reference: [docs/release/acceptance-registry.md:105](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L105) |
| C5-12 | **Open** | Documented launch path cannot complete with the current configuration/layout (EF-1/EF-2). Criterion reference: [docs/release/acceptance-registry.md:106](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L106) |
| C6-1 | **Source-supported** | Dummy helper tests and nonsealed CI are present; full import graph not executed. Criterion reference: [docs/release/acceptance-registry.md:107](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L107) |
| C6-2 | **Partial** | Canonical/child guard improved; full helper operation still violates no-copy ordering (EF-3). Criterion reference: [docs/release/acceptance-registry.md:108](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L108) |
| C6-3 | **Not independently certified** | No preseeded shared-state/repeated-suite test executed by this review. Criterion reference: [docs/release/acceptance-registry.md:109](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L109) |
| C6-4 | **Not independently certified** | Current CI green; local affected safe suite was not run twice here. Criterion reference: [docs/release/acceptance-registry.md:110](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L110) |
| C6-5 | **Not independently certified** | No broad before/after historical-artifact hash audit; synthetic replay only. Criterion reference: [docs/release/acceptance-registry.md:111](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L111) |
| C6-6 | **Not independently certified** | No whole-suite process/timer/temp-directory leak audit executed. Criterion reference: [docs/release/acceptance-registry.md:112](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L112) |
| C6-7 | **Partial** | Main CI has sparse exclusions and excluded Git scan; separate helper checkout remains unsafe (EF-3). Criterion reference: [docs/release/acceptance-registry.md:113](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L113) |
| C7-1 | **Source-supported** | Assessment availability states are distinct in session.ts. Criterion reference: [docs/release/acceptance-registry.md:114](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L114) |
| C7-2 | **Partial/open** | Thrown errors are explicit; contradictory none can still be a reviewed negative (EF-7). Criterion reference: [docs/release/acceptance-registry.md:115](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L115) |
| C7-3 | **Partial/open** | String provenance is not semantic unresolved-term validation (known F10/EF-8). Criterion reference: [docs/release/acceptance-registry.md:116](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L116) |
| C7-4 | **Source-supported** | Exact nonempty known-positive assertion exists; default-path positive not executed anew here. Criterion reference: [docs/release/acceptance-registry.md:117](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L117) |
| C7-5 | **Not independently certified** | Declared public development-case expectations were not rerun. Criterion reference: [docs/release/acceptance-registry.md:118](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L118) |
| C7-6 | **Source-supported** | Review/unreview guards remain; current full browser sequence not rerun. Criterion reference: [docs/release/acceptance-registry.md:119](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L119) |
| C7-7 | **Partial** | Bound labels are request input; not evidence of model-returned pressure classification. Criterion reference: [docs/release/acceptance-registry.md:120](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L120) |
| C7-8 | **Partial/open** | Positive label checks improved; none contradiction remains (EF-7). Criterion reference: [docs/release/acceptance-registry.md:121](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L121) |
| C8-1 | **Source-supported** | README separates raw remote Glimmer input and owner-approved Spark input. Criterion reference: [docs/release/acceptance-registry.md:122](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L122) |
| C8-2 | **Source-supported** | No-vendor-send wording is precise; no broad sends-nothing claim credited. Criterion reference: [docs/release/acceptance-registry.md:123](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L123) |
| C8-3 | **Open** | Restacked commits are paired with pre-restack CI (EF-6). Criterion reference: [docs/release/acceptance-registry.md:124](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L124) |
| C8-4 | **Partial** | Patterns/historical paths are distinguished, but term/Meta-capability limits remain (EF-8). Criterion reference: [docs/release/acceptance-registry.md:125](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L125) |
| C8-5 | **Source-supported** | Budget is proposed and allocation/work timeout are distinguished; no hard cap credited. Criterion reference: [docs/release/acceptance-registry.md:126](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L126) |
| C8-6 | **Source-supported** | Reconstructed criteria remain labeled reconstructed; no authorship/original-verbatim audit claimed. Criterion reference: [docs/release/acceptance-registry.md:127](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L127) |
| C8-7 | **Partial** | Script includes pressure review and exact copy; finished recording absent. Criterion reference: [docs/release/acceptance-registry.md:128](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L128) |
| C8-8 | **Source-supported** | Founder/user/video facts explicitly remain pending. Criterion reference: [docs/release/acceptance-registry.md:129](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L129) |
| C8-9 | **Source-supported** | Historical incomplete redaction metrics remain labeled historical; no new accuracy credit. Criterion reference: [docs/release/acceptance-registry.md:130](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L130) |
| C9-P1 | **Partial** | ID registry is complete, but acceptance is not complete; ledger evidence identity needs repair. Criterion reference: [docs/release/acceptance-registry.md:131](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L131) |
| C9-P2 | **Blocked as intended** | No sealed access or independent holdout review authorized or performed. Criterion reference: [docs/release/acceptance-registry.md:132](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L132) |
| C9-P3 | **Open** | Canonical runtime binding fails actual composition/settings checks (EF-1–EF-5). Criterion reference: [docs/release/acceptance-registry.md:133](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L133) |
| C9-P4 | **Partial** | One-attempt Spark option exists from prior cycle; actual proof entrypoint selection not demonstrated here. Criterion reference: [docs/release/acceptance-registry.md:134](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L134) |
| C9-P5 | **Open** | Declared bounds do not overcome broken eval path or platform recovery/billing uncertainty. Criterion reference: [docs/release/acceptance-registry.md:135](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L135) |
| C9-P6 | **Source-supported policy** | Extra demo requests must be declared; no request was made. Criterion reference: [docs/release/acceptance-registry.md:136](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L136) |
| C9-P7 | **Source-supported policy** | Full denominator/failure publication policy remains; new live result absent. Criterion reference: [docs/release/acceptance-registry.md:137](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L137) |
| C9-P8 | **Proposed only** | $2.10 is not independently demonstrated as a hard cap. Criterion reference: [docs/release/acceptance-registry.md:138](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L138) |
| C9-P9 | **Pending** | No partner confirmation credited. Criterion reference: [docs/release/acceptance-registry.md:139](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L139) |
| C9-P10 | **Pending** | Final video/links/release identity/submission remain human release tasks. Criterion reference: [docs/release/acceptance-registry.md:140](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L140) |
| D1-1 | **Executed equivalent, partial scope** | E1 rejects unknown input keys and unbound positive segment; full zero-fetch/receipt matrix not rerun. Criterion reference: [docs/release/acceptance-registry.md:141](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L141) |
| D1-2 | **Source-supported** | Renderer builds assessment from bound structured positive labels; actual live request not sent. Criterion reference: [docs/release/acceptance-registry.md:142](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L142) |
| D1-3 | **Not independently certified** | Fresh preflight revocation test not executed. Criterion reference: [docs/release/acceptance-registry.md:143](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L143) |
| D1-4 | **Partial/open** | Unknown positive labels reject, but none contradiction survives (EF-7). Criterion reference: [docs/release/acceptance-registry.md:144](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L144) |
| D1-5 | **Partial** | Valid explicit negative semantics need a coherent contract; no full positive/negative control matrix rerun. Criterion reference: [docs/release/acceptance-registry.md:145](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L145) |
| D2-1 | **Source-supported** | Original A→B local preservation retained; adjacent ABA case executed. Criterion reference: [docs/release/acceptance-registry.md:146](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L146) |
| D2-2 | **Executed equivalent** | Parent #72 server approved:true; final server approved:false, Copy disabled, no debounce callbacks. Criterion reference: [docs/release/acceptance-registry.md:147](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L147) |
| D2-3 | **Source-supported** | Invalidation sequence before chained approve retained. Criterion reference: [docs/release/acceptance-registry.md:148](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L148) |
| D2-4 | **Source-supported** | Active polling wired at Analyze; actual held-provider page test not executed anew. Criterion reference: [docs/release/acceptance-registry.md:149](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L149) |
| D2-5 | **Source-supported** | Poll/local intent guards present; no fresh complete stale-poll matrix executed. Criterion reference: [docs/release/acceptance-registry.md:150](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L150) |
| D2-6 | **Not independently certified** | Full paste-to-copy real browser test must run safely at final release; no new video exists. Criterion reference: [docs/release/acceptance-registry.md:151](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L151) |
| D3-1 | **Partial** | Main CI avoids known sealed paths; helper introduces independent checkout-before-exclusion problem. Criterion reference: [docs/release/acceptance-registry.md:152](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L152) |
| D3-2 | **Partial** | Concatenation/canonical child handling improved; not a general filesystem sandbox. Criterion reference: [docs/release/acceptance-registry.md:153](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L153) |
| D3-3 | **Not independently certified** | Test-owned cap mirror behavior not rerun here. Criterion reference: [docs/release/acceptance-registry.md:154](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L154) |
| D3-4 | **Partial** | Repeat-check is now wired; parent Node-22 failure not independently reproduced. Criterion reference: [docs/release/acceptance-registry.md:155](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L155) |
| D3-5 | **Source-supported** | Corrected imports/clean-build job and current-head CI exist; no fresh local full build run here. Criterion reference: [docs/release/acceptance-registry.md:156](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L156) |
| D4-1 | **Source-supported** | Import/read byte hash comparison rejects same-path drift; full stub case not rerun anew. Criterion reference: [docs/release/acceptance-registry.md:157](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L157) |
| D4-2 | **Source-supported** | Placeholder rejection present; actual cross-language full negatives not rerun. Criterion reference: [docs/release/acceptance-registry.md:158](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L158) |
| D4-3 | **Executed equivalent, partial scope** | Real dummy Git HEAD/clean-tree checks pass/refuse appropriately; not full atomic build snapshot proof. Criterion reference: [docs/release/acceptance-registry.md:159](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L159) |
| D4-4 | **Open** | Dry-run reports are not actual consumed settings; config bridge/layout broken. Criterion reference: [docs/release/acceptance-registry.md:160](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L160) |
| D4-5 | **Source-supported** | Path alias policy plus byte equality exists; no fresh alias mutation test. Criterion reference: [docs/release/acceptance-registry.md:161](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L161) |
| D4-6 | **Partial/open** | Spark maxAttempts option exists; eval prints it without constructing a Spark proof client. Criterion reference: [docs/release/acceptance-registry.md:162](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L162) |
| D5-1 | **Executed equivalent** | Dot-segment plan rejected as integrity_failure after E4; old behavior only incomplete. Criterion reference: [docs/release/acceptance-registry.md:163](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L163) |
| D5-2 | **Source-supported** | Manifest shape/path validation exists; complete malformed manifest matrix not rerun. Criterion reference: [docs/release/acceptance-registry.md:164](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L164) |
| D5-3 | **Executed equivalent, partial scope** | Empty summary becomes mismatch after E4; missing comparison semantics source-inspected. Criterion reference: [docs/release/acceptance-registry.md:165](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L165) |
| D5-4 | **Executed equivalent, partial scope** | Unchanged dummy bundle matches; full partial/torn suite not rerun. Criterion reference: [docs/release/acceptance-registry.md:166](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L166) |
| D5-5 | **Source-supported** | Current integrity checks inspected; complete mutation/no-write suite not rerun. Criterion reference: [docs/release/acceptance-registry.md:167](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L167) |
| D6-1 | **Executed document check** | Canonical registry contains 113 unique C/D IDs; no abbreviated omissions accepted. Criterion reference: [docs/release/acceptance-registry.md:168](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L168) |
| D6-2 | **Open** | Exact CI/probe evidence identity is still stale (EF-6). Criterion reference: [docs/release/acceptance-registry.md:169](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L169) |
| D6-3 | **Source-supported** | Current patterns and historical model paths are explicitly distinguished. Criterion reference: [docs/release/acceptance-registry.md:170](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L170) |
| D6-4 | **Partial** | Approval repair improved; no completed recorded proof shot supplied. Criterion reference: [docs/release/acceptance-registry.md:171](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L171) |
| D6-5 | **Source-supported** | Human observations and stories remain pending; no invented evidence credited. Criterion reference: [docs/release/acceptance-registry.md:172](https://github.com/Bridgett50/second-seat-hackathon/blob/e70277faacdf607324bcc2831e2d38d7fb31f044/docs/release/acceptance-registry.md#L172) |

### Release judgment

The review does not certify all 113 criteria or every new regression's parent failure. It identifies the exact executed behaviors, the static evidence, and the remaining limitations instead of manufacturing a universal PASS.

Keep the text-only product scope. Cut further image features, dashboards, additional classifier calls, and speculative GPU attempts. Fix the composition and evidence boundaries first, complete the scheduled real buyer observations, then make one separately authorized run whose failures you will publish honestly.

**No paid run or sealed holdout access is authorized by this report.**

END OF FILE
