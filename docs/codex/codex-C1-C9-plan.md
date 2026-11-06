You are implementing the C1–C9 repair cycle for Second Seat.

Repository:
https://github.com/Bridgett50/second-seat-hackathon

Reviewed repair-stack tip:
059362d9e43186b2cf4b3207e3b3ee242549877b

The reviewed stack contains PRs #44–#52.
Acceptance background: docs/rescue-plan-b.md.
Use the attached adversarial review as the defect list, but verify each defect against current source.

GOAL

Make one trustworthy workflow work:
paste → redact → review/correct → approve analysis →
inspect cited findings → edit reply → review pressure assessment →
approve exact draft → copy exact text.

Priorities:
1. Approval and stale-request races.
2. Truthful dispatch receipts and UI.
3. Strict response validation.
4. Independent replay and correct launch configuration.
5. Honest claims and a demonstrable buyer benefit.

Do not add models, image/audio features, conferencing integrations,
dashboards, provider migration, or vendor-send functionality.

AUTHORIZED SCOPE

Implement and verify free/offline repairs using fake transports,
local execution, and newly invented synthetic fixtures.
Prepare small draft PRs. Do not merge.

This prompt does NOT authorize:
- Application-model requests or evaluations.
- Modal operations, deployments, cloud image builds, or GPU allocations.
- Baseten calls or spending credits on live inference.
- Opening, copying, hashing, regenerating, packaging, or inspecting
  sealed holdouts or their manifests.
- Running gen/make.py.
- Recruiting/contacting people, recording participants, posting,
  publishing, or submitting the entry.

Never print secrets or dump environment variables.

SEALED-DATA AND CI GATE

The existing full suite is NOT safe under these restrictions:
some tests read/copy sealed fixtures, and CI includes hash checks.

Therefore:
- Do not run the full suite initially.
- Inspect scripts, imports, package hooks and workflows before execution.
- Do not import helpers with top-level sealed-data access.
- Do not clone/archive/check out the whole repository into a new location
  if doing so would copy sealed files.
- Do not push/open a PR if that would trigger a workflow that accesses
  sealed data or invokes paid services.
- Complete the C6 isolation prerequisite first, then verify the relevant
  automated workflows are safe before pushing.
- Use unsealed source and newly created dummy datasets only.
- Actual sealed annotation quality and integrity remain UNVERIFIED.

STARTING PROCEDURE

1. Inspect the existing checkout and repair-stack ancestry without
   reading sealed files.
2. Preserve existing user changes and B-series history.
3. Identify which reported defects still exist.
4. For each defect, write its failing regression before fixing it.
5. If a defect is already fixed, verify the exact regression and report
   the responsible commit; do not duplicate the change.
6. Keep repairs in small draft PRs. Split a numbered item into C1a/C1b,
   etc., when necessary, while retaining every acceptance ID.
7. Do not mark a criterion passed because a test with its name exists.

EXECUTION ORDER

C6 isolation prerequisite first.
Then C1 → C2 → C3 → C4 → C5 → C7.
C8 documentation may follow verified implementation.
C9 is PREPARATION ONLY and remains blocked for execution.

TEST STANDARD

- Use deferred promises, held requests/responses, transport spies,
  explicit completion signals, and clocks the implementation actually reads.
- No timing sleeps, polling loops, abandoned promises, or shared test counters.
- Test delayed request delivery separately from delayed response delivery.
- Assert server state as well as browser state.
- Use faithful SDK-shaped mocks.
- Exercise default public APIs and CLIs, not only optional strict helpers.
- Assert exact payloads, identities, timestamps and clipboard text where relevant.
- Restore environment variables and clean only test-owned temporary files.
- Behavioral regressions must fail against the relevant old behavior.
  Failure merely because a new export/file is absent is insufficient.
- Existing-behavior regression guards may legitimately pass pre-change.
- Do not claim execution or mutation testing you did not perform.

C1 — VERSION EVERY APPROVAL MUTATION

Suggested split:
C1a: meeting/draft mutations and browser races.
C1b: pressure acknowledgement identity and revocation.

Scope:
apps/web/src/session.ts
apps/web/src/server.ts
apps/web/src/render.ts
focused unit and Playwright tests

Required behavior:
Approvals and acknowledgements must identify the exact state the user
reviewed. Client response sequencing alone is insufficient.
Server mutations must reject stale expected revisions/identities.
Pressure review must also identify the assessment, because reanalysis
can change findings without changing the meeting text.

Acceptance tests:

C1-1
Process draft approval for A, hold its response, edit draft to B,
blur, then release A before advancing debounce.
B remains visible; Copy remains disabled; A is not restored.

C1-2
Process correction A, hold its response, edit preview to B,
complete invalidation, then release the old correction response.
No stale approval is created. The server remains unapproved.

