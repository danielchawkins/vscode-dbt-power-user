# v1 performance baseline — September 2026

First recorded baseline for step 3.13. Targets are derived from this run, not chosen in advance. Re-measure on the same hardware at each deletion milestone using `just benchmark`.

## Environment

| Field     | Value          |
| --------- | -------------- |
| Date      | 2026-09-21     |
| Machine   | Mac17,8        |
| macOS     | 26.5.2 (25F84) |
| CPU cores | 18             |
| Memory    | 64 GiB         |
| Node      | 24.21.0        |
| npm       | 11.19.0        |
| just      | 1.58.0         |
| Revision  | `ptlpxnmnruqo` |

Commands: `scripts/benchmark/measure-build.sh` and `scripts/benchmark/measure-payload.sh`. Aggregate entry point: `just benchmark`.

Build medians use one warmup per target, then the median of three measured samples with npm/Vite caches left in place between samples.

## Build and package — median of three

Wall-clock milliseconds on the environment above, no other builds running. VSIX packaging includes prepublish webview and host builds; the generated VSIX is deleted after each sample.

| Step                                            | Median (ms) |
| ----------------------------------------------- | ----------: |
| Webview (`npm run build` in `webview_panels/`)  |      16,541 |
| Host (`npm run build` at repo root)             |       2,289 |
| VSIX (`npm run package:vsix`, incl. prepublish) |      32,467 |

## Webview payload — single entry

Measured after `just webviews::build` (build step runs before payload in `just benchmark`). Raw and gzip bytes for the one bundle every panel loads today.

| Asset      | Raw bytes | Gzip bytes |
| ---------- | --------: | ---------: |
| `main.js`  |   864,209 |    257,443 |
| `main.css` | 1,001,187 |    196,783 |

Per-panel payload is deferred to v2.1 when entries split.

## Runtime measures owned by step 3.14

The following are intentionally out of scope for 3.13:

- **Webview first contentful paint** — requires visible-host/CDP automation against a real webview, not a standalone headless HTML harness.
- **Webview resolve-to-ready** — requires panel-open automation in a pinned host (step 3.14 smoke harness) or a test API that forces `resolveWebviewView`.
- **Cold activation** — requires the pinned-host harness to capture full workbench code-loading and activation accounting; extension-test `activate()` wall time is not a substitute.

## Component test coverage (step 3.13)

Vitest 5 + Testing Library + jsdom in `webview_panels/` — sixteen tests:

- `CodeBlock.test.tsx` — seven cases: safe text, SQL with and without line numbers, YAML, filename/actions, classname, dark styling.
- `useListeners.test.tsx` — seven cases: `webview:ready`, docs route skip, `creditsUpdate`, sync `response`, behavioral unmount cleanup, theme mutation.
- `useQueryPanelListeners.test.tsx` — two cases: `queryHistory` handler, behavioral unmount cleanup.

Wired into `just check` via `just webviews::typecheck` and `just webviews::test`.
