# Fusion column lineage and editor features: evidence

Captured 2026-09-26 with dbt Fusion 2.0.6 (`dbt --version`: `dbt 2.0.6`) on Darwin 25.5.0 arm64, Node v24.21.0, DuckDB adapter, no `dbt login`. Every result below comes from `scripts/evidence/run.sh <experiment>`. The runner copies `scripts/evidence/fixture/` into a fresh directory under `$TMPDIR/fpu-evidence/<experiment>/project`, creates the three source tables with `dbt run-operation setup_raw`, deletes `target/` and `logs/`, and then runs `scripts/evidence/experiments/<experiment>.sh`.

For each step the runner writes `steps/NN-<label>/` with:

- `command.txt`: working directory, argv (for `dbtp`, the expanded `dbt` argv), every `DBT_*` and `FUSION_POWER_USER_*` variable, start and end time, and exit code;
- `stdout.txt` and `stderr.txt`, unfiltered;
- `files-after.txt`: every file under `target/` and `logs/`, including hidden directories, with modification time and size.

Language-server steps also write `lsp-command.json` (cwd and argv), `lsp-transcript.jsonl` (every JSON-RPC message in both directions, timestamped), `lsp-results.json` (each request with its response), and the server's own stdout and stderr. Fusion's own logs are copied to `fusion-logs/`. To re-examine a claim, rerun the experiment and open the named step.

Environment common to every run: `DBT_PROFILES_DIR` and `DBT_ENGINE_PROFILES_DIR` are set to the fixture directory, and every CLI call also passes `--profiles-dir` explicitly. That is needed because Fusion reads `DBT_ENGINE_PROFILES_DIR` ahead of `DBT_PROFILES_DIR`, and the operator shell exported `DBT_ENGINE_PROFILES_DIR=~/.dbt`; the first attempt failed with `Profile 'lineage_probe' not found in profiles.yml` for that reason. `DBT_SEND_ANONYMOUS_USAGE_STATS=false`.

## Fixture

`scripts/evidence/fixture/` is a four-model DuckDB project named `lineage_probe`:

- `stg_orders`: `select * from {{ source('raw', 'orders') }}`
- `order_totals`: `select customer_id, sum(amount) as total, count(*) as n, max(status) as last_status from {{ ref('stg_orders') }} group by customer_id`
- `totals_downstream`: `select customer_id, total as grand_total from {{ ref('order_totals') }}`
- `hard`: a CTE with a join, a `CASE`, a window function, a filter, an alias (`name as label`) and a `UNION ALL`

`dbt_project.yml` sets `sources: +schema_origin: "{{ env_var('FUSION_POWER_USER_SCHEMA_ORIGIN', 'remote') }}"`. Every source column has a `data_type`. All experiments export `FUSION_POWER_USER_SCHEMA_ORIGIN=local` unless a step says otherwise.

## Language server

The language-server client is `scripts/evidence/lsp-session.mjs`. It spawns `dbt lsp --socket <port> <args>` with the project directory as cwd and the inherited environment, answers `workspace/configuration` the way the extension does (`{ lsp: { linter: { enabled: false } } }` for section `dbt`), answers every other server request with `null`, and replays a JSON step file from `scripts/evidence/steps/`.

### E1: `--generate-info-schema` on the language server, no prior compile

`experiments/e1-lsp-info-schema.sh`. Environment adds `DBT_GENERATE_INFO_SCHEMA=true` and `DBT_LSP_USE_TARGET_LSP=1`. Server argv:

```text
dbt lsp --socket <port> --project-dir <P> --profiles-dir <P> --lint-enabled false --static-analysis strict
  --generate-info-schema --no-version-check --command-prefix "" --log-level trace --log-level-file trace
  --otel-file-name lsp-otel.jsonl
```

Steps (`steps/edit-and-save.json`): `initialize`, `initialized`, `didOpen` of `order_totals.sql`, wait 10 s, write a new column `max(amount) as biggest` to disk, `didChange`, `didSave`, `workspace/didChangeWatchedFiles`, wait 10 s, `workspace/executeCommand dbt.compileLsp []`, wait 8 s, `dbt.compileFile [uri]`, wait 5 s, hover on `biggest`.

