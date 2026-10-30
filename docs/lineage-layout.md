# Lineage layout: where the panel differs from the design gallery

> **Stale.** Lineage Phase A deleted the owned layered engine (`layered.ts`, `layeredFlow.ts`, `gutterRouter.ts`), its parity test and the `classic` engine. The panel now lays out with the graph-layout engine. The counts and module references below describe the owned engine as it was; the page is kept as a record until it is rewritten for graph-layout.

The design gallery (`spike/gallery/designs.html`, design M, table mode) is the reference for the layered lineage layout, and this page records where the shipped panel differs from it and why. The fixture `src/test/fixtures/lineage-layers` reproduces the gallery's neighbourhood around `int_orders__enriched`. `webviews/src/modules/lineage/lineageLayers.parity.test.ts` runs the real layout (`layered.ts`, `layeredFlow.ts`) and gutter router (`gutterRouter.ts`) on that fixture, and `src/test/smoke/lineageLayers.test.ts` records the same view in the host. Each difference below is asserted at the panel's actual value in the parity test, not at the gallery's value.

## Counts

The gallery's counts were measured in a live browser run of `designs.html?round=2&variant=M&mode=table&deps=<value>`, with the default theme. Crossings use the sampling test from `spike/gallery/check-edges.mjs`: each path is sampled at 60 points, and two paths count once when their polylines cross away from their shared ends. Hops are read from `data-hops` on `.layer`. The crossings count table and relationship paths together, since the declared relationships are drawn as `path.edge.rel`; table paths alone give 0 crossings under `both`. `check-edges.mjs` counts only `path.edge.table` and passes no `deps` or `mode`, so it draws the default `dbt` view in column mode and never measures `both`. The panel's counts come from `layeredFlow`, which returns the crossings and hops its gutter router counts over the same routes.

| Connections | Gallery (measured)             | Extension, as drawn            |
| ----------- | ------------------------------ | ------------------------------ |
| `dbt`       | 12 edges, 0 crossings, 0 hops  | 11 edges, 3 crossings, 3 hops  |
| `declared`  | 5 edges, 1 crossing, 1 hop     | 5 edges, 0 crossings, 0 hops   |
| `both`      | 17 edges, 13 crossings, 8 hops | 16 edges, 12 crossings, 7 hops |

The gallery's 12 `dbt` edges include the edge from `int_orders__enriched` to the hidden `audit_log`, which the panel does not draw (next section). With that edge added to the panel's input, `both` gives 17 edges, 13 crossings and 8 hops.

The panel's `dbt` crossings are not zero because three edges skip a row whose card sits over the start card's corridor: the seed and the shop source into `int_orders__enriched` pass `stg_shop__orders`, and `int_orders__enriched` into `fct_orders` passes `dim_customers`. Through the corridor each would run under that card, so `spine` in `gutterPlan.ts` routes it through the nearest clear gap between the cards in the rows it skips, and it crosses other edges there. The parity test asserts that no edge runs under a card it does not join, under every Connections setting.

## Hidden tables keep their card and lose their edges

`audit_log` sets `meta.lineage.hidden: true`. The panel draws its card, with the hidden marker, but `edgesAmong` in `graph.ts` leaves out every edge with a hidden end, so `dbt` shows 11 edges, not 12. The gallery draws the hidden card with a dashed border at 0.65 opacity (`.r2 .card.hidden`, measured) and includes its edge in the count; the panel does not draw that edge.

## A node from another package

The gallery's `daily_revenue` belongs to a `finance_pkg` package. The panel does not drop such a node: `lineageTables.ts` sets `rootPackage` from the project's own package, and a card shows its package name when the package is not the project's. The fixture keeps `fct_finance__daily_revenue_by_region_and_channel` in the root project. A second package needs a nested `dbt_project.yml` and a `local:` package dependency, which makes the fixture a multi-project workspace, changes the project count in `fixturesSmoke.test.ts` and changes how the nested project is discovered. It was not added for this fixture.

## Groups and chips

The gallery's design data has two fixed group nodes, `g:finance` and `g:payments`, and a `backend 2/5` chip on `int_orders`. In table mode it draws ten cards and neither group node nor chip (measured): its table-mode edges keep only the ends in `NODES`, which drops the two group ends, and design M's cards set `chips: false`. The panel groups neighbours only when one expansion adds more than `fusionPowerUser.lineage.maxNeighbours` (default 20). Under `fusionPowerUser.lineage.groupBy` set to `folder` (the default), each folder of two or more becomes one group node, and an open group shows as a chip on its expanded table. The fixture's start model has nine neighbours, under the cap, so it draws no group node and no chip. The gallery's fixed groups are not reproduced.

