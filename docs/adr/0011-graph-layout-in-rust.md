# Lay out graphs in a Rust core with WASM and native bindings

**Status:** Accepted, 2026-10-29, with the owner's answers in "Owner decisions" at the end. Supersedes the draft "Where the graph-layout pipeline computes" (revision `poxusprynpzu`), which made Rust conditional on a speed gate and put WASM only in the extension host. Amends ADR 0010 (a new top-level `crates/` directory). Nothing here is implemented. The phased plan, with a check per phase and the spike list, is `docs/refactor/graph-layout-rust-plan.md`. The owner's answers to O-1 to O-12 are in the last section.

## Context

`packages/graph-layout` is a pure TypeScript layered engine: rank, order, place, route. It has no runtime dependencies and about 8,350 non-test lines in `src/` (`testing/` excluded). `layout` validates, then `runPhases` (`packages/graph-layout/src/phases.ts`) runs rank, order, place and route in turn. Its README says nothing is kept between calls.

**The panel calls it on the main thread.** `webviews/src/modules/lineage/engine/graphLayoutEngine.ts:52-55` calls `layout(graph, optionsFor(request, effort))` inside a synchronous `layout(request)`, and the port in `layoutEngine.ts` is declared "pure and synchronous". The default engine is `balanced` (`packages/webview-contract/src/lineage.ts:178`). No file under `webviews/src` starts a Worker.

**Where the time goes.** Both scouts measured the 1,122-node, 1,243-edge finance graph built by `/tmp/bench/full-graph.mjs` from the finance manifest. They ran on Node 20.20.2, not the pinned 24.18, so their absolute times are provisional.

- `fast` takes about 650 ms; `balanced` about 34.6 s (scout-graph-layout.md, "Measured baseline").
- Placement is 93.4% of a `balanced` profile; ordering 1.8%, routing 0.8%, ranking 0.7%.
- In a `fast`-only profile placement is 39.6%, ordering 20.3%, ranking 17.6%, routing 6.9%.
- The cost is algorithmic as well as numeric. Gradient projection runs a full VPSC solve per iteration, and each solve rebuilds its blocks from nothing (`place/vpsc.ts`, `place/vpscBlocks.ts`, `place/vpscForest.ts`). It is quadratic on merging chains (scout-graph-layout.md, refactors 2 and 3).
- A pending block-local patch (`/tmp/vpsc-spike/vpsc-block-local.patch`) gives identical output on 2,000 random separation problems and speeds VPSC about 5x in TypeScript. The owner reports this change as pending.
- I re-ran `fast` once for this ADR: 968 ms on a machine under load. The machine has 18 cores and was busy, so I treat the scouts' figures and mine as order-of-magnitude only.

