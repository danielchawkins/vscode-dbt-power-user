# Column lineage plan

> **Superseded** by [column-lineage-ship-plan.md](column-lineage-ship-plan.md), which is based on the consolidated [evidence README](../research/evidence/README.md). Step 1 below landed (PR #97); step 2's reader is being rewritten in place on PR #98 as ship-plan step 3. Kept for its history; do not implement from it.

This plan rebuilds column-level lineage on dbt Fusion's strict static analysis, as decided in [ADR 0006](../adr/0006-column-lineage-from-fusion-static-analysis.md). The measurements behind it are in [column-lineage-approaches.md](../research/column-lineage-approaches.md). Each step is one bookmark and pull request against `main`, landed per [implementation-dispatch.md](implementation-dispatch.md), and ends with `just check` green. Steps that touch packaging also pass `just package`; steps that touch Fusion behaviour also pass `just test-integration`.

The shipped extension stays tool-manager-neutral: it finds `dbt` through the executable setting or `PATH`, never through mise, and it never edits `dbt_project.yml` unless the user runs a command that asks it to.

## What Fusion provides

- **Compute.** `dbt compile -s <selector> --static-analysis strict --generate-info-schema` recomputes lineage only for the selected nodes. It `DESCRIBE`s only their direct inputs, unless those inputs are local sources.
- **Read.** `dbt show --info column_lineage --output json` returns every stored edge without compiling or querying the warehouse. In Fusion 2.0.5 and 2.0.6 each row has `parent_node_unique_id`, `parent_column_name`, `child_node_unique_id`, `child_column_name`, `evolution` and `ingested_at`. The JSON array is surrounded by log and summary lines on stdout.
- **Edge kinds.** `copy` means the value passes through, including renames. `mod` means the value is transformed; CASE conditions and window keys also get `mod`. `scan` means the column is read but is not part of the value: join keys, filters and GROUP BY keys.
- **Schema origin.** With `sources: +schema_origin: "{{ env_var('FUSION_POWER_USER_SCHEMA_ORIGIN', 'remote') }}"` in `dbt_project.yml`, the variable selects warehouse `DESCRIBE` or YAML-declared source schemas for each command. Local needs Fusion 2.0.6 or later and a `data_type` on every source column.

## What the lineage panel expects

The lineage webview uses the lineage component from `@altimateai/ui-components`. It still sends `getConnectedColumns`; the host currently answers with an empty result. The component consumes `ColumnLineage { source: [table, column]; target: [table, column]; type: string; viewsType?: ViewsTypes; viewsCode?: [string, string][] }` (`webview_panels/node_modules/@altimateai/ui-components/dist/components/lineage/types.d.ts`). It treats `type === "indirect"` as a non-select edge and anything else as direct. `ViewsTypes` is one of `Original`, `Alias`, `Transformation`, `Unchanged`, `Not sure` and `Non select`. The old host request carried `targets: [table, column][]`, `upstreamExpansion`, `currAnd1HopTables` and `selectedColumn`.

The mapping from Fusion edges is:

| `evolution`              | `type`     | `viewsType`      |
| ------------------------ | ---------- | ---------------- |
| `copy`, same column name | `direct`   | `Unchanged`      |
| `copy`, different name   | `direct`   | `Alias`          |
| `mod`                    | `direct`   | `Transformation` |
| `scan`                   | `indirect` | `Non select`     |

## Step 1: Pin Fusion 2.0.6

Move the repository pin from 2.0.5 to 2.0.6 so integration tests can exercise local schema origin. This is tooling context only; the product still supports 2.0.5 and later.

- `mise.toml` and `mise.lock`: `aqua:getdbt.com/dbt-fusion` to 2.0.6.
- `src/test/integration/s7TargetMutationCapture.test.ts` and any other test that asserts the Fusion version string.
- Leave `MINIMUM_FUSION` in `src/fusion/fusionExecutable.ts`, and the "2.0.5 and later" statements in `AGENTS.md`, `README.md` and ADR 0001, unchanged. Column lineage degrades on 2.0.5 as step 3 describes.
- Verify: `just check`, `just test-integration`, and the smoke on both hosts.

## Step 2: Lineage reader

A pure module that turns `dbt show --info column_lineage --output json` stdout into typed edges. It isolates every Fusion column name in one place.

- New `src/fusion/columnLineage.ts`:

```ts
export type LineageEvolution = "copy" | "mod" | "scan";
export interface ColumnEdge {
  parent: { uniqueId: string; column: string };
  child: { uniqueId: string; column: string };
  evolution: LineageEvolution;
  ingestedAt: string;
}
export function parseColumnLineage(stdout: string): ColumnEdge[];
export function toPanelLineage(edges: ColumnEdge[], nodeTable: (uniqueId: string) => string | undefined): ColumnLineage[];
```

- `parseColumnLineage` extracts the JSON array from mixed stdout and accepts both the `parent_*`/`child_*`/`evolution` and the `from_*`/`to_*`/`lineage_kind` column sets. Rows of unknown shape are dropped and reported once through `DBTTerminal`.
- `toPanelLineage` applies the mapping table above and resolves unique IDs to the table keys the panel uses. `ColumnLineage` is defined locally with the component's shape; the extension host does not import the webview package.
- Unit tests in `src/test/suite/columnLineage.test.ts`: both column sets, surrounding log lines, empty output, unknown `evolution`, and each mapping row.

## Step 3: Lineage runner

Runs the two Fusion commands for one Declared Project, per ADR 0003, and never for a Dependency Project.

- New `src/fusion/columnLineageRunner.ts`:

```ts
export type SchemaOrigin = "remote" | "local";
export interface LineageRunOptions { selector: string; schemaOrigin: SchemaOrigin; signal?: AbortSignal }
export interface LineageRunResult { edges: ColumnEdge[]; warnings: string[]; analyzed: boolean }
export class ColumnLineageRunner {
  refresh(options: LineageRunOptions): Promise<LineageRunResult>; // compile -s, then show --info
  read(signal?: AbortSignal): Promise<ColumnEdge[]>;              // show --info only
}
```

- It builds both commands through the Fusion CLI integration, so `--profiles-dir` and the executable setting apply as for every other command. Per-command environment goes through the existing `envVars` parameter of `CommandProcessExecutionFactory.createCommandProcessExecution`. Add an optional `env` field to `DBTCommand` and merge it there, rather than mutating `process.env`.
- `FUSION_POWER_USER_SCHEMA_ORIGIN` is set only when the resolved schema origin is `local`. When it is unset, a project without the hook behaves exactly as today.
- `refresh` collects `dbt1014` warnings from compile output ("Failed to download source schema" or "model schema"). If a selected node was skipped, it returns `analyzed: false` with the warning text instead of failing silently.
- If the resolved Fusion version is below 2.0.6 and local is requested, `refresh` runs with remote and adds a warning. Version detection already exists in `src/fusion/fusionExecutable.ts`.
- Concurrency: one in-flight `refresh` per project. A newer request aborts the older one through its `AbortSignal`, which the command execution already honours.
- Unit tests with a fake command factory: argument lists, environment, the version fallback, `dbt1014` parsing and cancellation.

## Step 4: Settings

- `fusionPowerUser.columnLineage.schemaOrigin`: `"remote" | "local"`, default `"remote"`, resource scope, so each workspace folder can choose.
- `fusionPowerUser.columnLineage.refreshOnSave`: boolean, default `true`.
- Contribute both in `package.json`, and document them in `docs/settings-migration.md` next to the removed `showSelectEdges`/`showNonSelectEdges`.
- Command `fusionPowerUser.columnLineage.addSchemaOriginHook`: shows the exact `dbt_project.yml` line and inserts it only after the user confirms. It is never run automatically.

## Step 5: Service and panel

Reconnect the panel's `getConnectedColumns` request to the runner.

- `src/services/dbtLineageService.ts` gains:

```ts
getConnectedColumns(request: {
  targets: [string, string][];
  upstreamExpansion: boolean;
  currAnd1HopTables: string[];
  selectedColumn: { name: string; table: string };
}): Promise<{ column_lineage: ColumnLineage[] }>;
```

- It reads the cached edges for the project from the runner, running `read()` on first use. It then walks one hop from `targets` in the requested direction and returns `toPanelLineage` output. The per-project edge cache is invalidated when `refresh` completes.
- `src/webview_provider/newLineagePanel.ts` replaces its empty `getConnectedColumns` answer with the service call. When lineage is missing, it keeps the component's "No lineage found" state and posts a one-line explanation, such as "Run strict analysis for this model", with a button that triggers `refresh` for the model.
- Restore the column edge visibility toggles only if the component still sends them. Otherwise leave the removed settings removed.
- Unit tests in `src/test/suite/dbtLineageService.test.ts` and `newLineagePanel.test.ts`: one-hop upstream and downstream, both edge types, and the missing-lineage message.

## Step 6: Refresh after edits

- When a model file is saved and `refreshOnSave` is on, call `refresh({ selector: "+<model>" })` for its Declared Project. Debounce saves by 1 s and coalesce them per project. `+<model>` includes the model's parents so they are analyzed, not `DESCRIBE`d.
- Use the existing Declared Project resolution to map a document to its project and model, and ignore files outside Declared Projects.
- Report progress in the status bar item the extension already uses for Fusion work. Show no notification toasts, per the existing notification rules.
- Unit tests with fake timers: debounce, coalescing, and aborting a stale refresh.

## Step 7: Fixture and integration test

- New fixture `src/test/fixtures/column-lineage/` with DuckDB sources and typed columns in source YAML. The `dbt_project.yml` contains the `FUSION_POWER_USER_SCHEMA_ORIGIN` hook. Models cover `select *`, UNION ALL, JOIN with WHERE, GROUP BY with `count(*)`, CASE, and a window function.
- `src/test/integration/columnLineage.test.ts` runs against the pinned binary found on `PATH`:
  - **Local origin:** `refresh` with `schemaOrigin: "local"` produces edges with no warehouse file present, and the edge set and `evolution` values match a checked-in expectation.
  - **Column contract:** it asserts the raw column names `dbt show --info column_lineage` returns, so a Fusion upgrade that renames them fails here first.
  - **Remote origin:** with remote and a missing source table, `analyzed` is `false` and the warning names `dbt1014`.
- Verify: `just test-integration`.

## Step 8: Strict analysis for the language server (optional)

Strict analysis for the language server adds hovers that expand `*` into columns and types, show a column's type and origin, and list a `ref()` target's columns. The language server then `DESCRIBE`s remote sources itself. Offer it through the existing static analysis setting in `src/fusion/staticAnalysisMode.ts` rather than changing the default. Record the hover difference in `docs/refactor/s10-static-analysis.md`.

## Step 9: Documentation propagation

Rebuild propagating column descriptions downstream on the same edges. Only `copy` edges carry a description unchanged; `mod` edges are offered for review, not propagated automatically. The removed UI, `DocumentationPropagation.tsx`, is recoverable from the removal revision. Plan this step in detail after step 5 lands.

## Risks and measurements

- **Output format.** The `info_schema/v1` column names already differ between builds. The step 2 adapter and the step 7 contract test contain this.
- **Cost of `refresh` on real projects.** Measure compile time for `-s +<model>` on a large project with remote sources before making refresh-on-save the default for remote.
- **Undocumented `show --info` output.** The JSON framing on stdout is not documented. The step 2 parser must tolerate added log lines.
- **`schema_refresh_interval`.** It did not reduce `DESCRIBE` in 2.0.5 or 2.0.6, so the plan does not rely on it.
- **Unselected parent models are always read from the warehouse.** `schema_origin` covers sources only. In both modes, an unselected parent model is `DESCRIBE`d from its built table, even when its schema was already inferred by an earlier compile. With no warehouse, or an unbuilt parent, the selected model is skipped with `dbt1014`. Selecting `+<model>` analyses the parents instead, and with local sources that compile needs no warehouse at all.
