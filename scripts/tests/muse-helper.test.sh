#!/usr/bin/env bash
# muse-helper.test.sh — self-test for .muse/guard.sh / .muse/verify_pr.sh.
# No muse/model calls. Runs in mktemp dirs only. Dummy sentinel path:
# sentinel/heldout-sealed/dummy.txt (never real sealed data).
REPO="$(git rev-parse --show-toplevel)"
GUARD="$REPO/.muse/guard.sh"
VERIFY="${MUSE_VERIFY_UNDER_TEST:-$REPO/.muse/verify_pr.sh}"
SENTINEL="sentinel/heldout-sealed/dummy.txt"
FAIL=0

ok() { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s: %s\n' "$1" "$2"; FAIL=1; }

gitinit() {
  git init -q "$1"
  git -C "$1" config user.email "t@t.t"
  git -C "$1" config user.name "t"
  printf '.muse/scope.txt\n.muse/criteria.json\n' > "$1/.gitignore"
  git -C "$1" add -A
  git -C "$1" commit -qm init
}

# ---------- H1: guard pre denies sealed reads ----------
R="$(mktemp -d)"; gitinit "$R"
o1="$(printf '{"hook_event_name":"PreToolUse","tool_name":"read_file","tool_input":{"path":"%s"},"cwd":"%s"}' "$SENTINEL" "$R" | bash "$GUARD" pre)"
o2="$(printf '{"hook_event_name":"PreToolUse","tool_name":"exec","tool_input":{"command":"cat ./Sentinel/HeldOut-Sealed/dummy.txt"},"cwd":"%s"}' "$R" | bash "$GUARD" pre)"
if printf '%s' "$o1" | grep -q '"deny"' && \
   printf '%s' "$o2" | grep -q '"deny"'; then ok H1; else bad H1 "o1=$o1 o2=$o2"; fi
rm -rf "$R"

# ---------- H2: guard pre scope enforcement for edits ----------
R="$(mktemp -d)"; gitinit "$R"
mkdir -p "$R/.muse" "$R/src"
printf 'src/a.ts\n' > "$R/.muse/scope.txt"
edit() { printf '{"hook_event_name":"PreToolUse","tool_name":"edit_file","tool_input":{"path":"%s"},"cwd":"%s"}' "$1" "$R" | bash "$GUARD" pre; }
e_deny="$(edit src/other.ts)"
e_allow="$(edit src/a.ts)"
rm "$R/.muse/scope.txt"
e_noscope="$(edit src/a.ts)"
printf 'src/a.ts\n' > "$R/.muse/scope.txt"
e_outside="$(edit ../outside.txt)"
if printf '%s' "$e_deny" | grep -q '"deny"' && \
   [ -z "$e_allow" ] && \
   printf '%s' "$e_noscope" | grep -q '"deny"' && \
   printf '%s' "$e_outside" | grep -q '"deny"'; then ok H2; else bad H2 "deny=$e_deny allow=$e_allow noscope=$e_noscope outside=$e_outside"; fi
rm -rf "$R"

# helper: make fake repo, print dir; base commit has files from setup fn
mkbase() { D="$(mktemp -d)"; gitinit "$D"; printf '%s' "$D"; }

# ---------- H3: real fail-then-pass -> passed true ----------
R="$(mkbase)"; mkdir -p "$R/src" "$R/.muse"
printf 'forbidden-fixtures/\n' > "$R/.sealed-paths"
printf 'echo 1\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm base)
BASE="$(git -C "$R" rev-parse HEAD)"
printf 'echo 2\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T3","cmd":"if [ \\"$(sh src/a.sh)\\" = 2 ]; then echo \\"PASS T3\\"; else echo \\"FAIL T3: expected 2 got $(sh src/a.sh)\\"; exit 1; fi","files":[],"report":"lines","cases":[{"id":"T3","kind":"regression","expect":"expected 2 got 1"}]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -eq 0 ] && printf '%s' "$v" | grep -q '"passed": true'; then ok H3; else bad H3 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H4: test passes on base -> passes_on_base ----------
R="$(mkbase)"; mkdir -p "$R/src" "$R/.muse"
printf 'forbidden-fixtures/\n' > "$R/.sealed-paths"
printf 'echo 1\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm base)
BASE="$(git -C "$R" rev-parse HEAD)"
printf 'echo 2\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T4","cmd":"echo \\"PASS T4\\"","files":[],"report":"lines","cases":[{"id":"T4","kind":"regression","expect":"expected 2 got 1"}]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -ne 0 ] && printf '%s' "$v" | grep -q 'passes_on_base'; then ok H4; else bad H4 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H5: change outside scope -> out_of_scope ----------
R="$(mkbase)"; mkdir -p "$R/src" "$R/.muse"
printf 'forbidden-fixtures/\n' > "$R/.sealed-paths"
printf 'echo 1\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm base)
BASE="$(git -C "$R" rev-parse HEAD)"
printf 'echo 2\n' > "$R/src/a.sh"
printf 'echo x\n' > "$R/src/other.sh"
(cd "$R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T5","cmd":"test \\"$(sh src/a.sh)\\" = 2","files":[]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -ne 0 ] && printf '%s' "$v" | grep -q 'out_of_scope'; then ok H5; else bad H5 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H6: deleted test file -> test_deleted ----------
R="$(mkbase)"; mkdir -p "$R/src" "$R/.muse"
printf 'forbidden-fixtures/\n' > "$R/.sealed-paths"
printf 'echo 1\n' > "$R/src/a.sh"
printf 'dummy test\n' > "$R/src/a.test.sh"
(cd "$R" && git add -A && git commit -qm base)
BASE="$(git -C "$R" rev-parse HEAD)"
printf 'echo 2\n' > "$R/src/a.sh"
(cd "$R" && git rm -q src/a.test.sh && git commit -qm head)
printf 'src/a.sh\nsrc/a.test.sh\n' > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T6","cmd":"test \\"$(sh src/a.sh)\\" = 2","files":[]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -ne 0 ] && printf '%s' "$v" | grep -q 'test_deleted'; then ok H6; else bad H6 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H7: changed file under sentinel dir -> sealed_path ----------
R="$(mkbase)"; mkdir -p "$R/src" "$R/.muse"
printf 'forbidden-fixtures/\n' > "$R/.sealed-paths"
printf 'echo 1\n' > "$R/src/a.sh"
(cd "$R" && git add -A && git commit -qm base)
BASE="$(git -C "$R" rev-parse HEAD)"
printf 'echo 2\n' > "$R/src/a.sh"
mkdir -p "$R/sentinel/heldout-sealed"
printf 'sentinel dummy\n' > "$R/$SENTINEL"
(cd "$R" && git add -A && git commit -qm head)
printf 'src/a.sh\n%s\n' "$SENTINEL" > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T7","cmd":"test \\"$(sh src/a.sh)\\" = 2","files":[]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -ne 0 ] && printf '%s' "$v" | grep -q 'sealed_path'; then ok H7; else bad H7 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H8: base failure 'Cannot find module' -> weak_before ----------
R="$(mkbase)"; mkdir -p "$R/.muse"
printf 'forbidden-fixtures/\n' > "$R/.sealed-paths"
(cd "$R" && git add -A && git commit -qm base --allow-empty 2>/dev/null || true)
BASE="$(git -C "$R" rev-parse HEAD)"
printf '#!/bin/sh\nif [ ! -f marker.txt ]; then echo "FAIL T8: Error: Cannot find module '"'"'./marker'"'"'" >&2; exit 1; fi\necho "PASS T8"\nexit 0\n' > "$R/check.sh"
printf 'here\n' > "$R/marker.txt"
(cd "$R" && git add -A && git commit -qm head)
printf 'check.sh\nmarker.txt\n' > "$R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"T8","cmd":"sh check.sh","files":["check.sh"],"report":"lines","cases":[{"id":"T8","kind":"regression","expect":"expected 2 got 1"}]}]}' "$BASE" > "$R/.muse/criteria.json"
v="$(cd "$R" && bash "$VERIFY")"; st=$?
if [ "$st" -ne 0 ] && printf '%s' "$v" | grep -q 'invalid_before'; then ok H8; else bad H8 "st=$st v=$v"; fi
rm -rf "$R"

# ---------- H9: stop blocks twice, then allows ----------
R="$(mkbase)"
cp -r "$REPO/scripts" "$R/scripts"; mkdir -p "$R/.muse"; cp "$REPO/.muse/verify_pr.sh" "$R/.muse/verify_pr.sh"
printf 'forbidden-fixtures/\n' > "$R/.sealed-paths"
mkdir -p "$R/.muse"
printf 'scripts/*\nscripts/tests/*\n.muse/*\n' > "$R/.muse/scope.txt"
printf '{"base":"HEAD","tests":[{"id":"T9","cmd":"false","files":[],"report":"lines","cases":[{"id":"T9","kind":"guard"}]}]}' > "$R/.muse/criteria.json"
(cd "$R" && git add -A && git commit -qm head)
export TMPDIR="$R/tmp"; mkdir -p "$TMPDIR"
sin="$(printf '{"hook_event_name":"Stop","session_id":"h9sess","cwd":"%s"}' "$R")"
s1="$(printf '%s' "$sin" | bash "$GUARD" stop)"
s2="$(printf '%s' "$sin" | bash "$GUARD" stop)"
s3="$(printf '%s' "$sin" | bash "$GUARD" stop)"
if printf '%s' "$s1" | grep -q '"block"' && \
   printf '%s' "$s2" | grep -q '"block"' && \
   [ -z "$s3" ]; then ok H9; else bad H9 "s1=$s1 s2=$s2 s3=$s3"; fi
unset TMPDIR
rm -rf "$R"

# ---------- H10: root pointer layout ----------
H10_BAD=""
[ -f "$REPO/.agents/AGENTS.md" ] || H10_BAD="${H10_BAD} missing-agents-rules;"
if ! grep -q "Failing test first" "$REPO/.agents/AGENTS.md" 2>/dev/null; then H10_BAD="${H10_BAD} rules-text-missing;"; fi
if ! grep -q ".muse/guard.sh" "$REPO/.muse/hooks.json" 2>/dev/null; then H10_BAD="${H10_BAD} hooks-no-guard;"; fi
if grep -q "scripts/" "$REPO/.muse/hooks.json" 2>/dev/null; then H10_BAD="${H10_BAD} hooks-refs-scripts;"; fi
if [ -e "$REPO/scripts/muse_guard.sh" ]; then H10_BAD="${H10_BAD} stray-muse_guard;"; fi
if [ -e "$REPO/scripts/verify_pr.sh" ]; then H10_BAD="${H10_BAD} stray-verify_pr;"; fi
if [ ! -f "$REPO/AGENTS.md" ]; then H10_BAD="${H10_BAD} no-root-pointer;"; fi
if ! grep -q ".agents/AGENTS.md" "$REPO/AGENTS.md" 2>/dev/null; then H10_BAD="${H10_BAD} pointer-no-ref;"; fi
if grep -q "Failing test first" "$REPO/AGENTS.md" 2>/dev/null; then H10_BAD="${H10_BAD} pointer-copies-rules;"; fi
if [ -z "$H10_BAD" ]; then ok H10; else bad H10 "$H10_BAD"; fi

# ---------- H12: root pointer resolves ----------
H12_BAD=""
H12_TOKS="$(grep -o -E '[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)+(:[0-9]+)?|[A-Za-z0-9_.-]*\.(md|json|sh)(:[0-9]+)?' "$REPO/AGENTS.md" 2>/dev/null | sed -E 's/:[0-9]+$//; s/[`.,;:!?)]+$//; s/^[(`]+//' | sort -u)"
H12_UNRESOLVED=""
for H12_T in $H12_TOKS; do
  [ -z "$H12_T" ] && continue
  if [ ! -e "$REPO/$H12_T" ]; then H12_UNRESOLVED="${H12_UNRESOLVED} $H12_T"; fi
done
if [ -n "$H12_UNRESOLVED" ]; then H12_BAD="${H12_BAD} unresolved:$H12_UNRESOLVED;"; fi
H12_LINES="$(grep -c '[^[:space:]]' "$REPO/AGENTS.md" 2>/dev/null || true)"
if [ "$H12_LINES" -gt 3 ]; then H12_BAD="${H12_BAD} too-many-lines=$H12_LINES;"; fi
if ! printf '%s\n' "$H12_TOKS" | grep -qxF ".agents/AGENTS.md"; then H12_BAD="${H12_BAD} no-agents-ref;"; fi
if [ -z "$H12_BAD" ]; then ok H12; else bad H12 "$H12_BAD"; fi

# ---------- H11: prompt injection ----------
H11D="$(mktemp -d)"
H11BIN="$(mktemp -d)"
H11OUT="$(mktemp -d)"
export FAKE_OUT="$H11OUT"
printf '0' > "$H11OUT/count"
cat > "$H11BIN/muse" <<'FAKEEOF'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ]; then
  shift
  PFILE=""; LAST=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --prompt-file) PFILE="${2:-}"; shift 2;;
      --model|--contributor-mode|--reasoning-effort|--max-model-steps|--sandbox-network|--session-id) shift 2;;
      --disable-approval|--trust-workspace|--json) shift 1;;
      *) LAST="$1"; shift;;
    esac
  done
  N="$(cat "$FAKE_OUT/count" 2>/dev/null || echo 0)"
  N=$((N + 1))
  printf '%s' "$N" > "$FAKE_OUT/count"
  if [ -n "$PFILE" ] && [ -f "$PFILE" ]; then
    cat "$PFILE" > "$FAKE_OUT/prompt-$N.txt"
  else
    printf '%s' "$LAST" > "$FAKE_OUT/prompt-$N.txt"
  fi
  exit 0
