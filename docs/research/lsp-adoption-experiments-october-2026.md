# Language server adoption experiments (dbt Fusion 2.0.6)

Captured 2026-10-04 against `dbt lsp` 2.0.6 on Darwin arm64 over stdio, for step 2.2 of [`quality-and-lsp-plan.md`](../refactor/quality-and-lsp-plan.md). The scripts are [`scripts/evidence/experiments/e1-…e9-*.mjs`](../../scripts/evidence/experiments/) on the spike harness in [`scripts/spikes/lsp-capabilities/`](../../scripts/spikes/lsp-capabilities/); each fixes its decision rule in its header before running, writes one JSON file under [`evidence/lsp-2.0.6/adoption/`](evidence/lsp-2.0.6/adoption/) and prints one `DECISION` line. Background is [`lsp-capabilities-fusion-2.0.6.md`](lsp-capabilities-fusion-2.0.6.md).

Projects:

- **jaffle**: `test-fixtures/jaffle-shop-duckdb`, prepared fresh per run by `prep-jaffle.sh` (E1 adds a snapshot), `--static-analysis strict` unless stated.
- **multi-root**: a copy of `src/test/fixtures/multi-root` (`general` and `sox`), each project with one added CTE model.
- **finance**: the copy of `finance_general` at `/tmp/lsp-fin/finance_general` (330 models, 1,270 sources, Snowflake), `--profiles-dir ~/.dbt`, `baseline` unless stated, under the heavy-run lock. Account, user, role, database, warehouse and schema names, three-part relation names and every row value are redacted; the redaction also masks one local package name that matches a warehouse name.

Finance credentials: run from the `finance-pipelines` root environment, the profile's `SNOWFLAKE_PRIVATE_KEY_PASSPHRASE` is unset and the server stalled after `didOpen` for 6 minutes with no `dbt/lspCompileStart`, no stderr and no diagnostic. Every finance result below ran from the `fpu-settings` environment, where the variable is set.

## Decisions

| Experiment                             | Decision                                                                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 graph selector                      | `["+package:<root>"]`; `package:<root>` misses UDF `function` nodes from another package                                                                                                                                         |
| E2 `show` concurrency and cancellation | `show` and `listNodes` share one queue; `compileFile` has its own. Cancel stops neither the server nor the warehouse query. **Stop condition met**: one `show` blocked lineage for 10.5 s on finance                             |
| E3 unsaved compile                     | D5 stands                                                                                                                                                                                                                        |
| E4 error shapes and timings            | `server`, `timeout` and the empty `listNodes` result as planned, plus two unplanned shapes (`null` result; `show` with no columns and no error). Deadlines 5 s for `compileFile`, `getCurrentNode`, `listNodes`; none for `show` |
| E5 command prefix                      | Lens command is the bare `dbt.previewCte` in every project; executable names carry the prefix                                                                                                                                    |
| E6 disk-watch scope                    | The server sees macro, `dbt_project.yml` and `packages.yml` edits itself; no registry-triggered refresh                                                                                                                          |
| E7 `willRenameFiles`                   | Server half passes; client half not established                                                                                                                                                                                  |
| E8 baseline mode                       | Passes; graph fields stay server-owned in `baseline`. Column fetch p50 2.0 s on finance, under the 3 s stop                                                                                                                      |
| E9 compiled paths                      | Both modes pass; 2.7 and 2.9 read the returned paths verbatim, and `shared` stays                                                                                                                                                |

## E1: graph selector

Rule: of `["package:<root>"]`, `["+package:<root>"]` and their union, choose the smallest that contains every `depends_on` target; otherwise draw placeholders.

- jaffle: all three return the same 15 nodes and 15 edges, every target present ([`e1-graph-selector-jaffle.json`](evidence/lsp-2.0.6/adoption/e1-graph-selector-jaffle.json)). Resource types: `model`, `seed`, `snapshot`, `source`, `exposure`, `test` (the singular test only; generic tests never appear), `unit_test`.
- finance: `package:` and the union return 1,600 nodes (330 models, 1,270 sources) and miss one target, a `function` node in another package that 330 of the 684 edges (48%) point at. `+package:` returns 1,603 nodes, adding three `function` nodes, and is complete; 58 ms ([`e1-graph-selector-finance.json`](evidence/lsp-2.0.6/adoption/e1-graph-selector-finance.json)). The union equals `package:`: a later selector element does not widen an earlier one here.