Observed:

- `steps/02-lsp-edit-save/files-after.txt` lists files under `target/.lsp/compiled/` and `target/.lsp/private/metadata/` (`compile/schemas/0..4.parquet`, `parse/*.parquet`) and nothing under `target/info_schema/` or `target/.lsp/info_schema/`.
- `steps/03-show-info-after-lsp`: `dbt show --profiles-dir <P> --info column_lineage --output json --limit -1 --quiet` exited 1 with `InfoSchemaUnavailable (dbt1656): no project metadata at <P>/target/private/metadata`.
- A follow-up command in the same project directory (not part of the scripted run), `dbt show --profiles-dir <P> --target-path target/.lsp --info column_lineage --output json --limit -1 --quiet`, printed `[]` and exited 0. With `--info models` and `--info node_columns` against the same target path it printed rows for the four models and the source columns. With `--inline "select node_unique_id, column_name, data_type_inferred from {{ info_schema('node_columns') }} where node_unique_id like 'model.%'"` it printed `[]`.

### E2: the same session on top of a full strict CLI compile

`experiments/e2-lsp-after-compile.sh`. Step 02 is `dbt compile --profiles-dir <P> --static-analysis strict --generate-info-schema --log-level-file trace --otel-file-name cli-compile-otel.jsonl` (exit 0). Step 04 is the E1 server argv and step file.

| Step                  | `column_lineage` rows | `order_totals` child columns               | Distinct `ingested_at`             |
| --------------------- | --------------------- | ------------------------------------------ | ---------------------------------- |
| 03 before the session | 32                    | `customer_id`, `last_status`, `n`, `total` | `2026-09-26T00:16:59.606464-07:00` |
| 05 after the session  | 32                    | `customer_id`, `last_status`, `n`, `total` | `2026-09-26T00:16:59.606464-07:00` |

`target/info_schema/v1/dbt.column_lineage.parquet` and `target/private/metadata/compile/column_lineage/v1_0.parquet` have modification time `2026-09-26T00:16:59` in both step 02 and step 04 listings. The session started at `2026-09-26T07:17:00.476Z` (UTC; 00:17:00 local). Hover on `biggest` in step 04 returned `| Alias | Type | ... | biggest | decimal(10, 2) |`.

### E3: native editor features by static-analysis mode, no prior compile

`experiments/e3-lsp-editor-features.sh`. Environment: `DBT_LSP_USE_TARGET_LSP=1`, no `DBT_GENERATE_INFO_SCHEMA`. `target/` is deleted before each mode. Server argv differs only in `--static-analysis`:

```text
dbt lsp --socket <port> --project-dir <P> --profiles-dir <P> --lint-enabled false --static-analysis <mode>
  --no-version-check --command-prefix "" --log-level-file trace --otel-file-name lsp-editor-<mode>-otel.jsonl
```

Both modes advertised the same `initialize` capabilities: code action, code lens, completion, definition, document formatting, execute command, hover, inlay hint, references, rename, semantic tokens and signature help. Commands: `dbt.listNodes`, `dbt.getCurrentNode`, `dbt.compileFile`, `dbt.compileLsp`, `dbt.clearTarget`, `dbt.getProjectInfo`, `dbt.show`. No document highlight provider.

Responses from `steps/02-editor-baseline/lsp-results.json` and `steps/03-editor-strict/lsp-results.json`. Positions are zero-based `line:character`.

