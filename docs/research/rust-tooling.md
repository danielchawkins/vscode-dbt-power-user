# Research

## Question

What is the best linting, formatting, type-checking, static-analysis, testing and supply-chain tooling setup for this repository's new Rust crates (core plus WASM and napi bindings), such that it can be the first step of the Rust build (Phase 1) and fit the existing mise + Just + ast-grep + ratchet quality system?

Cover, with a concrete recommendation and the reason for each:

1. Toolchain: rust-toolchain.toml vs mise `rust` backend; tracking stable reproducibly (what mise.lock can and cannot pin for rustup toolchains); components and targets (wasm32-unknown-unknown, napi targets); MSRV policy given "track stable".
2. Formatting: rustfmt config (stable-only options vs nightly-only, edition), and TOML formatting (taplo or alternatives) so Cargo.toml and rust-toolchain.toml have one formatter, consistent with "one formatter per file type".
3. Lints: clippy lint groups (pedantic, nursery, restriction picks), `[lints]` tables in workspace Cargo.toml vs clippy.toml vs crate attributes, `-D warnings` in CI; clippy.toml disallowed-types/methods for the determinism rules (HashMap, HashSet, Instant::now, SystemTime::now, f64::mul_add) and whether disallowed-methods catches trait/inherent methods reliably; rustdoc lints (missing_docs, broken links); `unsafe_code`, `unreachable_pub`, `missing_debug_implementations`; how suppressions (`#[allow]`/`#[expect]` with reasons) can be counted and ratcheted like the repository's oxlint/ESLint suppression files.
4. ast-grep for Rust: what ast-grep's Rust grammar handles well (module import boundaries via `use crate::` patterns, banned calls, comment rules), what is better left to clippy or to compiler visibility, rule-test style matching the repository, and concrete draft rules for: rust-core-layer-imports (per module group, from the ADR's module table), rust-binding-imports-engine-only, solve/ has no `use crate::`, no float-to-int `as` casts in the core, no clock reads.
5. Type checking and correctness beyond clippy: `cargo check` for all targets and feature combinations (cargo-hack --feature-powerset), docs build, Miri (is it useful for a forbid(unsafe) crate?), cargo-semver-checks (relevant before publishing), typos.
6. Dependencies and supply chain: cargo-deny (licences compatible with MIT, advisories, bans keeping the core's default dependency set empty, sources), cargo-machete vs cargo-udeps for unused deps, `cargo tree` allowlist approach from the ADR, Cargo.lock policy for a workspace that ships binaries (WASM/napi).
7. Tests: cargo test vs cargo-nextest, property testing (proptest vs quickcheck vs bolero) and how to share seeds or fixtures with the TypeScript fast-check tests, coverage (cargo-llvm-cov) and whether to add a floor to ceilings.json, mutation testing (cargo-mutants) on demand, benchmarks (criterion vs divan) kept out of `check`, wasm-bindgen-test and napi smoke tests in Node.
8. WASM and napi specifics: wasm-opt (binaryen) pinning through mise, wasm size budgets (twiggy) feeding ceilings.json, checking that native and WASM outputs are bit-identical, napi-rs CLI as an npm devDependency, and cross-target builds in CI (which runners).
9. Integration: the exact recipes for crates/justfile (fmt, lint, test, deny, boundaries, wasm, napi, parity, check), how `crates::check` joins `just check`, lefthook pre-commit subsets, CI caching (sccache or rust-cache), editor setup (rust-analyzer settings in .vscode/settings.json, clippy as the check command), and how knip/dependency-cruiser/VSIX allowlist must change.
10. Speed: how long each step takes on a crate of about 10k lines, and which steps belong in `check` versus on-demand recipes.

Survey the option space independently, including options nobody named here; do not weight an option by who proposed it, and say where the evidence is thin. Cite current documentation (2026) for each tool's behaviour and version; prefer primary sources (the tools' own docs, release notes, the Rust reference and clippy lint list). End with a single ordered Phase 1 checklist: each item a file to create or change, its content outline, and the check that proves it works (for example a planted violation that must fail).

## Recommendation

Phase 1 is the following ordered checklist; each step names the file, what goes in it, and the check that proves it works.

1. **Toolchain.** Create rust-toolchain.toml (channel stable, profile minimal, components clippy and rustfmt, target wasm32-unknown-unknown) and add `idiomatic_version_file_enable_tools = ["rust"]` under [settings] in mise.toml. Proof: `mise exec -- rustup show active-toolchain` names the file. If mise.lock does not record a concrete version, the owner chooses whether channel becomes the concrete newest stable, bumped by `just update`.
2. **CLIs in mise.toml.** Add taplo, cargo-deny, cargo-nextest, cargo-hack, cargo-machete, typos and wasm-bindgen-cli (equal to the wasm-bindgen crate), preferring aqua or github backends, and binaryen. Proof: `mise install --locked` and `just lint-mise-lock`.
3. **Workspace Cargo.toml.** Create it: resolver 3, [workspace.package] with edition 2024, the [workspace.lints] from point 6, and the three crates. Commit Cargo.lock. Proof: planted `unsafe {}` in the core, planted `#[allow(x)]`, and planted `f64 as i32` each fail `just crates::lint`.
4. **clippy.toml.** Add disallowed-types (HashMap, HashSet) and disallowed-methods (Instant::now, SystemTime::now, f64::mul_add, and the float functions in point 14). Proof: planted aliased HashMap, `let f = Instant::now`, and `x.sin()` each fail.
5. **TOML formatting.** Add .taplo.toml, `taplo fmt` in `just fmt` and `taplo fmt --check` in `just lint`, and a `[toml]` entry in .vscode/settings.json. Proof: a misindented Cargo.toml fails `just lint`.
6. **ast-grep rules.** Add rust-solve-no-crate-imports, one rust-core-layer-imports-<group> rule per row of the ADR table, rust-binding-imports-engine-only and rust-graph-layout-deterministic to ast-grep/rules, each with a test in rule-tests (verified drafts in point 10). Proof: `ast-grep test` passes, and a planted file per rule fails `just lint-ast-grep`.
7. **Supply chain.** Add deny.toml and the boundaries script/allowlist. Proof: adding any normal dependency to the core fails `just crates::boundaries`, and a GPL crate fails `crates::deny`.
8. **crates/justfile.** Recipes:
   - fmt: `cargo fmt --all`
   - fmt-check
   - lint: clippy `-D warnings`, cargo doc with `-D warnings`, machete, typos
   - check-features: cargo hack powerset, plus the wasm32 check
   - test: nextest, plus `cargo test --doc`
   - deny
   - boundaries
   - wasm: build, wasm-bindgen, wasm-opt, size into ceilings.json `size`
   - napi: build via the `@napi-rs/cli` devDependency
   - parity: goldens through native and WASM, byte-compare
   - check: all of the above except wasm, napi and parity, which CI runs

   Add `mod crates` to the root justfile and `crates::check` to its check loop. Proof: a planted rustfmt violation fails `just check`, and the clean tree passes.
9. **Suppression ratchet.** Add ceilings.json key `rustSuppressions.core` plus the counter in ratchet.mjs. Proof: one extra `#[expect]` fails `just lint-ratchet`.
10. **lefthook.yml.** Add the pre-commit entries for Rust fmt and TOML. Proof: committing an unformatted .rs file is refused.
11. **CI.** Add rust-cache to ci.yml, and a matrix job per napi OS running `crates::napi` and `crates::parity`. Proof: the first PR is green, and a planted `mul_add`-style divergence fails parity.
12. **knip, dependency-cruiser and VSIX.** Give knip a workspace for crates/graph-layout-wasm/js, give dependency-cruiser a scope for that wrapper, and write wasm and napi output to dist/. Proof: `just lint-unused` is clean, and a planted file under crates/ is rejected by vsix-contents.mjs.

Leave these out of Phase 1: Miri, semver-checks, mutants, benches, udeps and coverage floors. Coverage gets its floor after the first measurement.

## Points

