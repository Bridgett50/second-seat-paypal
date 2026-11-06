# AMI Meeting Corpus slice: mapping rules (DRAFT, commit before any run)
License verified Oct 26, 2026 on the official page https://groups.inf.ed.ac.uk/ami/corpus/license.shtml : "The AMI corpus and its annotations are released under the Creative Commons Attribution 4.0 license agreement (also called CC BY 4.0)."
Attribution (README/DATA.md): "Contains data from the AMI Meeting Corpus (University of Edinburgh et al.), CC BY 4.0, https://groups.inf.ed.ac.uk/ami/corpus/ . Transcripts reformatted to INPUT_FORMAT v1; no other changes." Mark any modification (Section 3(a)(1)(B)).

## Slice selection (fixed before run)
- 6–10 scenario meetings (ES/IS/TS series) that have abstractive summaries with non-empty decisions and actions. Selection rule: first N by meeting ID in the official test split that satisfy that condition; list the IDs in the commit. No cherry-picking after seeing outputs.
- TO VERIFY at download time: exact annotation file names/structure for the abstractive summary DECISIONS/ACTIONS sections (from the official AMI annotations package only).

## Conversion
- Word-level transcripts -> `[MM:SS] Speaker: text` per speaker turn (speaker = AMI speaker letter/role, e.g. "PM", "ID", "ME", "UI"). Timestamps floor to the second; turns split at >2 s pause.

## Label mapping
1. Each AMI DECISIONS sentence -> one gold `decision`. Each ACTIONS sentence -> one gold `action_item`; owner = role named in the sentence (else "unspecified"); due date = only if stated (AMI rarely has dates; due dates not scored on AMI).
2. Matching: a Second Seat entry matches a gold item if same category AND it states the same substantive content (judged by a fixed rubric: same object + same choice/task). One-to-one greedy matching; ties broken by earliest cited segment.
3. Owner scored only when gold names a role.
4. AMI has no evidence spans; support grading is NOT scored on AMI. AMI measures recall/precision of decisions and actions only.
5. Matcher: rubric applied by a scripted model call is model-vs-label; disclose it. Preferred: Bridgett/Grok Bot pre-registers the matcher prompt; all match decisions logged in JSONL.
6. Report: recall and precision per category with n and Wilson 95% CI, misses listed.
QMSum: optional, not in this draft.
