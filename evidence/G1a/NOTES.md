# G1a evidence
- Muse session 69dbfc59-7805-4a9f-9cea-48da4a39fa9e via scripts/muse_pr.sh, scope `.muse/verify_pr.sh scripts/tests/muse-helper.test.sh`, cost in cost.txt.
- Helper criteria used `"tests":[]` so the OLD verifier never created a worktree of the real repo (prompt A: no unsafe-verifier before-evidence on the real repo).
- before-parent.txt: the new G1-1..G1-4 tests run against the parent verifier (86df5c3:.muse/verify_pr.sh, copied to /tmp) with MUSE_VERIFY_UNDER_TEST, dummy repos only. G1-1..G1-4 FAIL for real reasons (sentinel materialized, no --no-checkout, no policy_* refusal, prepare/base ran after sparse failure). H1-H12 still pass.
- after-head.txt: same suite against this head's verifier: SELF-TEST OK.
- Hand edits (disclosed): removed a dead `if false; then ... fi` legacy sparse block Muse left in verify_pr.sh; reworded one test comment. No behavior change.
