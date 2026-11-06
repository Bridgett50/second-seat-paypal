#!/usr/bin/env bash
# .muse/guard.sh <pre|stop> — Muse Code hook enforcement.
# Bash + python3 stdlib only. Never prints env.
set -u

MODE="${1:-}"

# --- sealed-path matcher, shared logic with .muse/verify_pr.sh ---
# Builds a case-insensitive regex from .sealed-paths entries (escaped) plus
# heldout-sealed, holdout-v1, eval/heldout, \.sealed, (^|/)\.env.
sealed_regex() {
  # $1 = repo root; prints the regex on stdout
  python3 - "$1" <<'EOF'
import os, re, sys
root = sys.argv[1]
patterns = ["heldout-sealed", "holdout-v1", "eval/heldout", r"\.sealed", r"(^|[/\"'\s=:])\.env(?!\.example)"]
p = os.path.join(root, ".sealed-paths")
if os.path.exists(p):
    with open(p) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            patterns.append(re.escape(line))
print("|".join("(%s)" % s for s in patterns))
EOF
}

deny_pre() {
  # $1 = reason; prints PreToolUse deny JSON, exits 0
  python3 - "$1" <<'EOF'
import json, sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
  "permissionDecision": "deny", "permissionDecisionReason": sys.argv[1]}}))
EOF
  exit 0
}

guard_pre() {
  input="$(cat)"
  cwd="$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("cwd","") or "")')"
  if [ -z "$cwd" ] || [ ! -d "$cwd" ]; then cwd="$PWD"; fi
  root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || echo "$cwd")"
  regex="$(sealed_regex "$root")"

  # 1) sealed check: whole serialized tool_input, case-insensitive,
  #    also with backslashes turned into /.
  sealed_hit="$(printf '%s' "$input" | SEALED_REGEX="$regex" python3 -c '
import json, os, re, sys
raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    data = {}
blob = json.dumps(data.get("tool_input", data))
blob2 = blob.replace(chr(92), "/")
rx = re.compile(os.environ["SEALED_REGEX"], re.IGNORECASE)
print("yes" if rx.search(blob) or rx.search(blob2) else "no")
')"
  if [ "$sealed_hit" = "yes" ]; then
    deny_pre "sealed path: tool input references a sealed or heldout path"
  fi

  # 2) scope check for bash tool calls: a bash tool's tool_input.command can
  #    write anywhere (redirects, tee, sed -i, cp/mv/rm, git checkout, ...).
  # Limitation: this is a best-effort static check on the inspected command
  # text, not a sandbox. It cannot see paths built at runtime, commands
  # fetched over the network, or writes hidden behind unlisted binaries.
  is_bash="$(printf '%s' "$input" | python3 -c '
import json, re, sys
try:
    data = json.loads(sys.stdin.read())
except Exception:
    data = {}
name = data.get("tool_name", "") or ""
print("yes" if re.match(r"^(bash|shell|run_command|exec|terminal)$", name, re.IGNORECASE) else "no")
')"
  if [ "$is_bash" = "yes" ]; then
    verdict="$(ROOT="$root" SCOPE_FILE="$root/.muse/scope.txt" HOOK_INPUT="$input" python3 <<'EOF'
import json, os, re, shlex

raw = os.environ["HOOK_INPUT"]
try:
    data = json.loads(raw)
except Exception:
    data = {}
tool_input = data.get("tool_input", {})
cmd = ""
if isinstance(tool_input, dict):
    cmd = tool_input.get("command", "")
    if cmd == "" or cmd is None:
        cmd = tool_input.get("cmd", "")
if isinstance(cmd, list):
    cmd = " ".join(str(x) for x in cmd)
if not isinstance(cmd, str):
    cmd = ""
root = os.environ["ROOT"]
scope_file = os.environ.get("SCOPE_FILE", "") or os.path.join(root, ".muse", "scope.txt")
tmpdir = os.environ.get("TMPDIR", "") or "/tmp"

