# @fusion-power-user/graph-layout

Layered layout and orthogonal edge routing for directed graphs whose edges come in kinds. Some kinds rank the nodes
(dependencies); others are drawn and routed but never move a node to another rank (declared relationships such as
foreign keys). Nodes have their own sizes and may carry ports, for example one per column row. Nodes may belong to
nested clusters and to ordered partitions. A previous result can be passed back as hints, so a graph that grows by
expansion keeps its shape.

The package is pure TypeScript with no runtime dependencies. It reads no DOM, Node or clock API, so it runs unchanged
in a browser, a worker and Node. The extension's lineage panel is one consumer and is not special: nothing here names
dbt, React or React Flow.

> Status: the types (`src/types.ts`) and `validateGraph` exist. `layout` and `measureLayout` land phase by phase; see
> "Build order".

## Use

```ts
import { layout } from "@fusion-power-user/graph-layout";

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

## Guarantees

- Deterministic: the same graph, options and `seed` give the same result. No `Math.random`, no clocks
  (ast-grep rule `ts-graph-layout-deterministic`).
- No overlaps: no two nodes overlap, and no edge passes through a node it does not end at. The property tests assert
  this on random graphs.
- Orthogonal edges: every polyline alternates horizontal and vertical segments, and starts and ends at its ports.
- Standalone: the package imports only itself (dependency-cruiser rule `graph-layout-is-standalone`), and its
  `tsconfig.json` has no DOM or Node types.

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
| Placement | `place/` | Quadratic objective (weighted edge length with port offsets, long-edge straightening weights 1/2/8, hint anchors), ordered separation constraints per rank and cluster boxes, solved by scaled gradient projection with a Brandes–Köpf warm start | Dwyer, Koren and Marriott, *IEEE TVCG* 12(5), 2006; Dwyer, Marriott and Stuckey, GD 2005; Brandes and Köpf, GD 2001 |
| Routing | `route/` | Channel routing between ranks: hyperedges per source port, a crossing-preference order with cycles broken greedily, left-edge track assignment, doglegs where a preference cycle would otherwise cost a crossing; rank gaps sized from track counts | Sander, GD 2003; Hashimoto and Stevens, DAC 1971; Yoshimura and Kuh, *IEEE TCAD* 1(1), 1982; Deutsch, DAC 1976 |
| Metrics | `metrics.ts` | Geometric crossings, bends, edge length, area, density, overlaps; displacement and order flips between two results | — |

Rejected, with the reason:

- Kernighan–Lin and Fiduccia–Mattheyses refinement: built for cut minimisation of a partition. In a layered drawing the
  same local search is transpose and sifting, which target crossings directly.
- Multilevel ordering: pays off on graphs of thousands of nodes; the spike's sweeps take under 30 ms at 600 nodes.
- Kraftwerk-style spreading: needed when quadratic placement has no ordering to legalise against; within ranks, the
  ordered separation constraints already legalise exactly.
- PathFinder or A* grid routing: every edge here follows a dummy chain through the ranks, so each piece lies in one
  channel and channel routing is exact for it. A grid router is for free-placed nodes, which this engine does not
  produce.
- WASM: the spike's slowest phase at 600 nodes with columns is under 100 ms in plain TypeScript.

## Build order

1. Types, `validateGraph`, package wiring, boundary rules (this step).
2. `measureLayout` and the geometric metrics, so every later step is measured.
3. Ranking: cycle removal, network simplex, partitions, rank hints.
4. Ordering with ports, then clusters, then sifting.
5. Placement, then cluster boxes.
6. Channel routing, then lateral ports, then doglegs.
7. `layout` composes the phases; the property tests run on it.

## References and benchmarks

elkjs (elk-layered), d3-dag and dagre are references and benchmark baselines, never dependencies. A benchmark script
under the consumer's harness may load them as dev dependencies to compare metrics on the same golden graphs.
