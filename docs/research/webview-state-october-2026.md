# Webview view state — evidence, October 2026

Query results and the documentation editor register without `retainContextWhenHidden`. When either is hidden, VS Code discards its page and rebuilds it when the panel is shown again. Each page restores its own view state through `vscode.getState`, and its host sends back what the page cannot keep: the query results host its last result, the documentation editor host its unsaved draft. Lineage keeps `retainContextWhenHidden` until R8 (see [Exceptions](#exceptions)); R8 removes it.

## Persisted schema

`webview_panels/src/modules/app/viewState.ts` defines one type per panel and a runtime allowlist, `VIEW_STATE_FIELDS`. `writeViewState` refuses any key outside the panel's allowlist, a value of the wrong kind, and any string longer than 200 characters, which fits a search filter but not a query or payload. `viewState.test.ts` checks that writes carrying result rows, SQL, query history, credentials, documentation or lineage nodes are refused. Webview state is unencrypted host storage, so it holds view state only.

| Panel                | Fields                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- |
| documentation editor | `publication`, `model` (unique id), `scrollTop`, `searchQuery`                          |
| query results        | `publication`, `tabState`                                                               |
| lineage              | `publication`, `start`, `expansions`, `columnTables`, `selectedTable`, `selectedColumn` |

Lineage's lists are a `strings` kind: at most 200 entries of at most 200 characters. `expansions` are `c:<unique id>` or `p:<unique id>` in the order applied; the page replays them through `childTables` and `parentTables`, lists `columnTables` through `getColumns`, and retraces `selectedColumn` through `getConnectedColumns`, so no table, column or edge payload is stored. `render` carries `publication`; a saved state replays only for the same start table and publication.

`viewState.ts` is the only module under `src/modules/` that imports `@modules/vscode` directly, for `getState` and `setState`; messages still go through each panel's requests module. `webview_panels/eslint.config.mjs` lists it next to `requestExecutor.ts` in the `no-restricted-imports` ignores.

`publication` is `publicationId(manifest)` (`src/projects/manifest.ts`): a random id generated once per extension-host session, joined with the Current Project's `Manifest.publicationEpoch`. It is sent with `renderDocumentation` and query results `getContext`. Epochs restart at 1 in each session, so the epoch alone would match a state saved in an earlier session; the session id makes that state never match. The documentation editor restores scroll and search only when the model and the publication both match what it saved, so a page rebuilt after a manifest rebuild, or in a new session, starts clean.

## Host memory

Result rows and drafts never go into webview state.

`PanelReplay` (`src/webview/panelHost.ts`, with its rules in `src/features/queryResults/replayRules.ts`) keeps, in host memory, the last view type and result posted to the bottom view and to each results tab. The host sends them again when a rebuilt page reports `webview:ready`. A results tab asks for its tab data again after each rebuild and gets the same data. A tab's entry lives until the tab closes; every entry is cleared when a project is removed; all of it ends with the extension host.

The documentation editor host (`src/features/docs/docsEditPanel.ts`) keeps one draft per model file path: the edited documentation and tests. The page sends `saveDraft` while it is dirty and `saveDraft` without a draft once its edits are saved, reverted or discarded; the host also drops the draft after a save and drops every draft under a removed project's root. `renderDocumentation` carries the model's draft, and a rebuilt page shows it over the saved documentation, so the editor is dirty again with the same edits. A live page that is already dirty on the same model keeps its own edits, which are newer than the host's copy.

## Exceptions

**Lineage kept `retainContextWhenHidden` until R8.** `@altimateai/ui-components` kept the graph's expansion and selection inside the component and exposed neither, so a rebuilt page would have lost them on every tab switch. The R8 renderer persists them in the schema above and registers without retain.

## Restore checks

`src/test/smoke/panelViewState.test.ts`:

- **Query results.** Renders a three-row result through `fusionPowerUser.test.renderQueryResult`, selects the SQL tab, switches to the lineage panel and back, and asserts the page was rebuilt (`performance.timeOrigin` changed), the SQL tab is active again, and the Preview tab reports the replayed three rows. The test fails when `retainContextWhenHidden` is on, because the page is never rebuilt.
- **Documentation editor.** Opens `models/child.sql`, types into the model description, switches to the query results tab of the bottom panel and back, and asserts the page was rebuilt, the description still holds the edit, and the editor still shows it modified with Save.

## Memory

The plan keeps `retainContextWhenHidden` on query results only if, without it, the heap after ten hide/show cycles with a 10,000-row result is more than 25% above the first reading. With `FPU_MEMORY_ROWS=10000`, the same smoke file renders a 10,000-row, five-column result, then hides and shows the panel ten times. Each sample waits until Perspective holds the result and has painted it: `viewer.getTable()` → `view()` must report 10,000 rows, and the datagrid's text, read through its shadow roots, must contain the first row's `label` (`row 0`); the grid paints only the rows in its viewport. It then reads, after a forced garbage collection in each:

- **frame**: `Runtime.getHeapUsage` of the query results frame;
- **worker**: the sum of `Runtime.getHeapUsage` over the dedicated workers the frame started (Perspective's blob worker), attached with `Target.setAutoAttach`;
- **host**: `process.memoryUsage().heapUsed` of the extension host, read by the smoke test, which runs in it.

VS Code 1.128.0, three runs per build, used heap in bytes, median and range:

| Reading                | Without retain (shipped)           | With retain on query results       |
| ---------------------- | ---------------------------------- | ---------------------------------- |
| frame, after render    | 5,594,456 (5,591,408–5,598,892)    | 5,789,364 (5,788,676–5,790,608)    |
| frame, after cycle 10  | 5,409,472 (5,408,188–5,410,480)    | 5,786,788 (5,784,596–5,815,712)    |
| frame growth           | −3.3% (−3.4% to −3.2%)             | −0.1% (−0.1% to +0.5%)             |
| worker, after render   | 2,716,984 (2,701,880–2,717,036)    | 3,995,784 (3,995,784–3,995,836)    |
| worker, after cycle 10 | 1,359,772 (all runs)               | 3,996,792 (3,996,792–3,996,844)    |
| worker growth          | −50.0% (−50.0% to −49.7%)          | 0.0%                               |
| workers attached       | 2 after render, then 1             | 3 throughout                       |
| frame + worker growth  | −18.5% (−18.6% to −18.5%)          | 0.0% (0.0% to +0.3%)               |
| host, after render     | 51,938,628 (39,386,796–52,457,672) | 41,280,120 (41,228,912–41,576,812) |
| host, after cycle 10   | 49,684,556 (42,157,816–57,533,668) | 42,452,592 (41,897,460–42,581,136) |
| host growth            | +7.0% (−5.3% to +10.8%)            | +2.8% (+0.8% to +3.3%)             |

Without retain, each rebuilt page starts a new frame and a new Perspective worker, which settle near 5.4 MB and 1.4 MB with the result replayed into them; nothing builds up across cycles. The first reading includes the worker of the three-row result the earlier test rendered, which the rebuild discards. With retain, the page keeps every Perspective worker it ever started (three by the time the memory test runs). Host growth is within the run-to-run range of a heap shared with VS Code's own extension host work. No reading approaches the 25% threshold, so query results registers without `retainContextWhenHidden`.

The builds were `sha256=099423d0479d188bbcdb2bcce39e733d26de122fb41cf61f411e72b70e0054f0` (without) and `sha256=85a31295191fbc0c6cbfc5855bd26fbfd757c003ab8035e75c212d75ad6a2d3d` (a temporary build with retain restored on the query results view only; its query results restore check fails, as expected).

Limits of the method:

- `Runtime.getHeapUsage` counts the V8 JavaScript heap only. Perspective's engine keeps its table in WebAssembly linear memory, which this reading does not include, and neither reading includes DOM, GPU or renderer process memory outside V8.
- A hidden page without retain holds no memory until it is shown again; the method only samples shown pages, so it understates the saving.
- The host reading shares one heap with every extension in the smoke host and is sampled without a forced collection, so it varies by tens of megabytes between runs and can show only large regressions.
- One host (VS Code), one fixture, one result shape, three runs per build.

Perspective takes its client WebAssembly from the defined `perspective-viewer` element; `PerspectiveViewer.tsx` waits for `customElements.whenDefined("perspective-viewer")` before `perspective.worker()`. Without that wait, a page that loads a result before the element is defined fails with `Missing perspective-client.wasm` and shows the error fallback; the paint assertion above found it.
