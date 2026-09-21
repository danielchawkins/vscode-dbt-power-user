#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
# shellcheck source=scripts/benchmark/common.sh
source "$root/scripts/benchmark/common.sh"

# One warmup per target, then median of three measured samples. npm/Vite caches
# are left in place between samples so the numbers reflect incremental rebuilds.
elapsed_ms() {
  python3 - "$@" << 'PY'
import subprocess
import sys
import time

start = time.perf_counter()
subprocess.run(sys.argv[1:], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(int((time.perf_counter() - start) * 1000))
PY
}

measure_webview_build() {
  elapsed_ms npm run build --prefix "$root/webview_panels"
}

measure_host_build() {
  elapsed_ms npm run build --prefix "$root"
}

measure_package() {
  local vsix
  vsix=$(elapsed_ms npm run package:vsix --prefix "$root")
  rm -f "$root"/fusion-power-user-*.vsix
  echo "$vsix"
}

measure_webview_build > /dev/null
measure_host_build > /dev/null
measure_package > /dev/null

echo "webview_build_ms=$(median_ms_of_three measure_webview_build)"
echo "host_build_ms=$(median_ms_of_three measure_host_build)"
echo "package_ms_median=$(median_ms_of_three measure_package)"
echo "package_ms_note=includes_prepublish_webview_and_host_builds"
