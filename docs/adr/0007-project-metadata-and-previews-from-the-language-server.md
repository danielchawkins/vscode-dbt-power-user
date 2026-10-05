# Take project metadata and previews from the language server

**Status:** Decided 2026-10-05.

## Context

ADR 0002 makes the Fusion language server authoritative for editor intelligence and allows artifacts only where the protocol lacks data. Project metadata (node set, graph, depth) and previews (compiled SQL, columns, CTE lenses) still came from `dbt parse` and `manifest.json`, read by parsers and published through `ProjectMetadataSource`. Experiments against dbt Fusion 2.0.6 ([`lsp-adoption-experiments-october-2026.md`](../research/lsp-adoption-experiments-october-2026.md)) show which fields the server returns at project grain and which it does not ([`lsp-metadata-gaps.md`](../lsp-metadata-gaps.md)).

## Decision

**One consumer seam (D8).** `Projects.onDidChangeManifest` stays the only consumer seam. `ProjectMetadataSource` gets a composite producer, `CompositeMetadataSource`, which owns two producers and publishes one merged `Manifest` per Declared Project. Consumers never know which producer filled a field.

- **Server Producer** (`ServerMetadataSource`): `dbt.listNodes ["+package:<root>"]` plus `dbt.getProjectInfo`, single-flight. It refreshes when the graph is stale: a source file changed, the Fusion Client started or returned to running, or the last fetch failed; then on the next `dbt/lspCompileComplete`. The server compiles for each `dbt.listNodes` and reports it twice (`dbt/lspCompileComplete` about 16 ms after the request, `dbt/lspBackgroundCompileComplete` about 1.3 s after, both with `cause: didSave`; see the adoption note), so refreshing on every report would loop without end. A fetch clears the stale flag when it starts, so its own reports start nothing however late they arrive, and a source change that arrives during a fetch schedules exactly one more. When the client leaves `running` the producer drops its value and publishes once with an empty server graph. It publishes nothing when the node list hash is unchanged.
- **Parse Producer** (`ManifestMetadataSource`): `dbt parse` and `manifest.json`, for the fields in `lsp-metadata-gaps.md`: descriptions, columns, tags, meta, relation names, `patch_path`, raw and compiled SQL, generic tests, metrics, macros, doc blocks, semantic models, source YAML metadata, unit-test and function metadata beyond identity, and the `constraint` overlay.
- **Field ownership.** `FIELD_OWNERS` (`src/core/metadata/fieldOwners.ts`) names the owner of each manifest field, and the `MERGE_POLICY` table beside it is the only place that lists the server-owned resource types and how the merge treats each (replaced, added, keyed in `parents`); `mergeMetadata` derives its sets from that table, and a parity test checks `FIELD_OWNERS` against `lsp-metadata-gaps.md`. The server owns the node set and, per node, `unique_id`, name, resource type, package, `original_file_path`, materialization, access and group; `graphMetaMap.parents` and `.children` inverted from `depends_on`; `modelDepthMap`; and the project name. The adapter type stays with the parse (`manifest.json` metadata), as does the constraint overlay on `parents`. The graph fields stay server-owned in `baseline` (E8).
- **Merge.** Where the server has a value, its node set is authoritative for `model`, `seed`, `snapshot`, `source`, `exposure`, singular `test`, `unit_test` and `function` (E1), limited to the root package: `+package:<root>` lists the root package and its ancestors only, so a parse node of another package is never dropped. A node added since the last parse appears with empty parse fields; a root-package node the server no longer lists is dropped. Kinds the server does not list (`analysis`) keep their parse edges. A `depends_on` endpoint outside the set takes its identity from the parse or becomes a placeholder labelled with its `unique_id`. With no server value, server-owned fields are empty and the UI shows the client state.
- **Freshness.** One event per project per producer update, each carrying a coherent merged value.
- **Migration rule.** On each Fusion upgrade, re-run the spike harness and commit a capabilities note. A field moves from parse to server when the new version returns it for every node of its kind in one request on both captured projects. Each move is one revision changing its `FIELD_OWNERS` entry, the `MERGE_POLICY` row of any resource type it affects, the server adapter, the merge golden test and its row in `lsp-metadata-gaps.md`.
- **Target state.** When no parse-owned field remains, the Parse Producer, the parse half of `ManifestTrigger`, `src/core/manifest/*Parser.ts` and the composite are deleted. The configuration-error check in `ProjectErrors` stays outside the port.

**Routing.**

- **Table lineage and model trees** read the merged value (D8).
- **Column lineage** stays on `dbt.listNodes` (ADR 0006).
- **Compiled preview** reads `dbt.compileFile` output of the last save and its returned path verbatim (E9). A dirty document shows a stale marker (D5); an untitled one uses `dbt compile --inline` when the user runs the preview command. The server runs unsaved text but returns no compiled SQL for it (E3).
- **Columns of a model** come from `dbt.getCurrentNode`. When the Fusion Client is not running, `Project.getColumnsOfModel` falls back to the CLI introspection (D10) and the UI shows the client's state and **Show output**.
- **CTE lenses** come from the server, matched on the bare command `dbt.previewCte` (E5). A document with unsaved edits shows none until save (D2).
- **Query preview, distinct values, CTE profiling and the column introspection fallback** stay on the dbt CLI (`dbt show --inline`, a separate process) (D10). One `dbt.show` held up `listNodes` for 10.5 s on a 330-model Snowflake project, and `$/cancelRequest` does not stop the warehouse query; killing the CLI process does.
- **`dbt parse` runs** on activation, on a snapshot revision, on a change to `dbt_project.yml`, `profiles.yml`, `packages.yml`, `dependencies.yml` or `selectors.yml`, and after a debounced source-file watcher event only while a parse-field consumer is visible; a change while none is visible marks the parse stale, and the next consumer to appear triggers one parse (D3). A compile notification never starts a parse: watcher events are the signal because they also cover files the server does not compile, and a parse per compile would double every save.

## Consequences

- Consumers are unchanged; the port gains a producer, and the parse graph parsers are deleted once lineage and trees read the merged value.
- A model added or an edge changed appears without a `dbt parse` spawn.
- Fields in `lsp-metadata-gaps.md` still cost a parse; a visible consumer can see two publications after a compile, each coherent.
- Features depend on the client: when it is stopped or failed, server-owned fields are empty and the UI says why.
- `FusionCommands` gives one typed façade over the server commands, with a 5 s deadline for `compileFile`, `getCurrentNode` and `listNodes`, and none for commands that run SQL.
- The result shapes are the server's, not a documented contract. Integration tests pin them against the pinned binary.
