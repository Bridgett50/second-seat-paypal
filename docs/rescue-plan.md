# Codex A1-A9 plan (reconstructed from Bridgett's Oct 26 notes; not the original wording; A1-A3 already merged at fd3e772)

Target flow: Paste text -> redact -> review/correct preview -> approve analysis -> inspect findings and citations -> edit reply -> approve exact draft -> copy.
Keep offline execution clearly labelled. Live execution remains unverified until an explicitly authorized run produces evidence.

Working rules
- One focused PR at a time. Each PR includes its regression tests, limitations, and verification results.
- Use fake transports for development and CI. Credentials being present must never accidentally enable model calls.
- Preserve historical artifacts unchanged.
- Passing JSON validation does not prove all PII was removed.
- Approval must apply to the exact content and current session revision.
- No vendor-send functionality.
- Do not expand images, audio, meeting integrations, dashboards, or provider comparisons.
- Update existing draft PR #24 after the implemented workflow is stable.

PR A1 — Harden span masking and validation (reconstructed from merged PR #35; original plan wording not available)
Scope: redaction span handling, masking validation, PII labels.
Changes:
- Merge overlapping, nested, and duplicate spans before masking.
- maskText rejects out-of-range, empty, and non-integer spans.
- Validator rejects offsets that split a surrogate pair.
- Use the canonical date_of_birth label.
- Empty span list returns needsReview with piiFree false.
Acceptance tests:
- Overlapping, nested, and duplicate spans merge into one masked range.
- maskText rejects out-of-range, empty, and non-integer spans.
- Validator rejects surrogate-splitting offsets.
- Empty span list gives needsReview with piiFree false.

PR A2 — Gate live text through approval (reconstructed from merged PR #36; original plan wording not available)
Scope: live entry points, approval gate, GatedText.
Changes:
- Every live entry point uses requireLiveGatedText.
- GatedText is unmintable outside the gate and frozen.
- GatedText is bound to run, revision, text hash, and expiry.
- Post-approval mutation is refused.
Acceptance tests:
- Every live entry point requires requireLiveGatedText.
- GatedText minted outside the gate is rejected.
- Post-approval mutation is refused.

PR A3 — Invalidate approval on edit and guard late generation (reconstructed from merged PR #37; original plan wording not available)
Scope: session approval state, server generation guard, analysis dispatch.
Changes:
- Edits and clears invalidate approval synchronously.
- The server generation guard discards late redaction and analysis.
- Analysis dispatched before a recorded edit is marked superseded.
Acceptance tests:
- Editing or clearing the draft invalidates approval synchronously.
- The server generation guard discards late redaction and analysis.
- Analysis dispatched before a recorded edit is marked superseded.

PR A4 — Connect session findings to the editable draft
Scope: session state, rendering, draft approval, and browser tests.
Changes:
- Put findings, citations, draft editing, approval, and copying in the same session.
- Reuse the existing draft component without loading the unrelated hero fixture.
- Make the draft belong to the current meeting/result, or explicitly identify it as user-authored.
- Remove the inert transcript-file uploader.
- Keep the offline label visible throughout the offline flow.
Acceptance tests:
- One browser test starts with newly pasted text and ends with the exact edited draft in the clipboard, without switching to /briefs/demo.
- Citations resolve to the current approved transcript.
- Changing the input invalidates both analysis and draft approval.
- Editing the draft invalidates its approval.
- Rejecting prevents copying until a new approval.
- Zero-pressure and valid empty-findings cases remain usable.
- The application never sends a reply to a vendor.

PR A5 — Wire the real adapters without invoking them
Scope: server composition, Glimmer/Spark adapters, response validation.
Changes:
- Provide explicit offline and live configurations.
- Connect the live session flow to the existing model clients through the approval gate.
- Keep provider URLs and configuration server-side.
- Validate analysis output before showing completion.
- Use the gate-approved payload as the sole source of outbound meeting text.
Acceptance tests using injected fake HTTP responses:
- Live configuration selects the intended adapters; missing configuration fails clearly.
- Live failure never substitutes a fixture or heuristic answer.
- Malformed analysis produces an error, not "No findings."
- A valid empty result produces the honest empty state.
- Citation IDs must resolve against the current approved input.
- The payload panel distinguishes prepared text from an actual transport dispatch.
- Test mode remains offline even with provider credentials present.
PR description must say: "Live wiring tested with fake transports; no live model execution performed."

PR A6 — Fix scoring through the actual evaluation runner
Scope: redaction-eval.mjs, redaction-eval-lib.mjs, scorer tests and annotations.
Changes:
- Precompute expected spans/counts for every planned case before dispatch.
- Preserve misses and expected counts through serialization.
- Separate completed-case metrics from full-batch metrics.
- Fully annotate names and other supported PII before measuring over-redaction.
- Preserve the historical 39-item metric under its existing legacy name.
Acceptance tests:
- Two planned cases with five gold spans each; first succeeds completely, second fails: Completion 1/2. Completed-case coverage 5/5. End-to-end coverage 5/10.
- Run this through the runner's serialization/reporting path, not only the summarizer.
- Empty predictions on a positive case score zero coverage.
- Masking one digit of an account number does not earn full-span credit.
- Masking the entire transcript exposes substantial over-redaction.
- Correctly masking an annotated name does not count as over-redaction.
- Misses survive serialization and appear in the report.
- Zero-positive cases are reported without presenting an undefined recall as perfect performance.
Document the offset and whitespace conventions.

PR A7 — Make run records complete and replayable
Scope: evaluation runner, raw-response logging, Modal result paths.
Changes:
- Use a unique directory for each run.
- Key every response by run ID, case ID, and input hash.
- Give every planned case exactly one terminal status.
- Save durable per-case results before proceeding.
- Support rescoring saved results without inference.
Acceptance tests:
- A failed canary creates one failure plus explicit not_run records for every remaining case.
- Missing, duplicate, or unexpected case IDs prevent complete: true.
- Distinguish all cases attempted from all responses valid.
- Interrupted output remains readable and honestly incomplete.
- Repeating a run cannot append into another run's raw-response file.
- Offline rescoring reproduces the saved report exactly.
- Receipts preserve final content, original/canonical labels, finish reason, usage, latency, and errors. Reasoning is never scored as the answer.
Synthetic evaluation artifacts may contain synthetic text. Application logging must not inherit that behavior by default.

PR A8 — Freeze the holdout and prepare one bounded run
Scope: new evaluation inputs/annotations, manifest, runbook, dry-run checks.
Changes:
- Separate development cases from a small, newly authored holdout.
- Freeze inputs and annotations before any model inference on that holdout.
- Freeze source SHA, label policy, scorer, prompt/schema, model revision, image digest, decoding settings, token cap, timeouts, canary policy, and retry policy.
- Keep the existing .spawn() plus Volume architecture.
- Prepare the bounded run and cleanup procedure without launching it.
Acceptance criteria:
- The holdout includes supported dates, names, repeated entities, Unicode, and clean negatives.
- All gold annotations receive a manual review.
- A CPU-only dry run exercises successful, failed, and interrupted batches.
- The runbook records the existing 780-second work deadline and 840-second function timeout, while distinguishing these from total billed allocation time.
- The runbook specifies what gets published when the canary or remaining batch fails.
- Partner-verification status stays pending until actual verification exists.
- Paid execution requires separate authorization for the frozen configuration and budget.
A valid evaluation may produce a poor result. Acceptance depends on trustworthy measurement, not a favorable percentage.

PR A9 — Reconcile claims and rewrite draft PR #24
Scope: README, visible copy, model documentation, video script, submission fields.
Acceptance criteria:
- Describe only the connected workflow that now exists.
- Identify offline, recorded, and current live execution accurately.
- Show the incomplete historical Glimmer result alongside its limitations.
- Remove "catches everything," unsupported privacy guarantees, and instructions to hide the larger run.
- Replace stale test counts with evidence tied to the final tested commit.
- Correct timeout, model/provider identity, and spending-limit descriptions.
- Remove screenshot upload, SAM, and timed 2x replay from the core video script.
- The video follows one meeting through paste, review, analysis, correction, draft approval, and copy.
- Founder story: done — supplied in the README. User observations and video URLs remain explicitly pending until supplied. Invent nothing.

Per-PR report: 1) which acceptance criteria passed, 2) exact tests and commit tested, 3) remaining limitations, 4) whether any real model was invoked (expected: no).
Rescue is not complete until: privacy and approval regressions pass; one same-session paste-to-copy test passes in CI; fake-transport tests exercise the actual live-adapter path; partial-run scoring retains the full planned denominator; saved evaluation records can be rescored without inference; documentation matches the final implementation.
Separate statuses: implementation complete, offline verification passed, live execution verified, partner verification received.
