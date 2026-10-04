# Fusion Power User — code-quality review (read-only)

Repo: `/Users/daniel/projects/vscode-dbt-power-user/main` (current `main`), 2026-10-03. Context: this repository's tooling (knip, depcruise, ESLint, tests), plus production source under `src/` and `webview_panels/src/`.

**Verdict: land-with-fixes.** The architecture is sound. Settings, process spawning, and file writes each go through a single module enforced by lint. The run path is unified. Duplication is 1.56%. The unit suite runs 1303 tests in about 11 s. The real debt sits in three places:

1. A metadata port that nothing reads.
2. Tooling configs (knip, depcruise, the legacy mocha harness) that hide dead code.
3. Uneven tests: high mock-call density, an unbalanced CTE lens test, and near-zero coverage on the relationship parser and doc-gen paths.

Raw outputs: `/tmp/knip-default.txt`, `/tmp/knip-prodflag.txt`, `/tmp/knip-prod-noTests.txt`, `/tmp/knip-prod2.txt`, `/tmp/knip-prod2.json`, `/tmp/syms-class.tsv`, `/tmp/dc-err.txt`, `/tmp/dc-metrics.txt`, `/tmp/jscpd/jscpd-report.json`, `/tmp/jscpd-summary.txt`, `/tmp/fpu-vitest.json`, `/tmp/fpu-cov/coverage-summary.json`, `/tmp/eslint-strict.json`, `/tmp/eslint-strict-summary.txt`. Temp configs: `/tmp/knip.prod.json`, `/tmp/knip.prod2.json`, `/tmp/eslint.strict.cjs`.

---

## Must-fix

### M1. `ProjectMetadataSource` is a port nothing reads; the docs name a seam that no longer exists

- `src/metadata/projectMetadataSource.ts:6` declares `current()` and `refresh()`. Repo-wide, production code touches `metadataSource` only through `.dispose` and `.project`, in `src/projects/projects.ts:108,136,164`. No production code calls `current()` or `refresh()`; only `manifestMetadataSource.test.ts` and `metadataContract.test.ts` exercise them.
- Consumers read `project.manifest` directly:
  - `src/features/modelTree/modelTreeviewProvider.ts:131,281`
  - `src/features/lineage/lineagePanel.ts:243,281`
  - `src/features/docs/docsEditPanel.ts:178,195`
  - `src/features/queryResults/queryResultPanel.ts:127`
  - `src/fusion/schemaOrigin.ts:34`

  Some of these go through `QueryManifestService.getProject()?.manifest`, some through `projects.get(uri)?.manifest`.
- `ManifestCacheProjectAddedEvent` has **zero** occurrences in `src/`, yet it is the canonical seam in `AGENTS.md:78`, `CONTEXT.md:23` ("Project Metadata Source: the producer behind `ManifestCacheProjectAddedEvent`"), `docs/architecture.md:70`, `docs/lsp-metadata-gaps.md`, and `docs/refactor/rearchitecture-plan.md`. The change event that actually exists is `Projects.onDidChangeManifest` (`src/projects/projects.ts:20-23`).
- `AGENTS.md:79` says `FusionProjectIntegration` implements `ManifestProject`. No such class exists in `src/`; `Project` passes itself to the parsers.
- Rule violated: AGENTS.md says "Do not introduce a second consumer seam", and CONTEXT.md fixes the vocabulary. In practice there are three read paths (`Project.manifest`, `QueryManifestService`, and an unused `ProjectMetadataSource`) and one event (`onDidChangeManifest`).
- Fix: pick one.
  - (a) Make `ProjectMetadataSource.current()` plus `Projects.onDidChangeManifest` the only read path, route `QueryManifestService.manifestAt` through it, and stop features reading `.manifest`.
  - (b) Delete the port: `src/metadata/` (2 files) and its two test files (~450 lines). Then rewrite the CONTEXT and AGENTS entries to name `Projects.onDidChangeManifest` and `QueryManifestService`.

  Option (b) is the honest one until a second producer exists; `docs/lsp-metadata-gaps.md` says the LSP cannot be that producer.

### M2. A real bug class the current lint does not catch: `for…in` over arrays and object-spread of arrays

These come from the `strict-type-checked` probe in M5/§6 and are type-confirmed:

- `src/projects/manifest.ts:217`: `{ ...nodes, ...exposures, ...(functionRecords ?? {}) }`. `nodes` and `exposures` are typed `any[]` (`ManifestJson` at `manifest.ts:99-111`, which forwards `NodeParser.createNodeMetaMap(nodesMap: any[])` at `nodeParser.ts:101`). Either the runtime value is an object keyed by `unique_id`, which makes the parser signatures lie, or the spread produces index keys. Correct the types to `Record<string, NodeData>`.
- `for (const key in …)` over values typed as arrays:
  - `src/core/manifest/macroParser.ts:31`
  - `src/core/manifest/metricParser.ts:23`
  - `src/features/codegen/sourceModelCreationCodeLensProvider.ts:50,58,64,89,92,124`

  The codegen lens iterates YAML CST `items`, which are arrays, so `for…in` yields string indices. It also holds 16 `max-depth` suppressions.
- `no-base-to-string` at `src/features/commands.ts:421`, `src/features/run/runModel.ts:99`, and `src/projects/outputChannels.ts:216` can print `[object Object]`.
- Fix: correct the `any[]` input types and switch these loops to `Object.entries` or `for…of`. Then enable `@typescript-eslint/no-for-in-array`, `no-misused-spread`, and `no-base-to-string` as errors; there are 14 hits in total.

### M3. Stray `console.*` in production, with no `no-console` rule

- `src/projects/queryManifestService.ts:104`: `console.log(event.sourceMetaMap.size, sources)` runs on every source lookup.
- `src/features/lineage/lineagePanel.ts:400`: `console.log("addColumnsFromDB: ", …)`
- `src/features/modelTree/modelTreeviewProvider.ts:176`
- `src/utils.ts:142,329`
- `src/core/manifest/graphParser.ts:216` (commented out) and `:269`
- `src/core/manifest/utils.ts:28`
- Canonical logger: `DBTTerminal`, implemented by `ChannelLog`/`OutputChannels` (`src/projects/outputChannels.ts:163,238`). `core/` uses the `ManifestLogger` port (`src/core/manifest/logger.ts:2`).
- Fix: route these through the terminal, or delete them. Add `"no-console": "error"` for `src/**` minus `src/test/**`.

