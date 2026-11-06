# Reviewer playbook

Use this when reviewing a Second Seat stack the way Codex reviewed PRs #53–#80. It is a method, not a finding. A later head does not inherit a verdict. Re-read the files at the head you were given.

Review output is two markdown files when the operator asks for them. This playbook does not authorize commits, pull requests, model calls, or sealed reads.

## 1. Scoring math

Rubric weights, fixed:

| Category | Weight | What earns the category |
| --- | --- | --- |
| Impact | 0.30 | A verified user outcome. A larger repair stack is not impact. Do not invent market demand. |
| Meta AI Tooling | 0.25 | A real API-shape integration beyond one basic call, including a capability the product actually surfaces. An off-path experiment does not raise this. |
| Technical Depth | 0.20 | Repairs of failures that were executed. Launch-composition defects cap the score. |
| Demo | 0.25 | Something that holds up live: a finished video, a buyer observation, or a new live execution. Docs about a future video do not raise this. |

Each category is a number from 0 to 10. The published score is the weighted sum, rounded half-up to two decimal places.

Worked example, head `e70277f`, Codex review B. Do not recompute it unless you re-judge the categories. Do not average it with any other reviewer's score.

```
Impact   3.0 × 0.30 = 0.900
Tooling  6.5 × 0.25 = 1.625
Depth    7.5 × 0.20 = 1.500
Demo     7.0 × 0.25 = 1.750
sum                 = 5.775
published           = 5.78
```

Previous published score was 5.55. The delta is +0.23 against that previous Codex score only.

Category caps used for that number:

- Impact stays low until a user outcome is verified. More open fix items do not raise it.
- Tooling credits the real Chat Completions integration (json_schema, per-family cache key, Glimmer body). SAM stays experimental and does not add points.
- Depth stays below 8 while a launch config is flattened, a run directory is pre-created, a checkout materializes sealed files, or a frozen field is printed and not consumed.
- Demo stays at 7 without a finished recording, a buyer watching, or a live call. Offline replay of a fixture does not raise it.

When you change a category, show the four products and the sum. If you do not change a category, say you are not rescoring.

## 2. Evidence standards

Label every claim with one class. Do not upgrade a class because CI is green or because a test file exists.

| Class | Meaning |
| --- | --- |
| Executed equivalent | You ran the real function or the real CLI on invented input or a dummy repo. Record the exit code and the decisive sentence. This is not a claim that the named test command ran. |
| Source-supported | You read the line and the caller. You did not run it. Say so. |
| Partial / open | You saw the shape and could not finish the trace. Name the caller you did not find. |
| Not independently certified | Artifact, screenshot, evidence JSON, or a CI badge. Do not treat it as a pass. |

Rules:

- No pass is inferred from CI. A green run is metadata. Compare `head_sha` to the commit you reviewed. A URL that merely contains some SHA is not that check.
- A test title, a DRYRUN JSON file, a source-text match, or a count of `it()` / `test()` declarations is not behavior.
- One nonzero suite exit does not prove every test in the file failed.
- Guards that already pass on the parent are existing behavior. Do not relabel them as the new fix.
- A later commit that repairs a bug does not make an earlier head's "accepted" claim true. Judge each head at its own tree.
- Missing imports, syntax errors, "no tests found", setup failures, and timeouts are not the intended behavioral failure. Discard that run and write a probe that reaches the behavior.
- Mocks implement the interface the production caller actually uses. An inert Modal-shaped stub is allowed. The real Modal SDK is not.
- Deny network by replacing `fetch` or by not calling it. A review probe does not spend.
- Sleep is not a debounce and not a deadline. Drive the clock or the promise the production code reads.
- The probe observes the real boundary: the CLI the launcher invokes, the hook the tool invokes, the function the route calls. A unit that re-implements the check is not evidence.

## 3. Pass, fix, block

Judge the focused change, not the whole product, when the question is a single pull request. Judge the stack when the question is "is this head acceptable."

**Pass.** The focused change does what it claims, you inspected the implementation, and the relevant evidence supports it. State the limitation in the same paragraph. A pass is not a certificate that the suite ran.

