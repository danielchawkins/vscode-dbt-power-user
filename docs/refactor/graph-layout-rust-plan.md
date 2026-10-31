# Graph layout in Rust: phased plan

**Status:** Accepted, 2026-10-29, with the owner's answers (see "Owner decisions"). Companion to [ADR 0011](../adr/0011-graph-layout-in-rust.md), which supersedes the earlier draft (revision `poxusprynpzu`, `docs/adr/0011-graph-layout-compute.md` and `docs/refactor/graph-layout-rust-plan.md` in that revision). This plan does not implement anything. Each phase names its scope, the code it touches, its check (the gate that must pass before the next phase starts), and how it is undone.

## How to read the gates

- **Parity is on outcomes** (O-6, answered). A phase passes when, on the fixtures in its check, ranks and orders match TypeScript (or the difference is explained), every result is valid (no overlap, separations met, every edge routed or flagged), and crossings, bends, edge length and bounds are equal or better within a recorded tolerance. Each phase commits a discrepancy report listing every difference from TypeScript. A Rust redesign that is more robust is preferred to a literal port. Native and WASM builds are compared bit for bit.
- **Oracles.** `packages/graph-layout/src/testing/exactCrossings.ts` and `exactSeparations.ts` are the exact references for ordering and placement. Property tests in the package, the golden fingerprints in `src/route/rowsGolden.test.ts`, and `just smoke-engines` are the end-to-end gates.
- **Finance fixture.** The 1,122-node / 1,241-edge graph in `/Users/daniel/projects/finance-pipelines/conformance-staging/transformation/dbt/finance_general/target/manifest.json`, measured by `/tmp/bench/full-graph.mjs`. Current TypeScript numbers on Node v20.20.2 (repo pins 24.18, so re-measure on 24.18 before a gate that compares speed): `fast` 651 ms (five runs, 617 to 703 ms); `balanced` 34,640 ms (one run); placement 34,532 ms of that, 93.4% of self time.
- **Speed gates are targets, not facts.** Only the Phase 0 VPSC patch has a measurement (below). Every other speed number here is a hypothesis until a spike measures it.
- **Determinism.** No `HashMap` iteration, stable sorts only, the seeded PRNG from `src/random.ts` (`mulberry32`) reproduced exactly, no `mul_add` or fast-math, and no clock reads in the core (ADR Decision 9; `ts-graph-layout-deterministic` already forbids them in TypeScript).

## Phase summary

| Phase | Scope                                                                                                                             | Engine default                     | Check (must pass to continue)                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0     | TypeScript preparation: scouts 1, 3 to 5 and 9 (pre-Rust structure)                                                               | TypeScript                         | `just check`; finance bench output identical before and after                                                                    |
| 0.9   | Lineage panel vocabulary, input split, cache, host adjacency (R1 to R5, R6 and R10 as listed below)                               | TypeScript                         | `just webviews::typecheck`, `just webviews::test`, panel smoke                                                                   |
| 1     | Rust scaffolding: workspace, toolchain pin, boundary rules, `crates::check` in `just check`, wasm and napi hello builds, S11 size | TypeScript                         | `just crates::check` green; boundary rules fail on a planted violation; `just smoke-engines` unchanged                           |
| 2     | `solve` kernel (VPSC, Projector)                                                                                                  | TypeScript                         | `exactSeparations` oracle; 2,000 random problems meet every separation with objective within tolerance; discrepancy report       |
| 3     | `index`, `layering` (ranks, acyclic, dummy chains)                                                                                | TypeScript                         | ranks equal on package fixtures and random DAGs, or each difference explained; discrepancy report                                |
| 4     | `order` (weighted median, sifting, Fenwick crossing count)                                                                        | TypeScript                         | `exactCrossings` oracle; crossings equal or fewer than TypeScript; discrepancy report                                            |
| 5     | `place` (constraints, gradient projection, Brandes–Köpf, offsets, boxes) and `across` as today's `Rows` / `Levels`                | TypeScript                         | no overlap; separations met; bounds and edge length within tolerance on fixtures and the finance graph; discrepancy report       |
| 6     | `route` and `metrics`; the `balanced` and `thorough` engines                                                                      | TypeScript                         | every edge routed or flagged; no box crossing; `metrics` within tolerance; `just smoke-engines` compares Rust against TypeScript |
| 7     | `engine` handle: phase caches, keys, progressive results, generations, `Budget`, allocation discipline                            | TypeScript                         | I1 property test; S7 key check; S5 zero-allocation; cancel test; S12 relayout p50 recorded                                       |
| 8     | Bindings, host Worker path, async panel port, cutover                                                                             | Rust (TypeScript behind a setting) | `just smoke-engines` with Rust default; VSIX under about 2 MB (O-10); S8 result recorded in the CSP research note                |
| 9a    | Attraction edges (`attract` policy)                                                                                               | Rust                               | no dummy created; weight 0 equals graph without the edge; monotone distance                                                      |
| 9b    | Excluded nodes                                                                                                                    | Rust                               | `layout(G with excluded)` equals `layout(G minus them)`, bit for bit, in Rust                                                    |
| 9c    | Stable dummy keys; `LayoutHints.layers`                                                                                           | Rust                               | `layout(G, hints(layout(G)))` equals `layout(G)`                                                                                 |
| 9d    | Components and shelf packing                                                                                                      | Rust                               | one-component graph unchanged; packed boxes do not overlap; packing deterministic                                                |
| 9e    | `across`: `Wrapped { max_width }`                                                                                                 | Rust                               | `max_width = ∞` equals `Rows`; no overlap; S9 quality table before any default changes                                           |
| 9f    | `overview::quotient`                                                                                                              | Rust                               | counts conserved; quotient laid out by the same engine                                                                           |
| 10    | Retire the TypeScript engine from the product (O-4)                                                                               | Rust only                          | `just smoke-engines` on Rust; golden fixtures kept                                                                               |