### M4. Tooling hides dead code: knip entries, the legacy mocha harness, and unused devDependencies

- `knip.json` makes `src/test/**/*.ts` and `webview_panels/src/**/*.test.{ts,tsx}` **entries**, so production exports reachable only from tests count as used.
- The legacy mocha/istanbul harness is unreferenced. `src/test/suite/index.ts`, `src/test/suite/runTest.ts`, and `src/test/suite/coverage.ts` (~96 lines) are not referenced by `.vscode-test.mjs`, `scripts/`, the `justfile`, or CI, and `tsconfig.integration.json:18` explicitly **excludes** `src/test/suite/**`. knip misses them only because `src/test/**` is an entry.
- Removing that harness frees `istanbul-lib-coverage`, `istanbul-lib-instrument`, `@types/istanbul-lib-coverage`, and `src/types/istanbul-lib-instrument.d.ts`. knip with the corrected config already flags all three packages.
- `@vscode/test-cli` is reported unused by knip but **is** used: `.vscode-test.mjs:1` imports it, and `scripts/test/run-integration.mjs:91` runs `node_modules/.bin/vscode-test`. knip does not treat `.vscode-test.mjs` as an entry. Add the file as an entry; do not remove the package.
- `ts-mockito` is used by one file, `src/test/suite/commandProcessExecution.test.ts:4`. Port that file to `vi.fn` and drop the dependency.
- `glob` is used only by the dead `suite/index.ts`, plus `mediaAssets.test.ts`, `smoke/runTests.ts`, and `integration/untrusted/index.ts`. Node 24's `fs.globSync` can replace it.

---

## 1. Dead code

### Method

I ran knip three ways:

1. **Default config.** 1 unused devDependency, 27 unused exports, 32 unused exported types, 4 unused enum members, 7 configuration hints. This matches your numbers.
2. **`/tmp/knip.prod.json`.** Test entries removed and test files dropped from `project`. Result: 4 unused devDependencies, 27 exports, 33 types, 4 enum members. The counts barely move because the test files leave the project entirely, so their imports never count.
3. **`/tmp/knip.prod2.json --production`.** Production entries marked with `!`, and tests kept as non-production entries. This is the correct way to separate the two: 1 unused file, **98** unused exports, **43** types, 4 enum members, and 0 false-positive dependencies.

I then classified each symbol by its references in its own file and in tests; the table is in `/tmp/syms-class.tsv`.

### Why `knip --production` reports 15 used dependencies as unused

In production mode knip uses only entries suffixed with `!`. `knip.json` marks none, so every workspace's production entry set is empty and every `dependencies` entry looks unused: `vscode-languageclient`, `yaml`, `which`, `@xyflow/react`, Perspective, and the rest. The dependencies are fine; the config is missing `!` suffixes. `/tmp/knip.prod2.json --production` reports **zero** dependency issues, which confirms it.

### A. Truly dead: no production reference and no test reference (delete)

| Symbol                                                                                               | Location                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `RESOURCE_TYPE_MACRO`                                                                                | `src/core/manifest/types.ts:329`                                                                            |
| `hashProjectRoot`, `CompilationResult`                                                               | `src/dbt_integration/dbtIntegration.ts:5,63`                                                                |
| `DataPilotHealtCheckParams`, `HealthcheckArgs`, `ConfigOption`                                       | `src/dbt_integration/domain.ts:120,175`                                                                     |
| `NodeMetaType`, `SourceMetaType`, `ProjectInfo`, `ModelGraphMetaMap`                                 | `src/dbt_integration/domain.ts:20,21,23,147`                                                                |
| enum member `RunModelType.SNAPSHOT`                                                                  | `src/dbt_integration/domain.ts:156`                                                                         |
| `ExecuteSQLResult` (re-export)                                                                       | `src/modules.ts:1`                                                                                          |
| `RunStatus` re-export                                                                                | `src/projects/runHistoryService.ts:12` (the source is `domain.ts:63`)                                       |
| `ProjectParsers`                                                                                     | `src/compositionRoot.ts:83`                                                                                 |
| `ButtonProps`                                                                                        | `webview_panels/src/uiCore/index.ts:19`                                                                     |
| `QueryPanelViewType.OPEN_RESULTS_IN_TAB`, `.OPEN_RESULTS_FROM_HISTORY_BOOKMARKS`                     | `webview_panels/src/modules/queryPanel/context/types.ts:10-11`                                              |
| enum member `Source.DATABASE`                                                                        | `src/features/docs/docGenTypes.ts:3`                                                                        |
| `MacroMetaData`, `SourceMetaData`, `FunctionArgument`, `FunctionReturns`, `RefSource`, `RefEndpoint` | `src/core/manifest/types.ts:22,133,222,229,294,303`. These are used inside the file, so drop `export` only. |
| `TestMetadataKwArgs`, `TableNodeData`, `DocumentationEditorViewState`, `QueryResultsViewState`       | webview types used in-file; drop `export`                                                                   |

`DataPilotHealtCheckParams`, `HealthcheckArgs`, and `ConfigOption` are Altimate DataPilot leftovers that the product boundary forbids.

### B. `src/modules.ts`: a dead barrel

`src/modules.ts` re-exports `DBTTerminal`, `ExecuteSQLResult`, `CommandProcessExecutionFactory`, `Project`, `QueryManifestService`, and `getFirstWorkspacePath`.

- Nothing imports `@extension`; `rg` finds zero `from "@extension"` in `src`, `webview_panels/src`, and `scripts`.
- The alias still exists in `tsconfig.json:21`, `rsbuild.config.ts:44`, and `vitest.config.ts`.
- Fix: delete `src/modules.ts` and remove all three aliases.

