#!/usr/bin/env bash
set -euo pipefail

# Resolves Cursor latest from the official API, verifies vscodeVersion 1.128.x,
# and rewrites scripts/smoke/pins.env. Run manually when advancing the Cursor pin.
smoke_root=$(cd "$(dirname "$0")" && pwd)
pins=$smoke_root/pins.env
# shellcheck source=scripts/smoke/common.sh
source "$smoke_root/common.sh"
platform=${FPU_CURSOR_PLATFORM:-darwin-arm64}

response=$(curl -fsSL --retry 3 --retry-all-errors --max-time 60 \
  "https://www.cursor.com/api/download?platform=${platform}&releaseTrack=latest")
version=$(node -e "
const d = JSON.parse(process.argv[1]);
if (!d.downloadUrl || !d.version || !d.commitSha) process.exit(2);
console.log(d.version);
" "$response")
archive_commit=$(node -e "console.log(JSON.parse(process.argv[1]).commitSha)" "$response")
url=$(node -e "console.log(JSON.parse(process.argv[1]).downloadUrl)" "$response")
expected_url="https://downloads.cursor.com/production/${archive_commit}/darwin/arm64/Cursor-darwin-arm64.dmg"
if [[ "$platform" != "darwin-arm64" || "$url" != "$expected_url" ]]; then
  echo "Refusing unexpected Cursor artifact URL for ${platform}: ${url}" >&2
  exit 1
fi

tmp_dmg=$(mktemp "${TMPDIR:-/tmp}/cursor-pin.XXXXXX.dmg")
trap 'rm -f "$tmp_dmg"' EXIT
curl -fsSL --retry 3 --retry-all-errors --max-time 1800 \
  -A "FusionPowerUserHostFetch/1.0" \
  "$url" \
  -o "$tmp_dmg"
sha256=$(shasum -a 256 "$tmp_dmg" | awk '{print $1}')

mount=$(attach_dmg "$tmp_dmg")
trap 'hdiutil detach "$mount" -quiet 2>/dev/null || true; rm -f "$tmp_dmg"' EXIT
read -r product_commit vscode_version < <(
  python3 - "$mount/Cursor.app/Contents/Resources/app/product.json" << 'PY'
import json, sys
product = json.load(open(sys.argv[1]))
print(product.get("commit", ""), product.get("vscodeVersion", ""))
PY
)

if [[ "$vscode_version" != "${FPU_VSCODE_VERSION%.*}."* ]]; then
  echo "Refusing pin: Cursor $version reports vscodeVersion=$vscode_version (need ${FPU_VSCODE_VERSION%.*}.x)" >&2
  exit 1
fi

# The Linux .deb is pinned to the same commit and version; hash it and confirm its product.json matches the darwin pins.
cursor_base="https://downloads.cursor.com/production/${archive_commit}"
linux_url="${cursor_base}/linux/arm64/deb/arm64/deb/cursor_${version}_arm64.deb"
tmp_deb=$(mktemp "${TMPDIR:-/tmp}/cursor-pin.XXXXXX.deb")
deb_dir=$(mktemp -d "${TMPDIR:-/tmp}/cursor-pin-deb.XXXXXX")
trap 'hdiutil detach "$mount" -quiet 2>/dev/null || true; rm -rf "$tmp_dmg" "$tmp_deb" "$deb_dir"' EXIT
curl -fsSL --retry 3 --retry-all-errors --max-time 1800 \
  -A "FusionPowerUserHostFetch/1.0" \
  "$linux_url" \
  -o "$tmp_deb"
linux_sha256=$(sha256_file "$tmp_deb")
(cd "$deb_dir" && ar x "$tmp_deb" && tar -xf data.tar.* ./usr/share/cursor/resources/app/product.json)
read -r linux_version linux_product_commit linux_vscode_version < <(
  python3 - "$deb_dir/usr/share/cursor/resources/app/product.json" << 'PY'
import json, sys
product = json.load(open(sys.argv[1]))
print(product.get("version", ""), product.get("commit", ""), product.get("vscodeVersion", ""))
PY
)
if [[ "$linux_product_commit" != "$product_commit" || "$linux_version" != "$version" ||
  "$linux_vscode_version" != "$vscode_version" ]]; then
  echo "Refusing pin: Linux .deb (version=$linux_version commit=$linux_product_commit" \
    "vscodeVersion=$linux_vscode_version) differs from darwin" \
    "(version=$version commit=$product_commit vscodeVersion=$vscode_version)" >&2
  exit 1
fi

python3 - "$pins" "$version" "$archive_commit" "$product_commit" "$platform" "$url" "$sha256" \
  "$vscode_version" "$linux_sha256" << 'PY'
import pathlib, sys
path, version, archive_commit, product_commit, platform, url, sha256, vscode_version, linux_sha256 = sys.argv[1:10]
lines = []
for line in pathlib.Path(path).read_text().splitlines():
    if line.startswith("FPU_CURSOR_VERSION="):
        lines.append(f"FPU_CURSOR_VERSION={version}")
    elif line.startswith("FPU_CURSOR_ARCHIVE_COMMIT="):
        lines.append(f"FPU_CURSOR_ARCHIVE_COMMIT={archive_commit}")
    elif line.startswith("FPU_CURSOR_PRODUCT_COMMIT="):
        lines.append(f"FPU_CURSOR_PRODUCT_COMMIT={product_commit}")
    elif line.startswith("FPU_CURSOR_PLATFORM="):
        lines.append(f"FPU_CURSOR_PLATFORM={platform}")
    elif line.startswith("FPU_CURSOR_SHA256="):
        lines.append(f"FPU_CURSOR_SHA256={sha256}")
    elif line.startswith("FPU_CURSOR_LINUX_SHA256="):
        lines.append(f"FPU_CURSOR_LINUX_SHA256={linux_sha256}")
    else:
        lines.append(line)
pathlib.Path(path).write_text("\n".join(lines) + "\n")
print(
    f"Pinned Cursor {version} productCommit={product_commit} vscodeVersion={vscode_version}",
    f"sha256={sha256} linuxSha256={linux_sha256}",
)
PY
