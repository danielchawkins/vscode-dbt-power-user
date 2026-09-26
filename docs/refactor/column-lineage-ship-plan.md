# Column lineage and native editor features: ship plan

This plan supersedes the earlier nine-step column lineage plan. It is grounded only in the recorded experiments indexed in [docs/research/evidence/README.md](../research/evidence/README.md): E1–E6 in [fusion-lineage-evidence-2026-09-26.md](../research/fusion-lineage-evidence-2026-09-26.md), then c1–c5, s1a–s5, r1–r8, l1–l7, p1–p6 and the VS Code integration run. It keeps [ADR 0006](../adr/0006-column-lineage-from-fusion-static-analysis.md)'s decision that column lineage comes from Fusion strict static analysis. Each step is one bookmark and pull request against `main` and ends with `just check` green.

## Principle

Use the most native mechanism that the evidence shows working, in this order:

1. `dbt lsp` through `vscode-languageclient`, which registers every advertised provider in VS Code with no extension code;
2. a `dbt` CLI command whose stdout is the result;
3. reading a Fusion artifact directly.

Delete extension code that a higher tier already covers. Keep a lower tier only where the evidence shows the higher one does not produce the result.

## What the evidence supports

- **Editor features are native, and only in strict mode.** With strict in effect, hover, definition, references and rename answered for columns, including rename of an alias across models. That held both through the raw client (E3) and through VS Code with this extension (native-editor-vscode). With `baseline` or `off`, every column request returned nothing (E3; lsp-flags l6). The language server took strict from `--static-analysis strict` or from `+static_analysis: strict` model config in `dbt_project.yml`, not from `DBT_ENGINE_STATIC_ANALYSIS`, and the flag overrode the project config (evidence README section 1, m2). The extension always passes `--static-analysis` from `fusionPowerUser.staticAnalysis` (default `baseline`), so today it overrides a project's own strict config. Through VS Code, `prepareRename` falls back to the word range, so a rename the server refuses fails only after a name is typed (native-editor-vscode).
- **Strict took effect without `dbt login` on this machine** (evidence README section 2, m3), although the docs say unauthenticated runs fall back to baseline and the binary contains trial-licence code. The product must not assume strict is available: it detects a fall-back at run time.
- **The server did not write or refresh column lineage** under any flag, env var, `initializationOptions` or notification tried (lsp-flags l1–l7; lsp-protocol P1, P5). Its `dbt.show` cannot read `info_schema('column_lineage')` (lsp-protocol P4).
- **The CLI writes lineage only with both strict analysis and info-schema generation**, from `compile`, `build` or `run` but not `parse` or `list` (cli-compile c1, c2). Unrelated flags made no difference (cli-compile c4).
- **`dbt show --info column_lineage --output json --limit -1 --quiet` is a clean read.** Stdout is one JSON array line and stderr is empty; it takes about 80 ms, needs no warehouse access, and `--inline` accepts WHERE, joins and recursive queries (cli-read r1, r3, r5, r6). Reading the parquet directly added no rows or lineage columns (cli-read r8), so no separate parquet reader is needed. Two things must not be mixed in: `--log-format json` or `otel` puts log events on stdout even with `--quiet` (cli-read r2), and a compile without `--generate-info-schema` reads back as `[]` with exit 0, the same as "no lineage" (cli-read r7 06).
- **Refreshing one model needs its parents analysed or built.** Selecting the model alone produced dbt1014 and left its lineage unchanged whenever the parent was not built and not selected; no defer, state or manage-state flag avoided that. Including parents (`+model`) refreshed it (cli-select-state items 1–4).
- **After a selective compile, the `column_lineage` view may hold only the selected models** or all of them, depending on the earlier steps, and the rule is not established (cli-select-state items 5–7). The panel must not treat one selective compile's view as the whole project.

## Cut