| Request (position)                                 | baseline                                          | strict                                                                                             |
| -------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| hover `*` in `stg_orders`                          | `null`                                            | table of `amount`, `customer_id`, `id`, `note`, `status` with types and origin `probe.main.orders` |
| hover `customer_id` in `order_totals`              | `null`                                            | `customer_id`, `integer`, origin `probe.main.stg_orders`                                           |
| hover alias `total`                                | `null`                                            | `total`, `decimal(38, 2)`                                                                          |
| hover `ref('stg_orders')`                          | parent and child models                           | parent and child models plus the column list                                                       |
| definition `customer_id` in `order_totals`         | `null`                                            | `stg_orders.sql:0:7`                                                                               |
| definition `total` in `totals_downstream`          | `null`                                            | `order_totals.sql:0:20`                                                                            |
| definition `o.customer_id` join key in `hard`      | `null`                                            | `hard.sql:3:82`                                                                                    |
| definition `customer_id` after `group by`          | `null`                                            | `null`                                                                                             |
| references alias `total`                           | `null`                                            | `order_totals.sql:0:35`, `totals_downstream.sql:0:20`                                              |
| references `customer_id` in `order_totals`         | `null`                                            | `stg_orders.sql:0:7`, `order_totals.sql:0:7`                                                       |
| references `*` in `stg_orders`                     | `null`                                            | `stg_orders.sql:0:7`, `order_totals.sql:0:24`                                                      |
| `textDocument/prepareRename` alias `total`         | error `No such method textDocument/prepareRename` | same error                                                                                         |
| rename alias `total` → `total_amount`              | `null`                                            | edits `order_totals.sql` 0:35 and `totals_downstream.sql` 0:20                                     |
| rename `total` from its use in `totals_downstream` | `null`                                            | the same two edits                                                                                 |
| rename `customer_id` → `cust_id`                   | `null`                                            | error `Cannot rename a column that is not an alias.`                                               |
| rename alias `label` in `hard` → `customer_name`   | `null`                                            | edit `hard.sql` 6:19                                                                               |
| `textDocument/codeLens` `order_totals`             | `null`                                            | `null`                                                                                             |
| `textDocument/inlayHint` `stg_orders` line 0       | `[]`                                              | `[]`                                                                                               |

### E4: the language server's `dbt.show` against the info schema

`experiments/e4-lsp-show-info-schema.sh`. Step 02 is a full strict CLI compile with `--generate-info-schema` (exit 0). Step 03 is a strict server with `--generate-info-schema` and `steps/lsp-show-info-schema.json`.

