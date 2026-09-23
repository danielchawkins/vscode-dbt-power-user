# S2: dbt Fusion LSP command inventory

Captured on dbt Fusion 2.0.5. The server's `--project-dir` was a temporary copy of `src/test/fixtures/single-project`, so the file URIs and the project directory match, and the server does not write into the repository fixture. The copy keeps the fixture models: `child.sql` refs `broken_ref`, and `broken_ref` refs `missing_model`, which is not a file in the project. This run added `models/plain.sql`, whose text is `select 1 as id` and which has no `ref`. The profiles file is the fixture's dummy Snowflake profile. The client answers `window/workDoneProgress/create`.

## Advertised commands

`initialize` lists these `executeCommandProvider.commands`:

```text
dbt.listNodes
dbt.getCurrentNode
dbt.compileFile
dbt.compileLsp
dbt.clearTarget
dbt.getProjectInfo
dbt.show
```

`dbt.show` is in that list. `dbt.previewCte` and `dbt.goToDefinition` are not. `dbt.doesNotExist` returns `null` and no LSP error, and so do `dbt.previewCte` and `dbt.goToDefinition`. A `null` result does not show that those two names are registered.

With `--command-prefix fusion` the advertised names are `fusion` concatenated onto `dbt.` (`fusiondbt.listNodes`, and the same for the other six). On that server, immediately after `initialize`:

| Command                    | Result |
| -------------------------- | ------ |
| `fusion.getProjectInfo`    | `null` |
| `fusiondbt.getProjectInfo` | `{}`   |
| `dbt.getProjectInfo`       | `{}`   |

`fusion.getProjectInfo` matches the unknown-command result. The other two returned an empty object, not the project object below.

## Progress

`window/workDoneProgress/create` is followed by `$/progress`. The token suffix and the begin title observed for the commands that emit them:

| Command              | Token suffix                  | Begin title       | Begin message                          |
| -------------------- | ----------------------------- | ----------------- | -------------------------------------- |
| `dbt.listNodes`      | `dbt/progress/listNodes`      | Computing Lineage | Waiting for compilation to complete... |
| `dbt.compileFile`    | `dbt/progress/compileFile`    | Compiling File    | a path, redacted                       |
| `dbt.show`           | `dbt/progress/show`           | Running Preview   | Waiting for compilation to complete... |
| `dbt.getCurrentNode` | `dbt/progress/getCurrentNode` | Getting Columns   | Waiting for compilation to complete... |

A separate `$/progress` reports `Analyzing`, then `Parsing: models/broken_ref.sql`, `Parsing: models/child.sql`, and `Parsing: models/plain.sql`, then `kind: end`. `dbt.getProjectInfo` called before those parsing reports returned `models_count` 0 and `models_count_is_estimate` true. On an earlier run of the two fixture models, after that analyzing progress ended, the same command returned `models_count` 2 and `models_count_is_estimate` false.

## Command results

Calls below are after `textDocument/didOpen` of `file://<project>/models/plain.sql`, except where the arguments are `[]` and do not name a file. `<project>` is the temporary project directory.

