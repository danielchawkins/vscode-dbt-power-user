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

### 5. Group an over-cap expansion by folder (Medium)

The first version of this note deferred grouping. The finance hub changed that: capping `normalize_timestamp`'s 350 children at 20 shows an arbitrary 20 with nothing to say what the rest are. What was built:

- **Key:** the node's full parent folder, relative to its package root. `11_sources/backend/backend_kikoff` and `13_staging/backend/backend_kikoff` are different groups; the label is the last folder name. A node outside the root package is keyed `package:folder`, and a node without a path by its resource type. On finance the folders split the hub into about 15 source-system groups, the largest with 88 members. Grouping by layer would give one group of 350, and no model sets `config.group`.
- **When:** only an expansion that would add more than `maxNeighbours` new nodes is grouped, and only its new neighbours; a neighbour already on the canvas stays an ordinary card. With `maxNeighbours: 0` nothing is grouped. Most expansions look as before, because 99% of nodes have 4 or fewer neighbours.
- **Drawing:** a closed group is one ordinary dagre node showing the label, the member count and the key, as [Dagster's asset graph](https://docs.dagster.io/guides/build/assets/metadata-and-tags/groups) collapses a group. A folder with one member is drawn as its card. No compound boxes: dagre lays out sub-flows wrongly when their members connect to nodes outside them ([React Flow layouting](https://reactflow.dev/learn/layouting/layouting)), which in lineage they always do.
- **Opening and closing:** opening a group draws its members as ordinary cards and adds a chip, `label drawn/total`, to the expanded card. The chip's close button returns the view to exactly what it was before the group opened. A group with more than `maxNeighbours` members opens to the first ones, by layer and then name, and the chip's `+K` draws the next batch, so no click draws an unbounded number of cards.
- **Edges:** a closed group draws one edge to the expanded card, and one to each other drawn card that any visible member has a data-flow pair with (from `tableEdges`), plus group-to-group edges between closed groups. No edge passes through a member that is not drawn, and members hidden with `meta.lineage.hidden` add none.
- **Persistence:** open groups are part of the panel's view state, so a file save or a rebuilt page reopens them.

### 6. Settings

Project conventions are VS Code settings, so a workspace can share them. The panel reads each one and never writes it:

| Setting                                       | Default     | Does                                                                      |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `fusionPowerUser.lineage.layer.tagPrefix`     | `"layer/"`  | the tag prefix the layer badge reads first                                |
| `fusionPowerUser.lineage.layer.inferFromPath` | `true`      | infer the layer from the folder and name prefix                           |
| `fusionPowerUser.lineage.maxNeighbours`       | `20`        | the expansion cap; `0` draws every neighbour                              |
| `fusionPowerUser.lineage.groupBy`             | `"folder"`  | `"none"` draws the first `maxNeighbours` cards and `+K` instead of groups |
| `fusionPowerUser.lineage.layout`              | `"layered"` | `"leftToRight"` places cards with the dagre left-to-right layout          |
| `fusionPowerUser.lineage.semanticZoom`        | `true`      | `false` keeps full cards at every zoom                                    |
| `fusionPowerUser.lineage.title`               | `"alias"`   | `"name"` titles cards by their `ref()` name                               |

`groupBy` is an enum so that `layer` or a tag prefix can be added later without renaming it. The hide list proposed here first became the `meta.lineage.hidden` marker below.

### 7. Semantic zoom and the title setting (Medium)

- **Semantic zoom.** Below 50% zoom, each card keeps the size it was laid out at, hides line 2, and makes its action row, group chips and columns invisible. The badge (20px) and title (26px, middle-shortened to 15 characters) grow so they stay readable. The hidden rows stay mounted, so edge handles stay put and nothing is laid out again; changing card sizes at the threshold would make dagre move every node. The expand buttons are too small to click at that zoom, so a click on a card opens its Details drawer instead of only selecting it. Group nodes follow the same rule.
- **Title.** Alternative B from section 2 is the `lineage.title` setting, a VS Code setting rather than a panel toggle, because whether a project aliases heavily is a convention its workspace shares. In `name` mode the title is the `ref()` name (`refName`, falling back to the label), and line 2 reads `database.schema.alias · materialization` when the alias differs from the name, so the relation stays complete without repeating the title. A source's line 2 and tooltip use its `identifier`.
- **Shorter cards** (moving the 28px actions row into header buttons) is still open; it changes click targets and keyboard access and needs its own pass.

### Accepted risk and follow-ups

- At a default expansion of 2 or more levels, `expandLevels` fetches each level's tables in parallel, so which tables a group gets can differ between two fresh draws of the same start node. Replaying a saved view is sequential, so a restored view is stable.
- Follow-ups: hide column edges while zoomed out; an overflow for a card with many group chips; open-group IDs longer than 200 characters are dropped from the view state, so that group comes back closed.

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

## Hidden nodes and schema shortening

A node is hidden when `meta.lineage.hidden: true` is set on it: a model, seed, snapshot, source table, function or exposure. Fusion may put a model's `meta` under `config`, so the marker is read from both. The node stays drawn, so an expansion that reaches it still shows it and that expansion's neighbours, but no table or column edge into or out of it is drawn, and it sits off to the side. The start node is never hidden. This replaces the `lineage.hiddenNodes` setting proposed in section 6: the marker sits on the node it applies to, so it travels with the project.

```yaml
models:
  - name: stg_audit_log
    meta:
      lineage:
        hidden: true
```

dbt's default `generate_schema_name` builds a custom schema as `<target schema>_<custom schema>`. When a node's schema ends with `_<config.schema>`, the card subtitle shows `database.<config.schema>`, so `DBT_DEV_DANIEL_COMMITMENT` with `schema: commitment` reads `DEV_FG.commitment`. The match ignores case, because Snowflake upper-cases names. A schema that does not end that way shows unchanged, and the tooltip always keeps the full `database.schema`. No setting controls either behaviour.

## Open questions

- Can the extension learn the active target schema and default database from Fusion? Without them, `<target_schema>_` cannot be stripped from schema names and "not the default database" cannot be judged.
