# Verification layer

Every check below has one entry point with the same shape,
`runVerification(ctx, work) -> { passed, feedback }`, and is meant to run at a
fixed point in the pipeline so the model cannot skip it. `passed` is true only
when `feedback` is empty. Each feedback line names the item and the rule that
fired, and never repeats raw PII.

**Every check fails closed.** If a check cannot read its input (malformed
JSON, a missing verdict, no residual scanner configured, a scanner that
throws), it blocks and says why. It never passes silently.

| When | File | Check | Built by | On failure |
|---|---|---|---|---|
| After the owner reviews the redaction preview, before analysis is dispatched | `packages/core/src/verification/verifyRedaction.ts` | `verifyRedaction` | Second Seat (pattern adapted from Meta legal-agent-workshop) | Blocked: the preview can already be on screen; analysis dispatch does not proceed; feedback names span index and label |
| After the brief is generated, before it is presented as source-backed | `packages/core/src/verification/verifyBrief.ts` | `verifyBrief` | Second Seat (pattern adapted from Meta legal-agent-workshop) | Blocked on structure or dangling citations; heuristic findings escalate the entry to the owner |
| After the support judge grades each entry, before an entry is marked verified | `packages/core/src/verification/verifyClaims.ts` | `verifyClaims` | Second Seat (pattern adapted from Meta legal-agent-workshop) | Blocked: partial/unsupported, missing, or unreadable verdicts (fail-closed) |

The table mirrors `VERIFICATION_POINTS` in
`packages/core/src/verification/index.ts`, and
`packages/core/test/verification-doc.test.ts` keeps the two in sync.

## What each check refuses

- **verifyRedaction** (`ctx = { rawText, spans, residualScan }`, `work = { maskedText }`).
  It blocks when:
  - no residual scanner is injected (core has no dependency on the bot, so
    callers pass the gate's `findResidualPII`);
  - a span is out of range;
  - the original text of a span still appears in the masked text;
  - the scanner reports a hit or throws.

  A pass never replaces the owner's approval: `ownerReviewRequired` is always
  `true`.
- **verifyBrief** (`ctx = { segments, frames, expectedMeetingId? }`, `work` = the brief as untrusted JSON).
  - **Blocks** on:
    - structure, checked by walking `EVIDENCE_BRIEF_JSON_SCHEMA`, which is
      read as data and not changed;
    - a meetingId for a different meeting;
    - a citation to a segment or frame that does not exist, or a citation
      with no id for its kind;
    - an uncited entry that is not flagged `missing_source`;
    - duplicate entry ids;
    - `flagged` naming an unknown entry.
  - **Escalates** the entry to the owner without blocking for:
    - the existing `validateBrief` flags (unchanged);
    - one rule that only verification applies: `ungrounded_number:N`, a
      number in the entry text that none of the entry's cited segments
      state.
  - The work under review is never mutated.
- **verifyClaims** (`ctx = { entryIds }`, `work = { verdicts: entryId -> raw judge output }`).
  - Reads the judge's raw output in the strict support shape
    `{grade, missing_qualifier}`.
  - It blocks an entry when:
    - its grade is `partial` (the feedback says a qualifier was reported
      and does not repeat the qualifier text) or `unsupported`;
    - its grade is `supported` but `missing_qualifier` is not null;
    - the entry list is empty;
    - it has no verdict;
    - its output is empty, not JSON, not an object, has a missing or extra
      key, or has a grade outside the enum.

## Run it

```bash
pnpm --filter @second-seat/bot build
node services/bot/scripts/verify-run.mjs \
  --input services/bot/fixtures/hero-input \
  --brief services/bot/fixtures/hero-brief.recorded.json \
  --redacted /path/to/approved-redacted.txt \
  --spans /path/to/spans.json \
  --meeting-id hero-input --skip-claims --out /tmp/verify
```

`--redacted` is the approved masked text and `--spans` is the JSON span
array from that same redaction. If either is missing or unreadable, the
redaction check blocks. The script does not run a fresh redactor.

The script:
- writes `verification.json`;
- exits 0 only when every check ran and passed, 1 when a check blocked or
  claims were not run, and 2 when the arguments are invalid or a path was
  refused;
- makes no model or network calls (`fetch` is replaced by a guard that
  throws);
- refuses any path containing `heldout`, `holdout` or `sealed`.

If you supply no judge output, claims are reported as `not_run` and the run
is **not verified**. `--skip-claims` records that the operator chose to skip
them, and the run is still not verified.

## Where this differs from the workshop

The workshop's claims check, `agent/verification/verify_claims.py` (at
2a8efc8, L50-54), fails open: an unreadable judgement does not block the
memo. Second Seat's `verifyClaims` does the opposite. A judge that cannot
answer cannot vouch for a claim, so an unreadable verdict is a refusal.
The tests cover this: see the "blocks malformed judge output" cases in
`packages/core/test/verification.test.ts`.

The contrast is also measured. `eval/rules/` feeds the 13 recorded support
verdicts through both checkers: well-formed, under 11 corruptions, and
missing. A fail-open reference blocks 27 of the 143 malformed outputs and
none of the 13 missing verdicts. `verifyClaims` blocks all of them. The
same suite scores `verifyBrief` against seeded mutants of the recorded
briefs. Run `pnpm --filter @second-seat/eval rules` to reproduce it; the
results are in `eval/results/rules-table.md`.

## Status and known findings

- **Wired into the session.** `apps/web/src/session.ts` calls
  `verifyRedaction` on the approved preview before anything is sent, then
  `verifyBrief` on the brief. `verifyClaims` runs only when recorded judge
  verdicts were supplied. A hard failure stops the flow and shows a fixed
  "Needs owner review" line. Heuristic warnings escalate to that same
  review and do not block. Offline and demo sessions use the same checks
  on the local brief. The owner Approve controls stay on the page.
- **The four recorded briefs** (hero, dev01-03):
  - all pass the hard rules;
  - `ungrounded_number` produces zero false alarms on them;
  - `validateBrief`'s heuristic flags are noisy: 8 of the 9 hero entries
    escalate.
- **The synthetic `fixtures/long-meeting/brief.recorded.json`** fails the
  structure check because it uses the categories `action` and `note`, which
  are not in the schema. It is a load fixture and is left unchanged.

## Attribution

The pattern is adapted from Meta's **legal-agent-workshop**
(<https://github.com/meta-models/legal-agent-workshop>, commit `2a8efc8`), the
Agents 102 session "Best Practices for Verifiable Agents". The ideas reused
are:
- one entry point per check;
- calls at fixed points;
- refuse with feedback;
- the When / File / Check / Built by / On failure table;
- a `verify RUN` helper.

The specific sources are `agent/VERIFICATION.md`, `agent/verification/*` and
`./helper verify`.

That repository publishes no license file (checked 2026-10-28; GitHub reports
no license). So **no code or prose is copied**. This is an independent
TypeScript implementation of the publicly described pattern, credited here
and in each module header.

## Demo Mode is not the offline switch

Demo Mode is presentation only. `SECOND_SEAT_TEST_MODE=1` is what forces offline, even when live credentials are present. Dedicated sealed runners exist in the repo. They are not authorized and have not been run here. That does not promise that no tracked script can ever read a sealed path.