Phases 2 to 6 port in measured-payoff order: placement (93.4% of balanced time) first, then ordering, ranking and routing. The engine stays on TypeScript until Phase 8, so a Rust regression cannot reach users.

## Phase 0: TypeScript preparation (no Rust yet)

**Why first.** It gives the Rust port a clean structure to copy. Block-local multipliers and plain indexing (scout 2) are already merged: balanced placement on the finance graph went from 34.7 s to 4.6 s with identical output.

**Scope.**

1. Move VPSC into `packages/graph-layout/src/solve/` with no behaviour change (scout 1). Rule: `solve/` contains no import from outside itself.
2. Done: block-local multipliers and plain indexing (scout 2).
3. Replace the per-projection block rebuild with incremental block merging, and add `createProjector` that is warm-started (scout 3). This is the quadratic term: x0 reads per variable grow from 130 to 1,026 across n = 128 to 1,024 in the original and from 58 to 437 with the spike; the merge removes most of the remaining growth.
4. Introduce one `Budget` per run in place of per-phase effort tables (scout 4).
5. Index once and make layering its own phase (scout 5; `indexed.ts`).
6. Dropped: TypeScript is not changed to match Rust's arithmetic (O-6 is outcome parity).
7. Audit the 12 `.sort(` sites and the `.keys()` / `.values()` sites for stability and iteration order (ADR, Determinism). Fix any that depend on insertion order that is not stated.

**Check.**

- `just check` passes.
- `rowsGolden` is unchanged.
- The finance `balanced` output is bit-equal before and after the phase.
- `/tmp/bench/full-graph.mjs` shows balanced placement at or below about 5 s on this machine (4.6 s measured after the merged solver change). This is a regression bound, not a new target.
- `exactSeparations` and `exactCrossings` pass.

**Undo.** Each item is its own commit. Items 1 to 5 revert independently.

## Phase 0.9: lineage panel groundwork (webview, before the async port)

These refactors come from the lineage-panel scout and are needed before the layout call can become asynchronous (O-9). They do not touch the engine. Scout R-numbers are kept.

- **R1 One meaning per word.** Rename the overloaded "hidden" into distinct terms (for example "filtered out", "collapsed", "not drawn") everywhere in `webviews/src`. Done before any port so that later diffs are readable.
- **R2 One visibility projection.** Cards and drawn edges read one projection. Cards and edges cannot disagree.
- **R3 Split input.** `FlowInput` becomes `LayoutInput` (what the engine receives: graph and options only) and a decoration object. The engine receives only `LayoutInput` (ADR, Phase 7 invariant: engine keyed on graph and options only).
- **R4 Cache keyed on inputs.** Layout results cached by the content key of `LayoutInput`. This is the webview-side mirror of the engine's phase cache; the webview cache is subsumed once Phase 7 lands.
- **R5 Stop laying out intermediate graphs.** Coalesce requests so that only the latest settled input runs (host scheduling in Phase 8; generation cancellation in Phase 7).
- **R6 Layout independent of open file and selection.** The engine input does not depend on the editor's open file or selection.
- **R10 Weighted unrouted hint edges.** The `hint` edge role becomes `ranks: false, routed: false` with a weight: a pull without a drawn edge. This is the same policy the attraction feature (9a) needs; defining it here means 9a adds only the Rust side.

R7 (host data-flow adjacency), R8 (whole-project graph request) and R9 (view state separated from host-answer caches) are host-side and can run in parallel with 0.9 or move to Phase 8; the scout did not rank them against the Rust boundary, so they are not on the critical path.

**Check.** `just webviews::typecheck` and `just webviews::test` pass; the panel's existing smoke test shows the same cards and edges before and after R1 to R3 (a snapshot of the projection, not of the pixels).

**Undo.** Each R-item is a separate change set.

## Phase 1: Rust scaffolding and the gates

Phase 1 starts with the tooling, before any engine code, so the first Rust line is already formatted, linted and boundary-checked. The setup and its evidence are in [rust-tooling.md](../research/rust-tooling.md).

**Step 1a: tooling, in this order. Each item has a planted violation that must fail.**

