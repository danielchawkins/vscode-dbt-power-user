# Spike: graph-layout pipeline timing and quality

Intent: settle the algorithm choices in the graph-layout plan by measurement before any of it is built. Not production
code; `knip.json` ignores `scripts/spikes/**`.

- `prototype.ts`: one-file pipeline in the canonical frame (ranks along one axis, in-rank position along the other):
  DFS cycle removal, network-simplex ranking (Gansner et al. 1993, cut values computed as dagre does), optional
  strict partitions (dbt layer bands as rank gates), rank and position hints, dummy chains per bundle (one bundle per
  kind and node pair), port-aware weighted barycenter sweeps with transpose and Barth–Jünger–Mutzel crossing counts,
  quadratic placement by Jacobi-scaled gradient projection with an exact per-rank projection (weighted pool adjacent
  violators), and channel routing with hyperedges merged by source point, a crossing-preference order and left-edge
  track assignment. Channel widths come from the track counts.
- `bench.ts`: dbt-shaped synthetic DAGs (sources, staging, intermediate, marts; parents picked near the child's own
  position; columns per node lognormal around 13, at most 25 rows shown; 1–4 column edges per table edge; 0.15
  relationships per node among staging and marts), the real maximum neighbourhood's shape from
  `docs/research/lineage-renderer-benchmark-october-2026.md` (5 tables, 7 table edges, 1,241 column edges), the
  current owned pipeline (`layeredFlow`) on the same graphs, and a 20-step scripted expansion.

## Run

```sh
N=~/.local/share/mise/installs/node/24.18.1/bin/node   # Node 24 strips the types
mkdir -p /tmp/graph-layout-spike
printf 'export { layeredFlow } from "%s/webviews/src/modules/lineage/layeredFlow.ts";\n' "$PWD" \
  > /tmp/graph-layout-spike/entry.ts
node_modules/.bin/rolldown /tmp/graph-layout-spike/entry.ts --format esm --platform node \
  --file /tmp/graph-layout-spike/layeredFlow.mjs
cd scripts/spikes/graph-layout
$N bench.ts 50,150,300 --old          # new prototype and the owned pipeline
$N bench.ts 50,150,300,600            # prototype only, strict partitions
PARTITIONS=0 $N bench.ts 300 --stability
$N bench.ts 0 --dense                 # the 5-table, 1,241-column-edge shape, both engines
```

## Results (27 October 2026, Apple Silicon, Node 24.18.1)

The machine's load average was 20 to 28 during the runs, so absolute times vary by up to four times between runs;
the old/new ratios were taken within one run. Quality numbers are deterministic.

Old pipeline against the prototype, same graphs. Crossing counts are each engine's own count (the owned router
counts pairs in its gutters, the prototype counts channel crossings), so they show the order of magnitude only; the
harness step replaces both with one geometric count.

| Graph | Edges | Owned `layeredFlow` | Prototype total | Owned crossings / hops | Prototype crossings |
| --- | --- | --- | --- | --- | --- |
| 50 | 67 | 42 ms | 6–9 ms | 284 / 168 | 21 |
| 150 | 209 | 261 ms | 17–29 ms | 3,954 / 1,204 | 309 |
| 300 | 423 | 649 ms | 50–100 ms | 19,892 / 5,731 | 1,806 |
| 50 + columns + relationships | 244 | 455 ms | 25–30 ms | 5,473 / 1,412 | 1,339 |
| 150 + columns + relationships | 774 | 7,243 ms | 66–110 ms | 91,949 / 14,420 | 10,739 |
| 300 + columns + relationships | 1,523 | 472,785 ms | 141–460 ms | 322,851 / 42,335 | 37,264 |
| dense 5 tables, 1,241 column edges | 1,248 | 58,102 ms | 36 ms | 404,403 / 2,564 | 65,226 |

Strict partitions (every dbt layer in its own ranks) against none, prototype only:

| Graph | Partitions | Total ms | Ranks | Dummies | Crossings | Bends | Density (node area / bounds) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 300 | strict | 50–190 | 14 | 762 | 1,805 | 2,352 | 0.11 |
| 300 | none | 24 | 10 | 114 | 1,359 | 1,064 | 0.19 |
| 300 + columns + relationships | strict | 141–460 | 12 | 1,648 | 37,571 | 8,300 | 0.073 |
| 300 + columns + relationships | none | 58 | 11 | 275 | 26,303 | 3,848 | 0.116 |
| 600 + columns + relationships | none | 173 | 11 | 444 | 106,476 | 7,518 | 0.065 |

Placement convergence on the 300-node graph (objective after the cap against the converged objective): plain
gradient projection reached 146.37M after 500 iterations against 145.97M converged at 1,473; Jacobi scaling reached
146.18M after 500 and converged at 1,188. Edge length differs by under 0.5% between the capped and converged
placements. With strict partitions the 500-iteration cap is hit on every graph over 150 nodes, and placement becomes
the largest phase.

Stability, 300-node graph with relationships, no partitions, 20 expansions from a 1-hop start to 55 cards, measured
relative to the focus card:

| Hints | Mean displacement of retained cards per step | Same-rank order flips | Rank changes |
| --- | --- | --- | --- |
| none | 134 px | 395 | 24 |
| weight 1 | 39 px | 108 | 1 |
| weight 10 | 37 px | 112 | 1 |

With strict partitions rank changes stay at 8 whatever the hint weight: a revealed upstream source forces every card
below its gate down a rank.

## What it settles

- Pure TypeScript is fast enough: no phase needs WASM at 600 nodes.
- The owned router is the bottleneck by two to four orders of magnitude once column edges are present; fixing it in
  place is not worth doing when the replacement routes the same graphs in tens of milliseconds.
- Strict dbt-layer partitions cost about 40% of the density, seven times the dummies and a third more crossings, and
  defeat rank stability; the lineage adapter should start with `partitions: "soft"` or `"none"` and draw bands from
  the ranks the engine chose, and the harness should decide.
- Hints work through all three phases: rank anchors (a rigid reference chain plus one mediator node per hinted card),
  a seeded order, and quadratic anchor terms.
- Gradient projection needs a better start or solver when dummies dominate: a Brandes–Köpf warm start or an
  active-set (VPSC-style) solve is the first thing to try in the placement step.

## What it does not settle

- Lateral ports (column rows on the east and west sides of a card in a top-down drawing). The prototype puts ports on
  the flow sides only, as a left-to-right drawing does.
- Clusters, soft partitions, Eades–Lin–Smyth cycle removal, sifting, and doglegs: not prototyped.
- Real neighbourhoods: only the shape of the largest one, with synthetic column pairs.
