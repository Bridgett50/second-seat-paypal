# Final repair acceptance

This ledger was written by the Cursor cloud agent. Reviewed target `005201ef83c2c94b110a643b6f89606928d3d349`. Platform for every local command below is Linux. GitHub CI is listed separately and is not treated as a local run. This run's token usage was not reported by the environment. No zero-cost claim is made.

Not recording-ready. FR1–FR3 are fixed and the offline script matches the executed synthetic flow, but the Windows citation and clipboard checks are UNVERIFIED.

## Acceptance

| ID | Type | Result | Evidence |
|---|---|---|---|
| FR1-1 | RED | PASS | Parent `005201e` dispatched once (`sent.calls` 1, expected 0). Head `9cd25bf` blocks with 0 calls. Local web test. |
| FR1-2 | RED | PASS | Same parent failure and head block, after preview invalidation. |
| FR1-3 | RED | PASS | Same parent failure and head block for restored `123456`. |
| FR1-4 | CONTROL | PASS | Direct verifier: restored address blocks, mask passes. Passed on the parent and the head. |
| FR1-5 | CONTROL | PASS | One dispatch of the masked correction. Passed on the parent and the head. |
| FR1-6 | CONTROL | PASS | A new transcript does not keep the old address. Passed on the parent and the head. |
| FR1-7 | CONTROL | PASS | A late redaction cannot restore the older spans. Passed on the parent and the head. |
| FR1-8 | CONTROL | PASS | Preview invalidation clears approval, findings, and copy. Passed on the parent and the head. |
| FR2-1 | RED | PASS | Parent payload stayed `prepared` after `provider_confirmed`. Head `481cced` is `dispatched`. |
| FR2-2 | RED | PASS | Same parent payload failure when claims block. Head keeps `dispatched` and a null result. |
| FR2-3 | CONTROL | PASS | No receipt before the callback. Passed on the parent and the head. |
| FR2-4 | CONTROL | PASS | Mid-flight `invoked` passed on the parent. The final dispatched-after-rejection check failed on the parent for the same reason as FR2-1 and passes on the head. |
| FR2-5 | CONTROL | PASS | `http_error` and `transport_failed` stay distinct. Payload is `failed`. Passed on the parent and the head. |
| FR2-6 | CONTROL | PASS | Revoke before the callback: 0 calls. Passed on the parent and the head. |
| FR2-7 | CONTROL | PASS | No second callback after revoke. The 503 receipt remains. Passed on the parent and the head. |
| FR2-8 | CONTROL | PASS | Older analysis does not replace the newer result. The first draft of this test was invalid and was corrected before the head run. |
| FR3-1 | RED | PASS | Parent status was `verified` with claims `not_run`. Head `0366842` is `structural`. |
| FR3-2 | RED | PASS | Parent title was `Verified` for an empty brief. Head is not. |
| FR3-3 | RED | PASS | Parent redaction-only status was `verified`. Head title is `Redaction check passed`. |
| FR3-4 | CONTROL | PASS | Supported verdict may still say `Verified`. Passed on the parent and the head. |
| FR3-5 | CONTROL | PASS | Hard claim failures still block and do not leak the qualifier. Passed on the parent and the head. |
| FR3-6 | RED | PASS | Parent warning omitted "Claim support not checked." Head includes it. |
| FR3-7 | RED | PASS | Offline HTTP session completed and the state API status was `verified` on the parent. Head agrees with the DOM that claims were not run. An earlier attempt that omitted `expectedRevision` is not this evidence. |
| FR4-1 | RED | PASS | Parent CRLF parse returned `[]`. Head `aa7d0af` matches the LF parse. |
| FR4-2 | CONTROL | PASS | LF lines, blanks, a malformed line, and no trailing newline. Passed on the parent. |
| FR4-3 | RED | PASS | Parent rendered no segments, so citations had no target. Head resolves them. |
| FR4-4 | RED | PASS | Parent CRLF table row gained an empty cell. Head matches the LF row, five cells. |
| FR4-5 | ENV | UNVERIFIED | Native Windows browser citation tests were not run. |
| FR5-1 | ENV | UNVERIFIED | Native Windows report CLIs were not run. |
| FR5-2 | ENV | UNVERIFIED | Native Windows Vitest workers were not run. |
| FR5-3 | CONTROL | PASS | File URL import of a path with a space and `#` returned 7 and ran once. Linux head `88b7664`. |
| FR5-4 | CONTROL | PASS | Four forbidden spellings are refused by the guard predicates. Held-out wrappers exit 2 with no dataset read. No sealed file was opened. |
| FR5-5 | CONTROL | PASS | Dev reports exit 0. A child with the guard file URL has `__sealedGuardInstalled`. |
| FR6-1 | CONTROL | PASS | Linux boundary A only, on head `401dc74`: `writeText` argument equals the approved draft, including LF. Native readback was not asserted on that head. |
| FR6-2 | ENV | UNVERIFIED | Windows native clipboard readback was not run. The LF-to-CRLF allowance was not exercised. |
| FR6-3 | CONTROL | PASS | Comparator rejects word, line, space, punctuation, and bare-CR changes. This is not a native clipboard. |
| FR6-4 | CONTROL | PASS | Zero `writeText` calls until a fresh approval. |
| FR7-1 | RED | PASS | Parent report said a mutated checker missed rows. Head `c3b9894` says analytical baseline. |
| FR7-2 | CONTROL | PASS | Pattern 14/14, spark 14/14, shield 14/14, gate 11/11, false alarms 0/16. Zero reference stays separate. |
| FR7-3 | CONTROL | PASS | `node eval/shield-report.mjs --split dev` exit 0. Held-out wrapper still exits 2. No model call. |
| FR8-1 | DOC | DOCUMENTED | "scrub all the sensitive data" replaced with supported-category masking, owner review, and no universal guarantee. The Sept. 7 vendor-quote origin story was removed (Nov 1, 2026). |
| FR8-2 | DOC | DOCUMENTED | Market paragraph is her requirement. Temperature 0 is not an identical-output proof. |
| FR8-3 | DOC | DOCUMENTED | Payload note no longer promises real-upload pre-storage masking. |
| FR8-4 | DOC | DOCUMENTED | Web default 240s, client/batch 90s, override named. |
| FR8-5 | DOC | DOCUMENTED | Four attempts total. Counter is accounted completions. Not a Modal cap. |
| FR8-6 | CONTROL | PASS | Missing live config throws. Test mode stays offline. No provider call. |
| FR8-7 | DOC | DOCUMENTED | Table says the check is after the preview and before dispatch. |
| FR8-7 | CONTROL | PASS | Preview is shown. Restored address does not dispatch. |
| FR8-8 | DOC | DOCUMENTED | "exactly one send per approval" removed. |
| FR8-8 | CONTROL | PASS | One token, two guarded callbacks, two `provider_confirmed` receipts. |
| FR8-9 | DOC | DOCUMENTED | "10/10 brief entries across three development meetings." PR count is 65 at the reviewed snapshot, not a living metric. |
| FR8-10 | DOC | DOCUMENTED | Offline full date `March 4, 2027` is still a DOB mask. November 15 without a year still stands. |
| FR8-10 | CONTROL | PASS | `MockRedactor` on that sentence. Redactor source not edited. |
| FR8-11 | DOC | DOCUMENTED | #116 and target rehearsals are owner-attested. A run summary is not a video. Video URL and tryouts stay pending. |
| FR8-12 | DOC | DOCUMENTED | Engineering-log links use `codex/cursor-D-review.md`. Video links use `../../apps/...`. |
| FR8-13 | DOC | DOCUMENTED | Reload text that tests require stays as the historical baseline. #73 is not called merged. |
| FR8-14 | DOC | DOCUMENTED | Demo Mode is presentation only. Sealed runners are not authorized and were not run. |
| FR8-15 | DOC | DOCUMENTED | Three test titles renamed. Assertions not loosened. |
| FR9-1 | CONTROL | PASS | Linux Chromium, `e2e/fr9-synthetic.spec.ts`. Offline label and Demo Mode. Phone and names masked. Email remains. |
| FR9-2 | CONTROL | PASS | Same spec. Email and phone are absent from analyzer calls before the correction. |
| FR9-3 | CONTROL | PASS | Same spec. One analyzer call with the corrected text. Two entries. Zero pressure items. Claims `not_run`. Heading is "Needs owner review" because a line escalates. |
| FR9-4 | CONTROL | PASS | Same spec. Each citation href matches one element. |
| FR9-5 | CONTROL | PASS | Same spec, boundary A: `writeText` equals the approved draft once. Boundary B was not asserted on head `5d4c13e`. |
| FR9-6 | CONTROL | PASS | Same spec. Editing the draft disables Copy. |
| FR9-7 | DOC | DOCUMENTED | Scripts no longer tell the offline take to show "last chance" or to mask a phone that is already masked. |
| FR9-8 | DOC | DOCUMENTED | Proof note `docs/release/fr9-offline-rehearsal.md`. No required `[seg-2]`. Take remains within 3:00. No video URL invented. |
| FR10-1 | CONTROL | PASS | This table. |
| FR10-2 | CONTROL | PASS | Local commands listed under each PR. GitHub `ci / build-and-test` succeeded for #120, #122, #121, #123, and #124. Later PRs were still running when this ledger was written. |
| FR10-3 | CONTROL | PASS | `git diff --name-only 005201e HEAD` has no `config/live`, `redact.ts`, `muse.ts`, `glimmer_app.py`, prompt, schema, or redaction-eval scorer path. |
| FR10-4 | CONTROL | PASS | Public pin file `config/live/glimmer-launch-config.json` still has prompt `287f1971…d1b5`, schema `fa3842b7…08ac`, scorer `ba0a0756…6481`. That file is not in the repair diff. Hashes were not recomputed from source in this step, and no sealed checksum was run. |
| FR10-5 | CONTROL | PASS | Dev shield report on the FR7 head, analytical baseline labeled. No secret values printed. |
| FR10-6 | ENV | UNVERIFIED | Final browser run on Bridgett's Windows machine was not executed. Both clipboard boundaries are UNVERIFIED there. |
| FR10-7 | DOC | DOCUMENTED | Disposition table below. |

