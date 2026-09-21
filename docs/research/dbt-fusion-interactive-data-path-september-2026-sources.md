# dbt Fusion interactive data path evidence ledger

Accessed 2026-09-20 unless stated otherwise; revised 2026-09-20 after adversarial review. Every URL in this file returned HTTP 200 on that date. "Published" is omitted when the publisher exposes no reliable page date; dbt Developer Hub pages carry no visible publication or revision date, so applicability was checked against dbt v2.0.5, released 2026-09-18.

Source-code evidence is pinned to the `v2.0.5` tag of `dbt-labs/dbt-core`, which resolves to commit `a3bdd96bf62f02c8babb060a79f32de6998c235a` ("chore: release v2.0.5", authored 2026-09-18). Quotations preserve source wording, including its typography; elisions are marked.

## How to read this ledger

Each entry states what it is, where the supporting text sits, the exact claim it supports, and the caveat that limits the transfer. Entries are grouped by domain and numbered stably; the main artifact cites these numbers.

Three labels appear in the "Type" line:

- **primary** — the artifact itself (source code at a pinned commit or version, a specification, a vendor reference page for its own product).
- **reputable** — vendor marketing or engineering blog, or a maintained community reference.
- **observation** — something derived locally by the researcher from a primary artifact, with the command shown.

### The standing caveat on all public-source entries

**Public source at a pinned tag is a strong prior about design intent. It is not proof that the distributed Fusion binary a user installs executes identical code paths.** The language server is absent from the public tree (entry 4), build configuration and feature flags are not visible, and a vendor may ship customized or additional paths. Every entry in "dbt Fusion engine — parsing, caching, and artifact behavior" carries this caveat implicitly; **behavior that would change the plan must be reproduced against the pinned binary before it is acted on.** A separate caveat applies within the source itself: these files are reached through CLI entry points, so they are a prior on language-server behavior, never a statement about it.

## dbt Fusion engine — release identity and source provenance

### [1] dbt v2.0.5 release

- Publisher: dbt Labs, `dbt-labs/dbt-core`
- Published: 2026-09-18T15:47:44Z
- Type: primary
- URL: <https://github.com/dbt-labs/dbt-core/releases/tag/v2.0.5>
- Location: release body, first two lines
- Quote: "## 2.0.5" / "Released September 18, 2026"
- Supports: the pinned minimum test binary, dbt Fusion 2.0.5, is a real release dated 2026-09-18, and the 2.0.x line is maintained in `dbt-labs/dbt-core`.
- Caveat: the release body lists a single BigQuery fix. It establishes identity and date only.

### [2] The Fusion engine source now lives in `dbt-labs/dbt-core`

- Publisher: dbt Labs
- Retrieval: 2026-09-20
- Type: observation
- URL: <https://github.com/dbt-labs/dbt-core>
- Location: `gh api repos/dbt-labs/dbt-core --jq '{desc,pushed_at,language}'`; `gh api repos/dbt-labs/dbt-core/contents/crates`
- Quotes: `"language": "Rust"`; `"pushed_at": "2026-09-20T09:19:24Z"`; the repository root contains `crates/` (83 entries), `Cargo.toml`, `rust-toolchain.toml`, and `CHANGELOG-fusion.md`
- Supports: `dbt-labs/dbt-core` is the live Rust monorepo for the Fusion engine as of the research date, and is the correct place to pin source evidence.
- Caveat: the repository name still reads "core", which invites confusion with the Python dbt Core v1 line. Repository contents establish what is *published*, not what is *built into a distributed release artifact*.

### [3] `dbt-labs/dbt-fusion` is a frozen pre-2.0.5 snapshot

- Publisher: dbt Labs
- Retrieval: 2026-09-20
- Type: observation
- URL: <https://github.com/dbt-labs/dbt-fusion>
- Location: `gh api repos/dbt-labs/dbt-fusion --jq '{description,pushed_at}'`; `CHANGELOG.md` heading scan
- Quotes: `"description": "ARCHIVE: code & issue tracking in dbt-core"`; `"pushed_at": "2026-06-26T17:16:36Z"`; the newest changelog headings are "## 2.0.0-preview-nightly.176" and "## 2.0.0-preview.186"
- Supports: the older public Fusion repository stops at a 2.0.0-preview snapshot from mid-2026. Evidence taken from it is pre-2.0.5 and must be re-checked against the `v2.0.5` tag.
- Caveat: the archive still ranks highly in search results. Treat a `dbt-fusion` URL as stale unless the same file is confirmed at `dbt-labs/dbt-core@v2.0.5`.

### [4] The Fusion language server is not in the public source

- Publisher: dbt Labs
- Retrieval: 2026-09-20
- Type: observation
- URL: <https://github.com/dbt-labs/dbt-core/tree/v2.0.5/crates>
- Location: local clone of `dbt-labs/dbt-core` at `v2.0.5`; `rg -l -i "textDocument|tower-lsp|lsp_types|language_server" --type rust` returns no files; no crate is named for the language server; matches for the bare word `lsp` are comments and a telemetry package name
- Quotes: `crates/dbt-common/src/tracing/config.rs:57` — "Name of the package emitting the telemetry, e.g. `dbt-cli` or `dbt-lsp`"; `crates/dbt-compilation/src/core.rs:121` — "Phase 2: Resolve and parse with optional listener factory for LSP"; `crates/dbt-main/src/compilation.rs:641` — "Only in LSP Mode"
- Supports: the LSP server binary is built from closed source. Its wire protocol — the exact set of standard and custom methods, their parameters, and their ordering guarantees — cannot be read from public code; it must be observed against the pinned binary.
- Caveat: absence of evidence in the public tree is not proof the server lacks a feature; it only means the feature cannot be cited. The quoted comments show the server exists and touches these crates. **They do not establish that the server owns, at runtime, the caches those crates implement.** This is the single largest evidence gap in this research.

## dbt Fusion engine — parsing, caching, and artifact behavior

All entries in this section inherit the standing caveat above: strong prior about the public engine, not proof about the distributed binary, and not an ownership claim about the language server.

### [5] Partial-parse invalidation matrix and measured timings

- Publisher: dbt Labs, `dbt-labs/dbt-core@v2.0.5`
- Type: primary
- URL: <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-metadata/src/partial_parse.rs>
- Location: module documentation, lines 1–61
- Quotes:
  - "The cache memoizes `resolve(project_files) → ResolverState`. The cache key is the set of (file_path, mtime) pairs for every tracked file."
  - "**Invariant**: the cache must return the same nodes as a full parse would for any node it returns."
  - The invalidation table: "No files changed | all file mtimes match | Fast-path | ~10ms"; "model / analysis `.sql` changed | file mtime changed | Incremental | ~500ms"; "any other file changed | file mtime + kind/ext check | FullParse | ~1.8s"; "any file deleted | stat fails | FullParse | ~1.8s"; "`dbt_project.yml` changed | blake3 content hash | FullParse | ~1.8s"; "`profiles.yml` changed | blake3 content hash | FullParse | ~1.8s"; "`--vars` changed | blake3 hash of serialized vars | FullParse | ~1.8s"; "env var (used in Jinja) changed | value compared at load time | FullParse | ~1.8s"; "binary version changed | `CARGO_PKG_VERSION` mismatch | FullParse | ~1.8s"
  - "Timings measured on scale_6k (~6k nodes). No-partial-parse baseline: ~7.5s cold."
- Supports: the public engine implements a content-and-mtime-keyed project parse cache; the classes of project change that force a full reparse; and the order of magnitude of each class on a roughly six-thousand-node project.
- Caveats: these are the engine authors' own benchmark figures on their `scale_6k` fixture, on unstated hardware, for the CLI path. Useful as relative classes, not as a service-level objective. The language server's numbers are not published. **The tracked set is the project's resource paths, not the output directory (entry 41) — these timings say nothing about what happens when something writes into `target/`.**

### [6] Parse-cache location, validation, and the `--dirty` selector

- Publisher: dbt Labs, `dbt-labs/dbt-core@v2.0.5`
- Type: primary
- URLs:
  - <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-main/src/partial_parse.rs>
  - <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-metadata/src/partial_parse.rs>