1. **Toolchain.** `rust-toolchain.toml` is the one owner of the version: profile `minimal`, components `clippy` and `rustfmt`, target `wasm32-unknown-unknown`. `mise.toml` reads it (`idiomatic_version_file_enable_tools = ["rust"]`) and has no `rust` entry of its own. Run `mise lock` once. If `mise.lock` records only `stable`, the channel becomes the concrete newest stable, which `just update` bumps, so the version stays recorded while tracking stable (O-12). A `crates::lint-toolchain` step fails when `rustc --version` inside mise differs from the recorded version.
2. **CLIs in `mise.toml`:** taplo, cargo-deny, cargo-nextest, cargo-hack, cargo-machete, typos, wasm-bindgen-cli (equal to the `wasm-bindgen` crate) and binaryen. Prefer aqua or GitHub backends with checksums over `cargo:`, so CI does not compile them. Check: `mise install --locked` and `just lint-mise-lock`.
3. **Workspace `Cargo.toml`:** resolver 3, edition 2024 in `[workspace.package]`, and `[lints] workspace = true` in each crate. Lint levels:
   - `[workspace.lints.rust]`: `unsafe_code` forbid (the bindings override it), and `unreachable_pub`, `missing_debug_implementations` and `missing_docs` at warn.
   - `[workspace.lints.clippy]`: `pedantic` at warn, priority -1. `allow_attributes` and `allow_attributes_without_reason` at deny, so the only suppression is `#[expect(..., reason = "...")]`. In the core, `cast_possible_truncation` and `cast_sign_loss` at deny.
   - `[workspace.lints.rustdoc]`: `broken_intra_doc_links` at deny.
   - Recipes pass `-D warnings` and `--locked`, and `Cargo.lock` is committed.

   Check: a planted `unsafe {}`, `#[allow(x)]` and `f64 as i32` in the core each fail `just crates::lint`.
4. **`clippy.toml`:**
   - `disallowed-types`: `HashMap` and `HashSet`.
   - `disallowed-methods`: `Instant::now`, `SystemTime::now` and `f64::mul_add`, plus the platform float functions `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `exp2`, `ln`, `log2`, `log10`, `powf`, `powi`, `hypot` and `cbrt`, with the reason "use crate::fmath". Rust documents these as not deterministic across platforms; `sqrt` stays allowed.

   Check: an aliased `HashMap`, `let f = Instant::now` and `x.sin()` each fail.
5. **TOML has one formatter:** taplo owns every `*.toml` except `mise.lock`, through `.taplo.toml`. `just fmt` runs `taplo fmt`, `just lint` runs `taplo fmt --check`, and `.vscode/settings.json` sets the taplo extension for `[toml]`. Check: a misindented `Cargo.toml` fails `just lint`.
6. **ast-grep rules** in `ast-grep/rules`, each with a test in `ast-grep/rule-tests`. The drafts are in the research, point 10.
   - `rust-solve-no-crate-imports`
   - `rust-core-layer-imports-<group>`, one per row of the module table in ADR 0011
   - `rust-binding-imports-engine-only`
   - `rust-graph-layout-deterministic`

   The compiler also enforces the binding boundary: only `engine`, `model`, `overview` and `pack` are `pub mod`. Float-to-integer casts are left to clippy, which has the types. Check: `ast-grep test` passes, and a planted file per rule fails `just lint-ast-grep`.
7. **Supply chain.**
   - `deny.toml`: licences compatible with MIT, advisories denied, crates.io as the only source.
   - `crates::boundaries`: runs `cargo tree -p graph-layout -e normal` with no features, with `serde` and with `parallel`, and diffs each against a committed allowlist.

   Check: any new normal dependency in the core fails `crates::boundaries`, and a GPL crate fails `crates::deny`.
8. **`crates/justfile`**, added as `mod crates` in the root justfile, with `crates::check` in the root `check` loop after `test`. Recipes:
   - `fmt` and `fmt-check`;
   - `lint`: clippy, `cargo doc` with `-D warnings`, machete and typos;
   - `check-features`: the cargo-hack feature powerset, plus a `wasm32` check;
   - `test`: nextest, plus `cargo test --doc`;
   - `deny` and `boundaries`;
   - `wasm`: build, wasm-bindgen, wasm-opt, and the size into `ceilings.json`;
   - `napi`: `cargo build --release -p graph-layout-napi`, copied to `dist/graph-layout/` as the platform `.node` file. No `@napi-rs/cli`: the crate has no JavaScript side, and the CLI would add an npm dependency for one copy;
   - `parity`: the committed goldens through the native and WASM builds, byte-compared;
   - `check`: every recipe except `wasm`, `napi` and `parity`, which CI runs.

   It fails, rather than skips, when cargo is missing. Check: a planted rustfmt violation fails `just check`.
9. **Suppression ratchet:** `ceilings.json` gains `rustSuppressions.<crate>`, counted by `ratchet.mjs` from `#[expect(`. Check: one extra `#[expect]` fails `just lint-ratchet`.
10. **lefthook:** pre-commit runs `crates::fmt-check` on staged `crates/**/*.rs` and `taplo fmt --check` on staged `*.toml`; clippy stays out of pre-commit. **Editor:** `.vscode/settings.json` sets `rust-analyzer.check.command` to `clippy`, `rust-analyzer.cargo.features` to `all`, and rust-analyzer as the `[rust]` formatter.
11. **CI:** Swatinem/rust-cache keyed on `Cargo.lock`, and a matrix job per napi OS that runs `crates::napi` and `crates::parity`. Check: a planted divergence between native and WASM fails parity.
12. **knip, dependency-cruiser and the VSIX:** knip gets a workspace for the WASM crate's JS wrapper, and dependency-cruiser a scope for it. The `.wasm` and `.node` outputs go to `dist/`. Check: `just lint-unused` is clean, and a planted file under `crates/` is rejected by `vsix-contents.mjs`.

