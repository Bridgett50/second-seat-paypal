# Codex B1-B10 plan (verbatim from Bridgett, Oct 27 2026 12:57 AM CT; reviewed commit cd0223aeb8c4a88a2e458a5672005f154b13076b)

We are preparing the next repair cycle for Second Seat, based on the review of commit cd0223aeb8c4a88a2e458a5672005f154b13076b.

Current authorization: planning only. Do not change code, launch Modal, build cloud images, invoke models, deploy, or spend credits. Do not open, copy, hash, regenerate, or inspect sealed holdout files or their manifests. Do not run gen/make.py. Never print secrets.

First compare current unsealed code against the reviewed commit. Return the proposed PR sequence, affected files, and acceptance-test names. Implementation and live execution require separate authorization.

The target remains: Paste → redact → review/correct → approve analysis → findings with citations → edit reply → approve exact draft → copy.

## Execution order and shared rules
Prioritize B1 → B2 → B4 → B5, then B3 and B6. Documentation and the human-evidence protocol can proceed alongside implementation once authorized.
- Keep PRs independently reviewable, preferably 1–4 hours each.
- Split B2 into authorization and receipt PRs, or B5 into launch and freeze PRs, if necessary. Preserve every acceptance criterion.
- Use deterministic deferred promises, fake clocks, and transport spies. Avoid tests that depend on timing sleeps.
- Test actual adapters and runner paths, not only helper functions.
- Use newly created dummy synthetic datasets for evaluation-harness tests.
- Preserve historical evidence unchanged.
- Report implementation, offline verification, live verification, and partner verification separately.
- Do not add images, audio, conferencing integrations, dashboards, or provider comparisons.

## B1 — Make every content change invalidate one session revision
Scope: apps/web/src/session.ts, render.ts, draft state, privacy-gate revocation, browser/unit tests.
Changes:
- Share invalidation logic between raw-transcript changes and redacted-preview changes.
- Increment the client response sequence immediately, before debounce.
- Revoke the old gate authorization.
- Clear obsolete findings, payload state, draft, and approvals.
- Require current, completed analysis before creating or approving a draft.
- Allow preview correction followed by reapproval without restarting the whole session.
Exact acceptance tests:
1. Immediate raw edit: approve A, edit to B, attempt Analyze before advancing the debounce clock. External transport count remains zero.
2. Immediate preview edit: repeat with the redacted preview. Analyze and Copy become unavailable immediately.
3. Clear input: clearing either relevant input invalidates the old approval and removes obsolete findings and draft.
4. Debounce response race: pause an old draft-approval response; edit the transcript; resolve that response before debounce fires. It must not restore approval or enable Copy.
5. Pending analysis race: dispatch analysis A, edit preview to B, then resolve A. A's result cannot appear as B's result.
6. Cancellation ignored: repeat with a fake provider that ignores cancellation. Revision checks still discard the result.
7. Correction recovery: complete A, correct the preview, reapprove, analyze again, and create a new draft. Old findings must disappear before the new analysis.
8. Direct stale capability: an authorization retained from A fails after session invalidation.
9. Positive control: with no edits, the normal paste-to-copy journey still completes.
Effort: 2–4 hours.

## B2 — Validate approval at dispatch and make receipts truthful
Scope: services/bot/src/private/gate.ts, Muse/Shield/support transports, session payload records, adapter tests.
Changes:
- Retain the authorization capability through asynchronous preparation.
- Revalidate immediately before every actual HTTP attempt, including retries, with no intervening await.
- Record dispatch from the transport boundary, not from entry into the adapter.
- Distinguish "transport invoked" from "provider confirmed receipt."
- Preserve receipts for already dispatched work even when its result becomes obsolete.
Exact acceptance tests:
1. Revoked during preflight: pause cost checking or prompt preparation; revoke approval; resume. Fetch count is zero.
2. Expired during preflight: advance the fake clock beyond expiry while preparation waits. Fetch count is zero.
3. Revoked between retries: first attempt dispatches and returns a retryable failure; revoke during backoff. No second attempt occurs. Preserve the first attempt's receipt.
4. Preflight refusal: missing credentials, cost-cap refusal, prompt-read failure, and token-cap refusal each produce zero fetches and no dispatched receipt.
5. Transport failure: fetch is invoked and then throws. Record a dispatch attempt with an unknown/failed outcome—not success or "nothing sent."
6. Already dispatched: dispatch A, edit to B, then resolve A. Keep A's receipt; discard its result from B's current state.
7. Exact identity: successful receipt identifies the actual run, revision, approved-payload hash, and dispatch timestamp.
8. All clients: run the relevant tests through Muse, Shield, and support clients.
9. Forgery regression: forged objects, fixture capabilities, and mutated capabilities still produce zero live calls.
Effort: 2–4 hours; split into B2a/B2b if needed.