- Locations: `dbt-main/src/partial_parse.rs:63-70` and `:137-152`; `dbt-metadata/src/partial_parse.rs:93-108` and `:296`
- Quotes:
  - "`--dirty` requires a parse cache (none found at {}). Run once with `--partial-parse` to build the cache." with the path built as `eval.metadata_dir().join("parse")`
  - Three distinct rejection paths: "Partial parse: {reason}, invalidating cache" (`state.validate`), "Partial parse: {reason}, falling back to full parse" (`state.needs_full_parse`), and the dependency-closure check "`all_deps_present`"
  - Cache-key fields: "blake3 hash of raw profiles.yml bytes — catches env_var changes that don't touch the file timestamp", "blake3 hash of raw dbt_project.yml bytes", "blake3 hash of serialized CLI --vars", "blake3 hash of `package-lock.yml` bytes", "Binary version that wrote this state. Mismatches (e.g. after upgrade) invalidate the cache"
- Supports: the parse cache is a parquet store under the metadata directory; it is validated on every load by content hash of the config inputs plus the binary version; a failed validation degrades to a full parse rather than serving stale nodes.
- Caveat: this is the CLI entry point. Whether the language server uses the same on-disk cache directory, a private one, or an in-memory equivalent is not visible in public code and is a spike question.

### [7] Fusion's target-directory layout

- Publisher: dbt Labs, `dbt-labs/dbt-core@v2.0.5`
- Type: primary
- URL: <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-common/src/constants.rs>
- Location: the "dbt outputs" block
- Quotes: the layout comment lists `target/` containing `compiled/`, `run/`, `generic_tests/`, `manifest.json`, `catalog.json`, `logs/`, and `db/`; the constants include `DBT_MANIFEST_JSON: &str = "manifest.json"`, `DBT_MANIFEST_INFO: &str = "manifest.info"`, `DBT_METADATA_DIR_NAME: &str = "metadata"`, `DBT_STATE_DIR_NAME: &str = "state"`, `DBT_DEFAULT_OTEL_PARQUET_FILE_NAME: &str = "otel.parquet"`, and `DBT_DEFAULT_QUERY_LOG_FILE_NAME: &str = "query_log.sql"`
- Supports: the engine owns and populates `target/`, including a local query log and an OpenTelemetry parquet file. This is the basis for the "never write into the project's `target/`" prohibition: it is someone else's output directory.
- Caveat: constants prove the names exist, not that every file is written on every command or by the language server. **The prohibition rests on ownership. It does not rest on any claim that writing there invalidates the parse cache — see entry 41.**

### [8] The public `manifest.json` writer is non-atomic

- Publisher: dbt Labs, `dbt-labs/dbt-core@v2.0.5`
- Type: primary
- URL: <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-common/src/artifact_io.rs>
- Location: `write_artifact_to_file`, the `ArtifactType::Manifest` branch
- Quote:

  ```rust
  if artifact_type == ArtifactType::Manifest {
      let f = stdfs::File::create(&artifact_path)?;
      let mut w = std::io::BufWriter::new(f);
      serde_json::to_writer(&mut w, artifact)?;
      w.flush()?;
  }
  ```

  with the preceding doc comment "`manifest.json` is streamed directly to avoid materializing a large intermediate YAML tree and JSON string in memory."
- Supports: the public engine truncates the destination path and streams JSON into it. There is no temporary file and no rename, so a *concurrent* reader can observe a zero-length or truncated `manifest.json` while a write is in flight.
- Caveats and scope limits, all material:
  - This is the write path in the **public CLI engine**. The language server's write path, if it writes artifacts at all, is not public.
  - The hazard applies to **concurrent** reads. A read sequenced after a completed, awaited write by the reading process is not exposed to it (entry 38).
  - **No claim is made that a truncated JSON document can be syntactically valid.** An earlier revision of this research asserted that without support; it is withdrawn. The observed failure mode is a parse error (entry 40).
  - The frequency with which this fires in practice is **unmeasured**.

### [9] Fusion caches compiled SQL on disk with a span sidecar

- Publisher: dbt Labs, `dbt-labs/dbt-core@v2.0.5`
- Type: primary
- URL: <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-tasks-sa/src/compiled_sql_cache.rs>
- Location: `CachedSpans` doc comment; `CompiledSqlCacheImpl`; `try_get_compiled_sql`
- Quotes:
  - "On-disk shape of the `*.macro_spans.json` sidecar. Stores the macro spans alongside the reclassify offset records so a cache hit can restore both without re-rendering."
  - "`reclassify_spans` is `#[serde(default)]` purely as cheap insurance against a partial write."
  - The validity gate is an in-memory set: `valid_nodes: parking_lot::RwLock<HashSet<String>>`, and a lookup returns `None` unless `valid_nodes.contains(&common.unique_id)`
- Supports: compiled SQL per node has a cache in the public engine, keyed by node unique id, materialized under `target/compiled/`, with an in-process validity set deciding whether the on-disk copy may be trusted.
- Caveat: the validity set lives inside the engine process, so an outside reader of `target/compiled/*.sql` cannot tell a current file from a stale one. This supports "do not recreate compiler truth"; it does **not** establish that the language server owns this cache at runtime.

### [10] Fusion caches warehouse schemas with a TTL and a build guard

- Publisher: dbt Labs, `dbt-labs/dbt-core@v2.0.5`
- Type: primary
- URLs:
  - <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-schema-store/src/lib.rs>
  - <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-schema-store/src/parquet_cache.rs>
- Locations: both module documentation headers
- Quotes:
  - "The schema store centralizes how dbt Fusion persists and retrieves Arrow schemas for every node that may participate in a run. It understands which schemas must always originate from remote sources (frontier nodes, deferred models, cross-project references) and which ones may be hydrated from the local compilation results (analyzed models). By baking those guarantees into the storage layer, we avoid accidental cross-run state bleed […]"
  - The layout: "`private/metadata/compile/schemas/{N}.parquet` ← compile-time schemas (no TTL)" and "`private/metadata/warehouse/schemas/{N}.parquet` ← warehouse-fetched schemas (TTL)"
  - "**Build-hash guard** — each row stores `CARGO_PKG_VERSION`; mismatched rows are silently dropped on load"
  - "**TTL eviction** — each row carries `cached_at_ms`; entries older than their configured interval are dropped during load."
  - "**No lock file** — save() writes a new epoch file atomically (new file); it never modifies existing files, so concurrent writers are safe."
- Supports: warehouse column and type metadata is cached by the public engine, with an explicit distinction between locally-derivable and remote-only schemas, a per-entry TTL, a binary-version guard, and an append-only epoch layout chosen so concurrent writers are safe.
- Caveats: the TTL interval is supplied by the caller through a `ttl_map`, so the default duration is not readable from these two files. Note the contrast with entry 8 — the schema store was designed for concurrency and the manifest writer was not. This is a prior; it does not establish runtime ownership by the language server.

### [11] Fusion coordinates cross-process file access with TTL leases

- Publisher: dbt Labs, `dbt-labs/dbt-core@v2.0.5`
- Type: primary
- URL: <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-lease/src/lib.rs>
- Location: module documentation
- Quote: "A small, dependency-light toolkit for coordinating access to files shared between independent OS processes. […] a file-based lease (lock with a TTL, not a hold-forever mutex) so a crashed or hung process can never wedge other processes out of a shared resource forever."
- Supports: dbt Labs treats cross-process sharing of local files as a problem requiring an explicit lease protocol, and ships one.
- Caveat: the module documentation names a credentials cache as the production use. Nothing here says the lease guards `manifest.json`, and entry 8 shows it does not.

### [12] Partial-parse and partial-load command surface

- Publisher: dbt Labs, `dbt-labs/dbt-core@v2.0.5`
- Type: primary
- URL: <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-clap-core/src/lib.rs>
- Locations: lines 1999–2002, 2197–2226, 2709–2727
- Quotes:
  - `pub write_json: bool` with `default_value_t = true`, `env = "DBT_WRITE_JSON"`, and a `no_write_json` counterpart
  - `--dirty`: "Select only nodes whose source files have changed since the last --partial-parse run, plus all their downstream dependents. Implies --partial-parse. Use with --partial-load for full speed: --partial-load --dirty"
  - The flags `partial_parse`, `partial_load`, `partial_parse_file_diff`, `partial_parse_file_path`, `verify_partial_parse`, and `verify_partial_load` are all declared `hide = true`