## Column lineage

The gallery draws the traced column `amount` on its cards in column mode. Table mode traces no column (the gallery clears the trace classes, and a measured table-mode run has none). In the panel, a table's column list opens when the user toggles it, and a column trace sends a `getConnectedColumns` request from the webview to the host (`lineagePanel.ts`), which `DbtLineageService` answers. Neither happens by default, and neither runs in the parity test or in the smoke checkpoint, which covers the table view only. `AGENTS.md` says column-level lineage is not implemented; that statement is about the manifest parsers in `src/core/manifest/`, while the traced-column feature described here is shipped.

## Relation line and subtitle

The gallery writes each card's relation as `DEV_STAGING.shop`. The panel writes `database.schema · materialization · package`, with a dot, and shows that subtitle on the start card and on a selected card only (`showRelation` in `TableNode.tsx`). The smoke checkpoint records the start card's subtitle; the other cards record their title and file line.

## Card width

Design M's cards are 220px (`--w: 220px` from the M node function, and an unscaled offset width of 220 in a browser run). The panel's `geometry.tableWidth` in `layout.ts` is 280px, so the widths differ, and the panel keeps its own width. Design D is the 240px variant. Card heights depend on the header, the actions row and the chips; the gallery's heights are not compared with the panel's.

## Layout order and router

Design M lays out its cards with the corridor layout in `designs.html` (`v.corridor`): a card's row is its generation from the focus, split into sub-rows by dbt layer, and its side is left or right of the corridor. The dagre call that runs first is overwritten for this design. The panel's `layered.ts` makes the same row and corridor choices, and `gutterRouter.ts` routes the edges. The two order a row's cards by different rules and count crossings differently, so the counts differ: on the same fixture the gallery draws 13 crossings and 8 hops under `both` and 1 crossing and 1 hop under `declared`, while the panel draws 12 and 7 under `both` and 0 and 0 under `declared`. Under `dbt` the panel routes three skip edges round the cards over the corridor (see "Counts"), which adds crossings the gallery does not draw; I have not checked how the gallery routes those edges. The gallery's side placement also reads the declared edges (`LAYOUT_EDGES`), while `layeredFlow` receives only the rank edges, so under `both` the panel's sides do not see the relationships. The parity test asserts the panel's own values and does not assert the gallery's.

## Card sides

Under `dbt` and `both` the panel's rows match the gallery's, and three sides differ: the shop source and the seed in row 0, and `stg_shop__orders` in row 1. Measured in the gallery, the source is on the right, the seed on the left and `stg_orders` on the right; the panel has them on the left, the right and the left. The gallery's split sends a card whose offset from the start is zero to the right (`x >= 0`), then moves cards between the two sides until they differ by at most one (`designs.html`, around lines 961 to 963). `splitSides` in `layered.ts` sends such a card to the lighter side, left when the two are equal, and has no balancing step. The three cards differ by that rule. This is traced from the code; I did not run the layout with the rule changed. The Other column (`audit_log`) is on the left in both: `layeredFlow` keeps the left attempt when the two draw the same number of crossings. The parity test asserts the panel's sides.

## Declared-only rows and hops

Under `declared` the panel ranks the cards by the relationships (`rankingEdges` in `flow.ts`: the referenced table ranks above the declaring one). The gallery ranks by its dbt edges in every mode, and its card centres do not change between `dbt`, `declared` and `both` (measured). So the panel's declared rows differ: `dim_customers` sits in row 0, above the start card in row 1, and the rows run from 0 to 6. That is the panel's real output; no design shows it. The gallery draws the declared-only case with one hop; the panel draws it with none. The parity test asserts the panel's rows and its zero hops. I did not run a layout with the gallery's ranking, so the hop difference is attributed to the rows only by inference.

## Error chip on a card

The gallery shows a warning chip on `dim_customers`. The panel shows a warning only when the host reports a lineage error for that table (`lineageBodies.ts`, `describeNoLineage`). A static dbt fixture produces no such state, so the fixture does not reproduce it.

## Declared relationships

The five declared relationships are `meta.relationships` entries: four on models and the shop source's `customer_id -> user_id`. The panel titles a relationship with its column pair and its source label (`relationshipMarks.ts`, `relationTitle`), so the column names it shows are the declared ones.