## Clipboard boundaries

Executed on Linux Chromium after the ledger's first draft, in `e2e/fr6-clipboard.spec.ts` and `e2e/fr9-synthetic.spec.ts`. Both commands exited 0 (3 tests).

| Boundary | Linux | Windows |
|---|---|---|
| A. Argument passed to `navigator.clipboard.writeText` | PASS. Byte-exact match to the approved draft, including LF. FR6 draft `First synthetic line.\nSecond synthetic line.`. FR9 draft `Please send a corrected written quote. I have not accepted the deadline.` | UNVERIFIED. The spy was not run on Windows. |
| B. Native OS clipboard readback | PASS on this Linux Chromium. `readText()` equaled the approved draft, including LF. No newline conversion occurred. | UNVERIFIED. The only allowed difference, LF to CRLF, was not observed because the native Windows clipboard was not read. |

## RED assertion messages

A failure counts only when the named assertion ran on the parent and failed. These are those messages.

- FR1-1, FR1-2, FR1-3: `expect(sent.calls).toBe(0)` received `1`.
- FR2-1, FR2-2: `expect(after.payload?.status).toBe("dispatched")` received `"prepared"`.
- FR3-1: `expect(view.status).not.toBe("verified")` received `"verified"`.
- FR3-2: `expect(view.title).not.toBe("Verified")` received `"Verified"`.
- FR3-3: `expect(view.status).not.toBe("verified")` received `"verified"`.
- FR3-6: warning message did not contain `"Claim support not checked."`.
- FR3-7: `expect(state.verification.status).not.toBe("verified")` received `"verified"`, with state `completed`. An earlier run that stopped at `expectedRevision` never reached this assertion and is not RED evidence.
- FR4-1: `expect(parsed).toEqual(ids(LF))` received `[]`.
- FR4-3: `expect(segments.length).toBeGreaterThan(0)` received `0`.
- FR4-4: `expect(fromLf).toEqual(fromCrlf)` failed because the CRLF row ended with an extra `""`.
- FR7-1: `expect(result.report).toMatch(/analytical baseline \(all layers off\)/)` failed. The received report said a mutated checker missed seeded rows.

