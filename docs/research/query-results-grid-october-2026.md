# Query results grid — parity inventory, October 2026

The query results panel renders rows with `@perspective-dev/*` 5.5.1. [D7](../refactor/quality-and-lsp-plan.md) replaces it with `@tanstack/react-table` 9 and `@tanstack/react-virtual` 3. This page records what the replacement has to match and what it drops, measured on the Phase 4a tip before any grid change.

## Baseline sizes

`just package` on the Phase 4a tip. Raw bytes.

| Artifact                                             | Bytes     |
| ---------------------------------------------------- | --------- |
| VSIX                                                 | 4,863,961 |
| `webview_panels/dist/assets/perspective-server.wasm` | 2,459,148 |
| `webview_panels/dist/assets/perspective-viewer.wasm` | 1,552,105 |
| `webview_panels/dist/assets/queryResults.js`         | 577,254   |
| `webview_panels/dist/assets/queryResults.css`        | 116,352   |
| `webview_panels/dist/assets/chunk-shared.js`         | 279,455   |
| `webview_panels/dist/assets/lineage.js`              | 250,678   |
| `dist/extension.js`                                  | 1,148,694 |

The two WebAssembly files are 4,011,253 bytes, 82% of the VSIX. Both compress to about 1% in the VSIX, so they cost their full size on disk and on download.

## CSP allowances the grid needs

The query results `PanelCsp` (`src/features/queryResults/queryPanelSupport.ts`) is the only page with all four allowances.

| Allowance                       | Needed by Perspective                        | Needed by TanStack                                |
| ------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| `script-src 'wasm-unsafe-eval'` | yes, engine and viewer `WebAssembly.compile` | no                                                |
| `connect-src <cspSource>`       | yes, `fetch` of the two `.wasm` files        | no                                                |
| `worker-src blob:`              | yes, the engine worker and the chart worker  | no                                                |
| `style-src 'unsafe-inline'`     | yes, injected `<style>` elements             | kept; the drawer and the virtual rows use `style` |

## Features in use

Read from `PerspectiveViewer.tsx`, `cellViewer.ts`, `columnTypeMapping.ts`, `perspective.css` and the panel's settings. The viewer is created with `settings: false`, so the configuration side panel is hidden and no user can pivot, filter or change plugin.

| Feature                                                              | Used                                           | Decision | TanStack replacement                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| Scrolling 10,000 rows                                                | yes                                            | kept     | `@tanstack/react-virtual` row virtualizer over a fixed row height                                     |
| Header click sort, ascending, descending, none                       | yes, datagrid default                          | kept     | `getSortedRowModel` with `onSortingChange`; type-aware comparator (numbers numerically, text by code) |
| Column resize by dragging the header edge                            | yes, datagrid default                          | kept     | `columnResizeMode: "onChange"` and a resize handle in each header                                     |
| Type-aware cell formatting, numbers without grouping or truncation   | yes, `columns_config`                          | kept     | `columnTypeMapping.ts` ported: agate type → `text` or `number`; numbers rendered with full digits     |
| `BigInteger` kept as text so no digit is lost                        | yes                                            | kept     | same mapping, the cell stays a string and sorts as a string of digits                                 |
| Unreported column type shown as text, never guessed from values      | yes                                            | kept     | same mapping                                                                                          |
| JSON and long-text cell viewer with a drawer                         | yes, `cellViewer.ts`                           | kept     | a cell renderer that opens the existing `Drawer` for JSON objects and overflowing text                |
| Copy of a cell, text selection in the grid                           | yes, `user-select: text`                       | kept     | native text selection; Cmd/Ctrl+C on a selected cell or range copies tab-separated text               |
| Cell or range selection                                              | partly, through text selection                 | kept     | click selects a cell, shift-click extends to a range, drag selects; copy writes TSV                   |
| CSV export button                                                    | yes, `#export`                                 | kept     | a toolbar button calling the existing `dataToCsv` and download code                                   |
| Theme from `fusionPowerUser.queryResults.theme` (Vintage default)    | yes                                            | dropped  | one grid styled with `--vscode-*` variables follows the active VS Code theme; the setting is removed  |
| Zebra rows and hover highlight                                       | yes, Vintage                                   | kept     | CSS from `--vscode-list-hoverBackground` and `--vscode-editor-background`                             |
| Plugin picker (datagrid, charts), group-by, pivot, filter, aggregate | no, `settings: false`                          | dropped  | none; no consumer case uses them                                                                      |
| Charts (`viewer-charts`)                                             | no                                             | dropped  | none                                                                                                  |
| Saved viewer configuration (`perspective-config-update`)             | theme only                                     | dropped  | none                                                                                                  |
| Column reorder by drag                                               | datagrid default, unused in the consumer cases | dropped  | none                                                                                                  |
| WebAssembly out-of-memory error boundary                             | yes                                            | kept     | the error boundary stays; the message no longer names Perspective                                     |

## Consumer cases

[`finance-pipelines-integration.md`](../refactor/finance-pipelines-integration.md), "Consumer cases" and "Broader parity", lists one use of the grid: query and CTE preview. None of the cases uses charts, pivots, filters or aggregates, so the dropped rows cost no consumer behaviour.

## Candidate

`@tanstack/react-table` 9 and `@tanstack/react-virtual` 3, with `columnTypeMapping.ts` and the cell viewer ported. The candidate has no WebAssembly and no worker, so the three CSP allowances in the first table go with it. The size budgets, the `wasm` budget key, the `.wasm` assertions in `just package` and the Perspective theme CSS go in the same change.
