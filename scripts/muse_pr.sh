#!/usr/bin/env bash
# muse_pr.sh --task task.txt --scope "a b c" --criteria crit.json
#            --evidence evidence/NAME [--steps 60] [--effort medium] [--attempts 1]
# Runs one muse session, verifies, exports evidence. One attempt by default:
# no automatic retry (each retry is a paid call). --attempts N (1-3) opts in.
# Backend: MUSE_BACKEND=meta (default) or MUSE_BACKEND=baseten (opt-in). Baseten
# uses meta-models/muse-spark-open-1026 via https://inference.baseten.co/v1 with
# web tools disabled; BASETEN_API_KEY is exported as META_API_KEY only inside the
# muse subshell and is never printed.
set -u

TASK=""; SCOPE=""; CRITERIA=""; EVID=""; STEPS=60; EFFORT="medium"; ATTEMPTS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK="${2:-}"; shift 2;;
    --scope) SCOPE="${2:-}"; shift 2;;
    --criteria) CRITERIA="${2:-}"; shift 2;;
    --evidence) EVID="${2:-}"; shift 2;;
    --steps) STEPS="${2:-60}"; shift 2;;
    --effort) EFFORT="${2:-medium}"; shift 2;;
    --attempts) ATTEMPTS="${2:-1}"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
if [ -z "$TASK" ] || [ -z "$SCOPE" ] || [ -z "$CRITERIA" ] || [ -z "$EVID" ]; then
  echo "usage: muse_pr.sh --task task.txt --scope \"a b c\" --criteria crit.json --evidence evidence/NAME [--steps 60] [--effort medium] [--attempts 1]" >&2
  exit 2
fi
case "$ATTEMPTS" in
  1|2|3) ;;
  *) echo "--attempts must be 1, 2 or 3" >&2; exit 2;;
esac

MUSE_BACKEND="${MUSE_BACKEND:-meta}"
case "$MUSE_BACKEND" in
  meta) BACKEND_ARGS=(--model muse-spark-1.3);;
  baseten) BACKEND_ARGS=(--model meta-models/muse-spark-open-1026
      -c 'endpoint_transport.base_url="https://inference.baseten.co/v1"'
      -c 'endpoint_transport.auth="bearer"' --disable-web-tools);;
  *) echo "MUSE_BACKEND must be meta or baseten" >&2; exit 2;;
esac

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
if [ ! -f .agents/AGENTS.md ]; then
  echo "missing .agents/AGENTS.md" >&2
  exit 2
fi
mkdir -p .muse "$EVID"

printf '%s\n' $SCOPE > .muse/scope.txt
cp "$CRITERIA" .muse/criteria.json

UUID="$(python3 -c 'import uuid; print(uuid.uuid4())')"

attempt=1
run_agent() {
  # $1 = prompt file or empty; $2 = inline prompt or empty; $3 = output jsonl
  local src
  if [ -n "$1" ]; then src=(--prompt-file "$1"); else src=("$2"); fi
  (
    if [ "$MUSE_BACKEND" = baseten ]; then
      if [ -z "${BASETEN_API_KEY:-}" ]; then echo "BASETEN_API_KEY not set" >&2; exit 2; fi
      export META_API_KEY="$BASETEN_API_KEY"
    fi
    muse exec "${BACKEND_ARGS[@]}" --contributor-mode off \
      --reasoning-effort "$EFFORT" --max-model-steps "$STEPS" \
      --disable-approval --sandbox-network restricted --trust-workspace \
      --json --session-id "$UUID" "${src[@]}" > "$3"
  )
}

FIRST_PROMPT="$(mktemp)"
cat .agents/AGENTS.md > "$FIRST_PROMPT"
printf '\n---\n' >> "$FIRST_PROMPT"
cat "$TASK" >> "$FIRST_PROMPT"

run_agent "$FIRST_PROMPT" "" "$EVID/session-1.jsonl"
rm -f "$FIRST_PROMPT"
VERIFY_OUT="$EVID/verify-1" bash .muse/verify_pr.sh >"$EVID/verify-1.json" 2>"$EVID/verify-1.err"
if [ $? -eq 0 ]; then passed=true; else passed=false; fi

while [ "$passed" = false ] && [ "$attempt" -lt "$ATTEMPTS" ]; do
  attempt=$((attempt + 1))
  probs="$(python3 -c 'import json; print(json.dumps(json.load(open("'"$EVID/verify-$((attempt - 1)).json"'")).get("problems", [])))' 2>/dev/null || echo '[]')"
  retry_text="Fix only these problems, changing nothing else: $probs"
  combined="$(cat .agents/AGENTS.md; printf '\n---\n%s' "$retry_text")"
  run_agent "" "$combined" "$EVID/session-$attempt.jsonl"
  VERIFY_OUT="$EVID/verify-$attempt" bash .muse/verify_pr.sh >"$EVID/verify-$attempt.json" 2>"$EVID/verify-$attempt.err"
  if [ $? -eq 0 ]; then passed=true; fi
done

muse export --session "$UUID" --out "$EVID/session-export.json" 2>/dev/null || true
python3 - "$UUID" "$attempt" "$passed" "$EVID/summary.json" <<'EOF'
import json, sys
passed = sys.argv[3] == "true"
json.dump({"session": sys.argv[1], "attempts": int(sys.argv[2]),
           "passed": passed, "verify": "pass" if passed else "fail"},
          open(sys.argv[4], "w"))
EOF

if [ "$passed" = true ]; then exit 0; fi
echo "ESCALATE to Bridgett"
exit 1
