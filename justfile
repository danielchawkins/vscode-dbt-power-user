set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments
set default-list

export PATH := `mise bin-paths 2>/dev/null | tr '\n' ':' || true` + env("PATH")

scripts_dir := source_directory() / "scripts/workspace"

mod webviews "webview_panels"

####################
# Setup
####################

[group("setup")]
[private]
validate-setup-args *args:
    @provided={{ quote(args) }}; [[ -z "$provided" || "$provided" == --force ]] || { echo "usage: just setup [--force]" >&2; exit 2; }

[group("setup")]
setup *args:
    just validate-setup-args "$@"
    mise trust
    just install-mise-tools "$@"
    just sync
    mise exec -- lefthook install
    just configure-jujutsu "$@"
    just verify-setup

[group("setup")]
sync:
    npm ci --strict-allow-scripts
    npm ci --prefix webview_panels --strict-allow-scripts

[group("setup")]
update:
    npm update --strict-allow-scripts
    npm update --prefix webview_panels --strict-allow-scripts
    npm install-scripts prune
    npm --prefix webview_panels install-scripts prune

[group("setup")]
install-mise-tools *args:
    mise install "$@"

[group("setup")]
configure-jujutsu *args:
    {{ quote(scripts_dir / "setup/configure-jujutsu.sh") }} "$@"

[group("setup")]
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

####################
# Development
####################

[group("development")]
build:
    just webviews::build
    npm run build

[group("development")]
build-dev:
    just webviews::build
    npm run build:dev

[group("development")]
watch:
    npm exec --no -- concurrently "just webviews::watch" "npm run watch:extension"

[group("development")]
compile:
    npm run compile

[group("development")]
clean:
    npm run clean

####################
# Code quality
####################

[group("quality")]
fmt:
    just fmt-just
    just fmt-code
    just webviews::fmt
    just fmt-markdown
    just fmt-shell

[group("quality")]
lint:
    just lint-just
    just lint-mise-lock
    just lint-code
    just webviews::lint
    just lint-format
    just lint-lockfiles
    just lint-markdown
    just lint-shell

[group("quality")]
check:
    just compile
    just lint
    just test
    just webviews::typecheck
    just webviews::test

[group("quality")]
fmt-just:
    just --fmt
    just --justfile webview_panels/justfile --fmt

[group("quality")]
lint-just:
    just --fmt --check
    just --justfile webview_panels/justfile --fmt --check
    just --dump > /dev/null

[group("quality")]
lint-mise-lock:
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT; MISE_DATA_DIR="$tmp" mise install --locked --dry-run

[group("quality")]
fmt-code:
    npm run format
    npm run lint:fix

[group("quality")]
lint-code:
    npm run lint

[group("quality")]
lint-format:
    npm run check:format

[group("quality")]
lint-lockfiles:
    npm run check:lockfile
    npm run check:lockfile:webviews

[group("quality")]
fmt-markdown:
    dprint fmt
    rumdl fmt .

[group("quality")]
lint-markdown:
    dprint check
    rumdl check .

[group("quality")]
fmt-shell:
    shfmt -w -i 2 -ci -sr scripts

[group("quality")]
lint-shell:
    shfmt -d -i 2 -ci -sr scripts
    shfmt -f scripts | xargs -r shellcheck

####################
# Tests
####################

[group("tests")]
test *args:
    npm test -- "$@"

[group("tests")]
test-coverage *args:
    npm run test:coverage -- "$@"

[group("tests")]
test-integration *args:
    just clean
    npm run compile:integration
    cp src/test/integration/out-package.json out/package.json
    npm run test:integration -- "$@"

[group("tests")]
benchmark *args:
    bash scripts/benchmark/run-baseline.sh "$@"

[group("tests")]
smoke-vscode *args:
    bash scripts/smoke/run-host-smoke.sh --host vscode "$@"

[group("tests")]
smoke-cursor *args:
    bash scripts/smoke/run-host-smoke.sh --host cursor "$@"

[group("tests")]
smoke *args:
    just smoke-vscode "$@"
    just smoke-cursor "$@"

####################
# Version control
####################

# Run jj, gating the subcommands that skip Git hooks on just check.
[group("version control")]
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

####################
# Packaging
####################

[group("package")]
package:
    npm run package:vsix