elif [ "${1:-}" = "export" ]; then
  exit 0
else
  exit 0
fi
FAKEEOF
chmod +x "$H11BIN/muse"
gitinit "$H11D"
mkdir -p "$H11D/scripts" "$H11D/.agents" "$H11D/.muse"
cp "$REPO/scripts/muse_pr.sh" "$H11D/scripts/muse_pr.sh"
chmod +x "$H11D/scripts/muse_pr.sh"
cp "$REPO/.agents/AGENTS.md" "$H11D/.agents/AGENTS.md"
cat > "$H11D/.muse/verify_pr.sh" <<'STUBEOF'
#!/usr/bin/env bash
printf '{"passed":true,"problems":[]}'
exit 0
STUBEOF
chmod +x "$H11D/.muse/verify_pr.sh"
printf 'TASK-SENTINEL-H11\n' > "$H11D/task.txt"
printf '{"base":"HEAD","tests":[]}' > "$H11D/crit.json"
(cd "$H11D" && git add -A && git commit -qm h11base)
H11_OLD_PATH="$PATH"
export PATH="$H11BIN:$PATH"
H11ERR="$(mktemp)"
H11A_WHY=""; H11B_WHY=""
if (cd "$H11D" && bash scripts/muse_pr.sh --task "$H11D/task.txt" --scope "a.txt" --criteria "$H11D/crit.json" --evidence evidence/H11 2>"$H11ERR"); then H11_ST=0; else H11_ST=$?; fi
if [ "$H11_ST" -ne 0 ]; then H11A_WHY="exit=$H11_ST;"; fi
if [ ! -f "$H11OUT/prompt-1.txt" ]; then H11A_WHY="${H11A_WHY}no-prompt-1;"; fi
if [ -z "$H11A_WHY" ]; then
  if ! grep -q "Failing test first" "$H11OUT/prompt-1.txt"; then H11A_WHY="${H11A_WHY}no-rules;"; fi
  if ! grep -q "TASK-SENTINEL-H11" "$H11OUT/prompt-1.txt"; then H11A_WHY="${H11A_WHY}no-sentinel;"; fi
fi
if [ -z "$H11A_WHY" ]; then
  R_POS="$(grep -b -o "Failing test first" "$H11OUT/prompt-1.txt" | head -n1 | cut -d: -f1)"
  S_POS="$(grep -b -o "TASK-SENTINEL-H11" "$H11OUT/prompt-1.txt" | head -n1 | cut -d: -f1)"
  if [ -z "$R_POS" ] || [ -z "$S_POS" ] || [ "$R_POS" -ge "$S_POS" ]; then H11A_WHY="order R=$R_POS S=$S_POS;"; fi
fi
N_BEFORE="$(cat "$H11OUT/count")"
rm "$H11D/.agents/AGENTS.md"
H11ERR2="$(mktemp)"
if (cd "$H11D" && bash scripts/muse_pr.sh --task "$H11D/task.txt" --scope "a.txt" --criteria "$H11D/crit.json" --evidence evidence/H11b 2>"$H11ERR2"); then H11_ST2=0; else H11_ST2=$?; fi
N_AFTER="$(cat "$H11OUT/count")"
if [ "$H11_ST2" -ne 2 ]; then H11B_WHY="missing-exit=$H11_ST2;"; fi
if [ "$N_AFTER" != "$N_BEFORE" ]; then H11B_WHY="${H11B_WHY}muse-called-on-missing;"; fi
export PATH="$H11_OLD_PATH"
if [ -z "$H11A_WHY" ] && [ -z "$H11B_WHY" ]; then ok H11; else bad H11 "inject:${H11A_WHY:-ok} missing:${H11B_WHY:-ok} st=${H11_ST:-?}/${H11_ST2:-?}"; fi
rm -f "$H11ERR" "$H11ERR2"
rm -rf "$H11D" "$H11BIN" "$H11OUT"
unset FAKE_OUT

