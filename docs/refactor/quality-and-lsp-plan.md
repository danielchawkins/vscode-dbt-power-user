# Quality and LSP plan

This plan runs after R8 and before R10 of [`rearchitecture-plan.md`](rearchitecture-plan.md). It turns on the code-quality gates first, then cleans up, moves features onto the dbt Fusion 2.0.6 language server, restructures, and finishes the upgrades, so that 1.0.0 does not depend on any of them being deferred. Landing follows [`implementation-dispatch.md`](implementation-dispatch.md); vocabulary is [`CONTEXT.md`](../../CONTEXT.md). R9 (finance-pipelines adoption) and R10 (1.0.0) stay in the rearchitecture plan.

## Goal and scope

In scope: every finding in the practice review, the quality review, the LSP capability spike, and the nitpick issue (#210), each either assigned to a step or listed under [Declined](#declined). Fusion 2.0.6 is the only target. Out of scope: new features, finance-pipelines changes (R9), and Fusion behaviour that only dbt Labs can change.

Finding codes used below:

- **Prac N** / **Prac §N**: practice review ranked finding N or section N ([`practice-review-october-2026.md`](../research/practice-review-october-2026.md)).
- **Qual M1–M4, S1–S7, O1–O3, §N**: quality review ([`quality-review-october-2026.md`](../research/quality-review-october-2026.md)).
- **Spike**: [`lsp-capabilities-fusion-2.0.6.md`](../research/lsp-capabilities-fusion-2.0.6.md) (on `main`).
- **#210 seed / R7 / R8**: items in the nitpick issue: the seeded list, the R7 review comment, the R8 review comment.

Shared files in every phase: `project.ts` (`src/projects/project.ts`), `compositionRoot.ts`, `fusionLanguageClient.ts`, `package.json` (either), the lockfile, `eslint-suppressions.json`, `webview_panels/eslint-suppressions.json`, `scripts/quality/ceilings.json`, `justfile`, and both ESLint configs. Two steps that touch the same shared file are sequential. A step that changes a lint count, a coverage floor or a bundle size touches `ceilings.json`.

## Grounding

The plan follows these documents and patterns:

- ADR 0001 (local Fusion only), ADR 0002 (LSP first, artifacts only where the protocol lacks data), ADR 0003 (Declared Projects), ADR 0004 (mise and Just for repository tooling only), ADR 0006 (column lineage from `dbt.listNodes`, no CLI fallback).
- Target-model layer rules and confinement rules in the rearchitecture plan (one module per fact, settings, process, and file-write confinement through ESLint).
- The existing ratchet: `eslint-suppressions.json` lists existing violations, new ones fail, and unpruned entries fail. Phase 0 extends this to every gate.
- `Projects.onDidChangeManifest` through `QueryManifestService` stays the only consumer seam (`AGENTS.md:78`, `docs/architecture.md:70`). The language server becomes the preferred producer behind it ([One seam](#one-seam-the-composite-producer-d8)). The spike shows that the server covers the graph, node identity, compiled SQL, previews and model columns; the CLI parse is still the only producer for docs, tests, macros and semantic metadata.

What the parse producer still supplies after Phase 2, because no 2.0.6 command returns it (Spike, "Must stay"; recorded in `docs/lsp-metadata-gaps.md`): node and column descriptions, tags and meta (docs editor, lineage details drawer, Documentation tree); generic tests (`TestMetaMap`, the `tests` part of `GraphMetaMap`, the Model Tests tree, test generation, the lineage node test counts read by `createTable`); macros (`MacroMetaMap`); doc blocks (`DocMetaMap`); metrics, semantic models, unit-test and function metadata; source YAML metadata (`SourceMetaMap`) and source column types for schema origin; the FK `constraint` relationship overlay; configuration-error diagnostics from `dbt parse` (the server reports nothing for an unknown target or an unset `env_var` in `profiles.yml`).

What else stays unchanged, although the server overlaps it: the TextMate grammars (`syntaxes/jinja-sql.tmLanguage.json`, `syntaxes/jinja-yaml.tmLanguage.json`), which colour files before the server starts and when it is not running; and static-analysis detection (`fusionPowerUser.staticAnalysis`, the mode read in `fusionLanguageClient.ts` and shown by `fusionStatus.ts`), which Phase 2 reads to explain empty results in `baseline`.

### Open decisions

Each decision has a recommendation. Steps follow the recommendation unless the owner overrides it before the step starts.

| Id | Decision                                                                   | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Recorded in              |
| -- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| D1 | Fate of `ProjectMetadataSource`                                            | Keep the port; it does not stay unused, because 2.4 gives it a composite producer (D8). 1.8 makes it the only publication path. The CONTEXT term **Project Metadata Source** names the composite                                                                                                                                                                                                                                                                                                                                 | 1.8, 2.4, ADR 0007       |
| D2 | CTE lenses on a document with unsaved edits, where Fusion returns none     | Show none until save; do not keep the regex detector for dirty documents (two detectors for one fact)                                                                                                                                                                                                                                                                                                                                                                                                                            | 2.9, ADR 0007            |
| D3 | When `dbt parse` runs                                                      | On activation; on a snapshot revision; on a change to `dbt_project.yml`, `profiles.yml`, `packages.yml`, `dependencies.yml` or `selectors.yml`; and after `dbt/lspCompileComplete` or `dbt/lspBackgroundCompileComplete` only while a manifest consumer (2.11) is visible; never per watcher event                                                                                                                                                                                                                               | 2.11, ADR 0007           |
| D4 | CLI fallback for preview and columns when the Fusion Client is not running | None. Show the client's state and **Show output**, as column lineage does                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 2.8, ADR 0007            |
| D5 | Compiled preview of unsaved or untitled text                               | Saved file: `dbt.compileFile` output of the last save, with a stale marker while dirty. Untitled: CLI `compile --inline`, only when the user runs the preview command. E3 can replace this                                                                                                                                                                                                                                                                                                                                       | 2.7, ADR 0007            |
| D6 | Parallel implementation workspaces                                         | Allow at most two at once, only for steps marked parallel-safe here. This reverses the dispatch document's former "Do not open multiple implementation changes for parallel coding". **Confirmed by the owner**; 0.2 amends the dispatch document (Parallel workspaces). One smoke or integration run at a time still applies                                                                                                                                                                                                    | 0.2                      |
| D7 | Perspective (≈4 MB WASM, `'wasm-unsafe-eval'`, `worker-src blob:`)         | Replace it with `@tanstack/react-table` and `@tanstack/react-virtual`. No consumer case uses charts or pivots. **Confirmed by the owner**; 4.6 records parity, 4.7 replaces                                                                                                                                                                                                                                                                                                                                                      | 4.6                      |
| D8 | Where server-supplied project metadata reaches consumers                   | **Confirmed by the owner**: one seam. `Projects.onDidChangeManifest` stays the only consumer seam; the `ProjectMetadataSource` port gets a composite producer, the language server first and the CLI parse only for the fields the server lacks. Consumers never know which producer filled a field; each project gets one event with the merged value. Each Fusion upgrade moves newly covered fields to the server; the parse producer is deleted once none remain. Details in [One seam](#one-seam-the-composite-producer-d8) | 2.1, 2.4, 2.12, ADR 0007 |
| D9 | TypeScript `target`/`lib`                                                  | ES2024 in every tsconfig. `lib` and `target` only affect the typecheck, because rsbuild and Vite set the emitted target; verified by the typecheck                                                                                                                                                                                                                                                                                                                                                                               | 0.9                      |

### One seam: the composite producer (D8)

The owner's rule: one consumer seam, and the language server does everything it can. At 2.0.6 it cannot do everything: `dbt.listNodes ["package:<root>"]` returns every model, seed, source, exposure, singular test, unit test and UDF with `unique_id`, `name`, `resource_type`, `package_name`, `original_file_path`, `depends_on` and `config.materialized`/`access`/`group`, but no macros, doc blocks, generic tests, metrics, semantic models, descriptions, columns, tags, meta or raw/compiled SQL, and the server never writes `manifest.json`. The CLI parse therefore stays for those fields only.

- **Seam.** Unchanged: `Projects.onDidChangeManifest` fires with the `Project`, whose `manifest` is the merged value; features read it through `QueryManifestService`. The merged value keeps the `Manifest` type, minus `metadataProducer` and `producerRevision`, so no consumer can branch on a producer.
- **Producers.** `ProjectMetadataSource` is implemented by `CompositeMetadataSource` (`src/metadata/compositeMetadataSource.ts`), which owns two producers: the **Server Producer** (`ServerMetadataSource`: `dbt.listNodes ["package:<root>"]` plus `dbt.getProjectInfo`) and the **Parse Producer** (the existing `ManifestMetadataSource` over `dbt parse`). Neither producer publishes to consumers.
- **Field ownership at 2.0.6.** Server: the node set; per node `unique_id`, name, resource type, package, `original_file_path`, materialization, access and group; `graphMetaMap.parents` and `.children` (inverted from `depends_on`); `modelDepthMap`; adapter type and project name. Parse: everything in `docs/lsp-metadata-gaps.md` (descriptions, columns, tags, meta, raw and compiled SQL, `graphMetaMap.tests` and `.metrics`, `TestMetaMap`, `MacroMetaMap`, `DocMetaMap`, `MetricMetaMap`, `SemanticModelMetaMap`, source YAML metadata, unit-test and function metadata beyond identity, the `constraint` overlay). One table, `FIELD_OWNERS` in `src/core/metadata/fieldOwners.ts`, is the only code that knows this split. If E8 fails, the table assigns the graph fields to the parse producer for `baseline` projects.
- **Merge.** When the server has a value, its node set is authoritative for the resource types `FIELD_OWNERS` assigns to the server (those the spike saw returned; E1 confirms snapshots): a model added since the last parse appears with empty parse fields (no description, 0 tests); a node of those types that the parse still holds but the server no longer lists is dropped. Nodes of other types come from the parse producer unchanged. A `depends_on` endpoint outside the set takes its identity from the parse producer, or becomes a placeholder labelled with its `unique_id`. When the server has no value (client not running, before the first compile), server-owned fields come from the parse producer only while its graph parsers exist (E8 failed); after 2.6 deletes them, they are empty and lineage and trees show the client state.
- **Freshness.** One event per project. The composite publishes when either producer updates: it merges the latest value of each (a pure, synchronous merge), advances `publicationEpoch` once and fires once. A server refresh whose node list hashes equal to the previous one publishes nothing. Each producer refreshes single-flight. After a compile, a visible parse-field consumer can see two publications: new server fields first, then new parse fields; each is a coherent merged value.
- **Migration rule.** On every Fusion upgrade (the `mise.toml` pin), re-run the spike harness (`probe.mjs`, `extras.mjs`, `bench.mjs` on jaffle and the finance copy) and commit `docs/research/lsp-capabilities-fusion-<version>.md` with its evidence. A field moves from parse to server when the new version returns it for every node of its kind at project grain (one request, no per-node fan-out) on both projects; if only `strict` returns it, it moves for `strict` projects only. Each move is one migration revision that changes its `FIELD_OWNERS` entry, the server adapter, the merge golden test and the field's row in `docs/lsp-metadata-gaps.md`. A parity test keeps the table and the document equal.
- **Target state.** When a Fusion version covers every remaining field, the gap document is empty and the parse producer is deleted: `ManifestMetadataSource`, the parse half of `ManifestTrigger`, the `core/manifest/*Parser.ts` files, and the composite, which collapses into the server producer behind the same port. The CLI check for configuration errors that stop the project loading stays in `ProjectErrors`, outside the port, until the server reports them.

## Gate budget

Phase 0 gates ratchet: a count can only fall and a floor can only rise. `scripts/quality/ceilings.json` is the single source for every count, floor and size budget; `vitest.config.ts`, `webview_panels/vitest.config.ts` and `size-budget.mjs` read their values from it. `just lint-ratchet` fails when a measured value is worse than its entry, and when it is better (the entry must be tightened in the same revision, with `just lint-ratchet --write`). CI fails a pull request whose `ceilings.json` loosens a value relative to the base branch, unless a commit in the pull request carries a `Ratchet-Loosen: <key> <reason>` trailer for that key; the CI job prints each accepted trailer. Floors are compared after rounding to the stored precision (two decimals for type coverage, integers for coverage percentages), so rounding noise is not a loosening.

Loosening is expected in these cases, each with a trailer: a step that deletes covered code (2.6, 2.8, 2.9, 2.10) re-baselines its coverage and type-coverage floors with `just lint-ratchet --write` in the same revision as the deletion, so every revision tip passes; a dependency step (4.3, 4.8) may raise a bundle budget; any other loosening needs the owner's approval in the pull request.

Pre-commit keeps its current scope (ESLint, dependency-cruiser and format on staged globs). Record the `just check` wall time before step 0.3 and at the Phase 0 checkpoint. Total growth must stay at or below 60 s, and no single new gate may exceed 20 s. Step 0.4 measures the strict-TS and type-coverage runs before 0.10 and 0.11 commit to them; both run with caches (`tsc --incremental` with the build info under `out/`, `type-coverage --cache`).

## Phase 0: land 2.0.6 and turn on the gates

### 0.1 Land the 2.0.6 minimum (done)

- Status: merged to `main` with the LSP capability spike. dbt Fusion 2.0.6 is the minimum in `src/fusion/fusionExecutable.ts`, the version tests, `AGENTS.md`, ADR 0001, README and `docs/architecture.md`.
- Resolves: the 2.0.6-only scope rule.
- Verify (once, before 0.2): `rg -n '2\.0\.5' src AGENTS.md README.md docs --glob '!docs/research/**'` lists only historical references.

### 0.2 Research, reviews and plan integration

- Goal: every decision record the plan cites is in the repository and current.
- Files: new `docs/research/practice-review-october-2026.md` and `docs/research/quality-review-october-2026.md` (the two reviews, with their `/tmp` raw-output paths marked "not preserved"); rewrite `docs/lsp-metadata-gaps.md` as the field-ownership list of [One seam](#one-seam-the-composite-producer-d8): one row per parse-owned field (the manifest map, the consumers that read it, the 2.0.6 result that lacks it), with the spike's stale claims removed; add `docs/lsp-coverage.md` (one row per feature: the 2.0.6 command that covers it, or "none"; the Not established items; upstream gaps); `docs/architecture.md` (line 25 lens sentence, line 34 command arguments citing 2.0.6, metadata port links); `rearchitecture-plan.md` (link to this plan; Phase 6 row; R1.2 "knip gates `just lint` from step 0.4"; React row "19 before 1.0"; remove React from "Considered and not planned"; R10 requires Phases 0–4 here); `implementation-dispatch.md` (D6); this plan.
- Resolves: Prac 1; Prac 9 (architecture sentence); Spike "`docs/lsp-metadata-gaps.md` is stale"; Spike "Must stay" (recorded).
- Revisions: (1) reviews; (2) gaps document rewrite and `lsp-coverage.md`, plus link fixes; (3) plan and dispatch edits.
- Verify: `just lint-markdown`; `rg -n 'returned .null.|none advertised|not captured|cannot be sourced' docs/lsp-metadata-gaps.md` is empty; every gaps row names a manifest map that exists in `ParsedManifest`.
- Depends: 0.1 (done). Docs only, so parallel-safe with code, but stacked here because later steps cite it.

### 0.3 Delete dead code

- Goal: knip with the step 0.4 configuration reports only test seams.
- Files: delete `src/modules.ts` and the `@extension` alias (`tsconfig.json`, `rsbuild.config.ts`, `vitest.config.ts`); the Qual §1A symbols (`dbt_integration/domain.ts` DataPilot types, `dbtIntegration.ts`, `core/manifest/types.ts`, `ProjectParsers` in `compositionRoot.ts`, the `runHistoryService.ts` re-export, `RunModelType.SNAPSHOT`, `Source.DATABASE`, the webview `ButtonProps`, the `QueryPanelViewType` members, and in-file-only types losing `export`); Qual §1C production code used only by tests, deleted together with those tests (`utils.ts` `isEnclosedWithinCodeBlock`, `arrayEquals`, `debounce`, `setupWatcherHandler`, `resolveSettingsVariables` with `resolveSettingsVariables.test.ts`; `clearWebviewRuntimeTimings`; `lookupModelByEditorContent` if unreachable; the `compileNode` kind in `core/cli/cliArgs.ts`; `hashProjectRoot`, `resolveDefer`, `resolveFolderPath`, `resolveLspCompiledOutput` where no production code references them; un-export `enqueueCommand` and `formatCliStatus`); the legacy harness `src/test/suite/{index,runTest,coverage}.ts`, `src/types/istanbul-lib-instrument.d.ts`, `istanbul-lib-coverage`, `istanbul-lib-instrument`, `@types/istanbul-lib-coverage`; `src/test/suite/extension.test.ts`; `scripts/spikes/lineage-renderer/`.
- Classification rule (rerun knip, because the review's table was in `/tmp`): no production and no test reference → delete; production code referenced only from tests → delete it with the tests unless they cover behaviour reachable from another production export; used in its own file and in a test → drop `export`, or tag `/** @internal */` if a test needs it. The `fusionLanguageClient.ts` seams are tagged now and moved in 2.3.
- Resolves: Qual §1A, §1B, §1C, §1D, M4 (harness), §3 (`extension.test.ts`, harness), S1, O2; Prac 11 (`modules.ts`, DataPilot types, `compileNode`, `hashProjectRoot`, `resolve*`, the lineage-renderer spike).
- Revisions: (1) host §1A/§1B; (2) §1C with its tests; (3) harness and istanbul packages; (4) webview deletions; (5) `@internal` tags.
- Verify: `just check`; `rg -n '@extension' src tsconfig.json rsbuild.config.ts vitest.config.ts` is empty; `npm ls istanbul-lib-coverage istanbul-lib-instrument` is empty.
- Depends: 0.2. Sequential (`compositionRoot.ts`, `package.json`, lockfile).

### 0.4 Gate on knip

- Goal: unused files, exports, types, enum members and dependencies fail `just lint`.
- Files: `knip.json` as in Qual §2 (production entries and projects suffixed `!`; `src/test/**/*.test.ts`, `src/test/{integration,smoke}/**/*.ts`, `scripts/**/*.{mjs,ts}` and `.vscode-test.mjs` as non-production entries; `webview_panels/src/test/setup.ts` as an entry; `tags: ["-internal"]`; drop the `@types/vscode`, `ts-loader` and `src/test/mock/**` ignores and the `sample` binary if knip flags it); `package.json` `lint:unused` runs `knip` and `knip --production`; `justfile` `lint` calls `lint-unused`, and its comment changes.
- Resolves: Qual §2, §1E, M4 (`@vscode/test-cli`); Prac §3 (`@vscode/test-cli`, stale `ts-loader`); Prac 11 ("run `lint-unused` each phase", now permanent).
- Revisions: (1) `knip.json`; (2) scripts and recipe; (3) the cost probe: run `tsc -p tsconfig.strict.json --noEmit --incremental` (build info under `out/`) and `type-coverage --strict --cache` cold and warm on the host and the webview, and record the four wall times in the step result. If a warm run exceeds 20 s or the total would push `just check` past the 60 s budget, stop and confirm before 0.10 and 0.11.
- Verify: `just lint` runs knip; adding an unused export makes `just lint` fail; `just lint-unused` takes 15 s or less; the cost probe times are in the step result.
- Depends: 0.3. Sequential (`package.json`, `justfile`).
- Result: cost probe, cold / warm: host `tsc` 2.3 s / 0.7 s; webview `tsc` 1.7 s / 0.7 s; host `type-coverage` 1.2 s / 0.7 s; webview `type-coverage` 1.7 s / 0.6 s.

### 0.5 Remove the dependency cycles

- Goal: dependency-cruiser runs without a known-violations file.
- Files: new `src/fusion/documentSelectors.ts` (`DBT_SQL_SELECTOR` and `DBT_YAML_SELECTOR` move out of `dbtPowerUserExtension.ts`; `features/codeLenses.ts` imports them); new `src/projects/projectEvents.ts` (`RunResultsEvent`, `ProjectConfigChangedEvent`); delete `src/dbt_client/`; `projects/manifestTypes.ts` drops `project: Project`, or types it as a narrow interface if something reads it; delete `.dependency-cruiser-known-violations.json` and `--ignore-known` from `lint:imports`; the `AGENTS.md` tree loses `dbt_client/`.
- Resolves: Prac 6; Qual §4 (cycles), S2; Qual §4 (stale `dbt_client` in `AGENTS.md`).
- Revisions: (1) selectors; (2) events; (3) manifest types; (4) baseline removal and docs.
- Verify: `just lint-code` passes with no baseline file; `rg -n dbt_client src AGENTS.md docs/architecture.md` is empty.
- Depends: 0.4. Sequential (`project.ts`).

### 0.6 Add the layer rules

- Goal: the target-model layers are enforced in the host and the contract, with no baseline.
- Files: `.dependency-cruiser.cjs` gains `settings-imports-core`, `fusion-imports-core-and-settings`, `lower-layers-skip-webview` (`core|settings|fusion|projects` must not import `src/webview`), `contract-is-pure` (`packages/webview-contract/src` imports only itself), `no-orphans` (error; entries, `.d.ts` and tests excluded) and `no-deprecated-core`; `lint:imports` also cruises `packages/webview-contract/src`; new `webview_panels/.dependency-cruiser.cjs` (`no-circular`, `webview-imports-contract-only`) run by `just webviews::lint`. Moves: `src/fusion/{fusionClientPool,fusionStatus,fusionClientDiagnostics}.ts` to `src/projects/`, because they are driven by the Project Registry; `src/fusion/schemaOrigin.ts` to `src/projects/`, because it reads `project.manifest` (`schemaOrigin.ts:34`) and `SourceMetaMap`; `fusionLanguageClient.ts` takes a `FusionProjectRef` (`root`, `folder`, `name`, `commandPrefix`; the executor confirms the fields from current use) instead of `DeclaredProject`. `fusion-imports-core-and-settings` allows `src/fusion → src/dbt_integration` until 1.1, as a named exception in the rule (`DBTTerminal`, `EnvironmentVariables`, `DBColumn`, `DBTCommand`, `QueryExecution` are imported today); 1.1 deletes the exception. `docs/architecture.md` paths change.
- Resolves: Qual §4 (missing layer rules: `contract-is-pure`, `no-orphans`, `no-deprecated-core`, cruise the contract), Qual §6 (dependency-cruiser row).
- Revisions: (1) moves and the narrow type; (2) rules; (3) webview cruise; (4) docs.
- Verify: `just lint-code`; `just webviews::lint`; a scratch `import` from `src/projects/` in a `src/fusion/` file fails. If the host rules find more than five edges beyond the listed moves and the `dbt_integration` exception, or the webview cruise finds more than five edges, stop and confirm.
- Depends: 0.5. Sequential (`compositionRoot.ts`, `fusionLanguageClient.ts`).
- Note: the webview cruise, revision (3), moved to 0.6b because its first run found 38 `no-circular` edges. 0.6 enforces the host and contract layers only.

### 0.6b Break the webview import cycles, then cruise the webview

- Goal: `webview_panels/.dependency-cruiser.cjs` (`no-circular`, `webview-imports-contract-only`) runs in `just webviews::lint` with no baseline.
- Files: each React context object, its hooks and its types move into leaf files (`context.ts`, `types.ts`) that import no components; providers and components import the leaves, and components stop importing the provider. `modules/queryPanel` (17 edges: components ↔ `QueryPanelProvider.tsx` and `useQueryPanelState.ts`); `modules/documentationEditor` (19 edges, mostly through `state/useDocumentationContext.ts`, the `tests/*` and `docGenerator/*` components and `useTestFormSave`); `modules/commonActionButtons` (1 edge: `CommonActionButtons.tsx` → `HelpButton.tsx` → documentation help → `CommonActionButtons.tsx`); `modules/app` (1 edge: `appReducer.ts` ↔ `types.ts`). Tests that mock a moved module by path take the new path. New `webview_panels/.dependency-cruiser.cjs`, run by `just webviews::lint`.
- Resolves: the webview half of 0.6 (Qual §4 cycles, Qual §6 dependency-cruiser row).
- Revisions: (1) `modules/app`; (2) `documentationEditor`, which also breaks the `commonActionButtons` cycle because it ran through `useDocumentationContext.ts` → `DocumentationProvider.tsx`; (3) `queryPanel`; (4) webview cruise (`lint:imports` in `webview_panels/package.json`, run by `lint`).
- Verify: `just webviews::lint` passes with no baseline; `just webviews::test`; no behaviour change, checked by `just smoke-visual` on the query results and documentation editor checkpoints.
- Depends: 0.6. Parallel with the lineage work, which it does not touch.

### 0.7 Add the bug-class ESLint rules

- Goal: bug classes the current lint misses fail with no baseline entries.
- Files: `eslint.config.cjs` and `webview_panels/eslint.config.mjs`: `@typescript-eslint/no-for-in-array`, `no-misused-spread`, `no-base-to-string`, `no-non-null-asserted-optional-chain`, `switch-exhaustiveness-check`, `no-unnecessary-type-assertion`, `prefer-promise-reject-errors`, `only-throw-error`, `ban-ts-comment` (a described `@ts-expect-error` is allowed), core `no-async-promise-executor`, and `no-console` scoped to `src/**` and `webview_panels/src/**` with tests excluded (scripts, configs and `.vscode-test.mjs` may log). Fix every hit: the `ManifestJson` input types become `Record<string, …>` (`projects/manifest.ts:99-111`, `core/manifest/nodeParser.ts:101`); `for…in` over arrays (`macroParser.ts`, `metricParser.ts`, `sourceModelCreationCodeLensProvider.ts`); base-to-string (`commands.ts:421`, `runModel.ts:99`, `outputChannels.ts:216`); `console.*` (`queryManifestService.ts:104`, `lineagePanel.ts:400`, `modelTreeviewProvider.ts:176`, `utils.ts`, `graphParser.ts`, `core/manifest/utils.ts`, and webview sites) becomes a log call or is deleted; `@ts-ignore` at `docsEditPanel.ts:497`; the non-null assertions in `graphParser.ts:176-244`; the four `new Promise(async …)` executors become `async` methods (`nodeParser.ts:104`, `macroParser.ts:16`, `metricParser.ts:12`, `docParser.ts:13`), which `no-async-promise-executor` would otherwise flag.
- First add characterization tests for `sourceModelCreationCodeLensProvider.ts` (7.3% covered) before changing it.
- Resolves: Qual M2, M3; Qual §6 (typescript-eslint bug-finding subset, `ban-ts-comment`, `no-console`); Qual S6 (codegen lens part).
- Revisions: (1) codegen lens tests; (2) manifest types, parser loops and `async` parser methods; (3) codegen lens loops; (4) console and base-to-string; (5) rules enabled.
- Verify: `just check`; `rg -n 'console\.' src webview_panels/src --glob '!**/test/**' --glob '!**/*.test.*'` is empty; `eslint-suppressions.json` gains no entries; each rule fails on a scratch violation. If there are more than 40 hits, stop and confirm.
- Depends: 0.6. Sequential (`eslint.config.cjs`).

### 0.8 Make the lint plumbing ratchet

- Goal: one formatter per file type, the typescript-eslint meta package, and a ratchet over every baseline.
- Files: both ESLint configs (`eslint-config-prettier` replaces `eslint-plugin-prettier/recommended`; move to the `typescript-eslint` meta package; drop `eslint-plugin-you-dont-need-lodash-underscore`; `max-lines` 600 → 400 with the files now over 400 added to the baseline); both `package.json` files and the lockfile; new `scripts/quality/ceilings.json`, `scripts/quality/ratchet.mjs` and `src/test/suite/quality/ratchet.test.ts`; `justfile` `lint-ratchet` in `lint`; `.github/workflows/check-and-package.yml` compares `ceilings.json` with the base branch's copy on pull requests and accepts `Ratchet-Loosen: <key> <reason>` trailers (see [Gate budget](#gate-budget)); when the base has no `ceilings.json` (this step's own pull request), or a key is new, the comparison passes and prints the keys it skipped. Initial keys: root and webview suppression totals, and the `@internal` tag count.
- Resolves: Qual §5 (ratchet, prune in check), Qual §6 (complexity row, `max-lines` 400 for new files); Prac §3 (`eslint-plugin-prettier`, typescript-eslint meta package, `you-dont-need-lodash-underscore`).
- Revisions: (1) formatter and plugin swap; (2) meta package; (3) `max-lines` 400 baseline; (4) ratchet script, tests and CI.
- Verify: `just check`; one added suppression fails `just lint-ratchet`; a stale suppression fails `just lint`; `just lint-format` still fails on a misformatted file; `npm ls eslint-plugin-prettier eslint-plugin-you-dont-need-lodash-underscore` is empty; `ratchet.test.ts` covers a loosened key with and without a trailer, and a base with no `ceilings.json`.
- Depends: 0.7. Sequential (`package.json`, lockfile, `justfile`).

### 0.9 Stage 1 TypeScript flags and the ES2024 target

- Goal: a modern target and the cheap strictness flags.
- Files: `tsconfig.json`, `tsconfig.integration.json` if it sets them, `webview_panels/tsconfig.json`, `webview_panels/tsconfig.node.json`, `packages/webview-contract/tsconfig.json`: `target` and `lib` ES2024 (the webview adds DOM); root `noImplicitOverride`, `noUnusedLocals` and `noUnusedParameters`; `noImplicitOverride` in the webview and the contract. Fix the 34 override and 15 unused-symbol errors (the unused-symbol count includes `src/test/**`, which the root tsconfig compiles), and prune the `no-unused-vars` entries they clear.
- Resolves: Prac §4 (TS target); Qual §6 (`noImplicitOverride`, `noUnusedLocals`/`noUnusedParameters`); D9.
- Revisions: (1) target and lib; (2) `noImplicitOverride`; (3) unused symbols.
- Verify: `just check` (the typecheck is the check for D9; bundle targets are unchanged, so no smoke run).
- Depends: 0.8. Sequential (wide edit, including `fusionLanguageClient.ts`).

### 0.10 Stage 2 TypeScript flags, starting with the contract

- Goal: `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on in the contract package; elsewhere their error counts only fall.
- Files: `packages/webview-contract/tsconfig.json` with both flags, every error fixed, and the `optional()`/`nullish()` audit; new `tsconfig.strict.json` (root) and `webview_panels/tsconfig.strict.json`, counted by `scripts/quality/strict-ts.mjs` over production files only, with `strictTs.host` and `strictTs.webview` ceilings at the measured counts. They run in `just lint-ratchet`, not pre-commit.
- Resolves: Qual §6 (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, contract first); #210 seed (`optional()` rejects `null`).
- Revisions: (1) contract flags and fixes; (2) nullish audit; (3) strict counter and ceilings.
- Verify: `just check`; `npm run build:contract`; adding one unchecked index access in `src/` fails `just lint-ratchet`.
- Depends: 0.9. Sequential.

### 0.11 Ratchet type coverage

- Goal: explicit and implicit `any` in production code only decreases.
- Files: `type-coverage` devDependency; `ratchet.mjs` runs `type-coverage --strict` on the root project with tests ignored, and on the webview project; `typeCoverage.host` and `typeCoverage.webview` floors at the measured value rounded down to 0.01.
- Resolves: Qual §6 (type coverage).
- Revisions: (1) dependency; (2) ratchet keys.
- Verify: a scratch `as any` in `src/` fails `just lint-ratchet`; the type-coverage run takes 20 s or less.
- Depends: 0.10. Sequential (`package.json`, lockfile).

### 0.12 Ratchet test coverage

- Goal: coverage floors are part of `just check`.
- Files: `scripts/quality/ceilings.json` gains `coverage.host` and `coverage.webview` floors at the measured values (host now: lines 69, branches 61, functions 75, statements 69); `vitest.config.ts` and `webview_panels/vitest.config.ts` read `coverage.thresholds` from `ceilings.json`, with no copy of the numbers and no `autoUpdate`; `just test` and `just webviews::test` run with `--coverage`.
- Resolves: Qual §6 (coverage threshold).
- Revisions: one.
- Verify: `just check` gets at most 5 s slower; a scratch floor set one point above the measured value in `ceilings.json` fails `just test`; `rg -n 'thresholds' vitest.config.ts webview_panels/vitest.config.ts` shows no literal numbers.
- Depends: 0.11. Sequential (`justfile`).

### 0.13 Add a bundle-size budget

- Goal: the bundle sizes cannot grow without the ceiling being raised.
- Files: new `scripts/quality/size-budget.mjs` and tests; budgets in `ceilings.json`: `dist/extension.js` 1.25 MB or less, the VSIX 5.5 MB or less, each `webview_panels/dist/assets/<entry>.{js,css}` at most 10% over today's value, and the total `.wasm`; `just package` runs it after `vsce package`.
- Resolves: Qual §6 (bundle-size budget).
- Revisions: one.
- Verify: `just package` passes; a budget set below the current value fails it.
- Depends: 0.12. Sequential (`justfile`).

### 0.14 Check that documented symbols exist

- Goal: a backticked symbol or path in the design documents exists in the code.
- Files: new `scripts/quality/docs-symbols.mjs`, `scripts/quality/docs-symbols-allow.txt` and tests; it reads `AGENTS.md`, `CONTEXT.md`, `docs/architecture.md` and `docs/adr/*.md`, and checks `PascalCase` and `camelCase` identifiers and `src/`, `webview_panels/`, `packages/`, `scripts/` paths against `src`, `webview_panels/src`, `packages/*/src`, `scripts` and `package.json`; `just lint-markdown` runs it. Fix today's drift: `ManifestCacheProjectAddedEvent` becomes `Projects.onDidChangeManifest` (the symbol only; the "no second consumer seam" rule stays); `FusionProjectIntegration` becomes "`Project` implements `ManifestProject`"; fix the `architecture.md:70` path and the CONTEXT Project Metadata Source entry.
- Resolves: Qual §6 (documentation drift); Qual M1 (documentation part).
- Revisions: (1) script and tests; (2) documentation fixes.
- Verify: `just lint-markdown`; a scratch bogus symbol fails it.
- Depends: 0.13. Sequential (`justfile`).

### 0.15 Replace absence-guard tests with lint rules

- Goal: removed integrations are kept out by lint rules in the editor, not by tests that search source text.
- Files: first move the `package.json` and `.vscode/launch.json` checks (`pythonRemovalGuard.test.ts:82-91`, the `forbiddenInPackageJson` patterns) into `packageManifest.test.ts`, because lint rules do not read JSON contributions; then delete `src/test/suite/pythonRemovalGuard.test.ts`, `src/test/suite/localOnlyContract.test.ts`, and the string-absence cases in `fusionIntegrationWiring.test.ts:85-128`; for each forbidden symbol and package those tests list, add `no-restricted-imports` or `no-restricted-syntax` entries (for example `SecretStorage`, `createPythonBridge`, the Altimate packages) and dependency-cruiser `forbidden` paths.
- Resolves: Qual §3 (absence guards), S5 (guard part); Prac §2 (absence assertions in `fusionIntegrationWiring.test.ts`).
- Revisions: (1) manifest checks moved; (2) rules; (3) test deletions.
- Verify: `just check`; reintroducing each symbol in a scratch file fails `just lint`.
- Depends: 0.14. Sequential (`eslint.config.cjs`).

### Phase 0 checkpoint

The reviewer confirms that `just lint` runs knip, both dependency-cruiser configs, the ratchet, the strict-TS counter, type coverage and the docs-symbol check; that `ceilings.json` is committed and CI compares it with the base branch; that `just check` growth is within the budget; and that no baseline gained entries outside 0.8's `max-lines` 400 seed. Release readiness: nothing changes for users; `just smoke` passes at the tip; no prerelease is needed.

## Phase 1: cleanup

### 1.1 One log port without telemetry parameters

- Goal: one logging interface with no telemetry-shaped arguments, and no catch-all barrel.
- Files: new `src/core/log.ts` (`Log` interface: `debug`, `info`, `warn`, `error(name, message, error?, ...args)`) replaces `DBTTerminal` (`dbt_integration/terminal.ts`) and `ManifestLogger` (`core/manifest/logger.ts`); `OutputChannels` implements it; every call site (about 86) drops the `sendTelemetry` argument; `src/dbt_integration/index.ts` loses its `export *` lines and importers import modules directly; the types `src/fusion/` still imports from `dbt_integration` (`EnvironmentVariables`, `DBColumn`, `DBTCommand`, `QueryExecution`) move to `src/core/`, and the 0.6 `fusion → dbt_integration` exception is deleted.
- Resolves: Prac 11 (`sendTelemetry`); Qual §4 (logging row, `DBTTerminal` out of the barrel, `dbt_integration/index.ts` fan-in 42).
- Revisions: (1) port and implementation; (2) call sites, mechanical; (3) barrel removal; (4) type moves and the exception removed.
- Verify: `just check`; `rg -n 'sendTelemetry|DBTTerminal|ManifestLogger' src` is empty; `rg -n 'export \*' src/dbt_integration` is empty; `rg -n 'dbt_integration' src/fusion` is empty.
- Depends: Phase 0. Sequential (`project.ts`, `compositionRoot.ts`, `fusionLanguageClient.ts`).

### 1.2 Manifest contributions

- Goal: valid manifest fields, and dbt menus only inside Declared Projects.
- Files: `package.json` (delete `capabilities.hoverProvider`; add `virtualWorkspaces: { supported: false, description: "Runs a local dbt executable." }`; give the `Cmd+'`/`Ctrl+'` keybinding `editorTextFocus && (resourceScheme == query-preview || fusionPowerUser.inProject && resourceLangId =~ /^sql$|^jinja-sql$/)`; fix the double space in `view ==  children_model_treeview`; delete `fusionPowerUser.query.template`; add `(fusionPowerUser.inProject || resourceScheme == untitled)` to every SQL-language `when`, so untitled SQL keeps its actions and picks a project on run); `src/settings/index.ts` (drop `query.template`); `src/projects/currentProject.ts` publishes `setContext('fusionPowerUser.inProject', …)` when the active editor changes; `commandConsistencyGuard.test.ts` asserts every SQL-language menu `when` includes that clause; a smoke checkpoint opens a `.sql` file outside any project and asserts no dbt editor-title action, and an untitled SQL editor still shows them.
- Resolves: Prac 3, 4, 5, 12, 13 (menus), 18; Prac §6 (virtual workspaces, `hoverProvider`, keybindings, `when` clauses, `query.template`).
- Revisions: (1) invalid and missing fields; (2) delete the setting; (3) context key and `when` clauses with the guard; (4) smoke checkpoint.
- Verify: `just check`; `just smoke-visual` (new `non-project-sql` checkpoint; model editor actions unchanged).
- Depends: 1.1. Sequential (`package.json`).

### 1.3 Remove the line-0 SQL action lenses

- Goal: no lenses that duplicate editor-title actions.
- Files: `src/features/sqlActions/sqlActionsCodeLensProvider.ts` (delete "Execute Query" and "Document"; keep the YAML run and test lenses) and its tests.
- Resolves: Prac 14.
- Revisions: one.
- Verify: `just check`; `just smoke-visual` model editor checkpoint shows no line-0 lens.
- Depends: 1.2. Parallel-safe with 1.4, 1.5.

### 1.4 Vendor leftovers in the webview

- Goal: no Altimate names or hosted documentation links in the shipped extension.
- Files: `webview_panels/src/modules/queryPanel/constants.ts`, `documentationEditor/components/help/TestsHelpContent.tsx`, `DocumentationHelpContent.tsx`, `lineage/components/help/HelpContent.tsx` (links go to docs.getdbt.com or are removed); `assets/icons/index.tsx` alt text; `AltimateSelect` → `Select` and `.altimate-select` → `.select` (`uiCore/components/select/`); `altimatePerspectiveViewer` → `perspectiveViewer` and `altimate-styles` → `perspective-styles` (`PerspectiveViewer.tsx`); an ESLint `no-restricted-syntax` rule on string and template literals matching `/altimate/i` in both configs.
- Resolves: Prac 10; Prac §2 (Altimate leftovers).
- Revisions: (1) links and alt text; (2) renames; (3) rule.
- Verify: `just check`; `rg -ni altimate src webview_panels/src --glob '!**/NOTICE.md'` is empty; `just smoke-visual` help pages.
- Depends: 1.2. Parallel-safe with 1.3, 1.5; sequential with 1.10 (`uiCore/components/select/`) and 1.9 (`eslint.config.cjs`).

### 1.5 Cruft and dbt-loom

- Goal: no comments about removed systems, and no plugin special case without a consumer.
- Files: `core/manifest/types.ts` (five "dbt cloud" comments), `DocGeneratorInput.tsx:107` (Redux comment), `uiCore/utilities.css:1` (Bootstrap comment), `lineagePanel.ts:212` ("dbt Cloud IDE"); delete dbt-loom support (`core/manifest/utils.ts:13-30`, `dbtLoomConfigPath` in `settings/environment.ts`, and its tests). finance-pipelines does not use dbt-loom; checked with `rg -il loom` on 2026-10-04.
- Resolves: Prac 11 (stale comments); Prac §2 (Bootstrap and dbt Cloud comments, `dbt_loom`).
- Revisions: (1) comments; (2) dbt-loom.
- Verify: `just check`; `rg -ni 'dbt.?loom|dbt cloud|redux|bootstrap' src webview_panels/src --glob '!**/test/**'` is empty.
- Depends: 1.2. Parallel-safe with 1.3, 1.4; sequential with 1.10 (`uiCore/utilities.css`) and 1.11 (`lineagePanel.ts`).

### 1.6 Dependency trims

- Goal: every dependency removal the reviews list that needs no design work.
- Files: root `package.json` and lockfile: drop `vscode-languageserver-protocol` (`fusionLanguageClient.ts` imports `ExecuteCommandRequest` from `vscode-languageclient/node`); `glob` → `fs.globSync` in `src/test/smoke/runTests.ts`, `src/test/integration/untrusted/index.ts`, `mediaAssets.test.ts` and any remaining runner; port `commandProcessExecution.test.ts` from `ts-mockito` to `vi.fn` and drop the package; check `@types/which` 3 against `which` 7, which ships no types: done when `just compile` passes with the pair and the `which(...)` call in `fusionExecutable.ts` types its result without a cast; otherwise pin `which` to the major `@types/which` describes, with a one-line reason in the `rearchitecture-plan.md` dependency row. Webview: `vite-plugin-svgr` → devDependencies; `use-debounce` → `useDebouncedValue` in `webview_panels/src/modules/app/` with a test; remove `NODE_OPTIONS=--max-old-space-size=8192` from `build:app` and `watch:app`.
- Resolves: Prac 15; Prac §3 (`glob`, `ts-mockito`, `which`/`@types/which`, `vite-plugin-svgr`, `use-debounce`, 8 GB flag); Qual M4 (`ts-mockito`, `glob`), O3.
- Revisions: one per package or flag.
- Verify: `just check`; `just package`; `npm ls vscode-languageserver-protocol` shows it only under `vscode-languageclient`; `just webviews::build` passes without the flag, with peak RSS recorded (`/usr/bin/time -l`) in the step's result.
- Depends: 1.11. Sequential (`package.json`, lockfile, `fusionLanguageClient.ts`).

### 1.7 Clear the cheap suppressions

- Goal: about 60 baseline violations fixed in files that survive Phase 2.
- Files: the Qual §5 "cheap now" table: `no-unused-vars` 20, `await-thenable` 6, `no-collapsible-if` 5, `eqeqeq` 1, `no-floating-promises` 19, `no-misused-promises` 4, and `no-explicit-any` in the `core/manifest/*Parser.ts` files and `types.ts`. The parser `new Promise(async …)` executors are already fixed in 0.7. Skip `cteCodeLensProvider.ts` (deleted in 2.9).
- Resolves: Qual §5 (cheap now).
- Revisions: one per rule.
- Verify: `just lint-prune`; `just check`; the root ceiling falls by the cleared count.
- Depends: 1.6. Sequential (wide edit).

### 1.8 One manifest read path; publish through the metadata port

- Goal: features read the manifest one way, and every publication goes through `ProjectMetadataSource`, so 2.4 changes the producer in one place (D1).
- Seam:

  ```ts
  export interface ProjectMetadataSource extends Disposable {
    readonly project: DeclaredProject;
    current(): Manifest | undefined; // the value consumers read as `Project.manifest`
    refresh(): Promise<void>;
    readonly onDidPublish: Event<Manifest>; // once per publicationEpoch
  }
  ```

- Files: `src/metadata/projectMetadataSource.ts` gains `onDidPublish`; `ManifestMetadataSource` holds the parse result that `Project` holds today and fires `onDidPublish` after each rebuild; `src/projects/projects.ts` fires `onDidChangeManifest` from `entry.metadataSource.onDidPublish` instead of `project.onDidChangeManifest`, and `Project.manifest` returns `metadataSource.current()`; `metadataContract.test.ts` asserts one publication per epoch; `QueryManifestService.manifestFor(uri)` replaces the duplicated preamble (`queryManifestService.ts:88-103`, `115-130`); `modelTreeviewProvider.ts`, `lineagePanel.ts`, `docsEditPanel.ts` and `queryResultPanel.ts` read through it; the duplicated tree subscription block (`modelTreeviewProvider.ts:100-112`, `252-264`) becomes one helper; the `architecture.md` metadata port section says the port is the only publication path.
- Resolves: Qual M1 (option a: the port is used, not deleted); Qual §4 (manifest-read row; `queryManifestService` and `modelTreeviewProvider` clones).
- Revisions: (1) publication through the port; (2) `manifestFor` and feature reads; (3) tree helper; (4) docs.
- Verify: `just check`; `rg -n 'project\.onDidChangeManifest' src/projects/projects.ts` is empty; `rg -n 'onDidChangeManifest' src/features` lists only `projects.onDidChangeManifest`; `just lint-markdown`.
- Depends: 1.7. Sequential.

### 1.9 Host nitpicks

- Goal: the #210 seed items, apart from the contract audit (0.10) and the lineage contract (1.11).
- Files: `src/projects/userFiles.ts` (replace only the changed range, computed from the common prefix and suffix; `readUserFile` reads through `workspace.fs.readFile` when the document is not open); `eslint.config.cjs` (the fs-write rule matches any binding of `fs` or `fs/promises`, and `workspace.fs.writeFile`/`delete` outside the allowed modules); `src/webview/panelHtml.ts` (the manifest cache is keyed on file mtime); `webview_panels/vite.config.ts` (chunks named by content hash or by explicit groups, never after their first module); `queryResultPanel.ts` (types `_queryTabData`); `webview_panels/src/modules/vscode/index.ts` (no file-wide `eslint-disable`); `src/test/integration/fusionLspCaptureProbe.test.ts` is renamed for the behaviour it guards, or deleted if it only records evidence.
- Resolves: #210 seed (whole-text replace, `readUserFile` opens documents, fs-write rule, `panelHtml` cache, `chunk-yaml.js` naming, `_queryTabData: any`, file-wide `eslint-disable`, `fusionLspCaptureProbe` name).
- Revisions: one per item.
- Verify: `just check` (unit tests: a minimal edit keeps an unchanged prefix; an unopened file read fires no `onDidOpenTextDocument`); `just smoke-visual` docs editor save.
- Depends: 1.8. Sequential with 1.4 (`eslint.config.cjs`).

### 1.10 uiCore nitpicks

- Goal: the #210 R7 items in shared webview components.
- Files: `Tooltip.tsx` (ignore a blur into the anchor, Escape, `aria-describedby` through `useId`); `Tooltip` and `PopoverWithButton` render through a portal on `document.body`, clamped to the viewport; `PopoverWithButton.tsx` (Escape closes it, and focus moves to the first control on open); `primitives.tsx` `Nav`/`NavLink` (drop the tab roles and use buttons with `aria-pressed`); the undefined classes (`d-inline`, `px-3 rounded`, `badge`, `flex items-center`, `card-footer`) are defined in `uiCore/utilities.css` or removed; the hard-coded colours left in `querypanel.module.css` and any others a re-grep finds become `--vscode-*` tokens; `drawer/index.tsx` (focus on open, restore on close, ignore Escape when `defaultPrevented`); `PreTag.tsx` ("Copy failed" title). The AcceptedValues Enter fix moves to 4.2, which replaces that input.
- Re-verify the items that may already be resolved, and close them on #210 if so: `--text-active` (no hit), `var(--action-red` (no hit), the plan's "not established" sentence (gone), the webview-state wording (past tense).
- Resolves: #210 R7 (all items except Enter submit).
- Revisions: (1) tooltip, popover and portal; (2) nav and drawer; (3) classes and colours.
- Verify: `just check` (testing-library keyboard tests for Tooltip, Popover and Drawer); `just smoke-visual` in all three themes.
- Depends: 1.4 (`uiCore/components/select/`, help pages) and 1.5 (`uiCore/utilities.css`). Sequential.

### 1.11 Lineage nitpicks

- Goal: the #210 R8 optional items and the lineage contract cleanup.
- Files: draw every known parent–child pair between drawn tables (`graph.ts:94`), do not write view state until `drawnKey` advances (`useLineageGraph.ts:206`), `transparent` instead of the `rgb(0 0 0 / 30%)` fallback, `flow.ts` uses `expansionKey`/`isExpanded`, column handles keep case, a collapse cancels an in-flight expand (generation counter), and a restore test asserts the `selectedColumn` trace replays through `getConnectedColumns`; the contract drops `currAnd1HopTables`, `selectedColumn` and `showIndirectEdges` (`lineage.ts:150`) and `allowSelfReference` (`:165`), with their senders (`graph.ts:356`) and the host (`lineagePanel.ts:361`).
- Re-verify, and close on #210 if resolved: `aiEnabled` and AI chat (no hit), and the static SQL lineage mode (delete any remnant).
- Resolves: #210 R8 optional (all items), #210 seed (`getConnectedColumns` drops parameters).
- Revisions: (1) lineage graph; (2) lineage contract with the host.
- Verify: `just check`; `just smoke-visual` lineage checkpoints; `rg -n 'currAnd1HopTables|allowSelfReference|showIndirectEdges' src webview_panels/src packages` is empty.
- Depends: 1.10. Sequential (`lineagePanel.ts`, webview suppression file).

### Phase 1 checkpoint

The reviewer reads every Phase 1 PNG against its record (menus outside a project, model editor lenses, help pages, themes) and ticks the #210 items. Release readiness: users see changes, so cut a beta prerelease. Release notes: `fusionPowerUser.query.template` removed; line-0 Execute and Document lenses removed; dbt menus only inside Declared Projects; virtual workspaces unsupported; dbt-loom manifests no longer merged.

## Phase 2: the language server first

### 2.1 ADR 0007: project metadata and previews from the language server

- Goal: record the routing before any code moves.
- Files: new `docs/adr/0007-project-metadata-and-previews-from-the-language-server.md` (D2–D5 and D8 as written in [One seam](#one-seam-the-composite-producer-d8): one consumer seam, the composite producer, field ownership, the merge and freshness rules, the migration rule and the target state; the parse-owned list from [Grounding](#grounding); the table and column lineage, tree, preview, CTE and column routing below); `CONTEXT.md` adds **Server Producer** (the Project Metadata Source half that reads `dbt.listNodes` and `dbt.getProjectInfo`; *Avoid*: LSP cache, graph source) and **Parse Producer** (the half that reads `manifest.json` from `dbt parse`, for the fields in `docs/lsp-metadata-gaps.md`; *Avoid*: manifest fallback), and **Project Metadata Source** becomes "the composite producer behind `Projects.onDidChangeManifest` for one Declared Project: the Server Producer first, the Parse Producer for the gaps"; `docs/architecture.md` operation routing paragraph and the metadata port section ("the Fusion LSP does not populate this port" becomes the composite description); `AGENTS.md:78` and `docs/architecture.md:70` keep their "no second consumer seam" rule unchanged; each gains one sentence after the port sentence: "Behind the port, a composite producer fills each field from the language server where it can and from the CLI parse for the fields in `docs/lsp-metadata-gaps.md`; consumers see one merged value."
- Resolves: Prac 8 (ADR); the requirements to prefer the server and to name what stays on the parse.
- Revisions: (1) ADR; (2) CONTEXT, architecture and `AGENTS.md`.
- Verify: `just lint-markdown` (docs-symbol check allowlists `CompositeMetadataSource`, `ServerMetadataSource` and `FIELD_OWNERS` until 2.4 lands); `rg -n 'second consumer seam' AGENTS.md docs/architecture.md` still matches both lines; `rg -n 'composite producer' AGENTS.md docs/architecture.md` matches both lines.
- Depends: 1.8. Docs only and parallel-safe, so it can be drafted during Phase 1.

### 2.2 Adoption experiments

- Goal: settle the open server behaviours before code depends on them.
- Files: `scripts/evidence/experiments/e1-…e9-*.mjs` built on the spike harness (`scripts/spikes/lsp-capabilities/lib.mjs`); `docs/research/lsp-adoption-experiments-october-2026.md`; evidence under `docs/research/evidence/lsp-2.0.6/adoption/`. Fixtures: `test-fixtures/jaffle-shop-duckdb`, plus a local copy of finance with warehouse values redacted, as in the spike. Decision rules are fixed before running:
  - E1, graph selector: try `["package:<root>"]`, `["+package:<root>"]` and their union. Choose the smallest that contains every `depends_on` target; otherwise draw missing package nodes as placeholders labelled with their `unique_id`. Also record which resource types appear (snapshots were not in the spike fixtures); the result fills the server-owned resource types in `FIELD_OWNERS`.
  - E2, `dbt.show` concurrency and cancellation: run `show` against `listNodes` and `show` against `compileFile`, and send `$/cancelRequest` during a long Snowflake query (check the query history). The existing `listNodes` queue (`fusionLanguageClient.ts:431-475`) stays. Each command class gets its own queue; if a pair interferes (one stalls or cancels the other), those two classes share one queue. If cancelling does not stop the warehouse query, the UI drops the result and says the query may still run.
  - E3, compiled SQL of unsaved text through the server: `didChange` then `compileFile`, and an inline `dbt.show` wrapper. If neither returns compiled text for the buffer, D5 stands.
  - E4, error shapes of `show`, `compileFile`, `getCurrentNode` and `listNodes`, and the time each takes on the finance copy. These become the `FusionCommandError` kinds and the per-command deadlines. Known shapes: `listNodes` returning `{"error":"No nodes found","error_kind":"lineage_query_failed"}` maps to an empty result, not an error; `show` returning `{columns:null,data:null,error}` maps to `server` with the `error` text.
  - E5, two Declared Projects with command prefixes on 2.0.6 (multi-root fixture): the lens command id and the prefixed command names. The 2.9 lens mapping matches whatever is observed.
  - E6, disk-watch scope: edits to macros, `dbt_project.yml` and `packages.yml` made outside the editor. Where the server misses one, the registry watcher triggers a Server Producer refresh.
  - E7, `workspace/willRenameFiles`: whether `vscode-languageclient` forwards it for a model rename in VS Code and Cursor. If both forward it and the server edits `ref()` calls, record it in `docs/lsp-coverage.md` and add nothing. If either does not, record it as a Fusion or client gap in `docs/lsp-coverage.md`; no extension code in this plan.
  - E8, baseline mode: `listNodes` project grain, lenses, and the latency of `getCurrentNode` falling back to introspection. It passes if `listNodes` in `baseline` returns every model node and every `depends_on` edge that `strict` returns on jaffle and finance; otherwise `FIELD_OWNERS` assigns the graph fields to the parse producer for `baseline` projects, and 2.6 keeps the parse graph parsers. Column p50 above 3 s on finance is the stop in [Risks](#risks-and-checkpoints).
  - E9, compiled paths under `fusionPowerUser.lsp.compiledOutput: shared`: `toLspLaunch` (`src/core/lsp/lspLaunch.ts:42-55`) drops `DBT_LSP_USE_TARGET_LSP` in `shared` mode. Record `compileFile`'s `file_uri` and the CTE lens `compiled_path` in both modes. If both point at files that exist and hold the compiled text in both modes, 2.7 and 2.9 use the returned paths verbatim. Otherwise remove the `shared` value (setting, `FUSION_POWER_USER_LSP_COMPILED_OUTPUT`, tests) in 2.7, with a release note.
- Resolves: Prac 7 (evidence experiment); Spike "Not established" (`show` cancellation, multiple projects and command prefix, disk-watch scope); Spike file-rename row.
- Revisions: (1) scripts; (2) research note and evidence.
- Verify: `just lint-markdown`; each experiment prints its decision; the note links every evidence file.
- Depends: 0.2. Parallel-safe (scripts and docs; finance runs take the heavy-run lock), so it runs during Phase 0 and Phase 1 review waits.

### 2.3 Split the Fusion client and add `FusionCommands`

- Goal: one typed façade for every server command, and no god file.
- Files: `fusionLanguageClient.ts` split into `src/fusion/lspProcess.ts` (`ProcessStreamBuffer`, `SpawnedLspProcess`, `PARTIAL_LINE_LIMIT`, backoff, `CONNECTION_TIMEOUT_MS`), `src/fusion/documentSelector.ts` (`documentSelectorForProject`, `validateDocumentSelectorPatterns`) and new `src/fusion/fusionCommands.ts`; pure result types and adapters in `src/core/lsp/commands.ts`; `Project.lsp` is a `FusionCommands` façade over the pool: each call resolves the project's current client from the pool, so a restart never leaves a stale reference, and `state` reads `notRunning` when the pool has no client; column lineage in `dbtLineageService.ts` calls `project.lsp.listNodes`; `@internal` tags that are no longer needed are removed. Each new file stays under 400 lines.
- Seam:

  ```ts
  export interface FusionCommands {
    readonly state: FusionClientState;
    listNodes(selectors: readonly string[], token?: CancellationToken): Promise<ListNodesResult>;
    getCurrentNode(relativePath: string): Promise<CurrentNodeResult>;
    compileFile(uri: Uri): Promise<CompileFileResult>;
    show(query: { uri?: string; inline?: string; limit: number }, token?: CancellationToken): Promise<ShowResult>;
    getProjectInfo(): Promise<ProjectInfo | undefined>; // undefined until the first compile
  }
  // Rejects with FusionCommandError { kind: "notRunning" | "cancelled" | "timeout" | "server", message }.
  // Each command has a deadline (from E4's timings; `show` none, since the user cancels it); "timeout" when it passes.
  // E4's known non-errors (listNodes "No nodes found") resolve as empty results.
  ```

- Resolves: Qual S7, §1D (`fusionLanguageClient.ts` seams), §4 (922-line god module); Prac 11 (constants exported only for tests).
- Revisions: (1) `lspProcess.ts`; (2) `documentSelector.ts`; (3) `FusionCommands` with the per-class queues and cancellation per E2, the deadlines and the E4 error mapping, with tests; (4) `Project.lsp` wiring and column-lineage call site.
- Verify: `just check`; `just test-integration`; `fusionLanguageClient.ts` under 600 lines with no `max-lines` entry; the `internalTags` ceiling falls.
- Depends: 2.2, Phase 1. Sequential (`fusionLanguageClient.ts`, `project.ts`, `compositionRoot.ts`).

### 2.4 Server Producer behind the metadata port

- Goal: the language server fills every field it can supply, behind the existing port and seam (D8).
- Seam:

  ```ts
  // src/core/metadata/ — pure
  type Field = "nodes" | "graph.parents" | "graph.children" | "depth" | "projectInfo" | /* parse-owned keys */ string;
  export const FIELD_OWNERS: Readonly<Record<Field, "server" | "parse">>;
  export function serverMetadataFrom(nodes: ListNodesResult, info: ProjectInfo | undefined): ServerMetadata;
  export function mergeMetadata(server: ServerMetadata | undefined, parse: ParsedManifest | undefined): ParsedManifest;
  // src/metadata/ — adapters, each implements ProjectMetadataSource
  class ServerMetadataSource   // project.lsp.listNodes(["package:<root>"]) + getProjectInfo
  class CompositeMetadataSource // owns ServerMetadataSource and ManifestMetadataSource; the only one wired in projects.ts
  ```

- Files: new `src/core/metadata/fieldOwners.ts`, `serverMetadata.ts` (over the E1 selector: node identity into `nodeMetaMap`, `graphMetaMap.parents`/`.children` inverted from `depends_on`, `modelDepthMap` by `modelDepthParser`'s rule, adapter type and project name) and `mergeMetadata.ts` (the merge rule in [One seam](#one-seam-the-composite-producer-d8)); new `src/metadata/serverMetadataSource.ts` (refreshed single-flight on `dbt/lspCompileComplete`, `dbt/lspBackgroundCompileComplete` and E6's registry events; skips publication when the node list hash is unchanged) and `compositeMetadataSource.ts` (one merged publication per producer update); `projects.ts` wires the composite; `Manifest` loses `metadataProducer` and `producerRevision`; `lsp-metadata-gaps.md` parity test (`src/test/suite/fieldOwners.test.ts`: every parse-owned key has a row, and no row names a server-owned key). Tests: property tests on the merge (every edge endpoint is a node or a placeholder; `children` is the inverse of `parents`; parse-owned fields equal the parse input; server-owned fields equal the server input when present); a golden test comparing server and parse `graphMetaMap.parents`/`.children` and `modelDepthMap` on the single-project and jaffle captures; a composite test (a server update and a parse update each fire exactly one `onDidChangeManifest` with the merged value; an unchanged node list fires none); integration test against the pinned binary (open the fixture, check the merged parents, save an edit that adds a `ref`, check the new edge appears before any `dbt parse` spawn).
- Resolves: Prac 8 (graph from `listNodes`); Prac §5.2 (adapter type and project name from `getProjectInfo`, depth from `depends_on`); Qual M1 (the port gains the composite producer); Spike table lineage and `childCount`/`parentCount` rows.
- Revisions: (1) `FIELD_OWNERS`, server adapter and merge, pure, with tests; (2) `ServerMetadataSource`; (3) `CompositeMetadataSource` and wiring; (4) integration test.
- Verify: `just check`; `just test-integration --grep "server producer"`; `rg -n 'metadataProducer|producerRevision' src` is empty.
- Depends: 2.3. Sequential (`project.ts`, `projects.ts`).

### 2.5 Table lineage on the merged value

- Goal: table lineage reads graph fields that the server fills, through the one seam.
- Files: `dbtLineageService.ts` keeps reading the `Manifest` it is given: `getConnectedTables` and `getConnectedNodeCount` read `graphMetaMap.parents`/`.children`, and `createTable` builds each table node from the server-owned fields (name, path, resource type, materialization) of the merged `nodeMetaMap`, so a model added since the last parse appears with 0 tests; descriptions, meta, test counts and the `constraint` overlay are parse-owned fields of the same value, with no separate label. Remove any read that bypasses the merged value. `lineagePanel.ts` keeps re-rendering on `onDidChangeManifest`, and shows the client state when the server-owned fields are empty. When they are empty and the project runs in `baseline`, the panel says so and names `fusionPowerUser.staticAnalysis` as the setting that fills it, instead of an empty canvas.
- Resolves: Prac 8; Prac §5.3 (two lineage sources); Spike table lineage rows.
- Revisions: (1) service; (2) panel, with the `baseline` empty-graph message.
- Verify: `just check` (unit test: a merged value whose server node is absent from the parse input draws the node with 0 tests); `just test-integration`; `just smoke-visual` lineage checkpoints show the same nodes, edges and column lists as before; `rg -n 'project\.lsp|listNodes' src/features/lineage/dbtLineageService.ts` matches only the column-lineage call.
- Depends: 2.4. Parallel-safe with 2.6 (1).

### 2.6 Model trees on the merged value; delete the parse graph

- Goal: the Parent and Children trees and depth read server-owned fields, and the parse producer stops computing them.
- Files: `modelTreeviewProvider.ts` (`ChildrenModelTreeview`, `ParentModelTreeview`, depth) keeps reading `graphMetaMap` and `modelDepthMap` from the merged value and its `onDidChangeManifest` subscription; empty server-owned fields in `baseline` show one item that names `fusionPowerUser.staticAnalysis`; Model Tests and Documentation trees unchanged; a smoke checkpoint for the Parent and Children trees. Deletions, as a separate revision rooted after both 2.5 and 2.6 (1) land, and only if E8 passed: `core/manifest/modelDepthParser.ts`, the parents and children computation in `graphParser.ts`/`childrenParentParser.ts` (`graphMetaMap.tests` and `.metrics` stay parse-owned), and the parse producer's `modelDepthMap`; `FIELD_OWNERS` loses the `baseline` parse fallback. The deletion revision re-baselines coverage floors (see [Gate budget](#gate-budget)).
- Resolves: Prac 8 (trees); Spike model tree row; Prac §5.2 (`modelDepthMap`).
- Revisions: (1) trees and smoke checkpoint; (2) parser deletions, after 2.5.
- Verify: `just check` (2.4's golden test now compares the server output with the committed capture instead of the deleted parsers); after (2), `rg -n 'modelDepthParser' src` is empty and `FIELD_OWNERS` maps no graph field to `parse`; `just smoke-visual`.
- Depends: 2.4; revision (2) also on 2.5. Revision (1) is parallel-safe with 2.5.

### 2.7 Compiled preview from `dbt.compileFile`

- Goal: the preview never starts a CLI process for a saved model, and shows no toast while the user types.
- Files: `src/features/compiledSql/sqlPreviewContentProvider.ts` (a saved model reads the file at the `file_uri` returned by `project.lsp.compileFile(uri)`, verbatim, per E9, and refreshes on that project's compile-complete; before the first `dbt/lspCompileComplete` after a client start, the provider awaits it and shows "Waiting for the first compile" instead of calling `compileFile`; delete the per-keystroke debounce; while the source is dirty, the first line is `-- Unsaved changes: showing the last saved version.`; untitled SQL uses `compileInline` only when the preview command is invoked; progress uses `ProgressLocation.Window`); `runModel.ts` `compileQuery` uses the same path; `project.ts` `unsafeCompileQuery` serves only the untitled case; if E9 failed, the `shared` value of `fusionPowerUser.lsp.compiledOutput` and of `FUSION_POWER_USER_LSP_COMPILED_OUTPUT` is removed.
- Resolves: Prac 2; Prac §5.3 (two compiles); Prac §6 (progress); Spike compiled SQL row; D5.
- Revisions: (1) provider with a fake `FusionCommands` in tests; (2) compile command; (3) integration test; (4) the `shared` removal, only if E9 failed.
- Verify: `just check`; `just test-integration` (preview text equals `compileFile` output, and a process spy sees no `dbt compile`); `just smoke-visual` compiled preview checkpoint with no notification.
- Depends: 2.3 (E3, E9). Sequential with 2.8 (`project.ts`) and with 2.9 (both edit `fusionLanguageClient.ts`).

### 2.8 Query preview and distinct values through `dbt.show`

- Goal: running SQL starts no CLI process.
- Files: `src/projects/projectSql.ts` (`executeSQL` → `project.lsp.show({ inline, limit }, token)` with the editor text, dirty or not; untitled SQL uses the picked project; `getColumnValues` → `show`; cancellation per E2; when the client is not running, the query panel shows its state with **Show output**); the compiled tab of a clean saved model shows `compileFile` text; for a dirty model, an untitled file or a selection it shows "Compiled SQL is shown after save" (a loss for untitled and selected SQL, release-noted at the Phase 2 checkpoint); delete `FusionCli.show`, `FusionCli.executeSQL`, `showPreview` and the `show` CLI kind with its property cases. Submitted SQL stays byte-identical: the reference is the string passed to `FusionCli.executeSQL` today for the same editor text and limit, captured as golden fixtures in revision (1) before the switch, and the `inline` sent to `show` must equal it.
- Resolves: Prac 7 (`executeSQL`, `getColumnValues`); Spike query preview row; D4.
- Revisions: (1) golden fixtures of today's submitted SQL; (2) query path; (3) distinct values; (4) CLI deletions, re-baselining coverage floors.
- Verify: `just check`; `just test-integration` (rows on the fixture, no CLI spawn); `just smoke-visual` query results checkpoints; `rg -n 'kind: "show"' src` is empty.
- Depends: 2.9 (stacked after 2.7 and 2.9). Sequential (`project.ts`, `fusionCli.ts`).

### 2.9 CTE lenses and profiling from Fusion

- Goal: one CTE detector, the server's.
- Files: the `provideCodeLenses` middleware in `fusionLanguageClient.ts` maps each `dbt.previewCte` lens (prefixed per E5) to "Execute CTE: <name>" (`fusionPowerUser.runCteWithDependencies`, arguments `{ uri, cte: { name, compiledPath, compiledStart, compiledStop } }`) and adds one "Profile CTEs" lens on the first CTE; new pure `src/core/cte/ctePreview.ts`, which reads the file at `compiledPath` verbatim (per E9) and slices it by byte offsets, because the server's `compiledStart`/`compiledStop` count UTF-8 bytes: `Buffer.from(compiled).subarray(start, stop).toString() + "\n)\nselect * from " + name`, with unit tests and a fast-check property over non-ASCII text (the slice of a generated CTE body equals the body); `cteProfilerService.ts` runs `project.lsp.show` per CTE; delete `cteCodeLensProvider.ts`, `cteCodeLensProvider.test.ts`, `cteCodeLensProvider.property.test.ts` and `withoutUnregisteredLspLenses`; `CteInfo` becomes `FusionCte`; documents with unsaved edits show no CTE lenses (D2); a new fixture model with CTEs and its smoke checkpoint.
- Resolves: Prac 9; Prac 7 (CTE profiler); Prac §5.3 (two CTE detectors); Qual §3 (CTE lens cluster), §4 (`cteCodeLensProvider.ts` god module and clone); Spike CTE preview and profiling rows.
- Revisions: (1) pure slice builder; (2) middleware mapping and command; (3) profiler; (4) deletions, re-baselining coverage floors; (5) fixture and smoke.
- Verify: `just check`; `just test-integration` (lens count equals CTE count on jaffle `orders.sql`; Execute returns rows); `just smoke-visual` CTE lens checkpoint.
- Depends: 2.7 (`fusionLanguageClient.ts`), E9. Sequential with 2.10 (`compositionRoot.ts`, `commands.ts`).

### 2.10 Columns from `getCurrentNode` and introspection

- Goal: column fetches start no CLI process.
- Files: models use `project.lsp.getCurrentNode(relPath)` when it returns columns, and otherwise `show` with the `adapter.get_columns_in_relation` inline from `bench/extras.json`; sources always use the introspection inline; new pure `src/core/lsp/columns.ts` parses `name:type` cells; call sites `docsEditPanel.ts:641,652,745`, `lineagePanel.ts:396`, `projectCodegen.ts:61,128`; delete `FusionCli.getColumnsOfModel`, `getColumnsOfSource` and `columnsQuery`. The server's column spelling is used only for column lineage requests, so column lineage on Snowflake works. Writers keep the spelling already in the YAML: `docsEditPanel.ts:421,749,895,958` and `projectCodegen.ts:214-219` match server columns to existing YAML columns case-insensitively and write the existing name; only a column new to the YAML takes the server's spelling.
- Resolves: Prac 7 (`getColumnsOfModel`/`getColumnsOfSource`); Prac §5.3 (two column sources); Spike column types row and "Source YAML generation".
- Revisions: (1) parser; (2) model columns; (3) source columns; (4) deletions, re-baselining coverage floors.
- Verify: `just check` (unit test: a YAML column `Order_ID` stays `Order_ID` after a sync that returns `ORDER_ID`); `just test-integration` (docs editor column sync on the fixture; source columns on a DuckDB seed source); `rg -n get_columns_in_relation src --glob '!src/core/lsp/**'` is empty.
- Depends: 2.8, 2.9. Sequential (`fusionCli.ts`, `compositionRoot.ts`).

### 2.11 Parse on demand

- Goal: a save no longer starts `dbt parse` unless a consumer of a parse-owned field is showing (D3). The Server Producer keeps server-owned fields fresh on every compile, so lineage and trees do not need the parse.
- Files: `src/projects/manifest.ts` `ManifestTrigger` (the Parse Producer's trigger): watcher events mark the parse stale; parse runs single-flight on activation, on a snapshot revision, on `dbt_project.yml`/`profiles.yml`/`packages.yml`/`dependencies.yml`/`selectors.yml` changes, and after `dbt/lspCompileComplete` or `dbt/lspBackgroundCompileComplete` while the Documentation tree, Model Tests tree, docs editor, lineage details drawer or test generation is visible; `QueryManifestService.freshManifest(uri)` awaits a stale parse rebuild and returns the merged value; each parse completion publishes through the composite as in [One seam](#one-seam-the-composite-producer-d8); `ProjectErrors` keeps the CLI parse and server notification sources. Record parses per 10 saves on the finance copy, before and after.
- Resolves: Prac 8 (double parse, measured); Prac §5.2 (parse on `lspCompileComplete`); Prac §5.3 (two parses); Spike manifest freshness row.
- Revisions: (1) stale state and triggers; (2) consumer visibility; (3) measurement in the step result.
- Verify: `just check`; `just test-integration` (save with no parse-field consumer visible: no `dbt parse` spawn, and the lineage panel shows a new `ref` edge; opening the docs editor: one parse); `just smoke-visual`.
- Depends: 2.5, 2.6, 2.10. Sequential (`project.ts`).

### 2.12 Routing documentation

- Goal: the architecture document describes what runs where.
- Files: `docs/architecture.md` (routing table of language server, CLI and manifest; the queued tasks versus direct CLI calls, of which only the version probe, parse and untitled compile remain); `docs/lsp-coverage.md` gains a "used by" column; `docs/lsp-metadata-gaps.md` opens with the migration rule and the target state from [One seam](#one-seam-the-composite-producer-d8); `scripts/spikes/lsp-capabilities/README.md` gains the Fusion upgrade procedure (which scripts to run on which projects, the output document name, and the migration revision's four files); README feature list.
- Resolves: Qual §4 (running-dbt row: document the split); Prac §5.1 (CLI inventory); D8 migration rule.
- Revisions: one.
- Verify: `just lint-markdown`; `just lint-unused` reports no dead CLI kind.
- Depends: 2.11. Docs only, parallel-safe.

### Phase 2 checkpoint

The reviewer runs `just test-integration` and `just smoke-visual` and reads every lineage, preview, query and CTE PNG. A manual check on the finance copy in `baseline` and `strict` covers these R9 broader-parity items: compile and compiled SQL; query and CTE preview; model and column lineage; local documentation editing. Release readiness: cut a beta prerelease. Release notes: CTE lenses appear on saved files only; the compiled preview shows the last save; the query panel's compiled tab is empty for untitled files and selections; query, preview and columns need a running Fusion Client; in `baseline`, lineage and trees explain an empty graph; `lsp.compiledOutput: shared` removed if E9 failed. R9 starts on this prerelease.

## Phase 3: structure and tests

### 3.1 Characterization tests

- Goal: tests before refactoring the least-covered code.
- Files: tests for `core/manifest/relationshipParser.ts` (2.7%), `features/docs/docGenService.ts` (3.4%), `features/docs/dbtTestService.ts` (7.6%), `queryResultPanel.ts` (14.4%), `commands.ts` (25.2%), `webview/panelHost.ts` (46%).
- Resolves: Qual S6, §3 (worst-covered files).
- Revisions: one per file.
- Verify: `just check`; coverage floors in `ceilings.json` rise.
- Depends: Phase 2. Sequential (tests only, but each revision raises floors in `ceilings.json`).

### 3.2 One error-notification helper

- Goal: every error notification has the same wording and a **Show output** action.
- Files: new `src/projects/notifications.ts` (`notifyError(project, message, error?)` names the project and opens its output channel; `notifyErrorWithoutProject(message, error?)` for errors before a project is resolved, such as activation and the project picker, opens the extension's main output channel; both reuse `SHOW_OUTPUT` from `projectErrors.ts`); the 31 `window.showErrorMessage` sites in 17 files; `no-restricted-properties` bans `window.showErrorMessage` outside the helper and `ProjectErrors`.
- Resolves: Qual S4, §4 (error-reporting row), §6 (`showErrorMessage` ban).
- Revisions: (1) helper; (2) call sites by directory; (3) rule.
- Verify: `just check`; `rg -n 'showErrorMessage' src --glob '!src/test/**'` lists only the two modules.
- Depends: 3.9. Sequential (feature-wide).

### 3.3 Typed `PanelHost.post`

- Goal: one typed outbound path with replay.
- Files: `src/webview/panelHost.ts` (`post(message: HostMessage)`; the replay buffer moves here from `queryResultPanel.ts`); `lineagePanel.ts:259`, `queryResultPanel.ts:111,591`, `docsEditPanel.ts:143` (the documentation editor extends `PanelHost`); ESLint bans `webview.postMessage` outside `panelHost.ts`; contract guards share one generic `isMessageOf`.
- Resolves: Qual S3, §4 (webview messaging row; contract guard clones).
- Revisions: (1) `post` and replay; (2) panels; (3) guard helper; (4) rule.
- Verify: `just check`; `just smoke-visual` all panels, including the replay checkpoints.
- Depends: 3.2. Sequential.

### 3.4 Split the documentation editor host

- Goal: `docsEditPanel.ts` under 400 lines with no suppressions.
- Files: message handlers move to `src/features/docs/docsEditHandlers.ts` (split by concern if over 400 lines); its 23 suppressions are fixed.
- Resolves: Qual §4 (god module), §5 (refactor table row).
- Revisions: one per handler group.
- Verify: `just check`; `just smoke-visual` documentation editor; the ceiling falls.
- Depends: 3.3. Sequential with 3.5 (both shrink `eslint-suppressions.json` and lower its ceiling).

### 3.5 Split command registration

- Goal: each feature registers its own commands.
- Files: `src/features/commands.ts` `register()` → `src/features/<feature>/commands.ts`; the aggregator only composes; its 11 suppressions are fixed.
- Resolves: Qual §4 (god module), §5 (refactor table row).
- Revisions: one per feature.
- Verify: `just check` (`commandConsistencyGuard`); `just smoke`.
- Depends: 3.4. Sequential (`compositionRoot.ts`, `eslint-suppressions.json`).

### 3.6 Rewrite the source codegen lens walk

- Goal: a flat CST walk.
- Files: `sourceModelCreationCodeLensProvider.ts` (`for…of` and early returns; 20 suppressions, 16 of them `max-depth`), relying on the 0.7 tests.
- Resolves: Qual §5 (refactor table row).
- Revisions: one.
- Verify: `just check`; the ceiling falls.
- Depends: 3.1. Sequential (`eslint-suppressions.json`, `ceilings.json`).

### 3.7 Type the manifest core

- Goal: no `any` in `core/`.
- First re-measure: 2.6 may have deleted most of `childrenParentParser.ts` and `graphParser.ts`. Type only what remains; if `rg -n ': any|as any' src/core` is already empty, the step is only the rule.
- Files: `childrenParentParser.ts` (15 suppressions, 11 `any`), `relationshipParser.ts` (9), the three `graphParser.ts` clones (`:85-140`), the `dbtTestService.ts:215-241` clone; `@typescript-eslint/no-unsafe-*` enabled for `src/core/**`.
- Resolves: Qual §5 (refactor rows; zero `no-explicit-any` in `core/`), §6 (`no-unsafe-*` for `core/`), §4 (graphParser and dbtTestService clones).
- Revisions: (1) parsers; (2) clones; (3) rule.
- Verify: `just check`; `rg -n ': any|as any' src/core` is empty.
- Depends: 3.5. Sequential with 3.8.

### 3.8 Split the remaining large hosts

- Goal: every production file under 600 lines.
- Files: `queryResultPanel.ts` (609 lines, 7 floating promises), `lineagePanel.ts` (877); `project.ts` if still over 600 after Phase 2.
- Resolves: Qual §4 (god modules).
- Revisions: one per file.
- Verify: `just check`; no `max-lines` entries remain for these files; `just smoke-visual`.
- Depends: 3.7. Sequential (`project.ts`).

### 3.9 Split `utils.ts`

- Goal: no grab-bag module.
- Files: `src/utils.ts`: each of the remaining exports moves to the module of its only caller, or to a topic module (`src/core/text.ts`, `src/core/paths.ts`, …).
- Resolves: Qual §4 (`utils.ts` fan-in hub).
- Revisions: one per topic.
- Verify: `just check`; `src/utils.ts` deleted, or 100 lines or fewer.
- Depends: 3.6. Sequential (`eslint-suppressions.json`, `ceilings.json`).

### 3.10 Consolidate tests

- Goal: fewer test lines with no lost behaviour. The quality review estimated about 2,400, but 2.9 deletes the CTE lens cluster; re-estimate per cluster with `wc -l` at the start of the step and record it in the step result.
- Files: each Qual §3 cluster is one revision: executable resolution (one fixture builder in `src/test/projectHarness.ts`; merge `fusionCliExecutable` into `executableLifecycle`); CLI arguments (properties plus a table of golden examples); LSP launch and snapshot (shared fixture); configuration errors (trim the unit suite to `errorHint`); composition and activation (one composition fixture); `lineagePanel.test.ts` with `it.each`; `fusionClientPool.test.ts` `startPool`/`expectRestarted` helpers; integration helpers in `integration/helpers/`, with a shared `lspFixture` for `lspEditorFeatures` and `nativeEditorFeatures`; one copy of the `src/test/common.ts`/`mock/vscode.ts` helper.
- Rule: coverage floors may not drop, and the reviewer reads the test-name diff of each revision.
- Resolves: Qual §3 (consolidation table, lspFixture sharing, mock duplication), S5 (consolidation part).
- Verify: `just check`; `just test-integration`; jscpd test clone count recorded in the step result.
- Depends: 3.8. Sequential with 3.11.

### 3.11 Assert outcomes, not calls

- Goal: the most mock-heavy suites assert values.
- Files: `runModel.test.ts` and `projectSetupCommands.test.ts` assert the `CliCommand`/`QueuedCliCommand` built through `cliArgs`; the `projectSetupCommands.ts:55-70`/`:100-116` clone is extracted; `dbtPowerUserExtension.test.ts` and `projects.test.ts` replace call assertions where an outcome exists.
- Resolves: Qual §3 (tests that mostly test mocks), §4 (`projectSetupCommands` clone).
- Revisions: one per suite.
- Verify: `just check`; the share of `toHaveBeenCalled` assertions in `src/test/suite` is recorded and lower.
- Depends: 3.10. Sequential.

### 3.12 Meet the suppression targets

- Goal: root suppressions at most 100, webview at most 30.
- Files: the webview baseline (`@eslint-react/exhaustive-deps` 15, `max-lines-per-function` 15, `set-state-in-effect` 6, `only-export-components` 4, and the rest); `no-unsafe-*` extended to `src/settings/**` and `src/fusion/**`; ceilings lowered.
- Resolves: Qual §5 (targets), §6 (`no-unsafe-*` by directory).
- Revisions: one per rule.
- Verify: `just check`; `ceilings.json` shows 100 or fewer and 30 or fewer.
- Depends: 3.11. Sequential.

### Phase 3 checkpoint

The reviewer confirms that every production file is under 600 lines, the ceilings are met, coverage floors are no lower than at Phase 0, and the error notifications read consistently (smoke-visual of one failure notification). Release readiness: only notification wording changes for users; a prerelease is optional.

## Phase 4: upgrades before 1.0

### 4.1 Strict flags in production at zero

- Goal: `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` everywhere in production.
- Files: production `tsconfig.json` (excludes `src/test/`) with both flags; new `src/test/tsconfig.json` referencing it, without the flags; the same split in `webview_panels/`; delete `tsconfig.strict.json`, `strict-ts.mjs` and their ceilings.
- Resolves: Qual §6 (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, production).
- Revisions: one per directory group, then the config switch.
- Verify: `just check`; `just compile` runs both projects.
- Depends: Phase 3. Sequential.

### 4.2 Replace react-select

- Goal: no Emotion runtime, and a narrower style CSP if possible.
- Files: `uiCore/components/select/` and `queryPanel/components/filters/Filters.tsx` move to native `<select multiple>` and `<datalist>`, or `@vscode-elements/elements` `vscode-multi-select` where native cannot express the control; the creatable accepted-values input (`AcceptedValues.tsx`/`TestForm.tsx`) becomes an input with chips, where Enter on an empty input calls `preventDefault` instead of submitting the form (#210 R7); try removing `style-src 'unsafe-inline'` per panel and record the result in `docs/research/webview-csp-october-2026.md`.
- Resolves: Prac §3 (react-select); Prac §6 (`unsafe-inline` styles); #210 R7 (Enter submit).
- Revisions: (1) select; (2) accepted-values input; (3) filters; (4) CSP.
- Verify: `just check` (testing-library test: Enter on an empty accepted-values input does not submit); `npm ls @emotion/react react-select` is empty; `just smoke-visual` documentation editor test form and query filters with no CSP violation logged.
- Depends: 4.1. Sequential (`package.json`, lockfile).

### 4.3 React 19

- Goal: React 19 before 1.0.
- Files: `react`, `react-dom`, `@types/react`, `@types/react-dom` 19; `forwardRef` removed in `PopoverWithButton.tsx`, `Input.tsx`, `TextArea.tsx`, `drawer/index.tsx`, `Stack.tsx`; compatible versions of `react-error-boundary`, Testing Library and `@xyflow/react`; the `rearchitecture-plan.md` dependency row.
- Resolves: Prac 16, Prac §3 and §4 (React 19).
- Revisions: (1) dependencies; (2) `forwardRef`; (3) docs.
- Verify: `just check`; `npm ls react` shows one 19.x; `just smoke-visual` all panels in three themes.
- Depends: 4.2. Sequential.

### 4.4 Smaller code highlighter

- Goal: a lighter read-only highlighter.
- Files: `uiCore/components/codeblock/index.tsx` moves from `react-syntax-highlighter` to `prism-react-renderer` (SQL, YAML, JSON); `@types/react-syntax-highlighter` removed.
- Resolves: Prac §3 (`react-syntax-highlighter`).
- Revisions: one.
- Verify: `just check`; `just package`, with the size budget lowered by the measured saving; `just smoke-visual` lineage drawer test SQL.
- Depends: 4.3. Parallel-safe with 4.5 except for the lockfile; land in sequence.

### 4.5 happy-dom trial

- Goal: decide on the DOM test environment.
- Files: `webview_panels/vitest.config.ts` environment. Switch to `happy-dom` only if the webview suite passes unchanged and runs at least 20% faster; otherwise record the timings and keep `jsdom`.
- Resolves: Prac §3 (`jsdom` → `happy-dom`).
- Revisions: one.
- Verify: `just webviews::test` timings recorded in the step result.
- Depends: 4.4. Sequential (lockfile).

### 4.6 Grid parity inventory

- Goal: record what the TanStack grid must match before Perspective is removed (D7, confirmed by the owner).
- Files: `docs/research/query-results-grid-october-2026.md`: VSIX and per-entry bytes, CSP allowances, and an inventory of the grid features in use, each marked kept or dropped with its replacement in the candidate: header sorting, column resize, type-aware cell formatting (`queryPanel/components/perspective/columnTypeMapping.ts` and its tests), copy and cell or range selection, and the JSON cell viewer. The note cites the consumer cases (`finance-pipelines-integration.md`, "Consumer cases" and "Broader parity"): only "query and CTE preview" uses the grid, and none uses charts or pivots. The candidate is `@tanstack/react-table` + `@tanstack/react-virtual` with the cell viewer and `columnTypeMapping.ts` ported.
- Resolves: Prac §3 and §4 (Perspective); the Perspective size decision.
- Verify: `just lint-markdown`; every feature in use has a kept or dropped row.
- Depends: 4.5. Docs only.

### 4.7 Replace Perspective with TanStack Table

- Goal: carry out D7. This is hard to reverse: a beta prerelease comes first, and it is not batched with anything else.
- Files: `webview_panels/src/modules/queryPanel/components/perspective/` → `components/grid/`; `@perspective-dev/*` removed; `src/webview/panelHtml.ts` query results `PanelCsp` drops `'wasm-unsafe-eval'`, `worker-src blob:` and the WASM `connect-src`; size budgets lowered; `scripts/spikes/perspective-migration/` deleted; the smoke reads rows from the grid DOM instead of the Perspective table API.
- Resolves: the Perspective size decision.
- Revisions: (1) grid; (2) CSP; (3) dependency and spike removal; (4) budgets.
- Verify: `just check`; `just package` (VSIX size recorded); `just smoke-visual` query results in three themes, with the 10,000-row memory run from R6 repeated.
- Depends: 4.6. Sequential.

### 4.8 Dependency refresh

- Goal: current dependencies at 1.0.
- Files: `just update`; `npm outdated` in both packages, with each available major reviewed and one decision recorded per major (take, defer with reason, or decline) in the `rearchitecture-plan.md` dependency table, including TypeScript 7 against the TypeScript range `typescript-eslint` supports (stay on 6.x until it does); `npm audit` with no high or critical; `@types/vscode` stays at the `engines.vscode` floor; the dependency table is final.
- Resolves: Prac 16 (dependency modernisation, closing it).
- Revisions: (1) in-range updates; (2) one per major taken; (3) docs.
- Verify: `just check`; `just package`; `just smoke`; every major listed by `npm outdated` has a row in the dependency table.
- Depends: 4.7. Sequential.

### Phase 4 checkpoint

The reviewer confirms that `npm audit` reports no high or critical, the strict flags hold in production, React 19 is the only React, and the TanStack grid has replaced Perspective with its size and memory measured. Release readiness: cut a beta prerelease; once R9 confirms the consumer works, R10 cuts 1.0.0.

## Stacking order

Tip to tail; `∥` marks steps that may run in parallel workspaces under D6.

1. 0.1 is merged. 0.2 (reviews, `lsp-coverage.md`, this plan) roots on `main`.
2. 0.3 → 0.4 → 0.5 → 0.6 → 0.7 → 0.8 → 0.9 → 0.10 → 0.11 → 0.12 → 0.13 → 0.14 → 0.15. 2.2 runs ∥ from 0.2 onward (scripts and docs only); 2.1 is drafted ∥ from 1.8.
3. 1.1 → 1.2 → (1.3 ∥ 1.4 ∥ 1.5) → 1.10 → 1.11 → 1.6 → 1.7 → 1.8 → 1.9.
4. 2.1 → 2.3 → 2.4 → (2.5 ∥ 2.6 revision 1) → 2.6 revision 2 (deletions) → 2.7 → 2.9 → 2.8 → 2.10 → 2.11 → 2.12. A beta prerelease, then R9 in finance-pipelines.
5. 3.1 → 3.6 → 3.9 → 3.2 → 3.3 → 3.4 → 3.5 → 3.7 → 3.8 → 3.10 → 3.11 → 3.12. This runs alongside R9; every Phase 3 step lowers a ceiling or raises a floor in `ceilings.json`, so none runs in parallel.
6. 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 → beta prerelease → 4.7 → 4.8 → R10.

Parallel-safe means the steps touch none of the same files and none of the shared files. Each parallel bookmark roots on the same parent tip and rebases after its sibling merges.

## Risks and checkpoints

- **E1 may show that `package:<root>` omits package nodes.** The placeholders keep edges visible but unnamed. Stop at 2.4 if more than 5% of edges in finance end at placeholders.
- **Cancelling `dbt.show` may not stop a Snowflake query (E2).** Users could then pay for queries they cancelled. 2.8 states this in the UI. Stop if E2 shows that one `show` blocks lineage for longer than 2 s.
- **Behaviour while a document is dirty gets worse:** CTE lenses disappear, and the compiled preview goes stale. D2 and D5 accept this; the release notes say so. Reopen if R9 users object.
- **Columns need strict mode for types.** Under `baseline`, every model column fetch is a warehouse query; E8 measures it. Stop if the p50 is above 3 s on finance.
- **Parsing on demand can leave a visible parse-field consumer stale** between a save and the next compile-complete. Server-owned fields are not affected. 2.11's integration test covers the docs editor; the reviewer checks the Model Tests tree by hand.
- **The merge is the new single point of failure.** A wrong ownership entry or drop rule silently empties or duplicates nodes in every consumer. 2.4's property and golden tests guard it; stop at 2.4 if the golden comparison of parents, children and depth differs from the parse on any fixture node other than nodes added since the parse.
- **Two publications per compile** while a parse-field consumer is visible (server, then parse). Each is coherent, but a panel may re-render twice. Stop if 2.11's measurement shows a visible flicker in the lineage panel; the fallback is a short coalescing window in the composite.
- **Migration drift:** a Fusion upgrade adds a field and nobody moves it, so the parse keeps running for it. The upgrade procedure (2.12) and the `fieldOwners` parity test make the gap list the reviewed record; the reviewer of each Fusion pin bump checks the new capability document against it.
- **Ratchet friction:** a gate with false positives blocks pushes. A gate that cannot land passing within its step is a stop-and-confirm, not a reason to add a baseline.
- **Shared-file conflicts** between parallel workspaces. Only parallel-safe steps run concurrently, and both rebase after each merge.
- **Compiled paths may differ under `lsp.compiledOutput: shared` (E9).** If the server returns paths under `target/.lsp/` while it writes to `target/`, the preview and CTE lenses read stale or missing files. E9 decides before 2.7; the fallback removes `shared`.
- **Hard to reverse:** 4.7 (grid replacement), and to a lesser degree 2.9 (detector deletion; the old detector stays in history). Each is preceded by a prerelease and not batched.
- **Fusion releases after 2.0.6 can change the command shapes.** The `FusionCommands` adapter in `core/lsp/` and `serverMetadataFrom` in `core/metadata/` are the only places that know them, and the integration suite pins them against `mise.toml`'s binary.

## Declined

| Finding                                                                                                                                                               | Reason                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prac 13: `jinja-sql` `filenamePatterns` apply in non-dbt repositories                                                                                                 | VS Code has no conditional `filenamePatterns`. `jinja-sql` is a superset grammar of SQL, so the effect is cosmetic. Menus are scoped in 1.2                                                |
| Prac 17: l10n                                                                                                                                                         | Private fork with one locale; no consumer                                                                                                                                                  |
| Prac §3: replace `which` with a PATH scan                                                                                                                             | The review rates the gain small. `which` handles Windows `PATHEXT`. The types are checked in 1.6                                                                                           |
| Prac §4: one bundler for host and webview                                                                                                                             | Both bundlers are current and fast. Unifying them adds a migration with no user or gate benefit                                                                                            |
| Prac §5.2: configuration errors from both CLI parse and server notifications                                                                                          | Deliberate and deduplicated in `ProjectErrors`. The server reports nothing for an unknown target or an unset `env_var` in `profiles.yml` (Spike)                                           |
| Prac §5.2 and Spike: macro and source hover, `source('` completion, macro signature help return nothing                                                               | Fusion behaviour; nothing for the extension to do. Recorded in `docs/lsp-coverage.md`                                                                                                      |
| Prac §5.2: `dbt.compileLsp`, `dbt.clearTarget`                                                                                                                        | Returned `null` with no effect; they stay unused, as the architecture document already says                                                                                                |
| Prac §6: register code lenses at activation instead of after `onDidInitialize`                                                                                        | Works as is; `onDidInitialize` fires once, and 2.9 changes the CTE lenses anyway                                                                                                           |
| Prac §6: lower `engines.vscode` to about 1.100                                                                                                                        | Both pinned hosts meet 1.128; no consumer needs an older one                                                                                                                               |
| Qual O1: lower fast-check `NUM_RUNS` on PRs                                                                                                                           | Saves about 4 s, which is within the gate budget; there is no nightly job to raise the runs                                                                                                |
| Qual §3: smoke and integration overlap on the handshake                                                                                                               | Justified: smoke is the only check of the packaged VSIX (`AGENTS.md`)                                                                                                                      |
| Qual §4: `DiagnosticsOutputChannel` as a second output wrapper                                                                                                        | The review keeps it as the report writer                                                                                                                                                   |
| Spike: finance models built by `kikoff.union_relations`/`temporalize.reconcile` return no column lineage                                                              | Fusion behaviour; recorded in `docs/lsp-coverage.md`. The panel already explains an empty result                                                                                           |
| Spike: formatting and `source.fixAll` fail with `exit code 1` on a finance model                                                                                      | Fusion behaviour; recorded. Formatting stays the server's                                                                                                                                  |
| Spike: `source()` inside `{% set %}` has no definition                                                                                                                | Fusion behaviour; recorded                                                                                                                                                                 |
| Spike: `dbt/renameModel` and `dbt/renameColumn` notifications                                                                                                         | Their parameters are `{}`, so there is nothing to consume                                                                                                                                  |
| #210 R8: export lineage; code-view and op-node modals; Lightdash and Snowflake stage sections; expansion-level steppers and per-node "expand N levels"; node dragging | Parity gaps the R8 review accepted as deferred. No consumer case uses them, and Lightdash is a hosted integration (ADR 0001). The toolbar's default expansion and Reset cover the steppers |

## Traceability

| Finding                                                                                                                                                                                               | Step               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Prac 1: stale `lsp-metadata-gaps.md`                                                                                                                                                                  | 0.2, 2.1           |
| Prac 2: compiled preview CLI per keystroke, toast                                                                                                                                                     | 2.7                |
| Prac 3: `query.template` unread                                                                                                                                                                       | 1.2                |
| Prac 4: `capabilities.hoverProvider`                                                                                                                                                                  | 1.2                |
| Prac 5: `virtualWorkspaces`                                                                                                                                                                           | 1.2                |
| Prac 6: four cycles                                                                                                                                                                                   | 0.5                |
| Prac 7: CLI where `dbt.show`/`getCurrentNode` apply; evidence experiment                                                                                                                              | 2.2, 2.8–2.10      |
| Prac 8: table lineage and trees on the manifest; double parse; ADR                                                                                                                                    | 2.1, 2.4–2.6, 2.11 |
| Prac 9: regex CTE lenses; `architecture.md:24`                                                                                                                                                        | 0.2, 2.9           |
| Prac 10: Altimate links and names in the webview                                                                                                                                                      | 1.4                |
| Prac 11: dead code (`modules.ts`, DataPilot, `compileNode`, `hashProjectRoot`, `resolve*`, spike)                                                                                                     | 0.3                |
| Prac 11: constants exported for tests                                                                                                                                                                 | 2.3                |
| Prac 11: `sendTelemetry` parameters                                                                                                                                                                   | 1.1                |
| Prac 11: stale comments                                                                                                                                                                               | 1.5                |
| Prac 11: `lint-unused` each phase                                                                                                                                                                     | 0.4                |
| Prac 12: `Cmd+'` without `when`                                                                                                                                                                       | 1.2                |
| Prac 13: menus on any SQL                                                                                                                                                                             | 1.2                |
| Prac 13: `filenamePatterns`                                                                                                                                                                           | Declined           |
| Prac 14: line-0 lenses                                                                                                                                                                                | 1.3                |
| Prac 15: `vscode-languageserver-protocol`                                                                                                                                                             | 1.6                |
| Prac 16: modernisation                                                                                                                                                                                | 4.1–4.8            |
| Prac 17: l10n                                                                                                                                                                                         | Declined           |
| Prac 18: double space in `when`                                                                                                                                                                       | 1.2                |
| Prac §2: Bootstrap and dbt Cloud comments                                                                                                                                                             | 1.5                |
| Prac §2: `fusionIntegrationWiring` absence asserts                                                                                                                                                    | 0.15               |
| Prac §2: `dbt_loom`                                                                                                                                                                                   | 1.5                |
| Prac §3: `@vscode/test-cli` false positive; `ts-loader` ignore                                                                                                                                        | 0.4                |
| Prac §3: `glob`, `ts-mockito`, `@types/which`, `vite-plugin-svgr`, `use-debounce`, 8 GB flag                                                                                                          | 1.6                |
| Prac §3: `which` replacement                                                                                                                                                                          | Declined           |
| Prac §3: istanbul                                                                                                                                                                                     | 0.3                |
| Prac §3: `eslint-plugin-prettier`, typescript-eslint meta package, `you-dont-need-lodash-underscore`                                                                                                  | 0.8                |
| Prac §3: React 19                                                                                                                                                                                     | 4.3                |
| Prac §3: react-select                                                                                                                                                                                 | 4.2                |
| Prac §3: `react-syntax-highlighter`                                                                                                                                                                   | 4.4                |
| Prac §3: `jsdom`/`happy-dom`                                                                                                                                                                          | 4.5                |
| Prac §3: Perspective                                                                                                                                                                                  | 4.6, 4.7           |
| Prac §4: TS target                                                                                                                                                                                    | 0.9                |
| Prac §4: two bundlers                                                                                                                                                                                 | Declined           |
| Prac §4: process per preview                                                                                                                                                                          | Phase 2            |
| Prac §5.1: CLI inventory documented                                                                                                                                                                   | 2.12               |
| Prac §5.2: adapter type and project name via `getProjectInfo`; depth                                                                                                                                  | 2.4                |
| Prac §5.2: parse on compile-complete                                                                                                                                                                  | 2.11               |
| Prac §5.2: duplicate configuration errors; hover gaps; `compileLsp`/`clearTarget`                                                                                                                     | Declined           |
| Prac §5.3: double parse                                                                                                                                                                               | 2.11               |
| Prac §5.3: two lineage sources                                                                                                                                                                        | 2.5                |
| Prac §5.3: two compiles                                                                                                                                                                               | 2.7                |
| Prac §5.3: two column sources                                                                                                                                                                         | 2.10               |
| Prac §5.3: two CTE detectors                                                                                                                                                                          | 2.9                |
| Prac §6: progress location                                                                                                                                                                            | 2.7                |
| Prac §6: `unsafe-inline` styles                                                                                                                                                                       | 4.2                |
| Prac §6: lens registration; engines floor                                                                                                                                                             | Declined           |
| Qual M1: unused metadata port, three read paths                                                                                                                                                       | 1.8, 2.4, 0.14     |
| Qual M2: `for…in`, array spread, base-to-string                                                                                                                                                       | 0.7                |
| Qual M3: `console.*`                                                                                                                                                                                  | 0.7                |
| Qual M4: knip entries, harness, `@vscode/test-cli`                                                                                                                                                    | 0.3, 0.4           |
| Qual M4: `ts-mockito`, `glob`                                                                                                                                                                         | 1.6                |
| Qual §1A, §1B, §1C                                                                                                                                                                                    | 0.3                |
| Qual §1D: test seams                                                                                                                                                                                  | 0.3, 2.3           |
| Qual §1E: `setup.ts` false positive                                                                                                                                                                   | 0.4                |
| Qual §2: knip gate                                                                                                                                                                                    | 0.4                |
| Qual §3: `extension.test.ts`, harness                                                                                                                                                                 | 0.3                |
| Qual §3: absence guards                                                                                                                                                                               | 0.15               |
| Qual §3: consolidation clusters                                                                                                                                                                       | 3.10               |
| Qual §3: CTE lens cluster                                                                                                                                                                             | 2.9                |
| Qual §3: `resolveSettingsVariables` test                                                                                                                                                              | 0.3                |
| Qual §3: mock-heavy tests                                                                                                                                                                             | 3.11               |
| Qual §3: worst coverage                                                                                                                                                                               | 3.1                |
| Qual §3: smoke/integration overlap                                                                                                                                                                    | Declined           |
| Qual §3: shared `lspFixture`                                                                                                                                                                          | 3.10               |
| Qual §4: cycles; stale `dbt_client`                                                                                                                                                                   | 0.5                |
| Qual §4: layer rules; cruise the contract                                                                                                                                                             | 0.6                |
| Qual §4: god modules: `docsEditPanel`                                                                                                                                                                 | 3.4                |
| Qual §4: god modules: `fusionLanguageClient`                                                                                                                                                          | 2.3                |
| Qual §4: god modules: `lineagePanel`, `queryResultPanel`, `project.ts`                                                                                                                                | 3.8                |
| Qual §4: god modules: `cteCodeLensProvider`                                                                                                                                                           | 2.9                |
| Qual §4: god modules: `commands.ts`                                                                                                                                                                   | 3.5                |
| Qual §4: god modules: `relationshipParser`                                                                                                                                                            | 3.7                |
| Qual §4: fan-in: `dbt_integration` barrel                                                                                                                                                             | 1.1                |
| Qual §4: fan-in: `utils.ts`                                                                                                                                                                           | 3.9                |
| Qual §4: clones: `queryManifestService`, `modelTreeviewProvider`                                                                                                                                      | 1.8                |
| Qual §4: clones: CTE lens                                                                                                                                                                             | 2.9                |
| Qual §4: clones: `projectSetupCommands`                                                                                                                                                               | 3.11               |
| Qual §4: clones: `graphParser`, `dbtTestService`                                                                                                                                                      | 3.7                |
| Qual §4: clones: contract guards                                                                                                                                                                      | 3.3                |
| Qual §4: manifest-read row                                                                                                                                                                            | 1.8                |
| Qual §4: logging row                                                                                                                                                                                  | 0.7, 1.1           |
| Qual §4: `DiagnosticsOutputChannel`                                                                                                                                                                   | Declined           |
| Qual §4: settings row                                                                                                                                                                                 | 0.3                |
| Qual §4: running-dbt row (un-export, document split)                                                                                                                                                  | 0.3, 2.12          |
| Qual §4: error-reporting row                                                                                                                                                                          | 3.2                |
| Qual §4: webview messaging row                                                                                                                                                                        | 3.3                |
| Qual §5: cheap suppressions                                                                                                                                                                           | 1.7                |
| Qual §5: refactor suppressions                                                                                                                                                                        | 3.4–3.8            |
| Qual §5: ratchet, prune                                                                                                                                                                               | 0.8                |
| Qual §5: targets                                                                                                                                                                                      | 3.12               |
| Qual §6: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`                                                                                                                                     | 0.10, 4.1          |
| Qual §6: `noImplicitOverride`, `noUnused*`                                                                                                                                                            | 0.9                |
| Qual §6: typescript-eslint bug rules                                                                                                                                                                  | 0.7                |
| Qual §6: `no-unsafe-*` by directory                                                                                                                                                                   | 3.7, 3.12          |
| Qual §6: type coverage                                                                                                                                                                                | 0.11               |
| Qual §6: knip                                                                                                                                                                                         | 0.4                |
| Qual §6: bundle size                                                                                                                                                                                  | 0.13               |
| Qual §6: complexity thresholds, `max-lines` 400                                                                                                                                                       | 0.8                |
| Qual §6: coverage threshold                                                                                                                                                                           | 0.12               |
| Qual §6: dependency-cruiser                                                                                                                                                                           | 0.6                |
| Qual §6: `showErrorMessage` ban                                                                                                                                                                       | 3.2                |
| Qual §6: documentation drift                                                                                                                                                                          | 0.14               |
| Qual S1                                                                                                                                                                                               | 0.3                |
| Qual S2                                                                                                                                                                                               | 0.5                |
| Qual S3                                                                                                                                                                                               | 3.3                |
| Qual S4                                                                                                                                                                                               | 3.2                |
| Qual S5                                                                                                                                                                                               | 0.3, 0.15, 3.10    |
| Qual S6                                                                                                                                                                                               | 0.7, 3.1           |
| Qual S7                                                                                                                                                                                               | 2.3                |
| Qual O1                                                                                                                                                                                               | Declined           |
| Qual O2                                                                                                                                                                                               | 0.3                |
| Qual O3                                                                                                                                                                                               | 1.6                |
| Spike: gaps document stale                                                                                                                                                                            | 0.2                |
| Spike: Must stay                                                                                                                                                                                      | 0.2, 2.1, 2.4      |
| Owner: one consumer seam, server first (D8)                                                                                                                                                           | 1.8, 2.1, 2.4–2.6  |
| Owner: re-run the spike on each Fusion upgrade, move covered fields to the server; delete the parse producer when none remain (D8)                                                                    | 2.4, 2.12          |
| Spike: table lineage, counts                                                                                                                                                                          | 2.4, 2.5           |
| Spike: model tree                                                                                                                                                                                     | 2.6                |
| Spike: compiled SQL                                                                                                                                                                                   | 2.7                |
| Spike: query preview                                                                                                                                                                                  | 2.8                |
| Spike: CTE preview and profiling                                                                                                                                                                      | 2.9                |
| Spike: column types                                                                                                                                                                                   | 2.10               |
| Spike: manifest freshness                                                                                                                                                                             | 2.11               |
| Spike: file rename; not established (cancellation, multiple projects, disk watch)                                                                                                                     | 2.2                |
| Review: compiled paths under `lsp.compiledOutput: shared`                                                                                                                                             | 2.2 (E9), 2.7, 2.9 |
| Spike: union_relations lineage, formatting `exit code 1`, `source()` in `{% set %}`, rename notifications, hover and completion gaps                                                                  | Declined           |
| #210 seed: `userFiles` replace, `readUserFile`, fs-write rule, `panelHtml` cache, chunk names, `_queryTabData`, `eslint-disable`, probe name                                                          | 1.9                |
| #210 seed: `getConnectedColumns` dropped parameters                                                                                                                                                   | 1.11               |
| #210 seed: `optional()`/`nullish()` audit                                                                                                                                                             | 0.10               |
| #210 R7: tooltip, positioning, popover, nav roles, undefined classes, colours, `--text-active`, drawer, `--action-red`, copy failure                                                                  | 1.10               |
| #210 R7: Enter submit                                                                                                                                                                                 | 4.2                |
| #210 R8 optional: diamond edges, rebuild write, unused contract fields, `allowSelfReference`, colour fallback, `expansionKey`, case handles, in-flight collapse, plan and state wording, restore test | 1.10, 1.11         |
| #210 R8: AI chat and feedback, static SQL lineage mode (verify deleted)                                                                                                                               | 1.11               |
| #210 R8: export, modals, Lightdash and Snowflake sections, steppers, dragging                                                                                                                         | Declined           |
