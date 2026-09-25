# Read column lineage from Fusion static analysis

**Status:** Decided 2026-09-25.

## Context

Column lineage and documentation propagation were removed because they depended on the native `@altimateai/altimate-core`, which the VSIX never shipped. Rebuilding them needs an engine that handles `SELECT *`, UNION, aggregates, joins and filters, and that runs without an account or a Python runtime.

We tested three routes on dbt-shaped queries. `openlineage-sql` compiles to WebAssembly but takes no schema, cannot expand `SELECT *`, treats UNION branches as separate outputs and drops `count(*)`. polyglot-sql and sqlglot in Pyodide would add a parser we maintain. dbt Fusion's strict static analysis handled every measured case: it expands `*`, matches UNION branches by position, and labels each edge `copy`, `mod` or `scan`, where `scan` marks join, filter and GROUP BY inputs. It ran without `dbt login`. The measurements are in [column-lineage-approaches.md](../research/column-lineage-approaches.md).

## Decision

The extension gets column lineage from Fusion and ships no SQL parser.

- **Compute.** After an edit, run `dbt compile -s <model> --static-analysis strict --generate-info-schema` for the edited model. Selection recomputes lineage for the selected nodes only and `DESCRIBE`s only their direct inputs.
- **Read.** Read lineage with `dbt show --info column_lineage --output json`, which serves the stored Parquet without compiling or querying the warehouse.
- **Schema origin.** Source schemas come from the warehouse by default. A project that wants YAML-declared source schemas sets one project-level line in `dbt_project.yml`, and the extension controls it per command through the named environment variable:

```yaml
sources:
  +schema_origin: "{{ env_var('FUSION_POWER_USER_SCHEMA_ORIGIN', 'remote') }}"
```

`schema_origin` applies to sources; model schemas are always inferred by the analyzer. The extension never edits `dbt_project.yml` on its own; it documents the line and may offer a command that adds it on request.

## Consequences

- Local schema origin needs Fusion 2.0.6 or later and a `data_type` on every source column. With every source local, analysis needs no warehouse. The repository pin moves from 2.0.5 to 2.0.6 when this lands.
- Remote schema origin needs warehouse access for the selected model's direct source inputs on each compile.
- In either mode, an unselected parent model is read from its built table with `DESCRIBE`; `schema_origin` does not cover models. The extension therefore selects `+<model>`, which analyses the parents from their SQL and, with local sources, needs no warehouse.
- The `info_schema/v1` column names already differ between Fusion builds. The extension reads them through one adapter, and an integration test pins the columns against the pinned Fusion binary.
- The analyzer is closed and the open crates are ELv2. The extension reads Fusion's output files; it does not copy Fusion code.