| Component                                                                       | Replaced by                                                                                                                                       | Step |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/fusion/columnLineage.ts` `parseColumnLineage` log-line scanning (PR #98)   | `--quiet` pure-JSON stdout (E5)                                                                                                                   | 2    |
| Proposed `hyparquet` reader                                                     | `dbt show --info` (E5)                                                                                                                            | —    |
| Planned `ColumnLineageRunner.read()` cache and invalidation                     | one `dbt show --inline … where` per panel request (E5)                                                                                            | 3    |
| Planned `fusionPowerUser.columnLineage.schemaOrigin` / `refreshOnSave` settings | the existing `fusionPowerUser.staticAnalysis` setting plus the project hook                                                                       | 3    |
| Planned column rename, references or go-to-column features in the panel         | native LSP rename, references and definition (E3)                                                                                                 | —    |
| Plan step 9 (documentation propagation)                                         | deferred; not needed to ship                                                                                                                      | —    |
| Legacy code lenses that duplicate native lenses                                 | none: the server returned `null` code lenses (E3), so the extension's `Run`, `Test`, `Execute Query`, `Document` and `Generate model` lenses stay | —    |

## Steps

### 1. Land the evidence

This bookmark: `scripts/evidence/`, `docs/research/evidence/` and the first-pass evidence document. No product change. Verify: `just check`; rerun one CLI and one language-server experiment from a clean shell.

### 2. Let the project's static-analysis config reach the language server, and default to strict (feat)

- Add a `project` value to `fusionPowerUser.staticAnalysis` that passes no `--static-analysis`, so the project's own `+static_analysis` config applies (m2 steps 02 and 05), and make it the default. Keep `strict`, `baseline` and `off` as explicit overrides, because the flag wins over project config (m2 step 06).
- For a project with no `+static_analysis` config, `project` means Fusion's default, baseline. Offer strict with a one-line `dbt_project.yml` suggestion (`models: <project>: +static_analysis: strict`), inserted only after the user confirms, alongside step 5's schema-origin hook. Do not edit the file silently.
- `src/fusion/staticAnalysisMode.ts` and `buildFusionLspArgs`: omit the flag for `project`. `docs/refactor/s10-static-analysis.md`: point to the evidence README sections 1 and 6 as the runtime evidence S10 asked for.
- Keep the integration test and fixture from the editor-matrix run (`src/test/integration/nativeEditorFeatures.test.ts`, `src/test/fixtures/native-editor/`), but run them in the default integration launch rather than behind `FPU_RUN_NATIVE_EDITOR_EVIDENCE`. The server receives `process.env` (`src/fusion/fusionExecutable.ts`), so `FUSION_POWER_USER_SCHEMA_ORIGIN=local` reaches it with no new setting.
- Remote sources in strict mode make the server query the warehouse for source schemas (ADR 0006 research). Document that in the setting description; do not add a fallback.
- Verify: `just check`, `just test-integration`, smoke on both hosts.

### 3. Serve panel lineage from `dbt show` (feat)

- Replace PR #98's module. Close #98 and open this step in its place.
- `src/fusion/columnLineage.ts` keeps `toPanelLineage` and its mapping table; `parseColumnLineage` becomes `JSON.parse` of stdout, plus the existing column-set tolerance and unknown-row reporting.
- `src/services/dbtLineageService.ts` `getConnectedColumns` runs, through the existing Fusion CLI integration (so `--profiles-dir` and the executable setting apply): `dbt show --inline "select * from {{ info_schema('column_lineage') }} where <parent or child in the requested tables>" --output json --limit -1 --quiet`. Build the `where` clause from unique IDs taken from the manifest, never from panel text.
- `src/webview_provider/newLineagePanel.ts` replaces the empty answer with the service call. Exit 1 with `InfoSchemaUnavailable (dbt1656)` means nothing has been compiled (cli-read r7). `[]` can mean either no lineage or a compile without `--generate-info-schema` (cli-read r7 06). In both cases the panel shows "No column lineage yet" with a button that runs step 4's refresh.
- Never pass `--log-format`; use `--quiet` (cli-read r2).
- Unit tests with a fake command factory, using stdout captured from cli-read r1 and r3 as fixtures.
- Verify: `just check`.

### 4. Refresh lineage for the edited model (feat)

- On save of a model in a Declared Project, when the effective static analysis mode is `strict`, run `dbt compile -s +<model> --static-analysis strict --generate-info-schema` through the Fusion CLI integration. Debounce 1 s and coalesce per project; abort a stale run. `+<model>` is used because selecting the model alone left its lineage unchanged when a parent was not built (cli-select-state items 1–4).
- `-s +<model>` does not recompile a `select *` child, so that child keeps its old columns until it is compiled too (cli-select-state item 8). Do not add `<model>+` by default; measure it first (see open questions).
- The same command backs the panel's refresh button and a `fusionPowerUser.refreshColumnLineage` command.
- Report dbt1014 warnings from the compile output in the panel message; cli-select-state records the exact text.
- Progress goes to the existing Fusion status bar item. No toasts.
- Integration test on the step 2 fixture: edit a model, save, and assert the new column appears in `getConnectedColumns` (the E6 step 05 behaviour, through the product).
- Verify: `just check`, `just test-integration`.

### 5. Offer the schema-origin hook (feat, small)

- Command `fusionPowerUser.addSchemaOriginHook` shows the exact `dbt_project.yml` line from the fixture and inserts it only after the user confirms.
- The CLI runs in steps 3 and 4 set `FUSION_POWER_USER_SCHEMA_ORIGIN=local` only when the project contains the hook and every source column has a `data_type`; otherwise they leave it unset.
- Verify: `just check`.

## Open questions, each to be settled by a new experiment before code depends on it

- **Strict without authentication.** The docs say unauthenticated strict runs fall back to baseline; on this machine they did not (evidence README section 2). Before shipping, rerun m3 on a fresh machine and after the binary's trial window, and have steps 3 and 4 detect a fall-back: the dbt1000 "column types will not be populated" warning, or `[]` from `show --info` right after a strict compile. The panel then reports that strict is unavailable instead of "no lineage".
- **The view-contents rule after a selective compile** (cli-select-state "Not established"). Until it is known, step 3 treats a missing row as "not yet analysed", not "no lineage", and the panel's refresh button runs a full strict compile.
- **Cost on a real project with remote sources.** Measure `dbt compile -s +<model>` and `-s +<model>+` on the Consumer Repository before turning refresh-on-save on for remote sources.
- **Flakiness.** One experiment (s1b) gave different results in two of four runs. Rerun the experiments the plan depends on (c1, s1a, s1d, r1, r7, l6) several times before the step that relies on each one lands.
- **Language-server lineage.** No flag, env var, `initializationOptions` or command tried made the server write it (lsp-flags, lsp-protocol). A future Fusion release could change that; if one does, rerun lsp-flags and delete step 4's CLI compile.

## Out of scope

Documentation propagation, and column lineage for Dependency Projects.
