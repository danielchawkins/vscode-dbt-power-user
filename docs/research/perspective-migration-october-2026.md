# Perspective migration — spike, October 2026

The query results panel runs `@finos/perspective*` 3.8, which is deprecated and brings in the `d3-color` advisory through `@finos/perspective-viewer-d3fc`. This spike runs the same path on `@perspective-dev/*` 5.5.1, the current release, in a throwaway Vite app under the panel's Content Security Policy, and records what the migration changes. The harness is `scripts/spikes/perspective-migration/`; `results.json` there is the run this page reports.

## Harness

`index.html` loads `src/main.js`, which:

- builds a `renderQuery` message in the contract's shape (`packages/webview-contract/src/queryResults.ts`): seven columns typed `Integer`, `Text`, `Number`, `BigInteger`, `Text`, `Text` and `null`, 200 rows, one column of JSON strings, one of long text, one untyped column of objects;
- maps it with a copy of `columnTypeMapping.ts`, so the schema is explicit and no type is inferred from values;
- loads the table into a `perspective-viewer` with the `viewer-datagrid` plugin, restores the configuration `PerspectiveViewer.tsx` builds, attaches the cell viewer, and reads the first row back from the grid;
- loads the same table into a second viewer as a `Y Bar` chart from `viewer-charts`, grouped by `label`;
- restores a configuration saved by `@finos/perspective-viewer` 3.8 (`version: "3.8.0"`, group-by, sort, filter, aggregates), then restores the panel configuration over it.

`run.mjs` serves the build with the policy `contentSecurityPolicy` (`src/webview/panelHtml.ts`) gives the query results entry: `default-src 'none'`, a nonce and the asset origin in `script-src` with `'wasm-unsafe-eval'`, `connect-src` to the asset origin, `worker-src blob:`. It then removes one allowance at a time. Each variant runs in a fresh headless Chromium 153 and records every step, every `securitypolicyviolation` event and the console. `chartcheck.mjs` confirms the bar chart paints: the chart region is 31.7% non-background pixels with data, 6.5% when a filter leaves no rows, and 31.7% again after the filter is cleared.

## Results

With the full policy, every step passes and no policy violation is logged. The grid's first row reads `1`, `alpha`, `0`, `9007199254740993`, the JSON payload and the long note: the `BigInteger` column keeps all its digits as a string. The bar chart renders as `perspective-viewer-charts-y-bar`. The configuration saved by 3.8 restores: `save()` returns it with `version: "5.5.1"`, the same `group_by`, `sort` and `filter`, and a view of 5 rows (four groups and the total). The panel configuration then restores over it, and the theme becomes `Pro Light`.

| Removed from the policy            | Result                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nothing                            | Grid, chart and both restores pass; no violations.                                                                                                                                            |
| `'wasm-unsafe-eval'`               | `init_client` fails: `WebAssembly.compile(): … 'unsafe-eval' is not an allowed source of script`. Nothing mounts.                                                                             |
| `worker-src blob:`                 | `init_client` passes; `perspective.worker()` never resolves, and the console reports `Creating a worker from 'blob:…' violates … script-src`. The engine starts its worker from a `Blob` URL. |
| `connect-src <cspSource>`          | Both `.wasm` fetches are blocked; `WebAssembly.compile(): BufferSource argument is empty`.                                                                                                    |
| `connect-src`, inline build        | Passes. `@perspective-dev/client/inline` and `@perspective-dev/viewer/inline` embed the WebAssembly in the JavaScript and fetch nothing.                                                      |
| `'wasm-unsafe-eval'`, inline build | Fails as above: inlining changes where the bytes come from, not how they are compiled.                                                                                                        |