C1-3
Delay an old mutation REQUEST until after a newer revision exists.
Deliver it. The server rejects it without changing current text,
result, approval, draft or pressure review.

C1-4
Edit preview A→B, hold invalidation response, blur, then release it.
B remains visible and can be deliberately corrected/reapproved.

C1-5
Capture pressure acknowledgement for A’s p1.
Edit and analyze B, which also has p1.
Deliver A’s acknowledgement.
B remains unreviewed and Copy remains disabled.

C1-6
Repeat C1-5 after reanalyzing identical meeting text.
An old assessment acknowledgement cannot approve the new assessment.

C1-7
Review an item, approve the draft, then uncheck Reviewed.
Server acknowledgement is revoked and Copy disables immediately.

C1-8
Provider ignores cancellation and finishes after an edit.
Its result cannot populate current state; its actual dispatch receipt
remains historical evidence.

C1-9
Positive control: one normal paste-to-copy browser journey completes,
and the clipboard contains exactly the approved draft.

Estimate: 3–5 hours. No live run or human task required.

C2 — MAKE THE PAYLOAD PANEL USE ACTUAL RECEIPTS

Scope:
session payload/history and rendering; receipt integration tests.

Required behavior:
The receipt recorded at the HTTP boundary is the source of dispatch
identity and time. Adapter entry and completion are not dispatch.

Acceptance tests:

C2-1
Pause preflight before fetch.
There is no dispatch receipt; UI says prepared/not dispatched.

C2-2
Invoke fetch and hold its response.
The snapshot and UI say transport invoked/outcome pending.
They must not say “Prepared (not sent).”

C2-3
Set preflight=t0, fetch=t1 and completion=t2.
Receipt, payload panel and superseded history use t1 as dispatch time.

C2-4
Fetch is invoked and then throws.
An attempted dispatch remains visible with failed/unknown outcome;
no success claim and no “nothing sent” claim.

C2-5
Edit after dispatch and then complete the old request.
Preserve its receipt and identity; discard its result from current state.

C2-6
First attempt fails retryably; revoke during backoff.
Exactly one fetch and one attempt receipt remain.
No second attempt occurs.

C2-7
Credential, cost, prompt and token refusals each produce zero fetches
and zero dispatched receipts.

Estimate: 1–2 hours. Offline only.

C3 — ENFORCE THE SHARED RESPONSE CONTRACT

Scope:
analysis validator, shared-schema integration, legacy fake responses,
composed adapter tests.

Acceptance tests:

C3-1
Expected meeting is a session ID; returned meeting is "m".
Reject it. Remove production exceptions for legacy test placeholders.

C3-2
Reject every other wrong meeting ID, including when seg-1 is valid.

C3-3
Reject malformed nested citation regions:
missing required keys, extra keys and wrong value types.
Include region:{box:123,unexpected:true}.

C3-4
Validate the shared declared schema rather than a divergent handwritten
approximation. Cover required root/entry fields and nested objects.

C3-5
Reject unknown citations and silently uncited source-backed findings.
Preserve explicit missing_source flags and other relevant flags.

C3-6
A valid complete response and a valid empty response both work.
Invalid/non-JSON live output never falls back to fixtures.

C3-7
The actual configured Glimmer→gate→Muse fake-HTTP composition still
requires approval and sends exactly the expected redacted meeting
content, with no raw text hidden elsewhere in the Spark request.

C3-8
Test mode stays offline even with live settings and credentials present.

Estimate: 1–2 hours. Offline only.

C4 — MAKE STRICT REPLAY MANDATORY FOR NEW RUNS

Scope:
rescore-glimmer-run.mjs
redaction-eval-runner.mjs
receipt/scoring helpers and tests

Required behavior:
Default API and CLI reconstruct metrics from immutable inputs,
annotations and raw evidence.
Legacy processing must be explicitly separate.
Replay is read-only.

Use newly created dummy bundles only.

Acceptance tests:

C4-1
Alter saved aggregate totals to impossible values.
Default API and CLI reconstruct the correct metrics and report mismatch.
They never return the altered totals.

C4-2
Unknown or missing terminal status is rejected through both default API
and CLI.

C4-3
Changing input, annotations, final content, error metadata or finish
reason without updating the recorded integrity data is detected.
All scoring-relevant receipt data is protected.

C4-4
Duplicate, unexpected, wrong-identity and malformed raw receipts cannot
be silently overwritten, ignored or dropped.

C4-5
Append a torn line AFTER all expected valid records.
Every completion flag is false; output, summary and report agree.

C4-6
Remove a planned record.
Full planned denominators remain; the run is incomplete.

