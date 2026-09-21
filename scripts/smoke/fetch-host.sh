#!/usr/bin/env bash
set -euo pipefail

smoke_root=$(cd "$(dirname "$0")" && pwd)
host=${1:-all}
case "$host" in
  vscode)
    "$smoke_root/fetch-vscode.sh"
    ;;
  cursor)
    "$smoke_root/fetch-cursor.sh"
    ;;
  all)
    "$smoke_root/fetch-vscode.sh"
    "$smoke_root/fetch-cursor.sh"
    ;;
  *)
    echo "usage: fetch-host.sh [vscode|cursor|all]" >&2
    exit 2
    ;;
esac
