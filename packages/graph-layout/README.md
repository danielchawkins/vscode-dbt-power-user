# @fusion-power-user/graph-layout

Layered layout and orthogonal edge routing for directed graphs whose edges come in kinds. Some kinds rank the nodes (dependencies); others are drawn and routed but never move a node to another rank (declared relationships such as foreign keys). Nodes have their own sizes and may carry ports, for example one per column row. Nodes may belong to nested clusters and to ordered partitions. A previous result can be passed back as hints, so a graph that grows by expansion keeps its shape.

The package is pure TypeScript with no runtime dependencies. It reads no DOM, Node or clock API, so it runs unchanged in a browser, a worker and Node. The extension's lineage panel is one consumer and is not special: nothing here names dbt, React or React Flow.

It is private to this repository and not published; `package.json` keeps `"private": true` until the owner decides otherwise. The licence is MIT, as the extension's.

> Status: the types (`src/types.ts`), the named presets (`src/presets.ts`), `validateGraph`, the drawing metrics (`measureDrawing`, `compareDrawings`) and `layout` exist. The phases behind `layout` are listed in "Build order".

## Use

```ts
import { layout, layoutPresets } from "@fusion-power-user/graph-layout";

const result = layout(
  {
    nodes: [
      { id: "orders", width: 260, height: 120, ports: [{ id: "id", side: "east", offset: 66 }] },
      { id: "customers", width: 260, height: 90, ports: [{ id: "id", side: "west", offset: 66 }] },
    ],
    edges: [
      { id: "d1", source: "orders", target: "customers", kind: "dependency" },
      { id: "c1", source: "orders", sourcePort: "id", target: "customers", targetPort: "id", kind: "column" },
    ],
  },
  {
    ...layoutPresets.circuit,
    direction: "right",
    edgeKinds: {
      dependency: { ranks: true },
      column: { ranks: false, weight: 0.5 },
      relationship: { ranks: false, weight: 0.3 },
    },
    anchor: "orders",
  },
);
// result.nodes, result.edges (orthogonal polylines), result.clusters, result.bounds, result.metrics, result.hints
```

Pass `result.hints` as `hints` on the next call, with `stability` to weigh them against edge length.

Every call is a pure function of its graph and options: the engine keeps no state between calls, so a caller that wants a preset merges it with its own options and calls `layout` again.

## Ports and sides

Sides are absolute, in the drawing's frame: `north` is the top of a node, `east` its right, whatever `direction` is.
A port sits on one side at an `offset` from that side's start (its top for east and west, its left for north and south); the offset must lie within the node's extent on that side.
Column rows are ports on a fixed side of their card, so a card keeps its rows where they are drawn, whichever way the ranks run.

An edge that names a `sourcePort` or `targetPort` leaves or enters the node on that port's side.
An edge that names no port uses the default side of its kind: `EdgeKindPolicy.sourceSide` and `targetSide`.
Omitted, the engine picks the side that faces the other end in `direction`.
Nothing is hard-coded to east-out and west-in: `direction: "down"` with a kind that sets `sourceSide: "south"` leaves a node downwards.

## Partitions

`LayoutNode.partition` orders nodes into bands, and `LayoutOptions.partitions` says how strictly the order binds.
`none` ignores partitions. `soft`, the default, penalises a backward crossing of a boundary in the ranking. `strict` forbids it: every node of a lower partition sits in an earlier rank than every node of a higher one.
The lineage panel will expose this as a setting that lays the view out again when it changes; the setting is not wired yet.

## Presets

`layoutPresets` is a plain object of named option sets: `circuit` and `compact`.
A preset sets only the options that describe a drawing's look (`effort`, `spacing`, `partitions`, `stability`, `seed`); it never sets `direction`, `edgeKinds`, `anchor` or `hints`, which belong to one graph.
The caller merges a preset with its own options, as the example does, and may override any field.
`circuit` is orthogonal with few crossings: it searches the ordering phase hardest (`effort: "thorough"`) and packs nodes at moderate spacing.
`compact` is orthogonal and packed into the least area: a quick search (`effort: "fast"`) and the tightest spacing.
Both values are starting points; the evaluation harness tunes them against the golden graphs.

