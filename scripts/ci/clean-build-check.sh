#!/usr/bin/env bash
# Clean rebuild + smoke the built web server from the repo root.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

rm -rf packages/*/dist services/*/dist apps/*/dist
pnpm -r build

test -f apps/web/dist/src/build.js
test -f apps/web/dist/src/server.js

PORT="${PORT:-4199}"
SECOND_SEAT_TEST_MODE=1 PORT="$PORT" node apps/web/dist/src/server.js &
server_pid=$!
cleanup() {
  kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT

body_file=$(mktemp)
trap 'rm -f "$body_file"; cleanup' EXIT
code=""
deadline=$((SECONDS + 20))
while [ "$SECONDS" -lt "$deadline" ]; do
  if code=$(curl -s -o "$body_file" -w "%{http_code}" "http://127.0.0.1:$PORT/briefs/demo"); then
    if [ "$code" = "200" ]; then
      break
    fi
  fi
  sleep 0.5
done
[ "$code" = "200" ]
grep -q "Second Seat" "$body_file"
echo "clean build ok"