- Supports: artifact writing defaults to on and can be switched off per invocation; the incremental machinery is reachable from the command line.
- Caveat: `hide = true` marks these as unstable internal flags. A product must not depend on a hidden flag's name or semantics across releases.

### [13] `--partial-load` is incompatible with *producing* a full manifest

- Publisher: dbt Labs, `dbt-labs/dbt-core@v2.0.5`
- Type: primary
- URL: <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-metadata/src/partial_parse.rs>
- Location: module documentation, "What `--partial-load` adds"
- Quote: "`--partial-load` can only be used when: - `write_json` is false (manifest export needs all nodes) - `any_uses_graph` is false (Jinja `graph` variable requires all nodes at render time) - `defer` is false (upstream resolution may expand beyond the selector)"
- Supports: **an operation that must write a new full manifest cannot use the partial-load path.** The constraint is on the write, not on the artifact's existence.
- Caveat and correction: an earlier revision of this research read this as "demanding a complete manifest costs the caller the cheapest path", which blurred two different designs. **Reading a manifest that already exists on disk adds no parse cost at all** — it is a freshness question, not a performance one. Only a design that runs a command to *produce* a fresh manifest pays this price. Stated for the CLI; whether the same constraint shapes the language server is not public.

## dbt Fusion — documented language-server behavior

### [14] Lazy compilation, background compilation, and cancel-on-switch

- Publisher: dbt Labs, dbt Developer Hub
- Type: primary (vendor reference for its own product)
- URL: <https://docs.getdbt.com/docs/about-dbt-lsp>
- Locations: "Lazy compilation", "What compiles first", "Background compilation"
- Quotes:
  - "The dbt language server uses on-demand compilation, also called lazy compilation. Lazy compilation starts automatically when you open a model file […] It compiles only the nodes it needs to answer questions about the file you are working in, instead of blocking on a full project compile first."
  - "When you open or focus on a model, the server determines a minimal set of nodes to compile […] That set includes the current model and its upstream dependencies (ancestors in the DAG)"
  - "Nodes you are not actively working on remain `not compiled` until the background compilation pass reaches them. How long that takes depends on the size of your project. Until a node is compiled, LSP results for that node are not available."
  - "When you switch to another file, the server reuses results from any compilations that already finished. If a compilation was still in progress when you switched files, it is cancelled and that partial work is discarded; the server then schedules a fresh compile for the newly focused model and its dependencies."
  - "Background compilation enables full project analysis once it completes. Until then, some features that need the full graph may be limited. You can monitor compilation progress in your editor's status bar."
  - "dbt and the language server run independently. Running a command like `dbt run` or `dbt compile` from the terminal does not interrupt or affect LSP compilation."
  - "The v2 CLI and the language server ship in a single binary, so they always share the same version and can't be mismatched."
- Supports: the server owns scheduling, prioritization, and cancellation of compilation; results for a given node may legitimately be absent rather than merely slow; the server reports progress.
- Caveat: "run independently" is the most consequential sentence here and is stated without elaboration. It does not say whether the two processes contend for the same on-disk caches, nor which one wins. Entries 5, 6, 9, and 10 show shared on-disk locations exist. This is a spike, not a finding.

### [15] Extension feature availability and the compiled-code refresh trigger

- Publisher: dbt Labs, dbt Developer Hub
- Type: primary
- URL: <https://docs.getdbt.com/docs/dbt-extension-features>
- Locations: "Feature availability", "View compiled code", "Live preview for models and CTEs", "Lightning-fast parse times"
- Quotes:
  - "Compiled code will update as you save your source code."
  - "Results are displayed in the Query Results tab in the bottom panel. The preview table is sortable and results are stored until the tab is closed."
  - "Query cache for faster incremental compiles | All users"
  - "Column-level lineage | `static_analysis: strict`"; "SQL type and schema error diagnostics | `static_analysis: strict`"; "SQL LSP hover to see the schema for `select *` | `static_analysis: strict`"; "Refactor column names | `static_analysis: strict`"; "SQL LSP go-to column and CTE | `static_analysis: strict`"
  - Available to all users: "Error diagnostics for Jinja, YAML, and SQL syntax"; "Jinja LSP go-to ref, source, and macro"; "Linter warning diagnostics"; "Table-level lineage"; "Ref autocomplete"
  - "Parse even the largest projects up to 30x faster than with dbt v1."
- Supports: dbt's own extension refreshes compiled SQL on save rather than on keystroke; query results are held only for the lifetime of the results tab; and the `strict`-versus-`baseline` capability split used in the main artifact's matrix.
- Caveat: "Query cache for faster incremental compiles" is not defined on this page and is not the same thing as Snowflake's persisted result cache. The "30x" figure is marketing with no stated method and is not used.

### [16] Extension configuration and environment handling

- Publisher: dbt Labs, dbt Developer Hub
- Type: primary
- URL: <https://docs.getdbt.com/docs/configure-dbt-extension>
- Location: settings table and the environment-variable notes
- Quotes:
  - "`dbt.fusionPath` | Path to the dbt v2 binary. The extension invokes the language server through this binary (`dbt-fusion lsp`)."
  - "VS Code does not inherit variables set by the VS Code terminal or external shells."
  - "The terminal uses system environmental variables, and does not inherit variables set in the dbt VS Code extension config."
- Supports: the language server is launched as a subcommand of the single Fusion binary; the environment seen by the extension host, by the server it spawns, and by a user's terminal are three different environments.
- Caveat: `dbt-fusion lsp` is the invocation dbt Labs' own extension uses. It is not documented as a stable public interface for third-party extensions.

### [17] `static_analysis` modes, their cost, and the login requirement

- Publisher: dbt Labs, dbt Developer Hub
- Type: primary
- URLs:
  - <https://docs.getdbt.com/docs/build/about-static-analysis>
  - <https://docs.getdbt.com/reference/resource-configs/static-analysis>
  - <https://docs.getdbt.com/reference/global-configs/static-analysis-flag>
  - <https://docs.getdbt.com/best-practices/optimize-static-analysis-for-development-and-deployment>
- Quotes:
  - "`baseline` (default): Statically analyze SQL. […] `strict` (previously `on`): Statically analyze all SQL before execution begins. […] `off`: Skip SQL analysis on this model and its descendants."
  - "Any run that uses `strict` mode requires authentication using `dbt login`, whether `strict` is set with the `--static-analysis strict` CLI flag or in `dbt_project.yml`. Unauthenticated runs fall back to `baseline`."
  - "`baseline` skips remote warehouse schema downloads and surfaces findings as warnings […] That can save compile time (and warehouse cost) in deployment, especially in projects with many sources."
- Supports: static-analysis mode is a first-order latency parameter because `strict` downloads warehouse schemas and `baseline` does not; `strict` requires an authenticated dbt platform session; and a `strict` configuration can silently degrade to `baseline`, which is why effective-mode detection is a requirement rather than a nicety.
- Caveat and correction: an earlier revision of this research treated a "no-account" product boundary as already foreclosing `strict`. That conflated two different things. **What a no-hosted-service boundary forbids is an extension-specific account and any licensing bypass; a user running `dbt login` with their own dbt platform credentials is a separate product decision that this evidence does not make.** The source establishes the capability matrix and the fallback, not the product's answer.

### [18] `manifest.json` production and scope

- Publisher: dbt Labs, dbt Developer Hub
- Type: primary
- URL: <https://docs.getdbt.com/reference/artifacts/manifest-json>
- Location: version table and "Produced by"
- Quotes:
  - "dbt v2.0 | v12"
  - "Produced by: Any dbt command that parses the project. This includes all commands, except `deps`, `clean`, `debug`, and `init`."
  - "This file contains a full representation of your dbt project's resources […] Some properties, such as `compiled_sql`, are included only for executed nodes."
- Supports: many dbt invocations rewrite `manifest.json` in `target/`, so the file changes for reasons unrelated to any editor action — which is what makes an *ambient* watcher on that directory a source of unexplained refreshes. The manifest is also not a reliable source of compiled SQL, because that field is populated only for executed nodes.
- Caveat: the page is written for the dbt Core lineage and does not describe Fusion's write mechanics. Pair with entry 8.