C4-7
Two planned five-span cases, one success and one failure:
completion 1/2, completed coverage 5/5, full coverage 5/10.

C4-8
Reasoning-only content fails; empty valid predictions score zero;
accepted fenced/plain JSON gives equivalent labels and scores.

C4-9
Unchanged evidence reproduces the saved metrics/report without inference.
Verify no bundle or historical file changed.

C4-10
CLI --run-dir selects exactly the requested directory.
Missing/invalid arguments never silently invoke a historical writer.

C4-11
Document and test exit/status semantics for integrity failure,
incomplete evidence and saved-report mismatch.
Exit zero must not be treated ambiguously as “complete and matching.”

Estimate: 2–4 hours. Offline, dummy data only.

C5 — VERIFY ACTUAL LAUNCH/DOWNLOAD WIRING WITHOUT MODAL

Scope:
infra/modal/glimmer_app.py
infra/modal/launch_contract.py
evaluation CLI/deadline handling
public runbook and local stub tests

Use an inert SDK-shaped stub. No real Modal activity, image building,
provider access or sealed-data access.

Acceptance tests:

C5-1
Captured image construction uses the exact configured immutable digest.

C5-2
Captured vLLM command uses the exact configured model revision.

C5-3
The source/build identity matches what is packaged.
A mismatched recorded source identity blocks launch.

C5-4
Selected dummy dataset X is packaged and invoked.
Substituting Y blocks dispatch.

C5-5
Missing or valueless --cases fails before reading fixtures or invoking
any redactor. No development-data fallback.

C5-6
Reject zero/placeholder revisions, mutable image references,
whitespace-only reviewer and invalid review date.
Use one consistent attestation contract across public helpers.

C5-7
Exercise the actual download wrapper with SDK-shaped FileEntry objects,
directory entries and nested files.
Preserve relative filenames; reject path escapes.

C5-8
The downloaded dummy evidence tree passes C4 replay and matches the
original metrics/report.

C5-9
Model load/readiness consume the work deadline.

C5-10
Advance the clock beyond deadline during input preparation.
Zero model requests occur, including no canary.
Every planned case is recorded not_run.

C5-11
Simulate interrupted local writing/process execution with explicit
signals and cleanup. Surviving evidence remains readable and incomplete.
Do not claim this proves Modal hard-kill durability.

C5-12
The documented command is exercised through the same application
wiring tested above, not merely matched with a regex or compile check.

Estimate: 3–5 hours. No actual holdout or Modal execution.

C6 — HERMETIC OFFLINE TESTS AND CI

Perform this prerequisite before broad testing or triggering CI.

Scope:
old holdout harness tests/helpers
test cost-state/log paths
historical rescore tests
package hooks and affected workflows

Acceptance tests:

C6-1
Development/CI harness tests use fresh dummy datasets.
No default test imports a helper that reads sealed inputs at module load.

C6-2
A filesystem-access guard rejects attempts to read, copy, hash or package
actual sealed paths. It must cover relevant subprocess entry points,
not just scan two source files for strings.

C6-3
Preseed old shared /tmp cost-state files at the daily cap.
Affected tests still pass using their own temporary state.
The old shared files remain unchanged.

C6-4
Run the affected safe suite twice.
Both runs pass without dependence on prior counters or file contents.

C6-5
Tracked historical evidence is byte-for-byte unchanged after testing.
If legacy behavior needs testing, use temporary copies of explicitly
unsealed historical evidence or a read-only output mode.

C6-6
All test-owned timers, promises, processes and directories are cleaned up.
No sleeps or busy polling for interruption tests.

C6-7
Inspect and verify the actual CI/package-hook execution path.
It performs no sealed-data checks or paid operations in this repair phase.
Document any separately authorized verification job instead of silently
running it as part of ordinary tests.

Estimate: 1–2 hours. Offline only.

C7 — HONEST PRESSURE STATES AND ONE CONNECTED CAPABILITY

Suggested split:
C7a: availability/error states and review UI.
C7b: existing Spark-response integration, tested only with fake HTTP.

Scope:
session pressure state, analysis contract/prompt if needed,
renderer and public development fixtures.

Acceptance tests:

C7-1
Represent not_run, failed, valid_negative and valid_positive distinctly.

C7-2
An absent live classifier is visibly “not run.”
A throwing classifier is visibly failed/unavailable.
Neither becomes an invisible negative result or reviewed success.

C7-3
A displayed unresolved term has validated provenance.
Otherwise show “term not identified.”
Do not label the entire pressure sentence an unresolved term by default.

C7-4
Run a known positive through the actual selected default path.
Assert the expected nonempty assessment, exact quote and citation.

C7-5
Run ordinary urgency, negotiation and neutral public development cases.
Assert their declared expected behavior.
Do not call these fixture checks model-accuracy evidence.