Left out of Phase 1: Miri (a core that forbids unsafe and has no dependencies gives it nothing to check), cargo-semver-checks (until publishing), cargo-mutants, benchmarks and cargo-udeps (on demand). The coverage floor (`coverage.rust`, through cargo-llvm-cov) is set after the first measurement. Settled in step 1a (these replace the open items the research could not settle):

- **Toolchain pin.** `mise.lock` records only the channel name for `stable`, so `rust-toolchain.toml` pins the concrete stable, 1.99.1. `just update` bumps that pin. `crates::lint-toolchain` checks the rustc that mise provides against it.
- **CLI backends** (`mise.toml`): aqua for `taplo`, `cargo-deny`, `cargo-nextest`, `typos`, `binaryen`, `actionlint`, `ast-grep` and `shellcheck`; GitHub for `cargo-hack`, `cargo-machete` and `wasm-bindgen` (0.2.129, equal to the crate). Each has a checksum in `mise.lock`, so CI installs without compiling.
- **`unsafe_code` is `deny` at the workspace, not `forbid`.** The napi-rs macros emit `#[allow(unsafe_code)]`, which a workspace-level `forbid` rejects (E0453). The core keeps `#![forbid(unsafe_code)]` in its own `lib.rs`.
- **`cargo doc` in a jj secondary workspace.** Its git store is a bare `.bare` repository, and cargo cannot read a path package's file list there ("did not expect repo ... to be bare"). `GIT_CEILING_DIRECTORIES`, `GIT_DIR` and `cargo rustdoc` do not avoid it. `crates::lint` therefore runs `cargo doc --no-deps --workspace --locked` with `-D warnings`, and when that exact error appears it documents a copy of the crates outside any repository, with the same `Cargo.lock` and target directory. The whole workspace is documented in both layouts; a plain clone documents in place. The core-only rustdoc fallback is gone.

Timings of each `crates::` recipe, in seconds, from `mise exec -- just crates::<recipe>` on this machine. Cold removes `crates/target` first; warm is an immediate rerun. The cargo registry stayed warm for both, so cold numbers exclude downloads.

| Recipe           | Cold | Warm |
| ---------------- | ---- | ---- |
| `lint-toolchain` | 0    | 1    |
| `fmt`            | 0    | 1    |
| `fmt-check`      | 0    | 0    |
| `boundaries`     | 0    | 1    |
| `deny`           | 1    | 1    |
| `lint`           | 8    | 1    |
| `check-features` | 1    | 0    |
| `test`           | 9    | 1    |
| `wasm`           | 6    | 2    |
| `napi`           | 7    | 1    |
| `parity`         | 11   | 1    |
| `parity-plant`   | 13   | 2    |
| `check`          | 18   | 5    |

Step 1a is done. The planted violations are in `src/test/suite/quality/` and pass. The macOS and Windows napi-parity jobs (`workflow_dispatch`) have not run yet.

**Step 1b: the crates.**

- `crates/` workspace: `graph-layout` (core, no default dependencies; features `serde` and `parallel`), `graph-layout-wasm` (wasm-bindgen), `graph-layout-napi` (napi-rs v3). Both binding crates `publish = false` (ADR Decision 2 and 3).
- Track stable Rust (O-12): `rust-toolchain.toml` on the `stable` channel, `rust` and the Rust CLIs at `latest` in `mise.toml`, resolved versions recorded in `mise.lock`. Check whether mise honours `rust-toolchain.toml`, and the mise backend names for `wasm-bindgen-cli`, `cargo-deny` and binaryen (ADR, not verified).
- `crates/justfile` as `mod crates 'crates/justfile'` in the root justfile (ADR 0004 pattern, as `webviews/justfile`). Recipes: `crates::fmt` (rustfmt --check), `crates::lint` (clippy -D warnings), `crates::test`, `crates::deny` (cargo-deny: licences, advisories, bans), `crates::boundaries` (`cargo tree` allowlist; ast-grep rule tests), `crates::wasm`, `crates::napi`, `crates::parity` (quick form in `check`, full form nightly), and `crates::check` which combines the quick forms.
- Add `crates::check` to the step list of `check` in the root `justfile`; today that list is `compile lint test webviews::typecheck webviews::test`.
- ast-grep rules, in the style of `ast-grep/rules`: `rust-core-layer-imports` (per module group in ADR "Module boundaries"), `rust-binding-imports-engine-only`, and a rule that `solve/` has no `use crate::` line. Each rule ships with a test that plants a violation.
- Hello builds for wasm32-unknown-unknown and the napi target, with a `layout` that returns a fixed object, to measure size (S11) and the load path.