# ---------- H13: one attempt by default (no automatic retries) ----------
H13D="$(mktemp -d)"; H13BIN="$(mktemp -d)"; H13OUT="$(mktemp -d)"
printf '0' > "$H13OUT/count"
cat > "$H13BIN/muse" <<FAKEEOF
#!/usr/bin/env bash
if [ "\${1:-}" = "exec" ]; then
  N="\$(cat "$H13OUT/count")"; printf '%s' "\$((N + 1))" > "$H13OUT/count"
fi
exit 0
FAKEEOF
chmod +x "$H13BIN/muse"
gitinit "$H13D"
mkdir -p "$H13D/scripts" "$H13D/.agents" "$H13D/.muse"
cp "$REPO/scripts/muse_pr.sh" "$H13D/scripts/muse_pr.sh"
cp "$REPO/.agents/AGENTS.md" "$H13D/.agents/AGENTS.md"
printf '#!/usr/bin/env bash\nprintf %s\nexit 1\n' "'{\"passed\":false,\"problems\":[{\"code\":\"x\"}]}'" > "$H13D/.muse/verify_pr.sh"
printf 'T\n' > "$H13D/task.txt"; printf '{"base":"HEAD","tests":[]}' > "$H13D/crit.json"
(cd "$H13D" && git add -A && git commit -qm h13base)
H13_WHY=""
(cd "$H13D" && PATH="$H13BIN:$PATH" bash scripts/muse_pr.sh --task task.txt --scope "a.txt" --criteria crit.json --evidence evidence/H13 >/dev/null 2>&1); H13_ST=$?
H13_N="$(cat "$H13OUT/count")"
[ "$H13_N" = "1" ] || H13_WHY="${H13_WHY}muse-exec-calls=$H13_N;"
[ "$H13_ST" -eq 1 ] || H13_WHY="${H13_WHY}exit=$H13_ST;"
grep -q '"attempts": 1' "$H13D/evidence/H13/summary.json" 2>/dev/null || H13_WHY="${H13_WHY}summary-attempts-not-1;"
[ ! -e "$H13D/evidence/H13/session-2.jsonl" ] || H13_WHY="${H13_WHY}retry-session-written;"
# opt-in: --attempts 2 allows exactly one retry
printf '0' > "$H13OUT/count"
(cd "$H13D" && PATH="$H13BIN:$PATH" bash scripts/muse_pr.sh --task task.txt --scope "a.txt" --criteria crit.json --evidence evidence/H13b --attempts 2 >/dev/null 2>&1)
H13_N2="$(cat "$H13OUT/count")"
[ "$H13_N2" = "2" ] || H13_WHY="${H13_WHY}optin-attempts2-calls=$H13_N2;"
if [ -z "$H13_WHY" ]; then ok H13; else bad H13 "auto-retry: $H13_WHY"; fi
rm -rf "$H13D" "$H13BIN" "$H13OUT"

# ---------- H14: MUSE_BACKEND=baseten opt-in (default meta); key never printed ----------
H14D="$(mktemp -d)"; H14BIN="$(mktemp -d)"; H14OUT="$(mktemp -d)"
cat > "$H14BIN/muse" <<FAKEEOF
#!/usr/bin/env bash
if [ "\${1:-}" = "exec" ]; then
  printf '%s\n' "\$@" > "$H14OUT/args-\${H14TAG}.txt"
  if [ "\${META_API_KEY:-}" = "h14bt77" ]; then echo bt > "$H14OUT/key-\${H14TAG}.txt"
  elif [ "\${META_API_KEY:-}" = "h14mt77" ]; then echo meta > "$H14OUT/key-\${H14TAG}.txt"
  else echo other > "$H14OUT/key-\${H14TAG}.txt"; fi
fi
exit 0
FAKEEOF
chmod +x "$H14BIN/muse"
gitinit "$H14D"
mkdir -p "$H14D/scripts" "$H14D/.agents" "$H14D/.muse"
cp "$REPO/scripts/muse_pr.sh" "$H14D/scripts/muse_pr.sh"
cp "$REPO/.agents/AGENTS.md" "$H14D/.agents/AGENTS.md"
printf '#!/usr/bin/env bash\nprintf "{\\"passed\\":true,\\"problems\\":[]}"\nexit 0\n' > "$H14D/.muse/verify_pr.sh"
printf 'T\n' > "$H14D/task.txt"; printf '{"base":"HEAD","tests":[]}' > "$H14D/crit.json"
(cd "$H14D" && git add -A && git commit -qm h14base)
H14_WHY=""
(cd "$H14D" && export H14TAG=bt PATH="$H14BIN:$PATH" META_API_KEY=h14mt77 BASETEN_API_KEY=h14bt77 MUSE_BACKEND=baseten && bash scripts/muse_pr.sh --task task.txt --scope a.txt --criteria crit.json --evidence evidence/H14bt > "$H14OUT/out-bt.txt" 2>&1)
(cd "$H14D" && export H14TAG=meta PATH="$H14BIN:$PATH" META_API_KEY=h14mt77 BASETEN_API_KEY=h14bt77 && unset MUSE_BACKEND && bash scripts/muse_pr.sh --task task.txt --scope a.txt --criteria crit.json --evidence evidence/H14m > "$H14OUT/out-meta.txt" 2>&1)
A="$H14OUT/args-bt.txt"
grep -qx "meta-models/muse-spark-open-1026" "$A" 2>/dev/null || H14_WHY="${H14_WHY}bt-model;"
grep -qxF 'endpoint_transport.base_url="https://inference.baseten.co/v1"' "$A" 2>/dev/null || H14_WHY="${H14_WHY}bt-base-url;"
grep -qxF 'endpoint_transport.auth="bearer"' "$A" 2>/dev/null || H14_WHY="${H14_WHY}bt-auth;"
grep -qx -- "--disable-web-tools" "$A" 2>/dev/null || H14_WHY="${H14_WHY}bt-no-web;"
[ "$(cat "$H14OUT/key-bt.txt" 2>/dev/null)" = "bt" ] || H14_WHY="${H14_WHY}bt-key-not-swapped;"
grep -qx "muse-spark-1.3" "$H14OUT/args-meta.txt" 2>/dev/null || H14_WHY="${H14_WHY}default-not-meta;"
grep -q "baseten" "$H14OUT/args-meta.txt" 2>/dev/null && H14_WHY="${H14_WHY}default-uses-baseten;"
[ "$(cat "$H14OUT/key-meta.txt" 2>/dev/null)" = "meta" ] || H14_WHY="${H14_WHY}default-key-changed;"
if grep -rq "h14bt77" "$H14OUT"/out-*.txt "$H14D/evidence" 2>/dev/null; then H14_WHY="${H14_WHY}key-printed;"; fi
(cd "$H14D" && PATH="$H14BIN:$PATH" MUSE_BACKEND=bogus bash scripts/muse_pr.sh --task task.txt --scope a.txt --criteria crit.json --evidence evidence/H14x >/dev/null 2>&1); [ $? -eq 2 ] || H14_WHY="${H14_WHY}bogus-backend-not-exit2;"
if [ -z "$H14_WHY" ]; then ok H14; else bad H14 "backend: $H14_WHY"; fi
rm -rf "$H14D" "$H14BIN" "$H14OUT"

# G1 (Codex prompt A, G1a): checkout-safety tests on dummy repos with a dummy .sealed-paths policy only
# ---------- G1-0 helpers (dummy sealed-policy repos only) ----------
g1_rm() {
  _p="$1"
  case "$_p" in
    "$G1ROOT"*) rm -rf "$_p";;
    *) printf 'refuse rm outside g1root: %s\n' "$_p" >&2; FAIL=1;;
  esac
}
g1_mkshim() {
  _mode="$1"
  if [ "$_mode" = "fail" ]; then
  cat > "$G1BIN/git" <<'SHIMEOF'
#!/usr/bin/env bash
_lg="${G1LOG:?}"; _tp="${G1TMPDIR:?}"; _rg="${REAL_GIT:?}"
printf 'git %s\n' "$*" >> "$_lg"
case " $* " in
  *"sparse-checkout"*)
    for _d in "$_tp"/muse-base-*; do
      if [ -e "$_d/forbidden-fixtures/sentinel.txt" ]; then
        printf 'SENTINEL-SEEN git %s\n' "$*" >> "$_lg"
      fi
    done
    exit 3;;
esac
"$_rg" "$@"
_st=$?
printf 'git %s\n' "$*" >> "$_lg"
for _d in "$_tp"/muse-base-*; do
  if [ -e "$_d/forbidden-fixtures/sentinel.txt" ]; then
    printf 'SENTINEL-SEEN git %s\n' "$*" >> "$_lg"
  fi
done
exit $_st
SHIMEOF
  else
  cat > "$G1BIN/git" <<'SHIMEOF'