C7-6
Browser test covers review, unreview and Copy gating with current
assessment identity.

C7-7
If pressure is part of the live pitch, include its structured assessment
in the existing owner-approved Spark analysis request.
Fake HTTP proves exactly one request; no hidden second classifier call.

C7-8
Invalid pressure output or failed analysis remains explicit.
There is no silent heuristic substitution in live mode.

Estimate: 2–4 hours. No live model execution.

C8 — CLAIMS RECONCILIATION; HUMAN EVIDENCE KEPT SEPARATE

Muse Code owns the documentation PR only.

Acceptance tests/checks:

C8-1
README accurately states:
raw meeting text → private Modal/Glimmer redactor;
owner-reviewed redacted text → Spark analysis.

C8-2
Replace “Second Seat sends nothing” with the precise vendor-send claim.

C8-3
Replace blanket verification labels with criterion-level status and
exact tested commit/CI evidence.

C8-4
Describe pressure checks according to the connected implementation.
Remove unsupported competitive and intent-attribution claims.

C8-5
Describe load/readiness inside the work deadline and billed allocation
separately. Do not claim a hard dollar cap without enforcement.

C8-6
Label reconstructed A1–A3 criteria as reconstructed, not verbatim.

C8-7
Video script shows the actual pressure-review action before Copy.
It uses one meeting and accurate execution-mode labels.

C8-8
Founder story, observations, video and submission URLs remain pending
until a human supplies them. No invented quotes, savings or demand.

C8-9
Historical failures remain visible and unchanged.
Do not use fixture latency as evidence of live model performance.

Human tasks — NOT for Muse Code to perform:
- Bridgett supplies the actual founder story.
- Bridgett recruits and observes at least three intended buyers.
- Use only made-up, nonsealed scenarios.
- Record baseline and assistant outcomes, mistakes, missed terms,
  confusion, negative observations and reuse intent.
- Distinguish observations, quotes and interpretation.
- Report a concrete improvement only if observed.
- Do not describe a small usability sample as market validation.

Estimate: 1–2 hours documentation; human sessions separate.
No automated outreach or fabricated completion.

C9 — PREPARE EVIDENCE RUN AND RELEASE; EXECUTION BLOCKED

Muse Code may prepare checklists/configuration schemas and test them with
dummy values. Do not fill real sealed identities by accessing sealed data.

C9-P1
Readiness checklist requires C1–C7 acceptance, not just green CI.

C9-P2
Actual holdout review remains explicitly blocked pending separate
authorization and independent human review.

C9-P3
Eventual run configuration must bind actual source, dataset identity,
model revision, image digest, prompt/schema, scorer, decoding settings,
token limits, timeouts and retry policy.

C9-P4
Fake retryable failures prove the proposed Spark proof configuration
makes at most one actual HTTP attempt.

C9-P5
Plan allows one Modal allocation, scored canary, bounded concurrency,
declared limits, teardown and complete evidence download.

C9-P6
Any extra Glimmer demonstration request must be declared.
No hidden second allocation.

C9-P7
Publication policy preserves failures, incomplete runs and full planned
denominators. No undisclosed reruns or cherry-picking.

C9-P8
Budget remains PROPOSED:
$2 Modal + $0.10 Spark = $2.10.
Prices, resource assumptions and enforcement must be checked before
separate authorization. A timeout is not a hard billing guarantee.

C9-P9
Partner verification remains pending until actual confirmation exists.

C9-P10
Release checklist requires one release identity across README, CI,
results, screenshots and video; ≤3-minute video; accessible submission
links checked before November 4, 3 PM CT.

Blocked human/authorized execution tasks:
- Authorize and complete independent sealed-holdout review.
- Authorize the exact frozen live configuration and spending.
- Approve the exact redacted payload for the Spark request.
- Execute and inspect the one bounded live run.
- Confirm actual costs, teardown and partner verification.
- Conduct recording, publish links and submit.

Do not mark these tasks complete because their checklists exist.

REQUIRED REPORT FOR EACH DRAFT PR

1. Exact base/head commits and files changed.
2. Acceptance IDs: PASS / FAIL / NOT EXECUTED.
3. Commands actually run.
4. Failing pre-fix reproduction and passing post-fix result.
5. What the tests prove—and what they do not prove.
6. Remaining limitations and dependent PRs.
7. Whether any model, Modal, paid service, sealed data, publication or
   human outreach was used. During this phase, all must be NO.
8. Evidence that tests did not mutate tracked historical artifacts.

Do not claim “all fixed” from merged PR count or test count.
Completion means the counterexamples fail safely, receipts tell the
truth, default replay reconstructs evidence, and actual runtime wiring
consumes the configuration it claims to freeze.

END OF FILE