## B3 — Validate the complete analysis response and composed adapter path
Scope: session response validation, shared schema, live configuration, liveWiring.test.ts.
Changes:
- Validate the declared response contract before marking analysis complete.
- Verify the expected meeting identity.
- Preserve relevant flags instead of silently dropping them.
- Require valid citations for findings presented as source-backed.
- Exercise the configured Glimmer client, gate, and Muse client together using fake HTTP.
Exact acceptance tests:
1. A schema-invalid object containing entries: [] is rejected.
2. Missing required fields, invalid categories, malformed citations, and wrong meeting identity are rejected.
3. A wrong-meeting response citing an otherwise valid seg-1 is rejected.
4. Unknown segment IDs are rejected.
5. A finding presented as source-backed cannot silently have no citations.
6. A valid empty response produces the honest empty state.
7. Non-JSON or invalid live output never substitutes a fixture or heuristic result.
8. The composed fake-HTTP test sends raw input only to the fake private redactor, then requires owner approval before the fake Spark call.
9. Assert exact expected meeting content in the Spark request, including documented segment prefixes. Unexpected raw text in another field fails the test.
10. Test mode remains offline even when credentials and live settings are present.
Do not describe citation existence as proof of factual support.
Effort: 2–3 hours.

## B4 — Recompute evaluation results from immutable inputs and raw predictions
Scope: rescore-glimmer-run.mjs, evaluation runner/library, receipt parsing, run-records.test.ts.
Changes:
- Replay from saved inputs, annotations, and raw final responses—not saved aggregate scores.
- Verify recorded hashes and join records by run ID, case ID, and input hash.
- Validate terminal-record schemas and permitted statuses.
- Use the same answer parser and label normalization for original scoring and replay.
- Keep replay read-only.
Exact acceptance tests, using dummy datasets only:
1. Wrong saved total: deliberately alter an aggregate score. Replay independently reconstructs the correct result and reports the mismatch without modifying the bundle.
2. Changed input, annotation, or raw-response content with unchanged recorded hashes is rejected.
3. Wrong run ID, wrong case ID, wrong input hash, duplicate records, and unexpected records are rejected.
4. Missing planned cases prevent complete: true.
5. Unknown or missing terminal status is rejected.
6. Plain JSON and accepted fenced JSON preserve equivalent canonical/original labels and produce identical scores.
7. Reasoning-only content remains a failure.
8. Two planned five-span cases, one successful and one failed, produce 1/2 completion, 5/5 completed coverage, 5/10 full-batch coverage.
9. Empty predictions on a positive case produce zero coverage.
10. A failed canary creates explicit not_run records for every remaining case.
11. A truncated record file is readable as incomplete; it cannot become a successful complete run.
12. Valid unchanged evidence replays to the same metrics without inference.
Effort: 2–4 hours.

## B5 — Repair the launch, download, and freeze contract without touching the holdout
Scope: infra/modal/glimmer_app.py, public freeze/dry-run helpers, runbook, mocked packaging/download tests.
Current restriction: test with a new dummy dataset. Do not read, copy, hash, package, or validate the actual sealed dataset or manifest yet.
Changes:
- Make dataset selection explicit in packaging and the invoked evaluation command.
- Download the complete evidence directory without renaming files.
- Require reviewed annotations and immutable configuration for eventual launch.
- Correct deadline and billing explanations.
- Provide a working read-only replay command for a specified run directory.
Exact acceptance tests:
1. Selecting dummy dataset X packages and invokes X.
2. Substituting development dataset Y for X blocks launch.
3. Missing dataset selection fails clearly; it never silently defaults to development fixtures for an evaluation launch.
4. Mock download preserves manifest, raw responses, records, summary, report, and filenames.
5. The downloaded dummy bundle passes B4 replay and matches the original report.
6. Pending manual review, placeholder source SHA, mutable image tag, or unpinned model revision blocks launch.
7. A completed review attestation passes the review-status check.
8. Fake-clock tests confirm model load/readiness consume the work deadline.
9. Deadline exhaustion stops new requests and records remaining cases as not_run.
10. A simulated interrupted writer leaves recoverable incomplete evidence.
11. No test imports or reads an actual sealed path.
12. The documented command and tested command construction agree.
Actual holdout coverage, annotation quality, and integrity remain UNVERIFIED until separately authorized independent review.
Effort: 2–3 hours; split packaging/download from freeze validation if needed.