**Boundary cost, measured here.** `scratch/boundary-probe.mjs` (run from the run's scratch folder) builds the same 1,124-node, 1,243-edge input, lays it out once, and times each boundary encoding over 30 runs (median, Node 20.20.2, single thread):

| Encoding                                                                                           | Input bytes | Output bytes |           Input ms |          Output ms |
| -------------------------------------------------------------------------------------------------- | ----------: | -----------: | -----------------: | -----------------: |
| JSON text (stringify, then parse)                                                                  |     344,856 |      257,004 | 0.39 + 0.58 = 0.97 | 0.98 + 0.73 = 1.71 |
| Structured clone (postMessage to a Worker)                                                         |           — |            — |               1.16 |               1.21 |
| Columnar: Float32/Int32 arrays plus one UTF-8 blob (encode only; decode of the input not measured) |      92,385 |      141,520 |               0.32 |      0.10 (decode) |

A JSON round trip or a structured clone costs about 1.2 to 1.7 ms each way; the columnar frame about 0.4 ms. All of it is small against roughly 1 s of layout on this machine. The format is not the lever. It becomes a cost only when a live relayout drops to tens of milliseconds, and today the whole graph is re-sent on every change. So the design sends the graph once and sends small option deltas after that (see "Live tuning").

**The owner's requirements, one line each.** (1) A standalone Rust core with no VS Code, dbt or lineage knowledge, for any layered graph. (2) Runs in a browser (wasm-bindgen, ideally in a Worker) and in Node, with a napi-rs native path where it is measurably faster. (3) Maximum performance with the choices justified and measured. (4) Live tuning through a persistent handle with incremental relayout, cancellation and progressive results. (5) Attraction edges, excluded nodes, stable dummy keys, component packing, an across-axis strategy and a grouped overview. (6) The TypeScript engine stays the oracle until each phase matches. (7) A repository shape, build and CI on this repo's tooling, lint gates, VSIX size budgets and a webview CSP change.

**The webview cannot yet be assumed to run WASM.** `docs/research/webview-csp-october-2026.md` says no panel imports WebAssembly or starts a worker (line 24). Its spike on the pinned hosts recorded three failures (lines 34 to 37): `'wasm-unsafe-eval'` alone still gave `CompileError: … 'unsafe-eval' is not an allowed source of script`; `worker-src blob:` violated `script-src`; and `connect-src` blocked the `.wasm` fetch. The document does not establish whether the cause was the directive, the host's outer policy, or the host version. That is spike S8.

**Size budgets constrain packaging.** `scripts/quality/ceilings.json` caps the VSIX at 800,000 bytes (`vsix`), and `dist/extension.js` at 1,250,000. `size-budget.mjs` measures the VSIX from `out/latest-vsix`, and a key with no built artifact is reported "not built". I could not find a built VSIX in this workspace, so the current VSIX size is unmeasured. One native addon per platform will not fit that budget without a change (O-2, O-10).

**Prior art, read and not copied.**

- **elk-rs** (EPL-2.0 OR GPL-3.0-or-later; we cannot copy code from it). Its layout is one core with separate binding crates: `plugins/org.eclipse.elk.napi` (napi 2) and `plugins/org.eclipse.elk.wasm` (wasm-bindgen 0.2). Both are `publish = false` and both are thin wrappers around one JSON call, `layout_json(&str, &str) -> String`. It pins Rust 1.97.1 (README line 83). We take the layout, not the code.
- **rust-dagre** (MIT). One crate builds napi-derive and a `wasm32-wasip1-threads` target (`package.json` `napi.targets`). It uses serde_json at the boundary and rayon in the core, and its WASM build needs WASI threads, which need shared memory. It shows native and WASM from one crate is possible, but `wasm32-unknown-unknown` with wasm-bindgen cannot host napi-derive, so the two bindings must be separate crates here.
- **rust-sugiyama** (MIT). A petgraph-based skeleton with Gansner ranking, weighted-median or barycentre ordering, Brandes–Köpf placement and per-component layout (its README). It has no ports, clusters, partitions or hints. We use it as a reference for component splitting and for Brandes–Köpf, and do not depend on it. Our id layout is struct-of-arrays, which petgraph does not give us.

## Options

**A. Keep TypeScript; land only the scout refactors.** Cheap, and it is step 0 of the plan regardless. It does not meet requirement 2 or 3, and the layout stays on the webview's main thread.

**B. Rust core, WASM in the extension host only (the superseded draft).** The CSP story is simple, and the host has Node. But it fails the browser and Worker requirement, and the webview keeps a second engine.

**C. Rust core, WASM in a webview Worker only.** Meets the browser requirement best. Blocked until spike S8 passes, and the last recorded spike is negative. It also needs `worker-src` and `connect-src` changes to the panel policy and adds a second WASM copy to the webview bundle.

**D. Rust core with three bindings: WASM for browser and Node, napi-rs for native Node, the extension choosing at run time** (recommended). Meets requirements 1 and 2. The extension's default path needs no CSP change (see "Extension path").

**E. Depend on elk-rs or rust-dagre.** Rejected. elk-rs is copyleft (EPL/GPL) and the repository is MIT. Neither supplies requirement 5 (attraction edges, exclusions, wrapped rows, quotient, progressive relayout). rust-dagre has no port or cluster parity target and uses JSON.

**F. A separate repository now.** Deferred. Parity needs the TypeScript oracle, its fixtures and `just smoke-engines` in one CI run. A second repository would duplicate those gates. See "Repository shape".

**Recommendation: D, with C kept behind spike S8.**

## Decision

Firm (the owner has decided the first item; the rest are this design's choices):

1. **Rust replaces the TypeScript engine as the product engine.** There is no speed gate. Every phase is ported only after its parity gate against the TypeScript oracle passes (plan, Phases 2 to 6). The TypeScript engine stays the default until Phase 8 passes, and stays the oracle until Phase 10.
2. **One core crate, `crates/graph-layout`.** A library with `#![forbid(unsafe_code)]`, no dependencies by default, and two optional features: `serde` (JSON for options and fixtures) and `parallel` (rayon). It knows no VS Code, dbt, lineage, React or binding type. Its public input model keeps the names of `packages/graph-layout/src/types.ts`, so the TypeScript adapter sends the same object.
3. **Two binding crates, both `publish = false`:** `crates/graph-layout-wasm` (wasm-bindgen, `wasm32-unknown-unknown`, for browser, Worker and Node) and `crates/graph-layout-napi` (napi-rs v3, for Node native). Each owns its JS entry. They import only the public `engine`, `model`, `overview` and `pack` modules of the core.
4. **The persistent `Engine` handle is the primary API.** `layout(&Graph, &Options)` is a wrapper that builds an engine, runs it to its final stage and returns the result. Invariant I1 (below) makes the handle's final result equal the wrapper's, so the README's purity statement stays true for one-shot calls.
5. **Data layout: struct-of-arrays with `u32` ids.** Nodes, edges, clusters, ports and dummies are dense `u32` indices in input order. Adjacency is CSR. Strings exist only at ingest and in the id table. No `HashMap` is iterated anywhere (see "Determinism").
6. **Boundary: a versioned columnar frame for graph input and result** (typed arrays plus one UTF-8 blob with offsets, with a magic number and version). Options are JSON-shaped objects with the same camelCase schema as `types.ts`. S1 confirms this on the Rust side; the TypeScript probe already favours it by about 3.7x in input bytes and about 2.5x in encode time against JSON's stringify (the input decode was not measured).
7. **Threading: rayon on native only, for independent work** (components, and the restarts of `thorough`), merged in index order. WASM is single-threaded by default. Node has `SharedArrayBuffer` without cross-origin isolation, so a threaded WASM build in the host Worker is a candidate (S3 measures it); in the webview, threads need isolation or another mechanism the O-11 research finds.
8. **Phase caches keyed by content.** Each phase's key is FNV-1a 64 over the canonical bytes of the options and inputs that phase reads. A change re-runs from the first phase whose key changed, and reuses every phase output whose key did not change. The key table is in "Live tuning" and is checked by S7.
9. **Budgets are counts, not clocks.** The core reads no time (`ts-graph-layout-deterministic` already forbids it in TypeScript). Scout 4's `Budget` replaces the per-phase effort tables. Cancellation is by generation number, checked between work units. The sequence of progressive results depends only on the units consumed.
10. **New core features, each behind a policy or option that defaults to today's behaviour:** attraction edges (`EdgeKindPolicy.attract`), excluded nodes, stable dummy keys in `LayoutHints`, component packing, an `across` enum (`rows`, `levels`, `wrapped`), and a quotient function for the grouped overview. Details in "New core features".
11. **Extension path (recommended, owner decision O-1).** The panel asks the extension host for a layout. The host runs the WASM build in a `worker_threads` Worker, or the napi addon when one is present. The panel's engine port becomes asynchronous and carries a generation number. A Worker inside the webview is adopted only if S8 passes.
12. **Repository: in-repo, in a new top-level `crates/` directory.** Built by `mise` and `just`, gated by `just check`. It is published only after the owner decides (O-3).

Consequences of 1 to 12 that the reader should weigh are in "Consequences".

## Performance choices and how each is measured

| Choice            | Decision now                                                                                                                   | Why                                                                                                                                                                                                                                                      | Measured by                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Data layout       | Struct-of-arrays, `u32` ids, CSR adjacency, arena-style scratch                                                                | Scout 2 found a throwing generic accessor `item()` in VPSC's inner loops at 23.7% of balanced self-time; typed, dense indices remove that cost by construction                                                                                           | S6 (per-phase native against TypeScript on the same algorithm, 300, 1,122 and 3,000 nodes)                                               |
| Boundary encoding | Columnar frame for graph and result; JSON for options                                                                          | Measured in TypeScript: 92 KB vs 345 KB input; encode 0.32 ms (typed) vs 0.39 ms (JSON stringify), and JSON parse 0.58 ms on top (input decode of the typed frame not measured). Graph input is sent once, so the bulk format matters only at first load | S1: encode, copy and decode cost in both bindings, and the relayout p50 it sits beside                                                   |
| Result copies     | Copy results out of WASM memory with `slice`-style copies; never return views into linear memory                               | Memory growth detaches typed-array views, so a view held across a call is unsafe                                                                                                                                                                         | S1 (the copy is included in the measured round trip)                                                                                     |
| Native threading  | rayon over components and `thorough` restarts; deterministic merge                                                             | A single finance component gives no component parallelism, so restarts carry most of the gain                                                                                                                                                            | S2: thread sweep 1, 2, 4, 8 on the finance graph and a 3,000-node synthetic graph; bitwise output equal across thread counts             |
| WASM threads      | Off by default                                                                                                                 | They need `SharedArrayBuffer`, so cross-origin isolation (COOP/COEP) in the host. Not established for VS Code webviews                                                                                                                                   | S3: `crossOriginIsolated` and `SharedArrayBuffer` in a pinned webview; Node wasm-threads speedup as an upper bound                       |
| SIMD              | `simd128` and native auto-vectorisation; float reductions keep one order in both builds                                        | Native and WASM must agree bit for bit; TypeScript is compared on outcomes. Integer kernels (crossing counts, Fenwick trees) vectorise freely                                                                                                            | S4: scalar against `simd128` on the VPSC merge loop, the crossing count and the quadratic term; native and WASM bits equal               |
| Allocation        | Scratch `Vec`s kept in the engine and cleared, never reallocated per projection; the parity path never allocates after warm-up | Scout 3 found 200 projections per balanced run each building fresh blocks                                                                                                                                                                                | S5: a counting global allocator in a test; target zero allocations in a steady placement-only relayout (a target, not a measurement yet) |
| Compiler profile  | Native `opt-level = 3`, `lto = "fat"`, `codegen-units = 1`. WASM: `opt-level` chosen by measurement, then `wasm-opt -O`        | The size and speed trade differs for WASM and is unmeasured                                                                                                                                                                                              | S11 (raw, optimised and gzipped sizes) and S6                                                                                            |
| Float determinism | No `mul_add`, no fast-math                                                                                                     | Keeps native and WASM bit-equal; association may differ from TypeScript                                                                                                                                                                                  | Native-against-WASM equality test; outcome gates P2 to P6                                                                                |

Targets to validate, not facts: a `fast` result within about 100 ms on the finance graph, and a placement-only relayout under about 50 ms native. Both are hypotheses until S6 and S12 measure them.

## Module boundaries

The core crate `crates/graph-layout/src/` is one crate with modules. Boundaries are enforced by an ast-grep rule per module group (draft rules and their tests are a Phase 1 deliverable, in the style of `ast-grep/rules`), and by `pub(crate)` visibility. Splitting into several crates would make the DAG compiler-enforced, but it multiplies publishing and compile-time cost now; revisit if the rules fail repeatedly.

| Module                           | From TypeScript                                                                                     | Public interface (what others may import)                                                   | May import                                                                 | Enforced by                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `model`                          | `types.ts`, `validate.ts`, `presets.ts`                                                             | `Graph`, `Options`, `Layout`, `InputError`, `validate` (serde derives behind `serde`)       | nothing in the crate                                                       | rule `rust-core-layer-imports`                                                               |
| `budget` (new, scout 4)          | `phases.ts` effort tables                                                                           | `Budget`, `Budget::for_effort`                                                              | nothing                                                                    | same                                                                                         |
| `rand`                           | `random.ts` (mulberry32)                                                                            | `seeded(u32) -> Rng`, `shuffled`                                                            | nothing                                                                    | same; test vectors from `random.test.ts`                                                     |
| `hash` (new)                     | none                                                                                                | `Fnv64`, `key_of`                                                                           | nothing                                                                    | same                                                                                         |
| `index` (new, scout 5)           | parts of `layeredGraph.ts`, lookups repeated in rank, layering, route                               | `Indexed`, component ids, excluded filter                                                   | `model`                                                                    | same                                                                                         |
| `solve` (scout 1)                | `place/vpsc.ts`, `place/vpscBlocks.ts`, `place/vpscForest.ts`, solver part of `constraints/axis.ts` | `solve`, `Projector`, `Separation`, `Problem` (plain `f64` and `u32`)                       | nothing in the crate                                                       | rule: `solve/` may contain no `use crate::` line                                             |
| `layering`                       | `rank/*`, `acyclic.ts`, ranks in `layering.ts`                                                      | `rank(&Indexed, &RankOptions, &mut Scratch) -> Ranks`                                       | `index`, `budget`, `rand`, `solve` only if ranking needs it                | rule per group                                                                               |
| `order`                          | `order/*`, `fenwick.ts`, `spines.ts` (ordering part)                                                | `order(...) -> LayeredOrder`                                                                | `index`, `layering` output types, `budget`, `rand`. Not `place` or `route` | rule per group                                                                               |
| `across` (scout 6, new)          | `place/across.ts`, the `ranks` string checks                                                        | `AcrossAxis`, `wrap(...)`                                                                   | `index`, `order` output types                                              | rule per group                                                                               |
| `place`                          | `place/*` except the solver, `constraints/*` except the solver, `offsets.ts`, `boxRects`            | `place(...) -> Placement`, `boxes(&Placement, ...)` (the restacking entry scout 6 asks for) | `solve`, `across`, `order`, `index`                                        | rule per group                                                                               |
| `route`                          | `route/*`, `drawingSegments.ts`, `lateral.ts`                                                       | `route(...) -> Routing`                                                                     | `place::boxes` (public only), `order`, `index`                             | rule: `route/` may not import `place` internals                                              |
| `metrics`                        | `metrics.ts`                                                                                        | `measure`, `compare`                                                                        | `model`                                                                    | rule per group                                                                               |
| `engine` (new)                   | `phases.ts`, `layout.ts`, `result.ts`, plus the cache                                               | `Engine`, `Progress`, `Generation`, `layout`                                                | every phase module through its public function                             | the only module that holds state                                                             |
| `overview` (new, feature)        | none                                                                                                | `quotient(&Graph, &[u32]) -> Quotient`                                                      | `model`, `engine`                                                          | rule per group                                                                               |
| `pack` (new, feature)            | none                                                                                                | `pack_boxes(&[Rect], spacing) -> Vec<Point>`                                                | `model`                                                                    | rule per group                                                                               |
| `testkit` (feature, `cfg(test)`) | `testing/*` (oracles)                                                                               | oracles used by tests                                                                       | anything                                                                   | the feature is not enabled by `wasm` or `napi` crates; a rule fails any binding importing it |

The bindings import only `engine`, `model`, `overview` and `pack`. A rule `rust-binding-imports-engine-only` (Phase 1) enforces it. Dependency rules on the core's own `Cargo.toml` are checked by `just crates::boundaries`, which runs `cargo tree` and compares the normal dependency set against an allowlist: `rayon` only behind `parallel`, `serde` only behind `serde`.

## Determinism rules

The Rust engine is deterministic: the same input and options give the same bits on every run, thread count, and in both native and WASM builds. Against TypeScript it is compared on outcomes, not bits (O-6), so a better-designed Rust algorithm may replace a TypeScript one when the outcome gates hold.

1. **PRNG.** `random.ts` (mulberry32) is ported bit for bit, so a seed means the same thing in both engines: `Math.imul` is `wrapping_mul` on `u32`, `>>> 0` is `u32`, and the final division by 4294967296 is the same `f64` division. Test vectors come from the TypeScript function.
2. **Float order.** No `mul_add` and no fast-math flags in the core, because WASM has no fused multiply-add and native and WASM would otherwise differ. Reductions run in index order.
3. **Math semantics.** Non-finite inputs are rejected at validation on both sides. Where JavaScript and Rust differ (`Math.hypot` rounding, the sign of zero in `Math.min` and `Math.max`, `Math.round` at halves), Rust uses its own function, and the discrepancy report shows any effect. TypeScript is not changed to match.
4. **Stable sorts with total comparators.** JavaScript `Array.prototype.sort` and Rust `sort_by` are both stable. Every comparator ends with an index tie-break. The 12 `.sort(` call sites in TypeScript are audited in Phase 1.
5. **No hash iteration.** TypeScript `Map` iterates in insertion order; Rust uses `Vec` indexed by id, or `BTreeMap`. `clippy.toml` bans `HashMap` and `HashSet` in the core (`disallowed-types`). The 50 `Map`/`Set`/`.entries()`/`.keys()`/`.values()` sites in TypeScript are audited in Phase 1.
6. **Dense ids in input order.** Node, edge and cluster indices follow the order of the input arrays. Phase 2 confirms that the TypeScript index assignment does the same.
7. **No clock, no unseeded randomness.** The TypeScript rule `ts-graph-layout-deterministic` forbids `Math.random`, `Date.now` and `performance.now` in `src/**`. The Rust equivalent is `clippy.toml` `disallowed-methods` for `Instant::now` and `SystemTime::now`, plus an ast-grep rule.
8. **Parallel merges.** Results merge in index order. Ties in a choice between candidates break on (cost, candidate index).
9. **Parity compares outcomes.** Each gate runs both engines on its fixtures. Ranks and per-rank orders are compared exactly by default. Placement and routing are compared on validity (no overlap, every separation met, every edge routed or flagged) and on quality metrics (crossings, bends, edge length, bounds), each equal or better than TypeScript within a recorded tolerance. Every difference, structural or metric, goes into a discrepancy report committed with the phase; a deliberate improvement is allowed when its metrics hold.
10. **Conversions.** The core casts only from `u32` and `usize`. Any float-to-integer conversion goes through an explicit helper, because JavaScript's `ToInt32` wraps and Rust's `as` saturates.

## Live tuning: the engine handle

Rust, as built in Phase 7 (`crates/graph-layout/src/engine/handle.rs`):

```rust
pub struct Engine { /* the outputs of the last completed run, by stage; the newest generation */ }

impl Engine {
    pub fn new() -> Self;
    /// Validates the graph and the options, runs the stages whose key differs from the cache's, and replaces the cache
    /// when the run completes. `Ok(None)` when a newer generation has started before the run finishes.
    pub fn layout(&self, graph: &Graph, options: &Options, generation: Generation)
        -> Result<Option<Progress>, LayoutError>;
}

/// `generation()`, `reran()` (the stages this request ran, in order) and `layout()` / `into_layout()`.
pub struct Progress { /* ... */ }
pub struct Generation(u64);  // `Generation::new`, `get`

/// The wrapper: a fresh engine run to the end.
pub fn layout(graph: &Graph, options: &Options) -> Result<Layout, LayoutError>;
```

The graph and the options are passed to each call, not set once. The keys make the reuse: an unchanged input re-runs no stage. Staged budgets (`Fast`, `Refined`, `Final`), a unit-counted `run`, and the yielding loop of the WASM wrapper are future work; `layout` runs every stage to the budget of its `effort`.

**Phase keys.** Each stage's key is FNV-1a 64 over the canonical bytes of the key of the stage before it and of what the stage reads (`crates/graph-layout/src/engine/keys.rs`). Keys chain, so a change that reaches a stage reaches every stage after it. The table below is the output of the S7 probe (`crates/graph-layout/src/engine/keys/tests.rs`). The probe starts from a base that sets every option, changes one option at a time, and marks each stage whose key changes. The test fails when this table differs from its output. A dot marks a stage whose key changes. Index is the graph and the edge kinds' joins; the stages after it read the graph only through it.

<!-- key-table:start -->
| Option                      | Index | Rank | Layer | Build | Order | Place | Route |
| --------------------------- | ----- | ---- | ----- | ----- | ----- | ----- | ----- |
| `direction`                 |       | ●    | ●     | ●     | ●     | ●     | ●     |
| `edgeKinds.rank.ranks`      | ●     | ●    | ●     | ●     | ●     | ●     | ●     |
| `edgeKinds.rank.minLength`  |       | ●    | ●     | ●     | ●     | ●     | ●     |
| `edgeKinds.rank.weight`     |       | ●    | ●     | ●     | ●     | ●     | ●     |
| `edgeKinds.rank.routed`     | ●     | ●    | ●     | ●     | ●     | ●     | ●     |
| `edgeKinds.rank.sourceSide` |       |      |       |       |       |       |       |
| `edgeKinds.rank.targetSide` |       |      |       |       |       |       |       |
| `edgeKinds.info.weight`     |       |      | ●     | ●     | ●     | ●     | ●     |
| `spacing.node`              |       |      |       |       |       | ●     | ●     |
| `spacing.rank`              |       |      |       |       |       | ●     | ●     |
| `spacing.edge`              |       |      |       | ●     | ●     | ●     | ●     |
| `spacing.cluster`           |       |      |       |       |       | ●     | ●     |
| `partitions`                |       | ●    | ●     | ●     | ●     | ●     | ●     |
| `ranks`                     |       |      |       |       |       | ●     | ●     |
| `anchor`                    |       |      |       |       |       | ●     | ●     |
| `hints (presence)`          |       | ●    | ●     | ●     | ●     | ●     | ●     |
| `hints.id and hints.rank`   |       | ●    | ●     | ●     | ●     | ●     | ●     |
| `hints.order`               |       |      |       |       | ●     | ●     | ●     |
| `hints.x`                   |       |      |       |       |       | ●     | ●     |
| `hints.y`                   |       |      |       |       |       | ●     | ●     |
| `stability`                 |       | ●    | ●     | ●     | ●     | ●     | ●     |
| `effort`                    |       | ●    | ●     | ●     | ●     | ●     | ●     |
| `seed`                      |       |      |       |       | ●     | ●     | ●     |
<!-- key-table:end -->

What the probe corrects in the design's table:

- `spacing.rank` is read by placement (`place/mod.rs`, the rank gap) as well as by routing, and `spacing.cluster` is read by placement only. Routing reads `spacing.edge` and `spacing.rank`.
- `spacing.edge` is read by `layered::build`, so a change of it re-runs from Build, not from Routing alone.
- `sourceSide` and `targetSide` are checked by `validate` and read by no stage. Changing them changes no key.
- `budget.doglegWork` is defined but no stage reads it (`route/mod.rs` says routing never doglegs yet). Routing reads `routePairs` only.
- No option reaches routing alone. Every option that reaches Route reaches Place first, so the cache test for a placement-only change re-runs Place and Route, and no test can pick a routing-only option.
- Effort reaches Rank and Order as well as Place and Route, because the rank pivots and the sweep counts are budget counts.

Not probed: the attraction weight, the attraction edges, and the excluded flags, which have no Rust code yet.

| Edit | Re-runs | Reuses |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------ |
| `edgeKinds.info.weight` (`ranks: false`) | Layer, Build, Ordering, Placement, Routing | Index, Rank |
| Attraction weight of a collapsed busy node | Placement, Routing (and Ordering if D-attr adds it there) | Index, Layering |
| `spacing.edge` only | Build, Ordering, Placement, Routing | Index, Rank, Layering |
| `spacing.node` | Placement, Routing | Index, Rank, Layering, Build, Ordering |
| `rows` ↔ `levels` | Placement, Routing | Index, Rank, Layering, Build, Ordering |
| Effort change | from Rank (the budget counts reach Rank and Order) | Index |
| Node excluded or restored | Index, then only the components it touches | every other component |

**Progressive results.** Not built. The stages are budget constants (`effort`), not elapsed time, and `layout` runs them all. Staged results (`Fast` as a first complete placement with a small budget, then `Refined` and `Final`, in units of one sweep, one projection iteration or one routing batch) remain future work, with the open question of whether a Brandes–Köpf-only placement can serve as `Fast`.

**Invariants the tests enforce (Phase 7):**

- **I1.** After any sequence of requests, the handle's layout equals `layout(graph, options)` on the same inputs, bit for bit (`handle::tests`).
- **I2.** Not built with the staged budgets; a run is not split. Future work.
- **I3.** A request superseded by a newer generation returns `None`, and the cache it would have replaced stays as it was.
- **I4.** A steady placement-only relayout allocates a bounded amount that does not grow after warm-up (`tests/alloc.rs`, `an_engine_relayout_after_warm_up_allocates_a_bounded_amount_that_does_not_grow`). Zero allocations is not the target; reusing the placement and routing buffers is Phase 8's "Placement and routing performance" in the plan.

## New core features

Each feature defaults off, so with it off the output stays bit-identical to the Rust engine without the feature (and the Phase 6 outcome gate still passes after Phase 9 lands).

1. **Attraction edges.** A kind policy gains `attract?: boolean`, valid only with `ranks: false`. Today every non-flat bundle gets a dummy chain whatever its kind (`layering.ts:40-41`), so a `ranks: false` edge is not enough: an attraction edge creates no dummy chain. It is not counted as a crossing, and it is routed only when `routed: true`, as a direct orthogonal route with no dummies. In placement it is a pull between its endpoints, weighted by `weight`. In ordering it is a barycentre tie-break term, weighted low. Whether ordering uses it at all is decision D-attr. It is the same thing as scout R10's "weighted, unrouted hint edge role" (`ranks: false`, `routed: false`, `attract: true`). Tests: no dummy is created; with weight 0 the ordering and placement equal the graph without the edge; with rising weight the endpoints' distance does not increase (monotone).
2. **Excluded nodes.** A node flag `excluded?: boolean` (or a set in the input) is applied in Index, before any phase: the node and its incident edges are dropped, and the result lists their ids. Toggling marks only the components it touches as dirty. Test: `layout(G with excluded)` equals `layout(G minus them)`, bit for bit.
3. **Stable dummy keys.** A dummy's key is (edge id or cluster id, rank, position in its chain). `LayoutHints` gains `layers`, the per-rank list of keys, so the full layered order round-trips. Today hints carry no dummy order (`types.ts`, `LayoutHints`). Test: for an unchanged graph, `layout(G, hints(layout(G)))` equals `layout(G)`.
4. **Components and packing.** Components are found over ranking and routed edges, plus attraction edges if O-7 says so. Each component is laid out by the same engine, and the boxes are packed by shelf packing with items sorted by (height descending, index), using `spacing.cluster`. Tests: a one-component graph is unchanged; packed boxes do not overlap; the packing is deterministic.
5. **Across axis.** `across: Rows | Levels | Wrapped { max_width }` replaces the two string checks (`place/across.ts:66` and `route/index.ts:64`), and route stops importing placement internals (scout 6). `Wrapped` splits each rank's ordered units into sub-rows no wider than `max_width` and stacks them on the across axis. Tests: `max_width = ∞` equals `Rows`; no overlap; crossings, bends and bounds are measured against `Rows` and `Levels` before any default changes (S9).
6. **Grouped overview.** `overview::quotient(&Graph, &[u32])` returns one node per group, sized by member count, and one edge per (group pair, kind) carrying a count, plus a map back to the originals. The result is laid out by the same engine. Test: counts are conserved (the sum of counts equals the number of original routed edges that cross groups), and self-loops are counted separately. The webview's viewport work (scout R9) consumes it.

## Bindings and the extension

**WASM (`crates/graph-layout-wasm`).** `wasm-bindgen --target web` for the browser and Worker, `--target nodejs` for Node tests, then `wasm-opt -O`. It exposes `WasmEngine` with the methods above. A small JS wrapper in `crates/graph-layout-wasm/js/` provides the Worker helper and yields between `run` calls.

**napi (`crates/graph-layout-napi`).** A `#[napi]` class wrapping `Arc<Mutex<Engine>>`. `run` returns a Promise through napi's async task, so it runs on the libuv pool and never on the JS thread. The generated loader is part of the crate's npm package. napi-rs v3 is chosen because `rust-dagre` uses it (its `napi` 3.5); elk-rs uses v2.

**The panel's port.** `LayoutEngine.layout(request)` becomes `Promise<LayoutResponse>` carrying a generation, and `toFlow` in `webviews/src/modules/lineage/flow.ts`, which calls it, becomes asynchronous. This is decision O-9 because it changes a port that today is documented as synchronous.

**Extension path (O-1).** The panel posts its layout request to the host through `PanelHost.post` (the `POST_MESSAGE` rule in `lint/boundaries.mjs` and the `ts-panel-reply-through-host` rule). The host runs the WASM build in a `worker_threads` Worker, or the napi addon if the platform's binary is present. This keeps the extension's host thread responsive, avoids the CSP question, and needs one universal VSIX. Structured-clone messages cost about 1 to 2 ms each way (the probe), which is small beside a relayout.

**Webview Worker (option C, gated).** Adopted only if S8 passes on the pinned hosts (the smoke pins in `scripts/smoke/pins.env`). The proposed policy change is below.

**Proposed CSP change (lineage panel only, and only after S8).** Today `contentSecurityPolicy` in `src/webview/panelHtml.ts:88-93` builds `default-src 'none'; script-src 'nonce-N' <cspSource>; style-src …; font-src <cspSource>; img-src <cspSource> data:`. A new `PanelCsp` flag, `wasm: true`, set only for the lineage panel, would add:

- `script-src 'nonce-N' <cspSource> 'wasm-unsafe-eval'`, so `WebAssembly.compile` may run without `'unsafe-eval'`.
- `worker-src <cspSource>`, so the worker is loaded from a file URL. `worker-src` would fall back to `script-src`, which already allows the file URL, so the directive states intent and keeps `blob:` denied.
- `connect-src <cspSource>`, so `fetch` can load the `.wasm` file. The research spike recorded this as a violation under `default-src 'none'`.

Not proposed: `'unsafe-eval'`, `blob:` (the research shows a blob worker blocked), `https:`, or `data:` in `connect-src`. The alternative of embedding the `.wasm` bytes in the JS bundle as base64 would avoid `connect-src`, but costs about a third more bytes in `lineage.js`, whose budget is 375,000 bytes, so it is the fallback only if `connect-src` is refused. `docs/research/webview-csp-october-2026.md` must be updated with the S8 results whichever way the decision goes.

**Size.** The WASM file and the napi addon are assets, so `package.json` `files` must name them (ADR 0010: the VSIX is an allowlist). `ceilings.json` gains keys for them, set from the measured value plus a margin, using the existing ratchet (`just lint-ratchet --write`). Whether the VSIX budget of 800,000 bytes survives a WASM asset is measured in S11, not assumed (O-10). Per-platform native addons would need platform-specific VSIXes, which is O-2.

## Repository shape, build and CI

- **Location.** In this repository, in a new top-level `crates/`. ADR 0010's table says each top-level directory has one consumer and that `packages/*` means "a library built by `tsc -b`". Rust crates do not fit that glob, so `crates/` needs its own row: "Rust crates: the core and its two bindings; consumer: the extension bundle, and crates.io for the core." Amending ADR 0010 is part of this decision.
- **Why not a separate repository now.** The parity gates need the TypeScript oracle, its fixtures and `just smoke-engines` in one run. A second repository would need cross-repo fixture sync on every algorithm change. Publishing from this repository is possible (crates.io accepts a subdirectory crate; npm publishes from a built package), so the choice can be deferred without cost (O-3).
- **Toolchain (O-12: track stable).** `rust-toolchain.toml` names the `stable` channel with components `clippy` and `rustfmt` and target `wasm32-unknown-unknown`. `mise.toml` lists `rust` and the CLIs at `latest`: `cargo:wasm-bindgen-cli` (which must equal the `wasm-bindgen` crate version, so the two move together), `cargo:cargo-deny`, and binaryen for `wasm-opt`. `mise.lock` records the resolved versions, so a build is reproducible, and `just update` moves them to the newest stable. A fixed pin can come later. The exact backend names and whether mise honours `rust-toolchain.toml` are verified in Phase 1. The napi CLI (`@napi-rs/cli`) is an npm devDependency.
- **Just.** A `mod crates 'crates/justfile'` line, following the `webviews/justfile` pattern in ADR 0004. Recipes: `crates::fmt`, `crates::lint` (`clippy -D warnings`, `rustfmt --check`), `crates::test`, `crates::deny`, `crates::boundaries` (ast-grep rule tests and the `cargo tree` allowlist), `crates::wasm` and `crates::napi` (the binding builds and their Node smoke tests), and `crates::parity` (the oracle comparison, quick form in `check`, full form nightly). `just check` iterates a fixed list of steps today (`compile lint test webviews::typecheck webviews::test` in the root `justfile`), so `crates::check` (fmt, lint, test, deny, boundaries, wasm and napi smoke, quick parity) is added to that list. `crates::bench` is not in `check` because it is noisy. Lefthook and CI already call `just check`, so they pick Rust up without change.
- **Lints.** `clippy.toml` bans `HashMap`, `HashSet`, `Instant::now`, `SystemTime::now` and `f64::mul_add` (`disallowed-types`, `disallowed-methods`), in the same spirit as ruff's `TID251` banned-API list. The core sets `#![forbid(unsafe_code)]`, and clippy `pedantic` is on with a short allowlist. The ast-grep rules named in "Module boundaries" live in `ast-grep/rules/` with tests in `ast-grep/rule-tests/`, as the existing TypeScript rules do. Whether `clippy.toml` in a crate directory is picked up when clippy runs from the workspace is verified in Phase 1.
- **cargo-deny.** `deny.toml` with a licence allowlist (MIT, Apache-2.0, BSD-2/3-Clause, ISC, Unicode-3.0, Zlib, 0BSD; to verify against each dependency), an advisories check, sources restricted to crates.io, and bans that keep the core's default dependency set empty.
- **Parity fixtures.** `fast-check` sampling cannot be ported, so TypeScript exports the 80 golden inputs of `rowsGolden.test.ts` and the seeded corpus used by the other gates as committed JSON and binary fixtures. The TypeScript side writes them with a script in a new parity folder under `scripts/`, and the Rust side reads them. Large corpora are generated under `out/`, not committed.

## Scout and research refactors folded into this design

| Source                                                                                | Item                                                                | Where it lands                                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Scout (graph) 1                                                                       | VPSC into a `solve/` kernel                                         | Phase 0 (TS), then `solve` (Phase 2)                                                                         |
| Scout 2                                                                               | Block-local multipliers, plain indexing                             | Phase 0 (TS); Rust removes the accessor by construction                                                      |
| Scout 3                                                                               | Incremental block merging and a warm-started projector              | Phase 0 (TS, `createProjector`); Rust `Projector` held by the engine (Phases 2 and 7)                        |
| Scout 4                                                                               | One `Budget` per run                                                | Phase 0 (TS); `budget` module (Phase 1)                                                                      |
| Scout 5                                                                               | Index once; layering its own phase                                  | Phase 0 (TS, `indexed.ts`); `index` and `layering` (Phase 3)                                                 |
| Scout 6                                                                               | Across axis decided once; route stops importing placement internals | Phase 0 (TS); `across` (Phase 9e)                                                                            |
| Scout 7                                                                               | Objective terms open to attractions                                 | `attract` policy and placement and ordering terms (Phase 9a)                                                 |
| Scout 8                                                                               | Stable keys for layered nodes                                       | Phase 9c                                                                                                     |
| Scout 9                                                                               | Components as a unit of layout and reuse                            | Phase 9d and the per-component dirty marks in Phase 7                                                        |
| Lineage R1 (naming "hidden")                                                          | One meaning per word                                                | Webview, before the port changes (Phase 0.9)                                                                 |
| Lineage R2 (one visibility projection)                                                | Single source for cards and drawn edges                             | Webview, Phase 0.9                                                                                           |
| Lineage R3 (split into `LayoutInput` and `FlowDecoration`)                            | The engine receives only layout input                               | Webview, Phase 0.9; a precondition for the async port                                                        |
| Lineage R4 (layout cache keyed on inputs, fed hints)                                  | Host-side cache                                                     | Subsumed by the engine handle's phase keys (Phase 7)                                                         |
| Lineage R5 (stop laying out every intermediate graph)                                 | Coalesce requests                                                   | Host scheduling, Phase 8; cancellation by generation (Phase 7)                                               |
| Lineage R6 (layout independent of file and selection)                                 | Engine keyed on graph and options only                              | Phase 7 invariant                                                                                            |
| Lineage R7, R8 (host adjacency; project-wide graph)                                   | Whole-project graph requests                                        | Host work; affects only graph size, which the columnar frame handles                                         |
| Lineage R9 (viewport culling and grouped overview)                                    | Overview for low zoom                                               | `overview::quotient` (Phase 9f)                                                                              |
| Lineage R10 (weighted, unrouted hint edge role)                                       | Pull without drawing                                                | `attract` policy (Phase 9a)                                                                                  |
| Research synthesis (rows vs levels; grouping; MSAGL incremental; dagre dynamic reuse) | Measure rows and levels before engine work; add grouping            | S9 and Phase 9f; the incremental design follows the MSAGL and dagre leads, which were not read in depth here |

## Consequences

Good:

- The engine is pure, typed and deterministic in every binding, with one algorithm and one set of tests.
- The panel can ask for a layout without blocking its thread (once the port is asynchronous), and a slider change needs only the phases it touches.
- The TypeScript oracle keeps the rewrite honest: each phase is compared on outcomes, and every difference is recorded.

Costs and risks:

- Two engines coexist until Phase 10. A Rust-only improvement is allowed, so the discrepancy reports must be read, not only the pass or fail.
- The async port (O-9) touches the panel.
- Size: the WASM asset raises the VSIX; the owner's budget is under about 2 MB (O-10).
- Rust performance is unmeasured in this ADR, because this machine has no Rust toolchain. Every speed statement about Rust here is a hypothesis until S6.
- Two of the three bindings may be unused by the product. A native addon is worth shipping only if S6 shows the margin (O-2).

What would change my mind:

- If S6 shows the native addon is not at least about 1.5x faster than WASM on the 1,122-node graph at `balanced`, drop the native binding from the product (keep it as a library option).
- If S8 shows the webview's WASM and Worker work on both pinned hosts with the proposed policy, option C becomes attractive for the panel, and the host path becomes a fallback.
- If an outcome gate fails because the Rust algorithm is worse on a metric, the Rust change is reverted or the tolerance is changed in writing.
- If S3 or the browser-threads research (O-11) finds a way to get shared memory in the webview or the host Worker, parallel WASM becomes worth its complexity.

## Owner decisions

Answered 2026-10-29 (`docs/refactor/lineage-layout-decisions.md`). Where an answer differs from the recommendation below, the answer wins.

| ID     | Answer                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-1    | Extension host: WASM in a `worker_threads` Worker; napi when present.                                                                                                                                                           |
| O-2    | No native addon in the first release; platform VSIXes only if S6 shows about 1.5x over WASM.                                                                                                                                    |
| O-3    | `crates/` in this repository until the switch; publishing decided then.                                                                                                                                                         |
| O-4    | The TypeScript engine stays as a dev-only reference that never ships, until retired.                                                                                                                                            |
| O-5    | New features exist only in Rust.                                                                                                                                                                                                |
| O-6    | **Rust is the baseline.** TypeScript is a one-time baseline, not a target; its checks go in Phase 10. Native and WASM stay bit-equal.                                                                                           |
| O-7    | Attraction edges join components, as one case of a general control: any edge kind or edge group can be turned off and the graph re-laid out.                                                                                    |
| O-8    | Decide after S9, with a leaning to a placement mode. Layouts must stay flexible.                                                                                                                                                |
| O-9    | The panel's layout call becomes asynchronous, with a generation number.                                                                                                                                                         |
| O-10   | Measure the WASM (S11). The VSIX budget is under about 2 MB; smaller is better, but features and speed come first.                                                                                                              |
| O-11   | Accept single-threaded WASM if S3 shows no isolation, and research other ways to get threads in the browser (for example a host Worker pool, a cross-origin-isolated iframe, or a separate process) before settling.            |
| O-12   | Track stable: start on the latest stable Rust and tools, recorded in `mise.lock`; pin later.                                                                                                                                    |
| D-attr | Ordering reads attraction edges as a low-weight tie-break; compared with and without on S9's fixtures.                                                                                                                          |

## Open decisions as proposed

- **O-1. Where the extension runs the engine.** Recommended: host (WASM in a `worker_threads` Worker; napi when present). Alternative: webview Worker (option C), gated by S8.
- **O-2. Native addon distribution.** Recommended: no native addon in the first VSIX. If S6 justifies it, platform-specific VSIXes (one per target, built in CI) at a size budget per target. Runtime downloads are out: the shipped extension is tool-manager-neutral (ADR 0004) and local-only (ADR 0001).
- **O-3. Repository and publishing.** Recommended: in-repo `crates/` until Phase 8; then decide the crates.io and npm names, the publication step and the licence (the root `LICENSE` is MIT, and `packages/graph-layout` is `private`).
- **O-4. TypeScript engine after cutover.** Recommended: keep it as a dev-only oracle package that never ships, until the owner retires it. Alternative: delete it at Phase 10 and keep the golden fixtures only.
- **O-5. Backport features to TypeScript?** Recommended: no. The features exist only in Rust, and the TypeScript engine is frozen at parity.
- **O-6. Parity tier.** Recommended: bitwise for all phases, with every deliberate algorithm change made and re-baselined in TypeScript first. Alternative: a tolerance tier for placement only, with a documented bound.
- **O-7. Do attraction edges join components?** Recommended: yes, so that packing does not separate two nodes the attraction is meant to pull together.
- **O-8. Wrapped rows: a phase or a placement mode?** Recommended: decide after S9. Current design: a stage after ordering.
- **O-9. Asynchronous panel port.** Approve the change of `LayoutEngine.layout` to a Promise with a generation, and of `toFlow` to async.
- **O-10. VSIX budget.** Raise the 800,000-byte `vsix` ceiling if S11 shows the WASM asset takes it over, or keep it and accept the host path only with a smaller build.
- **O-11. Single-threaded WASM.** Accept single-threaded WASM in every browser and webview path if S3 shows no cross-origin isolation.
- **O-12. Toolchain pin.** The exact Rust version and its update policy. elk-rs pins 1.97.1; the pin is chosen in Phase 1.
- **D-attr. Does ordering read attraction edges?** Recommended: yes, as a barycentre tie-break at a low weight, so a collapsed busy node's order follows its partners; placement and routing use them either way. Alternative: placement and routing only, and ordering stays exactly as in TypeScript. Decided by comparing crossings with and without the term on S9's fixtures.

## What is not verified

- No Rust toolchain is installed on this machine, so every Rust figure is unmeasured.
- Webview `crossOriginIsolated`, SharedArrayBuffer and WASM behaviour in pinned VS Code and Cursor hosts (S3, S8).
- The mise backend names for `wasm-bindgen-cli`, `cargo-deny` and binaryen, and whether mise honours `rust-toolchain.toml` (Phase 1).
- The current VSIX size (no built VSIX in this workspace).
- The scouts' timings were taken on Node 20.20.2 and a loaded machine; the pinned runtime is Node 24.18.
- Whether the finance graph is one component (S10).
- The fine structure of the rest of `place/` (the scouts cite `place/across.ts`, `place/quadratic.ts`, `place/projection.ts` and `place/boxRects.ts`, which I did not re-read).
- That `layout(...)` calls exactly `runPhases` and nothing else; I read `phases.ts` and the adapter, not the whole of `layout.ts`.