**Check.**

- `just crates::check` green in CI and locally.
- Each boundary rule fails on a planted violation and passes on the clean tree.
- `cargo tree` for the core shows only the allowlisted dependencies (ADR "Module boundaries").
- S11 numbers recorded (raw, `wasm-opt -O`, gzip).
- `just smoke-engines` output unchanged.

**Undo.** Remove `crates/` and the `mod` line; `check` loses one step.

Step 1b is done. The core, the WASM and napi bindings, and `crates::check` are in `check`. The bindings take a graph frame and return a layout frame: the hello stub returns an empty layout, and `fixtures/parity/frame.txt` pins its bytes for both languages. `crates::parity` and its planted divergence run in `check`. The boundary rules and the planted violations are in `src/test/suite/quality/`. Sizes are in the S11 note below.

## Phase 2: `solve` kernel (VPSC)

**Scope.** Port `place/vpsc.ts`, `place/vpscBlocks.ts`, `place/vpscForest.ts` and the solver part of `constraints/axis.ts` to `solve` (ADR module table). Public types: `solve`, `Projector`, `Separation`, `Problem` over plain `f64` and `u32`. Scratch vectors held in the engine; no per-projection allocation after warm-up (S5 later).

**Check.**

- `exactSeparations` oracle passes on Rust.
- 2,000 random problems: every separation met, and the objective equal to TypeScript's within a recorded tolerance (the same generator as the spike's `compare-builds.mjs`).
- Finance graph: the placement solve meets every separation; any difference from TypeScript is in the discrepancy report.
- S4 and S5 are run here, not later, because the solver is the code they measure.

**Undo.** `solve` is not wired into any product path until Phase 8; reverting is deleting the module.

**Done.** Phase 2 is done. The oracle passes; all 20 MSAGL cases and all 2,000 random problems are bit-identical to TypeScript (`to_bits`, native and under WASI), so every separation is met and the objective equals TypeScript's. The finance placement check is 102 of 102 solves bit-identical; its manifest is 1,126 nodes and 1,273 edges, not the 1,122 and 1,241 above, and the discrepancy report records that. S4 is not adopted, S5 is met and S6 is measured (all three in the spike list).

## Phase 3: `index` and `layering`

**Scope.** `index` (component ids, excluded filter, CSR adjacency, dense `u32` ids; scout 5) and `layering` (`rank/*`, `acyclic.ts`, ranks and dummy chains from `layering.ts`). Dummy keys are (edge or cluster id, rank, position) from Phase 9c, generated in input order here.

**Check.** Ranks equal to TypeScript on every package fixture, random DAGs and the finance graph, or each difference explained in the discrepancy report with total edge length no worse.

**Done.** Phase 3 is done. Ranks and dummy chains equal TypeScript bit for bit on every fixture case (the package graphs, the negative-zero bands and 300 seeded random graphs; `KNOWN_DIFFERENCES` is 0), and on the finance graph from its dump (1,126 nodes, 1,273 edges; `ranks_and_chains_match_typescript_on_the_finance_graph` passes against it). The timing workload is checked against TypeScript on its first run. S6 is measured on the finance graph and the 3,000-node synthetic DAG: native and WASI are at least 3.1x faster than TypeScript on both, above the 1.5x threshold (S6 row). The 300-node cell of S6 is not measured. The four per-call allocations in `layering` remain, and are Phase 7's S5 work.

## Phase 4: `order`

**Scope.** `order/*`, `fenwick.ts` (`f64`, not integer: `countCrossings` adds fractional link weights such as `column: 0.5`, so an integer tree would round them; may vectorise, S4), `spines.ts` ordering part. Ordering reads `budget.sweeps`, `siftRounds`, `restarts`, `seed`, and order hints (ADR "Live tuning", table). D-attr does not apply yet.

**Check.** `exactCrossings` passes; crossings equal or fewer than TypeScript on fixtures and the finance graph; differences in the discrepancy report.

## Phase 5: `place` and `across` (Rows, Levels)

**Scope.** `place/*` except the solver, `constraints/*` except the solver, `offsets.ts`, `boxRects`, and the current `Rows` / `Levels` handling from `place/across.ts`. Gradient projection runs a VPSC solve per iteration, so Phase 2's kernel is on the hot path (ADR: 200 projections per balanced run). Brandes–Köpf is ported in full.

**Check.** No overlap and every separation met on fixtures, the finance graph and the `rowsGolden` inputs; bounds and total edge length within tolerance of TypeScript; differences in the discrepancy report. Scout 6's boundary is in place: the restacking entry `place::boxes` is public and route uses only that.

## Phase 6: `route`, `metrics` and the engines