| Point | Verdict | Confidence |
| --- | --- | --- |
| 1. Make one file the source of truth for the toolchain: rust-toolchain.toml, with profile = "minimal", components ["clippy", "rustfmt"] and targets ["wasm32-unknown-unknown"]. Have mise read it by adding `idiomatic_version_file_enable_tools = ["rust"]` under [settings] in mise.toml, and leave `rust` out of [tools]. The thesis put a `rust = "latest"` entry in mise.toml as well as the file. That gives the version two owners. Inside the mise environment the mise entry also overrides the file, so the file's components and targets would not be what rustup reads. Phase 1 must show what mise.lock records when the file's channel is `stable`. If it records a concrete 1.x.y, keep `stable` as the ADR says. If it records only `stable`, set channel to the concrete newest stable (for example `1.NN.0`) and have `just update` rewrite it. That still tracks stable and records the version, but whether to do it is the owner's call under O-12. | middle | medium |
| 2. For core:rust, mise.lock records only the top-level version. It does not pin component contents, rustup's channel manifest, or anything Cargo resolves. Cargo.lock covers that last part. `rust@stable` is updated in place, and a dated nightly is the only exact rustup pin mise documents. The antithesis's drift hazard is real, but only outside mise: inside `mise exec` (which is how CI, lefthook and just recipes run) the toolchain mise selects wins over the file. rust-analyzer started by VS Code without mise follows rust-toolchain.toml. So when the file says `stable`, the editor floats while the gate is locked. Add a `crates::lint-toolchain` step that fails when `rustc --version` inside mise differs from the version in mise.lock. | middle | high |
| 3. Use profile = "minimal" and list clippy and rustfmt explicitly. The minimal profile is smaller, and listing the components makes them explicit. rust-toolchain.toml lists only wasm32-unknown-unknown as an extra target. Build the napi binaries natively on each OS runner, so each runner's host target is already present. Add cross targets (for example aarch64-unknown-linux-gnu) in CI with `rustup target add` in the matrix job, not in the shared file. Linkers for cross targets are a separate install; I did not verify them. | thesis | medium |
| 4. No MSRV policy beyond 'the locked stable'. Under track-stable, nothing is published (O-3), so do not set `rust-version`, or set it equal to the locked version. If the core is ever published, set `rust-version` on the core only and check it with `cargo hack check --rust-version` in an on-demand recipe. | thesis | medium |
| 5. Run rustfmt only as `cargo fmt --all` (with `-- --check` in lint), and set `edition = "2024"` once in [workspace.package]. Do not add a rustfmt.toml unless a stable option is needed; no unstable keys. TOML currently has no formatter, because oxfmt ignores `**/*.{yml,yaml,toml}`. Make taplo the single TOML formatter for every *.toml in the repository, with a .taplo.toml include list. `just fmt` runs `taplo fmt`, and `just lint` runs `taplo fmt --check`. Exclude mise.lock, which mise writes. The repository has no dprint, so the thesis's alternative does not exist. The mise backend for taplo (aqua vs github) is unverified. | antithesis | high |
| 6. Put lint levels in the workspace Cargo.toml and give each crate `[lints] workspace = true`. - [workspace.lints.rust]: unsafe_code = forbid (the bindings override this with their own [lints] table, because napi/wasm-bindgen macros may need unsafe), unreachable_pub, missing_debug_implementations and missing_docs at warn. - [workspace.lints.clippy]: pedantic at warn with priority -1, and the restriction lints allow_attributes and allow_attributes_without_reason at deny, so only `#[expect(..., reason = "...")]` is possible. - Core: cast_possible_truncation and cast_sign_loss at deny. - [workspace.lints.rustdoc]: broken_intra_doc_links at deny. - Recipes add `-D warnings` (`cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`), so local builds still compile while warnings fail the gate. Keep clippy.toml for the disallowed lists only. Ratchet: a script, or an ast-grep rule with `ast-grep scan --json`, counts `#[expect(` per crate into the ceilings.json key `rustSuppressions.core` (and one per binding). ratchet.mjs then fails when a count rises. | thesis | high |
| 7. clippy.toml disallowed-types (std::collections::HashMap, HashSet) and disallowed-methods (std::time::Instant::now, std::time::SystemTime::now, f64::mul_add, plus the float functions in point 14) is reliable for the forms that matter. On clippy 1.90 it caught all of these: - a renamed import (`use std::collections::HashMap as M`), flagged at the `use` and at each use site; - a function pointer (`let f = Instant::now; f()`); - a call inside a `macro_rules!` expansion; - inherent methods called with method syntax and with path syntax (`x.mul_add(..)`, `f64::sin(x)`); - a trait method called with method syntax (`core::iter::Iterator::sum` on `v.iter().sum()`). Third-party maps (hashbrown) are kept out by the dependency allowlist (point 8), not by clippy. The ast-grep clock rule stays as the cheap second guard the ADR requests. | antithesis | high |
| 8. Use cargo-deny for licences, advisories, sources and bans: - licences: an allowlist compatible with MIT (MIT, Apache-2.0, Unicode-3.0, BSD-3-Clause; confirm against the real dependency graph); - advisories: deny; - sources: crates.io only; - bans: multiple-versions = warn. Its [bans] allow list applies to the whole graph, so keep the ADR's `cargo tree` allowlist for the core. `just crates::boundaries` runs `cargo tree -p graph-layout -e normal --no-default-features --prefix none`, expecting only the crate itself, and then the same with `--features serde` and with `--features parallel`, diffing each against a committed allowlist. Commit Cargo.lock: the workspace ships WASM and napi binaries. Pass `--locked` to every cargo command in recipes and CI. Run cargo-machete in check (fast, imprecise; ignore false positives in workspace metadata). Run cargo-udeps on demand only, because it needs nightly. Prefer prebuilt aqua or github mise backends over `cargo:` backends for these CLIs, so CI does not compile them from source (backend availability unverified). | middle | high |
| 9. `cargo hack check --feature-powerset --all-targets --locked` on the core belongs in check: two features means four combinations. `cargo check --target wasm32-unknown-unknown -p graph-layout -p graph-layout-wasm` is in check too. So is `RUSTDOCFLAGS='-D warnings' cargo doc --no-deps --workspace`. Miri is on demand only: a forbid(unsafe) core with no dependencies gives it almost nothing to check. cargo-semver-checks waits until the core is published. typos goes in lint, scoped to crates/ at first. | thesis | medium |
| 10. ast-grep 0.50's Rust grammar handles the boundary rules if each rule matches tree nodes rather than line text: - solve/: match `kind: crate` not inside `visibility_modifier`, so `pub(crate)` stays legal, plus `super::super`. - Each core module group (one rule per row of the ADR table, for example order/): match `kind: scoped_identifier` with `regex: '^crate::'`, `not: regex: '^crate::(index\|layering\|budget\|rand)(::\|$)'` and `not: inside: scoped_identifier`. A second branch bans `use crate::{...}` lists (`scoped_use_list` whose path field is `crate`), so each import names its module. - Bindings: the same shape over `^graph_layout::`, allowing engine, model, overview and pack, banning `use graph_layout::{` and `use graph_layout as $A;`. - rust-graph-layout-deterministic: a `scoped_identifier` with `regex: '(^\|::)(Instant\|SystemTime)::now$'`, plus `thread_rng()`. Quote every regex in YAML: a bare `^crate::` fails to parse. Two things are better done elsewhere. Float-to-int casts need type information, which clippy cast_possible_truncation and cast_sign_loss at deny have. The binding boundary is better enforced by the compiler: make only engine, model, overview and pack `pub mod`, and every other module private. | middle | high |
| 11. Add a `mod crates` to the root justfile and add `crates::check` to the root check loop after `test`. It fails, rather than skips, when cargo is missing. The existing `lint-ast-grep` step (`ast-grep test`, then `ast-grep scan --error=unused-suppression`) picks up Rust rules on its own, because each rule names `language: rust`. Pre-push already runs `just check`. Add two pre-commit entries: glob `crates/**/*.rs` runs `just crates::fmt-check`, and glob `**/*.toml` runs `taplo fmt --check {staged_files}`. Leave clippy out of pre-commit. CI: the existing mise-action provides the toolchain. Add Swatinem/rust-cache keyed on Cargo.lock, which is simpler than sccache for one workspace. In .vscode/settings.json: - `rust-analyzer.check.command: clippy` - `rust-analyzer.cargo.features: all` - `[rust]` defaultFormatter `rust-lang.rust-analyzer` - `[toml]` defaultFormatter set to the taplo extension | thesis | high |
| 12. The thesis checklist is the right order but is missing the parity gate, the Cargo.lock decision, CI, knip, dependency-cruiser and the VSIX. The complete list is in the recommendation. Additions: Cargo.lock is committed and every command passes `--locked`. The `crates::parity` recipe runs the committed goldens through the native and WASM builds and byte-compares the outputs. CI adds rust-cache and runs parity on each napi OS. knip gets a workspace for crates/graph-layout-wasm/js. Built .wasm and .node files go under dist/ so the VSIX allowlist accepts them, and a planted file under crates/ must still be rejected. | middle | medium |
| 13. Tests: - Use cargo-nextest in check, plus `cargo test --doc`, because nextest runs no doctests. - Use proptest, and commit its proptest-regressions files. - Seeds cannot be shared with fast-check. Shared cases are the committed JSON goldens exported from TypeScript, replayed in both languages. Coverage: cargo-llvm-cov with `--fail-under-lines`, fed from a ceilings.json floor (`coverage.rust`) set after a first measurement. Run it in CI or on demand, not in check. Other on-demand recipes: - cargo-mutants with `--in-diff`; - criterion or divan benches in a `bench` recipe; - twiggy for diagnosis. Still unverified, and so not recommended as settled: wasm-bindgen-test and napi smoke details, wasm-opt through mise, which CI runners to use, criterion versus divan, and all timings. | middle | medium |
| 14. Platform float functions are a documented determinism risk that the ADR's bans do not cover. Rust documents the precision of f64 transcendental functions (powf, powi, sin and others) as non-deterministic across platforms and Rust versions. Ban them in the core through clippy disallowed-methods: sin, cos, tan, asin, acos, atan, atan2, exp, exp2, ln, log2, log10, powf, powi, hypot and cbrt, with reason 'use crate::fmath'. Implement the few the engine needs in-crate. The TypeScript engine uses only Math.hypot and Math.sqrt outside tests. Allow sqrt, which IEEE 754 defines as correctly rounded (I did not re-read the Rust doc for sqrt). The native-against-WASM byte-compare test is the backstop, and it must run on every OS that ships a napi binary, because each has its own libm. | new | medium |
| 15. Speed, all speculative (nothing was timed on a 10k-line crate). With a warm cache, `cargo fmt --check`, taplo, typos, machete and the ast-grep scan should each take about a second. Clippy on all targets, the four-combination cargo-hack check, the wasm32 check and nextest are likely in the tens of seconds, and a cold CI build likely takes minutes. Those belong in check. Release WASM and napi builds with wasm-opt, coverage, Miri, mutants, benches and udeps are on demand or CI-only. The parity recipe needs release builds, so it runs in CI, and in check only if its measured time is acceptable. | new | speculative |

