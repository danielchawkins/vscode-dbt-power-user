# dbt lsp protocol surface: evidence

> **Run record only.** Superseded by [README.md](README.md), the consolidated evidence. Where this file names `DBT_STATIC_ANALYSIS`, `DBT_GENERATE_INFO_SCHEMA`, `DBT_INFO_SCHEMA_DIR`, `DBT_METADATA_DIR` or `DBT_TARGET_PATH` as configuration, it used legacy or undocumented names; see README "Superseded premises". The experiments that tested only those names (`c3`, `l5`) have been deleted.

Binary `/Users/daniel/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.6/dbt` (`dbt 2.0.6`, sha256 `9fc5cd633558235a5eb4e265b5fea2aa8dbb4eb803a5e13872e6e80a5bbd4c15`), Darwin 25.5.0 arm64, 2026-09-26. Runs are under `$TMPDIR/fpu-ev/lsp-protocol/<experiment>/`. Rerun with:

```sh
DBT_BIN=<abs dbt> scripts/evidence/run.sh <experiment> "$TMPDIR/fpu-ev/lsp-protocol"
```

Each language-server step directory holds `lsp-command.json` (true server argv and env), `lsp-transcript.jsonl` (every JSON-RPC message), `lsp-results.json` (each request, its params and response, plus `serverMessages` received until the next step), and `lsp-steps.json`. `result.json` for language-server steps has the argv/env split at the wrong `--`; use `lsp-command.json` and `command.txt` instead.

Server argv in every session unless a row says otherwise (`<P>` is the fixture project):

```text
<dbt> lsp --socket <port> --project-dir <P> --profiles-dir <P> --lint-enabled false --static-analysis strict
  --no-version-check --command-prefix "" --log-level-file trace --otel-file-name <per-session>.jsonl
```

Extra environment: `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1`. cwd `<P>`. All sessions exited 0.

`lsp-session.mjs` step types added for these runs: `include`, `deleteFile`, `waitForProgressEnd` (a `$/progress` end whose begin had the given title, or message when the title is empty), `waitForNotification`, `snapshot`, `clientAnswers` (override how later server requests are answered, `"$NO_ANSWER"` to leave them unanswered), and `async` requests with `$LAST_ID` for `$/cancelRequest`. See `scripts/evidence/README.md`.

## P1: initialize (`p1-initialize`)

Steps 03–12 vary one thing each: `initializationOptions` absent, `{}`, `{"generateInfoSchema": true}`, `{"staticAnalysis": "strict"}`, `{"generate_info_schema": true, "static_analysis": "strict"}`; client capabilities `{}`, without `window.workDoneProgress`, without `didChangeWatchedFiles.dynamicRegistration`, without `workspace.configuration`; and the server flag `--generate-info-schema` (step 12).

| Steps | `initialize` result           | `textDocument/publishDiagnostics` | `$/progress` end |
| ----- | ----------------------------- | --------------------------------- | ---------------- |
| 03–12 | byte-identical across all ten | 138 in each                       | 2 in each        |

The capabilities returned (verbatim, `lsp-results.json` of step 03) begin:

```json
{"capabilities":{"codeActionProvider":{"codeActionKinds":["source.fixAll","source.fixAll.dbtLintFix"]},"codeLensProvider":{"resolveProvider":false},"completionProvider":{"completionItem":{"labelDetailsSupport":true},"resolveProvider":false,"triggerCharacters":["{","'","."]},"definitionProvider":true,"documentFormattingProvider":true,"documentSymbolProvider":false,"executeCommandProvider":{"commands":["dbt.listNodes","dbt.getCurrentNode","dbt.compileFile","dbt.compileLsp","dbt.clearTarget","dbt.getProjectInfo","dbt.show"]},"hoverProvider":true,"inlayHintProvider":true,"referencesProvid…
```

## P2: load readiness (`p2-load-readiness`)

Steps 02–04 are three identical loads (open `order_totals.sql`); step 05 initialises without opening a file.

| Step         | Server → client messages (counts)                                                                                                                                                                                                                                   | Compile log lines (`window/logMessage`, in order)                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02, 03, 04   | `client/registerCapability` 1, `window/logMessage` 12, `dbt/lspCompileStart` 1, `workspace/configuration` 2, `window/workDoneProgress/create` 2, `$/progress` begin 2 / report 18 / end 2, `textDocument/publishDiagnostics` 138, `workspace/codeLens/refresh` 2, … | `Attempting 'CompileFiles([DbtPath("models/order_totals.sql")])' compilation`, `'Incremental' compiling '<P>'`, `Updating compiler state to 1`, `'Incremental' compilation complete - 171ms` (183, 176 in 03, 04), `Attempting 'BackgroundCompile' compilation`, `'Full' compiling '<P>'`, `Compilation reused: No files changed`, `Updating compiler state to 2` |
| 05 (no open) | `client/registerCapability` 1 only                                                                                                                                                                                                                                  | none                                                                                                                                                                                                                                                                                                                                                              |

