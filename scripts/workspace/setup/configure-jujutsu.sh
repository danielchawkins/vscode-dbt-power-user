#!/bin/sh
# Colocate this clone with Jujutsu. Contributor tooling only; nothing here ships in the VSIX.
set -eu

usage() {
  echo "usage: configure-jujutsu.sh [--force]"
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

cd "$(dirname "$0")/../../.."

if [ -d .jj ]; then
  if [ "$force" = false ]; then
    echo "Jujutsu already colocated; re-run with --force to reapply configuration"
    exit 0
  fi
  initialized=false
else
  jj git init --colocate .
  initialized=true
fi

name=$(git config user.name || true)
email=$(git config user.email || true)
if [ -n "$name" ]; then jj config set --repo user.name "$name"; fi
if [ -n "$email" ]; then jj config set --repo user.email "$email"; fi
jj config set --repo git.push origin
jj config set --repo 'revset-aliases."trunk()"' master@origin
jj bookmark track master --remote origin || true

# The working-copy commit predates the identity just configured, so it would be unpushable.
if [ "$initialized" = true ]; then jj metaedit --update-author; fi

jj --version
