# Lineage renderer benchmark — October 2026

R8 replaces `@altimateai/ui-components`, whose lineage component is the last Altimate package. This benchmark renders the same column-level lineage graphs from finance-pipelines with four candidates and the incumbent, under the lineage panel's Content Security Policy, and measures layout time, first contentful paint and frame time while panning. The harness is `scripts/spikes/lineage-renderer/`; `results/` there holds the runs this page reports.

## Graphs

finance-pipelines has one Declared Project with models, `finance_general`; `local_packages` holds macro packages. `analyze.mjs` reads the `info_schema/v1` parquet tables that dbt Fusion writes under `target/` (`dag_nodes`, `edges`, `node_columns`, `column_lineage`) and keeps the resource types the panel draws as tables (`createTable` in `src/features/lineage/dbtLineageService.ts`).

| Measure              | Value                                         |
| -------------------- | --------------------------------------------- |
| Drawn nodes          | 1,609: 336 models, 1,270 sources, 3 functions |
| Table edges          | 698                                           |
| Column lineage edges | 101,469                                       |
| Columns per node     | p50 13, p95 50, max 241                       |

`target/manifest.json` (2.0.6, 1 October) lists 151 models and 2,353 sources against `info_schema`'s 336 and 1,270 (28 September): the two were written by different runs. The manifest has one column per model, so it cannot supply per-node column counts, and its largest 1-hop subgraph has 9 tables against `info_schema`'s 5, because it fans the Stripe staging models out to three sources each. Neither difference changes the result below: every candidate's cost follows the column count, and 9 tables of one column each is a smaller graph than any measured here.

The panel opens a model with `fusionPowerUser.lineage.defaultExpansion` levels of parents and children, default 1 (`expandTableLineageLevelWise` in the component). For every model, `analyze.mjs` takes that subgraph, ranks the subgraphs by table count, then column count, and writes the p50, p95 and largest as `LineageData` (`packages/webview-contract/src/lineage.ts`) with every column and every column lineage edge between drawn tables:

| Graph | Start model                                            | Tables | Table edges | Columns | Column edges |
| ----- | ------------------------------------------------------ | ------ | ----------- | ------- | ------------ |
| p50   | `base__backend_kikoff__marqeta_lump_sum_reward_orders` | 4      | 4           | 52      | 175          |
| p95   | `base__backend_kikoff__ach_payments`                   | 4      | 4           | 267     | 1,042        |
| max   | `stg__stripe__charge`                                  | 5      | 7           | 324     | 1,241        |

At 1 level, subgraphs have p50 4 and p95 4 tables, 69 and 233 columns, and 233 and 761 column edges. The run was repeated at 2 levels (p50 6 tables / 72 columns, p95 6 / 304, max 10 / 533); those results are in `results/benchmark-hops2.json` and rank the candidates the same way.

## Harness

Each candidate is one Vite page that loads a `LineageData` graph and draws every table with all of its columns and every column edge:

- **`incumbent`**: `@altimateai/ui-components/lineage` as `webview_panels/` installs it, through its `static` lineage type, with Bootstrap and the panel's Tailwind `al-` configuration. The component defers its graph build by 500 ms and `fitView` by 1000 ms; a `setTimeout` shim runs both on the next frame and records the build as layout time, so its FCP and layout are not inflated by those waits.
- **`xyflow-elk`** and **`xyflow-dagre`**: `@xyflow/react` 12.12 with one custom node per table listing its columns, a handle per column, and one edge per column edge. Tables are positioned by `elkjs` 0.12 (`layered`, main thread) or `@dagrejs/dagre` 3.1.
- **`cytoscape`** 3.34: tables as compound nodes, columns as child nodes, positioned by the shared level layout.
- **`sigma`** 3.0 with `graphology` 0.26: WebGL; each table is a header node plus one node per column, since sigma draws points and labels, not tables.

`run.mjs` serves each page with the lineage panel's policy from `contentSecurityPolicy` (`src/webview/panelHtml.ts`): `default-src 'none'`, a nonce and the asset origin in `script-src`, the asset origin in `style-src` with `'unsafe-inline'`, `font-src` and `img-src`. No candidate needs a per-panel allowance; none logged a policy violation. Each sample runs in a fresh Chromium 153 in new-headless mode at 1280×800 with the GPU (ANGLE Metal, Apple M5 Pro), as a VS Code webview renders; the headless shell falls back to SwiftShader and penalises the WebGL candidates.

- **Layout ms**: the candidate's position pass, timed in the page (`hooks.layout`). For the incumbent, the deferred build that drew the nodes, including its `layoutElementsOnCanvas`.
- **FCP ms**: `first-contentful-paint` from `PerformanceObserver`, in the page's clock from navigation.
- **Pan frame**: a pointer drag on the background of the fitted graph, one move per animation frame for 120 frames; the p50 and p95 of `requestAnimationFrame` deltas. 16.7 ms is the 60 Hz vsync floor. **Pan work** is the main-thread time per frame from the move to the first task after rendering, which vsync does not hide.

Every sample reports the drawn table, column and edge counts; all matched the graph in all 45 samples per expansion. Three runs per candidate and graph; the tables give the median and, in brackets, the range.

## Results

1 level (the default), 3 runs each.