**Fix.** A concrete acceptance or evidence gap remains. Name the file, the line, the observed or source-supported failure, and the behavior a successor must show. The change may still be worth keeping.

**Block.** An authorization boundary, a sealed-data read, or a launch path would be treated as accepted if you said pass. Do not advance it. Typical block shapes: a helper materializes a sealed path, a launcher will spend or call a model on a config that does not match the frozen contract, a workflow that is supposed to stay sealed-off is now on push. A helper bug that cannot launch by itself is a fix, even at P1, until it is wired into launch.

Write findings as `EF`/`CR` items with severity, file:line, evidence class, and the sentence you observed. Separate "I agree with the prior review" from "the prior review did not open this file."

## 4. Failing-first tests

When you ask for a repair, specify the tests in the same breath. The implementer writes the test so that it fails on the parent for the intended reason and passes on the head.

- Before-evidence is the behavioral failure: wrong exit, wrong sentence, outside file was read, second fetch happened, annotation text was printed.
- Before-evidence is not "file missing", "import error", "syntax error", "no tests found", or a timeout.
- After-evidence is the same probe on the head, with the corrected exit and sentence.
- A case that passes on both parent and head is a guard. Label it. Do not count it as the fix.
- One failing test cannot certify two regressions. Split them.
- An empty criterion list fails closed. Zero configured tests must not skip the failing-first check.
- Assertion weakening is itself a failure: fewer `it()` calls, a broader regex, a deleted expect. Count declarations only as a smell. Then read the assertion.
- Wrong failure reason does not count. If the parent fails because the fixture path is missing, the probe is invalid.
- For a git helper, build a fresh dummy repo and copy the allowlisted helper source into the probe. Do not run the helper on the product repo. The sentinel file must be absent at every intermediate point, not only at the end.
- Do not sabotage a parent path that is already correct in order to manufacture a red test.

## 5. Observed offline reproduction

Template. Fill every line. Omit the run if you cannot fill it.

```
Probe: <one sentence>
Input: <invented; no sealed bytes; no real keys>
Command or call: <real function, real CLI, or copied script>
Parent or head: <sha or "extracted file from sha">
Exit: <integer>
Decisive sentence: <one line of real output, redacted if it contains bytes you should not keep>
Not accessed: <sealed paths, network, model endpoint>
Class: Executed equivalent
```

Style that produced Codex's findings, and that this completion reused:

- Invent the input. Do not reuse a customer transcript.
- Prefer a dummy git repo, a fake HTTP response, or a temp directory over the product tree.
- Compare parent and head when the claim is "this commit fixed it."
- Record the exact exit and the exact assertion or error sentence.
- For a hook, pipe one JSON object and record the exit. Do not start Muse.
- For a config bug, pass the real child CLI `--dry-run` if that mode cannot network. If you cannot prove it is dry, do not run it.
- For a path bug, plant a sentinel outside the directory and prove the tool read it, or prove the head did not.
- Stop when the decisive sentence is in hand. Do not explore neighboring commands.

Reproductions that count as executed equivalent in the #53–#80 review:

- Parent versus head Glimmer request body.
- Eval CLI `--dry-run` on a flattened config, exit 2, missing nested fields.
- `runEval` after a pre-created `run-config.json`, refusal, zero redactor calls.
- Dummy git repo whose forbidden sentinel existed before sparse exclusion.
- Pressure `tactic=none` with an invalid segment, accepted as a reviewed negative.
- Dummy worktree / dummy HEAD binding.
- This completion: `holdout-freeze.mjs` on `/tmp` dummy dirs (path escape, dropped failures, annotation echo); `.muse/guard.sh` with a bash tool JSON (exit 0).

Not executed, and must stay labeled that way: the full suite, the Muse helper on the real repo, SAM package tests at this head, every named test against every parent, any sealed workflow.

## 6. Checks to run before you score

Do these in order. Stop a check when it would read a sealed path or spend money.