## R1–R16

| Finding | Disposition |
|---|---|
| R1 span evidence cleared | Fixed in #120. End-to-end coverage in #125. |
| R2 Windows parsing, import, and clipboard | Parsing fixed in #123. Import URLs fixed in #124. Clipboard contract tested on Linux in #127. Windows execution UNVERIFIED. |
| R3 false prepared status | Fixed in #122. |
| R4 unqualified Verified | Fixed in #121. Wording follows in #126. |
| R5 universal privacy and competitor claims | Documented in #126. Founder story kept. |
| R6 deterministic-output guarantee | Documented in #126. |
| R7 transcript and script mismatch | Script matched to the executed offline flow in #125. |
| R8 real-upload promise | Documented in #126. |
| R9 hard-coded mutation result | Relabeled in #128 as an analytical baseline (all layers off). `eval/shield-report.mjs` still hard-codes `mutantCaught = 0`. That is not a measured fix. The rules 0/13 gap was not edited. |
| R10 timeout, retry, accounting, startup prose | Documented in #126. Frozen runtime unchanged. |
| R11 verification timing | Documented in #126, with a session control. |
| R12 chronology, reload, video status | Documented in #126 and #125. Owner-attested, not independently verified. |
| R13 broken relative links | Documented in #126. |
| R14 denominator and PR count | Documented in #126. 10/10 entries across three meetings. 65 at the reviewed snapshot. |
| R15 offline full-date overmask | Documented limitation in #126. `redact.ts` not edited. |
| R16 one send per approval | Documented in #126. Token is not consumed. |
| Unauthenticated Modal endpoint | Still disclosed. No engine change authorized. |
| Residual-PII evasions and semantic 0/13 gap | Still disclosed. No engine change authorized. |
| Sealed-runner exception | Runners exist, were not run, and are not authorized. |