## Hints

`result.hints` fed back as `hints` on the same graph with the same options reproduces the result as follows. These bounds are measured by `layout.test.ts` and `layoutResult.test.ts`, not proved.

- Ranks: always reproduced. Measured on random graphs under both `ranks` values, both directions and both suites.
- Real-node order: reproduced for route graphs, unless the hinted search finds an order with strictly fewer weighted crossings, which it keeps. The hinted order with its dummies re-sifted is always a candidate, so an order is never traded for one that is merely as good. The unhinted search also runs, so the order of the run that produced the hints is a candidate even where its dummies cannot be reached from the hinted seed one move at a time ("keeps the order when a long edge's dummies must move together" in `layoutResult.test.ts`). For clustered graphs it is not reproduced: the cluster blocks are re-derived from the hints, and an order hint is a preference the search may override. "documents the clustered limitation" in `layoutResult.test.ts` shows one such graph.
- Positions: reproduced only where the layered order, dummies included, repeats. `LayoutHints` carries no dummy order, so the dummies are re-derived, and the order can change when the hints are fed back. The field cannot be added without changing the shape of `LayoutHints`, which is why this stays a limitation of the hints.
- Where the layered order repeats, no node moves more than two smallest node extents. A suspected cause of the remaining movement is the placement solver's stopping rule, which can leave the second solve a little short of the first.

## Guarantees

- Deterministic: the same graph, options and `seed` give the same result. No `Math.random`, no clocks (ast-grep rule `ts-graph-layout-deterministic`).
- No overlaps: under `ranks: "rows"` no two nodes overlap, and no edge passes through a node it does not end at (`metrics.overlaps` is zero). Under `ranks: "levels"` no two nodes overlap, but an edge can pass through a node it does not end at: a run that goes upward can cross other nodes. `layoutResult.test.ts` counts these ("documents the levels limitation"), and the property tests assert the rest on random graphs.
- Orthogonal edges: every polyline alternates horizontal and vertical segments, and starts and ends at its ports.
- Standalone: the package imports only itself (dependency-cruiser rule `graph-layout-is-standalone`), and its `tsconfig.json` has no DOM or Node types.
- Input is checked before layout: `validateGraph` reports every problem at once, including port sides and offsets and kind default sides that are not valid.

## Metrics

`measureDrawing(drawing)` measures any drawing, whichever engine made it, so two engines can be compared on the same terms. It runs without a layout.
A `Drawing` holds `boxes`, a map from node id to `Rect`; `paths`, a map from edge id to `{ points, source, target }`, where `points` runs from the source end to the target end and `source` and `target` name the nodes it joins; and optionally `trunkOf` and `ranks`.
It returns a `LayoutMetrics`:

- `crossings`: pairs of pieces of different edges that cross properly, meaning a horizontal and a vertical piece meet at a point strictly inside both. Touching at an end does not count, and an edge never counts against itself.
- `bends`: interior points where the direction turns or reverses. Points that continue a straight run are merged into it first, so they are not bends.
- `edgeLength`: the sum of the Euclidean lengths of the polylines.
- `area`: the width times the height of `bounds`, the smallest rectangle holding every box and every point.
- `density`: the total node area over `area`; zero for an empty drawing.
- `overlaps`: node pairs sharing interior area, plus pairs of an edge and a node the edge does not end at, where a piece of the edge runs through the node's interior.

Trunk grouping: `trunkOf(edgeId)` returns the trunk of an edge, such as its source port. Edges with the same trunk never count crossings against each other.
An edge with no trunk, because `trunkOf` is absent or returns undefined, shares a trunk with no other edge.
The count sweeps all pieces once and then once per trunk group, so it stays O(S log S) in the number of pieces S.

