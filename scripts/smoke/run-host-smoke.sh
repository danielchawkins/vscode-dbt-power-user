#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat << 'EOF'
usage: run-host-smoke.sh --host <vscode|cursor> [--vsix PATH] [--fixture PATH]

Install the packaged VSIX into a disposable profile and run panel smoke tests.
EOF
}

smoke_root=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$smoke_root/../.." && pwd)
# shellcheck source=scripts/smoke/common.sh
source "$smoke_root/common.sh"

host=""
vsix=""
fixture="$repo_root/src/test/fixtures/single-project"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      host=$2
      shift 2
      ;;
    --vsix)
      vsix=$2
      shift 2
      ;;
    --fixture)
      fixture=$2
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$host" ]]; then
  usage
  exit 2
fi

"$smoke_root/fetch-host.sh" "$host"
executable=$(host_executable "$host")
if [[ -z "$vsix" ]]; then
  vsix=$(find "$repo_root" -maxdepth 1 -name '*.vsix' -print | head -1)
fi
if [[ ! -f "$vsix" ]]; then
  echo "VSIX not found; run just package first" >&2
  exit 1
fi

echo "# host metadata ($host)"
"$smoke_root/host-metadata.sh" "$host"
echo

node "$smoke_root/run-smoke.mjs" \
  --host "$host" \
  --host-app "$executable" \
  --vsix "$vsix" \
  --fixture "$fixture"
