# Settings and namespace migration

Fusion Power User renames extension-owned VS Code identifiers from `dbtPowerUser.*` / `dbt.*` to `fusionPowerUser.*` with no fallback reads and no deprecation aliases. Update every workspace, folder, and user `settings.json` before upgrading.

## Breaking change

There is no automatic migration and no alias layer. Keys under `dbt.*` that this extension used to own are ignored after upgrade. Both Fusion Power User and the official [dbt extension](https://marketplace.visualstudio.com/items?itemName=dbtLabsInc.dbt) previously contributed settings under the shared `dbt.*` prefix with distinct property ids. Fusion Power User now uses only `fusionPowerUser.*`; the official extension continues to use `dbt.dbtPath`, `dbt.formatOnSave`, `dbt.lsp.linter.enabled`, and its other keys.

## Command and view migration

Every contributed command ID `dbtPowerUser.<leaf>` becomes `fusionPowerUser.<leaf>` with the same leaf name. The 30 contributed commands are: `applyDeferConfig`, `buildChildrenModels`, `buildChildrenParentModels`, `buildCurrentModel`, `buildCurrentProject`, `buildParentModels`, `cancelCteProfiling`, `cleanCurrentProject`, `clearProfileResults`, `clearRunHistory`, `compileCurrentModel`, `copyModelName`, `diagnostics`, `executeSQL`, `generateSchemaYML`, `goToDocumentationEditor`, `installDeps`, `profileCtes`, `rerunFromHistory`, `runChildrenModels`, `runCurrentModel`, `runParentModels`, `runTest`, `showCompiledSQL`, `showRunSQL`, `sqlPreview`, `testCurrentModel`, `toggleProfileDecorations`, `validateProject`, and `viewInDocEditor`.

Runtime-only command IDs follow the same prefix rule but are not listed in `contributes.commands`: `pickProject`, `yamlRunModel`, `yamlTestModel`, `runCteWithDependencies`, `createModelBasedonSourceConfig`, and `test.getRuntimeTimings`.

The three contributed webview view IDs are `fusionPowerUser.PreviewResults`, `fusionPowerUser.Lineage`, and `fusionPowerUser.DocsEdit`. VS Code generates focus commands from each view ID: `fusionPowerUser.PreviewResults.focus`, `fusionPowerUser.Lineage.focus`, and `fusionPowerUser.DocsEdit.focus`. A fourth runtime-only webview type `fusionPowerUser.Default` is not contributed in `package.json`.

The build submenu ID is `fusionPowerUser.buildModel`. View container IDs (`dbt_view`, `dbt_preview_results`, `lineage_view`, `docs_edit_view`, `run_history_view`) and tree view IDs without the old prefix are unchanged; saved activity-bar and panel layout may reset after upgrade.

Saved workspace state for the active Declared Project used the key `dbtPowerUser.projectSelected` and is now `fusionPowerUser.projectSelected` with no fallback read of the old key. Existing selections are reset; pick the project once after upgrade via the project picker or any command that prompts for a project.

Keybindings bound to `dbtPowerUser.executeSQL` and `dbtPowerUser.sqlPreview` now target `fusionPowerUser.executeSQL` and `fusionPowerUser.sqlPreview`. User keybinding overrides in `keybindings.json` that reference the old command IDs must be updated manually.

The `dbtPowerUser.dbtInstalled` editor context key is removed entirely; no menu `when` clause depended on it.

Diagnostic source labels and the diagnostics output channel title change from `dbt Power User` to `Fusion Power User`. Problems-panel filters saved on the old source name no longer match until you recreate them on `Fusion Power User`.

Command palette category, activity-bar title, and the settings section display title in `package.json` now read `Fusion Power User`.

Fusion LSP wire commands (`dbt.listNodes`, `dbt.previewCte`, and the rest) are unchanged.

## Settings migration

| Old key                                      | New key                                                  | Scope    | Notes                                                                 |
| -------------------------------------------- | -------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `dbt.enabled`                                | `fusionPowerUser.enabled`                                | resource | Per workspace folder                                                  |
| `dbt.allowListFolders`                       | `fusionPowerUser.projects`                               | resource | Renamed earlier in the fork; same semantics as declared project roots |
| `dbt.projects`                               | `fusionPowerUser.projects`                               | resource |                                                                       |
| `dbt.staticAnalysisMode`                     | `fusionPowerUser.staticAnalysis`                         | resource |                                                                       |
| `dbt.fusionPath`                             | `fusionPowerUser.dbtPath`                                | resource |                                                                       |
| `dbt.dbtPythonPathOverride`                  | `fusionPowerUser.dbtPath`                                | resource | Removed earlier; use `dbtPath`                                        |
| `dbt.profilesDir`                            | `fusionPowerUser.profilesDir`                            | resource |                                                                       |
| `dbt.target`                                 | `fusionPowerUser.target`                                 | resource |                                                                       |
| `dbt.lintEnabled`                            | `fusionPowerUser.lint.enabled`                           | resource |                                                                       |
| `dbt.traceServer`                            | `fusionPowerUser.trace.server`                           | resource | Per Declared Project server tracing                                   |
| `dbt.lineage.defaultExpansion`               | `fusionPowerUser.lineage.defaultExpansion`               | window   |                                                                       |
| `dbt.unquotedCaseInsensitiveIdentifierRegex` | `fusionPowerUser.unquotedCaseInsensitiveIdentifierRegex` | window   |                                                                       |
| `dbt.runModelCommandAdditionalParams`        | `fusionPowerUser.run.additionalParams`                   | window   |                                                                       |
| `dbt.buildModelCommandAdditionalParams`      | `fusionPowerUser.build.additionalParams`                 | window   |                                                                       |
| `dbt.testModelCommandAdditionalParams`       | `fusionPowerUser.test.additionalParams`                  | window   | Now contributed in `package.json`                                     |
| `dbt.queryLimit`                             | `fusionPowerUser.query.limit`                            | window   |                                                                       |
| `dbt.queryTemplate`                          | `fusionPowerUser.query.template`                         | window   |                                                                       |
| `dbt.perspectiveTheme`                       | `fusionPowerUser.queryResults.theme`                     | window   |                                                                       |
| `dbt.prefixGenerateModel`                    | `fusionPowerUser.generateModel.prefix`                   | window   |                                                                       |
| `dbt.fileNameTemplateGenerateModel`          | `fusionPowerUser.generateModel.fileNameTemplate`         | window   |                                                                       |
| `dbt.deferConfigPerProject`                  | `fusionPowerUser.defer.perProject`                       | resource | Same object shape                                                     |

### Removed keys (delete from settings; no replacement)

| Key                                                                                                                                                                                                                   | Reason                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `dbt.dbtIntegration`                                                                                                                                                                                                  | Fusion-only product; no integration switch                          |
| `dbt.disableDepthsCalculation`                                                                                                                                                                                        | Depth decoration always on; opt-out removed                         |
| `dbt.showColumnNamesInLowercase`                                                                                                                                                                                      | Unquoted identifiers always normalized to lowercase                 |
| `dbt.mediumDepthThreshold` / `dbt.highDepthThreshold` / `dbt.lowDepthColor` / `dbt.mediumDepthColor` / `dbt.highDepthColor`                                                                                           | Fixed defaults inlined (5 / 10 / `#00ff00` / `#ffa500` / `#ff0000`) |
| `dbt.sqlFmtPath` / `dbt.sqlFmtAdditionalParams`                                                                                                                                                                       | Removed with the Python-backed sqlfmt formatter                     |
| `dbt.enableNewLineagePanel`                                                                                                                                                                                           | New lineage panel is the only panel                                 |
| `dbt.lineage.showSelectEdges` / `dbt.lineage.showNonSelectEdges`                                                                                                                                                      | Column-level lineage removed                                        |
| `dbt.installDepsOnProjectInitialization`                                                                                                                                                                              | Never auto-installs dependencies                                    |
| `dbt.queryScale`                                                                                                                                                                                                      | Only ever written, never read by the query results panel            |
| `dbt.altimate*` / `dbt.mcp*` / `dbt.enableCollaboration` / `dbt.enableNotebooks` / `dbt.disableQueryHistory` / `dbt.conversationsPollingInterval` / `dbt.enableMcpDataSourceQueryTools` / `dbt.dbtCustomRunnerImport` | Hosted Altimate and MCP features removed                            |
| `altimate.*`                                                                                                                                                                                                          | Hosted Altimate settings removed                                    |

## Consumer manual migration

1. Replace every Fusion Power User `dbt.*` key in `.vscode/settings.json`, `.code-workspace` files, and user settings using the table above.
2. Delete removed keys rather than leaving them in place; they have no effect.
3. Leave official dbt extension keys (`dbt.dbtPath`, `dbt.formatOnSave`, and so on) untouched if you use that extension alongside Fusion Power User.
4. Re-run `Fusion Power User: Collect diagnostics` after migration to confirm `fusionPowerUser.*` values appear in the output.

Example fragment:

```json
{
  "fusionPowerUser.enabled": true,
  "fusionPowerUser.projects": ["transformation/dbt/finance_general"],
  "fusionPowerUser.dbtPath": "${env:HOME}/.local/bin/dbt",
  "fusionPowerUser.staticAnalysis": "baseline",
  "fusionPowerUser.query.limit": 500
}
```
