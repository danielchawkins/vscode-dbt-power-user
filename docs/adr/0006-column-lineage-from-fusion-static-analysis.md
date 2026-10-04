# Read column lineage from the Fusion language server

**Status:** Decided 2026-09-25. Amended 2026-09-28: the source moves from the CLI's info schema to the language server's `dbt.listNodes`.

## Context

Column lineage and documentation propagation were removed because they depended on the native `@altimateai/altimate-core`, which the VSIX never shipped. Rebuilding them needs an engine that handles `SELECT *`, UNION, aggregates, joins and filters, and that runs without an account or a Python runtime.

We tested three routes on dbt-shaped queries. `openlineage-sql` compiles to WebAssembly but takes no schema, cannot expand `SELECT *`, treats UNION branches as separate outputs and drops `count(*)`. polyglot-sql and sqlglot in Pyodide would add a parser we maintain. dbt Fusion's strict static analysis handled every measured case: it expands `*`, matches UNION branches by position, and labels each edge `copy`, `mod` or `scan`, where `scan` marks join, filter and GROUP BY inputs. It ran without `dbt login`. The measurements are in [column-lineage-approaches.md](../research/column-lineage-approaches.md).

The first version of this decision computed lineage with a CLI compile (`--static-analysis strict --generate-info-schema`) after each save and read the `column_lineage` info-schema view. That view narrows to the last compile's selection, so exploring after a save lost every model outside it (evidence README section 9). The official dbt extension does not use the CLI for lineage: it asks the running language server (section 10).

## Decision

The extension gets column lineage from the Fusion language server of the file's Declared Project and ships no SQL parser.

- **Column grain.** `workspace/executeCommand` `dbt.listNodes` with `["@<unique_id>", "+column:<unique_id>.<column>+"]`, sent for the node and column the panel shows and again whenever the user moves to another. The result's `nodes` carry `unique_id`, `name`, `node_name`, `parents` (column ids), `op` and `transformation_type`.
- **Model grain.** The same command with a `+<unique_id>+` selector.
- **Columns of a node.** `dbt.getCurrentNode` with the file's project-relative path.
- **Freshness.** The server answers from the saved project; whether it also reflects unsaved edits varied between runs. The panel re-requests after a save of a file in the project.
- **Static analysis.** Column lineage needs the client launched with `--static-analysis strict`; under `baseline` the server returns no column nodes. The panel says so and names `fusionPowerUser.staticAnalysis` instead of showing an empty graph.
- **Schema origin.** Sources come from the warehouse unless the project sets the documented `+schema_origin` line and the extension resolves local origin. The extension always sets `FUSION_POWER_USER_SCHEMA_ORIGIN` in the server's environment, `local` or `remote`, so the host's environment never decides. Source types are read from the manifest, so a hooked project's first launch is remote and the server restarts once with local origin after the first parse.

The CLI lineage compile, the `column_lineage` info-schema read, refresh on save and the "Refresh column lineage" command are removed.

## Consequences

- Lineage costs one request of about 30 ms per node shown, with no process spawn and no `target/` files (d7).
- Lineage is only as available as the language server: when the client is stopped or failed, the panel shows the client's state.
- With local origin and typed sources the server issued no `DESCRIBE` in either origin mode on the fixture (d7, both origins); warehouse behaviour with remote origin on a real warehouse is not established.
- `dbt.listNodes` with a lineage filter needs Fusion `2.0.0-preview.77` or later, below the extension's 2.0.6 floor, so no fallback path ships.
- The result shape is the server's, not a documented contract. One adapter maps it to the panel's types, and an integration test pins it against the pinned Fusion binary.
- The analyzer is closed and the open crates are ELv2. The extension sends protocol requests; it does not copy Fusion code.
