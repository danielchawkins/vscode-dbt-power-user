#!/usr/bin/env bash
set -euo pipefail

smoke_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# shellcheck disable=SC1091
source "$smoke_root/pins.env"

# FPU_SMOKE_PLATFORM forces a platform so another OS can exercise fetch and verification only.
case "${FPU_SMOKE_PLATFORM:-$(uname -s)-$(uname -m)}" in
  Darwin-arm64 | darwin-arm64)
    smoke_platform=darwin-arm64
    cache_root=${FPU_HOST_CACHE:-${XDG_CACHE_HOME:-$HOME/Library/Caches}/fusion-power-user/hosts}
    ;;
  Linux-aarch64 | linux-arm64)
    smoke_platform=linux-arm64
    cache_root=${FPU_HOST_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/fusion-power-user/hosts}
    FPU_VSCODE_PLATFORM=$FPU_VSCODE_LINUX_PLATFORM
    FPU_CURSOR_PLATFORM=$FPU_CURSOR_LINUX_PLATFORM
    ;;
  *)
    echo "Pinned host smoke requires Darwin arm64 or Linux arm64" >&2
    exit 1
    ;;
esac

sha256_file() {
  if command -v shasum > /dev/null; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
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
  if [[ "$smoke_platform" == linux-arm64 ]]; then
    echo "$cache_root/vscode-${FPU_VSCODE_VERSION}-${FPU_VSCODE_PLATFORM}/VSCode-linux-arm64"
  else
    echo "$cache_root/vscode-${FPU_VSCODE_VERSION}-${FPU_VSCODE_PLATFORM}/Visual Studio Code.app"
  fi
}

cursor_app_dir() {
  if [[ "$smoke_platform" == linux-arm64 ]]; then
    echo "$cache_root/cursor-${FPU_CURSOR_VERSION}-${FPU_CURSOR_PLATFORM}/usr/share/cursor"
  else
    echo "$cache_root/cursor-${FPU_CURSOR_VERSION}-${FPU_CURSOR_PLATFORM}/Cursor.app"
  fi
}

# The resources/app directory inside an app dir.
app_resources_dir() {
  if [[ "$smoke_platform" == linux-arm64 ]]; then
    echo "$1/resources/app"
  else
    echo "$1/Contents/Resources/app"
  fi
}

# The directory holding the CLI launchers; it sits beside resources/ on Linux, inside it on macOS.
app_bin_dir() {
  if [[ "$smoke_platform" == linux-arm64 ]]; then
    echo "$1/bin"
  else
    echo "$1/Contents/Resources/app/bin"
  fi
}

# A macOS app's executable, named by CFBundleExecutable (VS Code 1.141 renamed Electron to Code).
bundle_executable() {
  local app=$1 name
  name=$(plutil -extract CFBundleExecutable raw -o - "$app/Contents/Info.plist")
  echo "$app/Contents/MacOS/$name"
}

host_executable() {
  local host=$1
  case "$host" in
    vscode)
      if [[ "$smoke_platform" == linux-arm64 ]]; then
        echo "$(vscode_app_dir)/code"
      else
        bundle_executable "$(vscode_app_dir)"
      fi
      ;;
    cursor)
      if [[ "$smoke_platform" == linux-arm64 ]]; then
        echo "$(cursor_app_dir)/cursor"
      else
        bundle_executable "$(cursor_app_dir)"
      fi
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
      echo "$(app_bin_dir "$(vscode_app_dir)")/code"
      ;;
    cursor)
      echo "$(app_bin_dir "$(cursor_app_dir)")/cursor"
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
      echo "$(app_resources_dir "$(vscode_app_dir)")/product.json"
      ;;
    cursor)
      echo "$(app_resources_dir "$(cursor_app_dir)")/product.json"
      ;;
  esac
}