pats = []
noscope = not os.path.isfile(scope_file)
if not noscope:
    with open(scope_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            pats.append(line)

def bash_glob_match(pat, path):
    i, n, out = 0, len(pat), ""
    while i < n:
        c = pat[i]
        if c == "*":
            out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        elif c == "[":
            j = i + 1
            if j < n and pat[j] in "!^":
                j += 1
            if j < n and pat[j] == "]":
                j += 1
            while j < n and pat[j] != "]":
                j += 1
            if j < n:
                inner = pat[i+1:j]
                if inner[:1] in ("!", "^"):
                    inner = "^" + inner[1:]
                out += "[" + inner + "]"
                i = j
            else:
                out += re.escape(c)
        else:
            out += re.escape(c)
        i += 1
    return re.match(out + r"\Z", path) is not None

def under_tmp(abs_p):
    if abs_p == "/tmp" or abs_p.startswith("/tmp/"):
        return True
    td = tmpdir.rstrip("/") or "/"
    if td not in ("/", "/tmp") and (abs_p == td or abs_p.startswith(td + "/")):
        return True
    return False

problems = []

def check_target(t, base):
    if t in ("/dev/null", "/dev/stdout", "/dev/stderr", "-"):
        return None
    if re.match(r"^&\d+$", t) or t == "&-":
        return None
    if ("$" in t) or ("`" in t) or ("*" in t) or ("?" in t) or ("[" in t):
        if t == "/tmp" or t.startswith("/tmp/"):
            return None
        return "unresolvable write target: %s" % t
    norm = t.replace("\\", "/")
    if os.path.isabs(norm):
        abs_p = os.path.normpath(norm)
    else:
        abs_p = os.path.normpath(os.path.join(base, norm))
    if abs_p == root or abs_p.startswith(root + "/"):
        rel = os.path.relpath(abs_p, root)
        if noscope:
            return "out of scope: %s (bash writes denied without .muse/scope.txt)" % rel
        if not any(bash_glob_match(g, rel) for g in pats):
            return "out of scope: %s" % rel
        return None
    if under_tmp(abs_p):
        return None
    return "outside repo: %s" % t

def emit(t, base):
    p = check_target(t, base)
    if p is not None:
        problems.append(p)

def deny(reason):
    problems.append(reason)

OUT_OPS = {">", ">>", ">|", "&>", "&>>", ">&"}
OUT_RE = re.compile(r"^(\d*>>?|\d*>\||&>>?)$")
IN_OPS = {"<", "<<", "<<<"}
SEP = {";", "&&", "||", "|", "&"}

def is_out_op(t):
    return t in OUT_OPS or OUT_RE.match(t) is not None

def tokenize(line):
    try:
        lexer = shlex.shlex(line, posix=True, punctuation_chars=";|&><")
    except Exception:
        return []
    lexer.commenters = ""
    toks = []
    try:
        for t in lexer:
            toks.append(t)
    except ValueError:
        pass
    return toks

def split_segments(toks):
    segs, cur = [], []
    for t in toks:
        if t in SEP:
            if cur:
                segs.append(cur)
                cur = []
        else:
            cur.append(t)
    if cur:
        segs.append(cur)
    return segs

def split_lines(cmd):
    lines, cur = [], []
    q, esc = None, False
    for ch in cmd:
        if esc:
            cur.append(ch)
            esc = False
            continue
        if ch == "\\":
            cur.append(ch)
            esc = True
            continue
        if q:
            cur.append(ch)
            if ch == q:
                q = None
            continue
        if ch == "'" or ch == '"':
            q = ch
            cur.append(ch)
            continue
        if ch == "\n":
            lines.append("".join(cur))
            cur = []
            continue
        cur.append(ch)
    lines.append("".join(cur))
    return lines

def scan_redirects(seg, base):
    i, n = 0, len(seg)
    while i < n:
        t = seg[i]
        if re.match(r"^\d+$", t) and i + 1 < n and is_out_op(seg[i + 1]):
            op = seg[i + 1]
            j = i + 2
            if j >= n:
                deny("unresolvable write target: missing target")
                i = j
                continue
            tgt = seg[j]
            if tgt == "&":
                i = j + 2
                continue
            if op == ">&" and (re.match(r"^\d+-?$", tgt) or tgt == "-"):
                i = j + 1
                continue
            if tgt.startswith("&") and re.match(r"^&\d", tgt):
                i = j + 1
                continue
            emit(tgt, base)
            i = j + 1
            continue
        if is_out_op(t):
            j = i + 1
            if j >= n:
                deny("unresolvable write target: missing target")
                i = j
                continue
            tgt = seg[j]
            if tgt == "&":
                i = j + 2
                continue
            if t == ">&" and (re.match(r"^\d+-?$", tgt) or tgt == "-"):
                i = j + 1
                continue
            if tgt.startswith("&") and re.match(r"^&\d", tgt):
                i = j + 1
                continue
            emit(tgt, base)
            i = j + 1
            continue
        i += 1

def strip_redirects(argv):
    out = []
    i, n = 0, len(argv)
    while i < n:
        t = argv[i]
        if re.match(r"^\d+$", t) and i + 1 < n and (is_out_op(argv[i + 1]) or argv[i + 1] in IN_OPS):
            i += 2
            if i < n and argv[i] == "&":
                i += 2
            elif i < n:
                i += 1
            continue
        if is_out_op(t) or t in IN_OPS:
            i += 1
            if i < n and argv[i] == "&":
                i += 2
            elif i < n:
                i += 1
            continue
        out.append(t)
        i += 1
    return out

WRITER_NAMES = {"cp", "mv", "rm", "rmdir", "touch", "mkdir", "tee", "chmod",
                "truncate", "install", "ln", "dd", "patch", "git", "sed"}
SUSPECT_CODE = ("open(", "write", "writeFile", "unlink", "rename", "rmSync",
                "eval", "bash -c", "sh -c")
LIT_RE = re.compile(r"""['"]([^'"]+)['"]""")
PATHY_RE = re.compile(r"^[\w.\-]+\.[A-Za-z0-9]+$")

def flag_value(args, i):
    return args[i + 1] if i + 1 < len(args) else ""

def code_arg(argv):
    for k in range(1, len(argv)):
        if argv[k] in ("-c", "-e"):
            return flag_value(argv, k)
        if len(argv[k]) > 2 and not argv[k].startswith("--") and argv[k][:2] in ("-c", "-e"):
            return argv[k][2:]
    return ""

def check_code_literals(code, label, base):
    cands = [l for l in LIT_RE.findall(code) if "/" in l or PATHY_RE.match(l)]
    if not cands:
        deny("unscoped bash write: %s code may write (no scoped literal path)" % label)
        return
    for l in cands:
        if check_target(l, base) is not None:
            deny("unscoped bash write: %s code touches out-of-scope path: %s" % (label, l))
            return

def analyze_segment(seg, base, depth):
    scan_redirects(seg, base)
    argv = strip_redirects(seg)
    while argv and (argv[0] in ("!", "sudo", "command", "env")
                     or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=.*$", argv[0])):
        argv.pop(0)
    if not argv:
        return
    c0 = argv[0]
    if c0 == "cd":
        return
    if ("--help" in argv or "--version" in argv) and c0 in (
            "cp", "mv", "rm", "rmdir", "touch", "mkdir", "tee", "chmod",
            "truncate", "install", "ln", "dd", "find", "xargs", "sed"):
        return
    if c0 == "tee":
        for a in argv[1:]:
            if a == "--" or a == "-":
                continue
            if a.startswith("-") and len(a) > 1:
                continue
            emit(a, base)
        return
    if c0 == "sed":
        if not any(a == "-i" or a == "--in-place" or a.startswith("--in-place=")
                   or re.match(r"^-[a-zA-Z]*i(\..*)?$", a) for a in argv[1:]):
            return
        pos, i = [], 1
        while i < len(argv):
            a = argv[i]
            if a == "--":
                pos.extend(argv[i + 1:])
                break
            if a in ("-e", "--expression", "-f", "--file"):
                i += 2
                continue
            if a.startswith("--expression=") or a.startswith("--file="):
                i += 1
                continue
            if a.startswith("-") and len(a) > 1:
                i += 1
                continue
            pos.append(a)
            i += 1
        for f in pos[1:]:
            emit(f, base)
        return
    if c0 in ("cp", "mv", "install", "ln"):
        td, ops, i = None, [], 1
        while i < len(argv):
            a = argv[i]
            if a == "-t":
                td = flag_value(argv, i)
                i += 2
                continue
            if a.startswith("--target-directory="):
                td = a.split("=", 1)[1]
                i += 1
                continue
            if a == "--target-directory":
                td = flag_value(argv, i)
                i += 2
                continue
            if a == "--":
                ops.extend(argv[i + 1:])
                break
            if a.startswith("-") and len(a) > 1:
                i += 1
                continue
            ops.append(a)
            i += 1
        if td is not None:
            if td:
                emit(td, base)
            else:
                deny("unresolvable write target: -t (missing)")
        elif ops:
            emit(ops[-1], base)
        return
    if c0 in ("rm", "rmdir", "touch", "mkdir"):
        for a in argv[1:]:
            if a == "--":
                continue
            if a.startswith("-") and len(a) > 1:
                continue
            emit(a, base)
        return
    if c0 == "truncate":
        i = 1
        while i < len(argv):
            a = argv[i]
            if a in ("-s", "--size"):
                i += 2
                continue
            if a.startswith("--size="):
                i += 1
                continue
            if a == "--":
                i += 1
                continue
            if a.startswith("-") and len(a) > 1:
                i += 1
                continue
            emit(a, base)
            i += 1
        return
    if c0 == "chmod":
        i, mode_seen = 1, False
        while i < len(argv):
            a = argv[i]
            if a.startswith("--reference="):
                i += 1
                continue
            if a == "--reference":
                i += 2
                continue
            if a == "--":
                i += 1
                continue
            if a.startswith("-") and len(a) > 1:
                i += 1
                continue
            if not mode_seen:
                mode_seen = True
                i += 1
                continue
            emit(a, base)
            i += 1
        return
    if c0 == "git":
        i, sub, rest = 1, None, []
        while i < len(argv):
            a = argv[i]
            if a in ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix"):
                i += 2
                continue
            if a.startswith("--git-dir=") or a.startswith("--work-tree=") or a.startswith("--namespace="):
                i += 1
                continue
            if a.startswith("-") and len(a) > 1:
                i += 1
                continue
            sub, rest = a, argv[i + 1:]
            break
        if sub is None:
            return
        def git_paths(args):
            out, j = [], 0
            while j < len(args):
                a = args[j]
                if a == "--":
                    out.extend(args[j + 1:])
                    break
                if a in ("-b", "-B", "--branch"):
                    j += 2
                    continue
                if a.startswith("-") and len(a) > 1:
                    j += 1
                    continue
                out.append(a)
                j += 1
            return out
        if sub in ("checkout", "restore", "rm", "mv"):
            paths = git_paths(rest)
            if not paths:
                deny("unscoped git write: git %s with no paths" % sub)
            for p in paths:
                emit(p, base)
            return
        if sub == "apply":
            deny("unscoped git write: git apply (patched files unknown)")
            return
        if sub == "reset":
            if "--hard" in argv:
                deny("unscoped git write: git reset --hard")
            return
        if sub == "clean":
            paths = git_paths(rest)
            if not paths:
                deny("unscoped git write: git clean with no paths")
            for p in paths:
                emit(p, base)
            return
        return
    if c0 == "patch":
        deny("unscoped patch: target files unknown")
        return
    if c0 == "dd":
        for a in argv[1:]:
            if a.startswith("of="):
                v = a[3:]
                if v:
                    emit(v, base)
                else:
                    deny("unresolvable write target: dd of= (missing)")
        return
    if c0 == "find":
        if "-delete" in argv or "-exec" in argv or "-execdir" in argv:
            roots = []
            for a in argv[1:]:
                if a == "--":
                    continue
                if a in ("(", "!", ",") or a.startswith("-"):
                    break
                roots.append(a)
            if not roots:
                roots = ["."]
            for r in roots:
                if check_target(r, base) is not None:
                    deny("unscoped bash write: find -delete/-exec outside scope")
                    break
        return
    if c0 == "xargs":
        rest = [a for a in argv[1:] if a != "--"]
        if any(a in WRITER_NAMES for a in rest) or \
           (("bash" in rest or "sh" in rest) and "-c" in rest):
            deny("unscoped bash write: xargs feeding a writer")
        return
    if c0 in ("python", "python3", "node", "perl", "ruby"):
        code = code_arg(argv)
        if ("-c" in argv or "-e" in argv) and code:
            if any(s in code for s in SUSPECT_CODE):
                if ("bash -c" in code or "sh -c" in code) and depth < 1:
                    for m in LIT_RE.finditer(code):
                        analyze_command(m.group(1), base, depth + 1)
                check_code_literals(code, c0, base)
        return
    if c0 in ("bash", "sh", "dash", "zsh"):
        code = code_arg(argv)
        if "-c" in argv and code and depth < 1:
            analyze_command(code, base, depth + 1)
        elif "-c" in argv and code:
            check_code_literals(code, c0, base)
        return
    if c0 == "eval":
        if depth < 1 and len(argv) > 1:
            analyze_command(" ".join(argv[1:]), base, depth + 1)
        return

def analyze_command(cmd, base, depth):
    first, b = True, base
    for line in split_lines(cmd):
        for seg in split_segments(tokenize(line)):
            if first:
                first = False
                if seg and seg[0] == "cd" and len(seg) > 1 and seg[1] not in ("-", "--"):
                    scan_redirects(seg, b)
                    d = seg[1].replace("\\", "/")
                    if os.path.isabs(d):
                        b = os.path.normpath(d)
                    else:
                        b = os.path.normpath(os.path.join(b, d))
                    continue
            analyze_segment(seg, b, depth)

analyze_command(cmd, root, 0)
print("\n".join(problems))
EOF
)"
    if [ -n "$verdict" ]; then
      first="$(printf '%s' "$verdict" | head -n 1)"
      deny_pre "$first"
    fi
    exit 0
  fi

  # 3) scope check for edit tools only.
  is_edit="$(printf '%s' "$input" | python3 -c '
import json, re, sys
try:
    data = json.loads(sys.stdin.read())
except Exception:
    data = {}
name = data.get("tool_name", "") or ""
print("yes" if re.search(r"write|edit|patch|apply|create|delete|move|rename", name, re.IGNORECASE) else "no")
')"
  if [ "$is_edit" != "yes" ]; then exit 0; fi

  scope_file="$root/.muse/scope.txt"
  if [ ! -f "$scope_file" ]; then
    deny_pre "out of scope: .muse/scope.txt is missing, all edits denied"
  fi

  verdict="$(ROOT="$root" SCOPE_FILE="$scope_file" HOOK_INPUT="$input" python3 <<'EOF'
import json, os, re, sys, fnmatch

raw = os.environ["HOOK_INPUT"]
try:
    data = json.loads(raw)
except Exception:
    data = {}
tool_input = data.get("tool_input", {})
root = os.environ["ROOT"]

KEYS = {"path", "file_path", "filepath", "target", "old_path", "new_path"}
found = []

def walk(node):
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(k, str) and k.lower() in KEYS and isinstance(v, str) and v:
                found.append(v)
            else:
                walk(v)
    elif isinstance(node, list):
        for v in node:
            walk(v)
    elif isinstance(node, str):
        for m in re.finditer(r"\*\*\* (?:Add|Update|Delete) File: (\S+)", node):
            found.append(m.group(1))

walk(tool_input)
# also scan any stray strings for apply_patch bodies missed above
def walk_str(node):
    if isinstance(node, dict):
        for v in node.values():
            walk_str(v)
    elif isinstance(node, list):
        for v in node:
            walk_str(v)
walk_str(tool_input)

# load scope globs (# comments, blanks skipped)
pats = []
with open(os.environ["SCOPE_FILE"]) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        pats.append(line)

def bash_glob_match(pat, path):
    # translate bash glob (no globstar): * and ? do not cross /
    i, n, out = 0, len(pat), ""
    while i < n:
        c = pat[i]
        if c == "*":
            out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        elif c == "[":
            j = i + 1
            if j < n and pat[j] in "!^":
                j += 1
            if j < n and pat[j] == "]":
                j += 1
            while j < n and pat[j] != "]":
                j += 1
            if j < n:
                inner = pat[i+1:j]
                if inner[:1] in ("!", "^"):
                    inner = "^" + inner[1:]
                out += "[" + inner + "]"
                i = j
            else:
                out += re.escape(c)
        else:
            out += re.escape(c)
        i += 1
    return re.match(out + r"\Z", path) is not None

problems = []
for p in found:
    norm = p.replace("\\", "/")
    if os.path.isabs(norm):
        abs_p = os.path.normpath(norm)
    else:
        abs_p = os.path.normpath(os.path.join(root, norm))
    if abs_p != root and not abs_p.startswith(root + "/"):
        problems.append("outside repo: %s" % p)
        continue
    rel = os.path.relpath(abs_p, root)
    if not any(bash_glob_match(g, rel) for g in pats):
        problems.append("out of scope: %s" % rel)

print("\n".join(problems))
EOF
)"
  if [ -n "$verdict" ]; then
    first="$(printf '%s' "$verdict" | head -n 1)"
    deny_pre "$first"
  fi
  exit 0
}

