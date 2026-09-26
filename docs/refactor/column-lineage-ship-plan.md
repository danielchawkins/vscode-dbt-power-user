# Ship plan: native editor features, column lineage, and the next release

This is the authoritative plan for all remaining work up to the next release and through Phase 10 to 1.0.0. It supersedes [column-lineage-plan.md](column-lineage-plan.md), the "Next" list in [remaining-implementation.md](remaining-implementation.md), and step 7.5 of [fusion-lsp-plan.md](fusion-lsp-plan.md). Landing rules stay in [implementation-dispatch.md](implementation-dispatch.md); vocabulary is [CONTEXT.md](../../CONTEXT.md). Every claim about Fusion behaviour cites a section of the consolidated evidence, [docs/research/evidence/README.md](../research/evidence/README.md) ("evidence README"); the per-area files in that folder are run records only and are not cited. [ADR 0006](../adr/0006-column-lineage-from-fusion-static-analysis.md) still decides that column lineage comes from Fusion strict static analysis.

Each numbered step is one bookmark and one pull request against `main`, built serially per the dispatch loop, and ends with `just check` green at its tip. Steps that change Fusion behaviour also pass `just test-integration`; steps that change `package.json` contributions also pass `just package` and `just smoke`.

## Principle

Use the most native mechanism the evidence shows working, in this order, and delete extension code that a higher tier already covers:

1. `dbt lsp` through `vscode-languageclient`, which registers every advertised provider with no extension code;
2. a `dbt` CLI command whose stdout is the result;
3. reading a Fusion artifact directly.

## What the evidence settles

- **Where strict comes from.** The CLI takes strict from `--static-analysis`, `DBT_ENGINE_STATIC_ANALYSIS`, or `+static_analysis: strict` model config in `dbt_project.yml`, in that precedence; `flags: static_analysis` did nothing, and a child cannot be stricter than its parent (evidence README section 1, m1). The language server takes strict from `--static-analysis` or model config, the flag wins, and there is no env binding (section 1, m2). Today the extension always passes `--static-analysis` from `fusionPowerUser.staticAnalysis` (default `baseline`), so it overrides a project's own strict config.
- **Strict without `dbt login`.** Strict took effect unauthenticated in every run, although the docs say it falls back to baseline; the licence and trial gate lives in closed crates (section 2). The product treats this as a risk and detects fall-back at run time (step 6).
- **Native editor features.** Through VS Code with strict, hover, definition, references and alias rename answer for columns; with baseline every column request is empty; Fusion returns no code lenses (section 6).
- **Writing lineage.** The language server never writes column lineage under any flag, env var, `initializationOptions` or notification. `dbt compile --static-analysis strict --generate-info-schema` does; `--generate-info-schema` without strict warns `dbt1000` and writes no lineage (section 3).
- **Reading lineage.** `dbt show --info column_lineage --output json --limit -1 --quiet` is one JSON array line on stdout with empty stderr, needs no warehouse, and `--inline` over `{{ info_schema('column_lineage') }}` accepts WHERE and joins. `--log-format json` puts log events on stdout even with `--quiet`. Exit 1 with `InfoSchemaUnavailable (dbt1656)` means no metadata; exit 0 with `[]` is ambiguous (section 5).
- **Refreshing one model.** `-s <model>` with an unbuilt, unselected parent emits `dbt1014` and sets `static_analysis` off for the model; `-s +<model>` refreshes it; no defer or state flag avoids that (section 4).
- **Warehouse-free operation** (section 7). With `sources: +schema_origin: local` and every source column typed, a full-project strict compile made zero warehouse queries and worked with the warehouse file absent, and `-s +<model>` also ran warehouse-free. A bare `-s <model>` still `DESCRIBE`d the unbuilt parent and fell back to off, even with every model typed in YAML and `contract: {enforced: true}`: the open crates give local schemas only to unselected sources with local origin (`crates/dbt-tasks-core/src/local_schema_builder.rs:140-150`), models default to remote (`crates/dbt-schemas/src/schemas/nodes.rs:666`), and `+schema_origin` under `models:` is rejected with `dbt1013`. So refresh must always select `+<model>`, warehouse-free operation needs every source column typed, and models need not be typed. The download and the "Setting 'static_analysis' to off" fallback are in closed crates; the public repo is still at `9977b6c` with no 2.0.6 tag.

