# Lineage layout roadmap

One ordered plan for the lineage panel and the layout engine, combined from:

- the Rust ADR and its phased plan: [ADR 0011](../adr/0011-graph-layout-in-rust.md), [graph-layout-rust-plan.md](graph-layout-rust-plan.md);
- the engine scout (refactors 1 to 9, `packages/graph-layout`) and the panel scout (R1 to R10, `webviews/src/modules/lineage`);
- three research reports: [layout-performance-references.md](../research/layout-performance-references.md), [lineage-layout-controls.md](../research/lineage-layout-controls.md), [obstacle-avoiding-edge-routing.md](../research/obstacle-avoiding-edge-routing.md).

The owner's answers are in [lineage-layout-decisions.md](lineage-layout-decisions.md) and are applied below.

## What is already done

- **Solver speed-up (PR #511, merged).** Block-local multiplier checks and plain indexing in VPSC. A full `balanced` layout of the 1,122-node finance graph went from 34.7 s to 4.6 s with identical output (0 node and 0 edge-point differences, 28,353 crossings both). This is item 2 of the Rust plan's Phase 0.
- **Other cards (#510)** and **shown-document didOpen gate (#509)** are on `dev`.

## Decisions already made by the owner

- Rust is the product engine; there is no speed gate (ADR 0011, decision 1). It is a standalone library that runs in a browser and natively.
- The `classic` engine and the `leftToRight` layout are removed. No deprecated path is kept.
- Every layout and visibility choice becomes a panel control that can be adjusted live where it is cheap enough. Maximising the information shown is the goal.
- A collapsed busy node keeps its card; its edges become low-weight attraction that does not rank. An excluded node (for example a `normalize_timestamp` function) is removed from lineage entirely.
- Layout results are cached and seed the next layout.
- **Panel defaults (Q13 to Q19).**
  - Hiding a card also hides the cards drawn only through it.
  - Excluding a node drops it and its edges; its parents are not linked to its children.
  - Hidden cards are remembered per workspace, for every start model.
  - The busy-node threshold is `lineage.maxNeighbours`.
  - Exclusion rules are dbt selectors, resolved by dbt. The default rule excludes functions and macros (`resource_type:function resource_type:macro`).
  - Nested cluster boxes are grouped by folder by default; schema, package, and a tag or meta key are the other choices.
  - The default view is the whole project, centred and zoomed on the open model so its neighbourhood is readable.
- **Engine (O-1 to O-12, D-attr)** as recorded in ADR 0011, "Owner decisions". Two of them change this roadmap. Parity with TypeScript is on outcomes, with a discrepancy report, not on bits. Any edge kind or edge group can be switched off and the graph re-laid out.

## Changes to the Rust plan

The Rust plan stands except for these changes:

1. **Phase A (new, first): remove `classic` and `leftToRight`.** The Rust plan's Phase 6 no longer ports `classic`.
2. **Phase B (new): fix routing through foreign cluster boxes,** in TypeScript before the port, so the port copies a correct router. The routing report found edges crossing a foreign cluster box in 177 of 200 clustered random graphs.
3. **Panel controls (Phase E)** are added from the controls report. The Rust plan had none.
4. **Phase 9 gains** nested clusters, collapsing a cluster into one card, automatic communities, and the hybrid local router for modes with no free channel.

## Phases

| Phase  | Scope                                                                              | Engine                | Check                                                           |
| ------ | ---------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------- |
| A      | Remove `classic`, `leftToRight` and dagre                                          | TypeScript            | `just check`; `just smoke-docker`; `lineage.js` ceiling lowered |
| B      | Edges never cross a foreign opaque box; every edge routed or flagged               | TypeScript            | Box-crossing oracle on the drawn path; property tests           |
| C      | Engine preparation (Rust plan Phase 0 minus item 2, now done)                      | TypeScript            | `just check`; finance output bit-equal before and after         |
| D      | Panel groundwork (R1 to R6, R10)                                                   | TypeScript            | `just webviews::test`; projection snapshot unchanged            |
| E      | Panel controls, scope first                                                        | TypeScript            | Controls tests; `just smoke-visual`                             |
| 1 to 8 | Rust: scaffolding, port per phase with parity, engine handle, bindings and cutover | TypeScript, then Rust | As in the Rust plan                                             |
| 9      | New engine features                                                                | Rust                  | Per feature, as in the Rust plan, plus the items below          |
| 10     | Retire the TypeScript engine from the product                                      | Rust                  | As in the Rust plan                                             |

Phases A, B and D can run in parallel with C. Phase E needs D. Rust Phase 1 can start alongside C.

### Phase A: remove `classic` and `leftToRight`

Delete:

- `webviews/src/modules/lineage/engine/ownedEngine.ts` and the modules only it uses: `layeredFlow.ts`, `layered.ts`, `layeredRows.ts`, `layeredRanks.ts`, `gutterRouter.ts`, `gutterPlan.ts`, `channels.ts`, `routeTypes.ts`. Keep `layeredMetrics.ts` only for constants the graph-layout adapter still reads, or move them into the adapter. Keep `routeGeometry.ts` if `routeDrawing.ts` still uses it.
- The dagre `layout()` in `webviews/src/modules/lineage/layout.ts` and the `@dagrejs/dagre` dependency.
- `classic` from `fusionPowerUser.lineage.engine`, and the `fusionPowerUser.lineage.layout` setting.
- Every `layered`/`leftToRight` branch in `flow.ts`, `Canvas.tsx`, `fit.ts`, `useCanvasFit.ts`, `viewModel.ts`, `layoutRequest.ts`, the contract (`LineageLayout`) and `src/features/lineage/lineageSettings.ts`.
- The classic column in `just smoke-engines` and `scripts/smoke/engine-sheet.mjs`, and the tests that cover only the removed code: `gutterRouter.test.ts`, `layeredFlow.test.ts`, the owned-engine checks in `lineageLayers.parity.test.ts`, and the leftToRight test in `src/test/smoke/lineageGrouping.test.ts`.

Then lower `dist/webview/assets/lineage.js` in `scripts/quality/ceilings.json` to the new measured size. Close issue #503 as resolved by deletion.

**Check.** `just check`; `just smoke-docker`; knip reports no unused export.

### Phase B: no edge crosses a box it does not belong to

From the routing report's recommendation:

1. A per-box policy: lineage layer bands are transparent (an edge from staging to marts must cross intermediate). A cluster box the product means as a wall is opaque, and an edge may enter only the boxes that contain its source or target (the ancestor rule).
2. Keep long-edge dummies outside opaque foreign boxes across every rank they span, in ordering and placement. Mark those box intervals as blocked in each gap channel.
3. The engine returns a checked polyline or `routeFailed` for every edge, self-loops included. The panel never substitutes a bezier (remove `getBezierPath` from `RelationshipEdge.tsx`).

**Check.** `measureDrawing` gains an edge-against-opaque-box count, using a strict-interior test plus a clearance test, measured on the drawn path after corner rounding and hops. Property tests run under rows and levels, both directions, nested clusters, ports and long edges. A test checks that every input edge is drawn or flagged. `rowsGolden` is unchanged for cluster-free graphs.

### Phase C: engine preparation

The Rust plan's Phase 0, without item 2 (done in #511):

1. Move VPSC into `src/solve/` (scout 1).
2. Incremental block merging and a warm-started projector (scout 3). Spike first, then measure: the solver is still quadratic on merging chains.
3. One `Budget` per run (scout 4).
4. Index the input once; layering becomes its own phase (scout 5).
5. Across-axis strategy chosen once; routing rebuilds boxes through placement's entry (scout 6).
6. Objective terms that accept attractions (scout 7), stable keys for dummies (scout 8), components as a unit of layout (scout 9), each with today's output when unused.
7. The sort and iteration-order audit (Rust plan item 7). The `sqrt` association change is dropped: parity is on outcomes.

**Check.** As in the Rust plan Phase 0.

### Phase D: panel groundwork

The panel scout's R1 to R6 and R10, as listed in the Rust plan's Phase 0.9: one meaning for "hidden", one visibility projection, layout input split from decoration, a layout cache that feeds back hints, one layout per rebuild, layout independent of the open file and selection, and a weighted unrouted hint edge. R7 (host adjacency and exclusion in one place) is added here because Phase E's exclude control needs it.

**Check.** As in the Rust plan Phase 0.9.

### Phase E: panel controls

From the controls report. Scope comes first, then emphasis, then a small set of layout settings with presets. Defaults are starting points to measure on real projects.

| Group    | Control                                                                                       | Default                 | Cost class                                    |
| -------- | --------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------- |
| Scope    | View: whole project centred and zoomed on the open model, or neighbourhood (depth and budget) | whole project           | Relayout                                      |
| Scope    | Upstream and downstream depth around the focus (neighbourhood view)                           | 2 and 2                 | Relayout, debounced                           |
| Scope    | Card budget, filled by degree of interest (neighbourhood view)                                | about 150               | Relayout                                      |
| Scope    | Filters by node type and tag                                                                  | all on                  | Relayout                                      |
| Scope    | Hide this card and the cards drawn only through it (workspace state, listed for restore)      | none hidden             | Relayout                                      |
| Scope    | Busy-node list ranked by degree, each with hide / soften / dim                                | `lineage.maxNeighbours` | Relayout for hide and soften; restyle for dim |
| Scope    | Exclude rules as dbt selectors, resolved by dbt; edges of an excluded node are dropped        | functions and macros    | Relayout                                      |
| Scope    | Edge groups on or off (each edge kind, attraction, column edges, a named group)               | all on                  | Relayout                                      |
| Scope    | Transitive reduction, removed edges as dim hints                                              | off                     | Relayout                                      |
| Emphasis | Path highlight, dim off-path, hub de-emphasis, edge opacity                                   | off                     | Restyle only, live                            |
| Layout   | Effort ladder: `fast` while interacting, `balanced` on settle, `thorough` on request          | ladder on               | Relayout                                      |
| Layout   | Partitions: soft, none, strict (labelled costly)                                              | soft                    | Relayout                                      |
| Layout   | Relationship-edge weight and "constraint only"                                                | weight 1, ranks off     | Relayout                                      |
| Layout   | Column-edge weight                                                                            | 0.5                     | Relayout                                      |
| Layout   | Spacing preset: default, compact                                                              | default                 | Relayout                                      |
| Layout   | Stability on expansion                                                                        | on, weight 1            | Relayout                                      |
| Layout   | Nested cluster key: folder, schema, package, tag or meta key, none                            | folder                  | Relayout                                      |
| Presets  | Named presets per view and a global default, undo per change, crossings/bends/density readout | built-in presets        | —                                             |

Edge bundling and Graphviz-style `concentrate` stay out, because bundles can suggest dependencies that do not exist.

**Exclusion through dbt selectors.** The host resolves each rule by asking dbt for the matching unique ids (the language server's `dbt.listNodes`, which takes selectors, or `dbt ls --select` when the server is not running) and caches the result per manifest. The panel receives ids only, never selector syntax. Functions and macros are excluded by the default rule, not by a special case. Whether `dbt.listNodes` and `dbt ls` on Fusion 2.0.6 and later return macros for `resource_type:macro` is checked first; if they do not, the default rule says so in the panel and the gap goes into `docs/lsp-metadata-gaps.md`.

**Check.** A vitest test per control that it changes only what its cost class allows: restyle controls never call the engine, relayout controls reuse the cache's hints. `just smoke-visual` captures each preset.

### Rust Phases 1 to 8 and 10

As in [graph-layout-rust-plan.md](graph-layout-rust-plan.md), with Phase 6 limited to `balanced` and `thorough`.

### Phase 9: new engine features

The Rust plan's 9a to 9f (attraction edges, excluded nodes, stable dummy keys, components and packing, wrapped rows, quotient overview), plus:

- **9g Nested clusters in the panel:** folder boxes inside layer bands by default; schema, package, or a tag or meta key by the control (Q18).
- **9h Collapse a cluster** into one summary card with merged edge counts.
- **9i Automatic communities** (Louvain or Leiden) as an optional grouping key for projects whose folders do not follow lineage.
- **9j Hybrid local router** for pieces with no free channel (levels' upward runs, edges between wrapped sub-rows, attraction and relationship edges between non-adjacent ranks): a sparse scanline visibility graph over the affected span only, as in MSAGL, A* with a bend penalty, padding, then nudging with the package's VPSC solver. Interval trees or an R-tree only for these regions; per-rank sorted arrays elsewhere. Re-route only the pieces whose band or obstacle set changed.

Each keeps the Phase B box-crossing oracle green.

## Still open

- The tolerance for each outcome gate, set when the first discrepancy report exists (Rust Phase 2).
- The wrapped-rows design (O-8), after spike S9.
- Routes to threads in the browser (O-11), from spike S3 and its research.