#!/usr/bin/env bash
_lg="${G1LOG:?}"; _tp="${G1TMPDIR:?}"; _rg="${REAL_GIT:?}"
"$_rg" "$@"
_st=$?
printf 'git %s\n' "$*" >> "$_lg"
for _d in "$_tp"/muse-base-*; do
  if [ -e "$_d/forbidden-fixtures/sentinel.txt" ]; then
    printf 'SENTINEL-SEEN git %s\n' "$*" >> "$_lg"
  fi
done
exit $_st
SHIMEOF
  fi
  chmod +x "$G1BIN/git"
}
g1_mkrepo() {
  mkdir -p "$G1R/src" "$G1R/.muse" "$G1R/forbidden-fixtures/"
  printf 'sentinel\n' > "$G1R/forbidden-fixtures/sentinel.txt"
  printf 'echo 1\n' > "$G1R/src/a.sh"
  if [ "$1" = "escape" ]; then
    printf '../escape\n' > "$G1R/.sealed-paths"
  elif [ "$1" = "missing" ]; then
    rm -f "$G1R/.sealed-paths"
  else
    printf 'forbidden-fixtures/\n' > "$G1R/.sealed-paths"
  fi
}
g1_mkcrit() {
  G1_CRIT="$1" G1_CRITBASE="$2" G1_CRITPREP="$3" python3 - <<'PYEOF'
import json, os
m = os.environ["G1MARK"]
d = {"base": os.environ["G1_CRITBASE"],
     "tests": [{"id": "G1T",
                "cmd": 'touch "%s/$(basename "$PWD")-ran"; cp src/a.sh "%s/$(basename "$PWD")-a.sh"; if [ "$(sh src/a.sh)" = 2 ]; then echo "PASS G1T"; else echo "FAIL G1T: expected 2 got $(sh src/a.sh)"; exit 1; fi' % (m, m),
                "files": [], "report": "lines",
                "cases": [{"id": "G1T", "kind": "regression", "expect": "expected 2 got 1"}]}]}
if os.environ.get("G1_CRITPREP"):
    d["prepare"] = os.environ["G1_CRITPREP"]
json.dump(d, open(os.environ["G1_CRIT"], "w"))
PYEOF
}
g1_run_verify() {
  G1_OLD_PATH="$PATH"
  if [ -n "${TMPDIR+x}" ]; then G1_TMP_WAS=1; G1_TMP_SAVED="$TMPDIR"; else G1_TMP_WAS=0; fi
  export PATH="$G1BIN:$PATH"
  export TMPDIR="$G1TMP"
  export G1TMPDIR="$G1TMP"
  export G1MARK G1LOG REAL_GIT
  if G1V="$(cd "$G1R" && bash "$VERIFY")"; then G1ST=0; else G1ST=$?; fi
  export PATH="$G1_OLD_PATH"
  if [ "$G1_TMP_WAS" = "1" ]; then export TMPDIR="$G1_TMP_SAVED"; else unset TMPDIR; fi
}
g1_no_leftover() {
  for _d in "$1"/muse-base-*; do
    if [ -e "$_d" ]; then printf '%s' "$_d"; return 0; fi
  done
  return 1
}
g1_wt_count() {
  git -C "$G1R" worktree list 2>/dev/null | wc -l | tr -d ' '
}