**Scope.** `route/*`, `drawingSegments.ts`, `lateral.ts`, `metrics.ts`; `balanced` and `thorough` (restarts; the only native-side rayon use, deterministic merge in index order, S2). `classic` is removed before this phase (roadmap Phase A) and is not ported.

**Check.** Every edge routed or flagged; no edge crosses a foreign opaque box (roadmap Phase B oracle); `metrics` within tolerance of TypeScript; `just smoke-engines` compares Rust against TypeScript for each engine; S2 thread sweep shows output equal across 1, 2, 4 and 8 threads.

Phase 6 is the point at which the Rust core is a complete replacement for the TypeScript engine, equal or better on every gate metric. It is not yet shipped or made the default.

## Phase 7: the `engine` handle

**Scope.** `engine` module: `Engine`, `Progress`, `Generation`, `layout`. Phase caches keyed by FNV-1a 64 over canonical bytes of what each phase reads (ADR "Live tuning" key table); a change re-runs from the first phase whose key changed; `Budget` counts only, no clock; cancellation by generation; progressive results (a fast result, then refined). `layout(&Graph, &Options)` is a wrapper that runs the handle to its final stage. Invariant I1: the handle's final result equals the wrapper's. Carried from Phase 3: the layering `Scratch` reuses its three outer buffers, but `break_cycles`, `partition_constraints`, `hint_constraints` and `network_simplex` still allocate on every call; making them allocation-free is in this phase's S5 gate, not done yet.

**Check.**

- I1 property test: for random graphs and option sequences, the handle after a sequence of changes equals a fresh `layout` on the final inputs, bit for bit.
- S7 passes: the key table matches the TypeScript code's real dependencies, checked against the code and a scripted probe that perturbs each option and reports which phases change.
- Cache test: a placement-weight change re-runs placement and routing only; a spacing change re-runs routing only (ADR "Live tuning" examples).
- Cancel test: a superseded generation returns without a result and does not corrupt the cache.
- S5: placement-only relayout allocates nothing after warm-up (target; the counting-allocator test measures it).
- S12 recorded: relayout p50 for placement-only and routing-only changes on the finance graph, native and WASM. The ADR targets (about 50 ms placement-only native; about 100 ms `fast`) are checked here and either kept or changed in writing.

**Undo.** The handle is additive; the wrapper path remains.

## Phase 8: bindings, host Worker, async panel port, cutover

**Scope.**

- `graph-layout-wasm`: wasm-bindgen entry with the columnar frame (ADR Decision 6) and JSON options; result copied out of linear memory (S1).
- `graph-layout-napi`: napi-rs v3 entry with the same frame. Measured against WASM in S6; ship only if S6 meets the margin in ADR "Consequences" (about 1.5x), which decides O-2.
- Host path (O-1, recommended): the WASM engine runs in a `worker_threads` Worker in the extension host; napi when present. Webview option C (webview Worker) is only adopted if S8 passes.
- Async panel port (O-9): `LayoutEngine.layout` returns a Promise carrying a generation; `toFlow` becomes async. The webview cancels superseded generations.
- Default engine switches to Rust; `graphLayout.engine` setting keeps TypeScript as a fallback until Phase 10.
- Propose the CSP change for the lineage panel only (ADR "Bindings"; `src/webview/panelHtml.ts`), and only after S8 results.

**Check.**

- `just smoke-engines` passes with Rust as default, on the pinned VS Code and Cursor hosts used by the smoke harness (`scripts/smoke/pins.env`).
- VSIX size: under about 2 MB (O-10), with the `vsix` ceiling in `scripts/quality/ceilings.json` set from the S11 numbers in the commit. `lineage.js` must still fit its ceiling; the WASM asset is loaded by the host, so the webview bundle should not grow. Check it.
- CSP: the panel's CSP is unchanged unless S8 has passed, and the research note is updated with the S8 result either way (`docs/research/webview-csp-october-2026.md`).
- Node native against WASM timing recorded for the finance graph (the choice O-2 depends on).

**Undo.** Setting back to TypeScript; the TypeScript engine is still in the package until Phase 10.

## Phase 9: new features (each defaults off)

Each feature ships with its own check, and the Phase 6 gate stays green with every feature off (ADR "New core features").

- **9a Attraction edges.** `attract?: boolean` on kind policies, valid only with `ranks: false`; no dummy chain; placement pull weighted by `weight`; ordering reads them as a low-weight tie-break (D-attr, answered yes; S9 compares with and without); crossings not counted; routed only with `routed: true`. Check: no dummy created; weight 0 equals graph without the edge; with rising weight, endpoint distance does not increase. The TypeScript reference ignores the field (O-5).
- **9a+ Edge groups off.** Any edge kind or named edge group can be switched off, and the graph re-laid out without it (O-7). Attraction is one such group. Check: switching a group off equals the layout of the graph without those edges.
- **9b Excluded nodes.** Applied in `index` before any phase. Check: `layout(G with excluded)` equals `layout(G minus them)`, bit for bit; toggling marks only the touched components dirty.
- **9c Stable dummy keys and `LayoutHints.layers`.** Check: `layout(G, hints(layout(G)))` equals `layout(G)`.
- **9d Components and packing.** Components over ranking and routed edges, plus attraction edges (O-7, answered yes) unless their group is switched off. Shelf packing sorted by (height descending, index) with `spacing.cluster`. Check: one-component graph unchanged; packed boxes do not overlap; packing deterministic. Also S10 (is the finance graph one component?) decides how much this helps the finance case.
- **9e `across`: `Wrapped { max_width }`.** Gated on S9 (crossings, bends, bounds against `Rows` and `Levels`, before any default changes) and O-8 (decided after S9, leaning to a placement mode; layouts stay flexible). Check: `max_width = ∞` equals `Rows`; no overlap.
- **9f `overview::quotient`.** One node per group, sized by member count; one edge per (group pair, kind) with a count; map back to originals. Check: counts conserved; laid out by the same engine.

