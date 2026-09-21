# The interactive data path for dbt Fusion, September 2026

Research date 2026-09-20; revised 2026-09-20 after adversarial review. Evidence is recorded in [the companion ledger](dbt-fusion-interactive-data-path-september-2026-sources.md); bracketed numbers in this document are entries in that file.

Every claim below carries a confidence label: **High**, **Medium**, **Low**, or **Speculative**. Calibrate reading accordingly — the confidence is part of the claim.

## Two standing caveats that bound every claim in this document

**Public source is a prior, not proof about the shipped binary.** Source claims are pinned to `dbt-labs/dbt-core@v2.0.5` (commit `a3bdd96b`, 2026-09-18) [1][2]. That tree is the best public evidence available, and it is genuinely strong evidence about the engine's design intent. It is not proof that the distributed Fusion binary a user installs executes identical code paths: the language server is absent from the public tree [4], build configuration and feature flags are not visible, and a vendor may ship customized or additional paths. **Any behavior that would change the plan must be reproduced against the pinned binary before it is acted on.** Throughout this document, source-derived engine behavior is labeled a *prior*; where a plan decision depends on it, a spike is named. (High, as a methodological constraint.)

**Engine behavior is a prior on language-server behavior, not a statement about it.** The CLI entry points in the public tree reach the parse cache, compiled-SQL cache, and schema store [5][6][9][10]. The server shares those crates — comments such as "Only in LSP Mode" and "Loads the cache state from previous resolved state (LSP/incremental path)" say so [4] — but the server's own code paths, its scheduling, and its cache ownership are not visible. Do not read "the engine does X" as "the LSP owns X". (High.)

## 1. Executive finding and latency budget model

### The finding

**The extension's own contribution to interactive latency is small, and the useful work is to stop duplicating producer state rather than to build faster caches.** (Medium-High.)

Four observations drive the rest of the document.

**First, the public engine already owns parse invalidation and keeps its own compiled-SQL storage, which makes duplicating compiler truth unjustified.** The parse cache is keyed on the mtime of every tracked file plus blake3 content hashes of `dbt_project.yml`, `profiles.yml`, `package-lock.yml`, and the serialized `--vars`, additionally guarded by the binary's own version [5][6]. Compiled SQL is cached under `target/compiled/` with a macro-span sidecar [9]. Warehouse schemas live in a TTL'd, epoch-append parquet store with a build-hash guard [10]. A TTL lease primitive exists for coordinating shared files across processes [11]. Two limits bound how far this reaches. **It is a prior, not an ownership claim:** the engine implements these caches; whether the LSP owns them at runtime is unverified. **It is also not a superiority claim:** the parse cache is keyed on paths, mtimes, and config hashes — it is not content-addressed, and nothing here shows it outperforms or subsumes every cache a client could build. The argument is about responsibility, not about who would win a benchmark. The producer already owns invalidation, so a second implementation of the same truth is redundant work with a second chance to be wrong. What follows is narrow — do not recreate compiler truth, and do not persist derived compiler state to disk. Bounded in-memory retention of LSP responses and panel projections remains permitted. (High for the engine facts; Medium for the design conclusion; ownership and comparative-strength claims withheld.)

**Second, the manifest hazard is real but narrower than a blanket "every read is broken".** The distinction is between the two read paths the current extension actually has, and the evidence separates them cleanly:

- The **owned rebuild path** awaits `dbt parse` to completion and only then parses the artifact. In `@altimateai/dbt-integration@0.3.13`, `DBTFusionCommandProjectIntegration.rebuildManifest()` builds a parse command, `await`s `execute()`, and proceeds from there [38]. A read sequenced after a completed, awaited write by the process you launched is not a race with that write. It may still be stale relative to some *other* writer, but that is a freshness question, not a torn-read question. (High.)
- The **ambient `fs.watch` target watcher** is the exposure. `DBTProjectIntegrationAdapter` creates a non-recursive `fs.watch` on the target directory, debounces 300 ms, and calls `parseManifest()` [39]. The engine's public writer truncates in place and streams, with no temporary file and no rename [8], and POSIX gives atomic publication only to `rename()` [36]. So an external writer — a terminal `dbt run`, a CI script, a `git checkout` — can interleave with a watcher-triggered read. **Call this what it is: an unmeasured ambient-watcher race.** (Medium — the mechanism is well-evidenced, the frequency is not measured.)

Two corrections to the previous revision of this document belong here. **The claim that a truncated JSON document can be syntactically valid is withdrawn**; it was asserted without support and is not needed for the argument. And **the verified failure outcome is a missing publication, not corrupted state**: `readAndParseManifestFile()` catches the read-or-parse error and returns `undefined`, `parseManifest()` returns early on `undefined`, no `MANIFEST_PARSED` is emitted, and the prior projection therefore remains in place [40]. That mitigates partial writes. It does not establish freshness — and because the failure is silent below a consecutive-failure threshold, the observable symptom is a panel that quietly stops updating [40]. (High.)

**Third, the latency apportionment favors the producer.** The engine's published figures for a roughly 6,000-node project are about 10 ms for an unchanged-files fast path, about 500 ms for an incremental reparse after a model `.sql` edit, about 1.8 s for a full reparse triggered by any config or non-model file change, and about 7.5 s cold with no parse cache [5]. Against a 500 ms incremental reparse, React rendering is noise. Against the 10 ms fast path, a badly-written panel refresh is not. (Medium — vendor benchmark, unstated hardware, CLI figures, and a prior on the distributed binary rather than a measurement of it.)

**Fourth, the "Fusion inherits from Cloud" premise is disproven, and the sequencing consequence is specific.** The published declaration is `DBTFusionCommandProjectIntegration extends DBTBaseProjectIntegration`, a sibling of `DBTCloudProjectIntegration` rather than a subclass [38]. This repository constructs that published class directly — `src/inversify.config.ts` imports it and its factory calls `new DBTFusionCommandProjectIntegration(...)` with no Cloud type in the chain [45]. **There is no inheritance edge from Fusion to Cloud to sever.** (High.)

**But the sequencing conclusion does not follow from that, and an earlier revision of this document got it wrong.** The dependency is composition, not inheritance — and the composition is mandatory. `DBTProjectIntegrationAdapter`'s constructor takes four integration factories as required positional parameters: Core, **Cloud**, Fusion, and Core-command, each typed `(projectRoot, diagnostics, deferConfig, onDiagnosticsChanged) => DBTProjectIntegration` [46]. This repository supplies all four at the composition site, including `container.get("Factory<DBTCloudProjectIntegration>")` [45]. The adapter is external code; its signature is not ours to change.

**Stated precisely: Cloud's binding, factory, and composition cannot be deleted while the external adapter remains, because the adapter's constructor requires the Cloud factory.** Removing Cloud is therefore blocked — just not on the thing the plan said. The real order is:

1. **Retire or replace the external `DBTProjectIntegrationAdapter`.** This is the gating step. It also removes the private ambient manifest watcher, since the watcher is a private member of that same class [39] — one step discharges both constraints.
2. **Then delete Cloud construction, bindings, factory, and the remaining Cloud code**, which is only reachable once nothing requires a Cloud factory to be constructible.

