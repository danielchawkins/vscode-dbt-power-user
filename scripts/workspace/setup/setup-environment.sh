#!/bin/sh
# Bootstrap mise and Just, then configure this checkout.
set -eu

usage() {
  echo "usage: scripts/workspace/setup/setup-environment.sh [--force]"
  exit "${1:-0}"
}

force=
case "${1:-}" in
  "") ;;
  --force) force=--force ;;
  -h | --help) usage ;;
  *) usage 2 >&2 ;;
esac
[ "$#" -le 1 ] || usage 2 >&2

setup_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH='' cd -- "$setup_dir/../../.." && pwd)
export PATH="$HOME/.local/bin:$PATH"

"$setup_dir/install-mise.sh" ${force:+"$force"}
mise trust --quiet "$repo/mise.toml"

if [ "${SHELL##*/}" = zsh ]; then
  mise_bin=$(command -v mise)
  # shellcheck disable=SC2016 # The command substitution belongs in .zshrc.
  activation=$(printf 'eval "$("%s" activate zsh)"' "$mise_bin")
  touch "$HOME/.zshrc"
  grep -Fqx "$activation" "$HOME/.zshrc" || printf '\n%s\n' "$activation" >> "$HOME/.zshrc"
fi

cd "$repo"
"$setup_dir/install-just.sh" ${force:+"$force"}
exec mise exec -- just setup ${force:+"$force"}
