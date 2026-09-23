# Settings and namespace migration

Fusion Power User renames extension-owned VS Code identifiers from `dbtPowerUser.*` to `fusionPowerUser.*` with no fallback reads and no deprecation aliases. This document covers the command and view migration shipped in the first namespace revision; configuration key mappings are added in the following settings revision and are not renamed yet.

## Command and view migration

Every contributed command ID `dbtPowerUser.<leaf>` becomes `fusionPowerUser.<leaf>` with the same leaf name. The 30 contributed commands are: `applyDeferConfig`, `buildChildrenModels`, `buildChildrenParentModels`, `buildCurrentModel`, `buildCurrentProject`, `buildParentModels`, `cancelCteProfiling`, `cleanCurrentProject`, `clearProfileResults`, `clearRunHistory`, `compileCurrentModel`, `copyModelName`, `diagnostics`, `executeSQL`, `generateSchemaYML`, `goToDocumentationEditor`, `installDeps`, `profileCtes`, `rerunFromHistory`, `runChildrenModels`, `runCurrentModel`, `runParentModels`, `runTest`, `showCompiledSQL`, `showRunSQL`, `sqlPreview`, `testCurrentModel`, `toggleProfileDecorations`, `validateProject`, and `viewInDocEditor`.

Runtime-only command IDs follow the same prefix rule but are not listed in `contributes.commands`: `pickProject`, `yamlRunModel`, `yamlTestModel`, `runCteWithDependencies`, `createModelBasedonSourceConfig`, and `test.getRuntimeTimings`.

The three contributed webview view IDs are `fusionPowerUser.PreviewResults`, `fusionPowerUser.Lineage`, and `fusionPowerUser.DocsEdit`. VS Code generates focus commands from each view ID: `fusionPowerUser.PreviewResults.focus`, `fusionPowerUser.Lineage.focus`, and `fusionPowerUser.DocsEdit.focus`. A fourth runtime-only webview type `fusionPowerUser.Default` is not contributed in `package.json`.

The build submenu ID is `fusionPowerUser.buildModel`. View container IDs (`dbt_view`, `dbt_preview_results`, `lineage_view`, `docs_edit_view`, `run_history_view`) and tree view IDs without the old prefix are unchanged; saved activity-bar and panel layout may reset after upgrade.

Saved workspace state for the active Declared Project used the key `dbtPowerUser.projectSelected` and is now `fusionPowerUser.projectSelected` with no fallback read of the old key. Existing selections are reset; pick the project once after upgrade via the project picker or any command that prompts for a project.

Keybindings bound to `dbtPowerUser.executeSQL` and `dbtPowerUser.sqlPreview` now target `fusionPowerUser.executeSQL` and `fusionPowerUser.sqlPreview`. User keybinding overrides in `keybindings.json` that reference the old command IDs must be updated manually.

The `dbtPowerUser.dbtInstalled` editor context key is removed entirely; no menu `when` clause depended on it.

Diagnostic source labels and the diagnostics output channel title change from `dbt Power User` to `Fusion Power User`. Problems-panel filters saved on the old source name no longer match until you recreate them on `Fusion Power User`.

Command palette category, activity-bar title, and the settings section display title in `package.json` now read `Fusion Power User`. Configuration property keys still use the `dbt.*` prefix until the settings namespace revision.

Fusion LSP wire commands (`dbt.listNodes`, `dbt.previewCte`, and the rest) are unchanged.

## Settings migration (following revision)

Configuration keys remain `dbt.*` at this release. A subsequent revision renames them to `fusionPowerUser.*` and extends this document with the full property mapping for consumer workspaces.