Order inside Phase 9: 9b and 9c first (small, they serve the hint and cache work), then 9a and 9d, then 9e after S9, then 9f.

## Phase 10: retire the TypeScript engine (owner decision O-4)

Remove the TypeScript engine from the product and from `packages/graph-layout`'s runtime. Keep the golden fixtures and the oracle tests either as a dev-only package that never ships (recommended) or as fixtures alone. Remove the `graphLayout.engine` TypeScript fallback when the owner agrees.

**Check.** `just smoke-engines` on Rust only; the golden fixtures pass against the Rust engine; the package is absent from the VSIX.

## Spike list

Each spike runs in the phase named, writes its result into this plan or the ADR, and has a pass criterion. A failed spike changes a decision, not a gate. The pass criteria are proposed thresholds, not measurements; the owner may change them before the spike runs.

| ID | Measures | Method | Pass criterion | Decides | Run in |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| S1 | Boundary cost: encode, copy and decode in WASM and napi; the relayout p50 it sits beside | Columnar frame vs JSON on the finance graph and a 3,000-node synthetic graph, round trip in each binding | Columnar is at least 3x cheaper in encode-plus-decode than JSON, and below 5% of relayout p50 | Decision 6 (encoding) | Phase 1 (WASM), Phase 8 (napi) |
| S2 | Native thread scaling | Sweep 1, 2, 4, 8 threads on the finance graph (one component, so restarts carry the gain) and the 3,000-node graph | Output bit-equal across thread counts; speed-up recorded | Decision 7 (rayon), thorough restarts | Phase 6 |
| S3 | Webview `crossOriginIsolated` and `SharedArrayBuffer` in pinned VS Code and Cursor hosts; Node wasm-threads speed as an upper bound | A probe panel in the smoke harness reading both flags; Node `wasm32-wasip1-threads` build of the core; research into other routes to browser threads (a cross-origin-isolated iframe or worker, a host Worker pool, a separate process) | Result recorded, with each route tried. If none works, WASM is single-threaded in the webview (O-11) | O-11, WASM threads (Decision 7) | Phase 1 |
| S4 | SIMD benefit | Scalar against `simd128` on the VPSC merge loop, the crossing count and the quadratic term | Bit-equal; speed-up recorded; adopt only if bit-equal | SIMD choice | Phase 2. **Result (not adopted):** bit-equal to scalar, with the 2,000 random outputs byte-identical to native under WASI with simd128, but slower than the scalar merge loop it would replace (WASI random pass 6.5 ms against 5.7 to 5.9 ms; merging chain at n = 1,024 6.1 ms against 4.2 to 4.9 ms). The scalar code stays. |
| S5 | Allocation discipline | Counting global allocator in a test; placement-only relayout after warm-up | Zero allocations in steady-state relayout (a target, not yet a measurement) | Allocation strategy | Phase 2, re-run Phase 7. **Result: met for the solver:** `tests/alloc.rs` counts zero allocations on a steady-state re-solve, including the merge-free case that allocated before the scratch was reserved. |
| S6 | Native margin over TypeScript, per phase | Each ported phase native against TypeScript on the same algorithm, at 300, 1,122 and 3,000 nodes | At least about 1.5x for the native addon to be worth shipping (ADR "Consequences") | O-2 (addon distribution) and the 50 ms and 100 ms targets | Phases 2 to 6, final at Phase 8. **Result (Phase 2, `solve`):** two full runs of `scripts/bench/solve-timings.mjs` on Node 24.18.1, per solve. Native is 2.7 to 4.6x faster than TypeScript on the 2,000 random problems (per pass) and on the merging chains of n = 128 to 1,024, both shapes. WASI is 2.1 to 4.4x on the same workloads, with one run's random pass at 2.4x on a noisy machine. One cell (reverse, n = 256, native 1.08x) did not reproduce in the second run (3.13x). Threshold of 1.5x met for both. Not yet measured at 300, 1,122 and 3,000 nodes; those belong to the phases whose scope includes the whole graph. **Result (Phase 3, `layering`):** two full runs of `scripts/bench/layering-timings.mjs` on Node 24.18.1, per pass of ranking then layering (TypeScript `rank` then `layer`; Rust `rank_and_layer`). Finance graph (1,126 nodes, 1,273 edges): TypeScript 88.5 and 85.4 ms, native 19.1 and 18.8 ms (4.65x and 4.55x), WASI 23.7 and 24.0 ms (3.73x and 3.56x). Synthetic DAG (3,000 nodes, 5,902 edges, seed 1): TypeScript 2,478 and 2,335 ms, native 662 and 719 ms (3.74x and 3.25x), WASI 776 and 746 ms (3.19x and 3.13x). Threshold of 1.5x met for native and WASI on both workloads. Not measured at 300 nodes. |
| S7 | Phase cache key table | Scripted probe: perturb each option, report phases that change; compare with the TypeScript code's real reads | Table matches the probe for every option; no phase reads an option it is not keyed on | Live-tuning key table; I1 | Phase 7 |
| S8 | Webview WASM, Worker and CSP on the pinned hosts | Pinned-host spike in `scripts/smoke` (the spike that recorded three failures: `'wasm-unsafe-eval'`, `worker-src blob:`, wasm `connect-src`) | Pass on both pinned hosts with the minimal CSP change named in the research note | O-1 (host vs webview Worker) and the CSP proposal | Phase 8, before the CSP change |
| S9 | Quality of `Rows`, `Levels` and `Wrapped { max_width }` | Crossings, bends and bounds on the finance graph and the package fixtures; D-attr comparison (with and without the ordering term) | Wrapped chosen only if it reduces bounds on very wide ranks without raising crossings above `Rows` by more than an agreed margin (to be set with the owner) | O-8, D-attr, the default of 9e | Phase 9e (TypeScript prototype allowed earlier) |
| S10 | Is the finance graph one component? | Component count over ranking and routed edges, and over attraction edges | Recorded | Value of 9d for the finance case | Before Phase 9 |
| S11 | WASM and napi sizes | Hello builds (raw, `wasm-opt -O`, gzip); the VSIX with the WASM asset | Hello WASM 40,643 bytes after `wasm-opt -O`: 5% of the 800,000-byte VSIX ceiling and 13% of the 315,000-byte `lineage.js` ceiling | O-10, `scripts/quality/ceilings.json` | Phase 1, re-run Phase 8 |
| S12 | Relayout latency | Placement-only and routing-only changes on the finance graph, p50 and p95, native and WASM | Recorded; the ADR's 50 ms and 100 ms targets kept or changed in writing | Live-tuning targets | Phase 7 |

