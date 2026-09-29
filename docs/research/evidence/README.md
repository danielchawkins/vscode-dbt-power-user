# Fusion lineage and native editor features: consolidated evidence

**Scope:** dbt Fusion 2.0.6, `/Users/daniel/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.6/dbt`, sha256 `9fc5cd633558235a5eb4e265b5fea2aa8dbb4eb803a5e13872e6e80a5bbd4c15`. Darwin 25.5.0 arm64, DuckDB, the four-model fixture in `scripts/evidence/fixture/`. Captured 2026-09-26.

**Reproducing:** `DBT_BIN=<abs dbt> scripts/evidence/run.sh <experiment> <out-root>` runs every command under `env -i` with only the variables listed per step. `scripts/evidence/README.md` describes the harness.

**Sources used besides runs:**

- [About flags](https://docs.getdbt.com/reference/global-configs/about-global-configs?version=2) and [About static analysis](https://docs.getdbt.com/docs/build/about-static-analysis?version=2).
- The open-source Fusion crates at `~/references/dbt-fusion`, commit `9977b6c` (2026-06-04). That is older than the 2.0.6 binary, so a source statement is evidence about the open crates, not proof about the binary.

The earlier per-area write-ups in this folder are kept as run records only. Where they conflict with this document, this document wins; see [Superseded premises](#superseded-premises).

## 1. How configuration reaches Fusion

### Environment variables

- **The documented prefix is `DBT_ENGINE_`.** The docs say: "v1.10 and earlier use the `DBT_` prefix, while v1.11+ uses the `DBT_ENGINE_` prefix", with precedence CLI option → environment variable → `dbt_project.yml` → `user_settings.yml` → default. Their flag table has no environment variable for `generate_info_schema` or `info_schema_dir` ("—"), and does not list `static_analysis` at all.
- **Source: aliasing.** `crates/dbt-main/src/vars.rs` `apply_engine_env_var_aliases()` copies `DBT_ENGINE_<X>` to `DBT_<X>` for a fixed list (`ALIASABLE_ENV_VARS`, which includes `DBT_STATIC_ANALYSIS`, `DBT_PROFILES_DIR`, `DBT_TARGET_PATH`), but only when `DBT_<X>` is unset. It runs from `main_impl.rs` before CLI parsing. `validate_engine_env_vars()` rejects unknown `DBT_ENGINE_*` names.
- **Source: help text.** Clap binds `--static-analysis` to `DBT_STATIC_ANALYSIS` for the CLI subcommands (`crates/dbt-clap-core/src/lib.rs`). `dbt lsp --help` shows no `[env: …]` binding for `--static-analysis`. `dbt compile --help` shows `[env: DBT_STATIC_ANALYSIS=]`.
- **The operator shell:** it exports `DBT_ENGINE_PROFILES_DIR=~/.dbt`. The harness therefore sets `DBT_ENGINE_PROFILES_DIR` to the fixture and also passes `--profiles-dir`.

### `static_analysis` for the CLI: experiment `m1-static-analysis-sources`

**Signal:** `models/probe_strict.sql` = `select no_such_column from {{ ref('stg_orders') }}`, compiled with `dbt compile --profiles-dir <P> -s +probe_strict [flags]` and no `--generate-info-schema`. Only strict analysis resolves columns, so `[error] [UnresolvedIdentifier (dbt0227)]: No column no_such_column found` with exit 1 means strict was in effect. All steps set `FUSION_POWER_USER_SCHEMA_ORIGIN=local`.

| Step | CLI flag                     | Environment                                                      | `dbt_project.yml` addition                                              | Exit | dbt0227 |
| ---- | ---------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ---- | ------- |
| 02   | —                            | —                                                                | —                                                                       | 0    | no      |
| 03   | `--static-analysis baseline` | —                                                                | —                                                                       | 0    | no      |
| 04   | `--static-analysis strict`   | —                                                                | —                                                                       | 1    | yes     |
| 05   | —                            | `DBT_ENGINE_STATIC_ANALYSIS=strict`                              | —                                                                       | 1    | yes     |
| 06   | `--static-analysis baseline` | `DBT_ENGINE_STATIC_ANALYSIS=strict`                              | —                                                                       | 0    | no      |
| 07   | —                            | `DBT_STATIC_ANALYSIS=baseline DBT_ENGINE_STATIC_ANALYSIS=strict` | —                                                                       | 1    | yes     |
| 08   | —                            | —                                                                | `models: lineage_probe: +static_analysis: strict`                       | 1    | yes     |
| 09   | `--static-analysis baseline` | —                                                                | same as 08                                                              | 0    | no      |
| 10   | —                            | `DBT_ENGINE_STATIC_ANALYSIS=baseline`                            | same as 08                                                              | 0    | no      |
| 11   | —                            | —                                                                | `flags: static_analysis: strict`                                        | 0    | no      |
| 12   | —                            | —                                                                | `+static_analysis: baseline` on the project, `strict` on `probe_strict` | 0    | no      |

What these rows show, in this fixture with this binary:

- **Where strict can be set:** the CLI flag (04), `DBT_ENGINE_STATIC_ANALYSIS` (05), and model config in `dbt_project.yml` (08) each turned strict on.
- **Precedence:** the flag overrode both the environment variable (06) and model config (09), and the environment variable overrode model config (10). That matches the documented order.
- **Two variables set at once:** with `DBT_STATIC_ANALYSIS=baseline` and `DBT_ENGINE_STATIC_ANALYSIS=strict`, the result was strict (07). The aliasing source copies only when `DBT_<X>` is unset, so it predicts baseline here; the observed result does not match that prediction. The mechanism is not established.
- **`flags: static_analysis: strict`** in `dbt_project.yml` did not enable strict (11). The docs' flag table does not list `static_analysis`.
- **Strict on a child under a baseline parent** did not take effect (12). This matches the documented rule that "a model can't be stricter than its parents".

### `static_analysis` for the language server: experiment `m2-lsp-static-analysis-sources`

Each session starts on an empty `target/` and runs `steps/editor-features.json`. Server argv: `<dbt> lsp --socket <port> --project-dir <P> --profiles-dir <P> --lint-enabled false --no-version-check --command-prefix "" --log-level-file trace --otel-file-name <file> [flag]`. Environment: `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1`, plus the listed variable.

| Step | Flag                         | Environment                         | `dbt_project.yml` addition                        | hover on `*` | references on alias `total` | rename of `total` |
| ---- | ---------------------------- | ----------------------------------- | ------------------------------------------------- | ------------ | --------------------------- | ----------------- |
| 02   | —                            | —                                   | —                                                 | `null`       | `null`                      | `null`            |
| 03   | `--static-analysis strict`   | —                                   | —                                                 | column table | 2 locations                 | edits in 2 files  |
| 04   | —                            | `DBT_ENGINE_STATIC_ANALYSIS=strict` | —                                                 | `null`       | `null`                      | `null`            |
| 05   | —                            | —                                   | `models: lineage_probe: +static_analysis: strict` | column table | 2 locations                 | edits in 2 files  |
| 06   | `--static-analysis baseline` | —                                   | same as 05                                        | `null`       | `null`                      | `null`            |

- **What enabled strict:** the flag (03) or model config in `dbt_project.yml` (05). The environment variable did not (04), which is consistent with the language server's `--static-analysis` having no env binding in its help text.
- **Precedence:** the flag overrode model config (06).
- **Consequence for the extension:** it always passes `--static-analysis` (`buildFusionLspArgs`, from `fusionPowerUser.staticAnalysis`, default `baseline`). So as the extension is written today, a project's own `+static_analysis: strict` is overridden by the extension's `baseline`.

## 2. Strict analysis without `dbt login`

**The docs say:** "Any run that uses `strict` mode requires authentication using `dbt login`, whether `strict` is set with the `--static-analysis strict` CLI flag or in `dbt_project.yml`. Unauthenticated runs fall back to `baseline`."

**What the code and binary show:**

- **Open source:** the licence hook is a trait with only a no-op implementation, `LicenseFetcher` / `NoOpLicenseFetcher` in `crates/dbt-login/src/license_fetcher.rs`. `LicenseError = 1068` in `crates/dbt-error/src/codes.rs`. `rg` finds no caller of either and no code that downgrades strict when unauthenticated. The one unconditional override is in `crates/dbt-clap-core/src/lib.rs`, which forces `Strict` when `local_execution_backend != Remote`. `CHANGELOG.md` records "Implement licensing for strict static analysis".
- **Shipped binary:** `strings` on the 2.0.6 binary finds licence code the open crates do not have:
  - the variables `DBT_LICENSE`, `DBT_SKIP_REMOTE_LICENSE`, `DBT_LICENSE_USE_KEYCHAIN`, `DBT_LICENSE_REFRESH_WINDOW_SECONDS`, `DBT_TRIAL_LICENSE_URL` and `DBT_CLIENT_INSTALL_DATE`;
  - the endpoint `https://cloud.getdbt.com/api/private/trial-licenses/`;
  - the keychain service `com.dbt.licensing`;
  - the messages "Trial license retrieved", "Your 14-day trial has ended. Sign up for a free dbt platform account to unlock premium features", "No platform credentials found, skipping remote license", "Trial license expired for this machine (403)", and "Continuing without dbt platform. Strict static analysis will be unavailable."

  Where each is used is not visible from strings.

**Recorded runs:** experiment `m3-strict-authentication`, signal dbt0227 as in M1.

| Step | Environment beyond the base                                          | Result                                                 |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| 02   | —                                                                    | `dbt login status`: `Status: unauthenticated`          |
| 03   | —                                                                    | strict compile: exit 1, dbt0227                        |
| 04   | `HOME=<out>/empty-home`                                              | `dbt login status`: `Status: unauthenticated`          |
| 05   | `HOME=<out>/empty-home`                                              | exit 1, dbt0227                                        |
| 06   | `HOME=<out>/empty-home DBT_SKIP_REMOTE_LICENSE=1`                    | exit 1, dbt0227                                        |
| 07   | `HOME=<out>/empty-home DBT_CLIENT_INSTALL_DATE=2024-01-01`           | exit 1, dbt0227                                        |
| 08   | `HOME=<out>/empty-home DBT_CLIENT_INSTALL_DATE=2024-01-01T00:00:00Z` | exit 1, dbt0227                                        |
| 09   | —                                                                    | the empty HOME afterwards contains only `.dbt/leases/` |

`security find-generic-password -s com.dbt.licensing` found no keychain item. No compile output or `logs/dbt.log` line mentions a licence or trial.

**What this establishes:** on this machine, with `dbt login status` reporting unauthenticated, strict analysis took effect in every run. That held with the real HOME and with an empty one, with remote licence fetch skipped, and with a backdated install date.

**What it does not establish:** whether this is intended (a trial or grace window), a gap in 2.0.6, or behaviour that a later release or a network call will change. The `DBT_CLIENT_INSTALL_DATE` values may not be in the format the binary expects. For the extension this is a product risk: the shipped plan depends on strict. It should detect a fall-back to baseline at run time rather than assume strict is available. See the open questions in [column-lineage-ship-plan.md](../../refactor/column-lineage-ship-plan.md).

## 3. Writing column lineage

Every result in this section comes from runs where strict was set with the flag (`--static-analysis strict`), which section 1 shows is effective.

| Claim                                                                                                                                                                                                                                                                                                                                      | Evidence                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `dbt compile --static-analysis strict --generate-info-schema` writes `target/private/metadata/compile/column_lineage/v1_0.parquet` and `target/info_schema/v1/dbt.column_lineage.parquet`, 32 rows                                                                                                                                         | c1/02                                                |
| The same compile without `--generate-info-schema` writes neither                                                                                                                                                                                                                                                                           | c1/04                                                |
| `--generate-info-schema` under baseline or off writes the info schema but no lineage, with warning `dbt1000 … column types will not be populated without --static-analysis strict`                                                                                                                                                         | c1/06, 08                                            |
| `compile`, `build` and `run` wrote lineage with both flags; `parse` and `list` did not, including with `DBT_ENGINE_STATIC_ANALYSIS=strict` (they have no `--static-analysis` flag)                                                                                                                                                         | c2/02–17 (rerun 2026-09-26 with the documented name) |
| `FUSION_POWER_USER_SCHEMA_ORIGIN=remote` with a source table dropped fell back to `static_analysis: off` for the dependent model (dbt1014); `local` did not                                                                                                                                                                                | c5/11, c5/13                                         |
| No `dbt lsp` flag tried made the server write lineage. Tried: `--generate-info-schema`, `--info-schema-dir`, `--target-path`, `--metadata-dir`, `--write-json`, `--write-catalog`, `--selector`, `-s`, state and defer flags, and `--static-analysis strict` in every session. Nor did any `initializationOptions` variant or notification | lsp-flags l1–l4, l7; lsp-protocol P1, P5             |
| With a CLI-written lineage file present, the server did not rewrite it after edit and save                                                                                                                                                                                                                                                 | lsp-flags l7; lsp-protocol P5 step 04 snapshots      |

**What the extension classifies** (experiment `f1-compile-outcomes`; its stdout, stderr and exit code are the unit fixtures in `src/test/suite/fixtures/fusion-compile-2.0.6/`):

- strict with local origin: exit 0, no warning (step 02);
- `--generate-info-schema` under baseline: exit 0, `[warning] [Generic (dbt1000)]` on stderr (03);
- a SQL error under strict: exit 1, `[error] [UnresolvedIdentifier (dbt0227)]` (04);
- remote origin with a dropped source: exit 0, `[warning] [RemoteError (dbt1014)]: … Setting 'static_analysis' to off. Skipping analysis for 'model.lineage_probe.hard'` (06).

## 4. Refreshing one edited model

After a full strict compile and an edit to `order_totals`, with parent `stg_orders` never built in the warehouse:

- **`-s order_totals`:** produced `RemoteError (dbt1014): Failed to download model schema for 'model.lineage_probe.stg_orders'. Setting 'static_analysis' to off`, and `order_totals` lineage did not change (s1a, s2).
- **`-s +order_totals`:** refreshed it with no dbt1014 (s1a, s1c, e6/05). The docs describe this effect: unselected parents are read from the warehouse, and a model is eligible for analysis only if all of its upstream dependencies are.
- **Parent built by `dbt run -s stg_orders`:** `-s order_totals` refreshed it (s1d, s2).
- **Defer and state flags:** `--defer`, `--state`, `--favor-state`, `--no-defer`, `--manage-state` and `--no-manage-state` did not avoid dbt1014 when the parent was not built (s2, s2b).
- **Not established:** after a selective compile, which models the `column_lineage` view holds. It varied with the preceding steps (cli-select-state items 5–7, E6).

## 5. Reading lineage

- **Clean read:** `dbt show --profiles-dir <P> --info column_lineage --output json --limit -1 --quiet` printed one JSON array line with an empty stderr, in about 80 ms wall clock (r1/28, r5).
- **Without `--quiet`:** stdout also carries the version banner and the execution summary (r1/31–34).
- **`--log-format json` or `otel`:** stdout carries log events even with `--quiet` (r2/07–12).
- **Filtering and joins:** `--inline` over `{{ info_schema('column_lineage') }}` accepted WHERE, IN, joins to `{{ info_schema('node_columns') }}` and `WITH RECURSIVE` (r3).
- **The panel's read:** `dbt show --inline "<select of the five lineage columns> where child_node_unique_id in (…)" --output json --limit -1 --quiet` printed one JSON array line with an empty stderr, both upstream and downstream; a filter matching no node printed `[]` with exit 0; before any compile it exited 1 with `dbt1656` on stderr and empty stdout (r9).
- **What it reads:** `show --info` read `target/private/metadata/`. It succeeded with the DuckDB file moved away (r6) and with `target/info_schema/` deleted (r7/18, 21).
- **No metadata** (before any compile, after `dbt clean`, or with a non-matching `--target-path`): exit 1, `InfoSchemaUnavailable (dbt1656)` (r7).
- **Ambiguous empty result:** after a compile without `--generate-info-schema`, the read gave exit 0 and `[]` (r7/06).
- **Reading the parquet directly** returned the same 32 rows and lineage columns (r8).
- **The language server's `dbt.show`** rejected `{{ info_schema('column_lineage') }}` with "not available to a parse-time check" (lsp-protocol P4).

## 6. Native editor features

- **Through VS Code** 1.128.0, `vscode-languageclient` 10.1.1 and this extension, with `fusionPowerUser.staticAnalysis: strict`:
  - hover on `*`, a column and an alias returned results;
  - definition of a column returned the upstream model;
  - references of alias `total` returned `order_totals.sql` and `totals_downstream.sql`;
  - rename of alias `total` edited both files;
  - renaming a non-alias column returned `Cannot rename a column that is not an alias.`;
  - `vscode.prepareRename` returned the word range;
  - Fusion returned no code lenses.

  With `baseline`, every column call returned empty (native-editor-vscode run 1 and run 2 evidence JSON).
- **Through a raw client with `--static-analysis strict`:** the same results, except that `textDocument/prepareRename` returned `No such method` (E3, lsp-flags l6).

## 7. Warehouse-free strict compiles: experiment `w1-warehouse-free`

The fixture sets `sources: +schema_origin: "{{ env_var('FUSION_POWER_USER_SCHEMA_ORIGIN', 'remote') }}"` and declares a `data_type` on every source column. Every step starts on an empty `target/` with `stg_orders` never built. Each step dir holds Fusion's `logs/query_log.sql` for that step as `query_log.sql`. All compiles pass `--static-analysis strict --generate-info-schema`.

| Step | Origin | Change from the fixture                                                        | Selector        | Exit | `DESCRIBE`s | Diagnostic |
| ---- | ------ | ------------------------------------------------------------------------------ | --------------- | ---- | ----------- | ---------- |
| 02   | local  | —                                                                              | —               | 0    | 0           | —          |
| 03   | local  | —                                                                              | `order_totals`  | 0    | 1           | dbt1014    |
| 04   | local  | —                                                                              | `+order_totals` | 0    | 0           | —          |
| 05   | local  | every column of `stg_orders` and `order_totals` typed; `stg_orders` contracted | `order_totals`  | 0    | 1           | dbt1014    |
| 06   | local  | as 05, plus `models: +schema_origin: local`                                    | `order_totals`  | 1    | 0           | dbt1013    |
| 07   | local  | `probe.duckdb` moved away                                                      | —               | 0    | 0           | —          |
| 09   | local  | `probe.duckdb` moved away                                                      | `+order_totals` | 0    | 0           | —          |
| 11   | remote | —                                                                              | —               | 0    | 3           | —          |

- **Full compile and `+<model>`:** with local origin and typed sources, neither queried the warehouse (02, 04). Both succeeded with the DuckDB file absent (07, 09), and step 10's listing shows no file was recreated. Step 08 read 32 lineage rows after step 07.
- **Bare `-s <model>`:** `DESCRIBE`d the unbuilt parent and emitted `dbt1014 … Setting 'static_analysis' to off` (03). Typing every model column and enforcing a contract on the parent did not change that (05).
- **`+schema_origin` on models** is rejected: `SerializationError (dbt1013): Invalid model definition '+schema_origin'` (06).
- **Remote origin** `DESCRIBE`d the three source tables (11).
- **Source (open crates at `9977b6c`):** `crates/dbt-tasks-core/src/local_schema_builder.rs:140-150` builds local schemas only for sources whose origin is local and sends every other unselected node to the remote frontier; `crates/dbt-schemas/src/schemas/nodes.rs:666` defaults every node to `Remote`. The schema download and the fall-back to `off` are not in the open crates; they are in the closed `dbt-schema-hydration` and `dbt-tasks` crates, as are the analyzer (`sdf-frontend`) and lineage (`dbt-lineage`).

**What this establishes:** in this fixture, warehouse-free strict analysis needs local origin and a `data_type` on every source column, and a refresh must select `+<model>`. Model column types are not used for unselected parents.

## 8. Project model decisions: experiments `d1`–`d4`

Run 2026-09-28T15:10Z, harness revision `xwqkxktzolkr`, same binary. Each script header states its decision rule, written before the run.

| Experiment                  | Observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Rule selects                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d1-strict-fresh-machine`   | Empty HOME, XDG dirs and TMPDIR, no dbt platform variables: `dbt login status` printed `Status: unauthenticated` (02); the strict probe exited 1 with dbt0227 (03); a full strict compile gave 32 lineage rows (04–05). Afterwards HOME held only `.dbt/leases/` and the ADBC driver cache, which step 04 created (06)                                                                                                                                                                 | strict works online; no change                                                                                                                                   |
| `d2-view-after-plus-model`  | After a full compile (32 rows over four models), an edit and `-s +order_totals`, the view held 13 rows: `stg_orders` and `order_totals` only, with `hard` and `totals_downstream` gone. The panel's downstream read of `order_totals` returned 2 edges before and `[]` after. Same with the parent unbuilt (a, 07/09) and after `dbt run` (b, 16/18). `columnLineageRefresh.ts` checks only the selected models' upstream edges after a refresh, so it reports success after this loss | superseded by section 9                                                                                                                                          |
| `d3-star-child-plus-model`  | `totals_star` = `select * from order_totals`. After the edit, `-s +order_totals` left no `totals_star` rows (05); `-s +order_totals+` gave `totals_star` five columns including `biggest` (09), and the view dropped `hard`. No selector tried keeps every model                                                                                                                                                                                                                       | `+<model>+` reaches the child; the selection rule is in section 9                                                                                                |
| `d4-lsp-watch-registration` | With `didChangeWatchedFiles` `dynamicRegistration` and `relativePatternSupport` both true, as vscode-languageclient 10.1.1 sends, the server sent one `client/registerCapability` after `initialized`, `{"id":"default-dbt-file-system-watcher","method":"workspace/didChangeWatchedFiles","registerOptions":{"watchers":[{"globPattern":"**/*"}]}}` (03). With `dynamicRegistration` alone it sent the same (05); with neither it sent none (07)                                      | the extension forwards no file events to the language server; the manifest rebuild trigger moves to one `workspace.createFileSystemWatcher` per Declared Project |

## 9. What a selective compile keeps: experiment `d5-selective-compile-retention`

Run 2026-09-28T20:03Z and again at 20:07Z with identical per-step results, harness revision `myzzktqslort`, same binary, `FUSION_POWER_USER_SCHEMA_ORIGIN=local`, a fresh HOME. The fixture adds `totals_star` = `select * from order_totals`. Each case starts from an empty `target/`, runs a full strict compile (36 rows over five models), edits `order_totals` (adds `biggest`) and refreshes it, then edits `hard` (adds `amt2`) and refreshes it. Every refresh is `compile <argv> --static-analysis strict --generate-info-schema`. After each refresh the step records the view and a latest-wins read of `target/private/metadata/compile/column_lineage/v1_*.parquet` (the row with the highest `ingested_at` per `to_node_unique_id`).

| Case                | Refresh argv (`MODEL` is the edited model)      | View after both refreshes                               | Private store after both refreshes |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| a                   | `-s +MODEL`                                     | `hard` only (24 rows)                                   | all five models, both new columns  |
| b                   | `--partial-parse -s +MODEL`, full with the same | `hard` only                                             | all five, both new columns         |
| c                   | `--dirty --partial-parse`, full with the same   | `hard` only; the first refresh gave dbt1014             | all five; `order_totals` stale     |
| d                   | `-s +MODEL --exclude no_such_node`              | all five, both new columns (43 rows)                    | the same 43 rows                   |
| e                   | `-s +MODEL --exclude totals_downstream`         | all five, both new columns                              | the same                           |
| f                   | `-s +MODEL --exclude stg_orders`                | all five; `order_totals` stale after dbt1014            | the same                           |
| g                   | `-s +MODEL+ --exclude no_such_node`             | all five, both new columns, `totals_star` has `biggest` | the same 44 rows                   |
| h (after `dbt run`) | `-s MODEL`                                      | `hard` only                                             | all five, both new columns         |
| i (after `dbt run`) | `-s MODEL --exclude no_such_node`               | all five, both new columns                              | the same                           |

- **The compile keeps every model.** In every case the private epoch store held the latest rows for all five models. Only the selected models get a new epoch; the others keep their earlier rows. The open crate `dbt-metadata-parquet/src/cll_epoch.rs` documents this: delta writes per recomputed node, latest-wins by `max(ingested_at)`.
- **The view is a projection whose scope depends on how the selection is written.** With `-s` alone the view holds only the selected nodes (a, b, h). Adding any `--exclude`, even one that matches no node (d, i), makes the view the full latest-wins projection of the store. The excluded node's rows are kept, not removed (e). The flag's value does not matter; its presence does. This matches cli-select-state items 5 and 7, where `--exclude hard`, `--selector` and `state:modified` kept the view and `-s` alone shrank it.
- **Partial parse and `--dirty` do not change the view** (b, c). `--dirty` selected nodes without their parents, so the edited model hit dbt1014 as a bare `-s MODEL` does (c).
- **Excluding a parent brings back dbt1014** (f), so an exclusion must not name a node in `+MODEL`.

**What this establishes:** refresh on save needs no whole-project compile. Compiling `+<model>+`, or `+<model>` if `select *` children can wait for their own save, with an `--exclude` naming no node, updates the edited models and keeps every other model's lineage in the view. The mechanism behind the view's scope is closed (the `--exclude` effect is observed, not documented), so an integration test pins it against the pinned binary.

**The view and exploring.** Ad hoc runs on the same binary (not scripted) read the panel's upstream and downstream queries after each refresh:

- After a bare `-s +order_totals`, `order_totals`' upstream edges were current, including `biggest`, but its downstream query returned `[]` and `hard` returned nothing. The panel can only walk the models in the last selection.
- The view is rewritten only when a project file changed since the previous compile. With nothing changed, a later `-s +hard` or even a full compile left the narrowed view as it was. After an edit to `hard.sql`, a full compile restored every model. So compiling a model on demand when the user opens it does not help unless a file changed; it has to use the `--exclude` form.
- Removing `target/private/metadata/parse/alive.parquet` made the view show every model, and nothing else under `target/private/` did. The filter that uses it is in the closed crates.
- **Warehouse:** with local origin, typed sources and `profiles.yml` pointing at a missing DuckDB file, a full compile, a `-s +<model>` refresh and both view reads (`show --info` and `show --inline` over `info_schema()`) succeeded with no warehouse queries. `show --inline "… read_parquet(…)"` failed with dbt1308, because it runs on the warehouse. So reading the private store through `dbt show` is not warehouse-free.

**Editor features do not use the view: experiment `d6-editor-after-narrow-view`.** After a full compile, an edit and `-s +order_totals`, the view's downstream read of `order_totals` returned `[]`. In a `dbt lsp --static-analysis strict` session on the same project, hover, definition and references answered as in section 6. References of alias `total` returned `order_totals.sql` and `totals_downstream.sql`, and rename of `total` edited both files. Rename, references and definition come from the language server's own analysis, so the refresh rule affects only the lineage panel.

## 10. How the official extension gets column lineage: experiment `d7-lsp-listnodes-column-lineage`

The official extension's bundle (`dbtLabsInc.dbt` 0.109.1 from Open VSX, `dist/extension.js`, read statically) never reads the `column_lineage` info schema and runs no CLI compile for lineage. Its `showColumnLineage` command calls `dbt.getCurrentNode` for the file's columns and then `workspace/executeCommand` `dbt.listNodes` with `["@<unique_id>", "+column:<unique_id>.<column>+"]`. On servers older than `2.0.0-preview.77` it sends `["+column:<unique_id>.<column>+"]` alone. Project lineage sends a `+<unique_id>+` selector with the configured depth. The panel re-sends the request when the user moves to another node.

The experiment ran `dbt lsp --static-analysis strict` on the fixture with `totals_star` = `select * from order_totals` open, no CLI compile, and `target/` absent:

| Step                                                          | `dbt.listNodes` result (about 30 ms each)                                                                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+column:…order_totals.total+` before any edit                | 5 column nodes: `stg_orders.amount` and `raw.orders.amount` upstream; `totals_downstream.grand_total` and `totals_star.total` downstream, each with `parents` and `op` |
| `+column:…order_totals.biggest+` after an unsaved `didChange` | 0 nodes                                                                                                                                                                |
| the same after the file was written and `didSave` sent        | 4 nodes: `order_totals.biggest <- stg_orders.amount <- raw.orders.amount`, and `totals_star.biggest` downstream                                                        |
| `+model.…order_totals+` (project grain)                       | 4 nodes with `depends_on`                                                                                                                                              |

**What this establishes:** the language server answers column lineage for any node, upstream and downstream, on request, with no CLI compile and no `target/` files. After a save it reflects the edit, including `select *` children; an unsaved edit is not reflected. Its node rows carry the edge kind (`op`: `copy`, `mod`) and `transformation_type`. The CLI compile, the info-schema read and the refresh-on-save selection are not needed for the lineage panel.

A second ad hoc run (not scripted) repeated the same steps for each combination of `--static-analysis baseline|strict` and `FUSION_POWER_USER_SCHEMA_ORIGIN=local|remote`, each on a fresh `target/`:

- Under `baseline`, every `listNodes` column request returned 0 nodes with either origin.
- Under `strict`, both origins gave the table above, and `logs/query_log.sql` recorded no `DESCRIBE`.
- In this run the unsaved-`didChange` request already returned `biggest`, while the first run's did not. Whether an unsaved edit is reflected is therefore not established; after a save it was reflected in both runs.

## Superseded premises

- **"A selective compile drops the unselected models' lineage" (section 8, d2 and d3; cli-select-state item 5).** The compile keeps every model in `target/private/metadata/compile/column_lineage/`. Only the `column_lineage` view narrows, and only when the selection is `-s` with no `--exclude`; with any `--exclude` the view holds every model (section 9).

These claims in earlier documents are wrong or unsupported, and nothing below may be cited:

- **"`DBT_STATIC_ANALYSIS=strict` alone did not enable the features" (lsp-flags l5/61).** That run set the legacy name on the language server. The language server has no env binding for `--static-analysis`, and the documented CLI name is `DBT_ENGINE_STATIC_ANALYSIS`. Section 1 replaces this.
- **Experiments that set `DBT_GENERATE_INFO_SCHEMA`, `DBT_INFO_SCHEMA_DIR` or `DBT_METADATA_DIR`** (cli-compile c1/14–18, c3; lsp-flags l5). The docs list no environment variable for `generate_info_schema` or `info_schema_dir`, and the source's alias list does not include them. What those runs show is how undocumented variables happen to behave in this binary, not a supported configuration.
- **Experiments that set `DBT_TARGET_PATH`, `DBT_PROFILES_DIR` or `DBT_STATE` under their legacy names.** The documented names are `DBT_ENGINE_TARGET_PATH`, `DBT_ENGINE_PROFILES_DIR` and `DBT_ENGINE_STATE`. The legacy names are read after aliasing, but they are not the supported interface.
- **The static-analysis signal.** Using lineage rows (`--generate-info-schema`) as the only signal of static-analysis mode conflated two settings. Section 1 uses dbt0227, which does not depend on the info schema.
- **"Strict requires `dbt login`, but it worked, so the harness must be wrong."** Section 2 records that strict did take effect unauthenticated. That is a finding to track, not a harness error.

## Not established

- Whether strict without authentication in 2.0.6 is intended.
- Why `DBT_STATIC_ANALYSIS=baseline` together with `DBT_ENGINE_STATIC_ANALYSIS=strict` gave strict (M1 step 07).
- Whether `flags: static_analysis` in `dbt_project.yml` is meant to work (M1 step 11).
- The rule for which models the `column_lineage` view holds after a selective compile other than `-s +<model>` and `-s +<model>+` (section 8).
- Strict analysis offline, with or without a warm ADBC driver cache (section 8, d1 ran online only).
- How the `**/*` watcher behaves with one client per Declared Project: vscode-languageclient turns the string pattern into a workspace-wide watcher, so each client may get events for every project in the folder.
- Any adapter other than DuckDB, remote schema origin through the language server, and projects larger than four models.