## Blocked

1. A new live or paid rehearsal, Modal or Baseten deploy, warmup, or GPU job.
2. A sealed holdout run, including reading `eval/heldout/`, `services/bot/fixtures/holdout-v1/`, or the sealed checksum files.
3. Any edit to frozen prompts, schemas, `config/live/**` including its README, `redact.ts`, `muse.ts`, `glimmer_app.py`, or the redaction scorer inputs.
4. Endpoint authentication that would require a frozen engine change.
5. Recording the founder clip, filling user observations, or posting the X draft.
6. Declaring the Windows recording machine ready before its citation and clipboard checks pass.

## Windows handoff

On the machine Bridgett will record from, check out `cursor/fr9-synthetic-rehearsal-ec4c` at `5d4c13ee372a9b0d144ce6fdadb2a61c66affae3` or a descendant that contains these commits. Then:

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @second-seat/core build`
3. `pnpm --filter @second-seat/web exec playwright install chromium`
4. `pnpm --filter @second-seat/web exec playwright test e2e/hero.spec.ts e2e/g6-rehearsal.spec.ts e2e/fr6-clipboard.spec.ts e2e/fr9-synthetic.spec.ts`
5. Record the two clipboard boundaries separately. Boundary A is the string passed to `writeText`. Boundary B is the native Windows readback. The only allowed difference on B is LF becoming CRLF. Any boundary that does not run stays UNVERIFIED. A killed runner is not a pass.
5. `node eval/shield-report.mjs --split dev` and `node eval/resistance-table.mjs --split dev` with no compatibility loader.
6. Record pass and fail counts and the process exit code. A killed runner is not a pass. Do not call Linux results a Windows pass.
