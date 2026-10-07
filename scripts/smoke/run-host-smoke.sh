#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat << 'EOF'
usage: run-host-smoke.sh --host <vscode|cursor> [--vsix PATH] [--fixture PATH] [--force]

Install the packaged VSIX into a disposable profile and run panel smoke tests.
Unless --fixture is given, also runs the multi-root Fusion LSP smoke suite once,
skipped when FPU_RUNTIME_BENCHMARK=1 selects the tight single-fixture timing loop.

--force re-acquires the pinned host even if a cached copy already verifies.
EOF
}

smoke_root=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$smoke_root/../.." && pwd)
# shellcheck source=scripts/smoke/common.sh
source "$smoke_root/common.sh"

host=""
vsix=""
fixture=""
force=0
original_args=("$@")
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
    --force)
      force=1
      shift
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

# Electron needs a display; a headless Linux run gets a virtual one.
if [[ "$smoke_platform" == linux-arm64 && -z "${DISPLAY:-}" ]]; then
  if ! command -v xvfb-run > /dev/null; then
    echo "Linux smoke needs DISPLAY or xvfb-run" >&2
    exit 1
  fi
  exec xvfb-run -a -s "-screen 0 1920x1080x24" "$0" "${original_args[@]}"
fi
if [[ "$force" -eq 1 ]]; then
  "$smoke_root/fetch-host.sh" "$host" --force
else
  "$smoke_root/fetch-host.sh" "$host"
fi
executable=$(host_executable "$host")
if [[ -z "$vsix" ]]; then
  # A local run always smokes the working copy; CI passes the checksum-verified artifact with --vsix.
  (cd "$repo_root" && just package)
  vsix=$(cat "$repo_root/out/latest-vsix")
fi
if [[ ! -f "$vsix" ]]; then
  echo "VSIX not found: $vsix" >&2
  exit 1
fi
vsix=$(realpath "$vsix")
echo "FPU_SMOKE_VSIX=$vsix sha256=$(sha256_file "$vsix")"
if [[ -n "${FPU_SMOKE_SCREENSHOTS:-}" ]]; then
  mkdir -p "$FPU_SMOKE_SCREENSHOTS"
  echo "$(sha256_file "$vsix")  $vsix" > "$FPU_SMOKE_SCREENSHOTS/vsix.sha256"
fi

echo "# host metadata ($host)"
"$smoke_root/host-metadata.sh" "$host"
echo

run_fixture() {
  node "$smoke_root/run-smoke.mjs" \
    --host "$host" \
    --host-app "$executable" \
    --vsix "$vsix" \
    --fixture "$1"
}

if [[ -n "$fixture" ]]; then
  run_fixture "$fixture"
else
  run_fixture "$repo_root/src/test/fixtures/single-project"
  if [[ "${FPU_RUNTIME_BENCHMARK:-}" != "1" ]]; then
    export FPU_SKIP_INTEGRATION_COMPILE=1
    run_fixture "$repo_root/src/test/fixtures/multi-root"
  fi
fi