## Detail

### 1. Make one file the source of truth for the toolchain: rust-toolchain.toml, with profile = "minimal", components ["clippy", "rustfmt"] and targets ["wasm32-unknown-unknown"]. Have mise read it by adding `idiomatic_version_file_enable_tools = ["rust"]` under [settings] in mise.toml, and leave `rust` out of [tools]. The thesis put a `rust = "latest"` entry in mise.toml as well as the file. That gives the version two owners. Inside the mise environment the mise entry also overrides the file, so the file's components and targets would not be what rustup reads. Phase 1 must show what mise.lock records when the file's channel is `stable`. If it records a concrete 1.x.y, keep `stable` as the ADR says. If it records only `stable`, set channel to the concrete newest stable (for example `1.NN.0`) and have `just update` rewrite it. That still tracks stable and records the version, but whether to do it is the owner's call under O-12

Verdict: middle. Confidence: medium.

I read the mise Rust page. A plain `rust` or `rust@latest` request resolves to a concrete newest stable. mise sets RUSTUP_TOOLCHAIN, which rustup ranks above rust-toolchain.toml. When mise reads the file, it takes channel, profile, components and targets from it and installs any that are missing. So the thesis's mechanics are right, but its plan has two sources for the version. The ADR itself says whether mise honours the file is still to be verified. I did not run `mise lock` against a `stable` channel file, so that branch stays open.

Citations:

- [r1a](https://mise.jdx.dev/lang/rust.html): "Because mise sets RUSTUP_TOOLCHAIN , which rustup ranks above rust-toolchain.toml , the toolchain mise selects wins inside the mise environment."
- [r1b](https://mise.jdx.dev/lang/rust.html): "When the toolchain is already installed, mise install still adds missing configured components and targets"
- [r1c](https://rust-lang.github.io/rustup/overrides.html): "The toolchain is chosen in the order listed above, using the first one that is"
- [r1d](../adr/0011-graph-layout-in-rust.md): "The exact backend names and whether mise honours `rust-toolchain.toml` are verified in Phase 1."

Thesis (high): Toolchain: use rust-toolchain.toml as the single source for channel, components and targets, and have mise read it. mise does not read rust-toolchain.toml by default; with the default setting a `rust` entry in mise sets RUSTUP_TOOLCHAIN and overrides the project file, so the setting must be enabled (idiomatic_version_file_enable_tools rust, or --local in the project). mise.toml should still pin `rust` to 'latest' so the mise lock records a version.

Thesis citations:

- [c1](https://mise.jdx.dev/lang/rust.html): "If the project has a rust-toolchain.toml , let mise read it instead of repeating the version in mise.toml"
- [c2](https://mise.jdx.dev/lang/rust.html): "Because mise sets RUSTUP_TOOLCHAIN , which rustup ranks above rust-toolchain.toml , the toolchain mise selects wins inside the mise environment."
- [c3](https://rust-lang.github.io/rustup/overrides.html): "The toolchain is chosen in the order listed above, using the first one that is"

### 2. For core:rust, mise.lock records only the top-level version. It does not pin component contents, rustup's channel manifest, or anything Cargo resolves. Cargo.lock covers that last part. `rust@stable` is updated in place, and a dated nightly is the only exact rustup pin mise documents. The antithesis's drift hazard is real, but only outside mise: inside `mise exec` (which is how CI, lefthook and just recipes run) the toolchain mise selects wins over the file. rust-analyzer started by VS Code without mise follows rust-toolchain.toml. So when the file says `stable`, the editor floats while the gate is locked. Add a `crates::lint-toolchain` step that fails when `rustc --version` inside mise differs from the version in mise.lock

Verdict: middle. Confidence: high.

I read these passages myself. The antithesis went too far in saying rustup ignores the lock everywhere: its own citation (a4) shows mise's choice wins inside the mise environment. The thesis missed that the editor runs outside that environment.

Citations:

- [r2a](https://mise.jdx.dev/dev-tools/mise-lock.html): "The top-level version only"
- [r2b](https://mise.jdx.dev/lang/rust.html): "updated in place by mise upgrade"
- [r2c](https://mise.jdx.dev/lang/rust.html): "A dated nightly is an exact pin"
- [r2d](../adr/0011-graph-layout-in-rust.md): "Track stable: start on the latest stable Rust and tools, recorded in `mise.lock`; pin later."

Thesis (high): What mise.lock can and cannot pin for Rust. For core:rust, mise records only the top-level version and leaves dependency resolution to the installer, so the lock fixes the rust version but not the stable channel's component set, targets, or the rustup-managed toolchain contents. `rust@stable` is 'updated in place by mise upgrade rust'. The lock fixes exact versions for the CLIs (cargo backend tools) but not toolchain components. Consequence: components and targets must be declared in rust-toolchain.toml, which rustup honours, and the lock is a version record only. A dated nightly is the only rust request that mise locks as an exact toolchain. Track-stable therefore means: CI reruns `mise lock --bump` deliberately, and nothing guarantees bit-identical toolchains across months.

Thesis citations:

- [c4](https://mise.jdx.dev/dev-tools/mise-lock.html): "The top-level version only"
- [c5](https://mise.jdx.dev/lang/rust.html): "updated in place by mise upgrade rust"
- [c6](https://mise.jdx.dev/lang/rust.html): "and records that in mise.lock , so locked installs are reproducible"
- [c7](../refactor/graph-layout-rust-plan.md): "Track stable Rust (O-12): `rust-toolchain.toml` on the `stable` channel"

Antithesis: The thesis concludes that 'nothing guarantees bit-identical toolchains across months'. That is true only if CI floats. With `channel = "stable"` in rust-toolchain.toml, rustup resolves to the newest stable on every machine regardless of mise.lock. The lock then records a version that rustup ignores, so local and CI builds can differ from the lock the moment a new stable ships. The thesis states the mechanism (point 1) but does not draw the consequence that the combination is a *drift hazard*.

Antithesis: The thesis misses the simplest reproducibility fix that still tracks stable. The toolchain file's `channel` can be a concrete version (for example `1.NN.0`). The 'track stable' job becomes a deliberate bump PR, with `mise lock --bump` and a one-line edit to rust-toolchain.toml. Failing that, add a lint step that asserts `rustc --version` equals the mise.lock version. The thesis offers neither, so the owner's 'versions recorded in mise.lock' is not actually enforced.

Antithesis: Bit-identical native and WASM output is a property of the code, not the compiler version, because the code avoids fused multiply-add, the `libm` transcendental functions that differ between platforms, and other platform-dependent float behaviour. The thesis ties toolchain pinning to bit-identity without separating these. A compiler bump can change codegen for `sin`, `exp` and `powf`, which call platform libm natively but a bundled implementation in WASM. Ban or wrap those functions in the core (disallowed-methods for `f64::sin`, `cos`, `exp`, `ln`, `powf`, `powi`) or implement them in-crate. This is the largest determinism hole and the thesis never mentions it.

Antithesis: The thesis reads the mise Rust page's 'records that in mise.lock, so locked installs are reproducible' as a reproducibility guarantee. Under `stable` with a project rust-toolchain.toml that wins over RUSTUP_TOOLCHAIN, that sentence does not hold, which the thesis's own c2 supports.

Counter-evidence:

- [a4](https://mise.jdx.dev/lang/rust.html): "Because mise sets RUSTUP_TOOLCHAIN , which rustup ranks above rust-toolchain.toml , the toolchain mise selects wins inside the mise environment."

### 3. Use profile = "minimal" and list clippy and rustfmt explicitly. The minimal profile is smaller, and listing the components makes them explicit. rust-toolchain.toml lists only wasm32-unknown-unknown as an extra target. Build the napi binaries natively on each OS runner, so each runner's host target is already present. Add cross targets (for example aarch64-unknown-linux-gnu) in CI with `rustup target add` in the matrix job, not in the shared file. Linkers for cross targets are a separate install; I did not verify them

Verdict: thesis. Confidence: medium.

The profile behaviour comes from the rustup documentation. The mise page shows that components and targets can live in the file, which mise reads. The napi target list is a judgement, and I did not fetch the napi-rs documentation.

Citations:

- [r3a](https://rust-lang.github.io/rustup/concepts/profiles.html): "The default profile includes all of components in the minimal"
- [r3b](../adr/0011-graph-layout-in-rust.md): "`rust-toolchain.toml` names the `stable` channel with components `clippy` and `rustfmt` and target `wasm32-unknown-unknown`."

Thesis (medium): Components and targets: rustup's default profile already includes rustfmt and clippy, but the minimal profile does not, so rust-toolchain.toml should list clippy and rustfmt explicitly and add the wasm32-unknown-unknown target. rustup target add installs only the standard library; any linker for the napi targets is a separate install and I did not verify the napi linker requirements. Confidence on the napi target list is low.

Thesis citations:

- [c8](https://rust-lang.github.io/rustup/concepts/profiles.html): "The default profile includes all of components in the minimal"
- [c9](https://rust-lang.github.io/rustup/cross-compilation.html): "Note that rustup target add only installs the Rust standard library for a"

### 4. No MSRV policy beyond 'the locked stable'. Under track-stable, nothing is published (O-3), so do not set `rust-version`, or set it equal to the locked version. If the core is ever published, set `rust-version` on the core only and check it with `cargo hack check --rust-version` in an on-demand recipe

Verdict: thesis. Confidence: medium.

I confirmed that cargo-hack offers --rust-version. The policy itself is a judgement.

Citations:

- [r4a](https://github.com/taiki-e/cargo-hack): "Perform commands on `package.rust-version`."

Thesis (medium): MSRV under track-stable: do not pick an MSRV for the binding crates. Set `rust-version` only on the core crate if it is published, and verify it with a separate cargo-hack --rust-version job in the weekly recipe, not in check. This is a judgement; the evidence only establishes what the rust-version field means.

Thesis citations:

- [c10](https://doc.rust-lang.org/cargo/reference/rust-version.html): "The rust-version field is an optional key that tells cargo what version of the"
- [c11](https://github.com/taiki-e/cargo-hack): "Perform for the feature powerset of the package."

### 5. Run rustfmt only as `cargo fmt --all` (with `-- --check` in lint), and set `edition = "2024"` once in [workspace.package]. Do not add a rustfmt.toml unless a stable option is needed; no unstable keys. TOML currently has no formatter, because oxfmt ignores `**/*.{yml,yaml,toml}`. Make taplo the single TOML formatter for every *.toml in the repository, with a .taplo.toml include list. `just fmt` runs `taplo fmt`, and `just lint` runs `taplo fmt --check`. Exclude mise.lock, which mise writes. The repository has no dprint, so the thesis's alternative does not exist. The mise backend for taplo (aqua vs github) is unverified

Verdict: antithesis. Confidence: high.

I read the rustfmt Configurations.md passages and .oxfmtrc.json. `cargo fmt` reads the edition from Cargo.toml, so a rustfmt.toml edition would only duplicate it. I confirmed that taplo has a --check mode.

Citations:

- [r5a](https://raw.githubusercontent.com/rust-lang/rustfmt/master/Configurations.md): "When running `cargo fmt`, the `edition` is automatically read from the `Cargo.toml` file."
- [r5b](https://raw.githubusercontent.com/rust-lang/rustfmt/master/Configurations.md): "Stable options can always be used, while unstable options are only available on a nightly toolchain and must be opted into."
- [r5c](../../.oxfmtrc.json): ""**/*.{yml,yaml,toml}","
- [r5d](https://taplo.tamasfe.dev/cli/usage/formatting.html): "It is possible to check whether the given files are properly formatted via the --check flag."
- [r5e](../../AGENTS.md): "No file type has two formatters."

Thesis (medium): Formatting: use rustfmt with default options and no rustfmt.toml unstable keys. Nightly-only options need unstable_features and a nightly toolchain, which the track-stable toolchain does not provide. Set the edition explicitly, because rustfmt's default edition is 2015 and it should match Cargo's. For TOML, one formatter per file type means choosing one tool for Cargo.toml and rust-toolchain.toml. taplo is the usual candidate; I did not verify its current option surface, and dprint already formats Markdown, so adding a TOML plugin there is the alternative. Confidence on the TOML choice is low.

Thesis citations:

- [c12](https://raw.githubusercontent.com/rust-lang/rustfmt/master/Configurations.md): "are only available on a nightly toolchain and must be opted into."
- [c13](../adr/0011-graph-layout-in-rust.md): "clippy `pedantic` is on with a short allowlist"
- [c14](../../AGENTS.md): "No file type has two formatters."

Antithesis: The thesis says 'dprint already formats Markdown, so adding a TOML plugin there is the alternative'. That is wrong for this repository. AGENTS.md says Markdown is rumdl only. I grepped mise.toml, AGENTS.md and the justfile for dprint and found nothing, so the alternative named for TOML does not exist here.

Antithesis: The real state is that oxfmt, the repository's formatter, explicitly ignores all TOML. A TOML formatter would therefore not duplicate an existing one. Taplo, or `cargo fmt` plus a deliberate decision to leave TOML unformatted, is a clean addition. The thesis never checked .oxfmtrc.json, so it missed that the file type is currently unowned.

Antithesis: Taplo's option surface and its mise backend (`aqua:tamasfe/taplo` or `cargo:taplo-cli`) were left unverified. The recommendation is therefore only 'taplo, probably'. It also needs a decision on whether `just fmt` and `just lint` run `taplo fmt` and `taplo fmt --check`, and on how that is scoped so `mise.toml` is not double-formatted.

Antithesis: 'Set the edition explicitly in rustfmt.toml' is mostly unnecessary. `cargo fmt` reads the edition from Cargo.toml, and only a bare `rustfmt` invocation defaults to 2015. The right recommendation is to always run `cargo fmt --all` (`--check` in lint) and to put `edition` and `style_edition` in `[workspace.package]` or the crate manifests. A rustfmt.toml `edition` key can then drift from Cargo.toml.

Antithesis: The thesis cites the Configurations.md passage on nightly-only options as if it supported 'set the edition'. That passage is about unstable options. The edition point comes from a different section, which says the opposite of what the thesis implies for `cargo fmt`.

Counter-evidence:

- [a1](https://raw.githubusercontent.com/rust-lang/rustfmt/master/Configurations.md): "When running `cargo fmt`, the `edition` is automatically read from the `Cargo.toml` file."
- [a2](../../.oxfmtrc.json): ""**/*.{yml,yaml,toml}","

### 6. Put lint levels in the workspace Cargo.toml and give each crate `[lints] workspace = true`. - [workspace.lints.rust]: unsafe_code = forbid (the bindings override this with their own [lints] table, because napi/wasm-bindgen macros may need unsafe), unreachable_pub, missing_debug_implementations and missing_docs at warn. - [workspace.lints.clippy]: pedantic at warn with priority -1, and the restriction lints allow_attributes and allow_attributes_without_reason at deny, so only `#[expect(..., reason = "...")]` is possible. - Core: cast_possible_truncation and cast_sign_loss at deny. - [workspace.lints.rustdoc]: broken_intra_doc_links at deny. - Recipes add `-D warnings` (`cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`), so local builds still compile while warnings fail the gate. Keep clippy.toml for the disallowed lists only. Ratchet: a script, or an ast-grep rule with `ast-grep scan --json`, counts `#[expect(` per crate into the ceilings.json key `rustSuppressions.core` (and one per binding). ratchet.mjs then fails when a count rises

Verdict: thesis. Confidence: high.

I ran clippy 1.90 locally on a planted crate with a workspace lints table. A bare `#[allow]` triggered both allow_attributes and allow_attributes_without_reason. An unneeded `#[expect]` reported 'this lint expectation is unfulfilled'. missing_debug_implementations, missing_docs and unreachable_pub all fired, and so did `f64 as i32` under pedantic cast_possible_truncation. The cited docs confirm the mechanics.

Citations:

- [r6a](https://doc.rust-lang.org/cargo/reference/manifest.html): "lower (particularly negative) numbers have lower priority, being overridden by higher numbers"
- [r6b](https://doc.rust-lang.org/rustc/lints/levels.html): "If the lint in question is not emitted, the unfulfilled_lint_expectations lint triggers on the expect attribute, notifying you that the expectation is no longer fulfilled."
- [r6c](../../scripts/quality/ceilings.json): ""oxlintSuppressions.host": 58,"

Thesis (high): Lints: put levels in `[workspace.lints]` (clippy pedantic as warn, with a short named allowlist; rust lints such as unsafe_code forbid in the core's package table), and keep clippy.toml for the disallowed lists and thresholds. Cargo's [lints] table takes priority settings for groups. Use #[expect(lint, reason = ...)] instead of #[allow], because an expectation that is no longer fulfilled warns. Count the expect/allow attributes per crate with a script and ratchet the total in ceilings.json, as ratchet.mjs does for other suppressions. Confidence high on the mechanics; the chosen allowlist is a judgement.

Thesis citations:

- [c15](https://doc.rust-lang.org/cargo/reference/manifest.html): "Override the default level of lints from different tools by assigning them to a new level in a"
- [c16](https://doc.rust-lang.org/cargo/reference/manifest.html): "lower (particularly negative) numbers have lower priority, being overridden"
- [c17](https://doc.rust-lang.org/rustc/lints/levels.html): "If the lint in question is not emitted, the unfulfilled_lint_expectations lint"
- [c18](../../scripts/quality/ratchet.mjs): "fail when ceilings.json loosens a key relative to <file>"

### 7. clippy.toml disallowed-types (std::collections::HashMap, HashSet) and disallowed-methods (std::time::Instant::now, std::time::SystemTime::now, f64::mul_add, plus the float functions in point 14) is reliable for the forms that matter. On clippy 1.90 it caught all of these: - a renamed import (`use std::collections::HashMap as M`), flagged at the `use` and at each use site; - a function pointer (`let f = Instant::now; f()`); - a call inside a `macro_rules!` expansion; - inherent methods called with method syntax and with path syntax (`x.mul_add(..)`, `f64::sin(x)`); - a trait method called with method syntax (`core::iter::Iterator::sum` on `v.iter().sum()`). Third-party maps (hashbrown) are kept out by the dependency allowlist (point 8), not by clippy. The ast-grep clock rule stays as the cheap second guard the ADR requests

Verdict: antithesis. Confidence: high.

The thesis left trait-method coverage unknown. The antithesis argued it was overstated but tested nothing. I planted each form in a scratch workspace and ran `cargo clippy` with toolchain 1.90.0. Every form produced a disallowed-type or disallowed-method warning. I did not test re-exports through third-party crates.

Citations:

- [r7a](https://doc.rust-lang.org/clippy/lint_configuration.html): "The list of disallowed methods, written as fully qualified paths."
- [r7b](https://doc.rust-lang.org/clippy/lint_configuration.html): "The list of disallowed types, written as fully qualified paths."
- [r7c](../adr/0011-graph-layout-in-rust.md): "`clippy.toml` bans `HashMap` and `HashSet` in the core (`disallowed-types`)."

Thesis (medium): Determinism bans in clippy.toml: disallowed-types for HashMap and HashSet, and disallowed-methods for Instant::now, SystemTime::now and f64::mul_add, as the ADR specifies. The clippy configuration documents these as fully qualified paths, which is the form to use. Whether disallowed-methods reliably catches trait methods and calls through function pointers is NOT verified: I could not read the clippy source (404), so treat coverage as unknown until a planted violation for each form is confirmed to fail. Plan a second guard: an ast-grep call-site rule for the same names (the ADR already calls for one), so that a clippy gap is caught by the other.

Thesis citations:

- [c19](https://doc.rust-lang.org/clippy/lint_configuration.html): "The list of disallowed methods, written as fully qualified paths."
- [c20](https://doc.rust-lang.org/clippy/lint_configuration.html): "The list of disallowed types, written as fully qualified paths."
- [c21](../adr/0011-graph-layout-in-rust.md): "`clippy.toml` bans `HashMap` and `HashSet` in the core (`disallowed-types`)."
- [c22](../adr/0011-graph-layout-in-rust.md): "The Rust equivalent is `clippy.toml` `disallowed-methods` for `Instant::now` and `SystemTime::now`, plus an ast-grep rule."

Antithesis: The thesis asks whether disallowed-methods reliably catches trait methods and calls through function pointers, then leaves it as unknown. It stopped after one 404 and never tried the raw source. The clippy lint index entry for `disallowed_methods` was reachable and states the lint's scope, but the thesis did not read it.

Antithesis: `f64::mul_add` is an inherent method and `Instant::now` and `SystemTime::now` are associated functions. All three are plain path-resolved items, which is the easy case for the lint. The hard cases are the ones the thesis worried about, namely trait methods, aliases via `use ... as`, and macro-expanded code. None of those matters for these three bans, so the 'unknown' is overstated for the specific list.

Antithesis: Fused multiply-add can also be produced through `core::intrinsics` or `std::intrinsics`, through LLVM contraction (rustc does not enable this by default), or by a dependency. None of these is reachable from clippy. The bit-identical native-versus-WASM requirement is better backed by a parity test that compares hashes of outputs than by lint bans alone. The thesis lists parity only as a vague 'recipe'.

Antithesis: `disallowed-types` for `HashMap` and `HashSet` is a path-based type ban. It does not stop `BTreeMap` iteration on float keys, or `std::collections::hash_map::RandomState` appearing through a re-export. Test that planted `use std::collections::HashMap as M;` and `hashbrown::HashMap` both fail.

Counter-evidence:

- [a3](https://rust-lang.github.io/rust-clippy/master/index.html): "Denies the configured methods and functions in clippy.toml"

### 8. Use cargo-deny for licences, advisories, sources and bans: - licences: an allowlist compatible with MIT (MIT, Apache-2.0, Unicode-3.0, BSD-3-Clause; confirm against the real dependency graph); - advisories: deny; - sources: crates.io only; - bans: multiple-versions = warn. Its [bans] allow list applies to the whole graph, so keep the ADR's `cargo tree` allowlist for the core. `just crates::boundaries` runs `cargo tree -p graph-layout -e normal --no-default-features --prefix none`, expecting only the crate itself, and then the same with `--features serde` and with `--features parallel`, diffing each against a committed allowlist. Commit Cargo.lock: the workspace ships WASM and napi binaries. Pass `--locked` to every cargo command in recipes and CI. Run cargo-machete in check (fast, imprecise; ignore false positives in workspace metadata). Run cargo-udeps on demand only, because it needs nightly. Prefer prebuilt aqua or github mise backends over `cargo:` backends for these CLIs, so CI does not compile them from source (backend availability unverified)

Verdict: middle. Confidence: high.

The thesis is right about cargo-deny's scope and about machete versus udeps; I re-read each source. The antithesis is right that a Cargo.lock decision and `--locked` were missing; the Cargo FAQ supports keeping the lockfile for shipped builds.

Citations:

- [r8a](https://embarkstudios.github.io/cargo-deny/checks/bans/cfg.html): "Determines specific crates that are allowed. If the allow list has one or more entries, then any crate not in that list will be denied, so use with care."
- [r8b](https://doc.rust-lang.org/cargo/faq.html): "The purpose of a Cargo.lock lockfile is to describe the state of the world at the time of a successful build."
- [r8c](https://github.com/bnjbvr/cargo-machete): "cargo-machete is a Cargo tool that detects unused dependencies in Rust projects, in a fast (yet imprecise) way."
- [r8d](https://github.com/est31/cargo-udeps): "it needs Rust nightly to actually run."
- [r8e](../adr/0011-graph-layout-in-rust.md): "The bindings import only `engine`, `model`, `overview` and `pack`."

Thesis (high): Supply chain: cargo-deny's [bans] allow list denies any crate not in the list across the whole workspace graph, and allow-workspace exempts workspace members. It cannot express 'the core has no default dependencies' per crate, because bindings legitimately depend on wasm-bindgen and napi. So keep the ADR's cargo tree allowlist for the core, and use cargo-deny for licences, advisories and sources. Use cargo-machete (fast and imprecise) in check, and cargo-udeps (nightly) only on demand, because udeps needs nightly.

Thesis citations:

- [c23](https://embarkstudios.github.io/cargo-deny/checks/bans/cfg.html): "Determines specific crates that are allowed. If the allow list has one or more entries, then any crate not in that list will be denied, so use with care."
- [c24](https://embarkstudios.github.io/cargo-deny/checks/bans/cfg.html): "All workspace members are automatically treated as if they were in the allow list"
- [c25](https://github.com/bnjbvr/cargo-machete): "cargo-machete is a Cargo tool that detects unused dependencies in Rust"
- [c26](https://github.com/est31/cargo-udeps): "it needs Rust nightly to actually run."

### 9. `cargo hack check --feature-powerset --all-targets --locked` on the core belongs in check: two features means four combinations. `cargo check --target wasm32-unknown-unknown -p graph-layout -p graph-layout-wasm` is in check too. So is `RUSTDOCFLAGS='-D warnings' cargo doc --no-deps --workspace`. Miri is on demand only: a forbid(unsafe) core with no dependencies gives it almost nothing to check. cargo-semver-checks waits until the core is published. typos goes in lint, scoped to crates/ at first

Verdict: thesis. Confidence: medium.

The cargo-hack feature-powerset option is confirmed. The placement in check versus on-demand recipes is a judgement based on cost.

Citations:

- [r9a](https://github.com/taiki-e/cargo-hack): "Perform commands on `package.rust-version`."

Thesis (medium): Miri and other correctness tools: the core is forbid(unsafe_code), so Miri's undefined-behaviour detection has little to check in the core itself. It is worth running only if unsafe appears in a dependency that the core exercises, or in test helpers, and it is on demand, not in check. cargo-semver-checks matters only once the core is published (ADR O-3 defers publishing), so it belongs in release, not check. typos is cheap and fits check.

Thesis citations:

- [c27](https://github.com/rust-lang/miri): "Miri is an Undefined Behavior detection tool for Rust."
- [c28](https://github.com/obi1kenobi/cargo-semver-checks): "Lint your crate API changes for semver violations."
- [c29](https://github.com/crate-ci/typos): "Finds and corrects spelling mistakes among source code:"
- [c30](../adr/0011-graph-layout-in-rust.md): "`fast-check` sampling cannot be ported, so TypeScript exports the 80 golden inputs"

### 10. ast-grep 0.50's Rust grammar handles the boundary rules if each rule matches tree nodes rather than line text: - solve/: match `kind: crate` not inside `visibility_modifier`, so `pub(crate)` stays legal, plus `super::super`. - Each core module group (one rule per row of the ADR table, for example order/): match `kind: scoped_identifier` with `regex: '^crate::'`, `not: regex: '^crate::(index\|layering\|budget\|rand)(::\|$)'` and `not: inside: scoped_identifier`. A second branch bans `use crate::{...}` lists (`scoped_use_list` whose path field is `crate`), so each import names its module. - Bindings: the same shape over `^graph_layout::`, allowing engine, model, overview and pack, banning `use graph_layout::{` and `use graph_layout as $A;`. - rust-graph-layout-deterministic: a `scoped_identifier` with `regex: '(^\|::)(Instant\|SystemTime)::now$'`, plus `thread_rng()`. Quote every regex in YAML: a bare `^crate::` fails to parse. Two things are better done elsewhere. Float-to-int casts need type information, which clippy cast_possible_truncation and cast_sign_loss at deny have. The binding boundary is better enforced by the compiler: make only engine, model, overview and pack `pub mod`, and every other module private

Verdict: middle. Confidence: high.

I wrote these four rules with valid and invalid cases in the repository's test style and ran `ast-grep test` (4 passed). A scan over a planted crates/graph-layout/src/solve/mod.rs reported both rust-solve-no-crate-imports and rust-graph-layout-deterministic. In the same file, `pub(crate) fn` was not flagged. The first YAML draft failed to parse until the regexes were quoted. Banning bare `super::` in solve would break `use super::*` in test modules, so the rule bans only `super::super`.

Citations:

- [r10a](../adr/0011-graph-layout-in-rust.md): "rule: `solve/` may contain no `use crate::` line"
- [r10b](../../ast-grep/rules/ts-graph-layout-deterministic.yml): "- pattern: Math.random()"
- [r10c](../../sgconfig.yml): "Call-site and comment rules that the import checker"

Thesis (medium): Ast-grep for Rust and the module boundaries: the ADR's rule for solve/ (no `use crate::` line) is a plain import-pattern rule and suits ast-grep. Rules follow the repository's style: a rule file with id, severity and files, plus a valid and invalid test. I did not verify ast-grep's Rust grammar coverage for use-trees, nested groups and macros; rules should be tested on planted violations to confirm they match. Float-to-int `as` casts and clock reads are better caught by clippy (cast lints and disallowed-methods) with ast-grep as the second guard. The rules named in the plan are: rust-core-layer-imports (one rule per module group), rust-binding-imports-engine-only, and solve-no-crate-imports.

Thesis citations:

- [c31](../adr/0011-graph-layout-in-rust.md): "rule: `solve/` may contain no `use crate::` line"
- [c32](../../ast-grep/rules/ts-graph-layout-deterministic.yml): "- pattern: Math.random()"
- [c33](../../ast-grep/rules/ts-suppression-names-a-rule.yml): "A bare `ast-grep-ignore` silences every rule on the next line."
- [c34](../../sgconfig.yml): "Call-site and comment rules that the import checker"

### 11. Add a `mod crates` to the root justfile and add `crates::check` to the root check loop after `test`. It fails, rather than skips, when cargo is missing. The existing `lint-ast-grep` step (`ast-grep test`, then `ast-grep scan --error=unused-suppression`) picks up Rust rules on its own, because each rule names `language: rust`. Pre-push already runs `just check`. Add two pre-commit entries: glob `crates/**/*.rs` runs `just crates::fmt-check`, and glob `**/*.toml` runs `taplo fmt --check {staged_files}`. Leave clippy out of pre-commit. CI: the existing mise-action provides the toolchain. Add Swatinem/rust-cache keyed on Cargo.lock, which is simpler than sccache for one workspace. In .vscode/settings.json: - `rust-analyzer.check.command: clippy` - `rust-analyzer.cargo.features: all` - `[rust]` defaultFormatter `rust-lang.rust-analyzer` - `[toml]` defaultFormatter set to the taplo extension

Verdict: thesis. Confidence: high.

I read the justfile, lefthook.yml and ci.yml. rust-cache is confirmed as a cargo caching action. The editor settings and pre-commit entries are a judgement.

Citations:

- [r11a](../../justfile): "for step in compile lint test webviews::typecheck webviews::test; do"
- [r11b](../../justfile): "ast-grep scan --error=unused-suppression"
- [r11c](../../lefthook.yml): "run: mise exec -- just check"
- [r11d](https://github.com/Swatinem/rust-cache): "A GitHub Action that implements smart caching for rust/cargo projects"

Thesis (high): Integration: `just check` is the only full gate, and it runs a fixed step list. The Rust gate should be a `crates::check` step added to that list, and it must not be silently skipped when crates/ is absent. Lefthook already calls `just check` on pre-push, so Rust is picked up without changing lefthook, and pre-commit can add a glob-scoped Rust subset. The ast-grep scan already runs with unused-suppression as an error, so Rust rules must also be wired into the ast-grep scan and test steps.

Thesis citations:

- [c35](../../AGENTS.md): "`just check` is the only full gate"
- [c36](../../justfile): "for step in compile lint test webviews::typecheck webviews::test; do"
- [c37](../../lefthook.yml): "mise exec -- just check"
- [c38](../../justfile): "ast-grep scan --error=unused-suppression"

### 12. The thesis checklist is the right order but is missing the parity gate, the Cargo.lock decision, CI, knip, dependency-cruiser and the VSIX. The complete list is in the recommendation. Additions: Cargo.lock is committed and every command passes `--locked`. The `crates::parity` recipe runs the committed goldens through the native and WASM builds and byte-compares the outputs. CI adds rust-cache and runs parity on each napi OS. knip gets a workspace for crates/graph-layout-wasm/js. Built .wasm and .node files go under dist/ so the VSIX allowlist accepts them, and a planted file under crates/ must still be rejected

Verdict: middle. Confidence: medium.

The antithesis's gaps are real: the ADR names a native-against-WASM equality test, and the VSIX allowlist ships only the listed directories.

Citations:

- [r12a](../../scripts/quality/vsix-contents.mjs): "/** The directories the extension reads at run time; everything else is contributor tooling. */"
- [r12b](../adr/0011-graph-layout-in-rust.md): "No `mul_add` and no fast-math flags in the core, because WASM has no fused multiply-add and native and WASM would otherwise differ."

Thesis (medium): Phase 1 checklist (ordered; each item states its proof). (1) rust-toolchain.toml: channel stable, components clippy and rustfmt, target wasm32-unknown-unknown; proof: `mise exec -- rustc --version` and `rustup show active-toolchain` agree after enabling the idiomatic-version-file setting. (2) mise.toml: rust = 'latest', cargo:wasm-bindgen-cli, cargo:cargo-deny, binaryen; proof: `mise install --locked` and `just lint-mise-lock`. (3) rustfmt.toml with edition set and no unstable keys; proof: a planted unformatted file fails `crates::fmt`. (4) Cargo.toml [workspace.lints] (clippy pedantic warn plus named allows; unsafe_code forbid in the core); proof: a planted unsafe block in the core fails `crates::lint`. (5) clippy.toml with disallowed-types and disallowed-methods; proof: a planted HashMap and Instant::now each fail `crates::lint`. (6) rust ast-grep rules and tests (core-layer imports, binding imports, solve no crate imports, no clock reads, no float-to-int casts); proof: `ast-grep test` passes and a planted violation in each rule fails `ast-grep scan`. (7) deny.toml (licences allowlist to verify, advisories, sources, bans) and a cargo tree allowlist script for the core; proof: a planted dependency in the core fails `crates::boundaries`. (8) crates/justfile recipes fmt, lint, test, deny, boundaries, wasm, napi, check; add crates::check to the root check list; proof: `just check` fails when a planted rustfmt violation is added and passes on the clean tree. (9) ceilings.json key for expect/allow counts and ratchet script update; proof: adding one allow fails `just lint-ratchet`. (10) .vscode/settings.json rust-analyzer checkOnSave command clippy; proof: manual check. Not in Phase 1: miri, semver-checks, mutation testing, benchmarks, coverage floors.

Thesis citations:

- [c39](../refactor/graph-layout-rust-plan.md): "Each boundary rule fails on a planted violation and passes on the clean tree."

Antithesis: The checklist has no step for the Rust-specific parity gate: running the same golden inputs through native and WASM and comparing bytes. That is the owner's headline requirement. It is absent from the checklist, listed neither as in-scope nor as out of Phase 1.

Antithesis: There is no step for knip, dependency-cruiser or the VSIX allowlist, although the question asks for them. crates/ must be excluded from knip's production pass and from the VSIX contents allowlist, and a planted file under crates/ must not enter the VSIX. The thesis never addresses what has to change.

Antithesis: There is no CI workflow step. `just check` is the gate, but the CI runner needs the Rust toolchain (via mise), a cache for `~/.cargo` and `target/` (Swatinem/rust-cache is the common choice), and the wasm32 target. Without it the first Rust PR is red or slow.

Antithesis: Step 2 puts `cargo:` backends in mise.toml. These compile from source on every fresh CI runner unless prebuilt (`aqua:` or `github:` backends). The thesis does not name `cargo-binstall` or aqua, and the compile can dominate CI time. Prefer aqua or ubi for cargo-deny, nextest, taplo, typos and machete where available.

Antithesis: The checklist contains no Cargo.lock decision. The question asks for one. Commit Cargo.lock for a workspace that ships binaries, run `--locked` in every CI cargo command, and run cargo-deny against it. The thesis never says this.

### 13. Tests: - Use cargo-nextest in check, plus `cargo test --doc`, because nextest runs no doctests. - Use proptest, and commit its proptest-regressions files. - Seeds cannot be shared with fast-check. Shared cases are the committed JSON goldens exported from TypeScript, replayed in both languages. Coverage: cargo-llvm-cov with `--fail-under-lines`, fed from a ceilings.json floor (`coverage.rust`) set after a first measurement. Run it in CI or on demand, not in check. Other on-demand recipes: - cargo-mutants with `--in-diff`; - criterion or divan benches in a `bench` recipe; - twiggy for diagnosis. Still unverified, and so not recommended as settled: wasm-bindgen-test and napi smoke details, wasm-opt through mise, which CI runners to use, criterion versus divan, and all timings

Verdict: middle. Confidence: medium.

The antithesis was right that one fetch each settles several of these. I read the nextest, proptest, cargo-llvm-cov and cargo-mutants pages. I did not fetch wasm-bindgen-test, napi-rs, twiggy or divan.

Citations:

- [r13a](https://nexte.st/): "For now, run doctests in a separate step with"
- [r13b](https://proptest-rs.github.io/proptest/proptest/failure-persistence.html): "It is recommended to check these files in to your source control so that other test runners (e.g., collaborators or a CI system) also replay these cases."
- [r13c](https://github.com/taiki-e/cargo-llvm-cov): "Exit with a status of 1 if the total line coverage is less than MIN percent"
- [r13d](https://mutants.rs/in-diff.html): "The --in-diff DIFF_FILE option tests only mutants that overlap with regions changed in the diff."

Thesis (speculative): Areas with no verified evidence and therefore speculative: property testing (proptest vs quickcheck vs bolero), cargo-nextest, cargo-llvm-cov floors, cargo-mutants, criterion vs divan, wasm-bindgen-test and napi smoke tests in Node, twiggy size budgets, wasm-opt through mise, cross-target CI runner choice, sccache vs rust-cache, and build times for a 10k-line crate. The ADR's fast-check parity point is the only verified constraint: shared fixtures must be committed JSON exported from TypeScript, not generated by proptest. These areas need their own research before a recommendation.

Antithesis: Point 13 marks eight areas of the question as having no evidence, but one fetch each would have supplied the main facts. The question asked for a concrete recommendation on testing, coverage, benchmarks, WASM, napi, CI and timings, and the thesis delivers none. That is most of items 7, 8 and 10.

Antithesis: Recommendation for testing: use cargo-nextest for the unit and integration tests, plus a separate `cargo test --doc` step. Nextest does not run doctests. For property tests use proptest with committed regression files. Share TypeScript fixtures only as committed JSON goldens, since proptest and fast-check generators cannot share seeds. Replaying the 80 golden inputs in both languages is the parity check.

Antithesis: Recommendation for coverage: use cargo-llvm-cov, kept out of `check` and run in CI only, with a line floor in ceilings.json set after a first measurement. For benchmarks use divan or criterion in a `bench` recipe outside `check`. Run cargo-mutants on demand, scoped with `--in-diff`.

Antithesis: Recommendation for size and WASM: `wasm-opt` from binaryen via mise (the aqua backend, pinned in mise.lock). Record the `.wasm` byte size, and the size after wasm-opt, as a new ceilings.json key using the existing size-budget mechanism. Use twiggy only for diagnosis on demand, not as a gate. Run the napi smoke test with plain `node` loading the built `.node`, and the WASM test with `wasm-pack test --node` or `wasm-bindgen-test-runner`. Evidence for these specific choices is thin, and I did not fetch them.

Counter-evidence:

- [a5](https://nexte.st/): "For now, run doctests in a separate step with"

### 14. Platform float functions are a documented determinism risk that the ADR's bans do not cover. Rust documents the precision of f64 transcendental functions (powf, powi, sin and others) as non-deterministic across platforms and Rust versions. Ban them in the core through clippy disallowed-methods: sin, cos, tan, asin, acos, atan, atan2, exp, exp2, ln, log2, log10, powf, powi, hypot and cbrt, with reason 'use crate::fmath'. Implement the few the engine needs in-crate. The TypeScript engine uses only Math.hypot and Math.sqrt outside tests. Allow sqrt, which IEEE 754 defines as correctly rounded (I did not re-read the Rust doc for sqrt). The native-against-WASM byte-compare test is the backstop, and it must run on every OS that ships a napi binary, because each has its own libm

Verdict: new. Confidence: medium.

I read the std f64 page, which says this. I also compiled one function using sin, cos, tan, atan, exp, ln, powf and sqrt over 100k inputs for native aarch64-apple-darwin and for wasm32 run in Node. The sums were bit-identical. So the risk is documented but did not show up on that one platform pair; Linux glibc and Windows were not tested. A grep of packages/graph-layout/src shows only 2 Math.hypot and 2 Math.sqrt uses outside tests.

Citations:

- [r14a](https://doc.rust-lang.org/std/primitive.f64.html): "The precision of this function is non-deterministic. This means it varies by platform, Rust version, and can even differ within the same execution from one invocation to the next."
- [r14b](https://doc.rust-lang.org/clippy/lint_configuration.html): "The list of disallowed methods, written as fully qualified paths."

### 15. Speed, all speculative (nothing was timed on a 10k-line crate). With a warm cache, `cargo fmt --check`, taplo, typos, machete and the ast-grep scan should each take about a second. Clippy on all targets, the four-combination cargo-hack check, the wasm32 check and nextest are likely in the tens of seconds, and a cold CI build likely takes minutes. Those belong in check. Release WASM and napi builds with wasm-opt, coverage, Miri, mutants, benches and udeps are on demand or CI-only. The parity recipe needs release builds, so it runs in CI, and in check only if its measured time is acceptable

Verdict: new. Confidence: speculative.

I measured nothing at the target size. The scratch crate I built was trivially small, so its timings say nothing about 10k lines.

## Alternatives the thesis missed

Pin an explicit stable version in rust-toolchain.toml (`channel = "1.NN.0"`) and track stable with a scheduled bump PR. This resolves the conflict between 'track stable' and 'record versions in mise.lock', keeps native and WASM output tied to one compiler, and lets a CI step assert that `rustc --version` matches mise.lock.

- [m1](https://mise.jdx.dev/lang/rust.html): "If the project has a rust-toolchain.toml , let mise read it instead of repeating the version in mise.toml"

Use a dedicated TOML formatter for the currently unowned file type. oxfmt ignores TOML, so taplo (or `cargo fmt` plus `taplo` only for Cargo.toml and rust-toolchain.toml) becomes the single TOML formatter without breaking 'one formatter per file type'. Scope it explicitly so mise.toml and lefthook files stay out.

- [m2](../../.oxfmtrc.json): ""**/*.{yml,yaml,toml}","

Ban platform-dependent float math in the core (`f64::sin`, `cos`, `exp`, `ln`, `powf`, `powi`, `sqrt` where applicable) through clippy disallowed-methods, or wrap it in an in-crate deterministic implementation. This, not the HashMap, clock or mul_add bans, is the likeliest source of native-versus-WASM divergence, and it should be paired with a byte-compare parity recipe over the golden inputs.

- [m3](https://rust-lang.github.io/rust-clippy/master/index.html): "Denies the configured methods and functions in clippy.toml"

Use cargo-nextest as the Rust test runner, with `cargo test --doc` as a separate step because nextest does not run doctests. Keep cargo-llvm-cov, cargo-mutants and benchmarks as on-demand or CI-only recipes outside `check`.

- [m4](https://nexte.st/): "For now, run doctests in a separate step with"

## Open questions

- When rust-toolchain.toml says channel = "stable" and mise reads it (idiomatic_version_file_enable_tools), does mise.lock record a concrete 1.x.y or the word 'stable'? Run `mise lock` once to find out; the answer decides between the channel `stable` and a concrete version bumped by `just update`.
- Do f64 transcendental functions diverge between wasm32 and native Linux glibc or Windows MSVC on the engine's real inputs? Running the byte-compare parity recipe on each CI OS would settle it; only macOS aarch64 was sampled.
- Are aqua or github mise backends available for taplo, cargo-deny, cargo-nextest, cargo-hack, cargo-machete, typos, wasm-bindgen-cli and binaryen, and do they lock with checksums?
- Can the napi and wasm-bindgen generated code compile under unsafe_code = deny with a scoped #[expect], or must the binding crates allow unsafe at crate level?
- How long do clippy, the feature powerset, nextest, the release WASM build with wasm-opt, and parity take on the 10k-line core, cold and warm? This decides whether parity can join `just check`.
- Which runners build the napi targets (macos-latest arm64, ubuntu x64 and arm64, windows), and which cross linkers they need, per the napi-rs documentation, which I did not fetch.
- Should taplo own every TOML file in the repository (mise.toml, rumdl.toml) or only crates/** and rust-toolchain.toml? Owning every file is the consistent reading of 'one formatter per file type'.

## Rejected citations

None.