## Already done

- **Legacy language providers.** `src/autocompletion_provider/`, `src/definition_provider/` and `src/hover_provider/` are deleted on `main` (revision `xtknuuwo`, "delete legacy completion, definition, and hover providers"), with `src/test/integration/lspEditorFeatures.test.ts` as the replacement flow test. `src/document_formatting_edit_provider/` and `src/validation_provider/` are gone. Step 5.6 is complete; `v0.3.0-alpha.0` is tagged.
- **Fusion 2.0.6 pin** for development and tests (PR #97).

## Cut

| Component                                                                                                              | Replaced by                                                                                          | Step |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---- |
| `FusionCapability`, `capabilitiesFor`, `selectionAdmitsCapability`, `STRICT_CAPABILITIES`                              | nothing; no production caller, and the server answers or returns empty on its own (section 6)        | 2    |
| `StaticAnalysisSelection.effective` and "static: unknown" in the status bar                                            | the configured mode; no server field reports an effective mode, and lineage reports its own          | 2    |
| `FPU_RUN_NATIVE_EDITOR_EVIDENCE` gate and the evidence-JSON writer in the native test                                  | the same assertions in the default integration launch                                                | 2    |
| PR #98 `findJsonArray` log-line scanning and its mixed-stdout fixture                                                  | `--quiet` pure-JSON stdout (section 5)                                                               | 3    |
| PR #98 `from_*`/`to_*` column set and `ingestedAt`                                                                     | explicit column list in the `--inline` query; a rename fails loudly and the integration test pins it | 3    |
| Planned `hyparquet` reader, planned edge cache and invalidation                                                        | one `dbt show --inline … --quiet` per panel request (section 5)                                      | 3    |
| Planned `fusionPowerUser.columnLineage.schemaOrigin` and `refreshOnSave` settings                                      | the schema-origin check (step 4) decides both                                                        | 4, 5 |
| Planned panel column rename, references and go-to-column                                                               | native LSP (section 6)                                                                               | —    |
| Language-server lineage path (`dbt.listNodes` / `dbt.getCurrentNode` in step 7.5)                                      | CLI compile and `dbt show` (section 3)                                                               | 3    |
| Opt-in captures whose decisions are made: `fusionEditorFlowsCapture.test.ts`, `s1DependencyDiagnosticsCapture.test.ts` | `lspEditorFeatures.test.ts`, `nativeEditorFeatures.test.ts`, ADR 0005                                | 7    |
| Extension code lenses                                                                                                  | kept: Fusion returns none (section 6)                                                                | —    |

## Steps

| #  | Bookmark                             | Title                                                     | Depends on | Deletes                                                                  |
| -- | ------------------------------------ | --------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| 1  | `docs/fusion-lineage-evidence` (#99) | Evidence and this plan                                    | —          | nothing                                                                  |
| 2  | `feat/static-analysis-project-mode`  | `project` mode default; native test by default            | 1          | capability helpers, `effective`, native-test opt-in gate and JSON writer |
| 3  | `feat/column-lineage-reader` (#98)   | Panel lineage from `dbt show --inline --quiet`            | 1          | log-line scanning, second column set, `ingestedAt`, planned cache        |
| 4  | `feat/project-config-commands`       | Schema-origin hook, strict suggestion, typed-source check | 2          | planned schema-origin setting                                            |
| 5  | `feat/lineage-refresh`               | Refresh with `-s +<model>` on save and on demand          | 3, 4       | planned refresh-on-save setting                                          |
| 6  | `feat/lineage-fallback-detection`    | Detect strict fall-back at run time                       | 5          | nothing                                                                  |
| 7  | `refactor/retire-finished-captures`  | Retire finished captures and stale docs                   | —          | two opt-in capture suites, stale provider references                     |
| 8  | `release/<version>`                  | Next prerelease                                           | 2–7        | nothing                                                                  |
| 9  | (finance-pipelines, `gh stack`)      | Phase 10 consumer adoption                                | 8          | the consumer's patch machinery                                           |
| 10 | `release/1.0.0`                      | 1.0.0                                                     | 9          | nothing                                                                  |

Steps 2 and 3 are independent children of 1; step 7 is independent of everything and may land whenever the serial queue is free.

### 1. Evidence and this plan

- **Goal:** land `scripts/evidence/`, `docs/research/evidence/`, the native-editor fixture and test, and this plan. No product behaviour change.
- **Files:** as on bookmark `docs/fusion-lineage-evidence`, plus this document and the close-out notes in `remaining-implementation.md`, `s10-static-analysis.md`, `column-lineage-plan.md`, `fusion-lsp-plan.md` 7.5, `fusion-lsp-feature-disposition.md`, and `docs/refactor/README.md`.
- **Verify:** `just check`; rerun one CLI and one language-server experiment from a clean shell with `DBT_BIN=<abs dbt> scripts/evidence/run.sh`.

### 2. `project` static-analysis mode, and the native-editor test by default

- **Goal:** let a project's own `+static_analysis` reach the language server, make that the default, and make the native editor features a regression test rather than an evidence capture.
- **Files:**
  - `src/fusion/staticAnalysisMode.ts`: `StaticAnalysisMode = "project" | "off" | "baseline" | "strict"`; `DEFAULT_STATIC_ANALYSIS_MODE = "project"`. Replace `StaticAnalysisSelection` with the configured mode. Delete `FusionCapability`, `capabilitiesFor`, `selectionAdmitsCapability`, `STRICT_CAPABILITIES`, `createStaticAnalysisSelection`, and the `effective` field.
  - `src/lsp/fusionLanguageClient.ts` `buildFusionLspArgs`: push `--static-analysis <mode>` only when the mode is not `project`.
  - `src/lsp/fusionStatus.ts`: show `static: <configured>`; drop the effective line from the tooltip.
  - `package.json`: add `project` first in the enum, default `project`; enum descriptions say what the server does and nothing about column lineage (the server never produces it, section 3). The `project` description names the one-line `dbt_project.yml` opt-in that step 4's command inserts.
  - `src/test/integration/runTests.ts`: run `runNativeEditorLaunch` for `strict`, `baseline`, and `project` unconditionally. For `project`, the fixture copy's `dbt_project.yml` gains `models: lineage_probe: +static_analysis: strict` before launch.
  - `src/test/integration/nativeEditorFeatures.test.ts`: delete `NATIVE_EDITOR_EVIDENCE_OUT`, the evidence-file writer and `describeDbtOnHostPath`; `project` asserts the strict results.
  - Unit tests: `src/test/suite/staticAnalysisMode.test.ts`, `src/test/suite/fusionLanguageClient.test.ts` (no flag for `project`; flag for the other three).
- **Contract:** `buildFusionLspArgs({ staticAnalysisMode: "project", … })` contains no `--static-analysis`; every other mode contains exactly one `--static-analysis <mode>`. A change of the setting restarts that project's Fusion Client, as today.
- **Keep:** `strict`, `baseline` and `off` as explicit overrides, because the flag wins over project config (section 1, m2 step 06).
- **Verify:** `just check`, `just test-integration` (three native-editor launches green), `just package`, `just smoke`.
- **Evidence:** section 1 m2 steps 02, 05, 06 (project config enables strict on the server, the flag overrides it); section 6 (strict results and baseline empties through VS Code).

### 3. Panel lineage from `dbt show --inline --quiet` (PR #98, same bookmark)

- **Goal:** answer the lineage panel's `getConnectedColumns` from Fusion.
- **Bookmark:** implemented by editing PR #98's existing bookmark `feat/column-lineage-reader` in place. Do not close #98; rewrite its revisions and retitle it. Rebase it onto `main` after step 1 merges.
- **First task:** capture real stdout of the step's exact `--inline … --output json --limit -1 --quiet` command on the native-editor fixture and check it is one JSON array line with empty stderr. Section 5 shows that for `--info`; `--inline` with `--quiet` is not separately recorded. Stop and report if it is not clean.
- **Files:**
  - `src/fusion/columnLineage.ts`: keep `LineageEvolution`, `ColumnRef`, `ColumnEdge` (without `ingestedAt`), `ColumnLineage`, `toPanelLineage` and its mapping. Replace `parseColumnLineage` with `parseLineageRows(stdout: string, report)` = `JSON.parse` of trimmed stdout plus per-row validation of the one binary column set. Add `buildLineageQuery(uniqueIds: readonly string[], direction: "upstream" | "downstream"): string`, which selects `parent_node_unique_id, parent_column_name, child_node_unique_id, child_column_name, evolution` from `{{ info_schema('column_lineage') }}` where `child_node_unique_id` (upstream) or `parent_node_unique_id` (downstream) is in the quoted list. IDs come only from the manifest; single quotes are doubled.
  - `src/dbt_integration/dbtFusionCommandIntegration.ts`: `showColumnLineage(sql: string, signal?: AbortSignal): Promise<LineageRead>` runs `show --inline <sql> --output json --limit -1 --quiet` through `wrapCommand` (so `--profiles-dir`, the executable setting and the env snapshot apply) with no `--log-level` or `--log-format`.
  - `src/services/dbtLineageService.ts`: `getConnectedColumns(project, request)` maps `request.targets` tables to unique IDs via the manifest, calls `showColumnLineage`, filters to the requested columns in TypeScript, and returns `toPanelLineage` output.
  - `src/webview_provider/newLineagePanel.ts`: replace the empty `column_lineage` answer with the service call; on `empty` or `unavailable`, post "No column lineage yet" (step 5 adds the button).
  - Tests: `src/test/suite/columnLineage.test.ts`, `src/test/suite/dbtLineageService.test.ts`, `src/test/suite/newLineagePanel.test.ts` with a fake command factory and the stdout captured above; `src/test/integration/columnLineage.test.ts` runs a full strict compile on a native-editor fixture copy in setup, then asserts `getConnectedColumns` for `order_totals.total` and pins the raw column names.
- **Contract:**

```ts
export type LineageRead =
  | { kind: "edges"; edges: ColumnEdge[] }
  | { kind: "empty" } // exit 0 and []: no lineage, or no strict --generate-info-schema compile yet
  | { kind: "unavailable" } // exit 1, InfoSchemaUnavailable (dbt1656)
  | { kind: "failed"; message: string };
```

- **Deletes:** `findJsonArray`, the `from_*`/`to_*` column set, `ingestedAt`, the mixed-stdout fixture `fusion-show-column-lineage-2.0.6.txt`; no cache, no parquet reader.
- **Verify:** `just check`, `just test-integration`.
- **Evidence:** section 5 (clean read, `--inline` filters, dbt1656, ambiguous `[]`, `--log-format` pollution); section 3 (only the CLI writes lineage).

### 4. Project configuration commands and the typed-source check

- **Goal:** let a user opt a project into strict and into local schema origin with one confirmed edit each, and know when the project is warehouse-free.
- **Files:**
  - `src/fusion/projectConfigEdits.ts`: one confirm-then-insert seam over the `yaml` package's Document API, applied as a `WorkspaceEdit` on the Declared Project's `dbt_project.yml` so it is undoable and preserves comments. It never writes when the key already exists and never runs without a modal confirmation that shows the exact lines.
  - Commands in `src/commands/`: `fusionPowerUser.enableStrictAnalysis` inserts `models: <project name>: +static_analysis: strict` (project level, because a child cannot be stricter than its parent, section 1 m1 step 12). `fusionPowerUser.addSchemaOriginHook` inserts `sources: +schema_origin: "{{ env_var('FUSION_POWER_USER_SCHEMA_ORIGIN', 'remote') }}"`.
  - `src/fusion/schemaOrigin.ts`: `resolveSchemaOrigin(project): SchemaOriginStatus`, from the parsed `dbt_project.yml` and the manifest's `SourceMetaMap` for the Declared Project, including sources from Dependency Projects.
  - `package.json`: the two commands.
  - Tests: `src/test/suite/projectConfigEdits.test.ts`, `src/test/suite/schemaOrigin.test.ts`.
- **Contract:**

```ts
export type SchemaOriginStatus =
  | { kind: "local" } // hook present, Fusion >= 2.0.6, every source table has columns and every column a data_type
  | { kind: "noHook" }
  | { kind: "unsupportedFusion"; version: string } // local origin needs 2.0.6 (ADR 0006)
  | { kind: "untypedSources"; missing: { source: string; table: string; column?: string }[] };
```

- **Rules:** only `local` sets `FUSION_POWER_USER_SCHEMA_ORIGIN=local` on step 5's CLI runs; otherwise the variable is left unset and the project behaves as without the hook. A table with no declared columns counts as untyped. Models are not checked.
- **Surfaces:** the lineage panel's "No column lineage yet" message and the Fusion status-bar tooltip list which of the two opt-ins are missing and how many source columns lack `data_type`, with buttons for the commands. No toasts (decision 9).
- **Verify:** `just check`, `just package`, `just smoke`.
- **Evidence:** section 1 m1 steps 08, 11, 12 (model config works; `flags:` does not; project-level placement); section 7 (every source column typed is necessary and sufficient; model types are not used).

### 5. Refresh lineage with `-s +<model>`

- **Goal:** keep lineage current after an edit, and let the user compute it on demand.
- **Files:**
  - `src/dbt_integration/dbtFusionCommandIntegration.ts`: `compileColumnLineage(selector: string | undefined, env: Record<string, string>, signal)` runs `compile [-s <selector>] --static-analysis strict --generate-info-schema`. Add an optional `env` to `DBTCommand`, merged into `envVars` at `createCommandProcessExecution`, instead of mutating `process.env`.
  - `src/services/columnLineageRefresh.ts`: per Declared Project, one in-flight run; a newer request aborts the older one; saves debounce 1 s and coalesce. `refreshModel(project, model)` always uses selector `+<model>`; there is no code path that passes a bare `<model>`. `refreshProject(project)` passes no selector.
  - `src/webview_provider/newLineagePanel.ts`: "No column lineage yet" gains "Compute column lineage" (`refreshProject`). Command `fusionPowerUser.refreshColumnLineage` does the same from the palette.
  - On save of a model file in a Declared Project, call `refreshModel` only when the configured mode is not `baseline` or `off` and `resolveSchemaOrigin` is `local`. Otherwise the save does nothing and the panel offers the button, because a remote-origin compile queries the warehouse.
  - Progress goes to the existing Fusion status-bar item.
  - Tests: `src/test/suite/columnLineageRefresh.test.ts` with fake timers (argument lists always contain `+<model>`, env only for `local`, debounce, coalescing, abort). `src/test/integration/columnLineage.test.ts` adds: edit `order_totals.sql` to add a column, save, assert the new column appears in `getConnectedColumns` without the DuckDB file present.
- **Why the flag is explicit:** lineage exists only under strict (section 3). Passing `--static-analysis strict` on these CLI runs is independent of the editor's mode and of project config.
- **Verify:** `just check`, `just test-integration`, `just package`, `just smoke`.
- **Evidence:** section 4 (`+<model>` refreshes; bare `<model>` emits dbt1014); section 7 (bare `<model>` falls back even with typed models; `+<model>` and full compile are warehouse-free with typed sources and local origin).

### 6. Detect strict fall-back at run time

- **Goal:** never report "no lineage" when strict did not run.
- **Files:**
  - `src/fusion/lineageDiagnostics.ts`: `classifyCompile(exitCode, stdout, stderr): CompileOutcome`, pure.
  - `src/services/columnLineageRefresh.ts`: after an exit-0 compile that selected model `m`, read lineage for `m`; `empty` for a model the manifest shows with columns means strict did not take effect.
  - Panel and status bar show the outcome's message; the output channel keeps the raw lines.
  - Tests: `src/test/suite/lineageDiagnostics.test.ts` over captured compile output; `src/test/integration/columnLineage.test.ts` adds a remote-origin run with a dropped source table and asserts `skipped` with `dbt1014`.
- **Contract:**

```ts
export type CompileOutcome =
  | { kind: "analyzed" }
  | { kind: "skipped"; models: string[] } // dbt1014, "Setting 'static_analysis' to off"
  | { kind: "strictUnavailable"; signal: "dbt1000" | "licence" | "emptyAfterStrict" }
  | { kind: "failed"; exitCode: number; message: string };
```

- **Match strings:** `licence` matches the binary's "Strict static analysis will be unavailable" message. The match strings live in this one module.
- **Verify:** `just check`, `just test-integration`.
- **Evidence:** section 2 (strict ran unauthenticated but the gate exists in closed code); section 3 (dbt1000 under non-strict, dbt1014 with remote origin and a missing source); section 5 (`[]` is ambiguous); section 7 (the off fallback is in closed crates).

### 7. Retire finished captures and stale docs

- **Goal:** delete opt-in capture suites whose decisions are made, and references to directories that no longer exist.
- **Files:** delete `src/test/integration/fusionEditorFlowsCapture.test.ts` (step 5.6 is done; `lspEditorFeatures.test.ts` is the flow test) and `src/test/integration/s1DependencyDiagnosticsCapture.test.ts` (ADR 0005 is decided). Update `AGENTS.md`'s directory list (no `autocompletion_provider/`, `definition_provider/`, `hover_provider/`), `docs/architecture.md` (it says the legacy providers run until 5.6), and mark `docs/refactor/fusion-editor-flow-evidence.md` historical. Confirm first whether `targetIsolationRegression.test.ts` guards a live rule; delete it only if not.
- **Verify:** `just check`, `just test-integration`.

### 8. Next prerelease

- Cut after steps 2–7 are on `main`: bump the version, `just release` dry run, tag, and install the VSIX in both pinned hosts. The version string is the orchestrator's decision; the fusion-lsp-plan sequence would name `0.4.0-beta.0`.
- Release notes state the new default (`project`), the two opt-in commands, and that column lineage needs strict and, for refresh on save, local schema origin with typed sources.
- **Verify:** `just check`, `just package`, `just smoke`, release workflow green.

### 9. Phase 10 consumer adoption

- Work in `/Users/daniel/projects/finance-pipelines` with that repository's `gh stack` skill, not this repository's PR loop. Steps 10.1–10.4 and their contracts stay in [fusion-lsp-plan.md](fusion-lsp-plan.md) Phase 10.
- Add to 10.3: set `fusionPowerUser.staticAnalysis` to `project` (or leave it unset). Before inserting `+static_analysis: strict` or the schema-origin hook there, record the step 4 check's count of untyped source columns and the wall time of `dbt compile -s +<model> --static-analysis strict --generate-info-schema` for three representative models with remote origin. Enable refresh on save only if the check reports `local`.
- **Verify:** as in the plan's 10.3 and 10.4, including all seven characterization cases green through the fork before 10.4.

### 10. 1.0.0

- Cut once Phase 10 confirms the consumer works, as the fusion-lsp-plan Phase 9 states.

## Open questions

Each is settled by a new experiment before code depends on it.

- **Strict without authentication** (section 2). Rerun m3 on a fresh machine and after the trial window. Step 6 contains the product risk either way.
- **View contents after a selective compile** (section 4, "Not established"). Until the rule is known, the panel treats a missing row as "not analysed yet", and "Compute column lineage" runs a full compile.
- **Downstream `select *` children** after `-s +<model>`: whether they need `<model>+` to pick up a new column. Not in the evidence README; measure before adding `+<model>+`.
- **Section 7 against later binaries.** Its source reasoning comes from open crates older than 2.0.6; the step 5 integration test (warehouse file absent) is the check on each Fusion bump.
- **Root `sources:` config and Dependency Project sources.** Whether `+schema_origin` at the root applies to package sources. Step 4 counts them as required until measured.
- **Language-server lineage.** No flag or protocol path wrote it (section 3). If a Fusion release changes that, rerun the lsp-flags experiment and delete step 5's CLI compile.

## Out of scope

Documentation propagation; column lineage for Dependency Projects; steps 7.2, 7.4 and 7.6 beyond their recorded status in fusion-lsp-plan; v2.
