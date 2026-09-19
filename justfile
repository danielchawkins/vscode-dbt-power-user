set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments

export PATH := `mise bin-paths 2>/dev/null | tr '\n' ':' || true` + env("PATH")

scripts_dir := source_directory() / "scripts/workspace"

default:
    @just --list

[private]
validate-setup-args *args:
    @provided={{ quote(args) }}; [[ -z "$provided" || "$provided" == --force ]] || { echo "usage: just setup [--force]" >&2; exit 2; }

setup *args:
    just validate-setup-args "$@"
    mise trust
    just install-mise-tools "$@"
    mise exec -- npm ci
    mise exec -- npm run install:panels
    mise exec -- lefthook install
    just configure-jujutsu "$@"
    just verify-setup

install-mise-tools *args:
    mise install "$@"

configure-jujutsu *args:
    {{ quote(scripts_dir / "setup/configure-jujutsu.sh") }} "$@"

verify-setup:
    node --version
    npm --version
    just --version
    lefthook version
    dprint --version
    rumdl --version
    shfmt --version
    shellcheck --version
    jj --version
    dbt --version

fmt:
    npm run format:code
    npm run lint:fix
    dprint fmt
    rumdl fmt .
    npm run format:shell

lint:
    npm run lint
    npm run lint --prefix ./webview_panels
    npm run check:format
    npm run check:lockfiles
    npm run check:markdown
    npm run check:shell

check:
    npm run check

# Run jj, gating the subcommands that skip Git hooks on just check
jj *args:
    #!/usr/bin/env bash
    set -euo pipefail
    push=false
    dry_run=false
    previous=
    for argument in "$@"; do
      [[ "$previous $argument" == "git push" ]] && push=true
      [[ "$argument" == --dry-run ]] && dry_run=true
      previous=$argument
    done
    if $push && ! $dry_run; then just check; fi
    jj "$@"

package:
    npm run build-vsix
