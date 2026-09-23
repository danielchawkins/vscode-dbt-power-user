#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: fetch-host.sh [vscode|cursor|all] [--force]" >&2
}

smoke_root=$(cd "$(dirname "$0")" && pwd)
host=${1:-all}
force=${2:-}
if [[ -n "$force" && "$force" != "--force" ]]; then
  usage
  exit 2
fi

case "$host" in
  vscode)
    "$smoke_root/fetch-vscode.sh" "$force"
    ;;
  cursor)
    "$smoke_root/fetch-cursor.sh" "$force"
    ;;
  all)
    "$smoke_root/fetch-vscode.sh" "$force"
    "$smoke_root/fetch-cursor.sh" "$force"
    ;;
  *)
    usage
    exit 2
    ;;
esac