Decision: 2.4 uses `["+package:<root>"]`. It is the smallest complete candidate on finance and ties on jaffle. The server-owned resource types for `FIELD_OWNERS` are `model`, `seed`, `snapshot`, `source`, `exposure`, singular `test`, `unit_test` and `function`. No placeholders are needed on either project, so the 5% stop in Risks does not apply.

## E2: `dbt.show` concurrency and cancellation

Rule: a pair interferes when the second request answers more than 1 s after its solo p50, answers only after the `show`, or either errors. Cancellation is judged from Snowflake query history.

| Pair                        | jaffle (DuckDB, 37 s `show`)                      | finance (Snowflake, 11 s `show`)                  |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| `listNodes` during `show`   | 36,350 ms (solo 27 ms), answered after the `show` | 10,465 ms (solo 59 ms), answered after the `show` |
| `compileFile` during `show` | 1 ms (solo 1 ms)                                  | 1 ms (solo 0 ms)                                  |

`$/cancelRequest` 3 s into a long `show`:

- jaffle: no answer within 90 s, and the server stayed at 98–100% CPU for 5 s after the cancel, so the local query kept running ([`e2-show-concurrency-jaffle.json`](evidence/lsp-2.0.6/adoption/e2-show-concurrency-jaffle.json)).
- finance: the request answered with its full result at 61 s, and `information_schema.query_history` shows the query as `SUCCESS` after 60.1 s ([`e2-show-concurrency-finance.json`](evidence/lsp-2.0.6/adoption/e2-show-concurrency-finance.json)).

Decision: `show` and `listNodes` share one queue in 2.3; `compileFile` (and the other classes) keep their own. Cancelling does not stop the warehouse query, so 2.8 drops the result and says the query may still run. The Risks stop "one `show` blocks lineage for longer than 2 s" is met: lineage waited 10.5 s on finance and 36 s on jaffle. A shared queue does not remove the wait, because the server serialises the two internally. The plan owner decides before 2.8.

## E3: compiled SQL of unsaved text

Rule: after `didChange`, `compileFile` or an inline `dbt.show` must return compiled text for the buffer; otherwise D5 stands.

- `compileFile` after `didChange` returns the same `file_uri`, and the file holds the last saved compile without the marker.
- `dbt.show {inline: <buffer>, limit: 0}` runs the unsaved text (its columns include the marker column) but returns only `columns`, `data` and `error`, with no compiled SQL. `dbt.show {uri}` runs the saved file ([`e3-unsaved-compile-jaffle.json`](evidence/lsp-2.0.6/adoption/e3-unsaved-compile-jaffle.json)).

Decision: D5 stands. The server can execute unsaved text but cannot show it compiled.

## E4: error shapes and timings

Rule: a JSON-RPC error or a non-null `error` field is `server`; no answer is `timeout`; `listNodes` `No nodes found` / `lineage_query_failed` is an empty result; any other shape is reported as a new kind. Deadline = 4× the slowest sample, rounded up to 5 s, at least 5 s; `show` has none.

| Call                                          | jaffle                                             | finance                                                           | Kind                          |
| --------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| `show` SQL, render or catalog error           | `{columns:null,data:null,error}`                   | same; warehouse errors after 1.2–1.4 s, render errors after 60 ms | `server`                      |
| `show {uri}` of a file that is not a node     | `{columns:null,data:null,error:null}`              | same                                                              | **new**: no columns, no error |
| `compileFile` unknown URI or relative path    | `{error, file_uri:null}`                           | same                                                              | `server`                      |
| `compileFile` on a YAML file                  | `{error:null, file_uri}`                           | `Compiled file path not found.`                                   | `ok` / `server`               |
| `getCurrentNode` unknown path or absolute URI | `null`                                             | `null`                                                            | **new**: `null` result        |
| `listNodes` no match or bad selector          | `No nodes found`, `lineage_query_failed`           | same                                                              | empty result                  |
| `listNodes` object argument                   | `empty selector list passed to --select/--exclude` | same                                                              | `server`                      |
| any command with no arguments, `listNodes []` | `null`                                             | `null`                                                            | **new**: `null` result        |

