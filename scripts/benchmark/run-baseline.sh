#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
# shellcheck source=scripts/benchmark/common.sh
source "$root/scripts/benchmark/common.sh"

echo "# machine"
machine_metadata "$root"
echo

echo "# build and package"
"$root/scripts/benchmark/measure-build.sh"
echo

echo "# webview payload"
"$root/scripts/benchmark/measure-payload.sh"