### [19] Fusion manifest compatibility with dbt Core

- Publisher: dbt Labs, dbt Developer Hub
- Type: primary
- URL: <https://docs.getdbt.com/docs/dbt-versions/core-upgrade/upgrading-to-v2>
- Quote: "Manifest compatibility — Fusion produces a `v12` manifest that's compatible with dbt Core. The only differences are optional Fusion-specific fields that only Fusion writes, which dbt Core safely ignores."
- Supports: a v12 manifest schema is a stable enough contract for an importer to parse, including manifests produced by a different engine.
- Caveat: "optional Fusion-specific fields" is unenumerated. A strict schema validator must tolerate unknown keys.

## The current extension and its integration package

Two kinds of evidence sit here and must not be blurred. **Entries 38–40 and 46 are read from the published npm package** `@altimateai/dbt-integration@0.3.13`, unpacked with `npm pack`; they describe the dependency's own types and behavior. **Entries 43 and 45 are read from this repository's source**; they describe how the extension declares and composes that dependency. A claim about the package does not settle a question about the extension, and vice versa. Entries 45 and 46 have to be read together: the adapter's required Cloud parameter and the repository's satisfaction of it are what actually fix the Cloud removal order.

### [38] `DBTFusionCommandProjectIntegration` extends the base, not Cloud — and its rebuild awaits `dbt parse`

- Publisher: Altimate AI, `@altimateai/dbt-integration`
- Version: 0.3.13
- Retrieval: 2026-09-20, `npm pack @altimateai/dbt-integration@0.3.13`
- Type: primary (published distribution artifact)
- Locations: `dist/index.d.ts:881`, `:1120`, `:1234`; `dist/index.js`, `DBTFusionCommandProjectIntegration.rebuildManifest`
- Quotes:
  - `declare abstract class DBTBaseProjectIntegration {`
  - `declare class DBTCloudProjectIntegration extends DBTBaseProjectIntegration implements DBTProjectIntegration {`
  - `declare class DBTFusionCommandProjectIntegration extends DBTBaseProjectIntegration implements DBTProjectIntegration {`
  - From the Fusion rebuild path: `async rebuildManifest(){…let e=this.wrapCommand(this.dbtCommandFactory.createParseCommand());e.addArgument("--log-format"),e.addArgument("json");…try{let n=(await e.execute()).stderr;…`
- Supports: two things. First, **Fusion extends the base integration and is a sibling of Cloud, not a subclass of it** — so a plan premise of "Fusion inherits from Cloud" does not match the package as published. Second, the **owned rebuild path awaits the parse command to completion before proceeding**, which is why a read sequenced after it is not exposed to the concurrent-writer hazard in entry 8.
- Caveats: the `await` establishes ordering with respect to *that* command only — it says nothing about a third-party writer. For how this repository consumes the class, and for what the hierarchy finding implies about Cloud sequencing, see entry 45; the two entries are separate because one is package evidence and the other is repository evidence.

### [39] The ambient target watcher is private to `DBTProjectIntegrationAdapter`

- Publisher: Altimate AI, `@altimateai/dbt-integration@0.3.13`
- Type: primary
- Locations: `dist/index.d.ts:1447` and `:1562-1571`; `dist/index.js`, `createTargetFolderWatcher` and `handleTargetFileChange`
- Quotes:
  - `declare class DBTProjectIntegrationAdapter extends EventEmitter implements DBTFacade {`
  - The watcher surface, every member declared private: `private startTargetWatchers;` `private stopTargetWatchers;` `private updateTargetWatchers;` `private setupTargetWatchers;` `private createTargetFolderWatcher;` `private handleTargetFileChange;` `private disposeTargetWatchers;`
  - The implementation:

    ```js
    createTargetFolderWatcher(e){try{let r=bt(async()=>{try{await this.parseManifest();}catch(i){
      this.terminal.warn("DBTProjectIntegrationAdapter",`Failed to parse manifest after file change in ${e}`,!1,{error:i});
    }},300),n=…,o=ve.watch(e,{recursive:!1},(i,a)=>{this.handleTargetFileChange(i,a,e,n,r);});
    ```

  - In the handler, a manifest change invokes the debounced callback while a run-results change is parsed inline in its own `try`/`catch`.
- Supports: two things. First, the adapter installs a non-recursive `fs.watch` on the target directory behind a 300 ms trailing debounce, so it republishes project state on qualifying writes — including writes from processes the extension did not launch. Second, and decisive for planning, **every member of this mechanism is private and no public setting or method disables it**; the only public lifecycle member on the class is `dispose()`. **Removing the ambient watcher is therefore not landable from a consuming repository** — it requires an upstream release, a maintained fork, or retiring the adapter (entry 45).
- Caveats: the debounce narrows but does not eliminate overlap with an external writer, because it delays the read rather than establishing that the write finished. This is the construct the main artifact calls an **unmeasured ambient-watcher race**: the mechanism is evidenced here and in entry 8; the frequency is measured nowhere. Note that the `catch` quoted above handles a *thrown* `parseManifest()`; the ordinary read-or-parse failure path does not throw and never reaches it — see entry 40.

### [40] Two distinct manifest read paths, with two distinct failure outcomes

- Publisher: Altimate AI, `@altimateai/dbt-integration@0.3.13`
- Type: primary
- Locations: `dist/index.d.ts:1278-1279` and `:1509-1510`; `dist/index.js`, `readTargetManifest`, `parseManifest`, `readAndParseManifestFile`
- **These are different methods on different classes, and an earlier revision of this ledger conflated them.** The correction matters because only one of them is on the watcher path.

**Path A — `readTargetManifest()`, private to `DBTFusionCommandProjectIntegration`, serving `getCatalog()`.** Declared as `getCatalog(): Promise<Catalog>;` immediately followed by `private readTargetManifest;`. Implementation:

```js
readTargetManifest(){let e=…join(this.projectRoot,"target","manifest.json");if(!ve.existsSync(e))return null;
  try{return JSON.parse(ve.readFileSync(e,"utf8"))}
  catch(r){return this.terminal.warn("DBTFusionCommandProjectIntegration","Failed to parse target/manifest.json: "+r.message,false),null}}
```

with the caller logging "target/manifest.json not found or unreadable; returning empty catalog". So on this path a failure warns once and yields an **empty catalog**.

**Path B — `parseManifest()` via `readAndParseManifestFile()`, on `DBTProjectIntegrationAdapter`, and this is the one the watcher drives.** Declared as `parseManifest(): Promise<ParsedManifest | undefined>;` followed by `private readAndParseManifestFile;`. Implementation:

```js
readAndParseManifestFile(e){ … let n=path.join(...r,L);
  try{let o=ve.readFileSync(n,"utf8"),i=JSON.parse(o);this.consecutiveReadFailures=0;return i}
  catch(o){this.consecutiveReadFailures++,this.consecutiveReadFailures>3&&this.terminal.error(
    "DBTProjectIntegrationAdapter",`Could not read/parse manifest file at ${n} after ${this.consecutiveReadFailures} attempts`,o);}}
```

```js
parseManifest(){ … let r=this.readAndParseManifestFile(e);if(r===void 0)return; … }
```

- Supports, for the watcher path only — this is the **verified** outcome and the only one the main artifact relies on: a read or parse failure is caught inside `readAndParseManifestFile()`, which falls out of the `catch` with no return statement and therefore yields `undefined`; `parseManifest()` tests `if(r===void 0)return` and exits before building any metadata maps; no `MANIFEST_PARSED` event is emitted; and **the previously published projection is left in place**. Failure is also quiet — the `terminal.error` fires only once `consecutiveReadFailures` exceeds three, and a single success resets the counter to zero.
- Caveats: "mitigates partial writes" is not "prevents staleness". A successful parse proves the bytes were complete, not that they describe current project state. And because a missing publication is silent below the threshold, the observable symptom is a panel that quietly stops updating rather than an error. **Do not attribute this outcome to the watcher callback's `warn` catch (entry 39): that catch handles a thrown `parseManifest()`, and the ordinary failure path returns rather than throwing.**

### [43] The `ManifestCacheProjectAddedEvent` publication seam, in repository source

