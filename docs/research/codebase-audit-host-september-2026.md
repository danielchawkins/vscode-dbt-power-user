# fpu-work host audit

## 1. Altimate leftovers (41 non-test `altimate` hits)

- `AltimateWebviewProvider` base class: `src/webview_provider/altimateWebviewProvider.ts:51`, `panelDescription = "Altimate default webview"` :54, subclassed at `newLineagePanel.ts:93`, `queryResultPanel.ts:108`; type import in `services/sharedStateService.ts:2`. **PR:** rename to `WebviewPanelBase` (file + symbol).
- `@altimateai/ui-components ^0.0.88` (`webview_panels/package.json:25`) used in `modules/lineage/{LineageView.tsx:1-7,types.ts:1,ComputeColumnLineageButton.tsx:1,components/help/HelpButton.tsx:1}`; referenced in `src/fusion/columnLineage.ts:32`. **PR (larger):** vendor or replace the lineage component; keep separate.
- docs.myaltimate.com links: `queryPanel/constants.ts:4-16`, `lineage/components/help/HelpContent.tsx:35`, `documentationEditor/components/help/DocumentationHelpContent.tsx:55`, `TestsHelpContent.tsx:30`. **PR:** delete or point to repo docs.
- Stale comments: `dbtFusionCommandIntegration.ts:408`, `dbtIntegration.ts:387,430`, `docsEditPanel.ts:863`, `parsers/nodeParser.ts:42`; UI names `AltimateSelect`/`.altimate-select` (`uiCore/components/select/index.tsx:67,118`), `altimatePerspectiveViewer`, `alt="Altimate loader"` (`assets/icons/index.tsx:90`). **PR:** one rename/cleanup sweep.
- DataPilot: `DataPilotHealtCheckParams` `dbt_integration/domain.ts:110` (dead). `throwIfNotAuthenticated`: none left.
- `DBTConfiguration` (`dbt_integration/configuration.ts:1-7`): no fixed returns remain, but `getQueryTemplate`/`getQueryLimit` (`vscodeConfiguration.ts:42,51`) have no callers; `query.limit` is read directly in `dbtProject.ts:868`, `queryResultPanel.ts:148,486`. **PR:** drop the interface + unused methods; one `querySettings` helper.

## 2. Integration layering

Only implementer of `DBTProjectIntegration` (`dbtIntegration.ts:348`, ~40 methods) is `DBTFusionCommandProjectIntegration` (`dbtFusionCommandIntegration.ts:28`), which extends abstract `DBTBaseProjectIntegration` (`dbtBaseProjectIntegration.ts:12`, only subclass) and is subclassed once more by `ConfiguredFusionCommandProjectIntegration` (`configuredFusionCommandIntegration.ts:23`, overrides `wrapCommand`/`getDeferParams`). `FusionProjectIntegration` (`fusionProjectIntegration.ts:239`) wraps it via `requireIntegration()` :286 and forwards; `DBTProject` (`dbtProject.ts:94`) forwards again; `DBTProjectContainer` finds the project.
executeSQL: `commands/index.ts:775` → `RunModel.executeSQL` (`runModel.ts:153`) → `DBTProjectContainer.executeSQL` (`dbtProjectContainer.ts:133`) → `DBTProject.executeSQLOnQueryPanel`/`WithLimit` (`dbtProject.ts:865,916`) → `FusionProjectIntegration.runSql` (:1290) → `DBTFusionCommandProjectIntegration.executeSQL` (:410) → `wrapCommand` (Configured :87 → base :68) → `CLIDBTCommandExecutionStrategy.execute` (`dbtIntegration.ts:223`) → `CommandProcessExecution`. ~8 layers, 3 pure forwarders. compileNode same: `dbtProject.ts:563` → `fusionProjectIntegration.ts:1194` → `dbtFusionCommandIntegration.ts:519`.
**Collapsed shape:** `ProjectContainer` (lookup) → `Project` (state, queues, diagnostics, LSP metadata) → `FusionCli` (one concrete class: builds args incl. profiles dir/defer, runs process). Delete the interface, base class and Configured subclass. **PRs:** (a) fold Base+Configured into one `FusionCli`; (b) merge `FusionProjectIntegration` forwarders into `DBTProject`.

