# C9 evidence run and release — preparation only

> **Preparation only. No sealed-data access, model execution, Modal activity, or spending is authorized by this document. Every box below is unchecked.**

This checklist prepares — but does not launch — the C9 evidence run and release.
Identities below are roles and field names only; no sealed values are recorded here.

## 1) Readiness checklist (C1–C7 acceptance by criterion id)

- [ ] Readiness requires C1–C7 acceptance by criterion id, not just green CI. Green CI alone is not sufficient. The canonical ID set lives in [acceptance-registry.md](acceptance-registry.md) (113 IDs); this section must contain exactly that set.
- [ ] C1 acceptance (draft PR #54, tested head `077c7d35d1fa7fd8a967f179187e137fb45831b5`, probes `apps/web/e2e/c1-races.spec.ts` + `apps/web/test/c1-revisions.test.ts`): C1-1, C1-2, C1-3, C1-4, C1-5, C1-6, C1-7, C1-8, C1-9. Outcome: C1-1..C1-8 pass at store/browser boundary; C1-9 pending (D2-6). Limitation: HTTP regressions inspected not run; repo clock not explicitly paused; a reload after an A->B->A edit during a held approval can still show Copy enabled (F4 partly open).
- [ ] C2 acceptance (draft PR #55, tested head `b63c1cf28a6973cfea1ef6cd827164553aa36e5d`, probe `apps/web/test/c2-receipts.test.ts`): C2-1, C2-2, C2-3, C2-4, C2-5, C2-6, C2-7. Outcome: C2-1..C2-6 pass at snapshot level (C2-2 partial, F3); C2-7 pending. Limitation: active pending page still stale (F3); refusal matrix not executed at this head.
- [ ] C3 acceptance (draft PR #56, tested head `de50552b66c25f5c920dff50b2d5252782ec2c39`, probe `apps/web/test/c3-contract.test.ts`): C3-1, C3-2, C3-3, C3-4, C3-5, C3-6, C3-7, C3-8. Outcome: C3-1..C3-6 pass; C3-7/C3-8 pending. Limitation: old build failure fixed at de50552 (F6 closed).
- [ ] C4 acceptance (draft PR #57, tested head `1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a`, probe `services/bot/test/c4-replay.test.ts`, dummy bundles): C4-1, C4-2, C4-3, C4-4, C4-5, C4-6, C4-7, C4-8, C4-9, C4-10, C4-11. Outcome: C4-1..C4-6 + C4-10 pass; C4-7/C4-8/C4-9/C4-11 pending (D5). Limitation: manifest-plan duplicates and comparison states open (F8).
- [ ] C5 acceptance (draft PR #58, tested head `9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8`, probe `services/bot/test/c5-wiring.test.ts`, inert stub): C5-1, C5-2, C5-3, C5-4, C5-5, C5-6, C5-7, C5-8, C5-9, C5-10, C5-11, C5-12. Outcome: pass except C5-3/C5-6 partial. Limitation: same-path drift (F2); all-zero identities on new TS path (F7); stub only.
- [ ] C6 acceptance (draft PR #53, tested head `7af1d4b077a68d4063546fc94553bb73aa271397`, probe `services/bot/test/c6-hermetic.test.ts`): C6-1, C6-2, C6-3, C6-4, C6-5, C6-6, C6-7. Outcome: C6-1 pass; C6-2/C6-3/C6-5/C6-6 partial (static); C6-4/C6-7 pending (D3). Limitation: lexical guard only; CI boundary outside guard (F9).
- [ ] C7 acceptance (draft PR #59, tested head `7442f77538494fd35e0778d104e19aca694fc5d5`, probe `apps/web/test/c7-pressure.test.ts`): C7-1, C7-2, C7-3, C7-4, C7-5, C7-6, C7-7, C7-8. Outcome: C7-1/C7-4/C7-5/C7-6 pass; C7-2/C7-3/C7-7/C7-8 partial. Limitation: invalid-label shapes closed at restacked head (F5 closed); provenance strings only (F10); request-side proof only.
- [ ] C8 acceptance (docs PR, tested head `d1cd7e1e6814933ead71cbd9750b5cb9a2714f28`, probe `apps/web/test/c8-docs.test.ts`): C8-1, C8-2, C8-3, C8-4, C8-5, C8-6, C8-7, C8-8, C8-9. Outcome: prose checks pass (C8-3/C8-4/C8-7 partial until D6). Limitation: prose matching, not behavioral proof.
- [ ] C9 preparation (tested head `dd7c8c69244872f04515d1a20b07a2625b6dcddb`, probe `apps/web/test/c9-prep.test.ts`, dummy values): C9-P1, C9-P2, C9-P3, C9-P4, C9-P5, C9-P6, C9-P7, C9-P8, C9-P9, C9-P10. Outcome: checklists + schema pass; execution blocked. Limitation: validation is not runtime binding (F7).
- [ ] D-series acceptance (review verdicts per [docs/codex/cursor-D-review.md](../codex/cursor-D-review.md), not a blanket pass): D1-1 partly, D1-2 closed, D1-3 closed, D1-4 closed, D1-5 closed (head `a23b46295c302113a294713adace48d10f97030a`, fake transports); D2-1 closed, D2-2 partly, D2-3 closed, D2-4 closed, D2-5 closed, D2-6 partly (head `9d5dd7fc700c2e76c2f1375bc10dd593b4cb07b1`, probe `apps/web/e2e/d2-approval.spec.ts`, fake transport); D3-1 closed, D3-2 partly, D3-3 partly, D3-4 open, D3-5 partly (head `7af1d4b077a68d4063546fc94553bb73aa271397`, fake repo); D4-1 closed, D4-2 partly, D4-3 partly, D4-4 open, D4-5 closed, D4-6 partly (head `b1ba5dbd50689fe6aec5716fd509cbc5b3426dfe`, inert stub); D5-1 partly, D5-2 closed, D5-3 partly, D5-4 partly, D5-5 partly (head `6b37061ee2d1726077961e1ac077de20e954a02c`, dummy bundles); D6-1 closed, D6-2 open, D6-3 closed, D6-4 open, D6-5 closed (head `1d19da07260166909d4f7d21ee82f9576923fb64`, this docs change, file checks only).
- [ ] Per-row ledger (head, test/probe, outcome, limitation for every ID above): [acceptance-registry.md](acceptance-registry.md). No row passes on CI alone.
- [ ] Current limitations per [docs/codex/cursor-D-review.md](../codex/cursor-D-review.md): F4 partly open (a reload after an A->B->A edit during a held approval can still show Copy enabled; a fix is in draft PR E7 (#73, unmerged, unreviewed) pending review/merge: editing while a draft is approved or an approval is in flight revokes server approval immediately, so a reload after an A->B->A edit keeps Copy disabled, tested fail-before/pass-after by apps/web/e2e/e3-reload.spec.ts; F4 remains partly open on the reviewed baseline until review and merge); F5 closed; F6 closed (old build failure fixed at de50552).
- [ ] E-series fixes (draft, unmerged): draft PRs with fail-before/pass-after tests E1 (D1-1/F1), E2 (D4-4/D4-6/F7), E3 (F4 reload) fixed in draft E7 (#73, unmerged, unreviewed) pending review/merge (tested fail-before/pass-after by apps/web/e2e/e3-reload.spec.ts), E4 (D5-1/D5-2/D5-3/F8), E5 (D3-2/D3-4/F9), E8 (D4-3) in draft PR (#74, unmerged, unreviewed) pending review/merge binding launch to git HEAD == source_sha with a clean working tree with changes outside the packaged hash refusing with zero spawns (tested by services/bot/test/e8-gitsha.test.ts). On the reviewed baseline F4 remains partly open and D4-3 remains partly open until review and merge. See [docs/codex/cursor-D-review.md](../codex/cursor-D-review.md). Further drafts (unmerged, unreviewed): E10 (#76, audit F1) Glimmer redaction temperature 0.0 with no top_p/top_k and the empty-answer prompt aligned with the validator; E11 (#77, audit F2) live SSE events fed to the official SAM parser with include_confidence, so response.content_part.done (what the live API emits) parses with output_text.delta still accepted, default fixture box 60x27 to match its 27x60 mask (x2/y2 inclusive), while services/bot/scripts/hero-chain.mjs still has its own local parser and no include_confidence (open); E12 (#78, audit F3) one stable prompt_cache_key per call family ("second-seat-brief", "second-seat-shield", "second-seat-support") instead of one shared key, recorded brief 0 of 2271 input tokens cached, no cache hit measured (no live call made); E13 (#79, audit F4) root AGENTS.md as a minimal pointer to .agents/AGENTS.md with no non-public citations, guardrails in Muse-Code-protected paths; E14 (#80) prompt-freeze also hashes the inline redaction system prompt.

## CI reconciliation (observed 2026-10-27T23:17:29Z)

Observed CI runs from docs/release/ci-observed.json (recorded by the maintainer with a readonly GitHub API read; no rerun). Every C1–C7 row in README.md pairs a tested commit with a CI run whose head_sha is a different commit, and three of those runs concluded failure — so those CI links are historical context, not proof for the tested commits. Only the B6 pairing below is current.

| run id | observed head_sha (40-hex) | conclusion | source URL | paired tested sha | status |
|---|---|---|---|---|---|
| 40464552140 | 2477d2ec82202b535a8bef13fbdaa97e05a647ba | success | https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40464552140 | 2477d2ec82202b535a8bef13fbdaa97e05a647ba | current |
| 40477442184 | 7efcae01fa594a564165a69a2d065f86d9c15d03 | success | https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40477442184 | 7af1d4b077a68d4063546fc94553bb73aa271397 | historical (historical CI: run head 7efcae0, success; not the tested commit) |
| 40479067260 | 8d1ca970b1993b34112f1276b9915eb2219b0b7a | success | https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40479067260 | 077c7d35d1fa7fd8a967f179187e137fb45831b5 | historical (historical CI: run head 8d1ca97, success; not the tested commit) |
| 40479898486 | 2617b7978363963e5126d8e4ca643f176cecfd5f | success | https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40479898486 | b63c1cf28a6973cfea1ef6cd827164553aa36e5d | historical (historical CI: run head 2617b79, success; not the tested commit) |
| 40480594570 | fb4c216d60b08aef4308a05f25250b5f8adfa925 | failure | https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40480594570 | de50552b66c25f5c920dff50b2d5252782ec2c39 | historical (historical CI: run head fb4c216, failure; not the tested commit) |
| 40484194423 | b383e12615b5df48866c7f276d1095d7f116850c | failure | https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40484194423 | 1f4b74f1ece34fcaeb4a8fdee7696f6a4095040a | historical (historical CI: run head b383e12, failure; not the tested commit) |
| 40484954956 | 789ab3c3475145404484f39c428883dcc78557b7 | failure | https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40484954956 | 9a3dd34e41f6d7654c9ff5b93eae175ff31a54d8 | historical (historical CI: run head 789ab3c, failure; not the tested commit) |
| 40486174227 | 1153dd8f6aae575a8f46788b9bf3432d28e43817 | success | https://github.com/Bridgett50/second-seat-hackathon/actions/runs/40486174227 | 7442f77538494fd35e0778d104e19aca694fc5d5 | historical (historical CI: run head 1153dd8, success; not the tested commit) |

### G acceptance ledger (draft PR heads #81–#90)

A before/after probe recorded at one SHA is historical evidence only and is not current proof at another SHA. Rows below marked with a guard classification passed on their parent and guard existing behavior; rows marked bug regression failed on the parent for an assertion reason and pass at the tested head. Never pass from CI alone. C9 stays BLOCKED, the budget stays proposed, and Founder story: done. Buyer tryouts, partner verification, video, and submission URLs stay pending.

| ID | Tested head | Behavioral test / probe | Outcome | Classification | Limitation |
|---|---|---|---|---|---|
| G1-1 | e681551a20b3ac9f7a5b12e3170c359474603e37 | scripts/tests/muse-helper.test.sh G1-1 (verifier no-checkout base worktree) + .muse/verify_pr.sh | pass (guard, passes on parent and head) | existing guard | dummy repos only; no paid inference |
| G1-2 | e681551a20b3ac9f7a5b12e3170c359474603e37 | scripts/tests/muse-helper.test.sh G1-2 (sparse policy verified before materializing) + .muse/verify_pr.sh | pass (guard, passes on parent and head) | existing guard | dummy repos only; no paid inference |
| G1-3 | e681551a20b3ac9f7a5b12e3170c359474603e37 | scripts/tests/muse-helper.test.sh G1-3 (missing/invalid path policy refused) + .muse/verify_pr.sh | pass (guard, passes on parent and head) | existing guard | dummy repos only; no paid inference |
| G1-4 | e681551a20b3ac9f7a5b12e3170c359474603e37 | scripts/tests/muse-helper.test.sh G1-4 (prepare/base ordered after sparse success) + .muse/verify_pr.sh | pass (guard, passes on parent and head) | existing guard | dummy repos only; no paid inference |
| G1-5 | e681551a20b3ac9f7a5b12e3170c359474603e37 | scripts/tests/muse-helper.test.sh G1-5 per-case failing-first evidence (evidence/G1b/before.txt, evidence/G1b/after.txt) + .muse/verify_pr.sh | pass (before/after probe, base_reason assertion) | bug regression | uncertified-disclosed: removed-line check is textual, not semantic (evidence/G1b/NOTES.md) |
| G1-6 | e681551a20b3ac9f7a5b12e3170c359474603e37 | scripts/tests/muse-helper.test.sh G1-6 per-case failing-first evidence + .muse/verify_pr.sh | pass (before/after probe, base_reason assertion) | bug regression | uncertified-disclosed: removed-line check is textual, not semantic (evidence/G1b/NOTES.md) |
| G1-7 | e681551a20b3ac9f7a5b12e3170c359474603e37 | scripts/tests/muse-helper.test.sh G1-7 wrong before-failure reason rejected (invalid_before) + .muse/verify_pr.sh | pass (before/after probe, base_reason assertion) | bug regression | uncertified-disclosed: H8 fixture meaning changed by design (evidence/G1b/NOTES.md) |
| G1-8 | e681551a20b3ac9f7a5b12e3170c359474603e37 | scripts/tests/muse-helper.test.sh G1-8 per-case failing-first evidence + .muse/verify_pr.sh | pass (before/after probe, base_reason assertion) | bug regression | uncertified-disclosed: removed-line check is textual, not semantic (evidence/G1b/NOTES.md) |
| G1-9 | e681551a20b3ac9f7a5b12e3170c359474603e37 | scripts/tests/muse-helper.test.sh G1-9 per-case failing-first evidence + .muse/verify_pr.sh | pass (before/after probe, base_reason assertion) | bug regression | uncertified-disclosed: removed-line check is textual, not semantic (evidence/G1b/NOTES.md) |
| G2-1 | d34ecd43aeeb9bf1e006ecea677b44f35f857652 | services/bot/test/g2-composition.test.ts G2-1 flat-nested-mismatch (evidence/G2a/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | fake local HTTP server and temp bot tree only |
| G2-2 | d34ecd43aeeb9bf1e006ecea677b44f35f857652 | services/bot/test/g2-composition.test.ts G2-2 no-projection-binding (evidence/G2a/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | fake local HTTP server and temp bot tree only |
| G2-3 | d34ecd43aeeb9bf1e006ecea677b44f35f857652 | services/bot/test/g2-composition.test.ts G2-3 drift binding (passes on parent and head) | pass (guard, passes on parent and head) | existing guard | fake local HTTP server and temp bot tree only |
| G2-4 | d34ecd43aeeb9bf1e006ecea677b44f35f857652 | services/bot/test/g2-composition.test.ts G2-4 legacy-downgrade refused (evidence/G2a/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | parent failure surfaced as a signature TypeError, a weaker reason than a behavioral downgrade (disclosed, evidence/G2a/NOTES.md) |
| G2-5 | 97c80bfefd0ac46c67ea2ff1cd8bc8cc2799073c | services/bot/test/g2b-ownership.test.ts G2-5 staging-reuse-refusal (evidence/G2b/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | fake 127.0.0.1 server, inert modal stub, temp dirs only |
| G2-6 | 97c80bfefd0ac46c67ea2ff1cd8bc8cc2799073c | services/bot/test/g2b-ownership.test.ts G2-6 evidence-modified on reuse (evidence/G2b/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | fake 127.0.0.1 server, inert modal stub, temp dirs only |
| G2-7 | 97c80bfefd0ac46c67ea2ff1cd8bc8cc2799073c | services/bot/test/g2b-ownership.test.ts G2-7 no-failure-evidence (evidence/G2b/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | fake 127.0.0.1 server, inert modal stub, temp dirs only |
| G2-8 | 97c80bfefd0ac46c67ea2ff1cd8bc8cc2799073c | services/bot/test/g2b-ownership.test.ts G2-8 silent-entry-drop (evidence/G2b/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | fake 127.0.0.1 server, inert modal stub, temp dirs only; companion guard G2-8g passes on both |
| G3-1 | d6d813813ec1c7c9d661bec1e42e2195987b8c3a | services/bot/test/g3a-runtime.test.ts G3-1 timeout-not-applied (evidence/G3a1/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | fake fetch and fake timers only; no inference, no Modal |
| G3-2 | d6d813813ec1c7c9d661bec1e42e2195987b8c3a | services/bot/test/g3a-runtime.test.ts G3-2 deadline-ignored (evidence/G3a1/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | fake fetch and fake timers only; no inference, no Modal |
| G3-3 | d6d813813ec1c7c9d661bec1e42e2195987b8c3a | services/bot/test/g3a-runtime.test.ts G3-3 invalid-concurrency-accepted (evidence/G3a1/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | fake fetch and fake timers only; no inference, no Modal |
| G3-4 | e6cfa4640b3b5c121c090093877013d61251b193 | services/bot/test/g3a-limits.test.ts G3-4 output-as-context (evidence/G3a2/NOTES.md) | pass (before/after probe, base_reason assertion) | bug regression | local input bound is a UTF-8 byte upper bound, not the vLLM tokenizer; no live inference |
| G3-5 | e6cfa4640b3b5c121c090093877013d61251b193 | services/bot/test/g3a-limits.test.ts G3-5 decoding-constant (evidence/G3a2/NOTES.md) | pass (before/after probe, base_reason assertion) | bug regression | server-side --max-model-len remains the enforcing limit; no live inference |
| G3-6 | c441fc71c2a64670f52e3c0d2b7757b41f87016c | services/bot/test/g3a-identity.test.ts G3-6 function-settings-ignored (evidence/G3a3/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | identity check proves config matches current source, not a remote Modal image; no Modal operation |
| G3-7 | c441fc71c2a64670f52e3c0d2b7757b41f87016c | services/bot/test/g3a-identity.test.ts G3-7 identity-unchecked (evidence/G3a3/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | identity check proves config matches current source, not a remote Modal image; no Modal operation |
| G3-8 | 5deffc1d4a7c7f1b1ad42012dac7a93b787c03b0 | services/bot/test/g3b-staging.test.ts G3-8 no-staging-evidence (evidence/G3b/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | module under fakes; no Modal, no vLLM, no inference |
| G3-9 | 5deffc1d4a7c7f1b1ad42012dac7a93b787c03b0 | services/bot/test/g3b-staging.test.ts G3-9 teardown-skipped (evidence/G3b/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | module under fakes; no Modal, no vLLM, no inference |
| G3-10 | 5deffc1d4a7c7f1b1ad42012dac7a93b787c03b0 | services/bot/test/g3b-staging.test.ts G3-10g single-attempt receipt (passes on parent and head) | pass (guard, passes on parent and head) | existing guard | module under fakes; no Modal, no vLLM, no inference |
| G3-11 | 5deffc1d4a7c7f1b1ad42012dac7a93b787c03b0 | services/bot/test/g3b-staging.test.ts G3-11g evidence-write failure recorded and re-raised (passes on parent and head) | pass (guard, passes on parent and head) | existing guard | module under fakes; no Modal, no vLLM, no inference |
| G3-12 | 5deffc1d4a7c7f1b1ad42012dac7a93b787c03b0 | services/bot/test/g3b-staging.test.ts G3-12g no-silent-staging path (passes on parent and head) | pass (guard, passes on parent and head) | existing guard | module under fakes; no Modal, no vLLM, no inference |
| G4-1 | e9a8cdb0e0fd03403090334d5be328faa55a6d7d | apps/web/test/g4a-negative.test.ts G4-1 contradictory-none-accepted (evidence/G4a/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | session/adapter contract only; no live model call |
| G4-2 | e9a8cdb0e0fd03403090334d5be328faa55a6d7d | apps/web/test/g4a-negative.test.ts G4-2 invalid-none-accepted (evidence/G4a/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | session/adapter contract only; no live model call |
| G4-3 | e9a8cdb0e0fd03403090334d5be328faa55a6d7d | apps/web/test/g4a-negative.test.ts G4-3 mixed-none-dropped (evidence/G4a/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | session/adapter contract only; no live model call |
| G4-4 | e9a8cdb0e0fd03403090334d5be328faa55a6d7d | services/bot/test/g4a-negative.test.ts G4-2b adapter-none-unvalidated, UnboundAssessmentError before any fetch (evidence/G4a/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | fake HTTP only; no live model call |
| G4-5 | e9a8cdb0e0fd03403090334d5be328faa55a6d7d | apps/web/test/g4a-negative.test.ts G4-4g plus services/bot/test/g4a-negative.test.ts G4-5g empty-span none guards (pass on parent and head) | pass (guard, passes on parent and head) | existing guard | fixture classifiers only; no live model call |
| G4-6 | 9c8a4b0419ab2178da7164deb272a909033aca56 | apps/web/test/g4b-terms.test.ts G4-6 unrelated-term-accepted (evidence/G4b-run1/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | substring presence does not prove a term is unresolved; web tests only |
| G4-7 | 9c8a4b0419ab2178da7164deb272a909033aca56 | apps/web/test/g4b-terms.test.ts G4-7 pattern-mislabeled plus G4-4r negative-invisible (evidence/G4b-run1/before.txt) | pass (before/after probe, base_reason assertion) | bug regression | label and marker rendering only; web tests only |
| G4-8 | 9c8a4b0419ab2178da7164deb272a909033aca56 | apps/web/test/g4b-terms.test.ts G4-8g guard (passes on parent and head) | pass (guard, passes on parent and head) | existing guard | web tests only; no live model call |
| G5-1 | bebf9b08a90f9d83f31d6f5563252d91cdaedf19 | apps/web/test/g5-ledger.test.ts G5-1 plus scripts/ci/ledger-check.mjs checkCiPairing (docs/file checks, not behavioral proof) | pass (parent bebf9b0 fails with token ci-identity-mismatch; head passes; verifier certified) | static check | docs/ledger file checks; CI pairings from maintainer-recorded ci-observed.json |
| G5-2 | bebf9b08a90f9d83f31d6f5563252d91cdaedf19 | apps/web/test/g5-ledger.test.ts G5-2 plus scripts/ci/ledger-check.mjs reconciliation check (docs/file checks, not behavioral proof) | pass (parent bebf9b0 fails with token stale-ci-unrecorded; head passes; verifier certified) | static check | docs/ledger file checks; CI pairings from maintainer-recorded ci-observed.json |
| G5-3 | bebf9b08a90f9d83f31d6f5563252d91cdaedf19 | apps/web/test/g5-ledger.test.ts G5-3 plus scripts/ci/ledger-check.mjs checkProbe (docs/file checks, not behavioral proof) | pass (parent bebf9b0 fails with token probe-sha-unverified; head passes; verifier certified) | static check | docs/ledger file checks; CI pairings from maintainer-recorded ci-observed.json |
| G5-4 | bebf9b08a90f9d83f31d6f5563252d91cdaedf19 | apps/web/test/g5-ledger.test.ts G5-4 plus scripts/ci/ledger-check.mjs compareIdSets (docs/file checks, not behavioral proof) | pass (parent bebf9b0 fails with token id-set-incomplete; head passes; verifier certified) | static check | docs/ledger file checks; CI pairings from maintainer-recorded ci-observed.json |
| G5-5 | bebf9b08a90f9d83f31d6f5563252d91cdaedf19 | apps/web/test/g5-ledger.test.ts G5-5 plus scripts/ci/ledger-check.mjs checkClassification (docs/file checks, not behavioral proof) | pass (parent bebf9b0 fails with token classification-missing; head passes; verifier certified) | static check | docs/ledger file checks; CI pairings from maintainer-recorded ci-observed.json |
| G5-6 | bebf9b08a90f9d83f31d6f5563252d91cdaedf19 | apps/web/test/g5-ledger.test.ts G5-6g guard (docs/file checks, not behavioral proof) | pass (guard, passes on parent and head) | existing guard | no live inference; docs checks only |
| G6-1 | ac455b34a874c3d80ac0f6908f2e806de38c0671 | apps/web/e2e/g6-rehearsal.spec.ts G6-1g | pass (guard, passes on parent and head) | existing guard | offline fake HTTP; dummy bundles; no live inference |
| G6-2 | ac455b34a874c3d80ac0f6908f2e806de38c0671 | apps/web/e2e/g6-rehearsal.spec.ts G6-2g | pass (guard, passes on parent and head) | existing guard | offline fake HTTP; dummy bundles; no live inference |
| G6-3 | ac455b34a874c3d80ac0f6908f2e806de38c0671 | apps/web/e2e/g6-rehearsal.spec.ts G6-3g | pass (guard, passes on parent and head) | existing guard | offline fake HTTP; dummy bundles; no live inference |
| G6-4 | ac455b34a874c3d80ac0f6908f2e806de38c0671 | apps/web/e2e/g6-rehearsal.spec.ts G6-4g | pass (guard, passes on parent and head) | existing guard | offline fake HTTP; dummy bundles; no live inference |
| G6-5 | ac455b34a874c3d80ac0f6908f2e806de38c0671 | services/bot/test/g6-replay.test.ts G6-5g | pass (guard, passes on parent and head) | existing guard | offline fake HTTP; dummy bundles; no live inference |
| G6-6 | ac455b34a874c3d80ac0f6908f2e806de38c0671 | services/bot/test/g6-replay.test.ts G6-6g | pass (guard, passes on parent and head) | existing guard | offline fake HTTP; dummy bundles; no live inference |
| G6-7 | ac455b34a874c3d80ac0f6908f2e806de38c0671 | the targeted runs listed in docs/release/g-evidence-index.md | pass (static check) | static check | offline fake HTTP; dummy bundles; no live inference |
| G6-8 | ac455b34a874c3d80ac0f6908f2e806de38c0671 | docs/release/g-evidence-index.md | pass (static check) | static check | offline fake HTTP; dummy bundles; no live inference |

## 2) Sealed holdout review

- [ ] Sealed holdout review: BLOCKED pending separate authorization and independent human review.

## 3) Run configuration binding

- [ ] The eventual run configuration binds actual source, dataset identity, model revision, image digest, prompt hash, schema hash, scorer hash, decoding settings, token limits, timeouts and retry policy via services/bot/src/release/runConfig.ts (validateRunConfig and sparkProofClientOptions).
- [ ] The Spark proof configuration makes at most one actual HTTP attempt (retry maxAttempts equals 1).

## 4) Modal and Glimmer bounds

- [ ] Plan allows one Modal allocation, scored canary, bounded concurrency, declared limits, teardown and complete evidence download.
- [ ] Any extra Glimmer demonstration request must be declared (glimmerDemoRequests field); no hidden second allocation.

## 5) Publication policy

- [ ] Publication policy preserves failures, incomplete runs and full planned denominators. No undisclosed reruns or cherry-picking.

## 6) Budget

- [ ] Budget: PROPOSED — $2 Modal + $0.10 Spark = $2.10. Prices, resource assumptions and enforcement must be checked before separate authorization. A timeout is not a hard billing guarantee.

## 7) Partner verification

- [ ] Partner verification: PENDING.

## 8) Release checklist

- [ ] One release identity across README, CI, results, screenshots and video.
- [ ] Video is short: 3-minute limit (3:00).
- [ ] Accessible submission links checked before November 4, 3 PM CT.

## 9) Blocked human/authorized tasks

- [ ] Authorize and complete independent sealed-holdout review.
- [ ] Authorize the exact frozen live configuration and spending.
- [ ] Approve the exact redacted payload for the Spark request.
- [ ] Execute and inspect the one bounded live run.
- [ ] Confirm actual costs, teardown and partner verification.
- [ ] Conduct recording, publish links and submit.
- [ ] Do not mark these complete because this checklist exists.

## Plan section

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
