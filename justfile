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
    ast-grep --version
    jj --version
    dbt --version

####################
# Development
####################

[group("development")]
build-packages:
    npm run build:packages

[group("development")]
build:
    just build-packages
    npm run build:app --workspace webview_panels
    npm run build:app

[group("development")]
build-dev:
    just build-packages
    npm run build:app --workspace webview_panels
    npm run build:dev:app

[group("development")]
watch:
    #!/usr/bin/env bash
    set -euo pipefail
    just build-packages
    trap 'trap - EXIT; kill 0' EXIT INT TERM HUP
    npm run watch:packages &
    npm run watch:app --workspace webview_panels &
    npm run watch:extension:app &
    wait

[group("development")]
watch-extension:
    #!/usr/bin/env bash
    set -euo pipefail
    just build-packages
    trap 'trap - EXIT; kill 0' EXIT INT TERM HUP
    npm run watch:packages &
    npm run watch:extension:app &
    wait

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
    #!/usr/bin/env bash
    set -uo pipefail
    failed=()
    for step in lint-just lint-mise-lock lint-code lint-ast-grep lint-unused lint-ratchet webviews::lint \
        lint-format lint-lockfiles lint-deps lint-markdown lint-shell; do
        just "$step" || failed+=("$step")
    done
    if ((${#failed[@]})); then
        echo "lint failed: ${failed[*]}" >&2
        exit 1
    fi

[group("quality")]
check:
    #!/usr/bin/env bash
    set -uo pipefail
    want=$(sed -n 's/^node = "\(.*\)"/\1/p' mise.toml)
    have=$(node -p 'process.versions.node' 2>/dev/null || echo none)
    if [[ "$have" != "$want"* ]]; then
        echo "check: Node $have, but mise.toml pins $want; run 'just setup' or 'mise install'" >&2
        exit 1
    fi
    for step in compile lint test webviews::typecheck webviews::test; do
        if ! just "$step"; then
            echo "check failed at: $step" >&2
            exit 1
        fi
    done
    echo "check passed"

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
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT; MISE_IGNORED_CONFIG_PATHS="${XDG_CONFIG_HOME:-$HOME/.config}/mise" MISE_DATA_DIR="$tmp" mise install --locked --dry-run

[group("quality")]
fmt-code:
    npm run format
    npm run fix:oxlint
    npm run fix:eslint

[group("quality")]
lint-code:
    npm run lint:oxlint
    npm run lint:eslint
    npm run lint:imports

# Call-site and comment rules in ast-grep/rules; a suppression that hides nothing fails the scan.
[group("quality")]
lint-ast-grep:
    ast-grep test
    ast-grep scan --error=unused-suppression

# Unused files, exports, types, enum members and dependencies, in all code and in production code alone; then
# every @internal export has a production caller and every @planned export has none.
[group("quality")]
lint-unused:
    npm run lint:unused
    node scripts/quality/export-tags.mjs

# Drop baseline entries for lint violations that have been fixed, so the baseline only shrinks.
[group("quality")]
lint-prune:
    npm run prune:oxlint
    npm run prune:eslint
    just webviews::lint-prune

# Fail when a ratcheted count or floor differs from scripts/quality/ceilings.json; --write stores the measured values.
[group("quality")]
lint-ratchet *args:
    node scripts/quality/ratchet.mjs "$@"

[group("quality")]
lint-format:
    npm run check:format

[group("quality")]
lint-lockfiles:
    npm run check:lockfile

[group("quality")]
lint-deps:
    node scripts/quality/dependency-health.mjs

[group("quality")]
fmt-markdown:
    dprint fmt
    rumdl fmt .

[group("quality")]
lint-markdown:
    dprint check
    rumdl check .
    node scripts/quality/docs-symbols.mjs

[group("quality")]
fmt-shell:
    shfmt -w -i 2 -ci -sr scripts

[group("quality")]
lint-shell:
    shfmt -d -i 2 -ci -sr scripts
    shfmt -f scripts | xargs -r shellcheck

# Traces deprecations over build, lint, test and package; fails on a warning ALLOWED lacks. Not in `just check`.
[group("quality")]
trace-deprecations:
    node scripts/quality/deprecation-trace.mjs

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
build-integration:
    just clean
    just package
    npm run build:dev
    npm run compile:integration
    cp src/test/integration/out-package.json out/package.json

[group("tests")]
test-integration *args: build-integration
    npm run test:integration -- "$@"

# Every label in parallel Linux arm64 containers, or just the one named. Builds once on the host.
[group("tests")]
test-integration-docker label="":
    sh scripts/test/docker-integration.sh {{ quote(label) }}

[group("tests")]
benchmark *args:
    bash scripts/benchmark/run-baseline.sh "$@"

# Without --vsix, packages the working copy first and smokes exactly that build.
[group("tests")]
smoke-vscode *args:
    bash scripts/smoke/run-host-smoke.sh --host vscode "$@"

# Without --vsix, packages the working copy first and smokes exactly that build.
[group("tests")]
smoke-cursor *args:
    bash scripts/smoke/run-host-smoke.sh --host cursor "$@"

[group("tests")]
benchmark-runtime-vscode vsix:
    node scripts/benchmark/measure-runtime.mjs --host vscode --vsix "{{ vsix }}"

[group("tests")]
benchmark-runtime-cursor vsix:
    node scripts/benchmark/measure-runtime.mjs --host cursor --vsix "{{ vsix }}"

# Packages once, then smokes that one VSIX on both hosts.
[group("tests")]
smoke *args:
    #!/usr/bin/env bash
    set -euo pipefail
    just package
    vsix="$(cat out/latest-vsix)"
    just smoke-vscode --vsix "$vsix" "$@"
    just smoke-cursor --vsix "$vsix" "$@"

# Smoke both hosts and write screenshot checkpoints plus their text measurements under `out`.
[group("tests")]
smoke-visual out="out/smoke-visual" *args:
    rm -rf "{{ out }}"
    FPU_SMOKE_SCREENSHOTS="{{ out }}" just smoke {{ args }}
    @echo "visual evidence: {{ out }}/<host>/<fixture>/index.json"

# The same packaged-VSIX smoke on both hosts in Linux arm64 containers under Xvfb; no windows open on this machine.
[group("tests")]
smoke-docker out="out/smoke-docker" *args:
    bash scripts/smoke/docker-smoke.sh "$@"

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
    jj --no-pager "$@"

####################
# Packaging
####################

[group("package")]
package:
    #!/usr/bin/env bash
    set -euo pipefail
    # rsbuild keeps dist/ between builds, so stale chunks would otherwise ship.
    rm -rf dist
    # Only the VSIX built here may exist, so nothing downstream can install an older one.
    rm -f ./*.vsix out/latest-vsix
    npm run package:vsix
    vsix="$(node -p "require('./package.json').name + '-' + require('./package.json').version + '.vsix'")"
    if [[ ! -f "$vsix" ]]; then
      echo "error: expected VSIX not found: $vsix" >&2
      exit 1
    fi
    entries="$(unzip -Z1 "$vsix")"
    py_entries="$(printf '%s\n' "$entries" | awk '/\.py$/')"
    if [[ -n "$py_entries" ]]; then
      echo "error: VSIX contains .py entries: $vsix" >&2
      printf '%s\n' "$py_entries" >&2
      exit 1
    fi
    echo "VSIX $vsix contains 0 .py entries"
    if printf '%s\n' "$entries" | grep -qE '(^|/)\.oxfmtrc\.json$'; then
      echo "error: VSIX contains .oxfmtrc.json: $vsix" >&2
      exit 1
    fi
    if printf '%s\n' "$entries" | grep -qi 'altimate-core'; then
      echo "error: VSIX contains altimate-core entries: $vsix" >&2
      exit 1
    fi
    tooling_prog='/(^|\/)([^\/]*-suppressions\.json|knip\.json|\.dependency-cruiser\.cjs|'
    tooling_prog="$tooling_prog"'eslint\.config\.[^\/]*|oxlint\.config\.[^\/]*)$|(^|\/)lint\//'
    tooling_entries="$(printf '%s\n' "$entries" | awk "$tooling_prog")"
    if [[ -n "$tooling_entries" ]]; then
      echo "error: VSIX contains contributor lint or tooling entries: $vsix" >&2
      printf '%s\n' "$tooling_entries" >&2
      exit 1
    fi
    mkdir -p out
    realpath "$vsix" > out/latest-vsix
    node scripts/quality/size-budget.mjs

# Local dry run of the release pipeline: build, checksum, verify the tag, publish nothing.
[group("package")]
release:
    #!/usr/bin/env bash
    set -euo pipefail
    version="$(node -p "require('./package.json').version")"
    tag="v${version}"
    just jj git fetch
    existing="$(just jj tag list "exact:$tag")"
    if [[ -n "$existing" ]]; then
      echo "error: tag $tag already exists; bump package.json version before releasing" >&2
      exit 1
    fi
    just check
    just package
    vsix="$(node -p "require('./package.json').name + '-' + require('./package.json').version + '.vsix'")"
    shasum -a 256 "$vsix" | tee vsix.sha256
    echo "dry run: would push tag $tag and publish $vsix with checksum $(awk '{print $1}' vsix.sha256)"
