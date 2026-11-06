#!/usr/bin/env bash
# Secret scan over tracked files, excluding sealed data.
# Run from the repo root, or pass the repo dir as $1. Never reads sealed
# paths: git pathspec excludes are built from .sealed-paths, so sealed
# blobs are not even opened by git grep.
set -euo pipefail

cd "${1:-.}"

excludes=()
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ""|"#"*) continue ;;
  esac
  excludes+=(":(exclude)$line")
done < .sealed-paths
# The scan patterns live in this script (and in ci.yml), so both are
# excluded from their own scan.
excludes+=(":(exclude).github/workflows/ci.yml")
excludes+=(":(exclude)scripts/ci/secret-scan.sh")

matches=$(git grep -nE 's[k]-[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9._~+/-]*[a-z0-9][A-Za-z0-9._~+/-]{19,}|(MODEL|META)_API_KEY=['"'"']?[^'"'"'$[:space:]]{8,}' -- . "${excludes[@]}" || true)
if [ -n "$matches" ]; then
  echo "secret scan found possible secrets:" >&2
  echo "$matches" >&2
  exit 1
fi
if [ -f .env ]; then
  echo "secret scan found .env file" >&2
  exit 1
fi
echo "secret scan ok"