## 3. Inversify

`inversify.config.ts` (716 lines): 66 `.bind`, 61 `toDynamicValue`, 3 `toFactory`, 50 `inSingletonScope`, 128 `context.get`. Only 4 `@injectable` (`cteProfilerService.ts:16`, `vscodeConfiguration.ts:10`, `vscodeTerminal.ts:6`, `runHistoryService.ts:16`) and 17 `@inject` (15 are `"DBTTerminal"`, plus `Factory<DBTProjectLog>` `dbtProject.ts:141`, `Factory<DBTProject>` `dbtProjectContainer.ts:58`). The container is already hand-wiring every constructor, so it only adds string tokens and `reflect-metadata`. **PR:** replace with `src/compositionRoot.ts` of plain `new` calls (≈300 lines), delete decorators and the dependency.

## 4. Largest files

1. `dbt_client/fusionProjectIntegration.ts` 1385 → run-results parser (:149-237), executable/refresh lifecycle, forwarders (delete per §2).
2. `dbt_client/dbtProject.ts` 1317 → command queue (:1215-1310), diagnostics (:354-440), SQL/query (:865-928), schema/codegen (:753-864), defer (:1140-1214).
3. `webview_provider/docsEditPanel.ts` 1108 → message handlers per command, YAML writer, HTML shell (:1069).
4. `dbt_integration/dbtFusionCommandIntegration.ts` 1008 → `FusionCli` args, debug/profiles parsing (:116-200), JSON error parsing.
5. `lsp/fusionLanguageClient.ts` 1000 → pure launch/selector helpers (:119-335), process/stream (:336-431), client impl (:473-944).
6. `webview_provider/newLineagePanel.ts` 876 → handler table + lineage data mapper.
7. `commands/index.ts` 821 → registrations by area (run, query, diagnostics :390).
8. `code_lens_provider/cteCodeLensProvider.ts` 819 → CTE SQL parser (pure) + lens provider.
9. `inversify.config.ts` 716 → composition root (§3).
10. `dbt_integration/parsers/relationshipParser.ts` 678 → declared vs inferred relationships.

## 5. Invocation-context resolution sites

- Executable + env: `fusion/fusionExecutable.ts:188` (`dbtPath` setting, `inheritedEnv` :61), called from `lsp/fusionClientPool.ts:213` and `fusionProjectIntegration.ts:400`; env wrapped by `projectFusionProcessEnvironment.ts:6`, merged at `dbtIntegration.ts:262-266`.
- Profiles dir/target: `lsp/fusionClientSettings.ts:83-115`, used by `fusionLanguageClient.ts:664`, `fusionClientPool.ts:221`, `configuredFusionCommandIntegration.ts:89` (CLI adds only `--profiles-dir`, never `--target`); separately scraped from `dbt debug` (`dbtFusionCommandIntegration.ts:116-124`).
- Static analysis: `fusion/staticAnalysisMode.ts:25,35`, read at `fusionLanguageClient.ts:509,665,962`, `columnLineageRefreshController.ts:9`; hard-coded `strict` at `dbtFusionCommandIntegration.ts:510`.
- Per-call env: `columnLineageRefresh.ts:135`.
- Note: `columnLineageRefresh.ts` and `columnLineageRefreshController.ts` were removed when column lineage moved to the language server.
- Project dir/cwd: `--project-dir` in `fusionLanguageClient.ts:247`; CLI uses `cwd=projectRoot` (`dbtFusionCommandIntegration.ts:70`).
- Defer: `dbtProject.ts:1175`.
  **PR:** one `resolveInvocationContext(projectRoot)` → `{executable, env, profilesDir, target, staticAnalysis, defer}` used by LSP launch and CLI; apply `--target` to CLI too.
