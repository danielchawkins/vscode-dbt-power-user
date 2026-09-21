#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
# shellcheck source=scripts/benchmark/common.sh
source "$root/scripts/benchmark/common.sh"

js="$root/webview_panels/dist/assets/main.js"
css="$root/webview_panels/dist/assets/main.css"

for file in "$js" "$css"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing built asset: $file" >&2
    echo "Run: just webviews::build" >&2
    exit 1
  fi
done

printf 'main.js raw=%s gzip=%s\n' "$(file_bytes "$js")" "$(gzip_bytes "$js")"
printf 'main.css raw=%s gzip=%s\n' "$(file_bytes "$css")" "$(gzip_bytes "$css")"
