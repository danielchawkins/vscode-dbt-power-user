#!/bin/sh
set -eu

usage() {
  echo "usage: install-mise.sh [--force]"
  exit "${1:-0}"
}

force=false
case "${1:-}" in
  "") ;;
  --force) force=true ;;
  -h | --help) usage ;;
  *) usage 2 >&2 ;;
esac
[ "$#" -le 1 ] || usage 2 >&2

export PATH="$HOME/.local/bin:$PATH"
if command -v mise > /dev/null 2>&1; then
  if [ "$force" = true ]; then
    echo "mise is already installed; update it with the package manager that installed it"
  fi
  mise --version
  exit
fi

command -v curl > /dev/null 2>&1 || {
  echo "curl is required to install mise" >&2
  exit 1
}

installer=$(mktemp)
trap 'rm -f "$installer"' EXIT
curl --proto '=https' --proto-redir '=https' --tlsv1.2 -LsSf https://mise.run -o "$installer"
sh "$installer"
mise --version