### C. Production code that only tests use: dead production code hidden by tests

These are exported, unused by production, and referenced only from tests. Each should be deleted together with its tests, unless a test genuinely needs the seam.

`src/utils.ts`:

| Symbol                      | Line | Test                                                                                                                          |
| --------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| `isEnclosedWithinCodeBlock` | :20  | utils.test.ts                                                                                                                 |
| `arrayEquals`               | :77  |                                                                                                                               |
| `debounce`                  | :81  |                                                                                                                               |
| `setupWatcherHandler`       | :89  |                                                                                                                               |
| `resolveSettingsVariables`  | :376 | 117-line `resolveSettingsVariables.test.ts`, which duplicates `substituteVariables` coverage in `projectSnapshot.test.ts:206` |

That is about 60 lines of production code and about 160 lines of tests.

Other production code used only by tests:

- `src/benchmark/runtimeTimings.ts:48`: `clearWebviewRuntimeTimings`
- `src/core/manifest/nodeParser.ts:36`: `NodeMetaMapImpl`. It is used in-file but exported only for tests; keep it and drop `export`.
- `src/features/modelTree/modelTreeviewProvider.ts:517`: `lookupModelByEditorContent`. Check whether it is reachable; knip says it is exported but unused outside the file.
- `src/features/lineage/lineagePanel.ts:68,108,120`: `storedLineageSettings`, `noLineageErrors`, `partialFailureErrors`. These are used in-file and exported for tests, so they are seams.

### D. Test-only seams: exported for unit tests and used in their own file (acceptable; mark them)

There are 118 symbols here. Most of them are under:

- `src/fusion/fusionLanguageClient.ts`, which exports 18 symbols for its 1632-line test: constants such as `CONNECTION_TIMEOUT_MS`, `BACKOFF_*`, and `PARTIAL_LINE_LIMIT`, plus `ProcessStreamBuffer`, `SpawnedLspProcess`, `documentSelectorForProject`, and others.
- `src/core/project/projectSnapshot.ts`, with 8 symbols.
- `src/projects/*`: `runResults.ts`, `projectErrors.ts`, `projectCommands.ts`, `projectSql.ts`, `outputChannels.ts`, `manifest.ts`.
- `src/webview/panelHtml.ts`
- `webview_panels/src/modules/lineage/graph.ts`, with 6 symbols.
- `src/settings/*`

Recommendations:

- Tag these exports `/** @internal */` and set knip `"tags": ["-internal"]` so that knip reports *new* test-only exports while still allowing these.
- For `fusionLanguageClient.ts` (922 lines and 18 test seams), move `ProcessStreamBuffer`, `SpawnedLspProcess`, the selector helpers, and the backoff policy into their own modules, such as `fusion/lspProcess.ts` and `fusion/documentSelector.ts`. They then become public module APIs instead of seams in a god file.

### E. Unused file

`webview_panels/src/test/setup.ts` is a false positive. `webview_panels/vitest.config.ts:10` uses it as `setupFiles`, so add it to knip's entries.

---

## 2. Should knip gate `just check`? Yes, with this config

knip has two blockers today: the missing `!` suffixes make production mode meaningless, and test entries hide dead code. With the config below it is clean of false positives, and the remaining findings are real. The objection "refactors pass through states with dead code" applies to work-in-progress revisions, not to PR tips; `just check` gates the PR tip and the pre-push hook.

