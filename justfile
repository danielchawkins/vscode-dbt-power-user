set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

setup:
    mise trust
    mise install
    npm ci
    npm run install:panels
    lefthook install

fmt:
    npm run lint:fix
    dprint fmt
    rumdl fmt .

lint:
    npm run lint
    npm run lint --prefix ./webview_panels
    npm run check:markdown

check:
    npm run check

package:
    npm run build-vsix