- Publisher: this repository
- Retrieval: 2026-09-20
- Type: primary
- Locations:
  - `src/dbt_client/event/manifestCacheChangedEvent.ts:18-41` — declaration
  - `src/dbt_client/dbtProject.ts:207-231` — producer
  - `src/services/queryManifestService.ts:8-14, 34-41, 71-88` — consumer
- Quotes:
  - Declaration — note it is an **interface**, not a class: `export interface ManifestCacheProjectAddedEvent {` with `project: DBTProject;` followed by `nodeMetaMap`, `macroMetaMap`, `metricMetaMap`, `sourceMetaMap`, `graphMetaMap`, `testMetaMap`, `unitTestMetaMap`, `docMetaMap`, `exposureMetaMap`, `functionMetaMap`, `semanticModelMetaMap`, and `modelDepthMap: Map<string, number>;`
  - Envelope: `export interface ManifestCacheChangedEvent { added?: ManifestCacheProjectAddedEvent[]; removed?: ManifestCacheProjectRemovedEvent[]; }`
  - Producer: on `DBTProjectIntegrationAdapterEvents.MANIFEST_PARSED`, `const manifestCacheEvent: ManifestCacheProjectAddedEvent = { project: this, nodeMetaMap: parsedManifest.nodeMetaMap, … }` then `this._manifestCacheEvent = manifestCacheEvent;` and `this._onManifestChanged.fire({ added: [manifestCacheEvent] });`
  - Consumer: `private eventMap: Map<string, ManifestCacheProjectAddedEvent> = new Map();`, populated by `event.added?.forEach((added) => { this.eventMap.set(added.project.projectRoot.fsPath, added); });`, and read through `getEventByCurrentProject()` and `getEventByDocument(currentFilePath: Uri)`
- Supports: the extension already has a single publication seam for project metadata, with a named payload type, a single producer, and a service that keys it by project root and serves panels from it. This is the seam the main artifact proposes to stamp with epoch and revision metadata rather than replace. It also completes the causal chain behind the ambient-watcher concern: adapter target watcher → debounced `parseManifest()` → `MANIFEST_PARSED` → this event → `QueryManifestService.eventMap`.
- Caveats: this entry replaces an earlier dispatch-supplied placeholder and is now cited from file, line range, and symbol. Because `ManifestCacheProjectAddedEvent` is an interface rather than a class, adding fields is a type-level change with no runtime constructor to update, but every producer literal must supply them. The symbol does not appear in `@altimateai/dbt-integration@0.3.13` — it is this repository's own type.

### [45] Repository construction sites and the declared dependency

- Publisher: this repository
- Retrieval: 2026-09-20
- Type: primary
- Locations:
  - `src/inversify.config.ts:23, 299-320, 560-620, 632-642` — imports, bindings, factories, composition
  - `src/dbt_client/dbtProject.ts:16-17, 89` — adapter usage
  - `package.json:871` — dependency range
- Quotes:
  - `src/inversify.config.ts` imports both `DBTCloudProjectIntegration` and `DBTFusionCommandProjectIntegration` from the published package, and its factory body reads `return new DBTFusionCommandProjectIntegration(` followed by container-resolved collaborators and `projectRoot, projectConfigDiagnostics, deferConfig, onDiagnosticsChanged`
  - Both classes are bound with a guard comment — "DBTFusionCommandProjectIntegration requires projectRoot at construction time / It will be created via Factory<DBTFusionCommandProjectIntegration>" — and a matching pair exists for Cloud
  - The adapter composition site receives both: `container.get("Factory<DBTCloudProjectIntegration>"), container.get("Factory<DBTFusionCommandProjectIntegration>"),`
  - `src/dbt_client/dbtProject.ts:89` — `private dbtProjectIntegration: DBTProjectIntegrationAdapter;`
  - `package.json:871` — `"@altimateai/dbt-integration": "^0.3.13",`
- Supports: three things the main artifact depends on. First, **this repository constructs the published `DBTFusionCommandProjectIntegration` directly, with no Cloud type anywhere in the chain** — combined with entry 38, the "Fusion inherits from Cloud" premise is disproven rather than merely doubted. Second, **the repository satisfies the adapter's mandatory Cloud factory parameter** by passing `container.get("Factory<DBTCloudProjectIntegration>")` into `new DBTProjectIntegrationAdapter(...)`; read with entry 46, this is why Cloud's binding and factory cannot be deleted while the adapter remains. Third, **this repository consumes `DBTProjectIntegrationAdapter` as a declared dependency at `^0.3.13`**, which is why the private target watcher in entry 39 cannot be removed from here either.
- Caveats: the line ranges are from the working copy on the research date and will drift. **Do not read the disproven inheritance premise as licensing Cloud deletion** — this entry plus entry 46 show the blocker is the adapter's constructor, not a base class. The entry also does not enumerate Cloud code outside the container wiring, so the scope of a post-adapter Cloud sweep is still unknown.

### [46] The adapter constructor requires a Cloud integration factory

- Publisher: Altimate AI, `@altimateai/dbt-integration@0.3.13`
- Type: primary
- Locations: `dist/index.d.ts:1447` (class), `:1450-1453` (fields), `:1482` (constructor)
- Quotes:
  - The private fields, in declaration order: `private dbtCoreIntegrationFactory;` `private dbtCloudIntegrationFactory;` `private dbtFusionIntegrationFactory;` `private dbtCoreCommandIntegrationFactory;`
  - The constructor, abridged at the ellipsis but preserving every factory parameter verbatim:

    ```ts
    constructor(dbtConfiguration: DBTConfiguration, dbtCommandFactory: DBTCommandFactory,
      dbtCoreIntegrationFactory: (projectRoot: string, diagnostics: DBTDiagnosticData[], deferConfig: DeferConfig, onDiagnosticsChanged: () => void) => DBTProjectIntegration,
      dbtCloudIntegrationFactory: (projectRoot: string, diagnostics: DBTDiagnosticData[], deferConfig: DeferConfig, onDiagnosticsChanged: () => void) => DBTProjectIntegration,
      dbtFusionIntegrationFactory: (projectRoot: string, diagnostics: DBTDiagnosticData[], deferConfig: DeferConfig, onDiagnosticsChanged: () => void) => DBTProjectIntegration,
      dbtCoreCommandIntegrationFactory: (projectRoot: string, diagnostics: DBTDiagnosticData[], deferConfig: DeferConfig, onDiagnosticsChanged: () => void) => DBTProjectIntegration,
      projectRoot: string, deferConfig: DeferConfig | undefined, … );
    ```

  - `private createIntegration;` immediately follows, so selection among the four factories is internal to the adapter.
- Supports: **`dbtCloudIntegrationFactory` is a required positional constructor parameter, not optional and not injected by name.** A caller cannot omit it, cannot pass `undefined` without violating the declared type, and cannot reorder around it. Consequently `DBTCloudProjectIntegration` must remain constructible — binding, factory, and class — for as long as this external adapter is instantiated. The same holds for `dbtCoreIntegrationFactory` and `dbtCoreCommandIntegrationFactory`, so dbt Core is under the identical constraint. **The correct sequence is therefore: retire or replace the adapter first, then delete Cloud.** Because the ambient target watcher is a private member of this same class (entry 39), one retirement discharges both constraints.
- Caveats: this is the published type declaration at 0.3.13 [45]; a later release could change the signature, which is what makes "upstream release" a live option for the watcher too. The entry establishes that the Cloud *factory* is required; it does not establish that any Cloud code path is ever *executed* under a Fusion-only configuration — `createIntegration` selects internally, and which factory it calls is not visible from the declaration. Requiring a constructible factory and running Cloud logic are different things, and only the former is evidenced here.

## Language Server Protocol

### [20] LSP 3.18 — released version and change log

- Publisher: Microsoft, `microsoft/language-server-protocol`
- Published: 2026-06-04
- Type: primary
- URL: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/>
- Location: version list and "Change Log / 3.18.0 (06/04/2026)"
- Quotes: "3.18 (Current)"; "This document describes the current 3.18.x version of the language server protocol"
- Supports: 3.18 is the current specification as of the research date.
- Caveat: a server's actual capability set is negotiated at initialize. The specification bounds what *may* be supported, never what *is*.

### [21] Implementation considerations for stale results

