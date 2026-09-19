#!/bin/sh
set -eu

usage() {
  echo "usage: install-just.sh [--force]"
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

if mise which just > /dev/null 2>&1 && [ "$force" = false ]; then
  mise exec -- just --version
  exit
fi

if [ "$force" = true ]; then
  mise install --force just
else
  mise install just
fi
mise exec -- just --version