1. Stack ancestry. Record the head SHA and the immediate base of the oldest PR. "Stacked on main" is not the immediate base if the PR's parent is another PR.
2. File list. `git diff --name-only <base> <head>`. Extract every `path:line` the prior review cited. The remainder is your review. Say which of those you read and which you only listed.
3. CI identity. For each PR head, the Actions run's `head_sha` equals that head. A success badge paired with an older SHA is a defect (the #54 / run `40479067260` shape).
4. Composition across languages. If Node writes a config that Python or another Node CLI reads, run that handoff with an inert stub. Source tests that import only one side do not count.
5. Run-dir ownership. Creating the result directory before the child starts must still fail closed. Do not "fix" a reuse refusal by deleting the refusal.
6. Checkout order. Exclusion after `git worktree add` or `actions/checkout` does not undo a copy. The sentinel must be absent before the add returns.
7. Frozen-field consumption. Every field the ledger says is frozen must change a value the request or the process actually uses, or the config must be rejected. Printed JSON is not consumption.
8. Fail-closed staging. If staging the config throws, the eval must not start on defaults.
9. Ledger pairing. A table that pairs a SHA with an Actions URL must use equal `head_sha` values. Prose that says "unreviewed" must match the head you are judging.
10. Provenance of a negative. `tactic=none` must not skip segment and span checks. A substring match on approved text must not be described as the model finding pressure.
11. Command versus case. A helper that checks the process exit, a weak error regex, or a count of test declarations is not per-case evidence.
12. String tests versus behavior. A test that snapshots a source line is a guard at best. Prefer calling the function.
13. Call-site trace for any retry loop. A hardcoded attempt cap is a defect only on the callers that can reach it. Record the caller you found and the caller you did not find.
14. Path confinement for any script that joins a directory with a manifest path. `..` must fail before the read.
15. Hook scope. Tool names that are not edit verbs still need a decision. Record the exit code.
16. Comment citations. A `meta-docs/...` path that is not in the tree is a comment defect. Check behavior against the public page before you overturn a pass.
17. Secrets in output. A failure path that prints file bytes, annotations, or a provider body is a defect even when your dummy string is harmless.

## 7. Authorization the reviewer does not have

- Do not open `eval/heldout/`, `holdout-v1`, sealed manifests, `eval/truth`, presealed sha files, or any path listed in `.sealed-paths`. Reading `.sealed-paths` as a denylist is allowed. Following it is not.
- Do not run `holdout-freeze.mjs`, `holdout-dry-run.mjs`, `eval/heldout-run.mjs`, or `eval/check-hashes.mjs` against anything but an invented directory you just created. Prefer not running the sealed ones at all.
- Do not dispatch `sealed-verify.yml`. It is a full checkout on purpose.
- Do not call Meta, Modal, Baseten, Fireworks, or any other paid endpoint. A key in the environment is not permission.
- Do not print secrets, annotations, provider bodies, or token values. If a probe prints one, stop, redact the note, and cite the line instead of the bytes.
- Do not commit, branch, or open a pull request unless the operator's task says so. A review task does not.
- C9 and any live holdout remain blocked until a human authorizes spend and a human reviews the holdout. A passing offline probe does not authorize that.

## 8. What a finished review contains

- Head SHA, base SHA, file count, and the prior score if one exists.
- A list of files the prior review cited, so you do not rediscover them.
- Agreement, then disagreement, each with file:line.
- New findings in pass/fix/block form with an evidence class and, when you ran it, the probe template.
- Explicit non-claims: suite not run, sealed data not opened, score not moved unless you show the arithmetic.
- Repair additions that name scope, the defect, the required behavior, and the parent-fails / head-passes cases. Guards labeled.
- The line `END OF FILE` as the last line of each artifact.

## 9. Worked disagreement rule

If your earlier notes and the code disagree, the code at the named head wins. Example from this stack: a review of `9761e86` said the live SAM parser ignored `content_part.done`, the cache key was shared, and the inline redaction prompt was not hashed. At `e70277f` those three statements are false. Record the stale review as superseded. Do not carry its scores forward.

If the prior review and you disagree about a file neither of you ran, say "source-supported" and do not call it executed.

END OF FILE
