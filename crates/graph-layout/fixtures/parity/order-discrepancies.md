# Order parity: discrepancies from TypeScript

Source of the reference outputs: `scripts/parity/print-fixtures.mjs order-outputs` (the 304 layering cases of
`order.txt`, all efforts, hinted and unhinted) and `order-finance-outputs <manifest.json>` (the finance lineage graph,
with the dump from `order-finance`), both run on Node v24.18.1 (the repository's pin). Each TypeScript order is
compared with the order the Rust core writes for the same input (`crates::order-outputs`, native, and
`order-finance` through `GRAPH_LAYOUT_ORDER_FINANCE_OUT`). Crossings are stored as the IEEE bits of each value.

The gate is an outcome gate (ADR 0011, O-6): valid orders, two runs equal, crossings no more than TypeScript's, time
no more than TypeScript's, native equal to WebAssembly. The comparison below also records whether each order is
identical to TypeScript's, since that is the first place a difference would show.

## What is compared, and how

- **Fixture cases** (`order.txt`, 304 cases, 608 results per effort, 1,824 in all): **1,824 of 1,824 orders identical
  to TypeScript** (the same layer lists, byte for byte); crossings equal in every result. Fewer crossings: 0. More
  crossings: 0. Native and WebAssembly outputs are byte-identical (`order-parity`: 304 cases).
- **Finance graph** (`GRAPH_LAYOUT_ORDER_FINANCE` set to the dump of `order-finance` on the manifest of the run's day:
  1,127 nodes and 1,296 edges): **6 of 6 results identical to TypeScript**, unhinted and hinted at fast, balanced and
  thorough. The Rust output file is byte-identical to TypeScript's (47,649 bytes). Crossings, unhinted / hinted, for
  TypeScript and Rust alike: fast 17,961 / 17,961; balanced 14,432 / 12,813; thorough 12,556 / 12,354. No result has
  fewer or more crossings than TypeScript.
- **Synthetic 3,000-node DAG** (`syntheticDag`, seed 1; timed by `scripts/bench/order-timings.mjs`): the orders were not
  written out and compared element by element. Crossings were compared: they are equal between TypeScript, Rust
  native and Rust WASI at fast and balanced (876,268.7442994516 and 838,794.4650788399). Thorough was not run (see
  Timing).
- **Early exit (before against after).** The fixture outputs and the finance output written with the pre-early-exit
  `sweeps.rs` are byte-identical to the tip's (`cmp`: equal for both). The early exit changes no order on these inputs.

## Discrepancies

**None.** On every input compared (1,824 fixture results and 6 finance results), the Rust order is identical to the
TypeScript order, and no result has more crossings. So there is no difference to explain. The early exit is built so
that it cannot change an order: two sweeps in a row that change nothing leave the order fixed for every later sweep
(`order/sweeps.rs`, the comment on `search`), and the before and after outputs confirm that on these inputs. The
synthetic DAG's element-by-element orders are not compared (see above), so this report makes no claim about them.

## Timing and crossings, before and after the early exit

Order only, milliseconds per pass, the median of three runs of the slope between two repeat counts. Margin is
TypeScript divided by Rust. Crossings are TypeScript / Rust native / Rust WASI, and they are equal in every row before
and after. Run on Node v24.18.1, one run of `scripts/bench/order-timings.mjs` before the early exit and one after.

| Workload (effort)                 | Crossings (TS / native / WASI) | TypeScript before / after | Native before / after | Native margin after | WASI before / after | WASI margin after |
| --------------------------------- | ------------------------------ | ------------------------- | --------------------- | ------------------- | ------------------- | ----------------- |
| finance fast (1,127 / 1,296)      | 17,961 / 17,961 / 17,961       | 94.6 / 93.6               | 19.8 / 19.7           | 4.76x               | 25.0 / 24.8         | 3.77x             |
| finance balanced (1,127 / 1,296)  | 14,432 / 14,432 / 14,432       | 258.4 / 257.9             | 53.1 / 55.0           | 4.69x               | 65.6 / 66.8         | 3.86x             |
| synthetic fast (3,000 / 5,902)    | 876,268.744 / same / same      | 4,342.8 / 4,233.6         | 811.7 / 727.7         | 5.82x               | 841.4 / 823.2       | 5.14x             |
| synthetic balanced (3,000 / 5,902)| 838,794.465 / same / same      | 8,126.0 / 7,976.3         | 1,489.6 / 1,342.1     | 5.94x               | 1,592.0 / 1,577.3   | 5.06x             |

Thorough: **not timed in this run**. The brief fixed the run to fast and balanced, so the finance thorough and the
synthetic thorough rows are absent. The synthetic thorough pass takes about 80 s in TypeScript, and it is skipped by the
owner's choice. Finance thorough was timed in an earlier run on a different dump (1,127 nodes and 1,291 edges), and it
is not restated here because this tip has not measured it.

## Where Rust is slower or has more crossings

- **Crossings:** nowhere. Every result has crossings equal to or fewer than TypeScript's.
- **Time:** nowhere in the timed rows. The narrowest margin is WASI on finance fast, at 3.77x. Native and WASI are both
  faster than TypeScript on every timed row.
- **Early exit:** on the timed rows, no change of more than run-to-run noise. Synthetic fast native is 10% faster
  (811.7 to 727.7 ms). Finance balanced is 3.6% slower native (53.1 to 55.0 ms) and 1.8% slower WASI (65.6 to 66.8
  ms). Those differences are inside the noise of three-run medians, and the TypeScript figures move by a similar
  amount between the two runs. They were not repeated.

## Facts that differ from earlier notes

- The finance manifest has 1,296 edges in the dump of the run's day, not the 1,291 recorded for the Phase 4 dump.
  Nodes are 1,127 in both. The counts come from the dump at the time it is taken, as the plan says.
