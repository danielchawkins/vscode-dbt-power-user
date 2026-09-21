#!/usr/bin/env bash
set -euo pipefail

smoke_root=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=scripts/smoke/common.sh
source "$smoke_root/common.sh"

dest="$cache_root/vscode-${FPU_VSCODE_VERSION}-${FPU_VSCODE_PLATFORM}"
cli=$(host_cli vscode)
verify_cached_vscode() {
  python3 - "$(host_product_json vscode)" "$FPU_VSCODE_VERSION" "$FPU_VSCODE_COMMIT" << 'PY'
import json, sys
path, expected_version, expected_commit = sys.argv[1:4]
product = json.load(open(path))
actual = (product.get("version"), product.get("commit"))
expected = (expected_version, expected_commit)
if actual != expected:
    raise SystemExit(f"Cached VS Code metadata mismatch: expected {expected}, got {actual}")
PY
}

if [[ -x "$cli" ]] && verify_cached_vscode; then
  echo "VS Code ${FPU_VSCODE_VERSION} already cached at $dest"
  exit 0
fi

mkdir -p "$cache_root"
zip="$cache_root/vscode-${FPU_VSCODE_VERSION}.zip"
staging=$(mktemp -d "$cache_root/vscode-extract.XXXXXX")
trap 'rm -rf "$staging"; rm -f "$zip"' EXIT
meta=$(curl -fsSL --retry 3 --retry-all-errors --max-time 60 "$FPU_VSCODE_API")
url=$(node -e "console.log(JSON.parse(process.argv[1]).url)" "$meta")
expected=$(node -e "console.log(JSON.parse(process.argv[1]).sha256hash)" "$meta")
if [[ "$expected" != "$FPU_VSCODE_SHA256" ]]; then
  echo "VS Code API sha256hash ($expected) differs from pins.env ($FPU_VSCODE_SHA256)" >&2
  exit 1
fi

curl -fsSL --retry 3 --retry-all-errors --max-time 1800 "$url" -o "$zip"
verify_sha256 "$zip" "$FPU_VSCODE_SHA256"
rm -rf "$dest"
mkdir -p "$dest"
unzip -q "$zip" -d "$staging"
mv "$staging/Visual Studio Code.app" "$dest/Visual Studio Code.app"
verify_cached_vscode
echo "Cached VS Code ${FPU_VSCODE_VERSION} at $dest"
