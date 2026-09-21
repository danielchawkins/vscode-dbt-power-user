#!/usr/bin/env bash
# Fail when base webview Tailwind utility tokens disappear from the shipped CSS bundle.
set -euo pipefail

css_file="${1:-}"
if [[ -z "$css_file" || ! -f "$css_file" ]]; then
  echo "usage: $0 <path-to-main.css>" >&2
  exit 1
fi

min_base_selector_tokens=400
selector_list="$(mktemp)"
trap 'rm -f "$selector_list"' EXIT

# Broad base `.al-*` token scan — not a full CSS parser or variant inventory.
grep -o '\.al-[^,{]*' "$css_file" | sed 's/[[:space:]]*$//' | sort -u > "$selector_list" || true

base_count=0
if [[ -s "$selector_list" ]]; then
  base_count="$(
    grep -Ev 'al-tw-scope|[[:space:]]|\\:' "$selector_list" | grep -cve '^$' || true
  )"
fi

if ((base_count < min_base_selector_tokens)); then
  echo "expected >= ${min_base_selector_tokens} distinct base .al-* selector tokens, found ${base_count} in ${css_file}" >&2
  exit 1
fi

if ! grep -Fxq '.al-tw-scope' "$selector_list"; then
  echo "missing scoped preflight anchor .al-tw-scope in ${css_file}" >&2
  exit 1
fi

required_utilities=(
  .al-flex
  .al-items-center
  .al-bg-background
  .al-text-muted-foreground
)

for selector in "${required_utilities[@]}"; do
  if ! grep -Fxq "$selector" "$selector_list"; then
    echo "missing required webview Tailwind utility selector ${selector} in ${css_file}" >&2
    exit 1
  fi
done

echo "webview Tailwind CSS ok: ${base_count} base .al-* selector tokens (>= ${min_base_selector_tokens})"