Both `'wasm-unsafe-eval'` and `worker-src blob:` are still needed, as on 3.8 ([CSP evidence](webview-csp-october-2026.md#perspective)). `connect-src` is needed only by the fetched build. Dropping it by switching to the inline build is not worth it: the inline entry is 11.7 MB raw and 5.4 MB gzip, against 4.0 MB of separately fetched WebAssembly, and it parses on the panel's critical path. `viewer-charts` also starts a module worker from a `Blob` URL and draws into an `OffscreenCanvas`, so the chart plugin depends on `worker-src blob:` too. Its bundle contains no `Function(` or `eval(` call.

## API differences from `@finos/perspective` 3.8

| Area                   | 3.8                                                                            | 5.5.1                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Packages               | `@finos/perspective`, `-viewer`, `-viewer-datagrid`, `-viewer-d3fc`            | `@perspective-dev/client`, `-server` (engine WebAssembly only), `-viewer`, `-viewer-datagrid`, `-viewer-charts`. `@perspective-dev/viewer-d3fc` stops at 4.4.1 and is not on the 5.x line.                                                                         |
| Engine WebAssembly     | `@finos/perspective/dist/wasm/perspective-server.wasm`                         | `@perspective-dev/server/dist/wasm/perspective-server.wasm`. A `memory64` build sits beside it; `init_server({ wasm32, wasm64 })` registers both and picks one on first `worker()`.                                                                                |
| Viewer WebAssembly     | `@finos/perspective-viewer/dist/wasm/perspective-viewer.wasm`, 921 KB          | `@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm`, 1,552 KB.                                                                                                                                                                                             |
| Initialisation         | `perspective.init_server(fetch(…))`, `perspectiveViewer.init_client(fetch(…))` | Same calls, same arguments.                                                                                                                                                                                                                                        |
| Loading data           | `viewer.load(table)`                                                           | `viewer.load(table)` still works and logs a deprecation; use `client.table(schema, { name })`, `viewer.load(client)`, then `viewer.restore({ table: name })`.                                                                                                      |
| `client.table(schema)` | Untyped overload; the panel needs `@ts-expect-error`                           | Typed: `table(value: … \| Record<string, ColumnType>, options?)`. The `@ts-expect-error` goes.                                                                                                                                                                     |
| Saved configuration    | `ViewerConfigUpdate`                                                           | Same fields plus `version`, `table` and `windows`. A 3.8 token restores unchanged; `save()` stamps `version: "5.5.1"`.                                                                                                                                             |
| Charts                 | `@finos/perspective-viewer-d3fc`: SVG and canvas through d3fc                  | `@perspective-dev/viewer-charts`: WebGL in a worker, plugins registered on import as `perspective-viewer-charts-<type>`. Names: `X Bar`, `Y Bar`, `Y Line`, `Y Scatter`, `Y Area`, `Treemap`, `Sunburst`, `Heatmap`, `Candlestick`, `OHLC`, and three map plugins. |
| Datagrid plugin        | `get name()` returns `"Datagrid"`; subclass and `registerPlugin(tag)`          | Name comes from `get_static_config().name`; `regular_table` is public; `viewer.getPlugin("Datagrid")` returns the instance. `regular-table` 0.9 keeps `addStyleListener` and `getMeta`.                                                                            |
| Themes                 | Custom properties without prefix (`--icon--color`, `--plugin--background`)     | Every property is prefixed `--psp-` (349 in `pro.css`). `themes.css` adds Blueprint, Botanical, Eggplant, Ledger, Nord, Phosphor and Velvet; Vintage is still not shipped.                                                                                         |
| CSS entry points       | `@finos/perspective-viewer/dist/css/<theme>.css`                               | `@perspective-dev/viewer/themes` (all) or `@perspective-dev/viewer/themes/<theme>.css`.                                                                                                                                                                            |

The panel's `themes.css` defines Vintage with 116 unprefixed custom properties, none of which the 5.5 viewer reads. The migration renames them to the `--psp-` form or drops Vintage, which is the `fusionPowerUser.queryResults.theme` default. The setting's enum lists the 3.8 theme names, all of which still exist.

## `PerspectivePlugins.ts`

The plugin subclasses the datagrid to add one feature: string cells that hold JSON or overflow their column get an icon, and a click opens the value in a drawer. On 5.5 the same feature works without a subclass. `src/cellViewer.js` gets the stock plugin with `viewer.getPlugin("Datagrid")` and adds a style listener to its `regular_table`. The listener reads each cell's `getMeta()`, looks the column up in the view's `schema()` and `column_paths()`, and decorates string cells. Both are refreshed after `perspective-config-update`. In the run it marked 33 cells (9 `label`, 12 `payload`, 12 `note`), and clicking a `payload` cell dispatched `string-json-viewer` with the JSON and `type: "json"`.

This drops the second registered plugin (`perspective-datagrid-json-viewer-plugin`, named "Slice and Dice"), the `customElements.get` cast, and the `perspective.d.ts` declarations that type the private datagrid surface. One datagrid stays in the plugin picker.

## Size

Built by Vite 8.3.2 with `assetsInlineLimit: 0`. Raw bytes, gzip in brackets.

| Build                                   | JavaScript             | CSS              | WebAssembly                       |
| --------------------------------------- | ---------------------- | ---------------- | --------------------------------- |
| 3.8: client, viewer, datagrid, d3fc     | 491,556 (150,436)      | 146,037 (25,912) | 2,277,909 + 920,705 = 3,198,614   |
| 5.5.1: client, viewer, datagrid, charts | 557,274 (165,427)      | 146,431 (25,138) | 2,459,148 + 1,552,105 = 4,011,253 |
| 5.5.1, inline build, datagrid only      | 11,733,085 (5,404,184) | in the JS        | in the JS                         |

The 5.5.1 fetched build is 66 KB more JavaScript and 813 KB more WebAssembly than 3.8. The WebAssembly is fetched only when the query results panel opens. The memory64 engine (2,512,009 bytes) ships in the package; it is emitted only if `init_server` registers it.

## d3fc

`@perspective-dev/viewer-d3fc` 4.4.1 still depends on `d3fc`, `d3-svg-legend` and `d3-color >=3.1`; there is no 5.x release. `viewer-charts` replaces it and has no d3 dependency: its tree adds only `regular-layout` and `regular-table`. The advisory matches `d3-color` 1.4.1, which the repository gets only through `@finos/perspective-viewer-d3fc` → `d3-svg-legend` → `d3-scale` 1. The other path, `@altimateai/ui-components` → `plotly.js` → `d3-interpolate`, resolves to the patched 3.1.0 and goes with R8. `npm audit` on the spike's own tree reports zero vulnerabilities; the same minimal app on 3.8 with d3fc reports one high (`d3-color`).

Drop d3fc. The panel's charts become `viewer-charts` plugins.

## Migration recipe

1. Replace the four `@finos/perspective*` dependencies in `webview_panels/package.json` with `@perspective-dev/client`, `@perspective-dev/server`, `@perspective-dev/viewer`, `@perspective-dev/viewer-datagrid` and `@perspective-dev/viewer-charts`, pinned to one version.
2. In `initPerspective.ts`, point `init_server` at `@perspective-dev/server/dist/wasm/perspective-server.wasm` and `init_client` at `@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm`, keeping `new URL(…, import.meta.url)`. Register only the wasm32 engine.
3. In `PerspectiveViewer.tsx`, import `@perspective-dev/viewer-datagrid` and `@perspective-dev/viewer-charts` instead of the datagrid and d3fc packages, and `@perspective-dev/viewer/themes/<theme>.css` for each theme the setting lists. Create the table with `worker.table(schema, { name })` and drop the `@ts-expect-error`; load with `viewer.load(client)` and put `table: name` in the restored configuration.
4. Delete `PerspectivePlugins.ts` and `perspective.d.ts`. Attach the cell viewer to `viewer.getPlugin("Datagrid").regular_table` after the first `restore`, and refresh its schema cache on `perspective-config-update`.
5. Rename the Vintage theme's custom properties in `themes.css` to the `--psp-` form, or remove Vintage and change the setting's default, and check the overrides in `perspective.scss` against the 5.5 shadow DOM.
6. Keep the query results policy as it is: `'wasm-unsafe-eval'`, `connect-src <cspSource>` and `worker-src blob:` are all still required.
7. Verify with the pinned-host smoke (the two-row Perspective grid), `npm audit` without `d3-color` from Perspective, and visual evidence of the grid and one chart in light, dark and high-contrast themes.