## B6 — Connect pressure evidence to the current session
Scope: analysis schema/prompt or existing Shield adapter, session results, pressure-review UI, focused tests.
Changes:
- Use the existing Meta capability; add no new model.
- Show a quote-linked pressure assessment and the unresolved term.
- Present it as an assessment, not certainty about someone's intent.
- Tie review state to the current meeting revision.
- Define clearly whether acknowledgement is required before the app's Copy action.
Exact acceptance tests:
1. A fixture assessment appears with a quote and citation from the current approved transcript.
2. A fabricated quote or unknown segment is rejected.
3. Public development fixtures include ordinary urgency and negotiation as well as pressure examples.
4. A neutral result displays without a pressure badge.
5. Editing the meeting invalidates pressure-review state and draft approval.
6. If acknowledgement is required, Copy remains unavailable until current findings are reviewed.
7. Zero-pressure cases remain usable.
8. Offline fixtures remain labelled offline; tests are not reported as model-accuracy evidence.
Do not develop against the sealed evaluation set.
Effort: 3–5 hours.

## B7 — Reconcile claims and document the actual startup path
Scope: README, model/failure documentation, rescue plan, submission kit.
Acceptance criteria:
1. Restore the missing A1–A3 criteria.
2. Replace "implementation complete" with an accurate acceptance-status table.
3. Offline narration does not attribute simulated output to Glimmer or Spark.
4. Pressure claims match the connected implementation.
5. Replace "cannot leave" with the precise Copy-button behavior.
6. Describe Modal hosting accurately; do not imply on-device redaction.
7. Historical Glimmer failures remain visible and unchanged.
8. Test counts link to the tested commit and CI run.
9. Spending controls are described as implemented; no unsupported hard billing guarantee.
10. Document the exact local startup command and /session route, verified with offline execution once implementation is authorized.
11. Founder story: done — supplied in the README. Observations and URLs remain pending until supplied.
Effort: 1–2 hours.

## B8 — Prepare honest buyer-evidence collection
Scope: a short evaluation protocol and evidence template.
Muse Code prepares the materials. Bridgett handles recruitment, observation, and recording; do not contact people automatically.
Acceptance criteria:
1. Use only made-up, nonsealed vendor scenarios.
2. Define the intended buyer and the purchasing/review task.
3. Compare the existing process with the assistant using equivalent tasks; rotate task order where practical.
4. Record time, factual mistakes, missed terms, confusion, and whether the participant would use it again.
5. Include negative observations and failures.
6. Separate observed facts, participant quotes, and founder interpretation.
7. Do not invent observations, quotes, savings, or willingness to pay.
8. Label a small usability sample accurately; do not claim market validation.
Effort: 1–2 hours for preparation; observations require human participation.

## B9 — Prepare—but do not launch—the bounded evidence run
Scope: execution checklist, budget/configuration record, receipt template, publication checklist.
Blocked until separately authorized: sealed-data access, model execution, Modal activity, and spending.
Readiness criteria:
1. B1–B5 pass their offline acceptance tests.
2. Independent review of the actual sealed dataset is explicitly authorized and completed.
3. The exact source, dataset identity, model revision, image digest, prompt/schema, scorer, decoding settings, and retry policy are frozen.
4. The approved command selects the correct dataset and produces a complete replayable bundle.
5. The plan permits one Modal attempt with a scored canary, bounded concurrency, declared token/request limits, and teardown.
6. The proposed Spark proof permits one actual request, no automatic retries, and exact owner approval of the redacted payload.
7. Any additional Glimmer request for the demonstration is declared; no hidden second GPU allocation.
8. Preserve failures and publish them. Do not replace a disappointing run with an undisclosed rerun.
9. Keep partner verification pending until received.
Retain the proposed $2.10 authorization ceiling: $2 Modal + $0.10 Spark, subject to checking prices and feasibility before authorization. This is a proposed spending limit, not a guarantee enforced by the current timeout.
A reproducible poor result is valid evidence. It is not proof of acceptable privacy or model quality.
Effort: 30–60 minutes of preparation. No execution now.

## B10 — Prepare the final demonstration and release freeze
Scope: video script, submission fields, release/evidence manifest.
Acceptance criteria:
1. One meeting follows the implemented paste-to-copy flow.
2. The execution-mode label stays accurate throughout.
3. Show one meaningful correction or refusal that the current implementation actually supports.
4. Show the approved payload, resolving citation, draft approval, and exact clipboard result.
5. Use only supplied founder facts and observed user evidence.
6. Every performance number links to the matching run and configuration.
7. Video is no longer than three minutes.
8. Final README, video, screenshots, CI, and results identify the same release.
9. Verify submission-link accessibility before the November 4, 3 PM CT target.
10. After release freeze, accept only execution, privacy, evidence, or submission blockers.
No recording, publishing, posting, or submission is authorized by this planning brief.
Effort: 2–3 hours after the product and evidence are ready.

## Required report for every PR
- Acceptance-test IDs passed, failed, or unverified.
- Exact tested commit and test commands.
- Remaining limitations.
- Files changed and scope exclusions.
- Whether real models, Modal, or sealed data were accessed.
During the offline repair phase, the last answer must remain no.

Do not mark the rescue complete based on merged PR count. Completion requires correct behavior under the specified races, truthful dispatch records, independent prediction replay, and a launch contract that demonstrably selects the intended dataset.