| Command              | Arguments                                                              | Result                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `dbt.getProjectInfo` | `[]`                                                                   | `{"adapter_type":"snowflake","models_count":0,"models_count_is_estimate":true,"project_name":"single_project"}`                            |
| `dbt.listNodes`      | `[]`                                                                   | `null`, after the Computing Lineage progress ended                                                                                         |
| `dbt.compileLsp`     | `[]`                                                                   | `null`                                                                                                                                     |
| `dbt.clearTarget`    | `[]`                                                                   | `null`                                                                                                                                     |
| `dbt.compileFile`    | `["file://<project>/models/plain.sql"]`                                | `{"error":"Compiled file path not found.","file_uri":null}`                                                                                |
| `dbt.compileFile`    | `[{"uri":"file://<project>/models/plain.sql"}]`                        | `{"error":"File path invalid","file_uri":null}`                                                                                            |
| `dbt.compileFile`    | `[{"file_uri":"file://<project>/models/plain.sql"}]`                   | `{"error":"File path invalid","file_uri":null}`                                                                                            |
| `dbt.compileFile`    | `["<project>/models/plain.sql"]`                                       | `{"error":"relative URL without a base","file_uri":null}`                                                                                  |
| `dbt.show`           | `[{"uri":"file://<project>/models/plain.sql"}]`                        | `{"columns":null,"data":null,"error":null}`                                                                                                |
| `dbt.show`           | `["file://<project>/models/plain.sql"]`                                | `null`. Log: `Failed to deserialize dbt.show params: invalid type: string "file://<project>/models/plain.sql", expected struct ShowParams` |
| `dbt.getCurrentNode` | `[{"uri":"file://<project>/models/plain.sql","line":0,"character":7}]` | `null`                                                                                                                                     |
| `dbt.getCurrentNode` | `[]`                                                                   | `null`. On a client that does not answer progress, this call produced no response within 60 seconds.                                       |
| `dbt.previewCte`     | `[{"uri":"file://<project>/models/plain.sql"}]`                        | `null`                                                                                                                                     |
| `dbt.goToDefinition` | `[{"uri":"file://<project>/models/plain.sql","line":0,"character":7}]` | `null`                                                                                                                                     |
| `dbt.doesNotExist`   | `[]`                                                                   | `null`                                                                                                                                     |

`[]` for `dbt.show` logs `Missing dbt.show payload` and returns `null`. `[{}]` returns `{"columns":null,"data":null,"error":"invalid file selector: . relative URL without a base"}`. `[]` for `dbt.compileFile` logs `Missing compile file payload` and returns `null`.

No `dbt.compileFile` argument tried here returned compiled SQL. `dbt.show` returned `columns: null` with `error: null` on the dummy profile, including for `plain.sql`, so this run does not show a column type. `dbt.listNodes` returned `null` on a project that still contains the broken `ref`. These calls do not discharge the step 6.2 payload contract or the step 7.4 column-type question.

## Addendum: loaded DuckDB project (Fusion 2.0.5, 2026-09-23)

Ad hoc follow-up probes (not checked in) against `single-project` converted to a `duckdb` profile, spawned
with the project root as `cwd`, `DBT_LSP_USE_TARGET_LSP=1`, and a valid `base` → `child` chain (`broken_ref`
removed, matching the convention every checked-in integration test already uses for this fixture). See
`docs/refactor/fusion-editor-flow-evidence.md` (Working-DuckDB run) for the full method and the fixed
harness.

- `dbt.getProjectInfo` `[]` → `{"adapter_type":"duckdb","models_count":2,"models_count_is_estimate":false,"project_name":"single_project"}` — a real, non-estimated count, unlike the dummy-Snowflake run above.
- `dbt.compileFile` with a bare URI **string** argument (`["file://<project>/models/child.sql"]`, not an object) → `{"error":null,"file_uri":"file://<project>/target/.lsp/compiled/single_project/models/child.sql"}`. None of the shapes tried in the dummy-Snowflake run above used a bare string on a loaded project; this shape works.
- `dbt.show` with `[{"uri":"file://<project>/models/child.sql"}]` → a real DuckDB `Catalog Error` because `base` was never built as a physical relation — proof the command executes against the live warehouse, not a stub. It is not proof of a column-type contract; `base` still needs a prior `dbt build`/`run` for `dbt.show` on a dependent model to return rows.
- `dbt.listNodes` `[]` and `dbt.getCurrentNode` `[{"uri":...,"line":0,"character":20}]` both still returned `null` on this fully loaded project (verified via `getProjectInfo`'s accurate count above). Only the documented argument shapes were tried. This is now a genuine open question — not explained by an unloaded project or a wrong argument shape found so far — and needs product-side or further protocol investigation before concluding it is a Fusion server limitation.
- `textDocument/hover` on `ref("base")` → real content (`"**Children Models**\n\n- child"`). Hover on a macro call (`example()`, no package qualifier) on the same loaded project → `null`. Hover works for `ref()`/`source()` targets but not for any macro invocation tried, dotted or not — narrower than "hover is broken," and not specific to cross-package macros.
