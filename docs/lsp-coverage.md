# Language server coverage

One row per editor feature: the dbt Fusion 2.0.6 language server method that covers it, or "none". Evidence is [`lsp-capabilities-fusion-2.0.6.md`](research/lsp-capabilities-fusion-2.0.6.md); fields the server does not return are in [`lsp-metadata-gaps.md`](lsp-metadata-gaps.md). "Strict only" means the server answers only under `--static-analysis strict`.

| Feature                                      | 2.0.6 method                                                               | Limits                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Hover on `ref()`                             | `textDocument/hover`                                                       | Parents, children and column descriptions as Markdown; no types                                              |
| Hover on a column, alias or `*`              | `textDocument/hover`                                                       | Strict only                                                                                                  |
| Hover on `source()`, a macro call, YAML      | none                                                                       | `null`                                                                                                       |
| Go to definition: `ref`, macro, dotted macro | `textDocument/definition`                                                  | `source()` inside `{% set %}` returns `null`                                                                 |
| Go to definition: column, alias              | `textDocument/definition`                                                  | Strict only                                                                                                  |
| Find references                              | `textDocument/references`                                                  | Columns and aliases strict only; a YAML model name returns `null`                                            |
| Rename an alias or column                    | `textDocument/rename`                                                      | Strict only; no `prepareRename`                                                                              |
| Rename a model file                          | `workspace/willRenameFiles`                                                | Edits `ref()` calls and YAML `name:`; whether the client forwards it is not established                      |
| Completion in `ref('`                        | `textDocument/completion`                                                  | Models and seeds                                                                                             |
| Completion in `source('`                     | none                                                                       | 0 items                                                                                                      |
| Completion of macros, columns, tables, CTEs  | none                                                                       | Only the adapter's SQL function catalogue                                                                    |
| Signature help for macros                    | none                                                                       | `null`                                                                                                       |
| Document and workspace symbols               | none                                                                       | Not advertised                                                                                               |
| Folding, document links, highlights          | none                                                                       | `-32601`                                                                                                     |
| Inlay hints                                  | none                                                                       | Advertised; returns `[]`                                                                                     |
| Semantic highlighting                        | `textDocument/semanticTokens/full`, `/range`                               | Saved documents only; the TextMate grammars cover the rest                                                   |
| Formatting and fix-all                       | `textDocument/formatting`, `textDocument/codeAction` (`source.fixAll`)     | Fails with `exit code 1` on a nested-Jinja finance model                                                     |
| Diagnostics for nodes                        | pushed `textDocument/publishDiagnostics`, `dbt/lsp*CompileComplete.errors` | Pull diagnostics are a stub                                                                                  |
| Configuration errors that stop loading       | none                                                                       | Unknown target or unset `env_var` in `profiles.yml` produce nothing; the CLI `dbt parse` reports them        |
| Project name and adapter type                | `dbt.getProjectInfo`                                                       | `{}` until the first compile                                                                                 |
| Table lineage, parents and children counts   | `dbt.listNodes ["package:<root>"]` or n-hop selectors                      | Children inverted from `depends_on`; concurrent requests cancel each other; waits for a `dbt.show` in flight |
| Model depth                                  | `dbt.listNodes ["package:<root>"]`                                         | Computed client-side from `depends_on`                                                                       |
| Column lineage                               | `dbt.listNodes ["@<uid>", "+column:<uid>.<COL>+"]`                         | Strict only; the server's column spelling; none for finance models built by package macros                   |
| Model columns and types                      | `dbt.getCurrentNode [relpath]`                                             | Types strict only; one model per request                                                                     |
| Source columns and types                     | `dbt.show` with `adapter.get_columns_in_relation` in `inline`              | A warehouse query per source                                                                                 |
| Compiled SQL of a saved model                | `dbt.compileFile [uri]`                                                    | Reflects the last save                                                                                       |
| Compiled SQL of unsaved or untitled text     | none                                                                       | Neither `compileFile` after `didChange` nor `dbt.show` returns compiled text for the buffer                  |
| Query preview                                | `dbt.show [{inline, limit}]`, `[{uri, limit}]`                             | No column types and no compiled SQL in the result                                                            |
| CTE detection                                | `textDocument/codeLens` (`dbt.previewCte` arguments)                       | Saved documents only; offsets are UTF-8 bytes into the compiled file                                         |
| CTE preview and profiling                    | `dbt.show` on the compiled slice from the lens                             | `dbt.previewCte` is a client command                                                                         |
| Manifest freshness for server-owned fields   | the server's own compile on save and on disk changes                       | Covers models, macros, `dbt_project.yml` and `packages.yml` edits made outside the editor                    |
| Documentation editor fields                  | none                                                                       | Descriptions, tests, `meta`, tags, doc blocks: see the gaps document                                         |
| Macro inventory, doc blocks                  | none                                                                       | `resource_type:macro` and `resource_type:doc` give `No nodes found`                                          |
| Generic tests                                | none                                                                       | Never listed                                                                                                 |
| Metrics and semantic models                  | none                                                                       | Never listed                                                                                                 |
| Run, build, test, compile, `deps`, docs      | none                                                                       | CLI tasks                                                                                                    |
| `dbt.compileLsp`, `dbt.clearTarget`          | advertised                                                                 | Return `null` with no observable effect; unused                                                              |

## Not established

- Whether a cancelled `dbt.show` on DuckDB answers with rows or an error. On Snowflake it answers with its full result and the warehouse query completes.
- Whether VS Code and Cursor forward `workspace/willRenameFiles` through the extension's client.
- Whether the server's disk watch covers hub packages installed by `dbt deps`, and finance; it was run on jaffle with a local package.

The other questions are settled in the [adoption experiments](research/lsp-adoption-experiments-october-2026.md).

## Upstream gaps

Fusion behaviour the extension cannot change:

- Macro, source and YAML hover; `source('` completion; macro, column and CTE completion; macro signature help.
- `source()` inside a `{% set %}` block has no definition.
- Formatting and `source.fixAll` fail with `exit code 1` on a nested-Jinja model.
- Column lineage returns no nodes for models built by `kikoff.union_relations` and `temporalize.reconcile`, although their columns are typed.
- Configuration errors that stop the project loading produce no diagnostic, log line or notification.
- No command returns descriptions, columns at project grain, tags, `meta`, generic tests, macros, doc blocks, metrics or semantic models.
- `dbt/renameModel` and `dbt/renameColumn` notifications carry `{}`.
- Code lenses, semantic tokens and `dbt.compileFile` ignore unsaved text.