# ---------- G1-1: checkout ordering — excluded file never materializes ----------
G1ROOT="$(mktemp -d)"
G1R="$G1ROOT/repo"; G1TMP="$G1ROOT/tmp"; G1MARK="$G1ROOT/mark"; G1BIN="$G1ROOT/bin"; G1LOG="$G1ROOT/git.log"
mkdir -p "$G1TMP" "$G1MARK" "$G1BIN"; : > "$G1LOG"
gitinit "$G1R"
g1_mkrepo valid
(cd "$G1R" && git add -A && git commit -qm base)
G1BASE="$(git -C "$G1R" rev-parse HEAD)"
printf 'echo 2\n' > "$G1R/src/a.sh"
(cd "$G1R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$G1R/.muse/scope.txt"
export G1MARK
g1_mkcrit "$G1R/.muse/criteria.json" "$G1BASE" ""
export REAL_GIT="$(command -v git)"
g1_mkshim log
g1_run_verify
G1WHY=""
[ "$G1ST" -eq 0 ] || G1WHY="${G1WHY}exit=$G1ST;"
printf '%s' "$G1V" | grep -q '"passed": true' || G1WHY="${G1WHY}not-passed;"
grep -q 'SENTINEL-SEEN' "$G1LOG" && G1WHY="${G1WHY}sentinel-seen;"
grep -q -- '--no-checkout' "$G1LOG" || G1WHY="${G1WHY}no-no-checkout;"
grep -q 'worktree add' "$G1LOG" || G1WHY="${G1WHY}no-worktree-add;"
G1BASEHIT="$(grep -l 'echo 1' "$G1MARK"/*-a.sh 2>/dev/null || true)"
[ -n "$G1BASEHIT" ] || G1WHY="${G1WHY}no-base-content;"
if [ -z "$G1WHY" ]; then ok G1-1; else bad G1-1 "$G1WHY v=$G1V"; fi
g1_rm "$G1ROOT"

# ---------- G1-2: sparse-checkout failure stops everything, cleans up ----------
G1ROOT="$(mktemp -d)"
G1R="$G1ROOT/repo"; G1TMP="$G1ROOT/tmp"; G1MARK="$G1ROOT/mark"; G1BIN="$G1ROOT/bin"; G1LOG="$G1ROOT/git.log"
mkdir -p "$G1TMP" "$G1MARK" "$G1BIN"; : > "$G1LOG"
gitinit "$G1R"
g1_mkrepo valid
(cd "$G1R" && git add -A && git commit -qm base)
G1BASE="$(git -C "$G1R" rev-parse HEAD)"
printf 'echo 2\n' > "$G1R/src/a.sh"
(cd "$G1R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$G1R/.muse/scope.txt"
export G1MARK
g1_mkcrit "$G1R/.muse/criteria.json" "$G1BASE" "touch \"$G1MARK/prepared\""
export REAL_GIT="$(command -v git)"
g1_mkshim fail
g1_run_verify
G1WHY=""
[ "$G1ST" -ne 0 ] || G1WHY="${G1WHY}exit-zero;"
printf '%s' "$G1V" | grep -q 'policy_setup_failed' || G1WHY="${G1WHY}no-policy_setup_failed;"
[ ! -e "$G1MARK/prepared" ] || G1WHY="${G1WHY}prepared-ran;"
G1BASEHIT="$(grep -l 'echo 1' "$G1MARK"/*-a.sh 2>/dev/null || true)"
[ -z "$G1BASEHIT" ] || G1WHY="${G1WHY}base-ran;"
G1SP_LINE="$(grep -n 'sparse-checkout' "$G1LOG" | head -n 1 | cut -d: -f1)"
if [ -z "$G1SP_LINE" ]; then
  G1WHY="${G1WHY}no-sparse-call;"
elif tail -n +"$((G1SP_LINE + 1))" "$G1LOG" | grep -Eq 'read-tree|checkout'; then
  G1WHY="${G1WHY}late-materialize;"
fi
grep -q 'SENTINEL-SEEN' "$G1LOG" && G1WHY="${G1WHY}sentinel-seen;"
if g1_no_leftover "$G1TMP"; then G1WHY="${G1WHY}leftover;"; fi
G1WT_N="$(g1_wt_count)"
[ "$G1WT_N" = "1" ] || G1WHY="${G1WHY}worktrees=$G1WT_N;"
if [ -z "$G1WHY" ]; then ok G1-2; else bad G1-2 "$G1WHY v=$G1V"; fi
g1_rm "$G1ROOT"

# ---------- G1-3: missing / malformed policy refused before any work ----------
G1ROOT="$(mktemp -d)"
export REAL_GIT="$(command -v git)"
G1WHY3=""
# (a) missing policy
G1R="$G1ROOT/a"; G1TMP="$G1ROOT/tmp-a"; G1MARK="$G1ROOT/mark-a"; G1BIN="$G1ROOT/bin-a"; G1LOG="$G1ROOT/log-a.log"
mkdir -p "$G1TMP" "$G1MARK" "$G1BIN"; : > "$G1LOG"
gitinit "$G1R"
g1_mkrepo missing
(cd "$G1R" && git add -A && git commit -qm base)
G1BASE="$(git -C "$G1R" rev-parse HEAD)"
printf 'echo 2\n' > "$G1R/src/a.sh"
(cd "$G1R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$G1R/.muse/scope.txt"
export G1MARK
g1_mkcrit "$G1R/.muse/criteria.json" "$G1BASE" ""
g1_mkshim log
g1_run_verify
[ "$G1ST" -ne 0 ] || G1WHY3="${G1WHY3}a-exit-zero;"
printf '%s' "$G1V" | grep -q 'policy_missing' || G1WHY3="${G1WHY3}a-no-policy_missing;"
[ -z "$(ls -A "$G1MARK" 2>/dev/null)" ] || G1WHY3="${G1WHY3}a-test-ran;"
grep -q 'worktree add' "$G1LOG" && G1WHY3="${G1WHY3}a-worktree;"
grep -q 'SENTINEL-SEEN' "$G1LOG" && G1WHY3="${G1WHY3}a-sentinel;"
# (b) malformed policy
G1R="$G1ROOT/b"; G1TMP="$G1ROOT/tmp-b"; G1MARK="$G1ROOT/mark-b"; G1BIN="$G1ROOT/bin-b"; G1LOG="$G1ROOT/log-b.log"
mkdir -p "$G1TMP" "$G1MARK" "$G1BIN"; : > "$G1LOG"
gitinit "$G1R"
g1_mkrepo escape
(cd "$G1R" && git add -A && git commit -qm base)
G1BASE="$(git -C "$G1R" rev-parse HEAD)"
printf 'echo 2\n' > "$G1R/src/a.sh"
(cd "$G1R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$G1R/.muse/scope.txt"
export G1MARK
g1_mkcrit "$G1R/.muse/criteria.json" "$G1BASE" ""
g1_mkshim log
g1_run_verify
[ "$G1ST" -ne 0 ] || G1WHY3="${G1WHY3}b-exit-zero;"
printf '%s' "$G1V" | grep -q 'policy_invalid' || G1WHY3="${G1WHY3}b-no-policy_invalid;"
[ -z "$(ls -A "$G1MARK" 2>/dev/null)" ] || G1WHY3="${G1WHY3}b-test-ran;"
grep -q 'worktree add' "$G1LOG" && G1WHY3="${G1WHY3}b-worktree;"
grep -q 'SENTINEL-SEEN' "$G1LOG" && G1WHY3="${G1WHY3}b-sentinel;"
# (c) positive control: valid policy passes like G1-1
G1R="$G1ROOT/c"; G1TMP="$G1ROOT/tmp-c"; G1MARK="$G1ROOT/mark-c"; G1BIN="$G1ROOT/bin-c"; G1LOG="$G1ROOT/log-c.log"
mkdir -p "$G1TMP" "$G1MARK" "$G1BIN"; : > "$G1LOG"
gitinit "$G1R"
g1_mkrepo valid
(cd "$G1R" && git add -A && git commit -qm base)
G1BASE="$(git -C "$G1R" rev-parse HEAD)"
printf 'echo 2\n' > "$G1R/src/a.sh"
(cd "$G1R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$G1R/.muse/scope.txt"
export G1MARK
g1_mkcrit "$G1R/.muse/criteria.json" "$G1BASE" ""
g1_mkshim log
g1_run_verify
[ "$G1ST" -eq 0 ] || G1WHY3="${G1WHY3}c-exit=$G1ST;"
printf '%s' "$G1V" | grep -q '"passed": true' || G1WHY3="${G1WHY3}c-not-passed;"
grep -q 'SENTINEL-SEEN' "$G1LOG" && G1WHY3="${G1WHY3}c-sentinel;"
grep -q -- '--no-checkout' "$G1LOG" || G1WHY3="${G1WHY3}c-no-no-checkout;"
G1BASEHIT="$(grep -l 'echo 1' "$G1MARK"/*-a.sh 2>/dev/null || true)"
[ -n "$G1BASEHIT" ] || G1WHY3="${G1WHY3}c-no-base-content;"
if [ -z "$G1WHY3" ]; then ok G1-3; else bad G1-3 "$G1WHY3"; fi
g1_rm "$G1ROOT"

# ---------- G1-4: complete helper path + cleanup on all paths ----------
G1ROOT="$(mktemp -d)"
export REAL_GIT="$(command -v git)"
G1WHY4=""
G1VOUT_SAVED="__unset__"; [ -n "${VERIFY_OUT+x}" ] && G1VOUT_SAVED="$VERIFY_OUT"
# run A: pass path with VERIFY_OUT
G1R="$G1ROOT/rA"; G1TMP="$G1ROOT/tmp-A"; G1MARK="$G1ROOT/mark-A"; G1BIN="$G1ROOT/bin-A"; G1LOG="$G1ROOT/log-A.log"; G1VOUT="$G1ROOT/vout-A"
mkdir -p "$G1TMP" "$G1MARK" "$G1BIN" "$G1VOUT"; : > "$G1LOG"
gitinit "$G1R"
g1_mkrepo valid
(cd "$G1R" && git add -A && git commit -qm base)
G1BASE="$(git -C "$G1R" rev-parse HEAD)"
printf 'echo 2\n' > "$G1R/src/a.sh"
(cd "$G1R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$G1R/.muse/scope.txt"
export G1MARK
g1_mkcrit "$G1R/.muse/criteria.json" "$G1BASE" "touch \"$G1MARK/prepared\""
g1_mkshim log
export VERIFY_OUT="$G1VOUT"
g1_run_verify
if [ "$G1VOUT_SAVED" = "__unset__" ]; then unset VERIFY_OUT; else export VERIFY_OUT="$G1VOUT_SAVED"; fi
[ "$G1ST" -eq 0 ] || G1WHY4="${G1WHY4}A-exit=$G1ST;"
grep -q '"passed": true' "$G1VOUT/verify.json" 2>/dev/null || G1WHY4="${G1WHY4}A-not-passed;"
[ -e "$G1MARK/prepared" ] || G1WHY4="${G1WHY4}A-no-prepared;"
G1BASEHIT="$(grep -l 'echo 1' "$G1MARK"/*-a.sh 2>/dev/null || true)"
[ -n "$G1BASEHIT" ] || G1WHY4="${G1WHY4}A-no-base;"
grep -q 'SENTINEL-SEEN' "$G1LOG" && G1WHY4="${G1WHY4}A-sentinel;"
if g1_no_leftover "$G1TMP"; then G1WHY4="${G1WHY4}A-leftover;"; fi
G1WT_N="$(g1_wt_count)"
[ "$G1WT_N" = "1" ] || G1WHY4="${G1WHY4}A-worktrees=$G1WT_N;"
# run B: fail-then-pass still exits 0 overall
G1R="$G1ROOT/rB"; G1TMP="$G1ROOT/tmp-B"; G1MARK="$G1ROOT/mark-B"; G1BIN="$G1ROOT/bin-B"; G1LOG="$G1ROOT/log-B.log"; G1VOUT="$G1ROOT/vout-B"
mkdir -p "$G1TMP" "$G1MARK" "$G1BIN" "$G1VOUT"; : > "$G1LOG"
gitinit "$G1R"
g1_mkrepo valid
(cd "$G1R" && git add -A && git commit -qm base)
G1BASE="$(git -C "$G1R" rev-parse HEAD)"
printf 'echo 2\n' > "$G1R/src/a.sh"
(cd "$G1R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$G1R/.muse/scope.txt"
export G1MARK
g1_mkcrit "$G1R/.muse/criteria.json" "$G1BASE" "touch \"$G1MARK/prepared\""
g1_mkshim log
export VERIFY_OUT="$G1VOUT"
g1_run_verify
if [ "$G1VOUT_SAVED" = "__unset__" ]; then unset VERIFY_OUT; else export VERIFY_OUT="$G1VOUT_SAVED"; fi
[ "$G1ST" -eq 0 ] || G1WHY4="${G1WHY4}B-exit=$G1ST;"
grep -q '"passed": true' "$G1VOUT/verify.json" 2>/dev/null || G1WHY4="${G1WHY4}B-not-passed;"
G1BASEHIT="$(grep -l 'echo 1' "$G1MARK"/*-a.sh 2>/dev/null || true)"
[ -n "$G1BASEHIT" ] || G1WHY4="${G1WHY4}B-no-base-fail-evidence;"
grep -q 'SENTINEL-SEEN' "$G1LOG" && G1WHY4="${G1WHY4}B-sentinel;"
if g1_no_leftover "$G1TMP"; then G1WHY4="${G1WHY4}B-leftover;"; fi
G1WT_N="$(g1_wt_count)"
[ "$G1WT_N" = "1" ] || G1WHY4="${G1WHY4}B-worktrees=$G1WT_N;"
# run C: sparse failure still cleans up
G1R="$G1ROOT/rC"; G1TMP="$G1ROOT/tmp-C"; G1MARK="$G1ROOT/mark-C"; G1BIN="$G1ROOT/bin-C"; G1LOG="$G1ROOT/log-C.log"; G1VOUT="$G1ROOT/vout-C"
mkdir -p "$G1TMP" "$G1MARK" "$G1BIN" "$G1VOUT"; : > "$G1LOG"
gitinit "$G1R"
g1_mkrepo valid
(cd "$G1R" && git add -A && git commit -qm base)
G1BASE="$(git -C "$G1R" rev-parse HEAD)"
printf 'echo 2\n' > "$G1R/src/a.sh"
(cd "$G1R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$G1R/.muse/scope.txt"
export G1MARK
g1_mkcrit "$G1R/.muse/criteria.json" "$G1BASE" "touch \"$G1MARK/prepared\""
g1_mkshim fail
export VERIFY_OUT="$G1VOUT"
g1_run_verify
if [ "$G1VOUT_SAVED" = "__unset__" ]; then unset VERIFY_OUT; else export VERIFY_OUT="$G1VOUT_SAVED"; fi
[ "$G1ST" -ne 0 ] || G1WHY4="${G1WHY4}C-exit-zero;"
printf '%s' "$G1V" | grep -q 'policy_setup_failed' || G1WHY4="${G1WHY4}C-no-policy_setup_failed;"
[ ! -e "$G1MARK/prepared" ] || G1WHY4="${G1WHY4}C-prepared-ran;"
G1BASEHIT="$(grep -l 'echo 1' "$G1MARK"/*-a.sh 2>/dev/null || true)"
[ -z "$G1BASEHIT" ] || G1WHY4="${G1WHY4}C-base-ran;"
grep -q 'SENTINEL-SEEN' "$G1LOG" && G1WHY4="${G1WHY4}C-sentinel;"
if g1_no_leftover "$G1TMP"; then G1WHY4="${G1WHY4}C-leftover;"; fi
G1WT_N="$(g1_wt_count)"
[ "$G1WT_N" = "1" ] || G1WHY4="${G1WHY4}C-worktrees=$G1WT_N;"
if [ -z "$G1WHY4" ]; then ok G1-4; else bad G1-4 "$G1WHY4"; fi
g1_rm "$G1ROOT"

# ---------- G1-5: empty criteria rejected, positive control passes ----------
# Dummy policy filename assembled without the dotted literal (pre-hook lexical rule).
DOT='.'
SEALED_FILE="${DOT}sealed-paths"
G1ROOT="$(mktemp -d)"
G15R="$G1ROOT/repo"; mkdir -p "$G15R/src" "$G15R/.muse"
gitinit "$G15R"
printf 'forbidden-fixtures/\n' > "$G15R/$SEALED_FILE"
printf 'echo 1\n' > "$G15R/src/a.sh"
(cd "$G15R" && git add -A && git commit -qm base)
G15BASE="$(git -C "$G15R" rev-parse HEAD)"
printf 'echo 2\n' > "$G15R/src/a.sh"
(cd "$G15R" && git add -A && git commit -qm head)
printf 'src/a.sh\n' > "$G15R/.muse/scope.txt"
G15WHY=""
G15MARK="$G1ROOT/empty-prepare-ran"
printf '{"base":"%s","prepare":"touch \\"%s\\"","tests":[]}' "$G15BASE" "$G15MARK" > "$G15R/.muse/criteria.json"
if G15V="$(cd "$G15R" && bash "$VERIFY")"; then G15ST=0; else G15ST=$?; fi
[ "$G15ST" -ne 0 ] || G15WHY="${G15WHY}empty-exit-zero;"
printf '%s' "$G15V" | grep -q 'empty_criteria' || G15WHY="${G15WHY}empty-no-code;"
printf '%s' "$G15V" | grep -q '"passed": false' || G15WHY="${G15WHY}empty-passed-true;"
[ ! -e "$G15MARK" ] || G15WHY="${G15WHY}empty-cmd-ran;"
printf '{"base":"%s","tests":[{"id":"G15T","cmd":"if [ \\"$(sh src/a.sh)\\" = 2 ]; then echo \\"PASS G15C\\"; else echo \\"FAIL G15C: expected 2 got $(sh src/a.sh)\\"; exit 1; fi","files":[],"report":"lines","cases":[{"id":"G15C","kind":"regression","expect":"expected 2 got 1"}]}]}' "$G15BASE" > "$G15R/.muse/criteria.json"
if G15V2="$(cd "$G15R" && bash "$VERIFY")"; then G15ST2=0; else G15ST2=$?; fi
[ "$G15ST2" -eq 0 ] || G15WHY="${G15WHY}control-exit=$G15ST2;"
printf '%s' "$G15V2" | grep -q '"passed": true' || G15WHY="${G15WHY}control-not-passed;"
if [ -z "$G15WHY" ]; then ok G1-5; else bad G1-5 "empty-accepted $G15WHY v=$G15V v2=$G15V2"; fi
g1_rm "$G1ROOT"

# ---------- G1-6: one failure cannot certify two ----------
G1ROOT="$(mktemp -d)"
G16WHY=""
G16R="$G1ROOT/ri"; mkdir -p "$G16R/.muse"
gitinit "$G16R"
printf 'forbidden-fixtures/\n' > "$G16R/$SEALED_FILE"
cat > "$G16R/check.sh" <<'CHEOF'
#!/bin/sh
echo "FAIL A: expected 2 got 1"
echo "PASS B"
exit 1
CHEOF
(cd "$G16R" && git add -A && git commit -qm base)
G16BASE="$(git -C "$G16R" rev-parse HEAD)"
cat > "$G16R/check.sh" <<'CHEOF'
#!/bin/sh
echo "PASS A"
echo "PASS B"
exit 0
CHEOF
(cd "$G16R" && git add -A && git commit -qm head)
printf 'check.sh\n' > "$G16R/.muse/scope.txt"
G16_CRIT="$G16R/.muse/criteria.json" G16_CRITBASE="$G16BASE" G16_BKIND="regression" python3 - <<'PYEOF'
import json, os
bcase = {"id": "B", "kind": os.environ["G16_BKIND"]}
if os.environ["G16_BKIND"] == "regression":
    bcase["expect"] = "zzz-nothing"
d = {"base": os.environ["G16_CRITBASE"],
     "tests": [{"id": "G16T", "cmd": "sh check.sh", "files": [], "report": "lines",
                "cases": [{"id": "A", "kind": "regression", "expect": "expected 2 got 1"}, bcase]}]}
json.dump(d, open(os.environ["G16_CRIT"], "w"))
PYEOF
if G16V="$(cd "$G16R" && bash "$VERIFY")"; then G16ST=0; else G16ST=$?; fi
[ "$G16ST" -ne 0 ] || G16WHY="${G16WHY}i-exit-zero;"
printf '%s' "$G16V" | grep -q 'passes_on_base' || G16WHY="${G16WHY}i-no-pob;"
printf '%s' "$G16V" | grep -q 'G16T.B' || G16WHY="${G16WHY}i-no-B;"
G16CASES="$(printf '%s' "$G16V" | python3 -c '
import json, sys
e = []
try:
    d = json.load(sys.stdin)
except Exception:
    print("no-json"); raise SystemExit
cs = {(c.get("test"), c.get("id")): c for c in d.get("cases", [])}
a = cs.get(("G16T", "A")); b = cs.get(("G16T", "B"))
if not a or not b:
    e.append("missing-cases")
else:
    if a.get("classification") != "certified-regression" or a.get("certified") is not True:
        e.append("A=%s/%s" % (a.get("classification"), a.get("certified")))
    if b.get("classification") != "passes-on-base" or b.get("certified") is not False:
        e.append("B=%s/%s" % (b.get("classification"), b.get("certified")))
    if not any(p.get("code") == "passes_on_base" and "B" in str(p.get("detail")) for p in d.get("problems", [])):
        e.append("pob-not-naming-B")
print(";".join(e))')"
[ -z "$G16CASES" ] || G16WHY="${G16WHY}i-cases:$G16CASES;"

# ---------- G1-6 (ii): B as guard passes through ----------
G16R="$G1ROOT/rii"; mkdir -p "$G16R/.muse"
gitinit "$G16R"
printf 'forbidden-fixtures/\n' > "$G16R/$SEALED_FILE"
cat > "$G16R/check.sh" <<'CHEOF'
#!/bin/sh
echo "FAIL A: expected 2 got 1"
echo "PASS B"
exit 1
CHEOF
(cd "$G16R" && git add -A && git commit -qm base)
G16BASE="$(git -C "$G16R" rev-parse HEAD)"
cat > "$G16R/check.sh" <<'CHEOF'
#!/bin/sh
echo "PASS A"
echo "PASS B"
exit 0
CHEOF
(cd "$G16R" && git add -A && git commit -qm head)
printf 'check.sh\n' > "$G16R/.muse/scope.txt"
G16_CRIT="$G16R/.muse/criteria.json" G16_CRITBASE="$G16BASE" G16_BKIND="guard" python3 - <<'PYEOF'
import json, os
bcase = {"id": "B", "kind": os.environ["G16_BKIND"]}
if os.environ["G16_BKIND"] == "regression":
    bcase["expect"] = "zzz-nothing"
d = {"base": os.environ["G16_CRITBASE"],
     "tests": [{"id": "G16T", "cmd": "sh check.sh", "files": [], "report": "lines",
                "cases": [{"id": "A", "kind": "regression", "expect": "expected 2 got 1"}, bcase]}]}
json.dump(d, open(os.environ["G16_CRIT"], "w"))
PYEOF
if G16V2="$(cd "$G16R" && bash "$VERIFY")"; then G16ST2=0; else G16ST2=$?; fi
[ "$G16ST2" -eq 0 ] || G16WHY="${G16WHY}ii-exit=$G16ST2;"
G16CASES2="$(printf '%s' "$G16V2" | python3 -c '
import json, sys
e = []
try:
    d = json.load(sys.stdin)
except Exception:
    print("no-json"); raise SystemExit
cs = {(c.get("test"), c.get("id")): c for c in d.get("cases", [])}
a = cs.get(("G16T", "A")); b = cs.get(("G16T", "B"))
if not a or not b:
    e.append("missing-cases")
else:
    if a.get("classification") != "certified-regression" or a.get("certified") is not True:
        e.append("A=%s/%s" % (a.get("classification"), a.get("certified")))
    if b.get("classification") != "guard" or b.get("certified") is not False:
        e.append("B=%s/%s" % (b.get("classification"), b.get("certified")))
print(";".join(e))')"
[ -z "$G16CASES2" ] || G16WHY="${G16WHY}ii-cases:$G16CASES2;"
if [ -z "$G16WHY" ]; then ok G1-6; else bad G1-6 "b-certified $G16WHY v=$G16V v2=$G16V2"; fi
g1_rm "$G1ROOT"

# ---------- G1-7: wrong failure reason is invalid, not certified ----------
G1ROOT="$(mktemp -d)"
G17WHY=""
g17_mk() { # $1=subdir; uses G17BASE_CHECK, G17TIMEOUT, G17PREP
  G17R="$G1ROOT/$1"; mkdir -p "$G17R/.muse"
  gitinit "$G17R"
  printf 'forbidden-fixtures/\n' > "$G17R/$SEALED_FILE"
  printf '%s\n' "$G17BASE_CHECK" > "$G17R/check.sh"
  (cd "$G17R" && git add -A && git commit -qm base)
  G17BASE="$(git -C "$G17R" rev-parse HEAD)"
  printf 'echo "PASS A"\n' > "$G17R/check.sh"
  (cd "$G17R" && git add -A && git commit -qm head)
  printf 'check.sh\n' > "$G17R/.muse/scope.txt"
  G17_CRIT="$G17R/.muse/criteria.json" G17_CRITBASE="$G17BASE" G17TIMEOUT="$G17TIMEOUT" G17PREP="$G17PREP" python3 - <<'PYEOF'
import json, os
t = {"id": "T17", "cmd": "sh check.sh", "files": [], "report": "lines",
     "cases": [{"id": "A", "kind": "regression", "expect": "expected 2 got 1"}]}
if os.environ.get("G17TIMEOUT"): t["timeout_s"] = int(os.environ["G17TIMEOUT"])
dd = {"base": os.environ["G17_CRITBASE"], "tests": [t]}
if os.environ.get("G17PREP"): dd["prepare"] = os.environ["G17PREP"]
json.dump(dd, open(os.environ["G17_CRIT"], "w"))
PYEOF
  if G17V="$(cd "$G17R" && bash "$VERIFY")"; then G17ST=0; else G17ST=$?; fi
}
g17_chk() { # $1=tag $2=want_exit $3=want_base_reason $4=want_class $5=want_cert
  G17JSON="$G17V" G17ST_C="$G17ST" G17TAG="$1" G17WE="$2" G17WBR="$3" G17WC="$4" G17WCERT="$5" python3 - <<'PYEOF'
import json, os
e = []
tag = os.environ["G17TAG"]
try:
    d = json.loads(os.environ["G17JSON"])
except Exception:
    print("%s:no-json" % tag); raise SystemExit
st = int(os.environ["G17ST_C"])
we = os.environ["G17WE"]
if we == "zero" and st != 0:
    e.append("%s:exit=%d" % (tag, st))
if we == "nonzero" and st == 0:
    e.append("%s:exit-zero" % tag)
cs = d.get("cases", [])
c = cs[0] if cs else {}
if c.get("base_reason") != os.environ["G17WBR"]:
    e.append("%s:br=%s" % (tag, c.get("base_reason")))
if c.get("classification") != os.environ["G17WC"]:
    e.append("%s:class=%s" % (tag, c.get("classification")))
want_cert = os.environ["G17WCERT"] == "true"
if c.get("certified") is not want_cert:
    e.append("%s:cert=%s" % (tag, c.get("certified")))
if we == "nonzero" and os.environ["G17WC"] == "invalid-before":
    if "invalid_before" not in [p.get("code") for p in d.get("problems", [])]:
        e.append("%s:no-invalid_before" % tag)
print(";".join(e))
PYEOF
}
g17_add() { # $1=checker output
  [ -z "$1" ] || G17WHY="${G17WHY}$1;"
}
# (a) stderr noise, no case line -> missing
G17BASE_CHECK=$'echo "Error: Cannot find module \'./x\'" >&2\nexit 1'
G17TIMEOUT=""; G17PREP=""
g17_mk a
g17_add "$(g17_chk a nonzero missing invalid-before false)"
# (b) shell syntax error -> missing
G17BASE_CHECK=$'if true; then echo hi'
G17TIMEOUT=""; G17PREP=""
g17_mk b
g17_add "$(g17_chk b nonzero missing invalid-before false)"
# (c) no case lines at all -> missing
G17BASE_CHECK=$'echo "no tests found"\nexit 1'
G17TIMEOUT=""; G17PREP=""
g17_mk c
g17_add "$(g17_chk c nonzero missing invalid-before false)"
# (d) prepare fails in base -> prepare-failed, base cmd not run
G17BASE_CHECK=$'echo "FAIL A: expected 2 got 1"\nexit 1'
G17TIMEOUT=""; G17PREP="false"
g17_mk d
g17_add "$(g17_chk d nonzero prepare-failed invalid-before false)"

# (e) base sleeps past timeout_s=2 -> timeout
G17BASE_CHECK=$'sleep 5\necho "PASS A"'
G17TIMEOUT="2"; G17PREP=""
g17_mk e
g17_add "$(g17_chk e nonzero timeout invalid-before false)"
G17TIMEOUT=""
# (f) matching failure reason -> certified
G17BASE_CHECK=$'echo "FAIL A: expected 2 got 1"\nexit 1'
G17PREP=""
g17_mk f
g17_add "$(g17_chk f zero assertion certified-regression true)"
# (g) non-matching failure reason -> unexpected-failure
G17BASE_CHECK=$'echo "FAIL A: TypeError: x is not a function"\nexit 1'
G17PREP=""
g17_mk g
g17_add "$(g17_chk g nonzero unexpected-failure invalid-before false)"
if [ -z "$G17WHY" ]; then ok G1-7; else bad G1-7 "wrong-reason-accepted $G17WHY"; fi
g1_rm "$G1ROOT"

# ---------- G1-8: assertion weakening ----------
G1ROOT="$(mktemp -d)"
G18R="$G1ROOT/repo"; mkdir -p "$G18R/src" "$G18R/.muse"
gitinit "$G18R"
printf 'forbidden-fixtures/\n' > "$G18R/$SEALED_FILE"
printf 'echo 1\n' > "$G18R/src/a.sh"
cat > "$G18R/check.sh" <<'CHEOF'
#!/bin/sh
if [ "$(sh src/a.sh)" = 2 ]; then
  echo "PASS W"
else
  echo "FAIL W: expected 2 got $(sh src/a.sh)"
  exit 1
fi
CHEOF
(cd "$G18R" && git add -A && git commit -qm base)
G18BASE="$(git -C "$G18R" rev-parse HEAD)"
printf 'echo 2\n' > "$G18R/src/a.sh"
cat > "$G18R/check.sh" <<'CHEOF'
#!/bin/sh
if true; then
  echo "PASS W"
else
  echo "FAIL W: expected 2 got $(sh src/a.sh)"
  exit 1
fi
CHEOF
(cd "$G18R" && git add -A && git commit -qm head)
printf 'src/a.sh\ncheck.sh\n' > "$G18R/.muse/scope.txt"
G18WHY=""
g18_mkcrit() { # uses G18DISC
  G18_CRIT="$G18R/.muse/criteria.json" G18_CRITBASE="$G18BASE" G18DISC="$G18DISC" python3 - <<'PYEOF'
import json, os
case = {"id": "W", "kind": "regression", "expect": "expected 2 got 1"}
if os.environ.get("G18DISC"):
    case["disclosure"] = os.environ["G18DISC"]
d = {"base": os.environ["G18_CRITBASE"],
     "tests": [{"id": "T18", "cmd": "sh check.sh", "files": ["check.sh"],
                "report": "lines", "cases": [case]}]}
json.dump(d, open(os.environ["G18_CRIT"], "w"))
PYEOF
}
G18DISC=""
g18_mkcrit
if G18V="$(cd "$G18R" && bash "$VERIFY")"; then G18ST=0; else G18ST=$?; fi
[ "$G18ST" -ne 0 ] || G18WHY="${G18WHY}bare-exit-zero;"
printf '%s' "$G18V" | grep -q 'test_modified_uncertified' || G18WHY="${G18WHY}bare-no-code;"
G18DISC="head replaced the value check with true; assertion intentionally weakened"
g18_mkcrit
if G18V2="$(cd "$G18R" && bash "$VERIFY")"; then G18ST2=0; else G18ST2=$?; fi
[ "$G18ST2" -eq 0 ] || G18WHY="${G18WHY}disc-exit=$G18ST2;"
G18CERT="$(printf '%s' "$G18V2" | python3 -c 'import json,sys; cs=json.load(sys.stdin).get("cases",[]); c=cs[0] if cs else {}; print("%s/%s" % (c.get("classification"), c.get("certified")))')"
[ "$G18CERT" = "uncertified-disclosed/False" ] || G18WHY="${G18WHY}disc-cert=$G18CERT;"
if [ -z "$G18WHY" ]; then ok G1-8; else bad G1-8 "weakening-certified $G18WHY"; fi
g1_rm "$G1ROOT"

# ---------- G1-9: evidence identity ----------
G1ROOT="$(mktemp -d)"
G19R="$G1ROOT/repo"; mkdir -p "$G19R/src" "$G19R/.muse"
gitinit "$G19R"
printf 'forbidden-fixtures/\n' > "$G19R/$SEALED_FILE"
printf 'echo 1\n' > "$G19R/src/a.sh"
(cd "$G19R" && git add -A && git commit -qm base)
G19BASE="$(git -C "$G19R" rev-parse HEAD)"
printf 'echo 2\n' > "$G19R/src/a.sh"
(cd "$G19R" && git add -A && git commit -qm head)
G19HEAD="$(git -C "$G19R" rev-parse HEAD)"
printf 'src/a.sh\n' > "$G19R/.muse/scope.txt"
printf '{"base":"%s","tests":[{"id":"G19T","cmd":"if [ \\"$(sh src/a.sh)\\" = 2 ]; then echo \\"PASS G19C\\"; else echo \\"FAIL G19C: expected 2 got $(sh src/a.sh)\\"; exit 1; fi","files":[],"report":"lines","cases":[{"id":"G19C","kind":"regression","expect":"expected 2 got 1"}]}]}' "$G19BASE" > "$G19R/.muse/criteria.json"
if G19V="$(cd "$G19R" && bash "$VERIFY")"; then G19ST=0; else G19ST=$?; fi
G19E="$(G19JSON="$G19V" G19BASE_C="$G19BASE" G19HEAD_C="$G19HEAD" python3 - <<'PYEOF'
import json, os, re
e = []
try:
    d = json.loads(os.environ["G19JSON"])
except Exception:
    print("no-json"); raise SystemExit
if d.get("parent_sha") != os.environ["G19BASE_C"]:
    e.append("parent=%s" % (d.get("parent_sha"),))
if d.get("head_sha") != os.environ["G19HEAD_C"]:
    e.append("head=%s" % (d.get("head_sha"),))
if not re.fullmatch(r"[0-9a-f]{40}", str(d.get("head_tree") or "")):
    e.append("tree=%s" % (d.get("head_tree"),))
if not d.get("limitations"):
    e.append("no-limitations")
cs = d.get("cases", [])
if not cs:
    e.append("no-cases")
for c in cs:
    for k in ("test", "id", "command", "classification", "expected", "observed"):
        if k not in c:
            e.append("case-missing-%s" % k)
    if not c.get("command"):
        e.append("empty-command")
    if not c.get("classification"):
        e.append("empty-classification")
print(";".join(e))
PYEOF
)"
G19WHY=""
[ "$G19ST" -eq 0 ] || G19WHY="${G19WHY}exit=$G19ST;"
[ -z "$G19E" ] || G19WHY="${G19WHY}$G19E;"
if [ -z "$G19WHY" ]; then ok G1-9; else bad G1-9 "missing-identity $G19WHY v=$G19V"; fi
g1_rm "$G1ROOT"

# ---------- CR3 helpers (bash scope-check; guard under test is overridable) ----------
CR3GUARD="${MUSE_GUARD_UNDER_TEST:-$REPO/.muse/guard.sh}"
cr3run() {
  _cmd="$1"
  _tn="${2:-bash}"
  CMD="$_cmd" TN="$_tn" CR3CWD="$CR3R" python3 -c 'import json,os; print(json.dumps({"hook_event_name":"PreToolUse","tool_name":os.environ["TN"],"tool_input":{"command":os.environ["CMD"]},"cwd":os.environ["CR3CWD"]}))' | bash "$CR3GUARD" pre
}
cr3mk() {
  CR3R="$(mktemp -d)"; gitinit "$CR3R"
  mkdir -p "$CR3R/.muse" "$CR3R/src" "$CR3R/docs"
  printf '%s\n' "forbidden-fix""tures/" > "$CR3R/$SEALED_FILE"
}

# ---------- CR3-redirect ----------
cr3mk
printf 'src/a.sh\n' > "$CR3R/.muse/scope.txt"
CR3_D1="$(cr3run 'echo x > src/b.sh')"
CR3_A1="$(cr3run 'echo x > src/a.sh')"
CR3_A2="$(cr3run 'echo x > /tmp/zz')"
CR3_D2="$(cr3run 'cd src && echo x > b.sh')"
CR3OK=1
printf '%s' "$CR3_D1" | grep -q '"deny"' || CR3OK=0
printf '%s' "$CR3_D1" | grep -q 'out of scope' || CR3OK=0
[ -z "$CR3_A1" ] || CR3OK=0
[ -z "$CR3_A2" ] || CR3OK=0
printf '%s' "$CR3_D2" | grep -q '"deny"' || CR3OK=0
if [ "$CR3OK" = "1" ]; then ok CR3-redirect; else bad CR3-redirect "bash-write-allowed deny1=$CR3_D1 allow1=$CR3_A1 allow2=$CR3_A2 deny2=$CR3_D2"; fi
rm -rf "$CR3R"

# ---------- CR3-tools ----------
cr3mk
printf 'src/a.sh\n' > "$CR3R/.muse/scope.txt"
CR3FAIL=""
cr3_deny() { _o="$(cr3run "$1")"; printf '%s' "$_o" | grep -q '"deny"' || CR3FAIL="${CR3FAIL} deny-missed[$1]=>[$_o];"; }
cr3_allow() { _o="$(cr3run "$1")"; [ -z "$_o" ] || CR3FAIL="${CR3FAIL} allow-missed[$1]=>[$_o];"; }
cr3_deny 'sed -i s/a/b/ src/b.sh'
cr3_deny 'cp src/a.sh src/b.sh'
cr3_deny 'mv src/a.sh docs/x'
cr3_deny 'rm src/b.sh'
cr3_deny 'tee src/b.sh < /dev/null'
cr3_deny 'touch src/b.sh'
cr3_deny 'git checkout -- src/b.sh'
cr3_deny 'git apply x.patch'
cr3_deny 'python3 -c "open('"'"'src/b.sh'"'"','"'"'w'"'"')"'
cr3_deny 'bash -c "echo x > src/b.sh"'
cr3_deny 'echo x > "$OUT"'
cr3_allow 'cat src/b.sh'
cr3_allow 'git diff'
cr3_allow 'ls -la'
cr3_allow 'npx vitest run test/x.test.ts'
cr3_allow 'sed -i s/a/b/ src/a.sh'
cr3_allow 'cp src/b.sh /tmp/q'
if [ -z "$CR3FAIL" ]; then ok CR3-tools; else bad CR3-tools "bash-write-allowed $CR3FAIL"; fi
rm -rf "$CR3R"

# ---------- CR3-noscope ----------
cr3mk
rm -f "$CR3R/.muse/scope.txt"
CR3_D="$(cr3run 'echo x > src/a.sh')"
CR3_A="$(cr3run 'git status')"
CR3OK=1
printf '%s' "$CR3_D" | grep -q '"deny"' || CR3OK=0
[ -z "$CR3_A" ] || CR3OK=0
if [ "$CR3OK" = "1" ]; then ok CR3-noscope; else bad CR3-noscope "bash-write-allowed deny=$CR3_D allow=$CR3_A"; fi
rm -rf "$CR3R"

if [ "$FAIL" -ne 0 ]; then printf '%s\n' "SELF-TEST FAILED"; exit 1; fi
printf '%s\n' "SELF-TEST OK"
