# B10 demo freeze — preparation only

> **PREPARATION ONLY. No recording, publishing, posting, or submission authorized.**

This document prepares — but does not perform — the final demonstration and release
freeze. Existing product facts are drawn from [README.md](../../README.md);
existing evidence-run facts from [runbook-holdout-run.md](../runbook-holdout-run.md).

## 1) Freeze checklist (criteria 1–10)

- [ ] **Criterion 1 — One meeting follows the implemented paste-to-copy flow.**
  How to verify: run one meeting end-to-end on `/session` — paste meeting text,
  redaction masks PII for review, review and correct the redacted text, approve it,
  brief writes a short brief with citations, edit the reply draft, approve that exact
  text, copy it out manually. Confirm Second Seat never sends a reply or message to the vendor and takes no action.
  Status: pending.
- [ ] **Criterion 2 — The execution-mode label stays accurate throughout.**
  How to verify: confirm the demo shows the correct mode label at every step —
  offline (default, `SECOND_SEAT_MODE` unset; `SECOND_SEAT_TEST_MODE=1` forces
  offline), recorded (every replay labelled as a replay), or live (requires
  `SECOND_SEAT_MODE=live` + `GLIMMER_BASE_URL` + `META_API_KEY`). Live end-to-end
  passed 3/3 on Oct 28, 2026 at `0365fdb`. Rehearsals passed at `8c00c32` and on
  the November 15 fix (#116). The public link is demo mode with recorded examples.
  The Oct 28 live run is documented as a written run summary (owner-attested, synthetic data), not a screen recording. No live-run clip is planned for the video; the video shows only the scripted offline meeting room. Status: pending.
- [ ] **Criterion 3 — Show one meaningful correction or refusal that the current implementation actually supports.**
  How to verify: demonstrate exactly one supported behavior from the current build,
  e.g. editing the draft clears approval so `#btn-copy` disables until the exact
  current text is re-approved; or pressure items must each finish review before Copy
  is enabled. Persuasion Shield: experimental layer; on dev set the pattern layer caught 14/14 and Spark added no extra catches; held-out run Nov 2 will test it.
  Do not present that layer as a finished result. Copying still requires explicit approval of that exact text.
  Do not stage a capability the build does not have. Status: pending.
- [ ] **Criterion 4 — Show the approved payload, resolving citation, draft approval, and exact clipboard result.**
  How to verify: on camera, show the approved text, its resolving citation(s),
  the draft-approval action on that exact text, and the exact clipboard result
  (`#btn-copy` writes only that approved text to the clipboard).
  Status: pending.
- [ ] **Criterion 5 — Use only supplied founder facts and observed user evidence.**
  How to verify: demo narration uses only founder-supplied facts and directly observed
  user evidence. Founder story: done. User observations: PENDING. Video URLs:
  PENDING. No TARGET figures (none supplied — time-per-call / risk numbers not
  written down). Status: pending.
- [ ] **Criterion 6 — Every performance number links to the matching run and configuration.**
  How to verify: each number shown links to its matching run artifact and config
  (brief scores, hero/dev-meeting files, seeded-error suite files, load/prompt-freeze
  files, Glimmer redaction historical files with limitations stated). No headline
  score from an incomplete run. Status: pending.
- [ ] **Criterion 7 — Video is no longer than three minutes.**
  How to verify: final video file duration ≤ 3:00 measured by player/probe readout.
  Status: pending.
- [ ] **Criterion 8 — Final README, video, screenshots, CI, and results identify the same release.**
  How to verify: release/evidence manifest table below is fully filled and all rows
  point at the same release commit / CI run. Status: pending.
- [ ] **Criterion 9 — Verify submission-link accessibility before the November 4, 3 PM CT target.**
  How to verify: open every submission link in a clean session and confirm it loads;
  record the check time. Deadline: November 4, 3 PM CT. Status: pending.
- [ ] **Criterion 10 — After release freeze, accept only execution, privacy, evidence, or submission blockers.**
  How to verify: post-freeze change log shows only fixes in those four classes;
  anything else deferred. Status: pending.

Supported correction / refusal note (criterion 3 aid): the current implementation
supports, for example, editing the draft clears approval so `#btn-copy` disables
until the exact current text is re-approved, and pressure items must be reviewed
before Copy is enabled. Show one such behavior the build actually has; do not invent one.

## 2) Release / evidence manifest (blanks until freeze)

| Item | Value to record |
|---|---|
| Release commit | ____ |
| CI run URL | ____ |
| README commit | ____ |
| Video file | ____ |
| Video duration (≤ 3:00) | ____ |
| Screenshots commit | ____ |
| Results files (each with run + config links) | ____ |
| Brief-score files + links | ____ |
| Seeded-error suite files + links | ____ |
| Load / prompt-freeze files + links | ____ |

Founder story: done — supplied in the README founder section.
User observations: PENDING — not yet supplied.
Video URLs: PENDING — not yet supplied.

## 3) Deadline and post-freeze policy

- Link accessibility check deadline: **November 4, 3 PM CT**. All submission links
  must be verified loadable before then.
- Post-freeze change policy: after the release freeze, accept **only** blockers in
  these classes: execution, privacy, evidence, or submission. Everything else waits
  for a later release.
