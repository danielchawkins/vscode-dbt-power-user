# v1 performance baseline — September 2026

First recorded baseline for step 3.13. Targets are derived from this run, not chosen in advance. Re-measure build and payload with `just benchmark`; re-measure VS Code runtime with `just benchmark-runtime-vscode <vsix>`.

## Environment

| Field          | Value          |
| -------------- | -------------- |
| Date           | 2026-09-21     |
| Machine        | Mac17,8        |
| macOS          | 26.5.2 (25F84) |
| CPU cores      | 18             |
| Memory         | 64 GiB         |
| Node           | 24.21.0        |
| npm            | 11.19.0        |
| just           | 1.58.0         |
| Build revision | `ptlpxnmnruqo` |

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

## VS Code runtime — ten fresh processes

`just benchmark-runtime-vscode fusion-power-user-0.1.0-alpha.0.vsix` installs the packaged VSIX into a new profile and extension directory for each sample, opens all three retained webviews in VS Code 1.128.0, and records:

- startup activation from VS Code's built-in Startup Performance report, preserving its load-code, call-activate, and finish-activate phases;
- browser `first-contentful-paint` relative to each real webview document's own `timeOrigin`;
- host `resolveWebviewView` start to receipt of that webview's `webview:ready` message on the host clock.

Observed harness change: `xkyowxlpxkvy`. Observed host: VS Code 1.128.0, Electron 42.5.0, Chromium 148.0.7778.271, and Node 24.17.0. Every sample reported eager activation from `workspaceContains:**/dbt_project.yml` by `danielchawkins.fusion-power-user`.

All durations are milliseconds. Median averages the two middle values; p90 is the nearest-rank 90th percentile.

| Measure                     | Raw samples                                                                              |  Median |     p90 |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------: | ------: |
| Activation: load code       | 15, 15, 16, 15, 16, 15, 16, 15, 15, 16                                                   |      15 |      16 |
| Activation: call activate   | 3, 3, 4, 3, 4, 3, 3, 4, 3, 3                                                             |       3 |       4 |
| Activation: finish activate | 1506, 1013, 1028, 989, 1085, 1055, 1037, 989, 1031, 1054                                 |   1,034 |   1,085 |
| Docs FCP                    | 324, 308, 316, 300, 308, 308, 300, 304, 292, 304                                         |     306 |     316 |
| Docs resolve-to-ready       | 378.036, 357.227, 372.967, 367.813, 376.916, 355.622, 358.256, 367.039, 364.828, 352.980 | 365.934 | 376.916 |
| Query FCP                   | 320, 308, 304, 304, 304, 308, 320, 304, 304, 304                                         |     304 |     320 |
| Query resolve-to-ready      | 357.153, 337.051, 346.012, 338.575, 346.489, 336.385, 361.607, 338.328, 339.934, 332.351 | 339.255 | 357.153 |
| Lineage FCP                 | 324, 320, 320, 320, 320, 316, 320, 316, 316, 308                                         |     320 |     320 |
| Lineage resolve-to-ready    | 343.420, 348.836, 342.776, 354.924, 344.065, 339.061, 339.979, 337.291, 337.111, 334.400 | 341.377 | 348.836 |

Cursor runtime timing remains deferred because its clean-profile login flow disrupts unattended panel automation. The existing pinned Cursor installation and activation smoke remains in place.

## Component test coverage (step 3.13)

Vitest 5 + Testing Library + jsdom in `webview_panels/` — sixteen tests:

- `CodeBlock.test.tsx` — seven cases: safe text, SQL with and without line numbers, YAML, filename/actions, classname, dark styling.
- `useListeners.test.tsx` — seven cases: `webview:ready` on standard and docs routes, `creditsUpdate`, sync `response`, behavioral unmount cleanup, theme mutation.
- `useQueryPanelListeners.test.tsx` — two cases: `queryHistory` handler, behavioral unmount cleanup.

Wired into `just check` via `just webviews::typecheck` and `just webviews::test`.