guard_stop() {
  input="$(cat)"
  cwd="$(printf '%s' "$input" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("cwd","") or "")
except Exception: print("")')"
  if [ -z "$cwd" ] || [ ! -d "$cwd" ]; then cwd="$PWD"; fi
  root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || echo "$cwd")"
  if [ ! -f "$root/.muse/criteria.json" ]; then exit 0; fi

  session="$(printf '%s' "$input" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("session_id","") or "unknown")
except Exception: print("unknown")')"
  tmpdir="${TMPDIR:-/tmp}"
  counter="$tmpdir/muse-stop-$session"
  n=0
  if [ -f "$counter" ]; then n="$(cat "$counter" 2>/dev/null || echo 0)"; fi
  case "$n" in ''|*[!0-9]*) n=0;; esac
  if [ "$n" -ge 2 ]; then exit 0; fi

  out="$(cd "$root" && bash .muse/verify_pr.sh 2>/dev/null)"
  st=$?
  if [ "$st" -eq 0 ]; then exit 0; fi
  printf '%s' "$((n + 1))" > "$counter"
  printf '%s' "$out" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
try:
    probs = json.loads(raw).get("problems", [])
except Exception:
    probs = [{"code": "verify_failed", "detail": raw[-2000:]}]
print(json.dumps({"decision": "block", "reason": json.dumps(probs)}))'
  exit 0
}

case "$MODE" in
  pre) guard_pre;;
  stop) guard_stop;;
  *) echo "usage: .muse/guard.sh <pre|stop>" >&2; exit 2;;
esac
