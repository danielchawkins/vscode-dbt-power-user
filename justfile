set shell := ["bash", "-euo", "pipefail", "-c"]

export PATH := `mise bin-paths 2>/dev/null | tr '\n' ':' || true` + env("PATH")

default:
    @just --list

setup:
    mise trust
    mise install
    npm ci
    npm run install:panels
    lefthook install

fmt:
    npm run format:code
    npm run lint:fix
    dprint fmt
    rumdl fmt .

lint:
    npm run lint
    npm run lint --prefix ./webview_panels
    npm run check:format
    npm run check:lockfiles
    npm run check:markdown

check:
    npm run check

package:
    npm run build-vsix