- Publisher: Microsoft
- Type: primary
- URL: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/>
- Location: "Implementation Considerations"
- Quotes:
  - "clients usually allow users to interact with the source code even if request results are pending. We recommend the following implementation pattern to avoid that clients apply outdated response results"
  - "cancel the server request and ignore the result if the result is not useful for the client anymore. If necessary, the client should resend the request."
  - "keep the request running if the client can still make use of the result by, for example, transforming it to a new result by applying the state change to the result."
  - "servers should therefore not decide by themselves to cancel requests simply due to that fact that a state change notification is detected in the queue."
  - "if a server detects an internal state change (for example, a project context changed) that invalidates the result of a request in execution, the server can error these requests with `ContentModified`. If clients receive a `ContentModified` error, they generally should not show it in the UI for the end-user."
  - "if a client notices that a server exits unexpectedly, it should try to restart the server. However, clients should be careful not to restart a crashing server endlessly. VS Code, for example, doesn't restart a server which has crashed 5 times in the last 180 seconds."
- Supports: the specification places responsibility for discarding stale responses on the client; `ContentModified` is the sanctioned signal for a server-side state change and must not be surfaced; bounded crash-restart is the expected client policy.
- Caveat: these are recommendations ("should"), not conformance requirements.

### [22] Error codes for cancellation and modification

- Publisher: Microsoft
- Type: primary
- URL: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/>
- Location: `ErrorCodes` / `LSPErrorCodes`, and `$/cancelRequest`
- Quotes:
  - "`ContentModified: integer = -32801`" with "The result even computed on an older state might still be useful for the client. If a client decides that a result is not of any use anymore the client should cancel the request."
  - "`RequestCancelled: integer = -32800`" — "The client has canceled a request and a server has detected the cancel."
  - "To cancel a request, a notification message with the following properties is sent: method: '$/cancelRequest'"
  - "if the server implementation uses a single threaded synchronous programming language then there is little a server can do to react to a `$/cancelRequest` notification. If a server or client receives notifications starting with '$/' it is free to ignore the notification."
- Supports: the two error codes a client must treat as ordinary control flow; and the fact that cancellation is advisory, so a cancelled request may still complete and consume server time.
- Caveat: because cancellation is advisory, a client cannot use it as a resource-control mechanism. It bounds what the client *displays*, not what the server *does*.

### [23] Document versions and incremental synchronization

- Publisher: Microsoft
- Type: primary
- URL: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/>
- Locations: `VersionedTextDocumentIdentifier`, `DidChangeTextDocumentParams`, `TextDocumentSyncKind`
- Quotes:
  - "The version number of a document will increase after each change, including undo/redo. The number doesn't need to be consecutive."
  - "The document that did change. The version number points to the version after all provided content changes have been applied."
  - "`Incremental = 2`" alongside "`Full = 1`" — "Documents are synced by always sending the full content of the document."
- Supports: the per-document version is a monotonic-but-not-dense counter, and it is the correct discriminator for discarding out-of-order results on **exact** comparison; incremental synchronization is a negotiated capability, not a given.
- Caveat: versions are per-document and say nothing about project-level state. That is why the main artifact pairs them with a separate client publication epoch — and why the epoch must derive from producer evidence rather than from the filesystem, since nothing in the protocol exposes a server's internal generation.

### [24] Pull diagnostics, result ids, and precedence

- Publisher: Microsoft
- Type: primary
- URL: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/>
- Locations: "Document Diagnostics", "Workspace Diagnostics", "Diagnostics Refresh"
- Quotes:
  - "`previousResultId`: The result ID of a previous response, if provided." with an unchanged-report response shape
  - "A server is also allowed to return an error with code `ServerCancelled` indicating that the server can't compute the result right now. A server can return a `DiagnosticServerCancellationData` to indicate whether the client should re-trigger the request. If no data is provided, it defaults to `{ retriggerRequest: true }`"
  - "the workspace request can be long running and is not bound to a specific workspace or document state. […] The last one reported will win over previous reports."
  - "diagnostics for a higher document version should win over those from a lower document version (e.g. note that document versions are steadily increasing)"; "diagnostics from a document pull should win over diagnostics from a workspace pull."
- Supports: the protocol already defines an unchanged-result token, a server-side "not now, retry" signal, and explicit precedence for reconciling overlapping diagnostic sources. A client re-implementing any of this duplicates the protocol.
- Caveat: all conditional on the server advertising `diagnosticProvider`. A push-diagnostics server exposes none of these knobs.

## Snowflake

### [25] Persisted query results — conditions, lifetime, and role scoping

- Publisher: Snowflake
- Type: primary
- URL: <https://docs.snowflake.com/en/user-guide/querying-persisted-results>
- Locations: opening section and "Retrieval Optimization"
- Quotes:
  - "For persisted query results of all sizes, the cache expires after 24 hours."
  - "The new query matches the previously executed query exactly. Any difference in syntax, including lowercase versus uppercase, or the use of table aliases, will inhibit 100% cache reuse."
  - "The query does not include non-reusable functions, which return different results for successive runs of the same query. UUID_STRING, RANDOM, and RANDSTR are good examples"
  - "The query does not include external functions." / "The query does not select from hybrid tables." / "The table data contributing to the query result has not changed." / "The table's micro-partitions have not changed (e.g. been reclustered or consolidated) due to changes to other data in the table."
  - "The role accessing the cached results has the required privileges." / "If the query was a SELECT query, the role executing the query must have the necessary access privileges for all the tables used in the cached query." / "If the query was a SHOW query, the role executing the query must match the role that generated the cached results."
  - "Meeting all these conditions does not guarantee that Snowflake reuses the query results."
  - "Each time the persisted result for a query is reused, Snowflake resets the 24-hour retention period for the result, up to a maximum of 31 days"
  - "the security token used to access large persisted query results (i.e. greater than 100 KB in size) expires after 6 hours"
- Supports: Snowflake's own result cache is correct by construction — keyed on exact SQL text, invalidated by data and micro-partition changes, gated on the requesting role's privileges. An extension-level result cache reproduces none of the middle guarantees.
- Caveat and refinement: exact-text matching means the hazard is **variability in the submitted statement text, not decoration as such**. A deterministic statement stays eligible; a statement carrying a per-submission timestamp, run id, or invocation id never matches again. See entry 42 for why a session query tag is a different case.

### [26] `USE_CACHED_RESULT`

- Publisher: Snowflake
- Type: primary
- URL: <https://docs.snowflake.com/en/sql-reference/parameters>
- Location: "USE_CACHED_RESULT"
- Quotes: "Session — Can be set for Account %ra% User %ra% Session"; "Specifies whether to reuse persisted query results, if available, when a matching query is submitted."
- Supports: result reuse is a session-scoped toggle that an account or user policy may already have disabled.
- Caveat: settable at three levels, so an extension cannot assume reuse is available; observed latency will differ between accounts for reasons the extension does not control.

### [27] Warehouse data cache and auto-suspension

- Publisher: Snowflake
- Type: primary
- URL: <https://docs.snowflake.com/en/user-guide/performance-query-warehouse-cache>
- Quotes:
  - "A running warehouse maintains a cache of table data that can be accessed by queries running on the same warehouse."
  - "The auto-suspend setting of the warehouse can have a direct impact on query performance because the cache is dropped when the warehouse is suspended."
  - "For DevOps, DataOps, and Data Science use cases, Snowflake recommends setting auto-suspension to approximately 5 minutes"
- Supports: a second, distinct Snowflake cache exists below the result cache, and its warmth depends on warehouse settings the extension does not own.
- Caveat: guidance aimed at warehouse administrators. An extension can measure the effect but cannot change it.

### [28] Query phases

- Publisher: Snowflake, engineering blog
- Type: reputable
- URL: <https://www.snowflake.com/en/blog/more-throughput-and-faster-execution-for-interactive-use-cases-now-in-public-preview/>
- Quotes:
  - "Setup: After a client application sends the query to Snowflake, we allocate initial resources."
  - "Compilation: The query statement gets parsed and we create a plan to execute the query."
  - "Scheduling: Snowflake checks if there are enough resources in the virtual warehouse to execute the query."
  - "Execution: In this phase we access data, join tables, filter data by predicates, and perform aggregations. The results get returned to the requesting client application."
  - "Queueing: A query might spend some time in the queueing phase if there are no free resources"
