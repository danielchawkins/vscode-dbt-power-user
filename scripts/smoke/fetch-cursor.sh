#!/usr/bin/env bash
set -euo pipefail

smoke_root=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=scripts/smoke/common.sh
source "$smoke_root/common.sh"

force=0
case "${1:-}" in
  --force)
    force=1
    ;;
  "") ;;
  *)
    echo "usage: fetch-cursor.sh [--force]" >&2
    exit 2
    ;;
esac

dest="$cache_root/cursor-${FPU_CURSOR_VERSION}-${FPU_CURSOR_PLATFORM}"
cli=$(host_cli cursor)
verify_cached_cursor() {
  python3 - "$(host_product_json cursor)" "$FPU_CURSOR_VERSION" "$FPU_CURSOR_PRODUCT_COMMIT" "$FPU_VSCODE_VERSION" << 'PY'
import json, sys
path, expected_version, expected_commit, expected_vscode_version = sys.argv[1:5]
product = json.load(open(path))
actual = (product.get("version"), product.get("commit"), product.get("vscodeVersion"))
expected = (expected_version, expected_commit, expected_vscode_version)
if actual != expected:
    raise SystemExit(f"Cached Cursor metadata mismatch: expected {expected}, got {actual}")
PY
}

if [[ "$force" -eq 0 ]] && [[ -x "$cli" ]] && verify_cached_cursor; then
  echo "Cursor ${FPU_CURSOR_VERSION} already cached at $dest"
  exit 0
fi

mkdir -p "$cache_root"
dmg="$cache_root/cursor-${FPU_CURSOR_VERSION}.dmg"
curl -fsSL --retry 3 --retry-all-errors --max-time 1800 \
  -A "FusionPowerUserHostFetch/1.0" \
  "$FPU_CURSOR_DOWNLOAD_URL" \
  -o "$dmg"
verify_sha256 "$dmg" "$FPU_CURSOR_SHA256"

mount=$(attach_dmg "$dmg")
trap 'hdiutil detach "$mount" -quiet 2>/dev/null || true; rm -f "$dmg"' EXIT
app_src=$(find "$mount" -maxdepth 2 -name 'Cursor.app' -print | head -1)
if [[ -z "$app_src" ]]; then
  echo "Cursor.app not found under $mount" >&2
  exit 1
fi
rm -rf "$dest"
mkdir -p "$dest"
ditto "$app_src" "$dest/Cursor.app"
hdiutil detach "$mount" -quiet
rm -f "$dmg"
verify_cached_cursor
echo "Cached Cursor ${FPU_CURSOR_VERSION} at $dest"
