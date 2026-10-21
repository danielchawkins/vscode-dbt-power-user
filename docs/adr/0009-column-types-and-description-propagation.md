# Record column types and pull upstream descriptions through the documentation editor

**Status:** Decided 2026-10-20.

## Context

- YAML columns lack `data_type` and descriptions.
- The documentation editor's Sync with the Database showed the raw CLI error when the model was not built in the target.
- Passthrough columns repeat upstream descriptions by hand.
- `dbt.getCurrentNode` gives types only under strict static analysis ([ADR 0007](0007-project-metadata-and-previews-from-the-language-server.md)), and column lineage comes from `dbt.listNodes` ([ADR 0006](0006-column-lineage-from-fusion-static-analysis.md)).

A spike on the pinned Fusion 2.0.6 used a copy of `src/test/fixtures/native-editor` with an added `prod` output over the same DuckDB file. The model was built with `run --target prod -s +order_totals`, and its manifest was copied to `state/`. The inline describe query emitted `target.name`, `ref(m)|string` and the columns:

| Dev relation | Flags                                 | `ref(m)` as string                   | Columns         |
| ------------ | ------------------------------------- | ------------------------------------ | --------------- |
| missing      | `--no-defer`                          | `"probe"."main"."order_totals"`      | `[]`, no error  |
| missing      | `--defer --state state`               | `"probe"."prod"."order_totals"`      | 4 typed columns |
| present      | `--defer --state state`               | `"probe"."main"."order_totals"`      | 4               |
| present      | `--defer --state state --favor-state` | `"probe"."prod"."order_totals"`      | 4               |
| never built  | `--defer --state state`               | `"probe"."prod"."totals_downstream"` | `[]`            |

The spike gives four findings:

- On DuckDB a missing relation returns an empty list, not an error.
- `ref()` defers only when the dev relation is missing, unless `--favor-state` is set.
- `ref()|string` names the relation that answered.
- `target.name` resolves even when `fusionPowerUser.target` is unset.

## Decision

1. **Two commands and two buttons replace Sync.** `fusionPowerUser.recordColumnTypes` and `fusionPowerUser.pullUpstreamDescriptions` appear in the command palette and the model editor menu, and each has a button in the documentation editor. They replace the documentation editor's Sync with the Database (O1). The lineage panel's source Sync is unchanged.
2. **Describe order: target, then deferred, then inferred (D6).**
   - The first attempt passes `--no-defer` whatever the defer setting is, so a model missing in the target is reported as missing and prod types are never silently labelled as the target's.
   - The deferred attempt runs only when `deferState()` is on, with the configured `--defer --state [--favor-state]`. Unset or unusable defer counts as not configured, and the setting is named (O4).
   - Inferred types come from `dbt.getCurrentNode` and need strict static analysis.
   - A failed attempt is recorded and the chain goes on (O3). The full error goes to the log; the notice shows only its first line, never the raw error on its own. The notice follows D8.
3. **The source label comes from the describe query itself.** The query emits `target.name` and `ref(m)|string`, so the label names the relation that actually answered, for example prod under `--favor-state`.
4. **Diff and save.**
   - Fill, add and overwrite proposals, plus columns not found, are computed in host core against the draft over the YAML (D1, D2, D7).
   - YAML-only columns are reported and never removed.
   - An overwrite needs an explicit tick, which sets `replaceType` on the column so the save path replaces `data_type`.
5. **Descriptions use a copy-only walk.**
   - For each column in the editor with an empty description (O5), run one column-lineage request and follow parents only through nodes whose `op` is `copy`.
   - The first described ancestor gives the candidate. Agreeing branches give one proposal; differing branches let the user pick (D3).
   - The text is the rendered manifest description from the Parse Producer (O2), so `{{ doc() }}` references are not kept.
6. **Only Save writes.**
   - Proposal modules never import the YAML or file-writing modules, as enforced by dependency-cruiser's `column-proposals-never-write`.
   - Only `SaveDocumentation.tsx` may send `saveDocumentation`, as enforced by the ast-grep rule `tsx-save-only-from-save-button`.

## Consequences

- Fusion behaviour is verified only on Fusion 2.0.6 with DuckDB. Another adapter that raises for a missing relation becomes a failed attempt that falls through, and the integration tests fail loudly if a Fusion upgrade changes this.
- `op` is per node, not per edge, so a passthrough join key can propose its key's description. The join fixture pins this; if it misleads, the walk will exclude parents whose own node is `scan`.
- Rendered text loses `doc()` references.
- Inferred types and descriptions need strict static analysis, and the notice names `fusionPowerUser.staticAnalysis`.
- Pending proposals are lost when the page is rebuilt; accepted values survive in drafts.
- Record runs at most two CLI processes, and descriptions cost about one request per empty column.
- Inferred spellings such as `integer` against `int32` show up only as unticked overwrites.