- Supports: the named decomposition of server-side query latency, reused in the latency budget model.
- Caveat: vendor marketing for a specific preview feature. Use the phase names, not the improvement percentages.

### [29] Per-query latency attribution in query history

- Publisher: Snowflake
- Type: primary
- URLs:
  - <https://docs.snowflake.com/en/sql-reference/account-usage/query_history>
  - <https://docs.snowflake.com/en/sql-reference/functions/query_history>
- Quotes:
  - "`compilation_time` | NUMBER | Compilation time (in milliseconds)"; "`execution_time`"; "`queued_provisioning_time` | […] waiting for the warehouse compute resources to provision, due to warehouse creation, resume, or resize"; "`queued_overload_time` | […] due to the warehouse being overloaded"; "`queued_repair_time`"
  - "Latency for the view may be up to 45 minutes."
- Supports: Snowflake attributes each query's time to named phases readable per query id; and the `ACCOUNT_USAGE` view is unusable for interactive measurement because it lags up to 45 minutes.
- Caveat: use the `INFORMATION_SCHEMA.QUERY_HISTORY` table function for recent queries — shorter retention, no comparable lag.

### [30] Query cancellation and statement timeouts

- Publisher: Snowflake
- Type: primary
- URLs:
  - <https://docs.snowflake.com/en/sql-reference/functions/system_cancel_query>
  - <https://docs.snowflake.com/en/sql-reference/parameters>
- Quotes:
  - "Cancels the specified query (or statement) if it is currently active/running." and "A user can cancel their own running SQL operations using this SQL function."
  - "`STATEMENT_TIMEOUT_IN_SECONDS` […] Amount of time, in seconds, after which a running SQL statement (query, DDL, DML, and so on) is canceled by the system."
  - "`STATEMENT_QUEUED_TIMEOUT_IN_SECONDS` […] Amount of time, in seconds, a SQL statement […] remains queued for a warehouse before it is canceled by the system."
  - "`CLIENT_SESSION_KEEP_ALIVE` […] Session — Can be set for Account %ra% User %ra% Session"
- Supports: server-side cancellation requires the query id; two independent server-side timeouts can terminate work the editor is waiting on, so a cancelled preview is a normal outcome.
- Caveat: the extension does not talk to Snowflake directly under the stated product boundary; Fusion does. Whether Fusion surfaces the query id and supports cancelling an in-flight preview is an open question.

### [42] `QUERY_TAG` is session metadata, not statement text

- Publisher: Snowflake; corroborated by `dbt-labs/dbt-core@v2.0.5`
- Type: primary
- URLs:
  - <https://docs.snowflake.com/en/sql-reference/parameters>
  - <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-adapter/src/sql/diff.rs>
- Locations: "QUERY_TAG" parameter entry; `canonicalize_query_tag`
- Quotes:
  - "Type: Session — Can be set for Account %ra% User %ra% Session"; "Data Type: String (up to 2000 characters)"; "Optional string that can be used to tag queries and other SQL statements executed within a session. The tags are displayed in the output of the QUERY_HISTORY , QUERY_HISTORY_BY_* functions."
  - From the engine: a regex over `\balter\s+session\s+set\s+query_tag\s*=\s*'[^']*'`, and a test fixture containing `alter session set query_tag = '{"dbt_environment_name": "default", …, "dbt_model_name": …}'`
- Supports: a query tag is set by a **separate** `ALTER SESSION` statement and recorded as session metadata; it does not alter the text of the statements it tags. **Tagging therefore does not forfeit exact-match result-reuse eligibility** (entry 25), and the engine already emits tags in this form.
- Caveats: this establishes Snowflake's semantics and that the engine emits such statements. It does **not** establish that the extension can set or influence the tag through Fusion — that is unverified and is a spike. Note also that the tag payload in the engine's own fixture embeds model and user names, so a tag is a data-exposure surface in query history even though it is not a cache hazard.

## Comparable systems

### [31] rust-analyzer — immutable snapshots and revision-based cancellation

- Publisher: rust-analyzer maintainers
- Type: primary
- URL: <https://rust-analyzer.github.io/book/contributing/architecture.html>
- Locations: "crates/ide", "crates/vfs", "Cancellation"
- Quotes:
  - "`AnalysisHost` is a state to which you can transactionally `apply_change`. `Analysis` is an immutable snapshot of the state."
  - "They provide consistent snapshots of the underlying file system and insulate messy OS paths."
  - "The salsa database maintains a global revision counter. When applying a change, salsa bumps this counter and waits until all other threads using salsa finish. If a thread does salsa-based computation and notices that the counter is incremented, it panics with a special value"
  - "`ide` is the boundary where the panic is caught and transformed into a `Result<T, Cancelled>`."
- Supports: the canonical design — one mutable host, immutable snapshots handed to readers, and one designated boundary where cancellation becomes an ordinary result.
- Caveat, sharpened: rust-analyzer's counter is authoritative **because rust-analyzer owns the computation**. A client of an opaque server can neither observe the server's revision nor abort its work. A client-side counter that imitates salsa's revision — especially one derived from filesystem events — has the shape of the pattern without its guarantee. The transferable part is immutable publication; the revision semantics do not transfer.

### [32] gopls — cache invalidation as the core difficulty

- Publisher: The Go Authors, `golang/tools`
- Type: primary
- URL: <https://github.com/golang/tools/blob/master/gopls/doc/design/design.md>
- Locations: "Cache invalidation", goals
- Quotes:
  - "gopls needs to be able to map files to packages efficiently, so that when files change it knows which packages need to be updated (along with any other packages that transitively depended on them)."
  - "This is made especially difficult by the fact that changing the content of a file can modify which packages it is considered part of […] and changes can be made to files without using the editor, in which case it will not notify us of the changes."
  - "it needs to manage how it caches the converted forms very carefully to balance memory use vs speed"
- Supports: the difficulty is invalidation, not caching — particularly for edits that change graph membership and for changes made outside the editor.
- Caveat: Go's package graph is not dbt's DAG. The structural lesson transfers; the specifics do not.

### [33] Duplicate-call suppression

- Publisher: The Go Authors, `golang.org/x/sync`
- Type: primary
- URLs:
  - <https://pkg.go.dev/golang.org/x/sync/singleflight>
  - <https://github.com/golang/sync/blob/master/singleflight/singleflight.go>
- Location: package and `Do` doc comments
- Quotes: "Package singleflight provides a duplicate function call suppression mechanism."; "Do executes and returns the results of the given function, making sure that only one execution is in-flight for a given key at a time. If a duplicate comes in, the duplicate caller waits for the original to complete and receives the same results."
- Supports: the standard shape for collapsing concurrent identical requests.
- Caveat, and the reason the main artifact defers it: the pattern is only worth adopting once duplicate work is *observed*. `vscode-languageclient` already correlates requests to responses and manages cancellation, so the duplication this would suppress may not exist. If adopted, the key must fully determine the result — including the publication epoch and the document version.

### [34] Content-addressed action caching

- Publisher: Google, Bazel
- Type: primary
- URL: <https://bazel.build/remote/caching>
- Quotes:
  - "The remote cache stores two types of data: The action cache, which is a map of action hashes to action result metadata. A content-addressable store (CAS) of output files."
  - "Each action has inputs, output names, a command line, and environment variables. Required inputs and expected outputs are declared explicitly for each action."
  - "An action definition contains environment variables. This can be a problem for sharing remote cache hits across machines. For example, environments with different `$PATH` variables won't share cache hits."
  - "When an input file is modified during a build, Bazel might upload invalid results to the remote cache."
  - "Bazel currently does not track tools outside a workspace. […] two users with different compilers installed will wrongly share cache hits because the outputs are different but they have the same action hash."
- Supports: the separation of a key-to-metadata map from a content-addressed blob store; and the two classic failure modes — an incomplete key omitting part of the environment, and inputs mutating during the operation.
- Caveat: Bazel's correctness rests on hermetic, fully-declared actions. dbt compilation reads environment variables, profiles, and warehouse metadata, so any content-addressed compile cache outside the engine would need all of those in its key — which entry 6 shows the engine already does.

### [35] Stale-while-revalidate

