# G1b evidence — honest per-case failing-first evidence

Parent: cb40064 (G1a, PR #81). Verifier under test selected via MUSE_VERIFY_UNDER_TEST.

- before.txt: parent verifier (`git show cb40064:.muse/verify_pr.sh`) — G1-5..G1-9 FAIL, H8 FAIL (exit 1).
- after.txt: head verifier — all H1-H12 and G1-1..G1-9 PASS (exit 0).
- verify-1.json: helper self-verification, per-case: G1-5..G1-9 regressions (head pass, base_reason=assertion),
  G1-1..G1-4 and H3 guards (pass on both). Classified `uncertified-disclosed` because the test file
  removes lines (migration of pre-existing criteria to the case schema); disclosure reviewed in PR diff.

Disclosed behavior change: H8 previously expected `weak_before` for a missing-module before-failure;
it now expects `invalid_before` (wrong failure reason is rejected outright, G1-7). The H8 fixture's
check.sh now emits `FAIL T8`/`PASS T8` lines so it can be parsed per-case. So H8 fails on the parent by design.

Limitations (also emitted in verifier JSON): case status comes from the declared report format;
the verifier does not prove an assertion is semantically equivalent to the criterion; removed-line
check is textual, not semantic.

No paid inference, Modal, Baseten, sealed or heldout paths used; dummy git repos only. No hand edits to code.