| `workspace/executeCommand`                                                   | Result                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dbt.show [{ inline: "select * from {{ info_schema('column_lineage') }}" }]` | `error: Failed to render SQL invalid operation: info_schema: 'column_lineage' is not available to a parse-time check. Available views: project, packages, …` |
| `dbt.show [{ inline: "select * from {{ info_schema('models') }}" }]`         | `error: Internal: Catalog Error: Table with name "dbt.models" does not exist because schema "dbt" does not exist.`                                           |
| `dbt.show [{ uri: order_totals.sql }]`                                       | `error: Internal: Catalog Error: Table with name stg_orders does not exist!` (the fixture never materialises models)                                         |
| `dbt.listNodes []`                                                           | `null`                                                                                                                                                       |
| `dbt.getProjectInfo []`                                                      | `{"adapter_type":"duckdb","models_count":4,"models_count_is_estimate":false,"project_name":"lineage_probe"}`                                                 |

## CLI

### E5: full compile, reading lineage, and a single-model recompile

`experiments/e5-cli-compile-show.sh`.

| Step | Expanded argv                                                                                                                                                                               | Exit | Output                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02   | `dbt compile --profiles-dir <P> --static-analysis strict --generate-info-schema --log-level-file trace --otel-file-name cli-full-otel.jsonl`                                                | 0    | writes `target/info_schema/v1/` (38 `.parquet` files and one other file) and `target/private/metadata/compile/column_lineage/v1_0.parquet`                                                                                                                                                  |
| 03   | `dbt show --profiles-dir <P> --info column_lineage --output json --limit -1 --quiet`                                                                                                        | 0    | stdout is one JSON array and nothing else; stderr is empty; 32 rows with `parent_node_unique_id`, `parent_column_name`, `child_node_unique_id`, `child_column_name`, `evolution`, `ingested_at`                                                                                             |
| 04   | same with `--output ndjson`                                                                                                                                                                 | 0    | one JSON object per line, same columns                                                                                                                                                                                                                                                      |
| 05   | `dbt show --profiles-dir <P> --inline "select * from {{ info_schema('column_lineage') }} where child_node_unique_id = 'model.lineage_probe.order_totals'" --output json --limit -1 --quiet` | 0    | JSON array with only `order_totals` rows                                                                                                                                                                                                                                                    |
| 06   | after adding `biggest` to `order_totals.sql`: `dbt compile --profiles-dir <P> -s order_totals --static-analysis strict --generate-info-schema …`                                            | 0    | stdout: `Finished 'compile' with 1 warning`; warning `RemoteError (dbt1014): Failed to download model schema for 'model.lineage_probe.stg_orders'. Setting 'static_analysis' to off. Skipping analysis for 'model.lineage_probe.order_totals'`, from `DESCRIBE "probe"."main"."stg_orders"` |
| 07   | `dbt show … --info column_lineage …`                                                                                                                                                        | 0    | 11 rows: `stg_orders` 5 and `order_totals` 6, all with the step 02 `ingested_at`; no `biggest` row                                                                                                                                                                                          |
| 08   | step 06 with `FUSION_POWER_USER_SCHEMA_ORIGIN=remote`                                                                                                                                       | 0    | the same `dbt1014` warning                                                                                                                                                                                                                                                                  |

`stg_orders` is a view that the fixture never builds. The warning in step 06 is Fusion trying to `DESCRIBE` the unselected parent model in the warehouse.

### E6: which selectors refresh a model's lineage

`experiments/e6-cli-selective-refresh.sh`. After a full strict compile, `order_totals.sql` gains `max(amount) as biggest`; each compile below is followed by `dbt show --profiles-dir <P> --info column_lineage --output json --limit -1 --quiet`.

| Step  | Compile argv after `dbt compile --profiles-dir <P>`                | Exit                         | Rows by child model after the compile                              | `order_totals` columns                     |
| ----- | ------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| 02/03 | `--static-analysis strict --generate-info-schema`                  | 0                            | `hard` 19, `totals_downstream` 2, `stg_orders` 5, `order_totals` 6 | `customer_id`, `last_status`, `n`, `total` |
| 04/05 | `-s +order_totals --static-analysis strict --generate-info-schema` | 0                            | `stg_orders` 5, `order_totals` 8                                   | adds `biggest`                             |
| 06/07 | `-s order_totals --static-analysis strict --generate-info-schema`  | 0 (1 warning, as E5 step 06) | `stg_orders` 5, `order_totals` 8                                   | unchanged from 05                          |
| 08    | `dbt run --profiles-dir <P> -s stg_orders`                         | 0                            | —                                                                  | —                                          |
| 09/10 | `-s order_totals --static-analysis strict --generate-info-schema`  | 0                            | `hard` 19, `totals_downstream` 2, `stg_orders` 5, `order_totals` 8 | same as 05                                 |
| 11/12 | full compile again                                                 | 0                            | same as 10                                                         | same as 05                                 |

Files after step 09 (`files-after.txt`) include `target/private/index/dbt.column_lineage.parquet` (first listed after step 08, the `dbt run`), `target/private/metadata/compile/column_lineage/v1_0.parquet` and `v1_1.parquet`, and `target/info_schema/v1/dbt.column_lineage.parquet`.

## Not established by these runs

- Whether any `dbt lsp` flag, environment variable, `initializationOptions` field or command makes the server write `column_lineage`. E1 and E2 tried `--generate-info-schema`, `DBT_GENERATE_INFO_SCHEMA=true`, `DBT_LSP_USE_TARGET_LSP=1`, edit and save, `didChangeWatchedFiles`, `dbt.compileLsp []` and `dbt.compileFile [uri]`. Earlier ad hoc runs (not scripted here) also tried `--selector` with a `selectors.yml` selector and with `DBT_LSP_USE_TARGET_LSP` unset; they wrote no `info_schema` either. `initializationOptions` were never sent.
- The `dbt.compileLsp` argument shape. `[]` returned `null`; no other shape was scripted.
- Behaviour with remote sources, a real warehouse, or projects larger than four models.
- Why a selective compile's `column_lineage` view drops rows for unselected models in E6 step 05 and restores them in step 10. The table records the rows observed, not the mechanism.
- Behaviour through `vscode-languageclient` in a real VS Code or Cursor window. These runs use a raw JSON-RPC client; the extension's integration and smoke tests are separate.