- Publisher: IETF, M. Nottingham
- Published: 2010-05
- Type: primary
- URL: <https://www.rfc-editor.org/rfc/rfc5861.html>
- Locations: sections 1, 3, 5
- Quotes:
  - "The stale-while-revalidate HTTP Cache-Control extension allows a cache to immediately return a stale response while it revalidates it in the background, thereby hiding latency (both in the network and on the server) from clients."
  - "If a cached response is served stale due to the presence of this extension, the cache SHOULD attempt to revalidate it while still serving stale responses (i.e., without blocking)."
  - "Note that 'stale' implies that the response will have a non-zero Age header and a warning header"
  - "If delta-seconds passes without the cached entity being revalidated, it SHOULD NOT continue to be served stale"
  - "It is suggested that such validation be predicated upon an incoming request, to avoid the possibility of an amplification attack"
- Supports: the formal shape — a bounded staleness window, an explicit staleness marker visible to the consumer, revalidation triggered by demand rather than a timer, and a hard stop.
- Caveat: written for HTTP caches. The transferable requirements are the bounded window, the visible marker, and demand-triggered revalidation.

### [36] `rename()` is atomic; truncate-and-write is not

- Publisher: The Open Group / IEEE, POSIX.1-2024
- Type: primary
- URL: <https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html>
- Locations: DESCRIPTION, RATIONALE
- Quotes:
  - "if the directory entry named by new exists, it shall be removed and old renamed to new. In this case, a directory entry named new shall remain visible to other threads throughout the renaming operation and refer either to the file referred to by new or old before the operation began."
  - "That specification requires that the action of the function be atomic."
- Supports: write-to-temporary-then-rename is the standard way to publish a file so that a concurrent reader sees either the whole old version or the whole new one.
- Caveat: atomic with respect to directory-entry visibility, not durability; also fails across file systems (`EXDEV`). Entry 8 shows the public engine does not use this pattern for `manifest.json` — which makes a **concurrent** reader vulnerable, not every reader (entry 38).

### [37] VS Code file-system watchers

- Publisher: Microsoft
- Type: primary
- URL: <https://code.visualstudio.com/api/references/vscode-api>
- Location: "FileSystemWatcher"
- Quotes: "A file system watcher notifies about changes to files and folders on disk or from other FileSystemProviders."; the three events `onDidChange`, `onDidCreate`, `onDidDelete`; and the corresponding `ignoreChangeEvents`, `ignoreCreateEvents`, `ignoreDeleteEvents` flags.
- Supports: the extension host can observe create, change, and delete without polling.
- Caveat: the API surfaces an event and a URI, nothing more — no content, no ordering guarantee relative to the language server's view, and no indication that a write is complete. A watcher event is a hint to revalidate, never a fact about file contents. The same limitation applies to the Node `fs.watch` the integration package uses (entry 39).

## Local observations

### [41] The parse cache tracks project resource paths, not the output directory

- Publisher: dbt Labs, `dbt-labs/dbt-core@v2.0.5`
- Retrieval: 2026-09-20
- Type: observation over primary source
- URL: <https://github.com/dbt-labs/dbt-core/blob/v2.0.5/crates/dbt-metadata/src/partial_parse.rs>
- Location: `PackageSnapshot`, line 373, and its uses at lines 204, 253–259
- Quote: `pub all_paths: HashMap<ResourcePathKind, Vec<(String, u64)>>`, with the surrounding mtime comparison described as "Returns `true` when every file in `all_paths` has an unchanged mtime."
- Supports: the mtime-keyed set is organized by `ResourcePathKind` — the project's declared resource paths — so it covers project sources, not the `target/` output directory.
- Caveat and correction: an earlier revision of this research asserted that an extension writing into `target/` would invalidate the engine's parse cache through mtime comparison and trigger the ~1.8 s full-parse class. **That mechanism is withdrawn as unsupported.** The prohibition on writing into `target/` stands on ownership grounds (entry 7); the invalidation rationale does not.

### [44] ADR 0002 — the artifact-reading boundary

- Publisher: this repository, `docs/adr/0002-use-the-native-fusion-lsp.md`
- Type: primary (project decision record)
- Quote: "Local panels will call dbt LSP commands first and read Fusion artifacts only where the protocol lacks required data."
- Supports: artifact reading is permitted as a scoped fallback rather than forbidden outright. The main artifact reads this as sanctioning three paths — safe post-command reads, documented capability-gap fallback with validated reads, and explicit prior-state imports — while leaving ambient watching outside the boundary.
- Caveat: the ADR text does not itself enumerate three paths; that enumeration is the main artifact's reading of it, informed by the adversarial review. The ADR also does not say what to do when the protocol's coverage is simply unknown, which is the situation until the payload inventory exists.

## Facts, inferences, and gaps

Only the first list is citable as fact.

**Established facts.** Fusion 2.0.5 exists and is dated 2026-09-18 [1]. Its engine source is public at `dbt-labs/dbt-core` [2]; its language server is not [4]. The public engine maintains a parse cache keyed on file mtimes over project resource paths plus blake3 hashes of config inputs [5][6][41], caches compiled SQL on disk behind an in-process validity set [9], and caches warehouse schemas in a TTL'd, epoch-append parquet store [10]. It writes `manifest.json` by truncating and streaming, with no rename [8]. The language server compiles lazily, cancels in-progress compiles on focus change, and is documented as running independently of terminal `dbt` commands [14]. In `@altimateai/dbt-integration@0.3.13`, Fusion extends the base integration rather than Cloud, and its rebuild awaits `dbt parse` before proceeding [38]; this repository constructs that class directly with no Cloud type in the chain [45]. `DBTProjectIntegrationAdapter`'s constructor nonetheless requires Core, Cloud, Fusion, and Core-command integration factories as mandatory positional parameters [46], and the repository supplies all four [45], so Cloud must stay constructible until that adapter is retired. A separate ambient `fs.watch` on `target/` with a 300 ms debounce republishes state, and every member of that watcher is private to `DBTProjectIntegrationAdapter` [39]; on the watcher path a read or parse failure yields `undefined`, suppresses the `MANIFEST_PARSED` emission, and leaves the prior projection in place [40]. That publication reaches panels through the `ManifestCacheProjectAddedEvent` interface and `QueryManifestService` [43]. Snowflake's result cache is exact-text-keyed, data-change-invalidated, role-gated, 24-hour-expiring, and not guaranteed even when all conditions hold [25]; `QUERY_TAG` is session metadata that does not alter statement text [42]. The LSP specification assigns stale-result rejection to the client and defines `ContentModified` for server-side state changes [21][22].

**Inferences**, reasoned from those facts and not stated by any source. Because the public writer truncates in place [8] and many dbt commands rewrite the manifest [18], an ambient watcher that republishes on arbitrary `target/` writes can interleave with an external writer — an **unmeasured** race whose frequency no source establishes [39]. Because the engine's parse-cache key already includes hashes of config inputs the client does not observe [6], a client-side compile cache would key on a different and incomplete input set — which is an argument that the producer should own compile invalidation, not a claim that the engine's cache is faster or stronger than any cache a client could write. Because compiled-SQL validity lives in process memory [9], files under `target/compiled/` cannot be validated from outside. Because nothing in the LSP protocol exposes a server's internal generation [23], a client counter derived from filesystem events cannot prove anything about the server's state, which is why publication must be driven by producer evidence.

**Gaps**, each driving a spike. The language server's payload shapes for the operations the migration depends on, beyond the capabilities already recorded; whether the server writes any `target/` artifact; the measured rate of the ambient-watcher race; whether server and CLI share the parse cache directory and how they arbitrate; the default warehouse-schema TTL; whether preview execution surfaces a Snowflake query id or allows setting a query tag; how to detect that a `strict` configuration silently fell back to `baseline`; what the server does on `profiles.yml` or `dbt_project.yml` change; the extent of Cloud code beyond the container wiring [45]; whether any Cloud code path actually executes under a Fusion-only configuration, as opposed to merely being constructible [46]; and when the adapter that owns both the private target watcher and the mandatory Cloud factory parameter is actually retired [39][46]. The class hierarchy, the publication seam, and the Cloud blocker are no longer gaps — all three are cited from source [38][43][45][46].
