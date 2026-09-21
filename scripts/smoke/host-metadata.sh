#!/usr/bin/env bash
set -euo pipefail

smoke_root=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=scripts/smoke/common.sh
source "$smoke_root/common.sh"

host=${1:?usage: host-metadata.sh <vscode|cursor>}
cli=$(host_cli "$host")
product=$(host_product_json "$host")
if [[ ! -x "$cli" ]]; then
  echo "Host binary missing: $cli" >&2
  exit 1
fi

python3 - "$cli" "$product" "$host" << 'PY'
import json, subprocess, sys
cli, product_path, host = sys.argv[1:4]
product = json.load(open(product_path))
lines = subprocess.check_output([cli, "--version"], text=True).splitlines()
payload = {
    "host": host,
    "productVersion": product.get("version"),
    "commit": product.get("commit") or (lines[1] if len(lines) > 1 else None),
    "vscodeVersion": product.get("vscodeVersion") or product.get("version"),
    "quality": product.get("quality", "stable"),
    "date": product.get("date"),
}
print("FPU_HOST_METADATA=" + json.dumps(payload))
PY