`compareDrawings(before, after, options)` compares two drawings of one graph, for example before and after an expansion. It returns:

- `retained`: the number of nodes both drawings hold.
- `meanDisplacement` and `maxDisplacement`: the distance between the centres of each retained node in the two drawings.
  With `anchor`, a node both drawings hold, `after` is first shifted so the anchor's centre coincides with its centre in `before`; a translation of the whole drawing then costs nothing. Without `anchor`, no shift is applied.
- `orderFlips`: pairs of retained nodes that overlap along the rank axis in both drawings and whose order across the ranks changed.
  `direction` names the direction the ranks run. `down`, the default, puts ranks in rows: bands are compared along y and order is read along x. `right` puts them in columns: bands along x, order along y.
- `rankChanges`: the number of retained nodes whose rank changed. It is counted only when both drawings carry `ranks` (rank by node id); otherwise it is undefined.

## Pipeline

Each phase is a module with its own tests; `layout` composes them.

| Phase | Module | Method | Source |
| --- | --- | --- | --- |
| Validate | `validate.ts` | Every issue at once | — |
| Cycle removal | `acyclic.ts` | Greedy feedback arc set over ranking edges | Eades, Lin and Smyth, *IPL* 47(6), 1993 |
| Ranking | `rank/networkSimplex.ts` | Network simplex with minimum lengths and weights; partitions as gate nodes (strict) or hinge penalties (soft); rank hints as a rigid reference chain with one mediator node per hinted node | Gansner, Koutsofios, North and Vo, *IEEE TSE* 19(3), 1993 |
| Long edges | `layering.ts` | Dummy chains per bundle (one bundle per kind and node pair); lateral ports through port dummies | Pupyrev, Nachmanson and Kaufmann, GD 2010 (bundling); Schulze, Spönemann and von Hanxleden, *JVLC* 25(2), 2014 (ports) |
| Ordering | `order/` | Port-aware weighted median and barycenter sweeps, transpose, then sifting; clusters kept contiguous; seeded restarts at `thorough`; previous order as the start | Eades and Wormald, *Algorithmica* 11, 1994; Gansner et al. 1993; Matuszewski, Schönfeld and Molitor, GD 1999; Forster, GD 2002; North and Woodhull, GD 2001 |
| Crossing count | `order/crossings.ts` | Accumulator tree, weighted | Barth, Jünger and Mutzel, *JGAA* 8(2), 2004 |
| Placement | `place/`, `constraints/` | One constraint layer per axis (desired positions, weights, separations, equalities) solved by VPSC. In-rank: quadratic objective (weighted edge length with port offsets, long-edge straightening weights 1/2/8, hint anchors), ordered separation constraints per rank and cluster boxes, solved by scaled gradient projection with a Brandes–Köpf warm start. Across: stacked rows (`ranks: "rows"`, the default), or levels (`ranks: "levels"`): each node's desired row, directed separations on ranking edges outside cycles, and overlap separations | Dwyer, Koren and Marriott, *IEEE TVCG* 12(5), 2006; Dwyer, Marriott and Stuckey, GD 2005; Brandes and Köpf, GD 2001, with the erratum of Brandes, Walter and Zink, arXiv 2008.01252; WebCola's directed edge constraints (MIT), which the directed separations follow |
| Routing | `route/` | Channel routing between ranks: hyperedges are stars: a run joins the first star whose members all still share an upper or a lower point with it, otherwise it starts one, so grouping follows the order of the pieces and never chains an upper point to a lower one; each star takes one track; a star that touches another hyperedge in the order chosen, where the reverse order would not, is split into single runs and placed again; a preference order that ranks a touch above a crossing, with cycles broken at the fewest unmet touch preferences; left-edge track assignment; rank gaps sized from track counts. Doglegs (`doglegs.ts`): a run alone in its hyperedge may jog at an in-rank column to a second track, which may be a new one below the others; a jog is kept only where the run's crossings plus touches fall and neither count rises, so the band's crossings stay exact. Lateral ports' stubs run in the owner's rank, and the crossings they make with one another are counted here (`stubs.ts`). The collinear-overlap property in `route/index.test.ts` has no exemption. Stars of several runs are not jogged, and self-loops are not yet done | Sander, GD 2003; Hashimoto and Stevens, DAC 1971; Yoshimura and Kuh, *IEEE TCAD* 1(1), 1982; Deutsch, DAC 1976 |
| Metrics | `metrics.ts` | Geometric crossings, bends, edge length, area, density, overlaps; displacement and order flips between two results | — |