What the disproven inheritance premise actually changes is the *nature* of step 2, not its position: it is deletion of composition wiring rather than a reparenting exercise, and it no longer has to wait on Fusion being re-based onto anything. It still has to wait on the adapter. (High for the constructor requirement and the composition site; High for the resulting order; Medium for step 2's scope, which needs a full Cloud sweep.)

The architectural conclusion: **one producer at a time, published in whole steps, with client-side epoch stamping.** Not "the LSP owns a generation the client mirrors" — the client cannot observe a closed server's internal state. See section 4.

### The latency budget model

Model each interaction as a sum over named segments. Each has a different owner, and an owner you do not control is a segment to design around rather than optimize.

| Segment | Name            | Owner         | What it covers                                                    |
| ------- | --------------- | ------------- | ----------------------------------------------------------------- |
| E1      | Input debounce  | Extension     | Keystroke or command to the moment work is dispatched             |
| E2      | Client dispatch | Extension     | Request construction and cancellation-token setup                 |
| L1      | Server queue    | Fusion LSP    | Request sits behind other work in the server                      |
| L2      | Node compile    | Fusion LSP    | Lazy compile of the focused node and its ancestors [14]           |
| L3      | Project reparse | Fusion engine | Fast path, incremental, or full, per the invalidation classes [5] |
| W1      | Schema fetch    | Snowflake     | Warehouse schema download, `strict` static analysis only [17]     |
| S1      | Setup           | Snowflake     | Client submit to resource allocation [28]                         |
| S2      | Query compile   | Snowflake     | Parse and plan [28][29]                                           |
| S3      | Queue           | Snowflake     | Provisioning, overload, or repair wait [29]                       |
| S4      | Execute         | Snowflake     | Scan, join, aggregate [28]                                        |
| S5      | Result transfer | Network       | Rows to the client                                                |
| E3      | Projection      | Extension     | Server result to typed panel message                              |
| E4      | Webview post    | VS Code       | Message serialization across the webview boundary                 |
| E5      | Render          | React         | Paint                                                             |

Three composite budgets follow, and they behave differently.

**Edit to diagnostic** is `E1 + L1 + L2`, with an `L3` term whenever the edit crosses an invalidation class. This is almost entirely the server's. The extension's levers are E1 — do not debounce document synchronization at all, because `vscode-languageclient` already sends incremental `didChange` — and not adding work that competes with L1. The invalidation classes matter more than any tuning [5]. (Medium.)

**Panel open or refresh** is `E2 + L1 + L2 + E3 + E4 + E5`. This is where extension design decides the outcome, because the panel chooses whether to block on L2 at all. A panel that renders the previous publication's projection immediately and revalidates behind it collapses perceived latency to `E3 + E4 + E5`. That is the stale-while-revalidate shape [35], safe for display-only data and unsafe for anything else — see section 6.

**Preview query** is `E2 + L2 + S1..S5 + E3 + E4 + E5`, with W1 on the first strict-mode compile. Snowflake dominates, and warehouse warmth dominates Snowflake: the data cache is dropped on suspend [27], and resuming lands in S3 as `queued_provisioning_time` [29]. Result reuse can eliminate S3 and S4, but only on exact text match with adequate role privileges [25] — see section 3 for what that does and does not forbid.

**A rule the model implies:** never place an extension-owned blocking step in front of a server-owned segment. Any debounce the extension adds is pure addition to a budget that already contains a queue it does not control.

### Targets

Do not set numeric targets yet. Every published number available is either the engine authors' benchmark on their own fixture [5] or vendor marketing [15][28]. Targets must be derived from a local baseline harness (section 8) and expressed as per-segment percentiles against that baseline. (High, as a methodological claim.)

## 2. Verified behavior: dbt Fusion, the language server, and artifacts

### What the public source establishes, as a prior

**The engine source is public; the language server is not.** `dbt-labs/dbt-core` is the Rust monorepo for Fusion [2]; the older `dbt-labs/dbt-fusion` repository is a frozen pre-2.0.5 snapshot that should not be cited [3]. Searching the `v2.0.5` tree for any language-server implementation — `textDocument`, `tower-lsp`, `lsp_types` — returns nothing [4]. **The Fusion LSP wire protocol cannot be read from public source and must be observed against the pinned binary.** (High.)

**Parsing is incremental, with documented invalidation classes.** The parse cache "memoizes `resolve(project_files) → ResolverState`" keyed on "the set of (file_path, mtime) pairs for every tracked file", under an invariant that any node it returns must be identical to what a full parse would produce [5]. Config inputs are additionally guarded by blake3 content hashes, present specifically to catch `env_var` changes that do not move a timestamp [6]. A model or analysis `.sql` edit is incremental; a `.yml` change, deletion, config-content change, vars change, env-var change, or binary upgrade forces a full parse [5]. **The tracked set is the project's resource paths, not the output directory** — `all_paths` is keyed by `ResourcePathKind` [41]. (High as a statement about public source; a prior about the shipped binary.)

**Compiled SQL is cached on disk and validated in memory.** Fusion writes compiled SQL under `target/compiled/` with a `*.macro_spans.json` sidecar, gating reads on an in-process `valid_nodes` set; a lookup for a node outside that set returns nothing regardless of what is on disk [9]. **An external reader of `target/compiled/` cannot distinguish current from stale, because the validity set is not on disk.** (High.)

**Warehouse schemas are cached with real cache discipline.** Compile-time schemas have no TTL, warehouse-fetched schemas do; rows carry `cached_at_ms` and the writing binary's `CARGO_PKG_VERSION`; epochs are append-only, and the module notes "No lock file — save() writes a new epoch file atomically (new file); it never modifies existing files, so concurrent writers are safe" [10]. The contrast with the manifest writer is informative: this store was designed for concurrent access, and the manifest writer was not [8][10]. (High.)

**The language server compiles lazily, prioritizes the focused file, cancels superseded work, and reports progress.** Opening a model triggers compilation of "the current model and its upstream dependencies (ancestors in the DAG)"; other nodes stay uncompiled until a background pass reaches them, and "Until a node is compiled, LSP results for that node are not available"; switching files cancels an in-progress compile and discards partial work; progress appears in the status bar [14]. (High for the documented behavior — vendor reference for its own product.)

**The server is documented as independent of terminal `dbt` invocations.** "Running a command like `dbt run` or `dbt compile` from the terminal does not interrupt or affect LSP compilation" [14]. (High that this is stated; Low that it extends to shared on-disk state — a gap, not a finding.)

**Compiled-code display refreshes on save** in dbt Labs' own extension: "Compiled code will update as you save your source code" [15]. Useful precedent for panel refresh policy. (High.)

### Two corrections to dbt Core transfers

- **There is no `partial_parse.msgpack` in Fusion.** The parse cache is parquet, under the metadata directory at `<metadata_dir>/parse` [6]. (High.)
- **`manifest.json` remains v12 and cross-compatible** between Fusion and dbt Core, with "optional Fusion-specific fields that only Fusion writes, which dbt Core safely ignores" [19]. The *schema* transfers; the *write mechanics* do not [8]. (High.)

### What `--partial-load` actually costs, stated precisely

The previous revision overstated this. The documented constraint is that `--partial-load` "can only be used when `write_json` is false (manifest export needs all nodes)", along with `any_uses_graph` and `defer` being false [13].

**Correctly stated: only an operation that must *produce* a newly written full manifest forgoes the partial-load path. Reading an artifact that already exists on disk adds no parse cost at all.** A feature specified as "run a command that writes a fresh manifest, then read it" pays the full-load price; a feature specified as "read the manifest that is already there" pays nothing extra and is a freshness question instead. These are different designs with different costs, and conflating them was the error. (High for the constraint; High for the corrected reading.)

### Gaps in Fusion 2.0.5

None of these has a public answer, and each is a candidate for the reduced spike program in section 8: the server's method and payload inventory beyond what has already been captured; whether the server writes any `target/` artifact; whether server and CLI share the parse cache directory and how they arbitrate; the default warehouse-schema TTL; whether preview execution surfaces a Snowflake query id; and what the server does when `profiles.yml` or `dbt_project.yml` changes.

## 3. Verified behavior: Snowflake network, query, and result reuse

**Snowflake's persisted result cache is a correctness-preserving cache that an extension cannot replicate.** Reuse requires exact query-text match — "Any difference in syntax, including lowercase versus uppercase, or the use of table aliases, will inhibit 100% cache reuse" — plus unchanged contributing table data and unchanged micro-partitions. It is role-gated: for a `SELECT`, "the role executing the query must have the necessary access privileges for all the tables used in the cached query"; for a `SHOW`, the role must *match* the role that generated the result. Results expire after 24 hours, each reuse resetting the window up to 31 days. The documentation closes the list with "Meeting all these conditions does not guarantee that Snowflake reuses the query results" [25]. (High.)

Read that list as a specification of what a local result cache would have to implement: exact-text keying, data-change invalidation, micro-partition-change invalidation, per-role privilege evaluation, and bounded expiry. **An extension can implement the first and the last. It cannot implement the middle three.** (High.)

### Three distinct things that are easy to conflate

The previous revision collapsed these into a single warning against "comments or tags". They behave differently and deserve separate treatment.

**Deterministic submitted SQL.** If the same logical preview produces byte-identical statement text on every submission, it remains eligible for exact-match reuse [25]. Determinism is the property that matters — not the absence of decoration. (High.)

**Stable versus changing comments.** A comment whose text is constant across submissions changes the statement text once and then stops changing it; the first submission populates the cache and subsequent identical submissions remain eligible. A comment that embeds a timestamp, an invocation id, a run id, or any per-submission value makes every statement unique and defeats reuse permanently. **The hazard is variability, not comments.** If a query comment is wanted, it must be deterministic for a given logical query. (High — follows directly from the documented exact-match rule [25].)

**Snowflake `QUERY_TAG` is session metadata, not statement text.** It is a session parameter settable at account, user, and session level, described as "Optional string that can be used to tag queries and other SQL statements executed within a session. The tags are displayed in the output of the QUERY_HISTORY" functions [42]. It is applied by `ALTER SESSION SET QUERY_TAG`, a separate statement, and dbt's own engine already emits exactly that form [42]. Because the tag does not alter the tagged statement's text, **tagging is permissible and does not forfeit exact-match eligibility** — if Fusion exposes a way to set it. Whether it does is unverified. (High for the Snowflake semantics; unverified for Fusion's surface.)

### Operational constraints

`USE_CACHED_RESULT` is settable at account, user, and session level [26], so reuse cannot be assumed on. A second, distinct cache sits below it: a running warehouse caches table data, and "the cache is dropped when the warehouse is suspended" [27]. The same preview can therefore be fast, medium, or slow for reasons the extension neither sees nor controls. **Keep the two lexically distinct in code, docs, and logs — "result cache" and "warehouse data cache" — and never say "the Snowflake cache".** (High.)

Server-side latency decomposes into setup, compilation, scheduling, execution, and queueing [28], attributed per query id in `compilation_time`, `execution_time`, `queued_provisioning_time`, `queued_overload_time`, and `queued_repair_time` [29]. Use the `INFORMATION_SCHEMA.QUERY_HISTORY` table function for measurement; the `ACCOUNT_USAGE` view lags "up to 45 minutes" [29]. (High.)

`SYSTEM$CANCEL_QUERY` cancels a running statement by query id, and a user may always cancel their own [30]. Two independent server-side timeouts can terminate work the editor is waiting on [30]. **A preview that ends without rows is a normal outcome, not an exception path.** (High.)

The product boundary places Fusion between the extension and Snowflake, so every mechanism above is reachable only if Fusion exposes it. Whether it surfaces the query id, supports cancelling an in-flight preview, or allows setting a query tag is unverified. (High that it is unverified.)

## 4. Candidate cache and invalidation architecture

### The authority model: client publication epoch

The previous revision proposed a "server generation" the client maintained from filesystem events. That model is withdrawn. **A client-side counter derived from filesystem events cannot prove anything about a closed server's internal generation** — it can be advanced by a write the server ignored, and it can fail to advance for a change the server acted on. Filesystem-derived inference is exactly the wrong primitive against an opaque producer.

What replaces it is deliberately more modest and is honest about what it knows:

- **A client publication epoch.** The extension owns a monotonically increasing `publicationEpoch`. It is a client-side publication boundary and nothing more. It makes no claim about the server's internal state.
- **It advances on producer evidence only:** when a producer completes and publishes a new projection, or when a producer restarts. It does not advance because a file changed on disk.
- **Producer evidence is how every change class is covered.** Model `.sql` edits, new files, deletions, config changes, target selection changes, vars changes, and environment changes all reach the epoch the same way — the producer observes them, republishes, and the epoch advances. The client does not classify the change; the producer does. This is the substantive difference from the withdrawn model, and it is why the epoch is trustworthy at all.
- **Responses are accepted on exact match, with the version test scoped to what the request actually has.** Every response must carry a stamped `publicationEpoch` equal to the current epoch — no exceptions, and not "greater than or equal". **Document-scoped requests** — anything addressed to a `TextDocumentIdentifier`, such as hover, compiled SQL for a file, or document diagnostics — must additionally match the current version for that URI exactly. **Project-scoped requests** — project metadata, the node list, workspace-wide lineage — often have no URI and therefore no document version; for those the epoch is the whole test. Requiring a version where none exists would either block the request or invite a fabricated one, so the rule is stated by request scope rather than applied uniformly. A response failing its applicable test is discarded, not reconciled.
- **Immutable publication.** A completed projection becomes visible through one assignment of one frozen value, so no consumer observes a half-updated state. This is rust-analyzer's `AnalysisHost`/`Analysis` split, and the reason to copy it is auditability: exactly one place where state becomes visible [31].

Confidence: **Medium-High.** The publication and exact-match discipline are specification- and design-grounded [21][23][31]. The claim that the client cannot infer server generation from the filesystem is **High**. The specific coverage guarantees depend on the producer actually republishing on every class, which is a spike question.

### Where the epoch attaches in the current extension

The extension already has this seam, and it is verified in repository source rather than reported. `ManifestCacheProjectAddedEvent` is an interface declared in `src/dbt_client/event/manifestCacheChangedEvent.ts`, carrying the project handle and the eleven metadata maps plus `modelDepthMap`; it is delivered inside `ManifestCacheChangedEvent { added?, removed? }`; and `QueryManifestService` consumes it, keying `eventMap` by project root and serving panels through `getEventByCurrentProject()` and `getEventByDocument()` [43]. The publication path runs from the adapter's `MANIFEST_PARSED` event through `src/dbt_client/dbtProject.ts`, which builds the event and fires `_onManifestChanged` [43].

**Do not introduce a competing `ProjectSnapshot` interface.** A second seam doing the same job is the duplication this document argues against, and a migration that moves every consumer buys no behavioral change.

The proposal instead is to **add revision and epoch metadata to the existing interface**: stamp each publication with the epoch, the producer identity, and the producer's own revision token if it has one. Consumers that ignore the fields behave exactly as today; consumers that need staleness discrimination read them. This is strictly additive. (Medium-High — the seam and its consumer are verified; the specific field shape is a codebase decision outside this round.)

### What to cache, where

"Owner" is the component permitted to hold the value. Two prohibitions apply throughout, and they are narrower than the previous revision's:

1. **Do not recreate compiler truth.** The extension must not derive, infer, or reconstruct parse, compile, or schema results that a producer is responsible for.
2. **Do not persist derived compiler state to disk.** Memory only.

**Bounded in-memory retention of LSP responses and panel projections is permitted** and violates neither. Claims about who *owns* each cache at runtime, and any comparison of cache strength, are deferred to traces.

| Data                       | Key                             | Held by                                                | Invalidated by            | Persistence                      | Max staleness                              |
| -------------------------- | ------------------------------- | ------------------------------------------------------ | ------------------------- | -------------------------------- | ------------------------------------------ |
| Parsed project graph       | `publicationEpoch`              | Producer; extension holds a projection                 | Epoch advance             | None                             | Zero for structure; SWR for display labels |
| Artifact file identity     | `path + size + mtime_ns + hash` | Extension                                              | Any field differs         | Memory only                      | Zero — recompute per read                  |
| Per-document compiled SQL  | `epoch + uri + documentVersion` | Extension holds last response, bounded                 | Exact-match failure       | **Never on disk**                | Zero                                       |
| Column and schema metadata | Producer's key                  | Producer [10]                                          | Producer's TTL and guards | **Not on disk by the extension** | Producer's TTL                             |
| Lineage graph              | `epoch + focusNode + depth`     | Extension projection, bounded                          | Epoch advance             | None                             | SWR, bounded (section 6)                   |
| Diagnostics                | —                               | VS Code `DiagnosticCollection` via the language client | Server                    | None                             | **No second store**                        |
| Query results              | Snowflake result cache [25]     | Snowflake; extension holds the open tab's rows         | Tab close                 | **Not on disk**                  | Zero                                       |
| Rendered panel state       | `epoch` stamped into `setState` | Webview                                                | Epoch mismatch on restore | VS Code webview state            | Display-only, must revalidate              |

Three entries carry most of the weight.

**No second diagnostic store.** The language client already owns a `DiagnosticCollection`, and the protocol defines precedence between overlapping sources: "diagnostics for a higher document version should win over those from a lower document version" and "diagnostics from a document pull should win over diagnostics from a workspace pull" [24]. (High.)

**Query results are not persisted.** Snowflake's reuse is role-scoped and data-change-invalidated [25]; a local copy is neither, and it would place warehouse rows on disk. The defensible in-memory scope matches dbt's own extension: "results are stored until the tab is closed" [15]. (High.)

**Compiled SQL is held in memory only.** The engine already keeps a disk copy [9], and compiled SQL can embed literals, filters, and business logic. A bounded last-response cache per `(epoch, uri, documentVersion)` is cheap and self-invalidating. (High.)

### On a local result cache

**Recommendation: do not build one.** The previous revision offered a six-point "minimum conditions" checklist for a hypothetical opt-in cache. That checklist is deleted. It was never validated for completeness, it read as a design sanctioned by research, and an incomplete checklist for a security-relevant cache is worse than no checklist — it invites someone to satisfy six bullets and believe the problem solved. If a future product decision demands a local result cache, it requires its own security review, not a list recovered from a research document. (High.)

### The manifest question, restated

**The hazard is ambient watching, not artifact reading.** The evidence supports a narrower and more defensible position than the previous revision took.

What is established: the public writer truncates in place and streams, with no rename [8]; POSIX gives atomicity only to `rename()` [36]; a VS Code watcher event carries only a URI with no indication that a write completed [37]; and the current extension's target watcher is a 300 ms-debounced `fs.watch` whose parse failures are swallowed with the previous projection retained [39]. What is *not* established is how often this actually bites — nobody has measured it. **It is an unmeasured ambient-watcher race.** (Medium.)

What is also established, and cuts the other way: the owned rebuild path awaits `dbt parse` before reading [38], and a swallowed parse failure degrades to the previous projection or an empty result rather than to corrupted state [39][40]. Retrying mitigates partial reads. It does not establish freshness. (High.)

**ADR 0002 governs here, and its three artifact paths are preserved.** The ADR states that "Local panels will call dbt LSP commands first and read Fusion artifacts only where the protocol lacks required data" [44]. That leaves three legitimate artifact paths, and this document endorses all three:

1. **Safe post-command reads** — reading an artifact after a command the extension launched and awaited. This is the owned rebuild path, and it is sound [38].
2. **Documented capability-gap fallback** — reading an artifact for data the protocol genuinely cannot supply, with validated reads, recorded as a known gap rather than a default.
3. **Explicit prior-state imports** — a user-selected manifest for comparison against a prior production state, which is how dbt's own comparison feature works [15].

**Only one path is prohibited: ambient artifact watching.** No component should subscribe to `target/` and treat an arbitrary external write as a signal to republish project state.

**That prohibition is not independently actionable from this repository, and the recommendation has to respect that.** The entire watcher mechanism is private to `DBTProjectIntegrationAdapter` inside the published dependency — `createTargetFolderWatcher`, `handleTargetFileChange`, `startTargetWatchers`, `stopTargetWatchers`, `setupTargetWatchers`, `updateTargetWatchers`, and `disposeTargetWatchers` are all declared `private`, and no public setting or method disables the behavior [39]. This repository consumes the adapter as a dependency at `^0.3.13` [45]. Three executable options exist:

1. **Upstream dependency release** that removes the ambient watcher or exposes an opt-out, then a version bump here. Cheapest if the upstream is responsive; not unilaterally available.
2. **A maintained local fork** of the package. Only justified if the race is measured to be frequent *and* upstream will not move — it buys one deleted watcher at the cost of owning a dependency.
3. **Defer to adapter replacement or retirement.** The adapter is already slated to be displaced as project state moves to the language server, and the watcher disappears with it. This step is independently required for a different reason: the same adapter's constructor mandates a Cloud integration factory, so Cloud removal is gated on it too [45][46]. One retirement discharges both.

**Minimal recommendation: option 3 — defer until adapter retirement.** Do not patch `node_modules`: it is invisible to review, lost on every reinstall, and diverges the built artifact from the declared dependency. Until the adapter is retired, record the ambient path as a known constraint rather than an open action item, and let SP-B decide whether its measured rate justifies escalating to option 1 or 2. (Medium-High — the privacy of the members is verified [39]; the retirement timing is a plan question this document does not own.)

**Do not prefer feature loss to artifact reading before the protocol inventory exists.** The previous revision's "prefer adding a request over reading a file" advice was premature: until the server's payload surface is known, choosing to drop a feature rather than read an artifact trades a working capability for an unmeasured risk. Reassess after the inventory.

**Validated reads**, wherever an artifact is read: `stat` → read → `stat` again → compare `(size, mtime_ns)` → hash → parse. If the two stats differ, a writer was active; retry with backoff and surface a bounded failure rather than silently serving a partial parse. Treat a parse failure as "writer in flight", not "corrupt file". (Medium — a standard pattern, not a cited one.)

**Never write into the project's `target/` directory.** It is the engine's output directory [7], and an extension writing there risks clobbering artifacts the engine owns. Note that the previously stated mechanism for this prohibition — that a stray `target/` write would invalidate the engine's parse cache through mtime comparison and force the ~1.8 s full-parse class — is **withdrawn as unsupported**: the tracked path set is keyed by project resource paths, not the output directory [41]. The prohibition stands on ownership; the mechanism claim does not. (High for the prohibition; the withdrawn mechanism is noted so it is not resurrected.)

## 5. Recompile, lint, and edit lifecycle

### The governing principle

**The extension does not drive compilation. It observes it.** The server already compiles lazily on focus, cancels superseded compiles, runs a background pass, and reports progress [14]. Every extension-side trigger is redundant with that or competing with it for the server's queue.

### By event class

**Keystroke in an open document.** Do nothing. `vscode-languageclient` sends incremental `didChange` where the server advertises `TextDocumentSyncKind.Incremental` [23]; the server compiles lazily [14]. Do not debounce document synchronization. Do not refresh panels on keystroke.

**Save.** The refresh point for derived panels, matching dbt's own extension where "Compiled code will update as you save your source code" [15]. A small debounce to collapse formatter-triggered double saves is reasonable; pick the interval from the harness rather than asserting one.

**Focus change between documents.** Cancel outstanding panel requests for the previous document and issue fresh ones. The server does the same internally [14]. Do not prefetch for unfocused documents.

**Project config, package, or profile change.** These are the engine's full-parse classes [5]. Under the epoch model the client does not classify them — it waits for the producer to republish, and the epoch advances then. Show progress and render affected panels as unavailable rather than stale. How the server responds to these changes is a spike.

**Watched-file event on an artifact.** Do not republish project state from it, per section 4.

### The mechanics

**Debounce.** Only on extension-initiated derived work, never in front of a server-owned segment. Trailing edge, per `(uri, requestKind)`.

**Cancellation.** One `CancellationTokenSource` per in-flight panel request, cancelled on epoch advance, document version change, focus change, or panel disposal. Two error codes are ordinary control flow and must never reach the user: `RequestCancelled` (-32800) and `ContentModified` (-32801) — the spec is explicit that on `ContentModified`, clients "generally should not show it in the UI for the end-user" [21][22]. Where the server advertises pull diagnostics, `ServerCancelled` with `DiagnosticServerCancellationData` is a third, defaulting to `{ retriggerRequest: true }` [24].

The limit: cancellation is advisory, and the spec allows a server to ignore `$/cancelRequest` entirely [22]. **Cancellation bounds what the extension displays, not what the server spends.** (High.)

**Deduplication — deferred, not adopted.** The previous revision proposed building a singleflight utility in v1. That is withdrawn. `vscode-languageclient` already correlates requests to responses and manages cancellation, so the duplicate work a singleflight layer would suppress may not exist at all. **Build it only if SP-B or a trace shows measurable duplicate extension-initiated work.** The general pattern remains correct where it applies — "only one execution is in-flight for a given key at a time" [33] — and if it is ever needed, the key must include the epoch and the document version, because a key that omits either hands a caller a result computed against different state [34]. Speculative infrastructure for an unobserved problem is the thing this document argues against elsewhere; it would be inconsistent to exempt it here. (Medium-High.)

**Out-of-order responses.** The protocol warns clients to "avoid that clients apply outdated response results" [21], and document versions are the discriminator: they "increase after each change, including undo/redo" but need not be consecutive [23]. Apply the exact-match rule from section 4 — equal epoch always, plus equal per-URI version for document-scoped requests — or discard. Never assume response order matches request order.

**Crash recovery.** Restart the server on unexpected exit with a bounded budget; the spec cites VS Code's policy of not restarting after five crashes in 180 seconds [21]. A restart is producer evidence and advances the epoch.

Confidence for this section: **Medium-High**, with the LSP mechanics specification-grounded [21][22][23][24] and the save-versus-keystroke split grounded in dbt's documented behavior [15].

## 6. Failure, staleness, and security boundaries

### Three staleness classes

Assign every displayed value to exactly one class. The class, not the panel, decides the policy.

**Authoritative-only — stale display is a defect.** Diagnostics, compiled SQL, column types, schema information, and anything that will be used to generate SQL for execution. On epoch advance these become unavailable, not stale. Showing a previous publication's compiled SQL beside the current file invites the user to run SQL that does not match what they see. (High.)

**Display-tolerant — stale is acceptable when marked.** Model names, descriptions, tags, folder structure, lineage topology for orientation. These may be served from the previous publication under three conditions borrowed from RFC 5861: a bounded window, an explicit visible marker, and revalidation triggered by the request rather than a timer [35]. The hard stop applies too — "If delta-seconds passes without the cached entity being revalidated, it SHOULD NOT continue to be served stale" [35]. Choose the window from the harness.

**Forbidden-stale — no staleness at any duration.** Warehouse query results, credentials, anything role-scoped. Snowflake's reuse is role-gated [25] and the extension cannot evaluate privileges. (High.)

### Failure modes and required behavior

| Failure                                      | Required behavior                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Server not started, or crashed               | Panels show "project not ready" with a restart action. Bounded restart budget [21].                                           |
| Server slow or background compile incomplete | Show progress; the server reports it [14]. A node may legitimately have no results yet [14] — say "compiling", not "no data". |
| `ContentModified` / `RequestCancelled`       | Swallow; re-issue if still wanted [21][22]. Never surface.                                                                    |
| `ServerCancelled` on a diagnostic pull       | Honor `retriggerRequest`, defaulting to `true` [24].                                                                          |
| Artifact read fails validation               | Retry with backoff; surface a bounded failure. Never parse a file whose stats changed mid-read [8][36].                       |
| Snowflake statement or queue timeout         | Present as a normal terminal state with the phase breakdown, not an error [30].                                               |
| Warehouse suspended, cold resume             | Expect `queued_provisioning_time` in the phase breakdown [29]; do not attribute it to the extension.                          |

### Product authentication semantics, corrected

The previous revision claimed a "no-account" boundary that already forecloses `strict` static analysis. That reading was too strong and is corrected here.

**What the boundary actually forbids is an extension-specific account and any licensing bypass.** It does not, by itself, forbid a user from running `dbt login` with their own dbt platform credentials. Whether the product supports, ignores, or discourages a user-owned login is **a product decision that has not been made**, not a constraint already settled by the boundary. This document does not make it. (High that the two are different questions; the decision itself is out of scope.)

What the evidence does fix is the capability matrix, which the decision should be made against:

| Mode                 | Authentication            | Warehouse schema download | Capabilities gained                                                                                                                 |
| -------------------- | ------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `off`                | None                      | No                        | SQL analysis skipped for the model and its descendants [17]                                                                         |
| `baseline` (default) | None                      | No [17]                   | Jinja/YAML/SQL syntax diagnostics, ref and source navigation, table-level lineage, ref autocomplete [15]                            |
| `strict`             | Requires `dbt login` [17] | Yes [17]                  | Adds column-level lineage, SQL type and schema diagnostics, column go-to-definition, `select *` hover expansion, column rename [15] |

**Effective-mode detection matters more than the configured mode.** Because "Unauthenticated runs fall back to `baseline`" [17], a project configured for `strict` can silently run as `baseline`, and every column-level feature will be absent for a reason the UI does not explain. The extension should determine and display the *effective* mode rather than echoing configuration, so that "column lineage is missing" resolves to an explanation rather than a bug report. How to detect it is a spike. (High for the requirement; the detection method is unverified.)

### Security and privacy boundaries

**Never persist:** credentials or tokens; environment variable values; warehouse result rows; compiled SQL. Each of the last three can carry business logic or regulated data. Persisting any of them requires an explicit, documented product decision covering location, encryption, and deletion — not a default. (High, as a policy position.)

**Environment handling.** Three environments are distinct: the extension host's, the spawned server's, and the user's terminal. dbt documents that "VS Code does not inherit variables set by the VS Code terminal or external shells" and that the terminal does not inherit extension configuration [16]. An env-var change is also an engine full-parse trigger, detected by comparing values at load time [5], so env handling is a correctness concern and not only configuration. (High.)

**Never write into the project's `target/`.** It is the engine's output directory [7]. (High; see section 4 for the withdrawn mechanism claim.)

**Local logs are not telemetry, but they are still data.** Redact identifiers; never log compiled SQL bodies, query text, or result rows at default verbosity. The engine itself can write a local query log and an OpenTelemetry parquet file into `target/` [7]; the extension should neither read nor ship those without an explicit decision. (High.)

## 7. Existing literature and comparable systems

Patterns transfer with stated limits. The limits matter as much as the patterns, because this extension is a *client of* a language server rather than a language server itself, so several standard techniques apply only in weakened form.

**Immutable snapshots over a revision counter (rust-analyzer).** "`AnalysisHost` is a state to which you can transactionally `apply_change`. `Analysis` is an immutable snapshot of the state." Salsa "maintains a global revision counter"; when bumped, in-flight computation unwinds, and "`ide` is the boundary where the panic is caught and transformed into a `Result<T, Cancelled>`" [31].

*Transfers:* the host/snapshot split and the single designated boundary where cancellation becomes an ordinary result. *Does not transfer, and this is the sharpest limit in the whole section:* rust-analyzer's counter is authoritative because rust-analyzer owns the computation. This extension does not own the producer's computation and cannot observe its internal revision, which is exactly why section 4 proposes a client *publication* epoch rather than a mirrored generation. A client counter that looks like salsa's revision but is derived from filesystem events has the shape of the pattern without its guarantee. (High.)

**Invalidation, not caching, is the hard part (gopls).** gopls "needs to be able to map files to packages efficiently, so that when files change it knows which packages need to be updated (along with any other packages that transitively depended on them)", made "especially difficult by the fact that changing the content of a file can modify which packages it is considered part of" and that "changes can be made to files without using the editor, in which case it will not notify us of the changes" [32].

*Transfers:* both hazards. A dbt edit can change which nodes a file defines and invalidate more than that file — which is why the engine classifies a `.yml` change as a full reparse [5]. Out-of-editor changes are the norm in dbt work, and they are the reason the epoch advances on producer evidence rather than client inference. *Limit:* Go's package graph is not dbt's DAG. (High.)

**Duplicate-call suppression (Go x/sync singleflight).** "only one execution is in-flight for a given key at a time" [33]. *Status here: deferred.* See section 5 — `vscode-languageclient` already correlates and cancels, so the pattern is recorded as available rather than adopted. *Limit if adopted:* correct only when the key fully determines the result. (High.)

**Content-addressed action caching (Bazel).** An action cache mapping "action hashes to action result metadata" plus "a content-addressable store (CAS) of output files" [34].

*Transfers:* mainly as a warning. Bazel documents both classic failures — an incomplete key that omits environment ("environments with different `$PATH` variables won't share cache hits") and inputs mutating mid-operation [34]. *Limit, and it needs stating carefully:* **do not build a compile cache in the extension** — not because the engine's cache is stronger, but because the engine already owns compile invalidation and its key incorporates inputs a client does not observe, including config-file content hashes and the engine's own binary version [5][6]. Note that the engine's cache is **not** content-addressed in Bazel's sense; it is keyed on paths, mtimes, and content hashes of specific config inputs. The Bazel lesson that transfers is the incomplete-key failure mode: a client key built from what the client can see would omit inputs that change the answer. (High.)

**Stale-while-revalidate (RFC 5861).** A cache "MAY serve the response in which it appears after it becomes stale, up to the indicated number of seconds"; it "SHOULD attempt to revalidate it while still serving stale responses (i.e., without blocking)"; staleness must be visible; after the window "it SHOULD NOT continue to be served stale" [35]. *Transfers:* as the exact shape for display-tolerant data. *Limit:* a policy for cacheable representations, not authoritative state. (High.)

**Atomic publication (POSIX).** `rename()` guarantees that "a directory entry named new shall remain visible to other threads throughout the renaming operation and refer either to the file referred to by new or old before the operation began", and the rationale states the action must be atomic [36]. *Transfers:* as the standard the extension should hold itself to for any file it publishes, and as the diagnostic that identifies the public manifest writer as unsafe for a concurrent ambient reader [8]. *Limit:* atomicity of visibility is not durability, and `rename()` fails across file systems. (High.)

## 8. Empirical spikes required for the unknowns

The previous revision listed nine spikes. That program was larger than the decisions it served and duplicated work already recorded. **This program is reduced to three pre-migration spikes plus two that are scheduled only when dependent work arrives.**

**Reconcile before running.** The existing spike **S2** and the already-recorded `initialize` capability capture cover part of this ground. Do not re-capture `initialize` or re-derive capabilities that are already written down; extend the existing record instead. The spikes below are scoped to what those do *not* already answer.

### Privacy rules that apply to every spike

These are conditions of running, not suggestions.

- **Synthetic fixtures only for verbose LSP traces.** Verbose tracing captures document contents, hover payloads, and completion context. Run it against synthetic projects, never a real customer or production project.
- **Redact before persisting.** Strip document bodies, SQL text, and identifier values at capture time, not at review time. Persist method names, timings, sizes, and outcomes.
- **No SQL or result payload retention.** Query text and result rows are never written to a spike artifact.
- **Query IDs are transient join keys only.** A Snowflake query id exists to correlate a client-side timing record with a `QUERY_HISTORY` row during a single run. It identifies a specific statement executed by a specific user against a specific account, so it is an identifier, not a metric. Hold it in memory for the duration of the join, then either discard it or replace it with an irreversible hash — a keyed hash over the id, with the key discarded at the end of the run — before anything is written to disk. **No raw query id reaches a persisted artifact, a log, or the measurement harness.**
- **Explicit opt-in for anything touching an account or warehouse.** SP-D and SP-E require the operator's explicit, per-run consent, and must name the account and warehouse in the consent prompt.
- **Storage and deletion policy.** Spike artifacts live in one declared directory outside any project's `target/`, are excluded from version control, and are deleted when the spike's decision is recorded. State a retention limit before the first run.

### Pre-migration spikes

**SP-A — Minimum command payload trace.** *Unknown:* the request and response payload shapes for the specific operations the migration depends on — not a complete method inventory. *Procedure:* against a synthetic fixture, with S2's `initialize` record already in hand, exercise only the flows the migration needs: open a model, request compiled SQL, request lineage, and request whatever supplies node metadata. Record method name, direction, and redacted payload shape. *Output:* a payload contract for the migrated operations. *Unblocks:* the metadata migration, which cannot be specified without it.

**SP-B — Target mutation under the server, and the real ambient-watcher rate.** *Unknown:* whether the server writes `target/` artifacts, and how often the ambient-watcher race actually fires [8][39].

*Procedure, part one — artifact mutation.* Snapshot `mtime_ns`, size, and hash of `target/manifest.json` and `target/compiled/**`; run a fixed editing session with no terminal commands; re-snapshot on an interval.

*Procedure, part two — the race rate, and this is where the previous revision's method was wrong.* A tight reader loop against a parse loop measures **writer vulnerability** — how wide the non-atomic write window is — and nothing about what the extension experiences. The extension does not poll; it reacts to `fs.watch` through a 300 ms debounce [39]. **The measurement must exercise the real adapter, or faithfully reproduce its timing:** the same non-recursive `fs.watch` registration, the same 300 ms trailing debounce, the same single read per settled burst. Drive it with genuine external commands — `dbt parse`, `dbt run`, a branch switch — at realistic spacing, not a loop. Count settled-burst reads, parse failures, and skipped publications, and report the rate per external-command class and per project size. Report the tight-loop number too if part one produced one, but label it **writer vulnerability**, not race rate; the two differ by orders of magnitude and conflating them would overstate the case for removal.

*Output:* whether the server writes artifacts; a writer-vulnerability window; and a separately-labeled watcher-experienced race rate. *Unblocks:* converts the ambient-watcher race from unmeasured to measured, and decides whether escalating past "defer to adapter retirement" is warranted. Also the natural place to observe duplicate extension-initiated work, which gates the deferred singleflight decision.

**SP-C — Config-change behavior.** *Unknown:* what the server does when a full-parse-class file changes [5]. *Procedure:* with the server running, make a semantically neutral change to `dbt_project.yml`, then to `profiles.yml`, then rewrite `package-lock.yml` via `dbt deps`. After each, record whether the server reparses, restarts, errors, or does nothing, and how long until results are correct. *Output:* the producer-evidence event list. *Unblocks:* the epoch model's coverage claims, which currently rest on the producer republishing for every class.

### Deferred spikes — schedule before dependent Phase 7 work only

**SP-D — Snowflake query identity and phases.** *Requires explicit opt-in.* *Unknown:* whether a preview surfaces a query id, whether a query tag can be set through Fusion, and what the phase breakdown looks like [25][29][30][42]. *Procedure:* run the same preview on a cold warehouse, a warm warehouse, an identical repeat for result reuse, and a repeat with `USE_CACHED_RESULT = FALSE`; read `query_id`, `compilation_time`, `execution_time`, and the queue columns from `INFORMATION_SCHEMA.QUERY_HISTORY`. Record whether the extension can obtain the query id at all. Use the query id in memory only, as the join key between the client timing record and the history row; **discard it or substitute an irreversible hash before writing anything down.** Retain timings; retain no query ids, SQL text, or rows. *Output:* per-phase distributions, a yes/no on query-id availability, and a yes/no on tag control. *Unblocks:* preview cancellation and per-phase attribution.

**SP-E — `static_analysis` mode cost, capability, and effective-mode detection.** *Requires explicit opt-in; touches an account.* *Unknown:* the real latency delta between `baseline` and `strict`, and how to detect that a `strict` configuration silently fell back [17]. *Procedure:* run the same synthetic fixture in both modes; measure cold start, first diagnostic, and first hover; record which features degrade; then run configured-`strict` without authentication and record every observable signal of the fallback. *Output:* the capability matrix in section 6 with measured latencies, plus a detection method. *Unblocks:* the product decision on user-owned `dbt login`, and honest UI for absent column-level features.

### Measurement harness

Instrumentation produces no telemetry. Emit structured records to a dedicated output channel and, behind an explicit setting, to a local JSON-lines file under the extension's storage URI — never into a project's `target/` [7].

Each record carries the segment name from section 1, monotonic start and end timestamps, the publication epoch, the document version, the request kind, and the outcome (`ok`, `cancelled`, `contentModified`, `error`). Redact URIs to workspace-relative paths. Never record SQL text or result rows.

Fixtures: three synthetic sizes — roughly 50, 500, and 5,000 nodes — so results can be read against the engine's own `scale_6k` figures [5]. Scenarios: cold start; warm start; single-keystroke edit; save; focus switch; config change. Warehouse scenarios belong to SP-D and inherit its opt-in. Report per-segment p50 and p95 over at least twenty runs, and treat the first measured run as the baseline from which targets are derived.

## 9. v1 bounded changes versus the v2 target

### v1 — during the current refactor

The constraint is to add correctness infrastructure that does not lock in the current producer and does not duplicate server state. Four changes, each landable independently.

1. **Add a publication epoch and stamp it on the existing consumer seam.** Advance the epoch when a producer publishes or restarts. Stamp `ManifestCacheProjectAddedEvent` with the epoch, producer identity, and any producer revision token [43]. Additive; existing consumers are unaffected. **Do not introduce a parallel snapshot interface.** *Confidence: Medium-High.*

2. **Adopt exact-match response acceptance.** Apply a response only when its stamped epoch equals the current epoch, and — for document-scoped requests only — its document version equals the current version for that URI. Project-scoped responses carry no URI and are gated on the epoch alone. Small, testable, independent of which producer is behind it. *Confidence: High.*

3. **Record the ambient target watcher as a known constraint; do not try to remove it in v1.** The watcher is private to the published adapter and cannot be disabled from this repository [39][45], so the only v1-shaped actions are to document the constraint, keep the awaited-parse-then-read path that is sound [38], keep explicit prior-state imports, and add no new ambient watching of our own. **Do not patch `node_modules`.** Removal rides along with adapter retirement; escalate to an upstream release or a fork only if SP-B measures a rate that justifies it. **When the removal does happen, justify it as eliminating an ambient stale-and-race path and a source of unexplained refreshes — not as proof that every artifact read is broken.** *Confidence: Medium-High.*

4. **Land the measurement harness and synthetic fixtures.** Without it every later change is unfalsifiable. *Confidence: High.*

Explicitly **not** in v1: a singleflight layer (deferred to SP-B evidence); any disk-persisted derived state; any extension-side compile, schema, or result cache; any numeric performance target; any new consumer seam.

### v2 — after measurement

1. **Migrate metadata to the server using SP-A's payload contract,** keeping the existing consumer seam so panels do not move.

2. **Retire the manifest-derived producer once the migration covers its consumers,** at which point its metadata maps become dead.

3. **Keep artifact reading in the three sanctioned paths** [44] — safe post-command reads, documented capability-gap fallback with validated reads, and explicit prior-state imports — in one narrow module rather than spread across consumers.

4. **Rebuild query execution around Fusion's execution path with Snowflake-native reuse.** Keep submitted SQL deterministic so exact-match reuse stays reachable [25]; a stable comment is acceptable and a per-submission varying one is not; a `QUERY_TAG` is acceptable if Fusion exposes it [42]. Surface the phase breakdown [29], and treat any query id as a transient join key that is displayed or discarded rather than persisted. Add no result cache.

5. **Adopt display-tolerant stale-while-revalidate where the harness shows it pays,** with visible staleness and a bounded window [35].

**Order of removal:** the manifest-derived producer (v2, after SP-A); its metadata map layer (v2, immediately after); the ambient target watcher, which goes when the adapter that owns it is retired rather than as a standalone step [39]; and any ad-hoc per-panel refresh timers (v2, replaced by epoch invalidation).

## 10. Proposed plan deltas — not applied

Proposals against the plan as described in the dispatch. Nothing here has been written into the plan.

**D1 — Correct the Cloud blocker: it is the external adapter, not Fusion's parent class.** Two changes to the plan's premise, and they point in opposite directions, so state both. The inheritance claim is wrong — the published declaration extends `DBTBaseProjectIntegration` [38] and `src/inversify.config.ts` constructs it directly with no Cloud type in the chain [45] — so "reparent Fusion off Cloud" is not a task that exists. **But Cloud removal is still blocked**, because `DBTProjectIntegrationAdapter`'s constructor requires a Cloud integration factory as a mandatory positional parameter [46], and this repository supplies it [45]. Retarget the plan to this order: **first retire or replace the external adapter — which also disposes of its private ambient manifest watcher [39] — then delete Cloud's construction, bindings, factory, and remaining code.** Do not record Cloud deletion as immediately available or as mere binding cleanup. *Basis: [38][39][45][46]. Confidence: High for the blocker and the order; Medium for step-two scope.*

**D2 — Reframe the manifest work, and record that the watcher is not independently removable.** Preserve ADR 0002's three artifact paths [44] and prohibit new ambient watching. But the existing ambient watcher lives in private members of the published adapter [39], so it cannot be deleted from this repository: the plan should carry it as a constraint discharged by adapter retirement, not as a standalone deletion task, and should rule out patching `node_modules`. *Basis: [8][36][38][39][44][45]. Confidence: Medium-High.*

**D3 — Add a publication epoch to the existing consumer seam.** Stamp `ManifestCacheProjectAddedEvent` in `src/dbt_client/event/manifestCacheChangedEvent.ts`, which `QueryManifestService` already consumes [43]. Name the epoch, its advance-on-producer-evidence rule, and the acceptance rule — exact epoch always, exact document version only for document-scoped requests. Do not add a new interface. *Basis: [21][23][31][43]. Confidence: Medium-High.*

**D4 — State the two narrow cache prohibitions in the plan:** do not recreate compiler truth, and do not persist derived compiler state to disk. Justify them by producer responsibility for invalidation [5][6][9][10], not by any claim that the engine's caches are stronger than a client's could be. Record that bounded in-memory LSP responses and panel projections are permitted, and that runtime ownership claims await traces. *Basis: [9][10][25]. Confidence: Medium-High.*

**D5 — Insert the reduced spike block before the metadata migration step,** reconciled with S2 and the recorded `initialize` capabilities rather than duplicating them. SP-A in particular gates the migration. Schedule SP-D and SP-E only before dependent Phase 7 work. *Basis: [4]; section 8. Confidence: High.*

**D6 — Record `static_analysis` mode as an open product decision with a capability matrix,** not as a settled consequence of the product boundary. The boundary forbids an extension-specific account and licensing bypass; a user-owned `dbt login` is a separate, unmade decision [17]. Include effective-mode detection as a requirement so missing column-level features are explained rather than reported as bugs. *Basis: [15][17]. Confidence: High.*

**D7 — Add the measurement harness as a prerequisite to any performance step,** and remove any numeric target not derived from it. *Basis: section 8. Confidence: High.*

**D8 — Add a "never write to the project `target/`" constraint on ownership grounds.** Do not attach the withdrawn mtime-invalidation rationale to it [41]. *Basis: [7][41]. Confidence: Medium-High.*

## 11. Confidence limits

**Public source is a prior about a binary nobody here has instrumented.** Every source-derived claim describes `dbt-labs/dbt-core@v2.0.5` [1][2]. Whether the distributed binary executes identical paths is unverified, and **any behavior that would change the plan must be reproduced against the pinned binary first.** This is the single most important limit in the document, and it applies to the parse cache [5][6], the compiled-SQL cache [9], the schema store [10], and the manifest writer [8] alike.

**The language server is closed source [4].** Every claim about its protocol surface comes from dbt's feature documentation [14][15][16], which describes behavior rather than methods. **No Fusion LSP method name appears in this document, and none should appear in a design until SP-A extends the recorded payload contract.** Engine behavior is a prior on server behavior, never a statement about it; the phrase "the LSP owns X" does not appear here for that reason.

**The ambient-watcher race is unmeasured.** The mechanism is well-evidenced [8][36][39], and the frequency is not. SP-B exists to measure it. The v1 recommendation to delete the watcher is justified on design grounds — an ambient path that republishes on arbitrary external writes and silently retains a previous projection on failure — and not on a claim that it fails often. If SP-B shows the race is rare, the deletion remains worthwhile for the ambient-staleness reason alone, but the justification should be stated that way.

**The performance figures are the vendor's.** The ~10 ms / ~500 ms / ~1.8 s / ~7.5 s classes come from the engine authors' module documentation, measured on their `scale_6k` fixture on unstated hardware [5]. Reliable as *relative* classes, unreliable as absolute numbers. The "up to 30x faster" claim [15] is marketing and is not used.

**Snowflake evidence is strong about Snowflake and indirect about this product.** All Snowflake claims come from current vendor reference documentation [25][26][27][29][30][42]. Whether the extension can see a query id, set `QUERY_TAG`, or cancel a statement depends entirely on what Fusion exposes. SP-D addresses this.

**Package and repository evidence are now separated and both verified.** The class hierarchy, the target watcher's private members, the rebuild and read paths, and the adapter constructor signature come from `@altimateai/dbt-integration@0.3.13` [38][39][40][46]. The construction sites, the declared dependency range, the event interface, and its consumer come from this repository's own source [43][45]. The earlier caveat that the seam was dispatch-supplied no longer applies; it is cited from file and symbol.

**One conclusion in this document was wrong in an earlier revision and is worth naming rather than quietly fixing.** Disproving Fusion's inheritance from Cloud was read as unblocking Cloud deletion. It does not: the external adapter's constructor requires a Cloud factory [46], so the blocker moved rather than disappeared. The general lesson is that a refuted premise does not license the conclusion it was supporting — the conclusion has to be re-derived, and here the re-derivation produced the same ordering constraint through a different mechanism. What remains genuinely open is the full extent of Cloud code beyond the container wiring, and when adapter retirement is scheduled; both are plan questions rather than evidence questions.

**The comparable-system analogy that weakens most on transfer is rust-analyzer's revision counter**, because it is authoritative only for a system that owns its own computation [31]. That is precisely the mistake the previous revision made, and it is why section 4 now proposes a client publication epoch with explicit limits rather than a mirrored generation.

**Not verified by execution.** No spike has been run. Nothing here was tested against a live Fusion 2.0.5 binary, a live language server, or a live Snowflake account. Every claim is documentary, source-derived, or package-derived. That is the boundary of this research.
