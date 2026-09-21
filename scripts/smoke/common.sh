#!/usr/bin/env bash
set -euo pipefail

smoke_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cache_root=${FPU_HOST_CACHE:-${XDG_CACHE_HOME:-$HOME/Library/Caches}/fusion-power-user/hosts}

# shellcheck disable=SC1091
source "$smoke_root/pins.env"

if [[ "$(uname -s)-$(uname -m)" != "Darwin-arm64" ]]; then
  echo "Pinned host smoke requires Darwin arm64" >&2
  exit 1
fi

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

verify_sha256() {
  local file=$1 expected=$2
  local actual
  actual=$(sha256_file "$file")
  if [[ "$actual" != "$expected" ]]; then
    echo "Checksum mismatch for $file: expected $expected, got $actual" >&2
    exit 1
  fi
}

attach_dmg() {
  hdiutil attach -nobrowse -readonly "$1" |
    awk '/\/Volumes\// {for (i = 3; i <= NF; i++) printf "%s%s", $i, (i < NF ? " " : ""); exit}'
}

vscode_app_dir() {
  echo "$cache_root/vscode-${FPU_VSCODE_VERSION}-${FPU_VSCODE_PLATFORM}/Visual Studio Code.app"
}

cursor_app_dir() {
  echo "$cache_root/cursor-${FPU_CURSOR_VERSION}-${FPU_CURSOR_PLATFORM}/Cursor.app"
}

host_executable() {
  local host=$1
  case "$host" in
    vscode)
      echo "$(vscode_app_dir)/Contents/MacOS/Electron"
      ;;
    cursor)
      echo "$(cursor_app_dir)/Contents/MacOS/Cursor"
      ;;
    *)
      echo "unknown host: $host" >&2
      return 1
      ;;
  esac
}

host_cli() {
  local host=$1
  case "$host" in
    vscode)
      echo "$(vscode_app_dir)/Contents/Resources/app/bin/code"
      ;;
    cursor)
      echo "$(cursor_app_dir)/Contents/Resources/app/bin/cursor"
      ;;
    *)
      echo "unknown host: $host" >&2
      return 1
      ;;
  esac
}

host_product_json() {
  local host=$1
  case "$host" in
    vscode)
      echo "$(vscode_app_dir)/Contents/Resources/app/product.json"
      ;;
    cursor)
      echo "$(cursor_app_dir)/Contents/Resources/app/product.json"
      ;;
  esac
}
