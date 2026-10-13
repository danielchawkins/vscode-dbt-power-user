#!/usr/bin/env bash
# Installs the pinned direnv executable into a directory: fetch-direnv.sh <install-dir>.
set -euo pipefail

smoke_root=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=scripts/smoke/common.sh
source "$smoke_root/common.sh"

if [[ $# -ne 1 ]]; then
  echo "usage: fetch-direnv.sh <install-dir>" >&2
  exit 2
fi
install_dir=$1

case "$smoke_platform" in
  darwin-arm64)
    url=$FPU_DIRENV_DARWIN_ARM64_URL
    expected=$FPU_DIRENV_DARWIN_ARM64_SHA256
    ;;
  linux-arm64)
    url=$FPU_DIRENV_LINUX_ARM64_URL
    expected=$FPU_DIRENV_LINUX_ARM64_SHA256
    ;;
esac

mkdir -p "$install_dir"
download=$(mktemp "${TMPDIR:-/tmp}/direnv.XXXXXX")
trap 'rm -f "$download"' EXIT
curl -fsSL --retry 3 --retry-all-errors --max-time 300 "$url" -o "$download"
verify_sha256 "$download" "$expected"
install -m 0755 "$download" "$install_dir/direnv"
"$install_dir/direnv" version
