#!/usr/bin/env bash
# Repeat check: run the given vitest files twice in services/bot and prove
# the runs are side-effect free. MUSE_STATE_FILE / MUSE_COST_LOG_FILE point
# at a test-owned mirror dir preseeded at the daily cap (same DailyState
# shape costGuard.ts reads: {"date","calls","spendUsd"} with today's UTC
# date key, count 50 with MUSE_MAX_CALLS_PER_DAY=50); cost.jsonl holds one
# line. Mirror sha256 must be identical before/after every run, each run
# must pass, and no entries may survive in the test temp root afterwards.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../services/bot"

mirror=$(mktemp -d)
tmproot=$(mktemp -d)
# Node 22 writes its compile cache into TMPDIR by default, which would trip
# the empty-temp-root check below. Keep that cache in a sibling dir outside
# the checked root, and disable it outright where supported. The check
# itself still refuses every entry left in the temp root.
cachehome=$(mktemp -d)
cleanup() {
  rm -rf "$mirror" "$tmproot" "$cachehome"
}
trap cleanup EXIT

today=$(date -u +%F)
printf '{"date":"%s","calls":50,"spendUsd":0}\n' "$today" > "$mirror/state.json"
printf '{"seed":"repeat-check"}\n' > "$mirror/cost.jsonl"

export MUSE_STATE_FILE="$mirror/state.json"
export MUSE_COST_LOG_FILE="$mirror/cost.jsonl"
export MUSE_MAX_CALLS_PER_DAY=50
export TMPDIR="$tmproot" TMP="$tmproot" TEMP="$tmproot"
export NODE_COMPILE_CACHE="$cachehome/node-compile-cache"
export NODE_DISABLE_COMPILE_CACHE=1
mkdir -p "$NODE_COMPILE_CACHE"

state_before=$(sha256sum "$mirror/state.json" | cut -d" " -f1)
cost_before=$(sha256sum "$mirror/cost.jsonl" | cut -d" " -f1)

check_clean() {
  [ "$(sha256sum "$mirror/state.json" | cut -d" " -f1)" = "$state_before" ]
  [ "$(sha256sum "$mirror/cost.jsonl" | cut -d" " -f1)" = "$cost_before" ]
  [ -z "$(ls -A "$tmproot")" ]
}

for _ in 1 2; do
  pnpm exec vitest run "$@"
  check_clean
done
echo "repeat check ok"