S11 is measured for the hello builds (Phase 1, Darwin arm64, rustc 1.99.1, wasm-bindgen 0.2.129, wasm-opt version 133). The WASM binding `graph_layout_wasm_bg.wasm` is 61,170 bytes raw, 40,643 bytes after `wasm-opt -O`, and 17,080 bytes gzipped with `gzip -9`. The napi `.node` is 618,416 bytes, 77% of the 800,000-byte VSIX ceiling on its own; it is not in the VSIX. The hello builds carry no engine, so these are a floor that the engine adds to. The WASM file is not in the VSIX yet; its `size` ceiling in `scripts/quality/ceilings.json` is 43,000 bytes, about 6% over the `wasm-opt -O` size. The VSIX size itself is not re-measured until the WASM ships.

## Owner decisions

Answered 2026-10-29; the table in ADR 0011, "Owner decisions", is the authority. Changes from the recommendations: O-6 is outcome parity with a discrepancy report, not bit parity; O-7 is part of a general edge-group switch; O-8 leans to a placement mode; O-10 sets a budget under about 2 MB; O-11 asks for research into browser threads; O-12 tracks stable instead of pinning 1.97.1.

## Risks

- **TypeScript fallback loses features.** Once Rust is the default, the TypeScript fallback ignores attraction, exclusion and wrapping. That is acceptable only if the setting is documented as a fallback (O-5). Remove it at Phase 10.
- **Outcome parity hides drift.** A gate on metrics can pass while the drawing changes. Every phase commits its discrepancy report, and `just smoke-visual` captures the finance graph from both engines before cutover.
- **WASM without threads.** If S3 shows no isolation and the O-11 research finds no other route, every browser path is single-threaded. The Phase 6 and Phase 7 numbers from S2 then bound only the native path.
- **VSIX growth.** The WASM asset raises the VSIX; the budget is under about 2 MB (O-10).
- **CSP.** The pinned hosts failed three WASM and Worker checks in the earlier spike. Phase 8 does not change the panel's CSP until S8 passes, and the research note is updated either way.
- **Measured versus hoped.** The 50 ms and 100 ms targets, the zero-allocation target and the speed-up of the Rust port are hypotheses. Each has a spike; none is claimed as done.

## Not verified

- The Rust toolchain is not installed on this machine (no `rustc`, `wasm-pack`, or napi CLI), so every Rust figure in this plan is a target until S1 to S12 run.
- The mise backend names and `rust-toolchain.toml` support (Phase 1).
- The pinned VS Code and Cursor hosts' webview isolation and CSP behaviour (S3, S8).
- The finance graph's component count (S10).
- The measurements above were taken on Node v20.20.2; the repo pins 24.18.