`dbt.getProjectInfo []` returned `{}` right after `initialized` and right after `didOpen`, and `{"adapter_type":"duckdb","models_count":4,"models_count_is_estimate":false,"project_name":"lineage_probe"}` after the first `$/progress` end and again 5 s later (P3 step 03, P4 steps 02–06, P6 step 02).

## P3: advertised commands and argument shapes (`p3-commands`, step 03)

`uri` is `file://<P>/models/order_totals.sql`; `relpath` is `models/order_totals.sql`. `null` means the JSON-RPC result was `null`.

| Command              | Arguments                                                                                                                   | Result                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dbt.getProjectInfo` | `[]`, `[{}]`, `[uri]`, `[relpath]`, `[{uri}]`, `[{file_uri}]`                                                               | `{"adapter_type":"duckdb","models_count":4,"models_count_is_estimate":false,"project_name":"lineage_probe"}` for all                                                          |
| `dbt.listNodes`      | `[]`                                                                                                                        | `null`                                                                                                                                                                        |
| `dbt.listNodes`      | `[{}]`, `[{uri}]`, `[{file_uri}]`, `[{select}]`, `[{selector}]`                                                             | `{"error":"empty selector list passed to --select/--exclude","error_kind":"invalid_selector","grain":"unknown","nodes":[]}`                                                   |
| `dbt.listNodes`      | `[uri]`                                                                                                                     | `{"error":"No nodes found","error_kind":"lineage_query_failed","grain":"unknown","nodes":[],"root_project":"lineage_probe"}`                                                  |
| `dbt.listNodes`      | `[relpath]`, `["+models/order_totals.sql+"]`, `["order_totals"]`, `["+order_totals+"]`                                      | `{"error":null,"error_kind":null,"grain":"project","nodes":[{"config":{"access":"protected","group":null,"materialized":"view"},"depends_on":{"nodes":["model.lineage_probe…` |
| `dbt.getCurrentNode` | `[]`, `[{}]`, `[uri]`, `[{uri}]`, `[{file_uri}]`, `[{uri,line,character}]`, `[{uri,position}]`, `[{textDocument,position}]` | `null`                                                                                                                                                                        |
| `dbt.getCurrentNode` | `[relpath]`                                                                                                                 | `{"error":null,"node":{"columns":{"customer_id":{"data_type":"integer"},"last_status":{"data_type":"character varying(256)"},"n":{"data_type":"bigint"},"total":{"data_type…` |
| `dbt.compileFile`    | `[]`                                                                                                                        | `null`                                                                                                                                                                        |
| `dbt.compileFile`    | `[{}]`, `[{uri}]`, `[{file_uri}]`                                                                                           | `{"error":"File path invalid","file_uri":null}`                                                                                                                               |
| `dbt.compileFile`    | `[relpath]`                                                                                                                 | `{"error":"relative URL without a base","file_uri":null}`                                                                                                                     |
| `dbt.compileFile`    | `[uri]`                                                                                                                     | `{"error":null,"file_uri":"file://<P>/target/.lsp/compiled/lineage_probe/models/order_totals.sql"}`                                                                           |
| `dbt.show`           | `[]`, `[uri]`, `[relpath]`                                                                                                  | `null`                                                                                                                                                                        |
| `dbt.show`           | `[{}]`, `[{file_uri}]`, `[{sql}]`, `[{select}]`, `[{selector}]`                                                             | `{"columns":null,"data":null,"error":"invalid file selector: . relative URL without a base"}`                                                                                 |
| `dbt.show`           | `[{uri}]`, `[{uri,limit}]`                                                                                                  | `{"columns":["customer_id","total","n","last_status"],"data":[],"error":null}`                                                                                                |
| `dbt.show`           | `[{inline:"select 1 as one"}]`, `[{uri,inline}]`, `[{uri,inline,limit}]`                                                    | `{"columns":["one"],"data":[{"one":"1"}],"error":null}`                                                                                                                       |
| `dbt.show`           | `[{uri,inline:"select * from {{ ref('stg_orders') }}"}]`                                                                    | `{"columns":["id","customer_id","amount","status","note"],"data":[],"error":null}`                                                                                            |
| `dbt.compileLsp`     | `[]`, `[{}]`, `[uri]`, `[relpath]`, `[{uri}]`, `[{file_uri}]`                                                               | `null`                                                                                                                                                                        |
| `dbt.clearTarget`    | `[]`, `[{}]`, `[uri]`, …                                                                                                    | `null`                                                                                                                                                                        |

Step 04 repeats these with `--command-prefix dbt` (`commands-prefixed.json`).

## P4: `dbt.show` over the info schema (`p4-show-info-schema`)

Steps: 02 no prior compile; 03 no prior compile, server with `--generate-info-schema`; 04 `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema` (exit 0); 05 server after that compile; 06 server with `--generate-info-schema` after that compile; 07 `<dbt> show --profiles-dir <P> --info column_lineage --output json --limit 5 --quiet` (exit 0); 08 `<dbt> show --profiles-dir <P> --inline "select * from {{ info_schema('column_lineage') }}" --output json --limit 5 --quiet` (exit 0). Each `inline` was sent as `[{inline}]`, `[{inline,limit}]` and `[{uri,inline,limit}]`, with the same result for all three shapes.

| `inline` SQL                                                                     | Steps 02, 03                                                                                                                                                                                                                                                                   | Steps 05, 06                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `select * from {{ info_schema('column_lineage') }}` (also with `limit 5`)        | `error: Failed to render SQL invalid operation: info_schema: 'column_lineage' is not available to a parse-time check. Available views: project, packages, project_vars, project_env_vars, models, seeds, snapshots, functions, analyses, hooks, sources, data_tests, unit_te…` | same                                                                                                                                                                                                       |
| `select * from {{ info_schema('models') }}`                                      | `error: Internal: Catalog Error: Table with name "dbt.models" does not exist because schema "dbt" does not exist.`                                                                                                                                                             | same                                                                                                                                                                                                       |
| `select * from {{ info_schema('node_columns') }}`                                | `error: Internal: Catalog Error: Table with name "dbt.node_columns" does not exist because schema "dbt" does not exist.`                                                                                                                                                       | same                                                                                                                                                                                                       |
| `select * from dbt.column_lineage`                                               | `error: Internal: Catalog Error: Table with name "dbt.column_lineage" does not exist because schema "dbt" does not exist.`                                                                                                                                                     | same                                                                                                                                                                                                       |
| `select * from read_parquet('target/info_schema/v1/dbt.column_lineage.parquet')` | `error: Internal: IO Error: No files found that match the pattern "target/info_schema/v1/dbt.column_lineage.parquet"`                                                                                                                                                          | `{"columns":["parent_node_unique_id","parent_column_name","child_node_unique_id","child_column_name","evolution","ingested_at"],"data":[{"child_column_name":"amt","child_node_unique_id":"model.lineage…` |

## P5: notifications after load (`p5-notifications`)

Step 02 runs `notifications.json` on a fresh `target/`; step 04 runs it with `--generate-info-schema` after step 03, `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema` (exit 0). Order in step 02 as sent (times UTC, from `lsp-transcript.jsonl`):

| Sent                                                                    | Server log and `dbt/*` notifications that followed                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `didOpen` 14:45:28.408                                                  | `Attempting 'CompileFiles(…order_totals.sql…)'`, `dbt/lspCompileStart`, `'Incremental' compilation complete - 165ms`, `dbt/lspCompileComplete`, `Attempting 'BackgroundCompile'`, `dbt/lspBackgroundCompileStart`, `Compilation reused: No files changed`, `'Full' compilation complete - 18ms`, `dbt/lspBackgroundCompileComplete` |
| `didSave` without text, file unchanged, 14:45:36.588                    | `Compilation attempted due to file event: <P>/models/order_totals.sql` and nothing else                                                                                                                                                                                                                                             |
| `didSave` with text, file unchanged, 14:45:42.591                       | none                                                                                                                                                                                                                                                                                                                                |
| disk edit, then `didSave` without text, 14:45:48.595                    | `Compilation attempted due to file event`, `Attempting 'CompileFiles(…)'`, incremental compile (70 ms) and background compile, with the four `dbt/*` notifications                                                                                                                                                                  |
| disk revert, then `didSave` with text, 14:45:54.598                     | same sequence (69 ms)                                                                                                                                                                                                                                                                                                               |
| `didChangeWatchedFiles` type 2 on an unchanged file, 14:46:00.602       | none                                                                                                                                                                                                                                                                                                                                |
| disk edit, then `didChangeWatchedFiles` type 2, 14:46:06.605            | `Compilation attempted due to file event`, `Attempting 'Parse' compilation`, incremental (71 ms) and background compile                                                                                                                                                                                                             |
| `didChangeWatchedFiles` type 1 for `models/new_model.sql`, 14:46:12.611 | `Compilation attempted due to file event: <P>/models/new_model.sql`, `Attempting 'Parse' compilation`, incremental (161 ms) …                                                                                                                                                                                                       |

Every `dbt/lspCompileStart`, `dbt/lspCompileComplete`, `dbt/lspBackgroundCompileStart` and `dbt/lspBackgroundCompileComplete` carried `"cause":"didSave"`, including those after `didOpen` and `didChangeWatchedFiles`. Params seen: `adapter_type`, `adapter_unique_id`, `cause`, `compile_type` (`incremental` or `full`), `dbt_version` (`2.0.6`), `project_id` (`null`). The first `dbt/lspCompileStart` had `adapter_type` and `adapter_unique_id` `null`.

Files: in step 02 the only lineage-related files after the session are `target/.lsp/private/metadata/compile/schemas/{0..3}.parquet`. In step 04 the session took a `snapshot` after each notification (00-loaded through 14-cancel-listNodes). Every snapshot lists `target/info_schema/v1/dbt.column_lineage.parquet` with size 1977 and sha256 prefix `5936ea0509eb`, unchanged from the CLI compile in step 03, including after the disk edits in snapshots 03 and 06.

## P6: unanswered `window/workDoneProgress/create` (`p6-progress-unanswered`, step 02)

The client left every `window/workDoneProgress/create` unanswered (`clientAnswers`). The server still sent 138 `publishDiagnostics` and `$/progress` reports, and sent `window/workDoneProgress/create` 6 times.

| Request                            | Result                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `dbt.getProjectInfo` after load    | `{"adapter_type":"duckdb","models_count":4,"models_count_is_estimate":false,"project_name":"lineage_probe"}` |
| `dbt.getCurrentNode [relpath]`     | no response within 20000 ms                                                                                  |
| `dbt.listNodes ["+order_totals+"]` | no response within 20000 ms                                                                                  |
| `dbt.compileFile [uri]`            | no response within 20000 ms                                                                                  |
| `dbt.show [{uri,limit}]`           | no response within 20000 ms                                                                                  |
| `dbt.getProjectInfo []`            | same as above                                                                                                |

## What the recorded runs show

In this fixture with this binary:

- `initializationOptions` (four variants), four client-capability variants, and the `--generate-info-schema` server flag produced a byte-identical `initialize` result, the same 138 diagnostics and the same two `$/progress` ends (P1 03–12).
- The server did not start compiling until a document was opened (P2 05). After `didOpen`, `dbt.getProjectInfo` returned `{}` until the first `$/progress` end, then `models_count_is_estimate: false` (P2, P3 03).
- One argument shape worked for each of these commands:
  - `dbt.compileFile`: a bare URI string (P3 03).
  - `dbt.show`: an object with `uri` or `inline` (P3 03).
  - `dbt.getCurrentNode`: a bare project-relative path. With it, the result included typed columns (P3 03).
  - `dbt.listNodes`: a bare selector string or relative path (P3 03).
  - `dbt.getProjectInfo`: every shape tried (P3 03).
- `dbt.compileLsp` and `dbt.clearTarget` returned `null` for every shape tried (P3 03).
- `dbt.show` could not read `info_schema('column_lineage')`: "not available to a parse-time check". It also could not read `info_schema('models')` or `info_schema('node_columns')`: `schema "dbt" does not exist`. Neither a prior CLI compile nor `--generate-info-schema` on the server changed that (P4 02–06).
- `read_parquet('target/info_schema/v1/dbt.column_lineage.parquet')` through `dbt.show` returned lineage rows once a CLI compile had written the file (P4 05, 06).
- A `didSave` recompiled only when the file on disk had changed, with or without `text`. `didChangeWatchedFiles` behaved the same way for a changed file; for a created file it ran a parse compile (P5 02).
- No notification in P5 changed the CLI-written `target/info_schema/v1/dbt.column_lineage.parquet` (P5 04 snapshots).
- Every `dbt/*` compile notification reported `cause: "didSave"` whatever triggered it (P5 02).
- If the client never answered `window/workDoneProgress/create`, `dbt.getCurrentNode`, `dbt.listNodes`, `dbt.compileFile` and `dbt.show` got no response within 20 s, while `dbt.getProjectInfo` answered (P6 02).

## Not established

- The prefixed-command results (P3 step 04) are recorded but not tabulated here.
- `dbt.compileLsp` and `dbt.clearTarget` may take arguments not tried here; the server's log did not name a parameter struct for them in these runs.
- Whether the `read_parquet` route through `dbt.show` is supported or incidental. It reads a file path relative to the server's cwd.
- The `strings` grep of the binary for init-option names (P1 step 02) is recorded in its step directory but was not analysed here.
- `workspace/didChangeConfiguration`, `didClose` and `$/cancelRequest` were sent in P5 step 04 (snapshots 09–14), but their compile logs are not tabulated here.
- Whether the P6 hang is permanent, or only lasts longer than 20 s.
- Other adapters, remote schema origin, larger projects, and clients other than `lsp-session.mjs`.
