# Layering parity: discrepancies from TypeScript

Source of the reference outputs: `scripts/parity/print-fixtures.mjs layering` (the package's graphs, the
negative-zero band cases and 300 seeded random graphs) and `layering-finance <manifest.json>` (the finance lineage
graph, built by `scripts/parity/finance-graph.mjs`, the same construction as `vpsc-spike.mjs finance`). Both run `rank`
and `layer` from `packages/graph-layout/src` on Node v24.18.1 (the repository's pin). Ranks are stored as the IEEE bits
of each value, so -0 and every ulp are kept.

## What is compared, and how

The Rust test is `layering_checks::ranks_and_chains_match_typescript_on_the_fixtures`, and the finance test reads its
dump from `GRAPH_LAYOUT_LAYERING_FINANCE` when that is set (it is not committed: the manifest is outside the
repository, as with the finance placement dump). A case is equal when its ranks are equal by `to_bits`, its reversed
ranking edges are equal, and its dummy chains are equal: every bundle's chain in order, nodes by index and dummies by
key (owner edge index, rank, position). A case that differs is allowed only if its total weighted edge length is no
worse than TypeScript's; the count of differing cases is pinned by the test, so a new difference fails until it is
recorded here.

- **Package fixtures** (`banded`, `golden`): **2 of 2 equal**, ranks and chains.
- **Negative-zero bands** (`negative-zero-soft`, `negative-zero-strict`, a -0 band beside a +0 band): **2 of 2 equal**.
  TypeScript keys bands by value (`===`), so -0 and +0 are one band there; the Rust fix is in
  `layering/constraints.rs` (Phase 3 item 4a).
- **Seeded random graphs** (`random-dag-0` to `random-dag-199`, DAGs; `random-cyclic-200` to `random-cyclic-299`, with
  cycles and self-loops; each graph one of `none`, `soft` and `strict` partitions, with free nodes and unknown kinds):
  **300 of 300 equal**.
- **Finance graph** (1,126 nodes, 1,273 edges, soft partitions, `table` edges that rank; the counts are the dump's own,
  pinned by `FINANCE_NODES` and `FINANCE_EDGES` in `layering_checks.rs`, which fail when the dump differs): **equal** when the dump is
  read (`GRAPH_LAYOUT_LAYERING_FINANCE`; `finance_general/target/manifest.json`).
  Ranks and every dummy chain are bit-identical to TypeScript.

Total: **304 of 304 fixture cases equal, and the finance graph equal; 0 differences.**

## Not ported yet (outside this phase's scope)

The exports drop what layering in later phases produces, so these are not compared and not in the counts above:

- **Lateral port dummies** (`lateralPort`, `groupBundles` keyed by lateral ports): the fixtures carry no port, and the
  `golden` fixture's ports are removed in the export (`portedScope`).
- **Cluster chains** (`clusters.ts`, `clusterChains`): the export strips cluster annotations, so no cluster chain exists
  on either side.
- **Spine chains** (`spines.ts`, `addSpineDummies`) and **segments** (`Segment`): both depend on cluster paths and are
  empty on the exported graphs.
- **Hints** (`hintRanks`, `LayoutHints`): the exports pass no hints, so the hint constraints are not compared.
  Rust's hint constraints are tested by property in `layering/tests.rs`.

## Discrepancies

None. No ranks, reversed edges or dummy chains differ from TypeScript on any compared input.
