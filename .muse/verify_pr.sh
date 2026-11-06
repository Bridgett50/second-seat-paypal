#!/usr/bin/env bash
# verify_pr.sh [--base REF] [--full] — fail-then-pass PR verification.
# Bash + python3 stdlib only. Prints one JSON line; exit 0 iff passed.
# Reads .muse/criteria.json {base, prepare, tests:[{id, cmd, files}]}.
set -u

BASE_OVERRIDE=""
FULL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE_OVERRIDE="${2:-}"; shift 2;;
    --full) FULL=1; shift;;
    *) echo "usage: verify_pr.sh [--base REF] [--full]" >&2; exit 2;;
  esac
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/muse-verify-XXXXXX")"
PROBLEMS="$WORK/problems.jsonl"
TESTSTATUS="$WORK/status"
TESTLOGS="$WORK/logs"
mkdir -p "$TESTSTATUS" "$TESTLOGS"
: > "$PROBLEMS"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

add_problem() {
  python3 -c 'import json,sys; print(json.dumps({"code":sys.argv[1],"detail":sys.argv[2]}))' \
    "$1" "$2" >> "$PROBLEMS"
}

emit_json() {
JSON_OUT="$(BASE_SHA="$BASE_SHA" HEAD_SHA="$HEAD_SHA" HEAD_TREE="$HEAD_TREE" PROBLEMS="$PROBLEMS" TESTSTATUS="$TESTSTATUS" CASES="$WORK/cases.jsonl" python3 - <<'EOF'
import json, os
probs = []
with open(os.environ["PROBLEMS"]) as f:
    for line in f:
        line = line.strip()
        if line:
            probs.append(json.loads(line))
cases = []
try:
    with open(os.environ["CASES"]) as f:
        for line in f:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
except OSError:
    pass
tests = []
crit = {}
try:
    crit = json.load(open(".muse/criteria.json"))
except Exception:
    pass
for t in crit.get("tests", []) or []:
    tid = str(t.get("id", "t"))
    import re
    sid = re.sub(r"[^A-Za-z0-9_.-]", "_", tid)
    def rd(kind, default):
        try:
            return open(os.path.join(os.environ["TESTSTATUS"], sid + "." + kind)).read().strip() or default
        except OSError:
            return default
    tests.append({"id": tid, "head": rd("head", "fail"), "base": rd("base", "fail")})
print(json.dumps({"passed": len(probs) == 0, "base": os.environ["BASE_SHA"],
                  "parent_sha": os.environ.get("BASE_SHA", ""),
                  "head_sha": os.environ.get("HEAD_SHA", ""),
                  "head_tree": os.environ.get("HEAD_TREE", ""),
                  "problems": probs, "tests": tests, "cases": cases,
                  "limitations": ["case status comes from the declared report format; the verifier does not prove an assertion is semantically equivalent to the criterion",
                                  "removed-line check is textual, not semantic"]}))
EOF
)"
printf '%s\n' "$JSON_OUT"
if [ -n "${VERIFY_OUT:-}" ]; then
  mkdir -p "$VERIFY_OUT"
  printf '%s\n' "$JSON_OUT" > "$VERIFY_OUT/verify.json"
  cp "$TESTLOGS"/* "$VERIFY_OUT"/ 2>/dev/null || true
fi
}

# --- sealed regex: same sources as .muse/guard.sh (small duplicated block) ---
sealed_regex() {
  python3 - <<'EOF'
import os, re
patterns = ["heldout-sealed", "holdout-v1", "eval/heldout", r"\.sealed", r"(^|/)\.env"]
if os.path.exists(".sealed-paths"):
    with open(".sealed-paths") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            patterns.append(re.escape(line))
print("|".join("(%s)" % s for s in patterns))
EOF
}
SEALED_RX="$(sealed_regex)"

# --- criteria ---
BASE="$BASE_OVERRIDE"
PREPARE=""
if [ ! -f .muse/criteria.json ]; then
  add_problem "empty_criteria" ".muse/criteria.json is missing"
else
  eval "$(python3 - <<'EOF'
import json
try:
    c = json.load(open(".muse/criteria.json"))
except Exception as e:
    print('CRIT_ERR=%s' % "bad criteria.json")
else:
    import shlex
    print('CRIT_BASE=%s' % shlex.quote(str(c.get("base", ""))))
    print('CRIT_PREPARE=%s' % shlex.quote(str(c.get("prepare", "") or "")))
EOF
)"
  if [ -n "${CRIT_ERR:-}" ]; then add_problem "empty_criteria" "bad criteria.json"; fi
  if [ -z "$BASE" ]; then BASE="${CRIT_BASE:-}"; fi
  PREPARE="${CRIT_PREPARE:-}"
fi
if [ -z "$BASE" ]; then BASE="HEAD"; fi
BASE_SHA="$(git rev-parse --verify "$BASE" 2>/dev/null || echo "")"
if [ -z "$BASE_SHA" ]; then
  add_problem "bad_base" "cannot resolve base ref: $BASE"
  BASE_SHA="HEAD"
fi
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo "")"
TMPIDX="$(mktemp "${TMPDIR:-/tmp}/muse-idx-XXXXXX")"
HEAD_TREE=""
if GIT_INDEX_FILE="$TMPIDX" git read-tree HEAD 2>/dev/null || GIT_INDEX_FILE="$TMPIDX" git read-tree --empty 2>/dev/null; then
  if GIT_INDEX_FILE="$TMPIDX" git add -A 2>/dev/null; then
    HEAD_TREE="$(GIT_INDEX_FILE="$TMPIDX" git write-tree 2>/dev/null || echo "")"
  fi
fi
rm -f "$TMPIDX"
CRIT_OK=1
CRIT_PROB=""
CRIT_DETAIL=""
eval "$(python3 - <<'EOF'
import json, shlex
try:
    c = json.load(open(".muse/criteria.json"))
except Exception:
    print("CRIT_OK=0")
    print("CRIT_PROB=%s" % shlex.quote("empty_criteria"))
    print("CRIT_DETAIL=%s" % shlex.quote("missing or invalid criteria.json"))
else:
    tests = c.get("tests")
    if not tests:
        print("CRIT_OK=0")
        print("CRIT_PROB=%s" % shlex.quote("empty_criteria"))
        print("CRIT_DETAIL=%s" % shlex.quote("tests is empty"))
    else:
        bad = ""
        for t in tests:
            t = t or {}
            cases = t.get("cases")
            if not cases:
                bad = "test %s has no cases" % (t.get("id", "t"))
                break
            for cs in cases:
                if not isinstance(cs, dict) or not cs.get("id"):
                    bad = "test %s has a case without id" % (t.get("id", "t"))
                    break
                if cs.get("kind") not in ("regression", "guard"):
                    bad = "case %s has bad kind" % (cs.get("id"))
                    break
                if cs.get("kind") == "regression" and not cs.get("expect"):
                    bad = "regression case %s has no expect" % (cs.get("id"))
                    break
            if bad:
                break
        if bad:
            print("CRIT_OK=0")
            print("CRIT_PROB=%s" % shlex.quote("no_cases"))
            print("CRIT_DETAIL=%s" % shlex.quote(bad))
EOF
)"
if [ "$CRIT_OK" != "1" ]; then add_problem "$CRIT_PROB" "$CRIT_DETAIL"; fi

# --- sealed policy first: no test command and no worktree before this passes ---
POLICY_FILE="$ROOT/.sealed-paths"
POLICY_ENTRIES="$WORK/policy-entries.txt"
: > "$POLICY_ENTRIES"
POLICY_BAD=""
if [ ! -f "$POLICY_FILE" ] || [ ! -r "$POLICY_FILE" ]; then
  add_problem "policy_missing" ".sealed-paths is missing or unreadable"
  POLICY_BAD="missing"
else
  POLICY_CHECK="$(POLICY_FILE="$POLICY_FILE" POLICY_ENTRIES="$POLICY_ENTRIES" python3 - <<'EOF'
import os
pf = os.environ["POLICY_FILE"]
out = os.environ["POLICY_ENTRIES"]
entries = []
bad = ""
try:
    with open(pf) as f:
        raw = f.read().splitlines()
except OSError as e:
    bad = "unreadable: %s" % e
else:
    import re as _re
    for line in raw:
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if s.startswith("/") or "\\" in s or "*" in s or "?" in s or "[" in s or "]" in s:
            bad = "invalid entry: %s" % s
            break
        if _re.search(r"\s", s):
            bad = "invalid entry: %s" % s
            break
        if any(seg == ".." for seg in s.split("/")):
            bad = "invalid entry: %s" % s
            break
        entries.append(s)
    if not bad and not entries:
        bad = "empty policy"
if bad:
    print("bad:" + bad)
else:
    with open(out, "w") as f:
        for e in entries:
            f.write(e + "\n")
    print("ok")
EOF
)"
  if [ "$POLICY_CHECK" = "ok" ]; then
    POLICY_BAD=""
  elif [ "${POLICY_CHECK#bad:unreadable}" != "$POLICY_CHECK" ]; then
    add_problem "policy_missing" "${POLICY_CHECK#bad:}"
    POLICY_BAD="missing"
  else
    add_problem "policy_invalid" "${POLICY_CHECK#bad:}"
    POLICY_BAD="invalid"
  fi
fi
if [ -n "$POLICY_BAD" ]; then
  emit_json
  exit 1
fi

# --- changed paths: committed + working tree + untracked non-ignored ---
CHANGED="$WORK/changed.txt"
{
  git diff --name-only "$BASE_SHA" HEAD -- 2>/dev/null
  git diff --name-only "$BASE_SHA" -- 2>/dev/null
  git ls-files --others --exclude-standard 2>/dev/null
} | sed '/^[[:space:]]*$/d' | grep -v '^evidence/' | sort -u > "$CHANGED"

# --- scope globs + criteria test files ---
SCOPE_OK=1
if [ ! -f .muse/scope.txt ]; then SCOPE_OK=0; fi
TESTFILES="$WORK/testfiles.txt"
: > "$TESTFILES"
python3 - >> "$TESTFILES" 2>/dev/null <<'EOF'
import json
try:
    c = json.load(open(".muse/criteria.json"))
except Exception:
    pass
else:
    for t in c.get("tests", []) or []:
        for f in t.get("files", []) or []:
            print(f)
EOF

while IFS= read -r p; do
  [ -n "$p" ] || continue
  # a) scope check
  inscope="$(SCOPE_OK="$SCOPE_OK" P="$p" python3 - <<'EOF'
import os, re
p = os.environ["P"]
ok = False
if os.environ.get("SCOPE_OK") == "1" and os.path.exists(".muse/scope.txt"):
    pats = [l.strip() for l in open(".muse/scope.txt")]
    pats = [l for l in pats if l and not l.startswith("#")]
    def m(pat, path):
        i, n, out = 0, len(pat), ""
        while i < n:
            c = pat[i]
            if c == "*": out += "[^/]*"
            elif c == "?": out += "[^/]"
            elif c == "[":
                j = i + 1
                if j < n and pat[j] in "!^": j += 1
                if j < n and pat[j] == "]": j += 1
                while j < n and pat[j] != "]": j += 1
                if j < n:
                    inner = pat[i+1:j]
                    if inner[:1] in ("!", "^"): inner = "^" + inner[1:]
                    out += "[" + inner + "]"; i = j
                else: out += re.escape(c)
            else: out += re.escape(c)
            i += 1
        return re.match(out + r"\Z", path) is not None
    ok = any(m(g, p) for g in pats)
print("yes" if ok else "no")
EOF
)"
  # criteria test files count as in-scope (exact match)
  if [ "$inscope" != "yes" ] && grep -qxF "$p" "$TESTFILES" 2>/dev/null; then inscope="yes"; fi
  if [ "$inscope" != "yes" ]; then add_problem "out_of_scope" "$p"; fi
  # b) sealed check (case-insensitive, backslashes -> /)
  if printf '%s' "$p" | tr '\\' '/' | grep -qiE "$SEALED_RX"; then
    add_problem "sealed_path" "$p"
  fi
done < "$CHANGED"

# --- c) deleted / weakened tests ---
DELETED="$WORK/deleted.txt"
{
  git diff --name-only --diff-filter=D "$BASE_SHA" HEAD -- 2>/dev/null
  git diff --name-only --diff-filter=D "$BASE_SHA" -- 2>/dev/null
} | sed '/^[[:space:]]*$/d' | sort -u > "$DELETED"
is_testfile() {
  case "$1" in
    *.test.*|*.spec.*|test/*|*/test/*|e2e/*|*/e2e/*) return 0;;
    *) return 1;;
  esac
}
count_its() {
  # $1 = file path at HEAD (working tree); $2 = 1 for base version via git show
  if [ "$2" = "1" ]; then
    git show "$BASE_SHA:$1" 2>/dev/null | grep -cE '\b(it|test)(\.[A-Za-z0-9_]+)?\(' || true
  else
    grep -cE '\b(it|test)(\.[A-Za-z0-9_]+)?\(' "$1" 2>/dev/null || true
  fi
}
while IFS= read -r p; do
  [ -n "$p" ] || continue
  if is_testfile "$p"; then add_problem "test_deleted" "$p"; fi
done < "$DELETED"
while IFS= read -r p; do
  [ -n "$p" ] || continue
  if ! is_testfile "$p"; then continue; fi
  if grep -qxF "$p" "$DELETED" 2>/dev/null; then continue; fi
  if grep -qxF "$p" "$TESTFILES" 2>/dev/null && git cat-file -e "$BASE_SHA:$p" 2>/dev/null; then continue; fi  # per-test removed-line check covers it
  if ! git cat-file -e "$BASE_SHA:$p" 2>/dev/null; then continue; fi  # new file
  if [ ! -f "$p" ]; then continue; fi
  before="$(count_its "$p" 1)"; after="$(count_its "$p" 0)"
  before="${before:-0}"; after="${after:-0}"
  if [ "$after" -lt "$before" ]; then
    add_problem "test_weakened" "$p: it/test count $before -> $after"
  fi
done < "$CHANGED"

# --- d) per-test fail-then-pass (per-case evidence) ---
NTESTS="$(python3 -c 'import json
try: print(len(json.load(open(".muse/criteria.json")).get("tests", []) or []))
except Exception: print(0)')"
if [ "${CRIT_OK:-1}" != "1" ]; then NTESTS=0; fi
: > "$WORK/cases.jsonl"

parse_cases() {
  # Reads CASES_JSON, MODE (lines|vitest-json), LOG, REPJSON; writes OUT.
  python3 - <<'EOF'
import json, os, re
cases = json.load(open(os.environ["CASES_JSON"]))
mode = os.environ.get("MODE", "lines")
def blank():
    return {str(c.get("id")): {"status": "missing", "message": ""} for c in cases}
out = None
if mode == "vitest-json":
    try:
        d = json.load(open(os.environ["REPJSON"]))
    except Exception:
        out = blank()
    else:
        tr = d.get("testResults")
        if not isinstance(tr, list):
            out = blank()
        else:
            bad_suite = False
            for e in tr:
                if isinstance(e, dict) and e.get("status") == "failed" and not e.get("assertionResults"):
                    bad_suite = True
                    break
            if bad_suite:
                out = blank()
            else:
                asserts = []
                for e in tr:
                    if isinstance(e, dict):
                        ar = e.get("assertionResults") or []
                        if isinstance(ar, list):
                            asserts.extend(a for a in ar if isinstance(a, dict))
                out = {}
                for c in cases:
                    cid = str(c.get("id"))
                    m = [a for a in asserts if a.get("fullName") == cid]
                    if not m:
                        m = [a for a in asserts if a.get("title") == cid]
                    fails = [a for a in m if a.get("status") == "failed"]
                    passes = [a for a in m if a.get("status") == "passed"]
                    if fails:
                        msgs = []
                        for a in fails:
                            fm = a.get("failureMessages")
                            if isinstance(fm, list):
                                msgs.extend(str(x) for x in fm)
                            elif fm:
                                msgs.append(str(fm))
                        out[cid] = {"status": "fail", "message": "\n".join(msgs)}
                    elif passes:
                        out[cid] = {"status": "pass", "message": ""}
                    else:
                        out[cid] = {"status": "missing", "message": ""}
else:
    try:
        text = open(os.environ["LOG"], errors="replace").read()
    except OSError:
        text = ""
    found = {}
    for line in text.splitlines():
        m = re.match(r"^PASS\s+(\S+)\s*$", line)
        if m:
            found.setdefault(m.group(1), []).append(("pass", ""))
            continue
        m = re.match(r"^FAIL\s+(\S+?)\s*(?::\s?(.*))?$", line)
        if m:
            found.setdefault(m.group(1), []).append(("fail", m.group(2) or ""))
    out = {}
    for c in cases:
        cid = str(c.get("id"))
        evs = found.get(cid, [])
        fails = [m for s, m in evs if s == "fail"]
        passes = [m for s, m in evs if s == "pass"]
        if fails:
            out[cid] = {"status": "fail", "message": fails[0]}
        elif passes:
            out[cid] = {"status": "pass", "message": ""}
        else:
            out[cid] = {"status": "missing", "message": ""}
json.dump(out, open(os.environ["OUT"], "w"))
EOF
}

classify_cases() {
  # Reads WORK, TESTSTATUS, PROBLEMS, TID, TCMD, REPORT, SID, WEAKENED.
  # Appends case rows to cases.jsonl, problems, and per-test head/base aggregates.
  python3 - <<'EOF'
import json, os, re
work = os.environ["WORK"]
ts = os.environ["TESTSTATUS"]
tid = os.environ["TID"]
tcmd = os.environ["TCMD"]
report = os.environ["REPORT"]
sid = os.environ["SID"]
weakened = [w for w in os.environ.get("WEAKENED", "").split(" ") if w]
cases = json.load(open(os.path.join(work, "cases-%s.json" % sid)))
head = json.load(open(os.path.join(work, "parsed-%s.head.json" % sid)))
def readf(p, d=""):
    try:
        return open(p).read().strip() or d
    except OSError:
        return d
setup_failed = readf(os.path.join(ts, sid + ".setup_failed")) == "1"
prep_failed = readf(os.path.join(ts, sid + ".prep_failed")) == "1"
try:
    base_exit = int(readf(os.path.join(ts, sid + ".base_exit"), "1"))
except ValueError:
    base_exit = 1
base = {}
if not (setup_failed or prep_failed):
    try:
        base = json.load(open(os.path.join(work, "parsed-%s.base.json" % sid)))
    except Exception:
        base = {}
probs = []
rows = []
head_all = True
base_all = True
for c in cases:
    cid = str(c.get("id"))
    kind = c.get("kind")
    expect = c.get("expect") or ""
    disc = c.get("disclosure") or ""
    hc = head.get(cid)
    if isinstance(hc, dict) and hc.get("status") in ("pass", "fail", "missing"):
        h = hc.get("status")
        hm = str(hc.get("message") or "")
    else:
        h, hm = "missing", ""
    if setup_failed:
        br, obs = "setup-failed", ""
    elif prep_failed:
        br, obs = "prepare-failed", ""
    elif base_exit == 124:
        br, obs = "timeout", ""
    else:
        b = base.get(cid)
        if not isinstance(b, dict):
            br, obs = "missing", ""
        elif b.get("status") == "pass":
            br, obs = "passed", ""
        elif b.get("status") == "missing":
            br, obs = "missing", ""
        else:
            msg = str(b.get("message") or "")
            try:
                matched = bool(expect) and re.search(expect, msg) is not None
            except re.error:
                matched = False
            if matched:
                br, obs = "assertion", msg[:500]
            else:
                br, obs = "unexpected-failure", msg[:500]
    if h != "pass":
        head_all = False
    if br != "passed":
        base_all = False
    weak = bool(weakened) and kind == "regression"
    if weak:
        if disc:
            cl, cert = "uncertified-disclosed", False
        else:
            cl, cert = "uncertified", False
            probs.append({"code": "test_modified_uncertified",
                          "detail": "%s.%s: %s has removed lines vs base" % (tid, cid, " ".join(weakened))})
    elif h != "pass":
        cl, cert = "fails-on-head", False
        d = "%s.%s: head %s" % (tid, cid, h)
        if hm:
            d += ": %s" % hm[:200]
        probs.append({"code": "fails_on_head", "detail": d})
    elif kind == "regression":
        if br == "assertion":
            cl, cert = "certified-regression", True
        elif br == "passed":
            cl, cert = "passes-on-base", False
            probs.append({"code": "passes_on_base", "detail": "%s.%s passed on base" % (tid, cid)})
        else:
            cl, cert = "invalid-before", False
            d = "%s.%s: base %s" % (tid, cid, br)
            if obs:
                d += ": %s" % obs[:200]
            probs.append({"code": "invalid_before", "detail": d})
    else:
        cl, cert = "guard", False
        if br in ("assertion", "unexpected-failure"):
            d = "%s.%s: guard failed on base (%s)" % (tid, cid, br)
            if obs:
                d += ": %s" % obs[:200]
            probs.append({"code": "guard_failed_on_base", "detail": d})
    rows.append({"test": tid, "id": cid, "kind": kind, "command": tcmd, "report": report,
                 "head": h, "base_reason": br, "classification": cl, "certified": cert,
                 "expected": expect, "observed": obs})
open(os.path.join(ts, sid + ".head"), "w").write("pass" if head_all else "fail")
open(os.path.join(ts, sid + ".base"), "w").write("pass" if base_all else "fail")
with open(os.path.join(work, "cases.jsonl"), "a") as f:
    for r in rows:
        f.write(json.dumps(r) + "\n")
with open(os.environ["PROBLEMS"], "a") as f:
    for p in probs:
        f.write(json.dumps(p) + "\n")
EOF
}

i=0
while [ "$i" -lt "$NTESTS" ]; do
  eval "$(python3 - "$i" <<'EOF'
import json, shlex, sys
t = json.load(open(".muse/criteria.json"))["tests"][int(sys.argv[1])]
print("TID=%s" % shlex.quote(str(t.get("id", "t"))))
print("TCMD=%s" % shlex.quote(str(t.get("cmd", ""))))
print("REPORT=%s" % shlex.quote(str(t.get("report") or "lines")))
ts = t.get("timeout_s", 600)
try:
    ts = int(ts)
except Exception:
    ts = 600
if ts <= 0:
    ts = 600
print("TTIMEOUT=%d" % ts)
import os
files = t.get("files", []) or []
print("TFILES_N=%d" % len(files))
for n, f in enumerate(files):
    print("TFILE_%d=%s" % (n, shlex.quote(str(f))))
cases = t.get("cases", []) or []
print("TCASES_N=%d" % len(cases))
print("TCASES_JSON=%s" % shlex.quote(json.dumps(cases)))
EOF
)"
  sid="$(printf '%s' "$TID" | tr -c 'A-Za-z0-9_.-' '_')"
  printf '%s' "$TCASES_JSON" > "$WORK/cases-$sid.json"
  # weakening for this test: removed lines vs base in listed files that exist at base
  WEAKENED=""
  n=0
  while [ "$n" -lt "${TFILES_N:-0}" ]; do
    eval "f=\$TFILE_$n"
    if git cat-file -e "$BASE_SHA:$f" 2>/dev/null; then
      if git diff "$BASE_SHA" -- "$f" 2>/dev/null | grep -qE '^-[^-]'; then
        WEAKENED="${WEAKENED:+$WEAKENED }$f"
      fi
    fi
    n=$((n + 1))
  done
  # head run (every cmd under timeout; fresh case report for vitest-json)
  HEADREP=""
  if [ "$REPORT" = "vitest-json" ]; then HEADREP="$(mktemp "${TMPDIR:-/tmp}/muse-cases-XXXXXX")"; fi
  set +e
  if [ -n "$HEADREP" ]; then
    (MUSE_CASE_REPORT="$HEADREP" timeout "$TTIMEOUT" sh -c "$TCMD" >"$TESTLOGS/$sid.head.log" 2>&1)
    head_st=$?
  else
    (env -u MUSE_CASE_REPORT timeout "$TTIMEOUT" sh -c "$TCMD" >"$TESTLOGS/$sid.head.log" 2>&1)
    head_st=$?
  fi
  set -e
  printf '%s' "$head_st" > "$TESTSTATUS/$sid.head_exit"
  if [ -n "$HEADREP" ]; then
    cp "$HEADREP" "$WORK/report-$sid.head.json" 2>/dev/null || true
    rm -f "$HEADREP"
  fi
  CASES_JSON="$WORK/cases-$sid.json" MODE="$REPORT" LOG="$TESTLOGS/$sid.head.log" REPJSON="$WORK/report-$sid.head.json" OUT="$WORK/parsed-$sid.head.json" parse_cases
  # base worktree
  WT="$(mktemp -d "${TMPDIR:-/tmp}/muse-base-XXXXXX")"
  base_res="fail"
  set +e
  git worktree add --no-checkout --detach "$WT" "$BASE_SHA" >/dev/null 2>&1
  wt_st=$?
  set -e
  WT_OK=""
  WT_FAIL_STEP=""
  if [ "$wt_st" -ne 0 ]; then
    WT_FAIL_STEP="worktree-add"
  else
    {
      printf '/*\n'
      while IFS= read -r pe; do
        [ -n "$pe" ] || continue
        printf '!/%s\n' "$pe"
      done < "$POLICY_ENTRIES"
    } > "$WORK/sparse-$sid.txt"
    set +e
    git -C "$WT" sparse-checkout set --no-cone --stdin < "$WORK/sparse-$sid.txt" >/dev/null 2>&1
    sc_st=$?
    set -e
    if [ "$sc_st" -ne 0 ]; then
      WT_FAIL_STEP="sparse-set"
    elif ! git -C "$WT" sparse-checkout list >"$WORK/sparse-$sid.got" 2>/dev/null; then
      WT_FAIL_STEP="sparse-verify"
    elif ! cmp -s "$WORK/sparse-$sid.txt" "$WORK/sparse-$sid.got"; then
      WT_FAIL_STEP="sparse-verify"
    else
      set +e
      git -C "$WT" read-tree -mu HEAD >/dev/null 2>&1
      rt_st=$?
      set -e
      if [ "$rt_st" -ne 0 ]; then
        WT_FAIL_STEP="materialize"
      else
        while IFS= read -r pe; do
          [ -n "$pe" ] || continue
          if [ -e "$WT/$pe" ]; then
            WT_FAIL_STEP="excluded-present:$pe"
            break
          fi
        done < "$POLICY_ENTRIES"
        if [ -z "$WT_FAIL_STEP" ]; then WT_OK=1; fi
      fi
    fi
  fi
  if [ -z "$WT_OK" ]; then
    add_problem "policy_setup_failed" "$TID: $WT_FAIL_STEP"
    git worktree remove --force "$WT" >/dev/null 2>&1 || true
    git worktree prune >/dev/null 2>&1 || true
    rm -rf "$WT" || true
    printf '1' > "$TESTSTATUS/$sid.setup_failed"
    printf '0' > "$TESTSTATUS/$sid.prep_failed"
    printf '1' > "$TESTSTATUS/$sid.base_exit"
    WORK="$WORK" TESTSTATUS="$TESTSTATUS" PROBLEMS="$PROBLEMS" TID="$TID" TCMD="$TCMD" REPORT="$REPORT" SID="$sid" WEAKENED="$WEAKENED" classify_cases
  else
    # copy the test's files from the working tree
    n=0
    while [ "$n" -lt "${TFILES_N:-0}" ]; do
      eval "f=\$TFILE_$n"
      if [ -e "$ROOT/$f" ]; then
        mkdir -p "$WT/$(dirname "$f")"
        cp "$ROOT/$f" "$WT/$f"
      fi
      n=$((n + 1))
    done
    if [ -n "$PREPARE" ]; then
      set +e
      (cd "$WT" && sh -c "$PREPARE" >>"$TESTLOGS/$sid.base.log" 2>&1)
      prep_st=$?
      set -e
    else
      prep_st=0
    fi
    if [ -n "$PREPARE" ] && [ "$prep_st" -ne 0 ]; then
      printf '1' > "$TESTSTATUS/$sid.prep_failed"
    else
      printf '0' > "$TESTSTATUS/$sid.prep_failed"
    fi
    if [ "$(cat "$TESTSTATUS/$sid.prep_failed")" = "1" ]; then
      base_st=1
    else
      BASEREP=""
      if [ "$REPORT" = "vitest-json" ]; then BASEREP="$(mktemp "${TMPDIR:-/tmp}/muse-cases-XXXXXX")"; fi
      set +e
      if [ -n "$BASEREP" ]; then
        (cd "$WT" && MUSE_CASE_REPORT="$BASEREP" timeout "$TTIMEOUT" sh -c "$TCMD" >>"$TESTLOGS/$sid.base.log" 2>&1)
        base_st=$?
      else
        (cd "$WT" && env -u MUSE_CASE_REPORT timeout "$TTIMEOUT" sh -c "$TCMD" >>"$TESTLOGS/$sid.base.log" 2>&1)
        base_st=$?
      fi
      set -e
      if [ -n "$BASEREP" ]; then
        cp "$BASEREP" "$WORK/report-$sid.base.json" 2>/dev/null || true
        rm -f "$BASEREP"
      fi
    fi
    printf '%s' "$base_st" > "$TESTSTATUS/$sid.base_exit"
    CASES_JSON="$WORK/cases-$sid.json" MODE="$REPORT" LOG="$TESTLOGS/$sid.base.log" REPJSON="$WORK/report-$sid.base.json" OUT="$WORK/parsed-$sid.base.json" parse_cases
    printf '0' > "$TESTSTATUS/$sid.setup_failed"
    WORK="$WORK" TESTSTATUS="$TESTSTATUS" PROBLEMS="$PROBLEMS" TID="$TID" TCMD="$TCMD" REPORT="$REPORT" SID="$sid" WEAKENED="$WEAKENED" classify_cases
    git worktree remove --force "$WT" >/dev/null 2>&1 || true
    git worktree prune >/dev/null 2>&1 || true
    rm -rf "$WT" || true
  fi
  printf '%s\n' "$TID" >> "$WORK/tids.txt"
  i=$((i + 1))
done

# --- e) full suite ---
if [ "$FULL" -eq 1 ]; then
  set +e
  (pnpm -r test >"$TESTLOGS/full.log" 2>&1)
  full_st=$?
  set -e
  if [ "$full_st" -ne 0 ]; then add_problem "full_suite_failed" "$(tail -n 20 "$TESTLOGS/full.log")"; fi
fi

# --- emit ---
emit_json
if [ -s "$PROBLEMS" ]; then exit 1; else exit 0; fi
