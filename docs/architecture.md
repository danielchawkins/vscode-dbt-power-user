# Architecture

Contracts and decisions live in [`docs/adr/`](adr/); this document links to them rather than restating them.

## Activation

`src/extension.ts` calls `DBTPowerUserExtension.activate` in `src/dbtPowerUserExtension.ts`, the single activation path. Every collaborator is constructed beforehand through the Inversify container in `src/inversify.config.ts`. Activation first checks for the conflicting upstream `innoverio.vscode-dbt-power-user` extension and blocks with one actionable error if present, then checks the resource-scoped `fusionPowerUser.enabled` setting. It then initializes the Project Registry, the Fusion client pool, and Fusion status reporting, registers Fusion client diagnostics, and builds the initial `Project` set. Startup is silent — only user-invoked actions and blocking configuration failures may show a notification, per decision 9 and plan step 5.4 (`src/fusion/fusionStatus.ts`).

## Declared Projects: Project Registry and Current Project

A Declared Project is a dbt project that receives independent editor services, scoped so a Dependency Project never gets its own service and nothing is discovered recursively, per [ADR 0003](adr/0003-scope-services-to-declared-projects.md). `ProjectRegistry` resolves the set per workspace folder from an explicit `fusionPowerUser.projects` list of relative or absolute roots, or the folder root itself when it contains `dbt_project.yml` and no list is set; any invalid entry or missing `dbt_project.yml` in an explicit list fails that folder's whole project set closed rather than silently dropping just the bad entry. `CurrentProject` resolves which Declared Project owns the file or command currently being handled, so nothing infers a project silently outside the active editor's project, a folder's sole project, a retained selection, or an explicit user pick.

## Executable resolution

`src/fusion/fusionExecutable.ts` resolves the `dbt` executable independently per Declared Project — the resource-scoped `fusionPowerUser.dbtPath` setting first, then `PATH` — never invoking or special-casing a tool manager; see the README for what that means for `mise-vscode` and similar shims. A resolution failure records a diagnostic for that project only and does not block sibling projects or activation. `--version` is checked against a minimum of 2.0.5; an untested newer major logs one terminal warning per major per installation, recorded in `globalState` and never a toast, then continues.

## dbt file associations

`package.json` contributes `filenamePatterns` for dbt's standard layout. For other layouts, "Configure dbt file associations" (`FileAssociationsCommand` in `src/features/projectSetup/fileAssociations.ts`) writes one `jinja-sql` glob per template path of every Declared Project, built by `dbtTemplateAssociations` in `src/dbt_integration/dbtAssociations.ts`. It writes user settings because VS Code rejects folder-scoped `files.associations`. Globs are absolute because a folder-relative `**/<dir>/**/*.sql` also matches dbt's compiled copies under `target/compiled/<project>/<dir>/`. VS Code globs have no escape character, so `*`, `?`, `[`, `]` and `}` are wrapped in one-character classes and `( ) !` stay literal; a literal `{` cannot be expressed because brace tracking also runs inside classes, so such directories are skipped, as is a template path equal to the project root, whose glob would capture `target/`. Each run removes `jinja-sql` template globs inside a project root that the project no longer declares, keeps every other entry, and compares keys case-insensitively on macOS and Windows, where VS Code matches globs case-insensitively. `src/test/vscodeGlob.ts` copies VS Code's glob matcher so tests check patterns against the real semantics.

## The Fusion client pool and operation routing (target)

`src/fusion/fusionClientPool.ts` owns one `FusionClient` per Declared Project, created and torn down as the registry and launch-affecting configuration change, over the reverse-socket transport from plan step 5.2, per [ADR 0002](adr/0002-use-the-native-fusion-lsp.md). The pool serializes reconciliation through an internal operation chain so overlapping registry and configuration events cannot race a client's replacement. Each client is launched from `toLspLaunch` over the project's snapshot; a settings change replaces the client only when that launch differs, and a manual or crash restart reuses the launch captured when the client was created, including the `FUSION_POWER_USER_LSP_COMPILED_OUTPUT` override read at that time.

Plan section 2.9 sets the target operation routing: the Fusion client becomes authoritative for realtime completions, hovers, definitions, references, renames, formatting, code actions, lenses, and diagnostics, and direct CLI invocations of the same resolved executable handle only operations the LSP has no command for. That target is reached for editor features: step 5.6 deleted the legacy manifest-backed completion, definition and hover providers, and `vscode-languageclient` registers every provider Fusion advertises. Extension code lenses remain because Fusion returns none.

## The metadata port

The codebase is manifest-driven: `dbt parse` produces `manifest.json`, and `Project` (`src/projects/project.ts`) builds the metadata maps through `ManifestRebuild` behind `ManifestCacheProjectAddedEvent` (`src/dbt_client/event/manifestCacheChangedEvent.ts`). `src/metadata/projectMetadataSource.ts` declares `ProjectMetadataSource`, the port every producer implements; `src/metadata/manifestMetadataSource.ts` is the only implementation, a thin adapter over `Project.rebuildManifest` and manifest publication. Every panel, tree, lens, and language provider consumes the event through `QueryManifestService`, which is the sole mediator and must not gain a second consumer seam.

The Fusion LSP does not populate this port: `dbt.getProjectInfo`, `dbt.listNodes`, and `dbt.getCurrentNode` lack macros, docs, exposures, tests, metrics, semantic models, and depth inputs (see [`docs/lsp-metadata-gaps.md`](lsp-metadata-gaps.md)). A source that always refuses to publish is dead code, so no LSP metadata source exists; the manifest source remains selected until a contract-complete LSP payload exists.

`Project` runs dbt through `FusionCli`, owns model, macro, seed, and `dbt_project.yml` watching, and reads `run_results.json` only after a command it launched and awaited, comparing pre- and post-command content; it has no ambient `target/` watcher.

## Panels and webview messaging

Three panels remain: query results, the local documentation editor, and lineage (`src/features/queryResults/`, `src/features/docs/`, `src/features/lineage/`). Each registers as a `WebviewViewProvider` with `retainContextWhenHidden`. `QueryResultPanel` and `LineagePanel` extend `PanelHost` (`src/webview/panelHost.ts`), which renders the shared bundle and routes common commands; `LineageViewProvider` is the registered sidebar host that delegates to `LineagePanel`. The extension host and the webview (React 18 + Vite + Redux Toolkit, built separately under `webview_panels/`) communicate through `postMessage`/`onDidReceiveMessage` with typed message contracts.
