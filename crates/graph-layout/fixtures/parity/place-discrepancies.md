# Placement parity: discrepancies from TypeScript

Sources of the reference outputs: `scripts/parity/print-fixtures.mjs place` (the 312 cases of `place.txt`: 156 in `rows`
and 156 in `levels`, from the package graphs, the seeded random layering cases and `rowsGolden`) and
`place-finance <manifest.json>` (the finance lineage graph, 2 efforts in each mode), both run on Node v24.18.1 (the
repository's pin). Each TypeScript placement is compared with the placement the Rust core writes for the same input:
`crates::place-parity` (native and WebAssembly, byte for byte, on all 312 cases) and the finance output written with
`GRAPH_LAYOUT_PLACE_FINANCE_OUT` (native). Bounds, edge length and work are compared with TypeScript's bits, and
points are compared as the bits of every x and y.

The gate is an outcome gate (ADR 0011, O-6): valid placements (no overlap, separations met to 1e-9), two runs equal,
bounds and placement edge length no more than TypeScript's within 1e-9 relative, exact separations bit-for-bit, time no
more than TypeScript's, native equal to WebAssembly. The comparison below also records whether each placement is
identical to TypeScript's, since that is where a difference would show first.

## What is compared, and how

| Workload | Mode | Cases | Points identical | Bounds identical | Edge length identical | Work identical | Worst Rust / TypeScript: width, height, edge length |
| ---------------------- | -------- | ------ | ---------------- | ---------------- | --------------------- | -------------- | -------------------------------------------------- |
| Fixture (`place.txt`) | `rows` | 156 | 156 | 156 | 156 | 156 | 1.0, 1.0, 1.0 |
| Fixture (`place.txt`) | `levels` | 156 | 156 | 156 | 156 | 156 | 1.0, 1.0, 1.0 |
| Finance (dump) | `rows` | 2 | 2 | 2 | 2 | 2 | 1.0, 1.0, 1.0 |
| Finance (dump) | `levels` | 2 | 2 | 2 | 2 | 2 | 1.0, 1.0, 1.0 |
| Synthetic 3,000 nodes | `rows` | 2 (fast, balanced) | 2 | not compared | not compared | not compared | not compared |
| Synthetic 3,000 nodes | `levels` | 2 (fast, balanced) | 2 | not compared | not compared | not compared | not compared |

- The fixture and finance columns come from a scratch comparator, not committed, that reads each case's TypeScript
  expectation in the fixture or dump and the native output. The committed gate is `place_checks.rs`. "Worst" is the
  largest Rust value divided by TypeScript's over the cases of the row: 1.0 means equal, above 1.0 means worse.
- Every fixture and finance placement is bit-identical to TypeScript, so every bound, edge length and work count is
  too. The Phase 5 gate (`place_checks.rs`) reports 0 metrics worse than TypeScript on 312 fixture cases and on the 4
  finance cases.
- The synthetic 3,000-node DAG is not in the gate. Its eight timed placements (the two modes at two efforts) were
  checked point by point against TypeScript by the timed test (`place_timing_workload_runs`, which asserts the points
  bit for bit before timing); the bounds, edge length and work of those placements were not compared element by element.

## Discrepancies

**None.** On every input compared (312 fixture cases, 4 finance cases, and the points of 8 timed placements of the
synthetic and finance graphs), the Rust placement is identical to TypeScript's. So there is no numerical difference to
explain.

Differences in the interface, not in the numbers, are recorded here so that they are not mistaken for parity gaps:

- **`place` reads no graph.** The rank layout, layering and ordering come in as a plain `Problem` and layered input, as in
  rule `rust-core-layer-imports-place`. `place` therefore cannot import `constraints`, and the levels path takes the
  directed bundle flags (`directedBundles`) from its caller. The fixture states them as `directed=` on each segment, so
  the levels path reads the same bits TypeScript reads from the graph.
- **`place` is compiled for its tests only.** `lib.rs` says so: `place` is compiled for its tests until `route` reads its
  boxes and placement (Phase 6).

## Rank-chain projection and boxes

Projection onto the separations is exact in both implementations, with the same algorithm in each:

- **Without cluster boxes** the separations are the rank chains (each node at least a gap from its neighbour on the
  same rank). The projection of each rank is the exact weighted pool-adjacent-violators fit (TypeScript
  `projectRanks` in `place/projection.ts`; Rust `project_ranks` in `place/projection.rs`). A rank chain is a monotone
  fit, so PAV gives the nearest point in the weighted metric, exactly, with no iterations.
- **With cluster boxes** every separation, the boxes included, is one axis problem solved by VPSC (TypeScript
  `projectAxis` in `constraints/axis.ts`, with `solveSeparations`; Rust `Projector::solve` in `solve/`). The box
  constraints do not form chains, so PAV does not apply.

Both implementations choose the same path on the same input (`problem.extra === undefined` in TypeScript,
`problem.extra` absent in Rust), which is why the fixture and finance placements agree bit for bit.

## Edge length is placement-level

The edge length compared here is the placement-level measure: the distance between the port points of an edge, as
the placement fixes them. It is not the length of the routed edge, which the router draws and which Phase 6 builds. Any
statement about routed length, crossings of routes or bends belongs to Phase 6 and is not made by this report.

## Time against TypeScript

`scripts/bench/place-timings.mjs`, one full run on Node 24.18.1: placement (`place` with `problemOf`, the same two calls
Rust's `solve` makes), milliseconds per pass, the median of three runs of the slope between two repeat counts. Margin is
TypeScript divided by Rust. The finance graph is the manifest as it stands today (1,128 nodes, 1,297 edges); the
synthetic graph is `syntheticDag` with 3,000 nodes and seed 1 (5,902 edges).

| Workload              | Mode     | Effort   | TypeScript | Native  | WASI    | Native x | WASI x |
| --------------------- | -------- | -------- | ---------- | ------- | ------- | -------- | ------ |
| Finance               | `rows`   | fast     | 27.0       | 11.6    | 12.8    | 2.34     | 2.11   |
| Finance               | `rows`   | balanced | 2,558.6    | 1,065.0 | 1,154.5 | 2.40     | 2.22   |
| Finance               | `levels` | fast     | 33.9       | 13.2    | 17.6    | 2.56     | 1.93   |
| Finance               | `levels` | balanced | 2,643.6    | 1,164.1 | 1,235.0 | 2.27     | 2.14   |
| Synthetic 3,000 nodes | `rows`   | fast     | 49.7       | 10.9    | 13.3    | 4.56     | 3.74   |
| Synthetic 3,000 nodes | `rows`   | balanced | 206.1      | 27.3    | 30.7    | 7.55     | 6.70   |
| Synthetic 3,000 nodes | `levels` | fast     | 66.9       | 13.7    | 13.9    | 4.88     | 4.82   |
| Synthetic 3,000 nodes | `levels` | balanced | 218.1      | 29.6    | 33.2    | 7.36     | 6.57   |

- No row is slower than TypeScript; every margin is above the 1.5x threshold of S6. No speed-up was needed.
- Finance balanced is the slowest row: about 1.1 s per pass in Rust native (2.4x TypeScript). It is the first place to
  look in a later phase; this report does not claim a cause.
- Thorough is not timed in this phase.
- Single full run: the margins come from one run of the script. The S6 row records the same figures.

## What is not verified here

- Bounds, edge length and work of the synthetic 3,000-node placements are not compared element by element (only their
  points are).
- The finance comparison uses the manifest as it stands today; a different manifest gives different counts.
- Timings are from one run on one machine, Node 24.18.1 with the repository's pinned toolchain.
