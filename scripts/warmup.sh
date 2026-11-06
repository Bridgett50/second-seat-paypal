#!/usr/bin/env bash
# Warm up the live path before a recording: wake the Glimmer vLLM container
# on Modal (cold start can take many minutes while weights load) and send
# Spark one tiny request. Made-up text only; never real meeting data.
#
# Needs: GLIMMER_BASE_URL (the deployed Modal web endpoint) and META_API_KEY
# in the environment. The key is sent only in the Authorization header and is
# never echoed; curl runs without -v so headers are not printed.
#
# Cost: this wakes an A100-80GB that stays up for the 300 s scaledown window
# after the last request, and makes one Spark call with max 16 output tokens.
#
# Usage: scripts/warmup.sh            (both)
#        scripts/warmup.sh glimmer    (Glimmer only)
#        scripts/warmup.sh spark      (Spark only)
set -euo pipefail

target="${1:-all}"
: "${GLIMMER_WARMUP_TIMEOUT_S:=1500}"   # matches the Modal startup_timeout
GLIMMER_MODEL="meta-models/Muse-Glimmer-30B"
SPARK_MODEL="muse-spark-1.3"
SPARK_URL="https://api.meta.ai/v1/chat/completions"

need() {
  if [ -z "${!1:-}" ]; then
    echo "warmup: $1 is not set" >&2
    exit 2
  fi
}

warm_glimmer() {
  need GLIMMER_BASE_URL
  local base="${GLIMMER_BASE_URL%/}"
  local deadline=$(( $(date +%s) + GLIMMER_WARMUP_TIMEOUT_S ))
  echo "warmup: waiting for Glimmer /health (up to ${GLIMMER_WARMUP_TIMEOUT_S}s)…"
  until curl -fsS -o /dev/null --max-time 30 "$base/health"; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "warmup: Glimmer did not become healthy in time" >&2
      return 1
    fi
    sleep 10
  done
  echo "warmup: Glimmer healthy; sending one tiny redaction request"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 120 \
    -H 'content-type: application/json' \
    "$base/v1/chat/completions" \
    -d "{\"model\":\"$GLIMMER_MODEL\",\"temperature\":0,\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"Mask names: Hi, this is Pat Example.\"}]}")
  echo "warmup: Glimmer chat HTTP $code"
  [ "$code" = "200" ]
}

warm_spark() {
  need META_API_KEY
  echo "warmup: sending Spark one tiny request"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 60 \
    -H 'content-type: application/json' \
    -H @<(printf 'authorization: Bearer %s\n' "$META_API_KEY") \
    "$SPARK_URL" \
    -d "{\"model\":\"$SPARK_MODEL\",\"max_completion_tokens\":16,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK.\"}]}")
  echo "warmup: Spark HTTP $code"
  [ "$code" = "200" ]
}

case "$target" in
  glimmer) warm_glimmer ;;
  spark) warm_spark ;;
  all) warm_glimmer && warm_spark ;;
  *) echo "usage: $0 [all|glimmer|spark]" >&2; exit 2 ;;
esac
echo "warmup: done"