Success timings, p50 (p95) of five: `show` 36 ms (42) on jaffle and 1,705 ms (2,114) on finance; `listNodes` 22 ms and 58 ms; `compileFile` and `getCurrentNode` under 1 ms on both. No call timed out ([`e4-error-shapes-jaffle.json`](evidence/lsp-2.0.6/adoption/e4-error-shapes-jaffle.json), [`e4-error-shapes-finance.json`](evidence/lsp-2.0.6/adoption/e4-error-shapes-finance.json)).

Decision: `FusionCommandError` keeps `server`, `timeout`, `notRunning` and `cancelled`, and the `listNodes` empty mapping stands. Deadlines: 5 s for `compileFile`, `getCurrentNode` and `listNodes`; none for `show`. The two new shapes need a mapping in 2.3: a `null` result (the server's answer for a path that is not a node and for malformed arguments) and a `show` with `columns: null` and `error: null` (a URI that is not a node).

## E5: two Declared Projects with command prefixes

Two servers started on `general` and `sox`, each with `--command-prefix fusionPowerUser:<projectRootDigest>:` as the extension sends it ([`e5-command-prefix-multi-root.json`](evidence/lsp-2.0.6/adoption/e5-command-prefix-multi-root.json)):

- `executeCommandProvider.commands` lists all seven commands with the project's prefix.
- Code lenses use the bare `dbt.previewCte` in both projects, with arguments `[<absolute path>, {compiled_path, compiled_start, compiled_stop, name, start, start_location, stop}]`.
- The prefixed name and the bare name both execute (`dbt.getProjectInfo` answers either way). The other project's prefix returns `null` without an error.

Decision: 2.9 matches lenses on the bare command `dbt.previewCte`, independent of the prefix. The extension keeps sending prefixed names.

## E6: disk-watch scope

Rule: edit a macro, `dbt_project.yml` and `packages.yml` outside the editor, with a new model as the control, and poll for 30 s. One run sends no notification; the other sends the `workspace/didChangeWatchedFiles` event that vscode-languageclient sends for the server's `**/*` registration. A file kind the server misses when notified gets a registry-triggered refresh.

| Edit                                | Seen by                   | strict, silent | strict, notified | baseline, silent | baseline, notified |
| ----------------------------------- | ------------------------- | -------------- | ---------------- | ---------------- | ------------------ |
| new model                           | `listNodes`               | 1.2 s          | 1.0 s            | 1.2 s            | 1.0 s              |
| macro body                          | compiled child            | 2.0 s          | 1.0 s            | 2.0 s            | 1.0 s              |
| `dbt_project.yml` materialization   | `listNodes` config        | 1.2 s          | 1.0 s            | 1.2 s            | 1.0 s              |
| `packages.yml` adds a local package | `listNodes package:<pkg>` | 1.2 s          | 1.0 s            | 1.2 s            | 1.0 s              |

Evidence: [`e6-disk-watch-jaffle.json`](evidence/lsp-2.0.6/adoption/e6-disk-watch-jaffle.json) (strict) and [`e6-disk-watch-jaffle-baseline.json`](evidence/lsp-2.0.6/adoption/e6-disk-watch-jaffle-baseline.json) (baseline). Jaffle only. A hub package that needs `dbt deps` was not tested, and the spike's finance baseline miss was not rerun.

Decision: the server reflects every edit kind, with or without the notification. No registry-triggered Server Producer refresh is added.

## E7: `workspace/willRenameFiles`

- Protocol: `initialize` advertises `workspace.fileOperations.willRename` with filter `**/*.{sql,csv}`. `willRenameFiles` for `stg_orders.sql` → `stg_orders_renamed.sql` returns edits to both children that `ref('stg_orders')` (`customers.sql`, `orders.sql`) and to two YAML files, 4 edits in all ([`e7-will-rename-jaffle.json`](evidence/lsp-2.0.6/adoption/e7-will-rename-jaffle.json)).
- Client, static only: the installed `vscode-languageclient` 10.1.1 registers `WillRenameFilesFeature`, and `fusionLanguageClient.ts` sets no middleware or option for file operations.

Decision: the server half passes. Whether VS Code and Cursor forward the request is **not established**, because it needs a model renamed in a running editor with the extension installed, which this script does not do. `docs/lsp-coverage.md` (added in 0.2) records the server half as covered and the client half as not established until someone renames a model by hand in both editors.

## E8: baseline mode

Rule: `listNodes ["package:<root>"]` in `baseline` passes if it returns every model node and `depends_on` edge that `strict` returns. A column fetch is `getCurrentNode`, falling back to `dbt.show` over `adapter.get_columns_in_relation` when it returns no columns; finance p50 above 3 s is a stop.

|                             | jaffle strict | jaffle baseline      | finance strict | finance baseline                |
| --------------------------- | ------------- | -------------------- | -------------- | ------------------------------- |
| models / edges              | 7 / 14        | 7 / 14               | 330 / 684      | 330 / 684                       |
| grain                       | project       | project              | project        | project                         |
| CTE lenses on the CTE model | 4             | 4                    | 4              | 4                               |
| `getCurrentNode` columns    | yes           | none (fallback used) | yes            | none (fallback used)            |
| column fetch p50            | 0 ms          | 37 ms                | 0 ms           | 2,049 ms (p95 4,095, max 5,460) |

Evidence: [`e8-baseline-mode-jaffle.json`](evidence/lsp-2.0.6/adoption/e8-baseline-mode-jaffle.json), [`e8-baseline-mode-finance.json`](evidence/lsp-2.0.6/adoption/e8-baseline-mode-finance.json). On two finance models the introspected relation has one column more than `strict` infers (31 against 30, and 41 against 40): the fallback reads the warehouse relation, not the model's SQL.

Decision: passes. `FIELD_OWNERS` keeps the graph fields server-owned in `baseline`, and 2.6 may delete the parse graph parsers. The 2.0 s column p50 is under the 3 s stop.

## E9: compiled paths under `lsp.compiledOutput: shared`

Rule: in `separate` (`DBT_LSP_USE_TARGET_LSP=1`) and `shared` (variable unset, as `toLspLaunch` does), `compileFile`'s `file_uri` and the CTE lens `compiled_path` must exist, hold compiled SQL and show a saved edit.

| Mode     | Path returned by both                                    | Exists, compiled | Reflects save | `target/.lsp/` created |
| -------- | -------------------------------------------------------- | ---------------- | ------------- | ---------------------- |
| separate | `<P>/target/.lsp/compiled/jaffle_shop/models/orders.sql` | yes              | yes           | yes                    |
| shared   | `<P>/target/compiled/jaffle_shop/models/orders.sql`      | yes              | yes           | no                     |

Evidence: [`e9-compiled-paths-jaffle.json`](evidence/lsp-2.0.6/adoption/e9-compiled-paths-jaffle.json).

Decision: both modes pass. The server returns the directory it writes to, so 2.7 and 2.9 read the returned paths verbatim, and the `shared` value stays.

## E10: compile reports caused by our own requests

Rule: for each of `dbt.listNodes`, `dbt.getProjectInfo` and `dbt.compileFile` sent to a project that has finished its first compile, count `dbt/lspCompileComplete` and `dbt/lspBackgroundCompileComplete` in the 8 s that follow and record their latency from the send.

- `dbt.listNodes ["+package:single_project"]`: one `dbt/lspCompileComplete` 16 to 19 ms after the request and one `dbt/lspBackgroundCompileComplete` 1,288 to 1,291 ms after it (two runs). Both carry `cause: "didSave"` and repeat the compile errors of the project, so they cannot be told apart from a report caused by a save.
- `dbt.getProjectInfo` and `dbt.compileFile` on an already compiled file: no report.
- A save (`didChange` plus `didSave`) also produces one report of each kind, the background one about 1.3 s later.

Decision: the earlier 1 s window would have missed the background report, which arrives after it closes. The Server Producer instead refreshes on a report only while its graph is stale (a source change, a client start or a failed fetch) and clears that flag when a fetch starts. Its own fetch's reports therefore start nothing at any latency. The integration test `listNodesCompileReport.test.ts` pins the report count per request, so a server that reports differently fails it before the loop returns.

## Not established

- **E2, local cancellation outcome**: on DuckDB the cancelled request did not answer within 90 s. Whether it would have answered with rows or an error was not observed before the server was stopped.
- **E7, client forwarding**: whether VS Code and Cursor send `workspace/willRenameFiles` for a model rename through the extension's client. It needs a rename by hand in both editors.
- **E6, finance and hub packages**: the disk-watch run used jaffle and a local package only.
