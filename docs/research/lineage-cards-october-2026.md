# Lineage cards: telling nodes apart without crowding

Research date: 2026-10-17, for issue #298. The full research run (thesis, antithesis and synthesis, every citation checked against its source, none rejected) is in the `research` workspace at `docs/research/lineage-card-design-298.md`. This note records what to build and why. Confidence: **High**, **Medium**, **Low**.

## The problem

A model card's title is its alias, and a source card's title is its table name. Neither is unique, so two cards can read the same. The card also does not say which layer a node belongs to, and a node connected to nearly everything (a function every base model calls, a widely used source) floods the graph when expanded.

dbt rejects two resources with the same database representation ([custom aliases](https://docs.getdbt.com/docs/build/custom-aliases)), so two nodes with the same alias always differ in schema or database. Showing the schema on every card therefore tells any two models apart, with no need to compare them with their neighbours (**High**).

## Decisions

### 1. Fix the two lineage bugs first (High)

- **Diamond edges.** The panel drew an edge only when an expansion had fetched it, so in a diamond A→B→C plus A→C the shortcut was missing. The host now answers `tableEdges({ tables })` with every data-flow pair among the drawn tables, leaving out foreign-key-only edges as the expanders do. The panel keeps them in a `links` store that draws edges between drawn tables but never makes a table drawn, so collapsing still removes what only an expansion added.
- **Collapse during a load.** A click on an expander that was still loading started a second fetch. `expand()` now marks the key pending until the fetch settles (in a `finally`, so a failed fetch cannot leave it stuck), and a click on a pending expander cancels it, as a click on an open one closes it.

### 2. Card layout A: alias, then a stable second line (Medium)

- **Line 1:** the badge (the layer when known, otherwise the resource type), the alias in 13px weight 600 on one line, and the warning icon.
- **Line 2,** 11px in `descriptionForeground`: `database.schema` (see the measurements below for why the database is always shown); then the materialization; then the package, only when it is not the root project. Nodes without a relation (ephemeral models, tests, macros, functions) keep `materialization · package`.
- **Truncation:** the title gets a middle ellipsis computed in script, because dbt names such as `stg_<source>__<entity>` carry what tells them apart at the end, and CSS `text-overflow` can only cut the end. Line 2 is cut at the end, with the schema first so it survives.
- **Tooltip:** the unique ID, the ref name when it differs from the alias, and the full relation.
- **Why not show the schema only on a collision:** the card would change when an unrelated node is expanded. A line that never depends on the neighbours is easier to scan.
- **Why not `schema.alias`:** the alias is already the title, so the line would repeat it.
- **Alternative B,** the ref name as the title with `schema.alias` below, is kept as a view setting for projects that alias heavily.

The display line is built from the separate `database`, `schema` and alias (or source `identifier`) fields, never by parsing `relation_name`, which carries adapter-specific quoting.

### 3. The layer badge, inferred first (Medium)

Resolve a node's layer from, in order: a tag with the configured prefix (`layer/` by default), the folder in its path (`staging`, `intermediate`, `marts`), then its name prefix (`stg_`, `int_`, `fct_`/`dim_`). This is how [dbt Catalog](https://docs.getdbt.com/docs/explore/explore-projects) infers the layer. It needs no tags, so the badge can ship before tags are read.

### 4. Hub nodes: cap expansions, never hide silently (Medium; the number is a guess)

- **Expansion cap:** an expansion that would add more than `maxNeighbours` nodes (default 20) draws the first 20, ordered by layer and then name, plus a "+K more" marker that draws the next batch. Every node stays reachable, so the cap can be on by default. [DataHub](https://datahubproject.io/docs/features/feature-guides/lineage) similarly shows the neighbour count on the expand button and limits expansion to keep the view simple.
- **Hide list:** an opt-in list of unique-ID globs leaves matching nodes out of expansions and shows their count on the neighbour's expander.
- **No bridge edges:** no edge is drawn through a hidden node, because that would invent a data-flow pair.

### 5. Defer grouping (Medium)

This panel draws a neighbourhood that grows by expansion, not a whole-project graph like [Dagster's asset graph](https://docs.dagster.io/guides/build/assets/metadata-and-tags/groups), so a group would usually hold only a few drawn nodes. If grouping is built later, copy Dagster's collapse-to-a-node model: a collapsed group is one ordinary node with a member count and aggregated edges. Avoid compound boxes: dagre lays out sub-flows wrongly when their members connect to nodes outside them ([React Flow layouting](https://reactflow.dev/learn/layouting/layouting)), which always happens across packages.

### 6. Settings

Project conventions are VS Code settings, so a workspace can share them: `fusionPowerUser.lineage.layer.tagPrefix` (`"layer/"`), `lineage.layer.inferFromPath` (`true`), `lineage.maxNeighbours` (`20`, `0` for no cap) and `lineage.hiddenNodes` (`[]`). View preferences join the lineage settings stored in global state and toggled from the panel menu, as the existing ones are: `title` (`"alias"` or `"name"`). With these defaults the schema line, the layer badge and the cap are on, and the hide list is off.

### 7. Later, after layout A (Low)

- **Shorter cards:** move the 28px actions row (a third of every collapsed card) into header buttons and a toolbar shown on hover or selection.
- **Semantic zoom:** below about half zoom, hide line 2.

Both change click targets and keyboard access, so they need their own pass with the panel's click and visual tests.

## New data

- **Lineage tables:** `name` (the ref name), `database`, `schema` and `identifier` (the model alias or the source identifier), plus the file path for layer inference.
- **Sources:** the source parser currently keys groups by `source_name` alone and keeps one database and schema per group, from the first table it meets. It needs per-table database, schema and identifier, looked up by unique ID, before the schema line is right for sources.
- **Tags and `group`:** cheap to read from the node parser, but whether Fusion's manifest fills them is unverified, so they wait on a check.

## Measured on a real project

The `finance_general` manifest Fusion 2.0.8 wrote (694 models, 2,366 source tables) settled three of the open points:

- **Collisions are common.** 28 aliases are shared by two or more nodes, for example `ach_payments__log` and `card_payments__log`.
- **The database carries the layer.** Models land in `DEV_FINANCE_GENERAL_STAGING`, `DEV_FINANCE_GENERAL_INTERMEDIATE` or `DEV_FINANCE_GENERAL`, each with a short custom schema such as `dispute`. "Database only when it differs from the default" would hide the part that tells layers apart, so line 2 always shows `database.schema`, cut at the start of the database when it is too long.
- **One hub dominates.** `function.foundation.normalize_timestamp` has 350 children; the next node has 7, and 99% of nodes have 4 or fewer. A cap of 20 leaves ordinary nodes alone and stops that one from flooding the graph.
- Fusion fills node `tags` (350 models carry `source_system/<name>`) and per-table source `database`, `schema` and `identifier`. No model sets `config.group`.

## Open questions

- Can the extension learn the active target schema and default database from Fusion? Without them, `<target_schema>_` cannot be stripped from schema names and "not the default database" cannot be judged.
