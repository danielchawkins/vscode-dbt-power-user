#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
dist="$root/webview_panels/dist"
manifest="$dist/assets/manifest.json"

if [[ ! -f "$manifest" ]]; then
  echo "Missing built asset: $manifest" >&2
  echo "Run: just webviews::build" >&2
  exit 1
fi

# Eager bytes per entry: the entry script, every chunk it imports statically, and their stylesheets.
node --input-type=module - "$manifest" "$dist" << 'JS'
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const [manifestPath, dist] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const bytes = (files) =>
  files.reduce(
    ([raw, gzip], file) => {
      const content = readFileSync(`${dist}/${file}`);
      return [raw + content.length, gzip + gzipSync(content).length];
    },
    [0, 0],
  );
for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.isEntry) continue;
  const js = new Set();
  const css = new Set();
  const visit = (k) => {
    if (js.has(manifest[k].file)) return;
    js.add(manifest[k].file);
    (manifest[k].css ?? []).forEach((file) => css.add(file));
    (manifest[k].imports ?? []).forEach(visit);
  };
  visit(key);
  const [jsRaw, jsGzip] = bytes([...js]);
  const [cssRaw, cssGzip] = bytes([...css]);
  console.log(
    `${chunk.name} js raw=${jsRaw} gzip=${jsGzip} css raw=${cssRaw} gzip=${cssGzip}`,
  );
}
JS
