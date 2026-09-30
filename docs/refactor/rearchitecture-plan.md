# Rearchitecture plan

This plan replaces [`fusion-lsp-plan.md`](fusion-lsp-plan.md), [`remaining-implementation.md`](remaining-implementation.md) and [`column-lineage-ship-plan.md`](column-lineage-ship-plan.md) as the authoritative plan. Those documents are closed and kept as history; their outcome is recorded in [Closing the v1 refactor](#closing-the-v1-refactor). Vocabulary is [`CONTEXT.md`](../../CONTEXT.md); decisions are in [`../adr/`](../adr/); landing rules are in [`implementation-dispatch.md`](implementation-dispatch.md).

Evidence:

- [`../research/codebase-audit-host-september-2026.md`](../research/codebase-audit-host-september-2026.md) — host layering, Altimate leftovers, Inversify use, file sizes, invocation-context sites.
- [`../research/codebase-audit-webview-september-2026.md`](../research/codebase-audit-webview-september-2026.md) — dependencies, advisories, styling stacks, messaging, CSP, dead webview code.
- [`../research/vscode-extension-practice-september-2026.md`](../research/vscode-extension-practice-september-2026.md) — platform practice with citations.
- [`../research/fusion-lint.md`](../research/fusion-lint.md) — Fusion's linter and SQL front end.
- [`rearchitecture-critiques.md`](rearchitecture-critiques.md) — the review rounds this plan went through and what each changed.
- GitHub issues #110 (invocation context), #118 (query-result column types), #120 (highlighting roles).

## Principle

v1 reached a working Fusion-only beta by carrying inherited structure forward whenever that kept a step landable. That structure was built for three integrations, a Python bridge, a hosted service, and five styling systems. With one integration left, most of it is indirection with one implementation, and most recent defects were one fact resolved in several places: `getConfiguration` is called in 12 non-test files, `dbt_project.yml` is read in 13, a call to run SQL passes through eight layers, and the target a user selects reaches the language server but not the CLI.

Compression is the test. When a change or a review turns up many special cases, find the one model that makes them unnecessary, usually by using what VS Code, the language client, or dbt already provide. Every phase below removes one class of special cases by introducing one model or deleting one layer, and states the count that proves it.

Rules for every step:

- **One source of truth per fact.** A fact the extension needs (a project's paths, how dbt runs for it, a column's type, a file's language) is resolved in one module and passed to consumers. Consumers never re-read settings, environment, or `dbt_project.yml`.
- **Framework first.** Use a VS Code, language-client, or dbt mechanism when one exists: `contributes.languages.filenamePatterns` over runtime language switching, `LanguageStatusItem` over custom status UI, `getState`/`setState` over `retainContextWhenHidden`, workspace trust over ad hoc checks, Fusion's `node_columns` over inferring types.
- **Pure core, thin shell.** Logic that does not need `vscode` lives in modules that do not import it and is covered by unit and property-based tests. Modules that import `vscode` adapt events and APIs to that core and stay small.
- **Delete, don't wrap.** A layer with one implementation and no second planned is merged into its caller. An abstraction is introduced only with its second user or a named test seam.
- **Measured, not asserted.** A size or speed claim comes from the harness (`just smoke-visual`, the benchmarks, `vsce ls`); a user-visible claim comes from visual evidence reviewed against its text record.

## Closing the v1 refactor

v1 is complete for beta.

| v1 area                                                                   | Outcome                                                                                                                                                                                |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phases 0–4 (tooling, identity, characterization, cuts, Declared Projects) | Done. Project Registry is the scope authority.                                                                                                                                         |
| Phase 5 (LSP transport, client, lifecycle)                                | Done through 5.6: one Fusion Client per Declared Project over the reverse socket; legacy providers deleted.                                                                            |
| Phase 6 (metadata producer)                                               | Settled: the manifest source stays; the LSP cannot populate the contract ([`../lsp-metadata-gaps.md`](../lsp-metadata-gaps.md)).                                                       |
| Phase 7 (operation routing)                                               | 7.1 done. 7.2–7.6 are superseded by R3, which routes every CLI and LSP operation through one Project Snapshot.                                                                         |
| Phase 8 (deletions)                                                       | Done.                                                                                                                                                                                  |
| Phase 9 (namespace, docs, smoke, release)                                 | Done; `v0.4.0-beta.1` published.                                                                                                                                                       |
| Phase 10 (finance-pipelines adoption)                                     | Carried forward as R9.                                                                                                                                                                 |
| Column-lineage ship plan steps 1–8                                        | Done; step 8 was `v0.4.0-beta.1`. Steps 9–10 become R9 and R10.                                                                                                                        |
| v2 horizon                                                                | Carried forward, reduced and reordered as R6–R8. The contract package stays; the joint benchmark narrows to the lineage renderer because the styling decision no longer depends on it. |

Still open from v1: issues #110, #118, #120, and the ship plan's open questions (strict without authentication, view contents after a selective compile, downstream `select *` children), which become evidence tasks in R3.

## Target model

One resolved value per Declared Project, one selector, and thin features:

- **Project Snapshot** (pure value, `core/project/`): everything the extension knows about one Declared Project at one revision — `root`, `folder`, `paths` (from `dbt_project.yml` with dbt's defaults), and `invocation` (executable, target, profiles dir, static-analysis mode, compiled-output location, defer, environment). Built by one resolver from settings, the extension's environment overrides, and `dbt_project.yml`, each read once per revision. `profiles.yml` is not parsed: it holds dbt's `env_var` Jinja, which only dbt can evaluate. `target` is the setting, or unset for dbt's default; the adapter type comes from the manifest's `metadata.adapter_type`. `ProjectPaths` and the proposed `InvocationContext` are fields of this value, not separate concepts.
- **Project** (shell): holds the current snapshot and the current **manifest** (the Project Metadata Source's output; `ManifestCacheProjectAddedEvent` is replaced by `onDidChangeManifest`, so there is still one consumer seam) as a versioned value built from `manifest.json`, publishes `onDidChangeSnapshot(snapshot, changedFields)` and `onDidChangeManifest(manifest)`, owns the Fusion Client, the Fusion CLI, the diagnostic collection, and the run history for that project, and exposes the project's operations. It replaces `DBTProject`, `FusionProjectIntegration`, the command-integration class stack, and the four private manifest caches (`eventMap` in the model tree view, the webview base class, and both lineage panels).
- **Project Registry**: owns the set of Projects and lookup by resource; it absorbs `DBTProjectContainer`, whose 29 methods only forward to a found project.
- **Current Project** (selector, renamed from Project Context): answers which Project a file or command belongs to. It resolves nothing about how dbt runs.
- **Fusion CLI** and **Fusion Client**: take a snapshot and turn it into process arguments (pure `toCliArgs`, `toLspLaunch`) and a running process or client. No flag is hard-coded at a call site. Column lineage is not a CLI command: the Fusion Client serves it (ADR 0006).
- **Settings** (`src/settings/`): the only module that calls `getConfiguration` or listens to `onDidChangeConfiguration`. It returns typed, resource-scoped values and change events.

Rules that keep the model closed:

- **Change streams.** Only `projects/` subscribes to Settings for project-scoped values. Features subscribe to `Project`. Settings that do not describe a project (`queryResults.theme`, `lineage.defaultExpansion`, `query.limit`, `query.template`) are read by features through typed Settings readers and never enter the snapshot.
- **What makes a new snapshot revision:** a relevant configuration change, or the `dbt_project.yml` watcher the registry already owns. Nothing else.
- **Per-command overrides are a closed type:** `{ staticAnalysis?, select?, fullRefresh?, defer?: false }`. The `run`/`build`/`test` `additionalParams` settings are part of `snapshot.invocation.commandParams`, not read at call sites. Defer (state path, favor-state) is resolved into the snapshot; the defer status bar item only writes the setting.
- **User files are edited, never overwritten.** Every write to a file a user owns (schema YAML from the documentation editor, `dbt_project.yml`, generated models) goes through `WorkspaceEdit`, which respects unsaved buffers and undo. `fs` write APIs are allowed only for the extension's own storage and tests.

```text
extension.ts ── compositionRoot.ts   plain constructors, one place, no container
                  │
   settings/  ─── projects/  ────────────── features/<feature>/
   typed reads    Registry, Project,         commands, lenses, trees, panels:
   one listener   CurrentProject             each takes a Project, never a path
                  │
               fusion/  FusionClient, FusionCli, toCliArgs, toLspLaunch
                  │
               core/    pure: snapshot resolution, paths, globs, manifest parsing,
                        CTE detection, lineage mapping, column types, message protocol
```

Layer rules, checked by dependency-cruiser from R1: `core/` imports neither `vscode` nor any other layer; `settings/` and `fusion/` import `core/`; `projects/` imports those three; `features/` imports any lower layer; nothing imports `features/`; `webview_panels/` imports only `packages/webview-contract`. `CONTEXT.md` gains **Project Snapshot** in R2, and **Project**, **Fusion CLI** and **Current Project** in R3.5, which retires **Project Context** and redefines **Project Metadata Source** as the producer of `Project.manifest`.

## Phases

Each phase is a serial set of PRs, each green at its tip: `just check`; `just package` when packaging changes; `just smoke-visual` when the change is user-visible, with every screenshot reviewed against its record. Rollback is reverting the phase's PRs; no phase persists user data. Run `just lint-unused` at the end of each phase and before each release.

### R1 — Quality gates that encode the rules

Goal: make the principles mechanically checked before the restructuring starts.

1. **Done — type-aware, complexity and size lint with a shrinking baseline** (`build/quality-lint`). `eslint-suppressions.json` records existing violations of `complexity` (15), `sonarjs/cognitive-complexity` (15), `max-depth` (4), `max-params` (5), `max-lines` (600), `max-lines-per-function` (80), `no-explicit-any`, `no-floating-promises`, `no-misused-promises`, `await-thenable`, and duplication rules. New violations fail `just lint`; `just lint-prune` removes fixed entries, so the file only shrinks.
2. **Done — dead code on demand**: `just lint-unused` runs knip. Not in `check` or pre-push, because refactors pass through states with temporary dead code.
3. **Layer rules**: add dependency-cruiser with `no-circular` and `no-orphans` now; add each layer rule from [Target model](#target-model) in the PR that creates the layer (R2: `core/`, `settings/`; R3: `projects/`, `fusion/`; R4: `features/`). A rule lands passing; the PR that introduces it moves the code that would violate it.
4. **Settings rule**: `no-restricted-properties` on `workspace.getConfiguration` and `workspace.onDidChangeConfiguration` everywhere in `src/` except `src/settings/`, with the current call sites recorded in the baseline. R2 empties them.
5. **Property-based tests**: add `fast-check`. Properties live beside unit tests as `*.property.test.ts`, generators in `src/test/arbitraries/`, with a fixed `numRuns` and the seed printed on failure. First targets, all existing pure functions:
   - `resolveProjectPaths` / `isDbtTemplateFile`: for any declared path lists, a file under the target path is never a template, and a file under a declared model path always is.
   - `associatedLanguage`: agrees with VS Code's precedence — the longest matching pattern wins, and a pattern without `/` matches the file name only.
   - `buildFusionLspArgs`: every input yields a well-formed argument vector; `project` mode never emits `--static-analysis`.
   - `buildPerspectiveTableInit`: schema keys equal column names; a `string` column holds only strings or null.
   - CTE detection: a generated `with` clause of N CTEs yields N CTEs with their names, for any whitespace and comment placement.
   - Manifest graph builders: every edge's endpoints exist in the node map.
6. **Integration runner**: move integration tests to `@vscode/test-cli` with a `.vscode-test.mjs` defining trusted and untrusted-workspace labels, replacing the hand-rolled launch code in `src/test/integration/runTests.ts`; the packaged-VSIX smoke keeps its own runner (`src/test/smoke/runTests.ts`), which installs a VSIX into an ephemeral profile and is not a test-cli use case. R2's untrusted-workspace test needs it. (Unit tests move from Jest to Vitest after R4, when decorator metadata is gone and R3 has rewritten most suites.)
7. **Webview parity**: the same complexity and size rules for `webview_panels/`, with its own suppression baseline replacing the warning ratchet.
8. **User-file writes**: `no-restricted-imports` on `fs` write functions (`writeFile`, `writeFileSync`, `appendFile*`, `rm*`, `unlink*`) outside `src/test/` and the extension-storage module, with current call sites in the baseline; R3 and R6 empty it.
9. **One process module**: `no-restricted-imports` on `child_process` everywhere except `src/fusion/process.ts`, which R2 creates; current call sites (the version probe, the language server launch, CLI execution) go in the baseline and R2 moves them.
10. **Advisory stopgap**: pin a patched `maplibre-gl` through `overrides` in `webview_panels/package.json` now, so no release ships the critical advisory while R8 is pending. Exit: `npm audit` in `webview_panels/` reports no critical.

Verify: `just check` green; adding one violation of each new rule fails it.

### R2 — Workspace trust and the settings module

Goal: no setting is read outside `src/settings/`, and nothing runs a workspace-chosen executable in an untrusted workspace.

- **Workspace trust**: declare `capabilities.untrustedWorkspaces: { supported: false, description: "...runs dbt from the workspace's configuration." }`. VS Code then keeps the extension disabled until the user trusts the workspace and enables it on grant; grammars and language contributions still apply because they are declarative. No trust handling code is written.
- **`src/fusion/process.ts`**: the only module that imports `child_process`; the version probe, language server launch and CLI execution move behind it.
- **`src/settings/`**: one typed schema of every contributed setting with `readSetting`, resource-scoped for resource settings, and `onDidChangeSettings(keys, listener)`, whose change answers `affects(resource)` for the subscribed keys. Every former `getConfiguration` and `onDidChangeConfiguration` call outside the module now goes through it. Environment reads go through `src/settings/environment.ts`: the named overrides and harness switches in `environment.ts`, read at call time, plus the `${env:NAME}` lookup and the inherited child environment; `no-restricted-properties` forbids `process.env` elsewhere in `src/` outside tests. Typed change events per Declared Project, from one shared listener, need the Project Snapshot and land with it in R3 step 2, where the client pool restarts on a snapshot launch-field change.
- **`core/project/`**: `ProjectPaths` moves here from `src/dbt_integration/projectPaths.ts`, and the Project Snapshot type and pure resolver are added with it, fed by the settings module and one `dbt_project.yml` parse.

Verify: the settings rule's baseline is empty; the untrusted-workspace test label opens a fixture and observes the extension inactive and no spawned process; the `child_process` rule's baseline is empty; `grep -c dbt_project.yml` outside `core/project/` and the registry watcher is 0.

### R3 — One Project model

Goal: every dbt invocation derives from one snapshot (issue #110), and the path from the `fusionPowerUser.executeSQL` command to the process spawn passes through at most three modules (command → `Project` → `FusionCli`), down from eight today (host audit §2).

Serial PRs:

0. **Evidence first.** Run the experiments in step 7 before any code in this phase, because their outcomes decide steps 3 and the watcher design.
   0a. **Column lineage from the language server** ([ADR 0006](../adr/0006-column-lineage-from-fusion-static-analysis.md) as amended). Lands before step 1, so `FusionCli` never carries a lineage command.
   - **Read path:** a pure `core/lineage/` adapter maps `dbt.listNodes` results (column and model grain) to the panel's `ColumnLineage` types. `DbtLineageService.getConnectedColumns` asks the file's Fusion Client with `["@<unique_id>", "+column:<unique_id>.<column>+"]`. The panel re-requests after a project file is saved, and shows the client's state or the `baseline` static-analysis message instead of an empty graph. Property tests: every edge's endpoints appear in the node set; the adapter never invents a column absent from `parents`.
   - **Deletions:** `columnLineageRefresh.ts`, `columnLineageRefreshController.ts`, `lineageDiagnostics.ts`, the info-schema reader and query builder in `columnLineage.ts`, `compileColumnLineage` on every integration class, the `compileColumnLineage` kind in `core/cli`, the `fusionPowerUser.refreshColumnLineage` command, the panel's `computeColumnLineage` message and the refresh status. The schema-origin hook command stays; the client's environment carries `FUSION_POWER_USER_SCHEMA_ORIGIN`.
   - **Tests:** an integration test against the pinned Fusion binary opens the fixture, requests lineage for a column, edits and saves a model, and sees the new column with a `select *` child, with `target/` absent throughout.
   - **Exit:** `grep -rlE 'column_lineage|generate-info-schema|refreshColumnLineage' src` lists only test fixtures, the lineage panel's `column_lineage` response key (the lineage component's field name) and its tests, and the CLI property test asserting `--generate-info-schema` is never added.
1. **`FusionCli`** with pure `toCliArgs(snapshot, command, overrides)`: fold `DBTBaseProjectIntegration`, `DBTFusionCommandProjectIntegration` and `ConfiguredFusionCommandProjectIntegration` into one class; delete the `DBTProjectIntegration` interface. Error parsing becomes pure. `dbt debug` parsing and `getTargetNames` (no caller) are deleted: the snapshot has target and profiles dir, and the adapter type comes from the manifest. Exit: `grep -c DBTProjectIntegration src` is 0.
2. **`toLspLaunch(snapshot)`** replaces `resolveFusionLaunchSettings` and `buildFusionLspArgs`; the client pool restarts a client when a launch field of the snapshot changes, replacing `LAUNCH_SETTING_KEYS`; `src/lsp/` moves to `src/fusion/`. Property: for any snapshot, the CLI and LSP carry the same target, profiles dir, project dir and environment. Exit: `grep -c 'LAUNCH_SETTING_KEYS\|resolveFusionLaunchSettings\|buildFusionLspArgs' src` is 0.
3. **`Project`** absorbs `DBTProject` and `FusionProjectIntegration`: forwarders go. New files, each under the 600-line `max-lines` limit: `src/projects/project.ts`, `src/projects/manifest.ts` (the versioned manifest and its rebuild trigger), `src/projects/runResults.ts` (the reader and per-project run history), `src/projects/commandQueue.ts`, and `src/fusion/executableLifecycle.ts`. Exit: `grep -c eventMap src` and `grep -c ManifestCacheProjectAddedEvent src` are 0, and one `DiagnosticCollection` per project with `source` set replaces the three current collections.
4. **`ProjectRegistry`** absorbs `DBTProjectContainer`; every tree, lens, command, panel and the CTE profiler take a `Project`. Exit: `grep -c findDBTProject src` is 0.
5. **Names**: `DBTProject` → `Project`, `newLineagePanel` → `lineagePanel`, `AltimateWebviewProvider` → `PanelHost` (fully built in R6), Project Context → Current Project. The remaining Altimate references (host audit §1) go in the same PR. Exit: `grep -ci altimate src` and `grep -cw DBTProject src` are 0.
6. **Manifest parsers** move from `src/dbt_integration/parsers/` to `core/manifest/`. Exit: the directory is gone and the R1.5 graph properties pass from the new location.
7. **Evidence tasks**, each an experiment under `scripts/evidence/experiments/` with a decision rule fixed before it runs:
   - Strict without authentication on a fresh machine (`d1-strict-fresh-machine`): works online; no change.
   - Column lineage source (`d5-selective-compile-retention`, `d6-editor-after-narrow-view`, `d7-lsp-listnodes-column-lineage`): the language server answers `dbt.listNodes` with `["@<unique_id>", "+column:<unique_id>.<column>+"]` in about 30 ms, upstream and downstream, reflecting saved edits, with no CLI compile and no `target/`, as the official extension does. Under `--static-analysis baseline` it returns no column nodes. Decision: step 0a. No CLI fallback ships, because the command predates the 2.0.5 floor.
   - File watching (`d4-lsp-watch-registration`): Fusion registers `workspace/didChangeWatchedFiles` for `**/*` with the capabilities vscode-languageclient sends, so the language server gets file events through its own registration and the extension forwards none. The manifest rebuild trigger stays: in step 3, `src/projects/manifest.ts` replaces `FusionProjectIntegration`'s recursive `fs.watch` watchers with one `workspace.createFileSystemWatcher` per Declared Project.

   Evidence: [section 8 of the evidence README](../research/evidence/README.md#8-project-model-decisions-experiments-d1d4).

Verify: the host audit's call-path count re-measured and recorded; changing target in settings updates status, restarts the client, and applies to the next CLI command with no reload (integration test); the ESLint baseline shrinks by the deleted files' entries.

**Result (R3 complete).**

- **Call path, re-measured.** The `fusionPowerUser.executeSQL` path from command to process spawn now passes through three modules:
  - `RunModel.executeSQL` (`src/commands/runModel.ts`)
  - `Project.executeSQLOnQueryPanel`, through `projectSql.ts`
  - `FusionCli.show` → `run` (`src/fusion/fusionCli.ts`), which creates the process

  The audit counted about 8 layers with 3 pure forwarders. None of those forwarders remain: `DBTProjectContainer`, `FusionProjectIntegration` and the command-integration stack are all deleted.
- **Target change.** `src/test/integration/targetChange.test.ts` covers it in both native labels. Setting `fusionPowerUser.target` to `ci` restarts the project's client with `--target ci` in about 0.5 s, and the next compile reads from the `ci` database.
- **Baselines.**
  - The dependency-cruiser known-violation baseline fell from 18 to 5.
  - `eslint-suppressions.json` lost the entries of every deleted file: `dbtProjectContainer.ts`, `fusionProjectIntegration.ts`, `dbtProject.ts` and `dbt_integration/parsers/`.
- **Exit greps.** Each of these prints nothing in `src`:
  - `findDBTProject`
  - `DBTProjectContainer`
  - the word `DBTProject`
  - `ManifestCacheChangedEvent`
  - `eventMap`

  `grep -rli altimate src` lists only `dbt_integration/NOTICE.md`, the licence attribution, and the guard test that keeps the removed packages out.

### R4 — Composition root instead of Inversify

Goal: one readable wiring file with plain constructors. The container already calls every constructor by hand (66 bindings, 61 `toDynamicValue`, 4 `@injectable` classes), so this is mechanical; it follows R3 because R3 deletes about a third of the graph, and each R3 PR edits `inversify.config.ts` in place rather than adding bindings.

- `src/compositionRoot.ts` builds the graph in dependency order and returns the root disposables. Features receive what they use; no service locator, no string tokens.
- Remove `inversify`, `reflect-metadata`, `experimentalDecorators` and `emitDecoratorMetadata`. Then drop `ts-loader` and use rsbuild's built-in SWC transform; the bundle is already ESM on `engines.vscode ^1.128`, which the platform supports from 1.100.
- Each owner holds its own disposable collection; only roots go in `context.subscriptions`.
- **Activation**: remove the `workspaceContains:**/dbt_project.yml` event, which scans the workspace recursively against ADR 0003. Contributed languages, commands and views activate the extension. `activate` registers contributions synchronously and starts clients and probes without awaiting them.
- **`src/features/`**: commands, code lenses, tree views and panel hosts move under `src/features/<feature>/`, and the `features/` layer rule is added.
- **Unit test runner**: the last PR moves host unit tests from Jest + `ts-jest` to Vitest, which the webview already uses.

Verify: cold activation and extension bundle size within 10% of the `v0.4.0-beta.1` baseline or better; `activationEvents` has no `workspaceContains`; `just smoke` on both hosts; `npm ls inversify jest` empty.

### R5 — Framework-first editor integration

Goal: replace hand-rolled mechanisms with VS Code ones.

- **Languages**: contributed `filenamePatterns` and user `files.associations` precedence are done. Delete the open-time language switch (`DbtTemplateLanguage.apply` and `applyToOpen`); non-standard layouts are covered by the "Configure dbt file associations" command, which writes folder associations from the snapshot's paths. Contribute a language for the compiled-preview document scheme instead of calling `setTextDocumentLanguage` on it.
- **Status**: Fusion client state, static-analysis mode and target become `LanguageStatusItem`s scoped to each Declared Project's selector. Defer to production stays a status bar item because it applies to commands, not to a document language.
- **dbt commands as tasks**: a `TaskProvider` with `CustomExecution` runs `run`, `build`, `test`, `compile` and `deps` for a Project, replacing `vscodeTerminal.ts` and the terminal half of `commandProcessExecution.ts`. The queue, cancellation and run-results read stay on `Project`; users get rerun, keybindings and `tasks.json` from VS Code. `rerunFromHistory` is deleted when `workbench.action.tasks.reRunTask` reruns the same command with the same arguments; otherwise it becomes a command that re-executes the recorded task.
- **Output**: one `LogOutputChannel` per Declared Project carrying client, CLI and dbt log output, replacing `vscodeTerminal.ts`, `dbtProjectLog.ts` and its log-file watcher, and the per-client channels.
- **Semantic tokens**: keep the `keyword` scope override; richer roles wait on Fusion (issue #120). The extension does not parse SQL to guess roles.

Verify: `commandConsistencyGuard` extended to `languages` and language status; `grep -c createTerminal src` and `grep -c setTextDocumentLanguage src` are 0; `createOutputChannel` appears in one module; visual evidence for status items, explorer icons and the output channel.

### R6 — Webview contract and one panel host

Goal: one typed protocol, one HTML and CSP generator, one entry per panel (closed plan v2.1, carried forward).

- `packages/webview-contract/` with the npm workspace, single lockfile and build-order matrix specified in the closed plan's v2.1. One discriminated union per direction per panel, replacing 29 inbound and 8 outbound command strings; the host dispatches through an exhaustive map.
- `PanelHost` replaces `AltimateWebviewProvider` and the documentation editor's duplicate `getHtml`: one CSP starting from `default-src 'none'`, adding per panel only what evidence requires. Test `wasm-unsafe-eval` in place of `unsafe-eval` for Perspective.
- One Vite entry per panel replaces `MemoryRouter` and `window.viewPath`; delete `react-router-dom`.
- The documentation editor writes schema YAML through `WorkspaceEdit` instead of `writeFileSync`. Exit: the fs-write rule's baseline is empty.
- Redux Toolkit is used only to generate reducers for `useReducer`; replace each slice with a plain typed reducer and delete the dependency.
- Persist UI-only state through `getState`/`setState` and remove `retainContextWhenHidden` from every panel. Keep it on query results only if heap after ten hide/show cycles with a 10,000-row result grows by more than 25% without it.

Verify: property test that arbitrary JSON never reaches a handler without passing a guard; exactly one CSP string in the tree; memory recorded before and after.

### R7 — One styling system and dependency reduction

Goal: five styling systems become one (webview audit §2).

- **Target**: CSS Modules over `--vscode-*` variables and codicons, with thin native components in `uiCore`. `@vscode-elements/elements` is the fallback for form controls native elements cannot cover; the archived Webview UI Toolkit is not used.
- **Serial PRs**: convert SCSS modules to CSS Modules; replace `reactstrap` components in `uiCore` with native ones; remove Bootstrap and `theme.scss`; remove `sass`.
- **Forms**: `react-hook-form` + `yup` are used in four files; replace them with native constraint validation unless a form needs cross-field rules, in which case keep `react-hook-form` without `yup`. Replace `react-copy-to-clipboard` with `navigator.clipboard`.
- **Dead code** (webview audit §6), confirmed by knip configured for `webview_panels/`: unused components and `uiCore` exports, Storybook and its dependencies, `react-markdown` and `remark-gfm`, and `faker`/`factory.ts` if only stories use them.
- **Perspective**: migrate `@finos/perspective*` to `@perspective-dev/*` and drop the d3fc plugin, clearing the `d3-color` advisory; the closed plan's v2.5 spike runs first. Query-result column types follow issue #118, never inferred from values.
- **Upgrades**: `jsdom` 30, `@testing-library/jest-dom` 7, `globals` 17; root `@types/node` to the current LTS line, `@types/vscode` kept at the `engines.vscode` API.

Verify: `npm audit` shows zero high or critical; VSIX size and per-entry eager bytes recorded; visual evidence in light, dark and high-contrast themes.

### R8 — Lineage renderer

Goal: remove `@altimateai/ui-components`, the last Altimate package, which also carries the critical `plotly.js`/`maplibre-gl` advisory lineage never uses.

- Benchmark the candidate renderer against graphs from finance-pipelines' Declared Projects with column-level lineage in the harness from the first run (closed plan v2.2, narrowed to D7); publish the result even when the incumbent wins.
- Build the selected renderer behind `LineageData` from the contract; keep the current component reachable until the replacement passes the benchmark. This is the one hard-to-reverse step and is preceded by a prerelease.
- The new renderer consumes the host's `childTables`/`parentTables` requests and `childCount`/`parentCount` fields directly; delete `webview_panels/src/modules/lineage/componentAdapter.ts`, the only file that knows the component names dbt children "upstream".
- Delete Tailwind, PostCSS and the `al-` generation with the last `al-` class.

Verify: benchmark report committed; `npm ls @altimateai/ui-components` empty; `grep -rn "upstreamCount\|downstreamCount\|upstreamTables\|downstreamTables" src webview_panels/src` prints nothing; visual evidence.

### R9 — finance-pipelines adoption

The closed plan's Phase 10 steps with their contracts, plus the ship plan's step 9 additions. Exit criteria, restated so this plan stands alone:

- 10.1 installer script: downloads the pinned VSIX, verifies its SHA-256 before installing, exits non-zero on mismatch, installs into each of `code` and `cursor` on `PATH` after removing `innoverio.vscode-dbt-power-user`, and is idempotent without `--force`.
- 10.2 wiring: `just setup` in finance-pipelines calls it; its test list includes it; a test asserts the checksum-mismatch failure.
- 10.3 settings: the workspace and folder settings use `fusionPowerUser.*` only; opening the multi-root workspace starts exactly two `dbt lsp` processes; completion, hover on a dotted macro, go-to-definition, lineage and compile work in both dbt folders; opening a file outside them raises no notification.
- 10.4 patch machinery: `scripts/patch_dbt_power_user_macro_hover.py` and the `power-user-patch` tasks are deleted only after all seven consumer cases pass through the fork.

The project-side compile fixes are tracked in Kikoff/finance-pipelines#106. The `sysdate()` and `union_relations` fixes are ready locally; the remaining UNION ALL errors appear only in incremental compiles against stored tables.

### R10 — 1.0.0

Cut once R9 confirms the consumer works, with R1–R5 on `main`. R6–R8 may follow 1.0.0: they change panel internals, not settings, commands or files users depend on.

## Naming and code conventions

These extend `AGENTS.md`; the ESLint config enforces what it can.

- Names say what a thing is in dbt or VS Code terms (`Project`, `ProjectSnapshot`, `PanelHost`), never its history (`new…`, `altimate…`, `…V2`) or its implementation (`…Impl`).
- One concept, one word: `project` for a Declared Project, `root` for its directory, `folder` for a workspace folder. `DBT`/`Dbt` appears only where the dbt concept is meant, never as a namespace prefix.
- At most five parameters; beyond that, an options object. No boolean positional parameters on exported functions.
- A module either imports `vscode` or is pure, and a pure module has unit or property tests.
- Promises are awaited, returned, or explicitly `void`ed.
- Clean-code rules yield to platform conventions where they conflict: `activate`/`deactivate`, `Disposable` classes, `onDid…` events, and command and setting IDs follow VS Code.

## Dependencies

| Package                                                          | Now             | Target                               | Where   | Phase    |
| ---------------------------------------------------------------- | --------------- | ------------------------------------ | ------- | -------- |
| `fast-check`, `dependency-cruiser`                               | —               | added                                | root    | R1       |
| `jest`, `ts-jest`, `@jest/globals`                               | 30, 29          | replaced by Vitest                   | root    | R4       |
| `@vscode/test-electron` launch script                            | custom          | `@vscode/test-cli`                   | root    | R1       |
| `typescript`                                                     | 6               | 6 until typescript-eslint supports 7 | both    | —        |
| `inversify`, `reflect-metadata`, `ts-loader`                     | 8, 0.2, 9       | removed                              | root    | R4       |
| `react-router-dom`, `@reduxjs/toolkit`                           | 7, 2            | removed                              | webview | R6       |
| `reactstrap`, `bootstrap`, `sass`                                | 9, 5, 1         | removed                              | webview | R7       |
| `react-hook-form`, `yup`, `react-copy-to-clipboard`              | 7, 1, 5         | native, or `react-hook-form` only    | webview | R7       |
| Storybook, `faker`, `factory.ts`, `react-markdown`, `remark-gfm` | —               | removed                              | webview | R7       |
| `@finos/perspective*`                                            | 3.8, deprecated | `@perspective-dev/*`                 | webview | R7       |
| `react`, `react-dom`                                             | 18              | 19, after 1.0.0                      | webview | post-1.0 |
| `@types/node`                                                    | 24              | current LTS                          | root    | R7       |
| `@altimateai/ui-components`, `tailwindcss`, `postcss`            | 0.0.88, 3       | removed                              | webview | R8       |

## Considered and not planned

- **`TestController` for dbt tests.** dbt tests are graph nodes whose result is a row count, not a unit-test tree; mapping them costs more than it gives.
- **A TypeScript 7 type-check step** before typescript-eslint supports 7: it adds a second compiler to the gate with no consumer.
- **React 19 inside R7:** unrelated to the phase's goal; it follows 1.0.0.

## Risks

- **R3 touches every feature.** Seven PRs, each green with smoke and visual evidence; R4 follows so the wiring is rewritten once, on the smaller graph.
- **Workspace trust** changes first-run behaviour in untrusted folders: the extension is disabled until the folder is trusted, and VS Code's Restricted Mode UI explains why. The change ships in a prerelease with release notes.
- **Perspective migration** may change query-panel behaviour. The spike runs first; issue #118 lands on the new package.
- **The lineage renderer** is the only hard-to-reverse step: benchmark gate, old component reachable, prerelease.
- **Fusion releases** can change evidence. The evidence harness reruns on each Fusion bump, and the experiments named in steps are the check.