Rejected, with the reason:

- Kernighan–Lin and Fiduccia–Mattheyses refinement: built for cut minimisation of a partition. In a layered drawing the same local search is transpose and sifting, which target crossings directly.
- Multilevel ordering: pays off on graphs of thousands of nodes; the spike's sweeps take under 30 ms at 600 nodes.
- Kraftwerk-style spreading: needed when quadratic placement has no ordering to legalise against; within ranks, the ordered separation constraints already legalise exactly.
- PathFinder or A* grid routing: every edge here follows a dummy chain through the ranks, so each piece lies in one channel and channel routing is exact for it. A grid router is for free-placed nodes, which this engine does not produce.
- WASM: the spike's slowest phase at 600 nodes with columns is under 100 ms in plain TypeScript.
- Direction-relative port sides (before, after, left, right): a port belongs to its card's shape, and column rows stay on the same side of a card whatever the direction, so absolute sides match the drawing's frame.

## Build order

1. Types, presets, `validateGraph`, package wiring and boundary rules: in place.
2. `measureDrawing` and `compareDrawings`, the geometric metrics, so every later phase is measured: in place.
3. Ranking: cycle removal, network simplex, partitions, rank hints: in place.
4. Ordering with ports, then sifting, and clusters kept contiguous: in place. Each cluster's members stay one unbroken run in every rank: the cluster blocks are ordered by barycenter, recursively for nested clusters (Forster, GD 2002), and transposition and sifting move only between legal slots (`order/clusters.ts`). A cluster that spans a rank with no member of its own gets a dummy there, chained to its members above and below, so that its box stays contiguous across the ranks it spans (`spines.ts`).
5. Placement: in place. Node centres along each rank from the quadratic objective, with the Brandes and Köpf warm start and the effort caps. Cluster boxes: in place. Each box's left and right edges are variables of the projection, constrained to keep its members inside with its padding and room for its label, nodes beside it outside, its parent's box and its siblings in their fixed order (`place/boxes.ts`). After the solve each edge is pulled in to its outermost member or nested box, with its padding (`tightenBoxes`). The projection solves these separation constraints with VPSC's active-set block merge (Dwyer, Marriott and Stuckey, GD 2005, `place/vpsc.ts`). Each box's rectangle is returned by cluster id in `Placement.clusters`. A lateral port dummy belongs to its owner's block: a real node's gap to the next block is at least `spacing.node`, and only gaps inside a block use `spacing.edge` (`place/ports.test.ts`).
6. Channel routing: in place. A run joins the first star whose members all still share an upper or a lower point with it, otherwise it starts one; a star shares one track and never chains an upper point to a lower one, so unrelated runs do not chain. A star that touches another hyperedge in the order chosen, where the reverse order would not, is split into single runs and placed again. Each band orders its hyperedges by preference (a touch costs more than a crossing) with cycles broken at the fewest unmet touch preferences, and ranks are re-stacked to the band widths, so each routed edge is an orthogonal polyline. Cluster boxes are recomputed from the re-stacked centres, so they still hold their members, and no edge runs through a node. Lateral ports are in place: a port on a side lateral to the flow gets a dummy beside its owner in the owner's rank, ordered by port offset (`layering.ts`, with the block kept contiguous in `order/` and placement). Its edge leaves the side at the port offset and runs to the dummy, and the stubs' crossings with one another are counted (`route/stubs.ts`). Doglegs (Deutsch, 1976) are in place for a run alone in its hyperedge: it may jog at an in-rank column to a second track, which may be new, and the jog is kept only where the run's crossings plus touches fall and neither count rises. The channel's crossings count the jog's segments, so they match `measureDrawing`, and `doglegs.test.ts` checks on 200 seeded bands that doglegs never add a crossing and lower the total. Stars of several runs are not jogged. Two runs that swap ends (they meet the same two in-rank positions in opposite order) still share a vertical: the only jog that separates them trades the overlap for a crossing, which the jog rule refuses, so the collinear-overlap property in `route/index.test.ts` excuses exactly that pair. Doglegs bound their work by one budget per band. Self-loops are not yet done.
7. Constraint layer: in place (`constraints/`). Each axis is one problem: desired positions, weights, separations and equalities. Equalities are reduced to classes first, and a cycle the merge closes is reported by name, because the solver takes only DAGs. `ranks: "rows"` (default) keeps the stacked rows, byte for byte (`route/rowsGolden.test.ts`). `ranks: "levels"`: no shared row per rank; each node sits at its rank's row as a desired position, directed separations run down every ranking edge outside a strongly connected component, and overlapping nodes stay apart on whichever axis they already separate. Routing under levels draws each run in the gap between its two ends, with its horizontal part at the gap's midline. A run that goes upward from its lower end leaves beneath both nodes, and its horizontal part can still pass through other nodes: that is a stated limitation of this route.
8. `layout` composes the phases: in place (`layout.ts`, `phases.ts`, `result.ts`). It validates first and throws `LayoutInputError`, which carries every issue. Its result has node rectangles (the routed centre minus half the size, with `rank` and the real-node `order`), one rectangle per partition present, cluster boxes, the edges that are drawn, the hints and the metrics. The property tests are in `layout.test.ts` and `layoutResult.test.ts`, under both `ranks` values and both directions.
9. The panel adapter: in place (`webviews/src/modules/lineage/engine/graphLayoutEngine.ts`). `fusionPowerUser.lineage.engine` chooses `balanced` (the default) or `thorough`. The adapter makes each dbt layer both a partition and a cluster, and draws each cluster box as the layer's band. Box edges are pulled in to their members after the in-rank solve, since the objective has no term for them, and under rows each rank gap holds the boxes' margins outside its tracks, so no edge runs along a band's border (`route/clusters.test.ts`). Next: a webview harness with anonymised finance goldens.
10. Crossings against an exact optimum: in place (`order/exactGolden.test.ts`). `testing/bandedGraph.ts` is the `lineage-layers` view around its hub, anonymised, with its relation edges routed. `testing/exactCrossings.ts` searches every cluster-contiguous order of its ranks and finds a minimum of 1 weighted crossing; `thorough` reaches it for every seed tried, and `balanced` stops at 3. With the relation edges hidden, as the panel draws by default, every engine draws it with no crossing; the owned engine's drawing has 3 hops. `just smoke-engines` draws five views with every engine and writes `out/smoke-engines/engines.html`.

## Visual smoke

The checkpoints `just smoke-visual` writes are evidence for this engine, so they follow it: the default smoke draws with `balanced`. `just smoke-engines`, run on demand, captures each comparison view with every engine and records the drawn crossings and hops beside each capture. Checkpoints that no longer inform a reviewer, such as several near-identical states of one fixture, are removed rather than kept for completeness.

## References and benchmarks

elkjs (elk-layered), d3-dag and dagre are references and benchmark baselines, never dependencies. A benchmark script under the consumer's harness may load them as dev dependencies to compare metrics on the same golden graphs.
