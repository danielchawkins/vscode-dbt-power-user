#!/usr/bin/env bash
set -euo pipefail

median() {
  python3 - "$@" << 'PY'
import sys

values = sorted(float(v) for v in sys.argv[1:])
if not values:
    print("0")
    raise SystemExit(0)
mid = len(values) // 2
if len(values) % 2:
    print(values[mid])
else:
    print((values[mid - 1] + values[mid]) / 2)
PY
}

median_ms_of_three() {
  local -a samples=()
  local sample
  for _ in 1 2 3; do
    sample=$("$@")
    samples+=("$sample")
  done
  median "${samples[@]}"
}

file_bytes() {
  wc -c < "$1" | tr -d ' '
}

gzip_bytes() {
  gzip -c "$1" | wc -c | tr -d ' '
}

machine_metadata() {
  local root=${1:-}
  echo "date=$(date +%F)"
  echo "node=$(node --version)"
  echo "npm=$(npm --version)"
  echo "just=$(just --version)"
  echo "macos=$(sw_vers -productVersion 2> /dev/null || true)"
  echo "machine=$(sysctl -n hw.model 2> /dev/null || true)"
  echo "cpu=$(sysctl -n hw.ncpu 2> /dev/null || true)"
  echo "memory_bytes=$(sysctl -n hw.memsize 2> /dev/null || true)"
  if [[ -n "$root" ]]; then
    if command -v jj > /dev/null 2>&1; then
      echo "revision=$(jj log -r @ -T 'change_id.short()' --no-graph 2> /dev/null || true)"
    else
      echo "revision=$(git -C "$root" rev-parse HEAD 2> /dev/null || true)"
    fi
  fi
}