Proposed `knip.json`:

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "tags": ["-internal"],
  "workspaces": {
    ".": {
      "entry": [
        "src/extension.ts!",
        "src/test/**/*.test.ts",
        "src/test/{integration,smoke}/**/*.ts",
        "scripts/**/*.{mjs,ts}",
        ".vscode-test.mjs"
      ],
      "project": ["src/**/*.ts!", "scripts/**/*.{mjs,ts}", "!src/test/**!"],
      "ignore": ["src/test/fixtures/**", "scripts/spikes/**"],
      "ignoreBinaries": ["dbt"]
    },
    "packages/webview-contract": {
      "entry": ["src/index.ts!", "src/**/*.test.ts"],
      "project": ["src/**/*.ts!", "!src/**/*.test.ts!"]
    },
    "webview_panels": {
      "entry": ["src/entries/*.tsx!", "src/**/*.test.{ts,tsx}", "src/test/setup.ts"],
      "project": ["src/**/*.{ts,tsx}!", "!src/**/*.test.{ts,tsx}!"],
      "ignoreDependencies": ["@vscode/codicons"]
    }
  }
}
```

Notes on the config:

- It drops the knip hints for `rsbuild.config.ts` and `vitest.config.ts` (the plugins detect them), the `@types/vscode` and `ts-loader` ignores (knip flags both as unneeded), and the `src/test/mock/**` ignore. Without that ignore, an unused mock export gets reported.
- It removes `src/test/suite/{index,runTest,coverage}.ts` from the entries, so their removal is enforced (M4).

Gate on two runs:

```just
lint-unused:
    npx knip --no-progress
    npx knip --production --no-progress --include files,exports,types,enumMembers,dependencies
```

Add `just lint-unused` to `lint`. To land it, fix §1A and §1B first, which is about 30 deletions. Then tag §1D as `@internal`. Then turn on the gate.

---

## 3. Tests

### Size and speed

- `src/test` holds 34,761 lines across `suite`, `integration`, `smoke`, `mock`, `arbitraries`, and `fixtures`. `suite` alone is 24,963 lines; `integration` is 6,069 and `smoke` is 2,556. Production `src/` excluding tests is 22,413 lines. `webview_panels` adds 19 test files and 1,928 lines.
- The unit run is fast. The JSON reporter shows 1303 tests in 112 files with about 11.4 s of total test time. The slowest files:

| Time   | File                                           | Kind                                     |
| ------ | ---------------------------------------------- | ---------------------------------------- |
| 2.65 s | `packages/webview-contract/src/guards.test.ts` | fast-check                               |
| 1.99 s | `cliArgs.property.test.ts`                     | fast-check                               |
| 1.06 s | `commandConsistencyGuard.test.ts`              | reads `package.json` and the source tree |
| 1.02 s | `panelMessageGuards.test.ts`                   | fast-check                               |

The cost is property-test `NUM_RUNS`. Lower it on PRs and raise it nightly with an env var such as `FC_NUM_RUNS`; that saves about 4 s. This is optional.

- Coverage is configured (`vitest.config.ts`, v8). Statements are at 69.8%, branches 61.6%, functions 75.2%. The worst-covered production files:

| Coverage | Lines | File                                                                                              |
| -------- | ----- | ------------------------------------------------------------------------------------------------- |
| 2.7%     | 222   | `src/core/manifest/relationshipParser.ts`                                                         |
| 3.4%     |       | `src/features/docs/docGenService.ts`                                                              |
| 7.3%     |       | `src/features/codegen/sourceModelCreationCodeLensProvider.ts`, the file with the M2 `for…in` bugs |
| 7.6%     |       | `src/features/docs/dbtTestService.ts`                                                             |
| 10.9%    |       | `src/features/cte/cteProfilerService.ts`                                                          |
| 14.4%    |       | `src/features/queryResults/queryResultPanel.ts`                                                   |
| 25.2%    | 282   | `src/features/commands.ts`                                                                        |

Tests are 1.5× production, but the effort is concentrated on LSP/CLI wiring while the parsers and codegen paths go untested.

### Tests of nothing or of deleted behavior (delete)

- **`src/test/suite/extension.test.ts`** (118 lines) tests only its own mock. It asserts `[1,2,3].indexOf(5) === -1` (`:26`) and mocks `innoverio.vscode-dbt-power-user` (the upstream ID, `:35`) with `dbt.run` and `dbt.compile` commands that no longer exist, then asserts on that mock (`:90-117`). It has zero product value. **Delete it (-118 lines).**
- **Absence guards for removed code** search the source tree for strings that cannot return without someone deliberately adding them:
  - `pythonRemovalGuard.test.ts` (108 lines)
  - the `forbiddenProductionSymbols`, "does not compose project detection", and "unsupported integrations" cases in `fusionIntegrationWiring.test.ts:85-128`
  - `localOnlyContract.test.ts` (30 lines)

  Together they are about 14 files and 2,100 lines that read `src`, `package.json`, or `repositoryRoot`. Replace the string-absence checks with **lint rules**: `no-restricted-imports` and `no-restricted-syntax` for `SecretStorage` and `createPythonBridge`, which the repo already uses for confinement, and dependency-cruiser `forbidden` rules for paths. Keep `commandConsistencyGuard`, `packageManifest`, `namespaceGuard`, `mediaAssets`, and `watcherScope`, which test live contracts. Estimated reduction is about 250 lines, and it moves the guarantee to the editor.
- **The harness in M4**: `suite/index.ts`, `runTest.ts`, and `coverage.ts` (-96 lines).

### Redundant and overlapping suites (consolidate)

| Cluster                  | Files (lines)                                                                                                                                                                                                                                  | Overlap                                                                                                                                                                                                             | Proposal                                                                                                    | Est. reduction |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| Executable resolution    | `fusionExecutable` (537), `fusionCliExecutable` (491), `executableLifecycle` (352)                                                                                                                                                             | jscpd: `executableLifecycle.test.ts:27-68` ≈ `fusionCliExecutable.test.ts:37-85` (two 16–17-line clones); all three stub settings, `which`, and version probes                                                      | One fixture builder in `src/test/projectHarness.ts`; merge `fusionCliExecutable` into `executableLifecycle` | ~300           |
| CLI args                 | `cliArgs.test.ts` (528), `cliArgs.property.test.ts` (287), `fusionCli.test.ts` (598)                                                                                                                                                           | jscpd: `cliArgs.test.ts:21-38` ≈ `fusionCli.test.ts:17-34`. The property suite already covers flag ordering, idempotence, and defer; example tests at `cliArgs.test.ts:186-352` re-assert what the properties prove | Keep the properties plus a short table of golden examples                                                   | ~250           |
| LSP launch / snapshot    | `lspLaunch.test.ts` (208), `lspLaunch.property.test.ts` (280), `projectSnapshot.test.ts` (228), `projectSnapshot.property.test.ts` (126), `readProjectSnapshot.test.ts` (98), `resolveSettingsVariables.test.ts` (117)                         | jscpd: `lspLaunch.test.ts:13-29` ≈ `projectSnapshot.test.ts:11-27`. `resolveSettingsVariables` is a thin wrapper over `substituteVariables` (`utils.ts:388`)                                                        | Delete `resolveSettingsVariables` and its test (§1C); share the snapshot fixture                            | ~180           |
| Config errors            | `suite/configErrors.test.ts` (459) and `integration/configErrors.test.ts` (210)                                                                                                                                                                | Same `ProjectErrors` and `errorHint` behavior: unit tests with mocks, integration tests with real Fusion                                                                                                            | Keep the integration suite for "real dbt output → message"; trim the unit suite to `errorHint` cases        | ~150           |
| Composition / activation | `dbtPowerUserExtension.test.ts` (352), `fusionIntegrationWiring.test.ts` (218), `disposableOwnership.test.ts` (181), `extensionContext.test.ts`, `startupGate.test.ts`                                                                         | All build `compose()` with stub contexts; `dbtPowerUserExtension.test.ts` has 41 call assertions against 52 `expect`s                                                                                               | One composition fixture; delete the string-absence cases                                                    | ~150           |
| CTE lens                 | `cteCodeLensProvider.test.ts` (**1772** lines, 76 `it`s, 18 `describe`s) and `cteCodeLensProvider.property.test.ts` (101)                                                                                                                      | One pure function (`detectCtes`) tested by 76 hand-written cases, mostly comment and quoting permutations (`:173-1037`). jscpd: `:605-674` clone pair                                                               | Turn the permutations into `it.each` tables, or let the property test generate comment and quote placement  | ~900           |
| Lineage panel            | `lineagePanel.test.ts` (946)                                                                                                                                                                                                                   | jscpd: `:605-639` ≈ `:640-674` (35 lines) and `:833-887`                                                                                                                                                            | `it.each`                                                                                                   | ~80            |
| Fusion client pool       | `fusionClientPool.test.ts` (744)                                                                                                                                                                                                               | 4 internal clone pairs, 16–21 lines each (`:181-442`, `:212-281`, `:345-389`, `:662-679`)                                                                                                                           | Extract `startPool()` and `expectRestarted()` helpers                                                       | ~100           |
| Integration helpers      | `artifactProduction.test.ts` / `symlinkedWorkspace.test.ts` (2 clones, 21–23 lines); `fusionLspCaptureProbe` / `targetMutationCapture` / `targetIsolationRegression` (clones of 18–23 lines); `extensionActivation` / `reverseSocketTransport` | Copied setup                                                                                                                                                                                                        | Move it to `integration/helpers/`                                                                           | ~120           |
| Mock duplication         | `src/test/common.ts:1-23` ≈ `src/test/mock/vscode.ts:492-514`                                                                                                                                                                                  | The same helper in two places                                                                                                                                                                                       | Keep one                                                                                                    | ~23            |

That totals about 2,300 lines in `suite` and about 120 in `integration`, roughly 7% of test lines, with no loss of behavior coverage. jscpd counts 68 test clone pairs and 968 duplicated lines in total.

### Tests that mostly test mocks

- Across `src/test/suite`, 633 of 2,165 `expect`s (29%) are `toHaveBeenCalled` or `.mock.calls` assertions. The densest files:

| File                            | Call assertions / `expect`s | Notes                       |
| ------------------------------- | --------------------------- | --------------------------- |
| `dbtPowerUserExtension.test.ts` | 41/52                       |                             |
| `fusionClientPool.test.ts`      | 43/62                       |                             |
| `outputChannels.test.ts`        | 37/60                       |                             |
| `projects.test.ts`              | 34/45                       |                             |
| `runModel.test.ts`              | 22/22                       | 100% interaction assertions |
| `projectSetupCommands.test.ts`  | 19/21                       |                             |

- `project.test.ts` (1301 lines) has 136 mock constructs.
- These assert call wiring rather than outcomes. For `runModel` and `projectSetupCommands`, assert the resulting `CliCommand` or `QueuedCliCommand` value through the pure `cliArgs` layer instead. This is a should-fix and refactor-sized.

### Smoke vs. integration overlap

- `smoke/lspSmoke.test.ts` (154 lines) covers the initialize handshake per Declared Project. `integration/extensionActivation.test.ts` covers activation plus the reverse-socket connect, and `integration/reverseSocketTransport.test.ts` covers the same transport. The integration copies run from source; smoke runs from the VSIX. The duplication is justified by AGENTS.md: smoke is the only check against the packaged artifact.
- `integration/lspEditorFeatures.test.ts` (332 lines, raw LSP client) overlaps `integration/nativeEditorFeatures.test.ts` (402 lines, through VS Code) on definition, diagnostics, and codeLens. Keep both: one checks protocol behavior, the other the editor surface. They could share `lspFixture`.
- Smoke `panelSmoke.test.ts` (928) vs. `panelViewState.test.ts` (460) is fine.

---

## 4. Structure

### Dependency graph (`depcruise`, production `src/`, 150 modules, 654 dependencies)

**Fan-in hubs:**

| Fan-in | Module                            | Notes                                                                                                                     |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 42     | `src/dbt_integration/index.ts`    | Barrel; 4 `export *`. The vendored domain package acts as a catch-all type hub, including `DBTTerminal`, the logging port |
| 26     | `src/core/project/index.ts`       |                                                                                                                           |
| 21     | `src/settings/index.ts`           |                                                                                                                           |
| 16     | `src/projects/projects.ts`        |                                                                                                                           |
| 15     | `src/projects/projectRegistry.ts` |                                                                                                                           |
| 14     | `src/projects/project.ts`         | also fan-out 29: the god-object node of the graph                                                                         |
| 14     | `core/manifest/types.ts`          |                                                                                                                           |
| 14     | `core/manifest/logger.ts`         |                                                                                                                           |
| 11     | `src/utils.ts`                    | 393 lines, 20 unrelated exports                                                                                           |

**Fan-out hubs:**

| Fan-out | Module                             | Notes    |
| ------- | ---------------------------------- | -------- |
| 55      | `compositionRoot.ts`               | expected |
| 29      | `projects/project.ts`              |          |
| 24      | `dbtPowerUserExtension.ts`         |          |
| 24      | `features/commands.ts`             |          |
| 21      | `features/docs/docsEditPanel.ts`   |          |
| 18      | `features/lineage/lineagePanel.ts` |          |
| 18      | `core/manifest/index.ts`           |          |

**Cycles:** all four are baselined in `.dependency-cruiser-known-violations.json`, and all are cheap to fix:

1. `src/dbt_client/event/projectConfigChangedEvent.ts` ↔ `projects/project.ts`. Each event is a 4–8-line class carrying `project: Project`, and `src/dbt_client/` holds nothing else. Move both classes into `project.ts` or `projects/projectEvents.ts` and delete `src/dbt_client/`. AGENTS.md lists `src/dbt_client/` as "dbt integrations, manifest parsing, command execution", which is stale.
2. `src/dbt_client/event/runResultsEvent.ts` ↔ `projects/project.ts`: same fix.
3. `src/projects/manifestTypes.ts:2` ↔ `project.ts`: `Manifest.project: Project` (`:6`). Use a `type` import of a narrow interface, or remove the back-reference.
4. `src/features/codeLenses.ts:2` ↔ `dbtPowerUserExtension.ts`: `codeLenses` reads static `DBTPowerUserExtension.DBT_SQL_SELECTOR` and `DBT_YAML_SELECTOR` (`dbtPowerUserExtension.ts:35,40`). Move the selectors to a small `src/documentSelectors.ts`. This also violates the spirit of `nothing-imports-features` in reverse: a feature imports the root.

**Layer rules missing from `.dependency-cruiser.cjs`:**

- Nothing confines `src/fusion/`, `src/projects/`, `src/metadata/`, or `src/webview/` relative to one another.
- `exclude: "^src/test"` means tests may import anything; that is fine.
- `webview_panels` and `packages/webview-contract` are not cruised at all.
- Add:
  - `fusion-does-not-import-projects`, if that is the intended direction; verify `projectErrors.ts` imports `fusion/commandProcessExecution`, so the direction is projects → fusion.
  - `contract-is-pure`: `packages/webview-contract/src` imports nothing outside itself.
  - `no-orphans` (warn)
  - `no-deprecated-core`

### God modules: production files over the 600-line `max-lines` budget, with suppressions

| Lines | File                                            | Coverage | Notes                                                                                 |
| ----- | ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| 1059  | `src/features/docs/docsEditPanel.ts`            | 53.6%    | 23 suppressions: 11 `any`, 4 floating promises, 4 unused vars; `@ts-ignore` at `:497` |
| 922   | `src/fusion/fusionLanguageClient.ts`            |          | 18 test seams (§1D)                                                                   |
| 877   | `src/features/lineage/lineagePanel.ts`          |          |                                                                                       |
| 815   | `src/features/cte/cteCodeLensProvider.ts`       |          | 8 suppressions; 5 cognitive-complexity                                                |
| 806   | `src/features/commands.ts`                      | 25%      | 5 `max-lines-per-function`; one `register()` mega-method                              |
| 702   | `src/projects/project.ts`                       |          |                                                                                       |
| 678   | `src/core/manifest/relationshipParser.ts`       | **2.7%** |                                                                                       |
| 609   | `src/features/queryResults/queryResultPanel.ts` |          | 7 floating promises                                                                   |

`webview_panels` has no file over 471 lines (`modules/lineage/graph.ts`).

### Duplication (jscpd, min 8 lines)

- Total: 1.56% (1,053 of 67,538 lines, 81 clones). Production: 13 clones, 166 lines. Top production clones:
  - `src/features/cte/cteCodeLensProvider.ts:605-627` ≈ `:766-788` (23 lines)
  - `src/features/projectSetup/projectSetupCommands.ts:55-70` ≈ `:100-116`
  - `src/projects/queryManifestService.ts:88-103` ≈ `:115-130`: the "resolve project → `manifestAt` → bail" preamble repeated in `getEventByCurrentProject`, `getSourcesInProject`, and `getModelsInProject`. Extract `manifestFor(uri)`.
  - `src/features/modelTree/modelTreeviewProvider.ts:100-112` ≈ `:252-264`: two tree providers with identical subscription blocks. Use a base class or helper.
  - `src/core/manifest/graphParser.ts:85-140` (3 clones)
  - `src/features/docs/dbtTestService.ts:215-241`
  - `packages/webview-contract/src/{lineage,documentationEditor,queryResults}.ts` (~10 lines each; the guard boilerplate can become one generic `isMessageOf`)
- Duplication is not a problem area. Fix the `queryManifestService` and `modelTreeviewProvider` clones as part of M1.

### Multiple ways of doing the same thing

| Concern                      | Canonical                                                                                                                                                                                                                                                                                                       | Redundant / divergent                                                                                                                                                                                                                                                                                                                                | Action                                                                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Manifest read**            | `Projects.onDidChangeManifest` + `Project.manifest` (what the code does)                                                                                                                                                                                                                                        | `QueryManifestService.getEventByCurrentProject` / `manifestAt` (12 production importers), `ProjectMetadataSource.current()` (0 callers), `ManifestCacheProjectAddedEvent` (docs only)                                                                                                                                                                | M1                                                                                                                                                                                                                                                           |
| **Logging**                  | `DBTTerminal` → `ChannelLog`/`OutputChannels` (`projects/outputChannels.ts:163,238`); `ManifestLogger` port in `core/`                                                                                                                                                                                          | `console.*` (M3); `DiagnosticsOutputChannel` (`features/diagnostics/diagnosticsOutputChannel.ts:5`, a second wrapper writing to a raw `OutputChannel` for the diagnostics report, legitimately a report sink); the two `createOutputChannel` sites at `outputChannels.ts:170,287`                                                                    | Keep `DiagnosticsOutputChannel` as a report writer; ban `console`; move `DBTTerminal` out of the `dbt_integration` barrel into `src/projects/outputChannels.ts` or `src/log.ts`                                                                              |
| **Settings**                 | `src/settings/index.ts` (`readSetting`), enforced by `no-restricted-properties`                                                                                                                                                                                                                                 | `utils.resolveSettingsVariables` (test-only) vs. `core/project/projectSnapshot.substituteVariables` (canonical)                                                                                                                                                                                                                                      | Delete the `utils` wrapper (§1C)                                                                                                                                                                                                                             |
| **Running dbt**              | Task → `Project.startTask` (`project.ts:490`) → `executeTask` (`dbtTask.ts:120`) → `DbtTaskTerminal` → `queueCli` / `enqueueCommand` (`projectCommands.ts:118,147`) → `CommandQueue` → `FusionCli.prepare` → `CommandProcessExecution` (spawn confined to `fusion/process.ts` and `commandProcessExecution.ts`) | `FusionCli.run`, `compileInline`, `show`, `executeSQL`, and `getColumnsOf*` (`fusionCli.ts:145-357`) run outside the queue and outside tasks. That is a deliberate split for query and preview, not a duplicate. `enqueueCommand` is exported but only `queueCli` calls it                                                                           | One canonical path, so no action beyond un-exporting `enqueueCommand` and `formatCliStatus`. Document the queue/non-queue split in `docs/architecture.md`                                                                                                    |
| **Error reporting**          | `ProjectErrors` (`projects/projectErrors.ts`) for parse, compile, and executable errors, keyed by source; `ProjectDiagnostics` (`projects/projectDiagnostics.ts:60`) is the single `DiagnosticCollection`                                                                                                       | `notifyFailed`, which goes to `RunHistoryService.notifyCommandFailed` (`project.ts:181`) for queued command failure, plus **31 direct `window.showErrorMessage` calls across 17 files** (6 in `commands.ts`, 5 in `queryResultPanel.ts`, 4 in `projectCodegen.ts`, 3 in `docsEditPanel.ts`, …) with inconsistent wording and no "Show output" action | Add one `notifyError(source, message, error)` helper, using `ProjectErrors`' `SHOW_OUTPUT` affordance (`projectErrors.ts:10`), and ban bare `window.showErrorMessage` outside it with `no-restricted-properties`, the same pattern already used for settings |
| **Webview messaging (host)** | `PanelHost` (`src/webview/panelHost.ts:34`) + `messageRouter.ts` + contract guards in `packages/webview-contract`                                                                                                                                                                                               | Three panels still call `webview.postMessage` directly: `lineagePanel.ts:259`, `queryResultPanel.ts:111,591` (with its own replay buffer), and `docsEditPanel.ts:143`                                                                                                                                                                                | Add `PanelHost.post(message: HostMessage)` with typed send and replay. `panelHost.ts` is only 46% covered                                                                                                                                                    |
| **Webview messaging (UI)**   | `webview_panels/src/modules/app/requestExecutor.ts` (`panelRequests`) over `vscode` (`modules/vscode/index.ts:81`)                                                                                                                                                                                              | none found                                                                                                                                                                                                                                                                                                                                           | OK                                                                                                                                                                                                                                                           |
| **Diagnostics**              | `ProjectDiagnostics`                                                                                                                                                                                                                                                                                            | `fusion/fusionDiagnostics.ts` (`ProjectDiagnosticsFilter`, `clearDiagnosticsOnDelete`) filters the LSP's diagnostics, which is a different concern                                                                                                                                                                                                   | OK                                                                                                                                                                                                                                                           |

---

## 5. Suppression baselines

- **Root `eslint-suppressions.json`: 106 rule/file pairs, 194 violations.** Your count of 106 was rule/file pairs; the violation count is 194.
  - By rule: `no-explicit-any` 58, `cognitive-complexity` 20, `no-unused-vars` 20, `max-lines-per-function` 19, `no-floating-promises` 19, `max-depth` 17, `complexity` 12, `no-misused-promises` 6, `max-params` 6, `await-thenable` 6, `no-collapsible-if` 5, `max-lines` 5, `eqeqeq` 1.
- **`webview_panels/eslint-suppressions.json`: 52 more.** `@eslint-react/exhaustive-deps` 15, `max-lines-per-function` 15, `set-state-in-effect` 6, `only-export-components` 4, others.
- **`.dependency-cruiser-known-violations.json`: 4 `no-circular`** (§4).

### Cheap now (mechanical, under 1 hour each; about 60 violations)

| Rule                   | Count | Locations                                                                                                                                                                         | Fix                                                                                                                                                                                                                                                      |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-unused-vars`       | 20    | `docsEditPanel` 4, `queryResultPanel` 2, `utils` 2, `panelHost` 2, `commands`, `modelTreeviewProvider`, `sqlActions*`, `dbtTestService`, `dbtPowerUserExtension`, plus 4 in tests | delete                                                                                                                                                                                                                                                   |
| `await-thenable`       | 6     | `executableLifecycle.ts` ×3, `dbtPowerUserExtension.ts`, `projectSetupCommands.ts`, one test                                                                                      | drop the `await`                                                                                                                                                                                                                                         |
| `no-collapsible-if`    | 5     | `childrenParentParser` 2, `utils` 2, `relationshipParser` 1                                                                                                                       | merge the conditions                                                                                                                                                                                                                                     |
| `eqeqeq`               | 1     | `src/test/integration/nativeEditorFeatures.test.ts`                                                                                                                               |                                                                                                                                                                                                                                                          |
| `no-floating-promises` | 19    | `queryResultPanel` 7, `docsEditPanel` 4, `commands` 2, `lineageViewProvider`, `runModel`, `fusionLanguageClient`, tests                                                           | add `void` or `await`                                                                                                                                                                                                                                    |
| `no-misused-promises`  | 4     | parsers: `docParser`, `macroParser`, `metricParser`, `nodeParser`                                                                                                                 | `new Promise(async (resolve) => …)` (`nodeParser.ts:104`, `macroParser.ts:16`, …): make the methods `async` and drop the Promise wrapper. This is the anti-pattern `no-async-promise-executor` targets, and it also removes the swallowed-rejection risk |
| `no-explicit-any`      | ~20   | `core/manifest/*Parser.ts` (one or two each: exposure, function, source, test, unitTest, metric, macro, semanticModel, modelDepth) and `types.ts` ×3                              | The parsers take `any[]` for manifest JSON; typing them `Record<string, unknown>` plus narrowing also fixes M2                                                                                                                                           |

### Needs refactors (about 130 violations)

| File                                     | Suppressions               | Plan                                                               |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `docsEditPanel.ts`                       | 23                         | Split the message handlers out of the panel                        |
| `sourceModelCreationCodeLensProvider.ts` | 20, 16 of them `max-depth` | Rewrite the CST walk with `for…of` and early returns; fixes M2 too |
| `childrenParentParser.ts`                | 15, 11 `any`               |                                                                    |
| `commands.ts`                            | 11                         | Split `register()` per feature                                     |
| `relationshipParser.ts`                  | 9                          | Needs tests first; 2.7% coverage                                   |
| `cteCodeLensProvider.ts`                 | 8                          | Extract the pure `detectCtes` into `core/`                         |

Most of the remaining complexity and function-length entries live in the same files.

### Target

1. Clear the cheap ~60 in one PR.
2. Run `lint:prune` in `just check` (or fail when the baseline has stale entries) so the baseline can only shrink. Prune exists but is on demand.
3. Set a ratchet. ESLint 9's suppressions file is auto-checked, so add a CI step that fails if `eslint-suppressions.json` grows: compare the total count to `main`.
4. Goal: root suppressions ≤ 100 within two PRs and 0 `no-explicit-any` in `core/`; webview ≤ 30. Fix the four cycles and empty the depcruise baseline.

---

## 6. Missing checks

| Check                                                | State                                                                                                                                                                                                                           | Probe                                                                                                                                                                                                                                                                                                            | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `noUncheckedIndexedAccess`                           | off (`tsconfig.json`)                                                                                                                                                                                                           | 410 errors, **112 in production**                                                                                                                                                                                                                                                                                | Enable in `packages/webview-contract` now; production later via a separate `tsconfig.strict.json` ratchet                                                                                                                                                                                                                                                                                                                                                                                                      |
| `exactOptionalPropertyTypes`                         | off                                                                                                                                                                                                                             | 65 errors                                                                                                                                                                                                                                                                                                        | Worth it for the webview contract package first                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `noImplicitOverride`                                 | off                                                                                                                                                                                                                             | 34 errors                                                                                                                                                                                                                                                                                                        | Cheap; enable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `noUnusedLocals` / `noUnusedParameters`              | off in root, on in `webview_panels/tsconfig.json:21`                                                                                                                                                                            | 15 production errors                                                                                                                                                                                                                                                                                             | Enable in root; this overlaps the `no-unused-vars` suppressions                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `typescript-eslint` presets                          | only `flat/base` + `flat/eslint-recommended` plus 4 hand-picked type-aware rules (`eslint.config.cjs:76-108`)                                                                                                                   | `strict-type-checked` on production code: **844** new violations (`restrict-template-expressions` 152, `no-unsafe-member-access` 132, `no-unnecessary-condition` 126, `no-unsafe-assignment` 118, `no-confusing-void-expression` 93, `no-unsafe-argument` 75, `no-non-null-assertion` 32, `require-await` 26, …) | Do not adopt wholesale. Add now the zero-or-near-zero, bug-finding rules: `no-for-in-array`, `no-misused-spread`, `no-base-to-string`, `no-non-null-asserted-optional-chain` (6, `graphParser.ts:176-244`), `no-unnecessary-type-assertion` (8), `prefer-promise-reject-errors`, `only-throw-error`, `switch-exhaustiveness-check`, `no-async-promise-executor` (core), `ban-ts-comment` (`docsEditPanel.ts:497`), `no-console`. Adopt `no-unsafe-*` per directory, starting with `core/`, as `any` is removed |
| Type coverage                                        | none                                                                                                                                                                                                                            | 50 `: any` / `as any` in production `src/`, 1 in the webview                                                                                                                                                                                                                                                     | Add `type-coverage --at-least 97 --strict --ignore-files 'src/test/**'` to `lint` with a ratchet                                                                                                                                                                                                                                                                                                                                                                                                               |
| Unused files / exports                               | knip, on demand                                                                                                                                                                                                                 | §1                                                                                                                                                                                                                                                                                                               | Gate (§2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Bundle-size budget                                   | none (`scripts/benchmark/run-baseline.sh` measures but never gates)                                                                                                                                                             | `dist/extension.js` 1.14 MB, `dist` 4.3 MB, `webview_panels/dist` 5.3 MB, VSIX 4.88 MB                                                                                                                                                                                                                           | Add `just lint-size` after `just package`: fail if `dist/extension.js` > 1.25 MB, VSIX > 5.5 MB, or any `webview_panels/dist/assets/<entry>.js` grows more than 10% over a committed `out/size-baseline.json`. Run it in `check-and-package.yml` after `just package`                                                                                                                                                                                                                                          |
| Complexity thresholds in CI                          | present (`complexity` 15, cognitive 15, `max-depth` 4, `max-params` 5, `max-lines` 600, `max-lines-per-function` 80) and enforced by `just lint` via `check-and-package.yml:26`; relaxed in tests (`eslint.config.cjs:135-143`) | 158 grandfathered                                                                                                                                                                                                                                                                                                | Keep, with the ratchet in §5. Consider `max-lines` 400 for new files through an override list                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Coverage threshold                                   | configured but no `thresholds`                                                                                                                                                                                                  | 69.8 / 61.6 / 75.2                                                                                                                                                                                                                                                                                               | Add `coverage.thresholds` at the current floor (lines 69, branches 61) plus `autoUpdate` as a ratchet; run `test:coverage` in `check` (it costs about 2 s)                                                                                                                                                                                                                                                                                                                                                     |
| depcruise layers                                     | 6 rules, `src/` only                                                                                                                                                                                                            | §4                                                                                                                                                                                                                                                                                                               | Add the rules in §4 and cruise `packages/webview-contract`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `no-restricted-syntax` for `window.showErrorMessage` | none                                                                                                                                                                                                                            | 31 sites                                                                                                                                                                                                                                                                                                         | §4 error-reporting row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Documentation drift                                  | none                                                                                                                                                                                                                            | `ManifestCacheProjectAddedEvent` and `FusionProjectIntegration` appear in docs but not in code                                                                                                                                                                                                                   | A small `docs-symbols` check: backticked identifiers in `AGENTS.md`, `CONTEXT.md`, and `docs/architecture.md` must exist in `src/` (allowlist for prose)                                                                                                                                                                                                                                                                                                                                                       |

---

## Should-fix (summary)

- S1. Delete `src/modules.ts` and the `@extension` alias in 3 configs (§1B).
- S2. Fix the 4 cycles and delete `src/dbt_client/` (§4).
- S3. Route panel `postMessage` through `PanelHost.post` (§4).
- S4. Add a single error-notification helper and the lint ban (§4).
- S5. Consolidate tests (§3, about -2.4k lines). Delete `extension.test.ts` and the absence guards in favor of lint rules.
- S6. Add tests for `relationshipParser.ts`, `docGenService.ts`, and `sourceModelCreationCodeLensProvider.ts` before refactoring them.
- S7. Split `fusionLanguageClient.ts` so its test seams become module APIs.

## Optional

- O1. Lower fast-check `NUM_RUNS` on PRs and raise it nightly (about -4 s).
- O2. Mark §1D seams `@internal`.
- O3. Replace `glob` with `fs.globSync`, and port the one `ts-mockito` test.
