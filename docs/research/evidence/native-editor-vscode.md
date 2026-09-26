# Native Fusion editor features through VS Code

> **Run record only.** Superseded by [README.md](README.md), the consolidated evidence. Where this file names `DBT_STATIC_ANALYSIS`, `DBT_GENERATE_INFO_SCHEMA`, `DBT_INFO_SCHEMA_DIR`, `DBT_METADATA_DIR` or `DBT_TARGET_PATH` as configuration, it used legacy or undocumented names; see README "Superseded premises". The experiments that tested only those names (`c3`, `l5`) have been deleted.

Captured 2026-09-26. This note records what dbt Fusion 2.0.6's language server returns for hover, definition, references, rename and code lens when the request goes through VS Code, `vscode-languageclient` and Fusion Power User, and compares that with the raw JSON-RPC client results in [E3](../fusion-lineage-evidence-2026-09-26.md#e3-native-editor-features-by-static-analysis-mode-no-prior-compile).

Evidence files (two identical runs; every call's serialised value matched between them):

- [`native-editor-vscode-run1.json`](native-editor-vscode-run1.json), recorded 2026-09-26T14:59Z
- [`native-editor-vscode-run2.json`](native-editor-vscode-run2.json), recorded 2026-09-26T15:02Z

## Method

### Versions

| Item                    | Value                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| dbt Fusion              | `dbt 2.0.6`, `/Users/daniel/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.6/dbt` |
| dbt sha256              | `9fc5cd633558235a5eb4e265b5fea2aa8dbb4eb803a5e13872e6e80a5bbd4c15`                           |
| VS Code                 | 1.128.0 (`@vscode/test-electron` download, darwin-arm64)                                     |
| `vscode-languageclient` | 10.1.1                                                                                       |
| Node (runner)           | v24.21.0                                                                                     |
| Host                    | Darwin 25.5.0 arm64                                                                          |

The dbt path, version and sha256 are `meta.dbtOnExtensionHostPath` in each evidence file: the test resolved `dbt` on the extension host's `PATH`, ran `dbt --version` from there and hashed the binary. `fusionPowerUser.dbtPath` was unset, so the extension resolved the same `PATH` entry. `meta.fusionLspProcesses` holds the `ps` argv of the running server, which starts with that same 2.0.6 path. The `PATH` came from the `justfile` (`mise bin-paths`), which puts the repository's `mise.toml` pin (`aqua:getdbt.com/dbt-fusion = "2.0.6"`) first.

### Command

Run from `/Users/daniel/projects/fpu-ev-editor-matrix`:

```sh
FPU_RUN_NATIVE_EDITOR_EVIDENCE=1 \
NATIVE_EDITOR_EVIDENCE_OUT=/tmp/fpu-em/native-editor-evidence.json \
FPU_KEEP_WORKSPACE=1 \
just test-integration
```

The second run used `NATIVE_EDITOR_EVIDENCE_OUT=/tmp/fpu-em/native-editor-evidence-2.json` without `FPU_KEEP_WORKSPACE`. `just test-integration` runs `just clean`, `npm run build:dev`, `npm run compile:integration` and `node out/test/integration/runTests.js`. Both runs exited 0. The existing single-project launch (47 passing, 16 pending) and the symlinked launch (3 passing) ran first, because the recipe always runs them.

### Harness

`src/test/integration/runTests.ts` does two more launches when `FPU_RUN_NATIVE_EDITOR_EVIDENCE=1`, one for `strict` and then one for `baseline`. For each launch it:

1. copies `src/test/fixtures/native-editor/` (a copy of `scripts/evidence/fixture/`) to `<tmp>/fpu-integration-workspace-*/native-editor-<mode>`;
2. writes `.vscode/settings.json` with `fusionPowerUser.staticAnalysis: <mode>`, `fusionPowerUser.profilesDir: ${workspaceFolder}` and `fusionPowerUser.lint.enabled: false`;
3. runs `dbt run-operation setup_raw --profiles-dir <dir>` in that directory (exit 0 in all four launches; `meta.setupRaw`), so the DuckDB source tables exist and no `.duckdb` file is committed;
4. opens VS Code on that folder with a fresh user-data directory, `DBT_PROFILES_DIR` and `DBT_ENGINE_PROFILES_DIR` set to an empty decoy directory (as the existing launches do), `FPU_NATIVE_EDITOR_MODE=<mode>` and `FUSION_POWER_USER_SCHEMA_ORIGIN=local`.

`src/test/integration/index.ts` runs only `nativeEditorFeatures.test.js` in those launches. The test waits for activation, opens the four models, and calls each command once. The two exceptions are hover on `ref('stg_orders')`, which retries for up to 90 s as a readiness gate, and hover on `*`, which retries for up to 20 s while its result is empty. The other calls ran once each (`attempts: 1`).

### Server environment and argv

The extension has no setting for extra server environment variables. It passes the extension host's whole `process.env` to `dbt lsp` (`inheritedEnv()` in `src/fusion/fusionExecutable.ts:60`, spread into the spawn env at `src/lsp/fusionLanguageClient.ts:682-685`, which also adds `DBT_LSP_USE_TARGET_LSP=1`). `FUSION_POWER_USER_SCHEMA_ORIGIN=local` therefore reached the server through `extensionTestsEnv`. The test read it back from the extension host (`meta.extensionHostEnv.FUSION_POWER_USER_SCHEMA_ORIGIN: "local"`). Server argv recorded from `ps` (strict run 1):

```text
dbt lsp --socket 56212 --project-dir <dir> --lint-enabled false --static-analysis strict --no-version-check
  --command-prefix fusionPowerUser:yD-RSAQa5PDA: --profiles-dir <dir>
```

The baseline argv is the same apart from `--static-analysis baseline`, the port and the prefix. Unlike E3, it has no `--log-level-file` or `--otel-file-name`, and `target/` was not deleted before the server started.

VS Code opened the models with language id `sql` (`meta.languageIds`), which the client's document selector includes.

### Positions

Positions are the E3 step file's (`scripts/evidence/steps/editor-features.json`), resolved with `indexOf(find) + offset`. Ranges below are zero-based `line:char-line:char` as VS Code returned them.

## Results

"No result." is the message that `vscode.executeDocumentRenameProvider` rejected with. It is VS Code's text when every rename provider returns nothing. The E3 column quotes [the E3 table](../fusion-lineage-evidence-2026-09-26.md#e3-native-editor-features-by-static-analysis-mode-no-prior-compile).

### strict

| Call                                                            | Recorded through VS Code                                                                                                           | E3 raw client, strict                                          | Same?                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| `executeHoverProvider` `*` in `stg_orders`                      | table: `amount decimal(10, 2)`, `customer_id integer`, `id integer`, `note varchar`, `status varchar`, all `probe.main.orders`     | the same five columns, types and origin                        | yes                                                         |
| `executeHoverProvider` `customer_id` in `order_totals`          | `customer_id \| integer \| probe.main.stg_orders`, range `0:7-0:18`                                                                | `customer_id`, `integer`, origin `probe.main.stg_orders`       | yes                                                         |
| `executeHoverProvider` alias `total`                            | `total \| decimal(38, 2)`, range `0:35-0:40`                                                                                       | `total`, `decimal(38, 2)`                                      | yes                                                         |
| `executeHoverProvider` `ref('stg_orders')` (readiness)          | parent `orders`, child `order_totals`, and a column table                                                                          | parent and child models plus the column list                   | yes                                                         |
| `executeDefinitionProvider` `customer_id` in `order_totals`     | `stg_orders.sql` `0:7-0:8`                                                                                                         | `stg_orders.sql:0:7`                                           | yes                                                         |
| `executeDefinitionProvider` `total` in `totals_downstream`      | `order_totals.sql` `0:20-0:40`                                                                                                     | `order_totals.sql:0:20`                                        | yes                                                         |
| `executeReferenceProvider` alias `total`                        | `order_totals.sql` `0:35-0:40`, `totals_downstream.sql` `0:20-0:25`                                                                | `order_totals.sql:0:35`, `totals_downstream.sql:0:20`          | yes                                                         |
| `vscode.prepareRename` alias `total`                            | `{ range: 0:35-0:40, placeholder: "total" }`                                                                                       | `textDocument/prepareRename` error `No such method`            | no: VS Code resolved it; the raw error does not surface     |
| `executeDocumentRenameProvider` alias `total` → `total_amount`  | `order_totals.sql` `0:35-0:40` and `totals_downstream.sql` `0:20-0:25`, `newText` `total_amount`                                   | edits `order_totals.sql` 0:35 and `totals_downstream.sql` 0:20 | yes                                                         |
| `executeDocumentRenameProvider` `customer_id` → `cust_id`       | rejected: `Cannot rename a column that is not an alias.`                                                                           | error `Cannot rename a column that is not an alias.`           | yes; the server message reaches the caller unchanged        |
| `executeDocumentRenameProvider` alias `label` → `customer_name` | `hard.sql` `6:19-6:24`, `newText` `customer_name`                                                                                  | edit `hard.sql` 6:19                                           | yes                                                         |
| `executeCodeLensProvider` `order_totals`                        | two lenses at `0:0`: `$(play) Execute Query` (`fusionPowerUser.executeSQL`), `$(book) Document` (`fusionPowerUser.DocsEdit.focus`) | `null`                                                         | Fusion part yes (none); both lenses are the extension's own |

### baseline

| Call                                                            | Recorded through VS Code                               | E3 raw client, baseline                           | Same?                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------- |
| `executeHoverProvider` `*` in `stg_orders`                      | `[]` after 80 attempts over 20 s                       | `null`                                            | yes                                                             |
| `executeHoverProvider` `customer_id` in `order_totals`          | `[]`                                                   | `null`                                            | yes                                                             |
| `executeHoverProvider` alias `total`                            | `[]`                                                   | `null`                                            | yes                                                             |
| `executeHoverProvider` `ref('stg_orders')` (readiness)          | parent `orders`, child `order_totals`; no column table | parent and child models                           | yes                                                             |
| `executeDefinitionProvider` `customer_id` in `order_totals`     | `[]`                                                   | `null`                                            | yes                                                             |
| `executeDefinitionProvider` `total` in `totals_downstream`      | `[]`                                                   | `null`                                            | yes                                                             |
| `executeReferenceProvider` alias `total`                        | `[]`                                                   | `null`                                            | yes                                                             |
| `vscode.prepareRename` alias `total`                            | `{ range: 0:35-0:40, placeholder: "total" }`           | error `No such method textDocument/prepareRename` | no: VS Code resolved it although the rename then yields nothing |
| `executeDocumentRenameProvider` alias `total` → `total_amount`  | rejected: `No result.`                                 | `null`                                            | yes (`null` becomes `No result.`)                               |
| `executeDocumentRenameProvider` `customer_id` → `cust_id`       | rejected: `No result.`                                 | `null`                                            | yes                                                             |
| `executeDocumentRenameProvider` alias `label` → `customer_name` | rejected: `No result.`                                 | `null`                                            | yes                                                             |
| `executeCodeLensProvider` `order_totals`                        | the same two extension lenses as strict                | `null`                                            | Fusion part yes (none)                                          |

## What the recorded runs show

- With `fusionPowerUser.staticAnalysis: strict` and `FUSION_POWER_USER_SCHEMA_ORIGIN=local` in the extension host environment, every E3 strict result for these calls came back the same through VS Code: the `*` column table, column and alias hovers, column definitions, alias references, the two-file alias rename, the `label` rename in `hard.sql`, and the non-alias rename error (`strict.results` in both evidence files).
- With `baseline`, every column-level call returned an empty result or `No result.`, and hover on `ref('stg_orders')` still returned parent and child models (`baseline.results`). This matches E3 baseline. It is also consistent with the extension's default being `baseline`, but only the fixture's explicit setting was tested.
- `vscode.prepareRename` on alias `total` returned the word range `0:35-0:40` with placeholder `total` in both modes, and did not reject (`*.results["prepareRename alias total"]`). In E3 the server advertised `"renameProvider": true` with no `prepareProvider`. `vscode-languageclient` 10.1.1 installs a `prepareRename` handler only when `prepareProvider` is set (`node_modules/vscode-languageclient/lib/common/rename.js:102`). So the `No such method` error seen by the raw client is most likely never triggered through VS Code, and VS Code falls back to the word at the cursor. No protocol trace was captured through VS Code, so these runs do not show directly whether `textDocument/prepareRename` was sent.
- One consequence of that fallback, as the API reports it: in `baseline`, and for a non-alias column in `strict`, the prepare step accepts the position. The failure only shows after a name is entered, as `No result.` in `baseline` and as the server message `Cannot rename a column that is not an alias.` in `strict` (`baseline.results["rename …"]`, `strict.results["rename customer_id -> cust_id"]`). The rename UI itself was not driven.
- Fusion contributed no code lenses for `order_totals.sql` in either mode. The two lenses returned are the extension's own `SqlActionsCodeLensProvider` (`*.results["codeLens order_totals"]`).
- The strict answers were available within 257 ms of opening the files, and the column calls took 0 to 2 ms each. References took 1.3 s (`elapsedMs`), and none needed a retry. `target/` was not cleared before the server started, unlike in E3.

## Not established

- Cursor, or any host other than VS Code 1.128.0 from `@vscode/test-electron`, was not tested.
- Remote source schemas (`FUSION_POWER_USER_SCHEMA_ORIGIN` unset or `remote`) were not tested through VS Code.
- The extension's default static-analysis mode was not exercised as a default; `baseline` was set explicitly in the fixture's `.vscode/settings.json`.
- Changing `fusionPowerUser.staticAnalysis` while a window is open and letting the client pool restart the server was not tested. Each mode was a separate VS Code launch on a fresh fixture copy.
- Whether `vscode-languageclient` sent `textDocument/prepareRename` was not observed; `fusionPowerUser.trace.server` was `off` and no transcript was kept.
- The interactive rename UI (F2 widget, preview, applying the `WorkspaceEdit`) was not driven; only the `vscode.*` API commands were called, and no edit was applied.
- Behaviour with the extension's own providers turned off was not tested. In this revision the extension registers code lens providers only (`src/code_lens_provider/index.ts:19-47`), and no hover, definition, reference or rename providers, so nothing else could merge with the Fusion results for these calls.
- Inlay hints, completion, document symbols, formatting and diagnostics were outside this matrix.
- Two runs on one machine agree. Timing figures are single samples.