| Candidate      | Graph | Layout ms        | FCP ms        | Pan frame p50 ms | Pan frame p95 ms | Pan work p95 ms |
| -------------- | ----- | ---------------- | ------------- | ---------------- | ---------------- | --------------- |
| incumbent      | p50   | 10.2 (9.9–10.6)  | 480 (480–492) | 16.7 (16.7–16.7) | 17.4 (16.8–17.5) | 0.9 (0.9–1.1)   |
| xyflow + elk   | p50   | 26.8 (26–26.8)   | 128 (128–132) | 16.6 (16.6–16.7) | 17.4 (17.2–17.5) | 1.1 (1–1.1)     |
| xyflow + dagre | p50   | 3.3 (3.3–3.7)    | 60 (60–64)    | 16.7 (16.7–16.7) | 17.5 (17.1–17.5) | 1 (0.9–1.1)     |
| cytoscape      | p50   | 37.1 (35.3–42.4) | 88 (84–104)   | 16.6 (16.6–16.7) | 17.6 (17.5–17.6) | 0.4 (0.3–0.4)   |
| sigma          | p50   | 43.2 (42.7–52.4) | 72 (68–80)    | 16.7 (16.6–16.7) | 17.4 (17.3–17.5) | 2.5 (2.1–2.8)   |
| incumbent      | p95   | 27.6 (27.3–30)   | 492 (484–604) | 16.7 (16.7–16.7) | 17.5 (17.3–17.6) | 2.8 (2.6–3)     |
| xyflow + elk   | p95   | 27 (26.5–27.4)   | 196 (196–200) | 16.7 (16.7–16.7) | 17.2 (16.8–17.5) | 2.6 (2.6–2.8)   |
| xyflow + dagre | p95   | 3.1 (3–3.4)      | 116 (112–124) | 16.7 (16.6–16.7) | 17.4 (17.1–17.5) | 2.4 (2.3–2.5)   |
| cytoscape      | p95   | 78.1 (75.3–78.5) | 172 (168–172) | 16.6 (16.6–16.7) | 18 (17.9–18.1)   | 0.6 (0.6–0.6)   |
| sigma          | p95   | 46 (36.1–49.8)   | 80 (68–88)    | 16.7 (16.6–16.7) | 17.4 (16.8–17.4) | 2.4 (2.1–2.6)   |
| incumbent      | max   | 31.6 (31.1–33.3) | 492 (484–500) | 21.5 (21.3–21.7) | 22.5 (22.4–22.7) | 3.6 (3.4–3.9)   |
| xyflow + elk   | max   | 28.2 (27.4–28.3) | 204 (196–208) | 16.7 (16.7–16.7) | 17.6 (17.4–17.6) | 2.9 (2.8–3.1)   |
| xyflow + dagre | max   | 3.3 (3.2–3.4)    | 132 (128–132) | 16.7 (16.7–16.7) | 17.4 (17.2–17.4) | 2.9 (2.6–3)     |
| cytoscape      | max   | 84.9 (84–85.3)   | 192 (192–200) | 16.6 (16.6–16.7) | 18.5 (18–19.2)   | 0.7 (0.7–0.7)   |
| sigma          | max   | 42.2 (24.3–43.6) | 72 (56–72)    | 16.7 (16.7–16.7) | 17.4 (17.3–17.4) | 2.3 (1.8–2.4)   |

Page JavaScript and CSS, raw bytes with gzip in brackets:

| Candidate      | JavaScript            | CSS     |
| -------------- | --------------------- | ------- |
| incumbent      | 8,140,875 (2,408,380) | 354,926 |
| xyflow + elk   | 1,758,433 (542,956)   | 17,037  |
| xyflow + dagre | 373,653 (121,139)     | 17,037  |
| cytoscape      | 442,937 (140,161)     | 66      |
| sigma          | 164,704 (40,351)      | 66      |

- The incumbent's FCP is about 480 ms on every graph: one 333–347 ms long task evaluates its 8 MB bundle before anything paints. On the p95 and max graphs a second 102–127 ms task builds the graph. It is the only candidate whose pan misses vsync, on the max graph (p50 21.5 ms).
- Layout time is not the bottleneck for any candidate at these sizes. dagre takes 3 ms; elk takes 27–28 ms on every graph, most of it fixed start-up cost, for the same table-level layered result.
- cytoscape's layout and pan p95 grow with columns, because every column is a node; at 2 levels on the max graph (533 columns) its pan p50 reaches 18.4 ms.
- sigma has the lowest FCP and the smallest bundle, but draws columns as labelled points: the table card with a column list, type and handles that the panel shows would be custom WebGL work.
- At 2 levels the ordering is the same: FCP p95 graph incumbent 492, elk 200, dagre 116, cytoscape 172, sigma 68 ms; dagre layout 3.5 ms.

## Recommendation

Build R8 on `@xyflow/react` with `@dagrejs/dagre`. It has the lowest layout time, an FCP a quarter of the incumbent's on the p95 graph, pans at vsync on every graph, and is 121 KB gzip against the incumbent's 2.4 MB. The incumbent is itself built on React Flow (its nodes are `.react-flow__node-table` and `.react-flow__node-column`), so table cards, column handles, edge styling and the fit and zoom controls carry over as React components instead of being redrawn. `elkjs` adds 420 KB gzip and 24 ms of layout for no difference at these sizes; revisit it only if edge routing between column handles needs orthogonal routing. The harness's `xyflow.jsx` and `xyflow-dagre.jsx` are the starting point.

## Reproduce

```sh
cd scripts/spikes/lineage-renderer
npm install
node analyze.mjs <project>/target/info_schema/v1 data 1
FPU_WEBVIEW_PANELS="$PWD/../../../webview_panels" npm run build
node run.mjs 3 p50,p95,max
node report.mjs
```

`run.mjs` checkpoints samples in `out/samples.json` and skips completed ones; delete it to measure again.
