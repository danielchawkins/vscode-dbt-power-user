# Column lineage approaches for a local-only dbt Fusion extension

Research date: 2026-09-25. Confidence labels: **High** (multiple primary sources agree), **Medium** (single primary source or indirect), **Low** (thin or contested), **Speculative** (reasoning beyond evidence). Unverified claims are marked.

## Summary

Almost every open-source tool that computes column lineage for dbt does it the same way. It takes the compiled SQL for each model, qualifies every column against a schema of upstream relations, builds a scope tree, and walks each output projection back to leaf columns. sqlglot is the dominant engine: DataHub, SQLMesh and Recce build on it directly, and OpenMetadata tries it first. The differences between tools come from three decisions: where schemas come from, what happens to `SELECT *` without a schema, and whether filter, join and group-by columns count as lineage. `@altimateai/altimate-core` is **not** a sqlglot wrapper. Altimate's own documentation describes it as a Rust napi-rs addon built on `sqlparser` and `polyglot-sql` (**High**, see below). dbt Fusion computes column lineage itself with `static_analysis: strict`. dbt's documentation says strict runs require `dbt login`, but Fusion 2.0.5 ran strict analysis locally without an account and wrote `dbt.column_lineage` and `dbt.node_columns` (tested, see [Measured results](#measured-results-2026-09-25)). It needs warehouse access instead: with the default remote schema origin it runs `DESCRIBE` on the sources each compile reads, and `-s <model>` limits that to the selected model's direct inputs. From Fusion 2.0.6, `schema_origin: local` takes source schemas from YAML and needs no warehouse.

## 1. Engines

### sqlglot (`sqlglot.lineage`, `optimizer.qualify`)

[`lineage()`](https://github.com/tobymao/sqlglot/blob/main/sqlglot/lineage.py) parses the SQL, optionally inlines `sources` (a name→SQL map) with `exp.expand`, then runs `qualify.qualify(..., schema=schema, validate_qualify_columns=False)` and `build_scope` before recursing with `to_node` (**High**). [`qualify`](https://github.com/tobymao/sqlglot/blob/main/sqlglot/optimizer/qualify.py) normalises identifiers per dialect, qualifies tables, expands stars (`expand_stars=True`), expands alias references and qualifies columns. It can `infer_schema` and `allow_partial_qualification` (**High**). The result is a tree of `Node(name, expression, source, downstream)`. Leaves are `exp.Table` sources, or `exp.Placeholder` when a source is unknown ("this column's lineage is unknown"). MIT licence, very active.

### sqllineage

[reata/sqllineage](https://github.com/reata/sqllineage) (MIT, release v1.5.9 three weeks before access) uses sqlfluff or sqlparse ASTs and a networkx graph. It does not use sqlglot. Without metadata it leaves wildcards unexpanded (`foo.* <- quux.*`) and cannot assign unqualified columns in joins (`foo.col4 <- col4`). With a SQLAlchemy `MetaDataProvider` it resolves both (**High**, README example).

### OpenLineage `openlineage-sql` (rejected)

Rust, Apache-2.0, built on `sqlparser = "=0.62.0"` ([Cargo.toml](https://github.com/OpenLineage/OpenLineage/blob/main/integration/sql/impl/Cargo.toml)), with Python and Java bindings. We rejected it after building version 1.54.0 to WebAssembly and running it from Node on dbt-shaped queries. Packaging is not the problem: the crate compiles unchanged to `wasm32-unknown-unknown` (1.84 MB, 545 KB gzipped, under 1 ms per query), so it would ship in the VSIX with no native binary. The limitations are in the lineage itself, and each was confirmed in its source and its own tests:

- **No schema input.** The only entry point is `parse_sql(sql, dialect, default_schema)`, and the Python binding exposes the same arguments. `SELECT *` therefore records only the table, never its columns.
- **UNION is not matched by position.** The visitor walks the left branch, then the right, so the second branch's columns become separate outputs. Its column-lineage tests contain no UNION case.
- **Aggregates are incomplete.** `sum(x)` links only to `x`, GROUP BY keys are never visited, and `count(*)` produces no output column at all.
- **No direct/indirect distinction.** The output is `ColumnLineage { descendant, lineage }` with no transformation type. JOIN and WHERE columns are not recorded, while CASE conditions and window partition/order keys are merged into the value inputs.
- **Dialects.** DuckDB is not listed; the generic dialect handled simple DuckDB casts.
- **Distribution.** The crate is not published to crates.io, so we would pin a git commit and own the WebAssembly build.

Fixing the first three would mean maintaining a fork of its visitor, which is more work than using dbt Fusion's own lineage.

### OpenLineage facet vocabulary

The [column lineage facet](https://openlineage.io/docs/spec/facets/dataset-facets/column_lineage_facet) defines `type` DIRECT (value derived from input) versus INDIRECT (input affects output but is not derived from it). DIRECT subtypes are `IDENTITY`, `TRANSFORMATION` and `AGGREGATION`. INDIRECT subtypes are `JOIN`, `GROUP_BY`, `FILTER`, `SORT`, `WINDOW` and `CONDITIONAL`, plus a `masking` flag. Indirect inputs can be attached to the whole dataset (the `dataset` array) instead of to every field. The spec recommends this because per-field indirect edges produce "almost a cartesian product" (**High**). This is the best available vocabulary for our edge types.

### DataHub `sqlglot_lineage`

[sqlglot_lineage.py](https://github.com/datahub-project/datahub/blob/master/metadata-ingestion/src/datahub/sql_parsing/sqlglot_lineage.py) runs `qualify` twice. The first pass qualifies tables only. The second pass qualifies columns with a `MappingSchema` built from DataHub's schema resolver, through a pruned rule set (`qualify`, `pushdown_projections`, `unnest_subqueries`, `quote_identifiers`). It notes that `normalize` and `pushdown_predicates` are left out for performance. It then calls `sqlglot.lineage.lineage` per output column (**High**). Other behaviour worth copying:

- Confidence: `0.9` when every table's schema resolved, otherwise `0.2 + 0.3 × resolved/discovered`.
- Unexpanded `*` is skipped: "If schema information is available, the * will be expanded… Otherwise, we can't process it."
- `ColumnTransformation.is_direct_copy` distinguishes copy from logic.
- `_list_joins` extracts join columns separately from projection lineage.
- Struct subfields (`col.a.b`) are recovered by rescanning `exp.Dot` parents.
- Snowflake uppercasing and dialect case-insensitivity are handled.
- A cooperative timeout protects against slow queries.

Referenced columns outside SELECT ("auxiliary / non-SELECT lineage") remain a TODO. Apache-2.0.

### SQLMesh

[sqlmesh/core/lineage.py](https://github.com/TobikoData/sqlmesh/blob/main/sqlmesh/core/lineage.py) renders the model query and runs `qualify` against the model's `mapping_schema` with `infer_schema=True`. It caches `(query, scope)` per model and delegates to `sqlglot.lineage` (**High**). SQLMesh propagates column types model to model from its own definitions and SQL-inferred schemas, so lineage rarely lacks a schema (**Medium**).

### dbt Explorer / Catalog and dbt Fusion

[dbt's CLL docs](https://docs.getdbt.com/docs/explore/column-level-lineage) say lineage "reflects the lineage from `select` statements… It doesn't reflect other usage like joins and filters". Lineage can be incomplete for JSON unpacking and lateral joins. Columns are labelled Passthrough, Rename or Transformed, and descriptions are inherited through passthrough and rename edges (**High**). The engine behind Catalog is not documented publicly (**Unverified**).

Locally, dbt Fusion (v2) exposes column lineage in three ways:

1. The dbt VS Code extension, which offers "Show column lineage" and `column:` selectors ([features](https://docs.getdbt.com/docs/dbt-extension-features)).
2. The `dbt.column_lineage` and `dbt.node_columns` Parquet tables in `target/info_schema/v1/`, produced by `dbt compile --generate-info-schema --static-analysis strict` ([info schema](https://docs.getdbt.com/docs/build/dbt-information-schema), [tables](https://docs.getdbt.com/reference/info-schema)).
3. `dbt show --info column_lineage`.

All three need `static_analysis: strict`. Baseline mode provides neither column lineage nor hover-over-`*` ([static analysis](https://docs.getdbt.com/docs/build/about-static-analysis)). The same page says: "Any run that uses `strict` mode requires authentication using `dbt login`… Unauthenticated runs fall back to `baseline`". That did not hold for Fusion 2.0.5 on a local DuckDB project with no account: strict analysis ran and wrote both tables (tested). Strict is also switched off for a model and all its descendants when a custom materialization is involved, and for any model whose source schema cannot be fetched. No public LSP command for column lineage was found (**Unverified**, gap in search).

### Measured results (2026-09-25)

Probe: dbt Fusion 2.0.5 and 2.0.6, DuckDB, no `dbt login`, `dbt compile --static-analysis strict --generate-info-schema`, in a throwaway project with declared and undeclared sources.

- **Remote source schemas come from the warehouse.** With the default `schema_origin: remote`, strict mode runs `DESCRIBE` on every source the compiled nodes read, on every compile, including when nothing changed. When a source table did not exist, Fusion warned `dbt1014 Failed to download source schema`, set static analysis to off for that model, and skipped it. `sync: schema_refresh_interval` (including `never`) reached the manifest but did not reduce `DESCRIBE` on either version.
- **Selectors scope the work.** `dbt compile -s <model>` recomputes lineage only for the selected nodes and leaves other rows untouched. It `DESCRIBE`s only the selected nodes' direct inputs: a model reading one source issued one `DESCRIBE`; a model reading three sources issued three. An unselected parent model is treated as a frontier and `DESCRIBE`d from its built table, in both remote and local mode: `schema_origin` covers sources only, and the parent's previously inferred schema is not reused. With every source local, `-s order_totals` still issued one `DESCRIBE` for its parent model, and with no warehouse it warned `dbt1014 Failed to download model schema`. `-s +order_totals` analysed the parent from its SQL and issued no `DESCRIBE`, with or without a warehouse.
- **Local source schemas come from YAML.** `schema_origin: local` is accepted under a source's `config:` block or as `sources: +schema_origin: local` in `dbt_project.yml`, from Fusion 2.0.6; the 2.0.5 binary does not contain the key. It is rejected directly on a source or table (`dbt1060 Ignored unexpected key`). Every column needs a `data_type`. With every source local, a compile issued no `DESCRIBE` and still produced correct lineage with the warehouse file deleted. A column declared only in YAML appeared in `select *` lineage under local and not under remote.
- **Per-command control.** `sources: +schema_origin: "{{ env_var('NAME', 'remote') }}"` switches per command: unset gave 3 `DESCRIBE`s, `local` gave 0, and an invalid value failed with `dbt1013 unknown variant`. No built-in variable or flag sets it: `--vars`, `DBT_SCHEMA_ORIGIN` and `DBT_SOURCE_SCHEMA_ORIGIN` had no effect, and `DBT_ENGINE_*` names are reserved by dbt.
- **Serving existing lineage.** `dbt show --info column_lineage --output json` reads the stored Parquet in about 0.4 s with no `DESCRIBE` and no compile.
- **`dbt.column_lineage.parquet`** has one row per edge: `parent_node_unique_id`, `parent_column_name`, `child_node_unique_id`, `child_column_name`, `evolution`, `ingested_at`. `evolution` is `copy` (value passed through, including renames), `mod` (value transformed) or `scan` (column read but not part of the value: join keys, filters, GROUP BY keys).
- **`dbt.node_columns.parquet`** has each node's output columns with `column_index`, `data_type_declared`, `data_type_inferred`, `data_type_actual`, plus description, tags and tests. Inferred types cover `select *` models.
- **Hard cases** on one model combining a CTE, JOIN, WHERE, CASE, a window and UNION ALL: UNION branches were matched by position; join and filter columns appeared as `scan` on every output column; `sum(amount)` was `mod` with the GROUP BY key as `scan`; `count(*)` linked only to the GROUP BY key; the CASE value input was `copy` and its condition `mod`; window partition and order keys were `mod`.
- **Internal state.** `target/private/metadata/compile/schemas/*.parquet` holds downloaded schemas, but the next compile still issues `DESCRIBE` for remote sources.
- **LSP in strict mode.** `dbt lsp --static-analysis strict` fetches source schemas itself and adds hovers that baseline lacks: `*` expands to a column/type/origin table, a column shows its type and upstream model, and `ref()` adds the referenced model's columns. Completion offered SQL functions in both modes and no column names. No command for column lineage is advertised.
- **Source.** The open `dbt-fusion` repository contains the interfaces, schema cache and Parquet writers, but the analyzer and column-lineage provider are closed (`crates/dbt-index-core/src/column_lineage.rs`). The planner is a DataFusion fork. The open crates are ELv2.

### OpenMetadata

[ingestion/lineage/parser.py](https://github.com/open-metadata/OpenMetadata/blob/main/ingestion/src/metadata/ingestion/lineage/parser.py) wraps `collate_sqllineage`, a fork of sqllineage. It tries `SqlGlotLineageAnalyzer`, then `SqlFluffLineageAnalyzer`, then `SqlParseLineageAnalyzer`, each under a 30 s timeout. It keeps only the first and last column of each lineage path. Joins are extracted separately with a sqlparse comparison scan (**High**). The file is licensed under the "Collate Community License", not Apache.

### Recce

[recce/util/cll.py](https://github.com/DataRecce/recce/blob/main/recce/util/cll.py) calls `qualify(expression, schema=schema)` and then iterates `traverse_scope`. It builds its own per-scope result instead of calling `sqlglot.lineage` (**High**). Each projection is classified as `source` (no column deps), `passthrough`, `renamed` or `derived`. Columns in JOIN, WHERE, GROUP BY, HAVING and ORDER BY become *model-to-column* dependencies (`m2c`) instead of per-column edges, which matches the OpenLineage dataset-level indirect pattern. Set operations merge branches and mark the result `derived`. PIVOT is handled, and UNPIVOT falls through. There is an optional SQLite cache keyed by node checksum and parent checksums.

### Altimate

Open-source [datapilot-cli](https://github.com/AltimateAI/datapilot-cli) pins `sqlglot[c]==30.11.0` for SQL insights (**High**). The upstream Power User extension's `dbtLineageService.ts` ([source](https://github.com/AltimateAI/vscode-dbt-power-user/blob/master/src/services/dbtLineageService.ts)) collects compiled SQL for the current model and one-hop models, plus warehouse columns for non-ephemeral parents ("auxiliary tables… for better sqlglot parsing"). It calls `computeColumnLineage` from `@altimateai/dbt-integration` (the local "sqlEngine") and falls back to the hosted `getColumnLevelLineage` API (**High**). The hosted API's engine is not public (**Unverified**).

`@altimateai/altimate-core` 0.7.0 is an Apache-2.0-labelled npm package. It contains per-platform napi optional dependencies and no source files ([registry](https://registry.npmjs.org/@altimateai/altimate-core/latest)), and its GitHub repository returns 404. Its `index.d.ts` exports `columnLineage(sql, dialect, schema, defaultDatabase, defaultSchema, depth)`, returning `lineage_type: 'direct'|'indirect'` and `lens_type: 'Original'|'Alias'|'Transformation'|'Not sure'|'Non select'`. It also exports `initSdk(apiKey, tenant, backendUrl, …, telemetry)` and `flushSdk()` ("Flush pending telemetry") ([types](https://unpkg.com/@altimateai/altimate-core@0.7.0/index.d.ts)).

Altimate's own [internal design note](https://github.com/AltimateAI/altimate-code/blob/main/docs/internal/deterministic-checks-engine-split.md) says the engine crates are "`altimate-core` (analysis), `altimate-core-bindings-common`, `altimate-core-node` (napi-rs), plus `polyglot-sql` for multi-dialect parse and transpile". It also describes rules that walk the `sqlparser` AST and cites `crates/altimate-core/src/lineage/complete.rs` in a private `altimate-core-internal` repository.

**Verdict: the sqlglot-wrapper hypothesis is refuted** (**High**). The package is Rust built on sqlparser-rs and polyglot-sql (a Rust reimplementation inspired by sqlglot), shipped closed-source. Its `lens_type` names match the Python-era `views_type` field the hosted API returned. That suggests the engine was ported from the earlier Python/sqlglot service (**Speculative**).

### polyglot-sql

[tobilg/polyglot](https://github.com/tobilg/polyglot) is Rust with a WASM build published on npm as [`@polyglot-sql/sdk`](https://github.com/tobilg/polyglot/blob/main/packages/sdk/README.md). It is MIT-licensed, supports more than 30 dialects including Snowflake, BigQuery, DuckDB and Databricks, and passes all 11,333 sqlglot fixture cases it runs. It exposes:

- `lineage` and `lineageWithSchema`, which trace through joins, CTEs and subqueries.
- `lineageAt(ordinal)`, for positional set-operation tracing.
- `outputColumnsWithSchema`, for schema-aware star expansion with an `ordinalComplete` flag.
- `analyzeQuery`, which returns `columnUses` with contexts such as join, filter, grouping, HAVING/QUALIFY, window keys and ordering.
- OpenLineage `columnLineage` facet generation.

Lineage nodes carry a `source_kind` (`table`, `cte`, `derived_table`, `virtual` for BigQuery `UNNEST`). It is very active (v0.13.0 released the day before access), but young (first release about seven months earlier) and mostly one maintainer (**High** for features, from the README; **Unverified** for accuracy on real dbt SQL).

## 2. Hard cases

| Case                         | sqlglot / DataHub / SQLMesh                                                                                      | Recce                              | sqllineage                             | openlineage-sql                                                                      | polyglot-sql                                                        | altimate-core (from types)                          | dbt Fusion                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Aggregation / GROUP BY       | Aggregate args become downstream leaves; GROUP BY keys are not edges (DataHub TODO)                              | Output `derived`; GROUP BY → `m2c` | Args as edges                          | Aggregate args only; GROUP BY keys never visited; `count(*)` output dropped (tested) | Projection edges plus `columnUses` grouping                         | `ColumnSource.aggregation`; `lineage_type` indirect | `sum(x)` is `mod`; GROUP BY key is `scan` on each output; `count(*)` links to the key (tested) |
| UNION positional             | `to_node` resolves the column index and recurses into each `set_operation_scopes` branch                         | Branches merged, `derived`         | Supported (**Unverified** detail)      | **Not supported**: each branch's columns become separate outputs (tested)            | `lineageAt` ordinal; UNION = value, EXCEPT/INTERSECT right = FILTER | `union` plan step                                   | Supported: branches matched by position (tested)                                               |
| CTE / subquery               | Scope recursion via `scope.sources`; `reference_node_name` records the CTE                                       | Scope map                          | Supported                              | Supported (tested)                                                                   | `source_kind` `cte` / `derived_table`                               | Supported                                           | Supported (tested)                                                                             |
| `SELECT *`                   | Expanded by `qualify` from schema; without a schema, a `Star` node links to every source                         | Needs schema                       | `t.*` edge unless metadata is provided | **Not supported**: no schema input, only the table is recorded (tested)              | `outputColumnsWithSchema`, `ordinalComplete`                        | `SELECT *` lowers confidence                        | Expanded from warehouse `DESCRIBE` of each source (tested)                                     |
| Window                       | Arguments and PARTITION/ORDER columns found via `find_all_in_scope(select, Column)`, so they become direct edges | `derived`                          | Supported                              | Partition and order keys merged into inputs (tested)                                 | `columnUses` window context                                         | `window_function` source                            | Partition and order keys are `mod` (tested)                                                    |
| CASE                         | All columns in CASE become direct edges (no CONDITIONAL split)                                                   | `derived`                          | Edges                                  | Condition merged into inputs (tested)                                                | Transform kind (**Unverified**)                                     | `expression`                                        | Value input `copy`, condition `mod` (tested)                                                   |
| JOIN / WHERE                 | Not in `lineage()`; DataHub `_list_joins` handles joins separately                                               | `m2c`                              | Not edges                              | Not edges (tested)                                                                   | `columnUses` join/filter                                            | `indirect` via `showIndirectEdges`                  | Join keys and filter columns are `scan` on every output (tested)                               |
| UNNEST / struct              | UDTF columns included; DataHub recovers `a.b` subfields                                                          | **Unverified**                     | Weak                                   | BigQuery UNNEST fixed recently                                                       | `virtual` source kind                                               | **Unverified**                                      | JSON unpacking may be incomplete                                                               |
| Ambiguous unqualified column | `qualify` needs schema; DataHub uses `allow_partial_qualification`                                               | `qualify` raises                   | Left unassigned                        | **Unverified**                                                                       | `E221` ambiguous error                                              | `AmbiguousColumn` error                             | Compile error in strict                                                                        |

Sources: sqlglot `lineage.py` (SetOperation branch, Star branch, UDTF branch), DataHub, Recce, sqllineage README and polyglot README, all linked above. OpenLineage row: its public struct carries no transform type (**Medium**).

The key observation is that sqlglot's `lineage()` treats every column referenced in a projection as a downstream dependency, including CASE predicates and window keys. It never looks at WHERE, JOIN or GROUP BY. Tools that need direct and indirect lineage separately either run their own scope walk (Recce) or add a pass for joins (DataHub). Nobody in the sample assigns the OpenLineage CONDITIONAL subtype from sqlglot output. Doing so needs a custom expression walk that separates CASE `WHEN` predicates from `THEN`/`ELSE` values (**Medium**).

## 3. Schema propagation across the DAG and behaviour without a catalog

Every schema-aware tool needs `{relation → {column → type}}` for each upstream. In dbt the options are:

- Warehouse introspection: Altimate's `getNodesWithDBColumns`, and dbt `catalog.json`.
- YAML-declared columns from the manifest.
- Propagation of *inferred output columns* downstream in topological order.

SQLMesh does the last natively (**Medium**). Recce caches per-node results keyed by parent checksums, so a node is recomputed only when it or its parents change. That is effectively a topologically ordered memoised walk (**High**). dbt Fusion's strict mode does the same thing internally: it builds a "full analyzed schema" per model, and "a model can't be stricter than its parents" because downstream analysis needs that schema (**High**).

A workable propagation for us:

1. Take seeds' and sources' columns from YAML or `catalog.json`.
2. For each model in topological order, qualify its compiled SQL against the accumulated schema.
3. Record the model's output column names (and types when known) as the schema for its children.

Without a catalog, behaviour degrades in predictable ways:

- `SELECT *` stays as a star edge (sqlglot, sqllineage) or is dropped (DataHub).
- Unqualified columns in multi-source scopes become unknown or placeholder leaves.
- Confidence falls (DataHub 0.2–0.5; Altimate's validation corpus attaches "No schema context provided — best-effort lineage only", [altimate-code experiments](https://github.com/AltimateAI/altimate-code/blob/main/experiments/lineage_validation/generate_lineage_queries.py)).

Propagation cannot recover source columns hidden behind `SELECT * FROM {{ source() }}` without a catalog. That is the one gap that needs warehouse metadata or YAML (**High**, a logical consequence of the above).

## 4. Options for a TypeScript extension without Python

| Option                                          | Licence                          | Maintenance                                        | Lineage capability                                                            | Cost / risk                                                                                                                                                                                                                                        |
| ----------------------------------------------- | -------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sqlglot in Pyodide (WASM CPython)               | MIT (sqlglot), MPL-2.0 (Pyodide) | Both very active                                   | Full reference behaviour                                                      | sqlglot is not in Pyodide's [built-in list](https://pyodide.org/en/stable/usage/packages-in-pyodide.html), but a pure-Python wheel installs through `micropip` (**Medium**). Adds a multi-MB runtime and cold-start delay (**Unverified** figures) |
| `@polyglot-sql/sdk` (WASM)                      | MIT                              | Very active, young, mostly one maintainer          | sqlglot-style lineage, schema, ordinals, `columnUses`, OpenLineage output     | Accuracy on real dbt SQL not verified; single WASM bundle with all dialects; WASM default parser depth is 32                                                                                                                                       |
| `openlineage-sql` compiled to WASM              | Apache-2.0                       | Active                                             | Rejected: no schema input, UNION and aggregates wrong, no edge types (tested) | Builds to WASM unchanged (1.84 MB); not on crates.io                                                                                                                                                                                               |
| Own walker over `sqlparser-rs` compiled to WASM | Apache-2.0                       | Active                                             | Whatever we write                                                             | Largest engineering cost; this is what Altimate built privately                                                                                                                                                                                    |
| `node-sql-parser` (PEG.js)                      | Apache-2.0                       | Moderate (last release eight months before access) | `columnList` only, no scope resolution; Snowflake "alpha"; no DuckDB          | Not a lineage engine ([repo](https://github.com/taozhi8833998/node-sql-parser))                                                                                                                                                                    |
| dbt Fusion `info_schema` / extension            | Fusion licence                   | Active                                             | Authoritative in strict                                                       | Needs warehouse access for source `DESCRIBE` on every strict compile; Parquet reader needed; `v1` format undocumented                                                                                                                              |

## Recommendation

Read column lineage from dbt Fusion's own strict static analysis; do not ship a SQL parser. The decision and its rationale are recorded in [ADR 0006](../adr/0006-column-lineage-from-fusion-static-analysis.md).

1. **Fusion strict analysis, scoped per model.** After an edit, run `dbt compile -s <model> --static-analysis strict --generate-info-schema`, then read lineage with `dbt show --info column_lineage --output json`. Fusion computes lineage with its own DataFusion-based analyzer, matches UNION branches by position, expands `SELECT *`, and labels edges `copy`, `mod` or `scan`. It needs no `dbt login`.
2. **Source schemas from YAML when requested.** Projects that set `sources: +schema_origin: "{{ env_var('<NAME>', 'remote') }}"` in `dbt_project.yml` let the extension choose, per command, between warehouse `DESCRIBE` and schemas declared in source YAML. Local mode needs Fusion 2.0.6 and a `data_type` on every source column; it then needs no warehouse.

polyglot-sql, sqlglot in Pyodide and `openlineage-sql` remain documented above as rejected or unevaluated alternatives. None matches Fusion's handling of the measured hard cases, and each would add a parser we maintain.

## Open questions

- The `info_schema/v1` column names differ between the 2.0.5 binary (`parent_*`, `child_*`, `evolution`) and the public source snapshot (`from_*`, `to_*`, `lineage_kind`). A contract test must pin the columns the extension reads.
- `sync: schema_refresh_interval` reaches the manifest but did not reduce `DESCRIBE` on 2.0.5 or 2.0.6. Revisit when Fusion documents it.
- Should CASE predicates be shown separately from value inputs? Fusion labels the condition `mod`, the same as a transformed value.
- The analyzer and lineage provider are closed; the open crates are ELv2. Reading Fusion's output files is fine; copying its code is not.
