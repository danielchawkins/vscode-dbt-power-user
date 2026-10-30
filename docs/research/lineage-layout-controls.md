# Research

## Question

How do existing graph layout engines and lineage or DAG viewers let users control layout and visibility, and which of those controls actually help a reader understand a large layered dependency graph? Survey and catalogue: (a) layout engine options exposed as user settings (ELK layered options such as nodePlacement strategy, crossingMinimization, layering strategy, considerModelOrder, spacing, edge routing, compaction, wrapping; Graphviz dot attributes such as rank constraints, group, weight, minlen, concentrate, newrank, nslimit/mclimit; dagre/d3-dag/MSAGL equivalents) and what each does to the drawing; (b) visibility and focus controls in lineage/DAG UIs: hide or filter node types and tags, depth limits, upstream/downstream focus, collapse/expand groups, collapsing or de-emphasising high-degree hub nodes, edge filtering and bundling, transitive reduction, path highlighting, search-and-focus, pinning, saved views; (c) how these are presented interactively (live sliders vs apply buttons, presets, per-view vs global, undo), and which must relayout versus only restyle; (d) evidence on what maximises the information a reader takes in: perception and graph-drawing research on crossings, edge length, bends, aspect ratio, node grouping, edge bundling, overview-plus-detail, focus+context, degree-of-interest functions (Furnas; van Ham and Perer 'Search, Show Context, Expand on Demand'), semantic zoom, and studies of lineage/DAG tool usability. For each control give: what it is, where it is implemented (repository path or documentation URL), whether it changes layout or only rendering, its cost, and whether the evidence says it helps. End with a recommended set of panel controls for this extension, grouped (layout, visibility, emphasis, presets), with defaults and which ones are safe for live adjustment.

## Recommendation

Make scope the main control, then emphasis, and keep layout settings few and preset-driven. The strongest evidence is that crossings matter most and bends less (Purchase). Next is the argument that focus beats whole-graph overview for targeted tasks (van Ham and Perer, shown by demonstration rather than a user study). The repo's own measurements show strict layer bands and unhinted relayouts are costly. Visibility controls, which need a new layout and should be debounced or applied on release: separate upstream and downstream depth around the focus (default 2/2), a card budget filled by degree of interest (default about 150), filters by node type and tag, hide this card, a degree-ranked list of hubs and utility nodes with three treatments, a folder-grouping threshold (keep the current neighbour cap), and transitive reduction (default off, removed edges shown as dim hints). Emphasis controls, which only restyle and are safe live: path highlight, dimming everything off the focus or hover path, hub de-emphasis, opacity and visibility for relationship and column edges, column trace, and a live hub-threshold preview. Layout controls, which need a new layout with hints and stability on: effort (fast while interacting, balanced on settle, thorough applied by the user), partitions (soft default, none, strict labelled costly), relationship-edge weight with a 'constraint only' (`routed: false`) option (default ranks false, weight 1, as now), column-edge weight (default 0.5, as now), a spacing preset (compact or default), and stability on expansion (default on, weight 1). Presets: named and stored per view, with a global default, undo for each change, and a metrics readout (crossings, bends, density) beside each preset. Leave bundling and concentrate out, or behind an off-by-default flag, because bundles can show dependencies that do not exist. Treat wrapping, for the 55:1 aspect ratio, as later engine work. All numeric defaults are starting points to measure on real projects; none comes from a lineage usability study.

## Points

| Point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Verdict    | Confidence |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| 1. The engine keeps no state between calls, so any setting that changes the graph or the layout options means a new call to `layout`. Purely visual settings do not. But that call does not have to throw the old layout away. Passing the previous result back as `hints`, weighted by `stability`, holds the layout steady. The repo's spike measured this over 20 expansions on a 300-node graph: hints cut the mean displacement of retained cards from 134 px to 39 px per step, and rank changes from 24 to 1. Measured layout times are 24–190 ms for 300 nodes and 173 ms for 600 nodes with columns and relationships, unpartitioned. The spike notes that absolute times vary up to fourfold under machine load. So a debounced live slider is feasible for scope or emphasis changes at fast or balanced effort. It is not obviously feasible for full-project layouts of 1,000+ models, which were not measured. | middle     | high       |
| 2. The engine exposes only some of the ELK and Graphviz knobs. They are: `effort` (fast, balanced or thorough), spacing, `partitions` (none, soft or strict), `stability`, `seed`, `anchor`, `ranks` (rows or levels), and a policy per edge kind. The edge-kind policy sets `ranks`, `minLength` (Graphviz minlen), `weight` (Graphviz weight) and `routed` (`false` gives a pure layout constraint, i.e. the owner's 'soft attraction'). The engine has no wrapping, no post-compaction, no considerModelOrder equivalent, no selectable layering or placement algorithm, and no Graphviz `group` equivalent. The lineage adapter currently hard-codes these settings: soft partitions, the focus card as anchor, column edges at weight 0.5 that do not rank, and relationship edges that do not rank at weight 1. The package README says the partitions setting is not yet wired to the panel.                          | antithesis | high       |
| 3. ELK's considerModelOrder keeps the input order of nodes and edges where doing so adds no crossings. Its default is NONE. It takes four values: NONE, NODES_AND_EDGES, PREFER_EDGES and PREFER_NODES. It is a predictability control rather than a clarity control. It lets a user-meaningful order (alphabetical, by folder) survive the layout. The repo engine has no equivalent. Its hints and `seed` partly cover the same need.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | middle     | high       |
| 4. ELK layered defaults: layering is network simplex, crossing minimisation is layer sweep, node placement is Brandes–Köpf, and wrapping is off. Post-compaction is a separate option (I read that it exists, not its default). The repo engine uses the same family of algorithms: network simplex ranking with weights and minimum lengths. Making the algorithm itself user-selectable adds little. A small effort ladder is the right control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | antithesis | high       |
| 5. Graphviz `newrank` ranks the whole graph in one pass, ignoring clusters (default false). It can give fewer ranks and a more compact layout. It can also put a head node on a higher rank than its tail, which reverses the meaning of an arrow in a dependency graph. Its role here is already filled by the engine's `partitions` none, soft or strict setting, so it should not become a separate control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | middle     | high       |
| 6. Graphviz `concentrate` merges multi-edges and lets partly parallel edges share part of their paths. The path-sharing part works only in dot, so it is part of layout, not a restyle applied afterwards. The other attributes check out against their pages. `weight`: the heavier the weight, the shorter, straighter and more vertical the edge. `minlen`: the minimum rank difference between head and tail. `group`: edges inside a group are set to avoid crossings and stay straight. `mclimit`: scales the crossing-minimisation iteration limits. `nslimit`: caps network-simplex iterations. Mapped to the repo: weight is `EdgeKindPolicy.weight`, minlen is `minLength`, mclimit and nslimit are `effort`, and group has no equivalent.                                                                                                                                                                         | antithesis | high       |
| 7. d3-dag documents `quality` presets (fast, medium and slow) that trade speed for crossings. `slow` uses optimal decrossing and is for small graphs only. The default, medium, gives better layouts but is roughly 2x slower on large graphs, and fast is recommended for interactive or animated graphs. The model to copy is a fast tier for live interaction plus a slower tier the user applies on demand. Optimal decrossing is out of reach at 1,000+ models. I did not verify dagre's `ranker` values from a fetched source.                                                                                                                                                                                                                                                                                                                                                                                         | antithesis | high       |
| 8. Lineage UIs expose visibility filters and focus, not layout internals. DataHub's lineage V3 has separate toggles for hiding transformations and showing ghost entities, and lets the user focus lineage on a single column. dbt's selectors limit depth separately upstream and downstream (`3+my_model+4`). Kiali ranks nodes by criteria such as inbound-edge count, and combines that with find/hide to highlight or filter them. None of the documented lineage UIs I read exposes layout weights.                                                                                                                                                                                                                                                                                                                                                                                                                    | antithesis | high       |
| 9. There is controlled evidence for ranking the aesthetics. Purchase (1997, an online experiment scored on time and errors) found that reducing edge crossings is by far the most important aesthetic, and that fewer bends and more symmetry help less. Minimum angle and orthogonal-grid placement had no significant effect. So crossings come first, then bends. The force-layout line the thesis cited does not apply to layered drawing. Readability is also necessary but not sufficient: a drawing should be faithful to the data. For this graph, low density (0.065–0.19 in the spike) and a 55:1 aspect ratio are also real costs that crossing counts do not capture.                                                                                                                                                                                                                                            | new        | high       |
| 10. Layered (Sugiyama-style) drawing suits dependency graphs. Crossing minimisation is NP-hard, so engines use heuristics, and settings that control order quality really control how hard the heuristic searches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | thesis     | high       |
| 11. Controls fall into three cost classes, not two. (1) Changing what is drawn needs a new layout: hiding or filtering cards, excluding hubs or utility nodes, collapsing or expanding groups, depth, thresholds. (2) Constraint changes keep every card but change the layout: an edge-kind `weight`, `routed: false` soft attraction, `minLength`, partitions, effort. (3) Restyling needs no layout: dimming, path highlighting, hover emphasis, edge opacity. The extension already blurs hide and de-emphasise: a host-hidden table is still drawn, and only its edges are left out. Restyling 1,000+ React Flow cards also costs something, and that cost has not been measured.                                                                                                                                                                                                                                       | middle     | medium     |
| 12. The research on focus versus overview is now quoted, though not proven for lineage. Van Ham and Perer argue that a whole-graph overview is often not useful for users with semi-specific information needs. They propose browsing the context graph around a node of interest, using Furnas's degree-of-interest function adapted to graphs. Their evidence is a demonstration on a database of 3 million legal citations, not a controlled user study. Edge bundling has a documented risk: bundles can suggest connections that do not exist. In lineage, that means false dependencies. A user study of path-based bundled layered drawings found them well received for clarity and usability compared with Sugiyama. That is a preference result, not a measure of comprehension.                                                                                                                                   | middle     | medium     |
| 13. Scope should be the main control and layout parameters secondary. Offer separate upstream and downstream depth around a focus card, as dbt's selectors do. Add an attention budget (a maximum number of cards) filled by a degree-of-interest score, and expand on demand. The engine already supports this: the adapter anchors the layout on the focus card and passes hints, so the drawing stays stable as the user expands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | new        | medium     |
| 14. Offer transitive reduction as a reversible edge filter, off by default. It keeps the fewest edges with the same reachability. Removed shortcut edges create long spans and crossings. A direct ref can still carry meaning, though, so removed edges should stay available as a dim hint, not disappear. It needs a new layout, because the ranking edges change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | new        | medium     |
| 15. Hub or utility nodes (for example normalize_timestamp) need three distinct treatments, offered from a list of nodes ranked by degree, as in Kiali. The treatments are: hide the node (new layout); keep it but make its edges `routed: false` or low-weight, so it no longer drags the ranking (new layout, soft attraction); or just de-emphasise it (restyle only). A degree threshold that marks candidates can be adjusted live, because it only restyles until the user applies a treatment.                                                                                                                                                                                                                                                                                                                                                                                                                        | new        | medium     |
| 16. Deal with the 55:1 aspect ratio structurally, not with spacing sliders. ELK's wrapping splits a layered drawing into chunks placed side by side, and it is off by default. The repo engine has no wrapping, so this is new engine work, not a toggle. Until that exists, scope limits (point 13) are the practical remedy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | new        | medium     |
| 17. Keep strict dbt-layer bands off by default, and let the engine's ranks set where the bands fall. In the spike, strict partitions cost about 40% of density, seven times the dummy nodes and a third more crossings. They also defeat stability: with strict partitions rank changes stay at 8 whatever the hint weight. The adapter's current soft default is right, and a strict option should be labelled as costly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | new        | high       |
| 18. Treat 'does this control help' as a measurement the panel can make. Every layout result already reports crossings, bends, edge length, area, density and overlaps. Show a compact readout of these next to presets, and choose defaults by running the presets on real projects. The literature does not cover lineage graphs of this size.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | new        | high       |

## Detail

### 1. The engine keeps no state between calls, so any setting that changes the graph or the layout options means a new call to `layout`. Purely visual settings do not. But that call does not have to throw the old layout away. Passing the previous result back as `hints`, weighted by `stability`, holds the layout steady. The repo's spike measured this over 20 expansions on a 300-node graph: hints cut the mean displacement of retained cards from 134 px to 39 px per step, and rank changes from 24 to 1. Measured layout times are 24–190 ms for 300 nodes and 173 ms for 600 nodes with columns and relationships, unpartitioned. The spike notes that absolute times vary up to fourfold under machine load. So a debounced live slider is feasible for scope or emphasis changes at fast or balanced effort. It is not obviously feasible for full-project layouts of 1,000+ models, which were not measured

Verdict: middle. Confidence: high.

The thesis is right that every layout change is a new layout call. The antithesis is right that hints and stability make that relayout stable, and that cost figures exist. I read both in the repo. Quote c2 is about hints preserving shape, not about debouncing. I keep it, because it supports the stable-relayout point instead.

Citations:

- [r1a](../../packages/graph-layout/README.md): "Every call is a pure function of its graph and options: the engine keeps no state between calls, so a caller that wants a preset merges it with its own options and calls `layout` again."
- [r1b](../../packages/graph-layout/README.md): "Pass `result.hints` as `hints` on the next call, with `stability` to weigh them against edge length."
- [r1c](../../packages/graph-layout/src/types.ts): "Weight of the hint terms against edge length: 0 uses hints only as the starting order."
- [r1d](../../scripts/spikes/graph-layout/README.md): "Pure TypeScript is fast enough: no phase needs WASM at 600 nodes."
- [r1e](../../scripts/spikes/graph-layout/README.md): "The machine's load average was 20 to 28 during the runs, so absolute times vary by up to four times between runs;"

Thesis (high): The layout engine is a pure function of its graph and options, with no state kept between calls. Any user setting therefore means a full relayout. Only purely visual settings can be applied without one, and live sliders for layout parameters need debouncing or caching.

Thesis citations:

- [c1](../../packages/graph-layout/README.md): "Every call is a pure function of its graph and options: the engine keeps no state between calls, so a caller that wants a preset merges it with its own options and calls `layout` again."
- [c2](../../packages/graph-layout/README.md): "A previous result can be passed back as hints, so a graph that grows by expansion keeps its shape."

Antithesis: 'Any user setting means a full relayout' is too coarse. The engine takes `hints` and `stability`, so a relayout can be incremental in shape. The repo's own spike measured that hints cut mean displacement of retained cards from 134 px to about 39 px per step, and rank changes from 24 to 1. That makes a relayout a stable one, which is a different live-adjustment story from 'debounce it'.

Antithesis: The thesis gives no cost figure. The repo's spike README has them: about 141–460 ms for 300 nodes with columns and relationships, and 173 ms for 600 nodes with no partitions. These numbers decide which controls can be live sliders. Their absence leaves the live-versus-apply question unanswered.

Antithesis: The thesis never mentions that `LayoutResult.metrics` returns crossings, bends, edgeLength, area and density on every call. Every layout control could therefore be A/B-measured by the panel itself. That is better evidence for 'does it help' than any literature.

Antithesis: Cited quote c2 ('A previous result can be passed back as hints…') is offered in support of 'needs debouncing or caching'. It supports neither; it says hints preserve shape.

Antithesis: The README's purity sentence says the caller 'merges [a preset] with its own options and calls `layout` again'. That is about presets being plain data, not about live-slider cost.

Counter-evidence:

- [a1](../../scripts/spikes/graph-layout/README.md): "Pure TypeScript is fast enough: no phase needs WASM at 600 nodes."
- [a2](../../packages/graph-layout/src/types.ts): "Weight of the hint terms against edge length: 0 uses hints only as the starting order."
- [a3](../../packages/graph-layout/src/types.ts): "Total node area over `area`, between 0 and 1."

### 2. The engine exposes only some of the ELK and Graphviz knobs. They are: `effort` (fast, balanced or thorough), spacing, `partitions` (none, soft or strict), `stability`, `seed`, `anchor`, `ranks` (rows or levels), and a policy per edge kind. The edge-kind policy sets `ranks`, `minLength` (Graphviz minlen), `weight` (Graphviz weight) and `routed` (`false` gives a pure layout constraint, i.e. the owner's 'soft attraction'). The engine has no wrapping, no post-compaction, no considerModelOrder equivalent, no selectable layering or placement algorithm, and no Graphviz `group` equivalent. The lineage adapter currently hard-codes these settings: soft partitions, the focus card as anchor, column edges at weight 0.5 that do not rank, and relationship edges that do not rank at weight 1. The package README says the partitions setting is not yet wired to the panel

Verdict: antithesis. Confidence: high.

I read types.ts, the README and the adapter (graphLayoutEngine.ts). The thesis's 'already exposes the knobs the brief lists' overstates it. The circuit preset's comment states what it is meant to do, not a measured result. The antithesis's suggested 0.3 relationship weight does not match the code: relationship edges use the default weight 1.

Citations:

- [r2a](../../packages/graph-layout/src/types.ts): "The edge is routed and returned. Defaults to true; `false` makes a pure layout constraint."
- [r2b](../../packages/graph-layout/src/types.ts): "Pull in ranking, ordering and placement, relative to 1."
- [r2c](../../packages/graph-layout/src/types.ts): "Smallest rank span of a ranking edge."
- [r2d](../../packages/graph-layout/README.md): "A preset sets only the options that describe a drawing's look (`effort`, `spacing`, `partitions`, `stability`, `seed`); it never sets `direction`, `edgeKinds`, `anchor` or `hints`, which belong to one graph."
- [r2e](../../webviews/src/modules/lineage/engine/graphLayoutEngine.ts): "column: { ranks: false, weight: 0.5, sourceSide: "east", targetSide: "west" },"
- [r2f](../../packages/graph-layout/README.md): "The lineage panel will expose this as a setting that lays the view out again when it changes; the setting is not wired yet."

Thesis (high): The engine already exposes the ELK-style knobs the brief lists, in its own vocabulary. Named presets (circuit, compact) set effort, partitions and spacing. Per-edge-kind policies set whether an edge kind ranks nodes and its weight. Circuit is the crossing-minimising preset: it searches the order hardest.

Thesis citations:

- [c3](../../packages/graph-layout/src/presets.ts): "Orthogonal drawing with few crossings: the ordering phase searches hardest and nodes sit closer."
- [c4](../../packages/graph-layout/README.md): "Pass `result.hints` as `hints` on the next call, with `stability` to weigh them against edge length."

Antithesis: The thesis says the engine 'already exposes the ELK-style knobs the brief lists'. It exposes only a few of them. The types show no wrapping, no post-compaction, no considerModelOrder equivalent, no selectable layering or placement algorithm, and no edge-routing choice. The ELK reference below shows each of those is a separate option, so the claim is overstated.

Antithesis: Wrapping is the ELK option aimed at a drawing ~55x wider than tall, and the thesis never maps it or says the engine lacks it.

Antithesis: The thesis misses the most useful existing knobs. `EdgeKindPolicy.routed: false` makes an edge 'a pure layout constraint', which is the owner's 'soft attraction' idea. `minLength` and fractional `weight` give Graphviz `minlen` and `weight`. `ranks: rows|levels`, `anchor` and `stability` are also exposed. These are the controls the brief asked for.

Antithesis: The thesis also misses that the repo's own spike measured strict dbt-layer partitions as costly. They cost about 40% of density, seven times the dummies and a third more crossings, and they defeat rank stability. The spike's conclusion was to start with soft or none. A 'strict layers' toggle is therefore not a free choice.

Antithesis: The README says plainly that the lineage panel 'will expose' the partitions setting but 'the setting is not wired yet'. So the live panel does not yet use some of these controls.

Antithesis: Quote c3 ('few crossings: the ordering phase searches hardest') describes a preset's intent. The README itself says the preset values are 'starting points' that the evaluation harness will tune. It is not evidence that circuit gives fewer crossings.

Counter-evidence:

- [a4](../../packages/graph-layout/src/types.ts): "The edge is routed and returned. Defaults to true; `false` makes a pure layout constraint."
- [a5](../../scripts/spikes/graph-layout/README.md): "Strict dbt-layer partitions cost about 40% of the density, seven times the dummies and a third more crossings, and"
- [a6](../../packages/graph-layout/README.md): "The lineage panel will expose this as a setting that lays the view out again when it changes; the setting is not wired yet."
- [a7](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-wrapping-strategy.html): "For certain graphs and certain prescribed drawing areas it may be desirable to split the laid out graph into chunks that are placed side by side."

### 3. ELK's considerModelOrder keeps the input order of nodes and edges where doing so adds no crossings. Its default is NONE. It takes four values: NONE, NODES_AND_EDGES, PREFER_EDGES and PREFER_NODES. It is a predictability control rather than a clarity control. It lets a user-meaningful order (alphabetical, by folder) survive the layout. The repo engine has no equivalent. Its hints and `seed` partly cover the same need

Verdict: middle. Confidence: high.

I verified the thesis's semantics and the default on the ELK page. The antithesis is right that the option has several values, not one switch, and that its value is predictability.

Citations:

- [r3a](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-considerModelOrder-strategy.html): "Preserves the order of nodes and edges in the model file if this does not lead to additional edge crossings."
- [r3b](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-considerModelOrder-strategy.html): "OrderingStrategy.NONE"

Thesis (high): ELK's considerModelOrder option preserves model order where it does not add crossings. It is opt-in and needs a deterministic input order. Its default is NONE.

Thesis citations:

- [c5](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-considerModelOrder-strategy.html): "Preserves the order of nodes and edges in the model file if this does not lead to additional edge crossings."

Antithesis: The thesis states that considerModelOrder defaults to NONE, but its quote c5 does not contain that. The default is on the page, and is checked below.

Antithesis: The page lists four values (NONE, NODES_AND_EDGES, PREFER_EDGES, PREFER_NODES). The thesis treats it as a single on/off switch.

Antithesis: The thesis does not explain why it matters here. A deterministic model order lets the layout follow a user-meaningful order, for example alphabetical or by folder. That is a stability-and-predictability control, not a clarity control.

Counter-evidence:

- [a8](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-considerModelOrder-strategy.html): "OrderingStrategy.NONE"

### 4. ELK layered defaults: layering is network simplex, crossing minimisation is layer sweep, node placement is Brandes–Köpf, and wrapping is off. Post-compaction is a separate option (I read that it exists, not its default). The repo engine uses the same family of algorithms: network simplex ranking with weights and minimum lengths. Making the algorithm itself user-selectable adds little. A small effort ladder is the right control

Verdict: antithesis. Confidence: high.

I verified each default on its ELK reference page. The thesis's single quote was a tautology. The README's phase table shows the repo uses network simplex.

Citations:

- [r4a](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-nodePlacement-strategy.html): "NodePlacementStrategy.BRANDES_KOEPF"
- [r4b](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-layering-strategy.html): "LayeringStrategy.NETWORK_SIMPLEX"
- [r4c](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-strategy.html): "CrossingMinimizationStrategy.LAYER_SWEEP"
- [r4d](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-compaction-postCompaction-strategy.html): "Specifies whether and how post-process compaction is applied."
- [r4e](../../packages/graph-layout/README.md): "`soft`, the default, penalises a backward crossing of a boundary in the ranking."

Thesis (medium): ELK's nodePlacement strategy is documented as a single option for node placement, with the Brandes-Koepf strategy as default. Node placement only moves nodes within their layers. Layering and crossing-minimisation strategies are separate options, and I did not verify their defaults from a cited page.

Thesis citations:

- [c6](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-nodePlacement-strategy.html): "Strategy for node placement."

Antithesis: The thesis leaves the layered defaults unverified; they can be verified. Layering defaults to network simplex, crossing minimisation to layer sweep, and node placement to Brandes-Köpf. Wrapping and post-compaction default to off (OFF and NONE).

Antithesis: c6 ('Strategy for node placement.') is a tautology. It does not support the stated claims that BK is the default or that placement 'only moves nodes within their layers'.

Antithesis: The thesis never says that ELK's defaults are the same family the repo's engine uses: network simplex ranking, sweeps with transpose, Brandes-Köpf and quadratic placement. The real design question is which of these should be user-selectable, and the answer is probably none, because the repo's own spike found nothing that needs WASM.

Antithesis: Dagre's `ranker` is `network-simplex`, `tight-tree` or `longest-path`. d3-dag has quality tiers and the `ranker` option. These are cheap 'effort' presets, not independent expert knobs, so exposing them to a panel user adds little.

Counter-evidence:

- [a9](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-nodePlacement-strategy.html): "NodePlacementStrategy.BRANDES_KOEPF"
- [a10](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-layering-strategy.html): "LayeringStrategy.NETWORK_SIMPLEX"
- [a11](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-strategy.html): "CrossingMinimizationStrategy.LAYER_SWEEP"
- [a12](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-compaction-postCompaction-strategy.html): "Specifies whether and how post-process compaction is applied."

### 5. Graphviz `newrank` ranks the whole graph in one pass, ignoring clusters (default false). It can give fewer ranks and a more compact layout. It can also put a head node on a higher rank than its tail, which reverses the meaning of an arrow in a dependency graph. Its role here is already filled by the engine's `partitions` none, soft or strict setting, so it should not become a separate control

Verdict: middle. Confidence: high.

The thesis described newrank correctly but quoted the wrong sentence. I verified the head-above-tail caveat on the page. The antithesis's mapping to partitions and its correctness concern both hold.

Citations:

- [r5a](https://graphviz.org/docs/attrs/newrank/): "head node being place on a higher rank than the tail node."
- [r5b](https://graphviz.org/docs/attrs/newrank/): "The original ranking algorithm in dot is recursive on clusters."

Thesis (high): Graphviz newrank ranks the whole graph in one pass, ignoring clusters. It can give a more compact layout but may place a head node above its tail. It is dot-only, so it is a relayout setting that does not carry over to other engines.

Thesis citations:

- [c7](https://graphviz.org/docs/attrs/newrank/): "The original ranking algorithm in dot is recursive on clusters."

Antithesis: The thesis's c7 quote does not support its claim. 'The original ranking algorithm in dot is recursive on clusters' says nothing about newrank being whole-graph, compact or unsound. The caveat about a head node above its tail is in the page text but not in the cited quote.

Antithesis: The thesis cites newrank as a user setting. It matters only for graphs with clusters and `rank=same` constraints. This extension's folder groups and dbt layer bands are the same problem, and the repo has already solved it with partitions. So newrank maps to the `partitions: soft|strict|none` setting, not to a new control.

Antithesis: The caveat that newrank may rank a head above its tail is a correctness hazard for a dependency graph, where the arrow direction is the meaning. It supports not exposing such an option.

Counter-evidence:

- [a13](https://graphviz.org/docs/attrs/newrank/): "This can produce fewer ranks and a more compact layout, but sometimes at the cost of a head node being place on a higher rank than the tail node."

### 6. Graphviz `concentrate` merges multi-edges and lets partly parallel edges share part of their paths. The path-sharing part works only in dot, so it is part of layout, not a restyle applied afterwards. The other attributes check out against their pages. `weight`: the heavier the weight, the shorter, straighter and more vertical the edge. `minlen`: the minimum rank difference between head and tail. `group`: edges inside a group are set to avoid crossings and stay straight. `mclimit`: scales the crossing-minimisation iteration limits. `nslimit`: caps network-simplex iterations. Mapped to the repo: weight is `EdgeKindPolicy.weight`, minlen is `minLength`, mclimit and nslimit are `effort`, and group has no equivalent

Verdict: antithesis. Confidence: high.

I verified every attribute page. The concentrate page says the sharing feature is not available outside dot. That contradicts the thesis's 'rendering option once the layout exists'.

Citations:

- [r6a](https://graphviz.org/docs/attrs/concentrate/): "This merges multiedges into a single edge and causes partially parallel"
- [r6b](https://graphviz.org/docs/attrs/concentrate/): "The latter feature is not yet available"
- [r6c](https://graphviz.org/docs/attrs/weight/): "the heavier the weight, the shorter, straighter and more vertical the edge is."
- [r6d](https://graphviz.org/docs/attrs/minlen/): "Minimum edge length (rank difference between head and tail)"
- [r6e](https://graphviz.org/docs/attrs/group/): "parameters are set to avoid crossings and keep"
- [r6f](https://graphviz.org/docs/attrs/mclimit/): "Multiplicative scale factor used to alter the MinQuit (default = 8)"
- [r6g](https://graphviz.org/docs/attrs/nslimit/): "Sets number of iterations in network simplex applications"

Thesis (high): Graphviz concentrate merges multi-edges into a single edge, which reduces clutter at the cost of edge identity. It only works for non-contiguous nodes. It changes drawing rather than ordering, so it can be applied as a rendering option once the layout exists. Graphviz minlen, weight and mclimit exist as attributes, but I did not verify their semantics from a cited page.

Thesis citations:

- [c8](https://graphviz.org/docs/attrs/concentrate/): "This merges multiedges into a single edge and causes partially parallel"
- [c9](https://graphviz.org/docs/attrs/concentrate/): "Only works for non-contiguous nodes."

Antithesis: Wrong inference. The thesis says concentrate 'changes drawing rather than ordering, so it can be applied as a rendering option once the layout exists'. In dot, concentrate runs inside the layout. Merged edges share dummy-node paths, so it changes ranking-adjacent structure and routing. The docs call the partial-sharing feature available only in dot, which fits an engine-internal feature.

Antithesis: The thesis says it did not verify weight, minlen, mclimit and group semantics. They can be verified. weight: the heavier, the shorter, straighter and more vertical the edge. minlen: minimum rank difference between head and tail. group: edge between same-group nodes gets parameters that avoid crossings and keep it straight. mclimit: scale factor on the crossing-minimisation iteration limits. nslimit: caps network-simplex iterations when placing x coordinates.

Antithesis: The mapping to the repo is direct. Graphviz `weight` is `EdgeKindPolicy.weight`, `minlen` is `minLength`, `group` has no equivalent, and `mclimit` and `nslimit` are `effort`. The thesis does not draw this mapping, so it never says which are already covered.

Antithesis: Concentrate-style bundling trades edge identity for less clutter. The thesis does not weigh that against evidence on bundling ambiguity; see the alternatives below.

Antithesis: c9 ('Only works for non-contiguous nodes.') is a parenthetical caveat. It says nothing about when the option can be applied.

Counter-evidence:

- [a14](https://graphviz.org/docs/attrs/concentrate/): "The latter feature is not yet available outside of dot"
- [a15](https://graphviz.org/docs/attrs/weight/): "the heavier the weight, the shorter, straighter and more vertical the edge is."
- [a16](https://graphviz.org/docs/attrs/minlen/): "Minimum edge length (rank difference between head and tail)"
- [a17](https://graphviz.org/docs/attrs/group/): "parameters are set to avoid crossings and keep"
- [a18](https://graphviz.org/docs/attrs/mclimit/): "Multiplicative scale factor used to alter the MinQuit (default = 8)"
- [a19](https://graphviz.org/docs/attrs/nslimit/): "Sets number of iterations in network simplex applications"

### 7. d3-dag documents `quality` presets (fast, medium and slow) that trade speed for crossings. `slow` uses optimal decrossing and is for small graphs only. The default, medium, gives better layouts but is roughly 2x slower on large graphs, and fast is recommended for interactive or animated graphs. The model to copy is a fast tier for live interaction plus a slower tier the user applies on demand. Optimal decrossing is out of reach at 1,000+ models. I did not verify dagre's `ranker` values from a fetched source

Verdict: antithesis. Confidence: high.

I fetched the d3-dag README and found these passages. The dagre part remains uncited.

Citations:

- [r7a](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/README.md): "The `quality` and `ranker` options only apply when using the sugiyama algorithm (the default)."
- [r7b](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/README.md): "when layout speed matters more than visual quality"
- [r7c](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/README.md): "produces better layouts at the cost of being roughly 2x slower on large graphs"

Thesis (speculative): dagre exposes a ranker option, and d3-dag offers quality presets that trade speed for crossings, including ILP-optimal crossing minimisation. I could not cite either from a fetched page in this check, so the claim is recorded without a citation.

Antithesis: The thesis calls this speculative because it could not fetch a page, but d3-dag's README can be read. It documents `quality` presets (fast, medium, slow) that trade speed for crossing quality. 'slow' uses optimal decrossing, and the README gives the 'slow' preset's timing only as 'small graphs only'.

Antithesis: d3-dag's own docs say to use `fast` when layout speed matters more than visual quality. That is a cost-versus-quality preset, which is the model the thesis was missing.

Antithesis: dagre's `ranker` is `network-simplex`, `tight-tree` or `longest-path`, per the dagre type definitions in the local clone. No fetched URL is cited for this, so it is unverified here.

Antithesis: A 'slow optimal decrossing' setting is unusable at 1,000+ models. The right takeaway is the preset ladder with a fast live tier and a slower apply tier, not the ILP itself.

Counter-evidence:

- [a20](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/README.md): "The `quality` and `ranker` options only apply when using the sugiyama algorithm (the default)."
- [a21](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/README.md): "when layout speed matters more than visual quality"

### 8. Lineage UIs expose visibility filters and focus, not layout internals. DataHub's lineage V3 has separate toggles for hiding transformations and showing ghost entities, and lets the user focus lineage on a single column. dbt's selectors limit depth separately upstream and downstream (`3+my_model+4`). Kiali ranks nodes by criteria such as inbound-edge count, and combines that with find/hide to highlight or filter them. None of the documented lineage UIs I read exposes layout weights

Verdict: antithesis. Confidence: high.

I fetched the DataHub source and docs, the dbt docs and the Kiali docs, and found the quotes. The thesis's claim that hop-degree filtering happens in the search query is still unsupported. The point that no surveyed UI exposes layout weights covers only the tools read.

Citations:

- [r8a](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/src/app/lineageV3/controls/LineageSearchFilters.tsx): "controls.filters.hideTransformations.label"
- [r8b](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/src/app/lineageV3/controls/LineageSearchFilters.tsx): "setShowGhostEntities,"
- [r8c](https://docs.datahub.com/docs/features/feature-guides/lineage): "you can visualize lineage focused on a single column by clicking on the breadcrumb on a column"
- [r8d](https://docs.getdbt.com/reference/node-selection/graph-operators): "its ancestors up to the 3rd degree, and its descendants down to the 4th degree"
- [r8e](https://kiali.io/docs/features/topology/): "Combined with the find/hide feature, this allows you to quickly highlight or filter for important workloads, services, and applications."

Thesis (speculative): DataHub's lineage view implements hide-transformations and show-ghost-entities as separate toggles, and filters by hop degree in the search query rather than the layout. I read these in the local clone, but could not cite them through this check, so the claim is recorded without a citation.

Antithesis: The DataHub claim can be cited from the DataHub repo's GitHub URL. The lineage V3 filter panel has separate toggles for hide-transformations, show-process-instances, ghost entities and output-ports-only. All of them are visibility filters on a query result, not layout settings.

Antithesis: The thesis treats DataHub as the model for visibility controls but misses what it implies. The common lineage UI pattern is a handful of typed visibility filters plus single-column focus. None of the surveyed UIs expose layout weights or a layout engine's internals.

Antithesis: 'Filters by hop degree in the search query' is not shown by any quote. dbt's selector syntax is the documented depth control: `3+my_model+4` selects ancestors to the 3rd degree and descendants to the 4th.

Antithesis: Other tools' controls are missing from the survey. Kiali's find/hide lets users rank nodes by inbound-edge count, then highlight or filter. DataHub offers per-column focus when the table view is too busy. The brief asked for these (hubs, upstream/downstream depth, search-and-focus) and the thesis covers none.

Counter-evidence:

- [a22](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/src/app/lineageV3/controls/LineageSearchFilters.tsx): "controls.filters.hideTransformations.label"
- [a23](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/src/app/lineageV3/controls/LineageSearchFilters.tsx): "setShowGhostEntities,"
- [a24](https://docs.datahub.com/docs/features/feature-guides/lineage): "you can visualize lineage focused on a single column by clicking on the breadcrumb on a column"
- [a25](https://docs.getdbt.com/reference/node-selection/graph-operators): "its ancestors up to the 3rd degree, and its descendants down to the 4th degree"
- [a26](https://kiali.io/docs/features/topology/): "Combined with the find/hide feature, this allows you to quickly highlight or filter for important workloads, services, and applications."

### 9. There is controlled evidence for ranking the aesthetics. Purchase (1997, an online experiment scored on time and errors) found that reducing edge crossings is by far the most important aesthetic, and that fewer bends and more symmetry help less. Minimum angle and orthogonal-grid placement had no significant effect. So crossings come first, then bends. The force-layout line the thesis cited does not apply to layered drawing. Readability is also necessary but not sufficient: a drawing should be faithful to the data. For this graph, low density (0.065–0.19 in the spike) and a 55:1 aspect ratio are also real costs that crossing counts do not capture

Verdict: new. Confidence: high.

I replaced the thesis's general Wikipedia support with Purchase's abstract, which I fetched. The antithesis was right that Wikipedia could not rank the aesthetics. Purchase's study used small general graphs, so transferring the ranking to 1,000-node layered graphs is an inference.

Citations:

- [r9a](https://link.springer.com/chapter/10.1007/3-540-63938-1_67): "The results indicate that reducing the number of edge crosses is by far the most important aesthetic, while minimising the number of bends and maximising symmetry have a lesser effect."
- [r9b](https://link.springer.com/chapter/10.1007/3-540-63938-1_67): "The effects of maximising the minimum angle between edges leaving a node and of fixing edges and nodes to an orthogonal grid are not statistically significant."
- [r9c](https://arxiv.org/abs/1701.00921): "readability criteria are necessary but not sufficient"

Thesis (medium): Drawing aesthetics (crossings, bends, edge length, area) are said to affect understandability. Simple edges are easier to follow, and force-layout goals favour short edges with well-separated vertices. This supports minimising crossings and bends first. The source is general, not a controlled study.

Thesis citations:

- [c10](https://en.wikipedia.org/wiki/Graph_drawing): "the arrangement of these vertices and edges within a drawing affects its understandability, usability, fabrication cost, and aesthetics"
- [c11](https://en.wikipedia.org/wiki/Graph_drawing): "It is important that edges have shapes that are as simple as possible, to make it easier for the eye to follow them."
- [c12](https://en.wikipedia.org/wiki/Graph_drawing): "in order to seek a layout in which edge lengths are small while vertices are well-separated"

Antithesis: The thesis cites Wikipedia for 'drawing aesthetics affect understandability'. That is a general statement, not evidence for ranking crossings, bends and length against each other. The brief asks which controls help, and this cannot say. The thesis admits it is 'not a controlled study', but still lists it as supporting 'minimise crossings and bends first'.

Antithesis: The thesis's own source on force layouts ('edge lengths are small while vertices are well-separated') is about force-directed drawing. It does not apply to layered drawing. The thesis uses it as a general law.

Antithesis: Readability metrics are necessary but not sufficient. A 2017 arXiv paper argues for 'faithfulness' criteria, using edge bundling as an example. So minimising crossings and bends does not by itself maximise the information a reader takes in.

Antithesis: The thesis ignores the repo's own measured density figure. At 300 nodes with strict layers, density is 0.11 (7% for the column-and-relationship case), meaning most of the canvas is blank. For a graph that is ~55x wider than tall, aspect ratio and area matter more than crossing counts, and the thesis does not say so.

Antithesis: The thesis calls its source 'general, not a controlled study' but still ranks crossings and bends above everything else. The evidence it holds does not allow that ranking.

Counter-evidence:

- [a27](https://arxiv.org/abs/1701.00921): "readability criteria are necessary but not sufficient"

### 10. Layered (Sugiyama-style) drawing suits dependency graphs. Crossing minimisation is NP-hard, so engines use heuristics, and settings that control order quality really control how hard the heuristic searches

Verdict: thesis. Confidence: high.

Not attacked. I re-verified both quotes.

Citations:

- [r10a](https://en.wikipedia.org/wiki/Layered_graph_drawing): "minimizing the number of crossings is also NP-hard; so, layered graph drawing systems typically apply a sequence of heuristics"
- [r10b](https://en.wikipedia.org/wiki/Graph_drawing): "Layered graph drawing methods (often called Sugiyama-style drawing) are best suited for directed acyclic graphs or graphs that are nearly acyclic, such as the graphs of dependencies between modules or functions in a software system."

Thesis (high): Layered (Sugiyama-style) drawing suits dbt dependency graphs. Crossing minimisation is NP-hard, so practical layouts use heuristics that are predictable but not optimal. Order-quality options are therefore heuristic-effort options.

Thesis citations:

- [c13](https://en.wikipedia.org/wiki/Layered_graph_drawing): "minimizing the number of crossings is also NP-hard; so, layered graph drawing systems typically apply a sequence of heuristics"
- [c14](https://en.wikipedia.org/wiki/Graph_drawing): "Layered graph drawing methods (often called Sugiyama-style drawing) are best suited for directed acyclic graphs or graphs that are nearly acyclic, such as the graphs of dependencies between modules or functions in a software system."

### 11. Controls fall into three cost classes, not two. (1) Changing what is drawn needs a new layout: hiding or filtering cards, excluding hubs or utility nodes, collapsing or expanding groups, depth, thresholds. (2) Constraint changes keep every card but change the layout: an edge-kind `weight`, `routed: false` soft attraction, `minLength`, partitions, effort. (3) Restyling needs no layout: dimming, path highlighting, hover emphasis, edge opacity. The extension already blurs hide and de-emphasise: a host-hidden table is still drawn, and only its edges are left out. Restyling 1,000+ React Flow cards also costs something, and that cost has not been measured

Verdict: middle. Confidence: medium.

The thesis's split holds in outline. The antithesis's third class follows from the edge-kind policy semantics. I verified the hidden-table behaviour in webviews/src/modules/lineage/hiddenNodes.ts. The cost classes are inferred from the API, not measured.

Citations:

- [r11a](../../webviews/src/modules/lineage/filteredOut.ts): "A hidden table can still be drawn; only its edges are left out."
- [r11b](../../packages/graph-layout/README.md): "Every call is a pure function of its graph and options"

Thesis (medium): Hiding nodes, collapsing hubs, excluding utility nodes and changing thresholds all change what is drawn, so they need a relayout. Restyling (dimming, highlighting a path, de-emphasising a hub) can run without one. The visibility-relayouts, emphasis-restyles split is my inference from the engine's pure-function design, not a documented finding.

Thesis citations:

- [c15](../../packages/graph-layout/README.md): "Every call is a pure function of its graph and options"

Antithesis: The visibility-relayouts and emphasis-restyles split is presented as inference from purity. It is correct in outline but misses cases. Collapsing a group changes the node count, so it relayouts. 'Excluding a hub' changes ranks, so it relayouts. Dimming a hub or highlighting a path does not. So 'hub de-emphasis' is only restyle-only if the hub stays in the layout. Turning a hub's edges into a `weight: low` or `routed: false` constraint ('soft attraction') relayouts without removing the node, which is a third category the thesis misses.

Antithesis: The repo already has a hidden-table notion: the host can mark a table `hidden`, and `hiddenTables` returns tables 'whose edges are not drawn'. A hidden table can still be drawn; only its edges are left out. Existing behaviour already blurs 'hide' and 'de-emphasise', and the thesis does not examine it.

Antithesis: The thesis says nothing about the cost of the restyle path. A restyle across 1,000+ cards in React Flow is not free either.

Counter-evidence:

- [a28](../../packages/graph-layout/src/types.ts): "The edge is routed and returned. Defaults to true; `false` makes a pure layout constraint."

### 12. The research on focus versus overview is now quoted, though not proven for lineage. Van Ham and Perer argue that a whole-graph overview is often not useful for users with semi-specific information needs. They propose browsing the context graph around a node of interest, using Furnas's degree-of-interest function adapted to graphs. Their evidence is a demonstration on a database of 3 million legal citations, not a controlled user study. Edge bundling has a documented risk: bundles can suggest connections that do not exist. In lineage, that means false dependencies. A user study of path-based bundled layered drawings found them well received for clarity and usability compared with Sugiyama. That is a preference result, not a measure of comprehension

Verdict: middle. Confidence: medium.

I quote the abstract from the Europe PMC record of PubMed 19834159, fetched through its REST API, because the PubMed page did not pass the citation check. The bundling papers were verified by fetching their arXiv abstract pages.

Citations:

- [r12a](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:19834159%20AND%20SRC:MED&resultType=core&format=json): "In this paper, we advocate an interaction model that allows users to remotely browse the immediate context graph around a specific node of interest."
- [r12b](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:19834159%20AND%20SRC:MED&resultType=core&format=json): "We demonstrate the effectiveness of our approach with an exploration of a dense online database containing over 3 million legal citations."
- [r12c](https://arxiv.org/abs/2108.05467): "These clusters can result in ambiguous connections that do not exist in the data."
- [r12d](https://arxiv.org/abs/2209.04522): "we performed a user study and the results show that the drawings produced by the new framework are well received in terms of clarity, readability, and usability"

Thesis (speculative): Whether specific controls (degree-of-interest, search-show-context-expand, focus+context, edge bundling, semantic zoom) improve reader comprehension is not verified here. The van Ham and Perer PDF I fetched was a different paper, so I have no quotable support. Treat their helpfulness as unknown and test with the panel.

Antithesis: The thesis leaves the evidence question as 'unknown' and I could not close it with a quotable source either. My attempt to quote the van Ham and Perer abstract from PubMed failed the citation check, so I make no cited claim about that paper. What can be said without a quote: it is about degree-of-interest subgraph extraction around a node of interest rather than a full-graph overview, and its published evidence is a demonstration, not a user study (speculative, uncited). The point stands that 'unknown' is too weak a position for the design question, because the design choice (focus-first versus overview-first) can be tested in the panel.

Antithesis: Edge bundling has mixed evidence that the thesis never weighs. Edge-Path bundling's abstract states that bundling clusters 'can result in ambiguous connections that do not exist in the data'. For lineage, where a false edge is a false data dependency, that is a serious cost. Holten's hierarchical edge bundles are reported as evaluated only informally by potential users (speculative, uncited here).

Antithesis: One real user study of layered drawing with edge bundling exists (arXiv 2209.04522). It found the bundled path-based drawings 'well received in terms of clarity, readability, and usability' compared with Sugiyama. That is a preference result on a different layout algorithm, not proof of comprehension gains.

Antithesis: The thesis offers no study of lineage tools. None was found either; the lineage-tool controls are documented but not evaluated.

Counter-evidence:

- [a32](https://arxiv.org/abs/2108.05467): "These clusters can result in ambiguous connections that do not exist in the data."
- [a33](https://arxiv.org/abs/2209.04522): "we performed a user study and the results show that the drawings produced by the new framework are well received in terms of clarity, readability, and usability"

### 13. Scope should be the main control and layout parameters secondary. Offer separate upstream and downstream depth around a focus card, as dbt's selectors do. Add an attention budget (a maximum number of cards) filled by a degree-of-interest score, and expand on demand. The engine already supports this: the adapter anchors the layout on the focus card and passes hints, so the drawing stays stable as the user expands

Verdict: new. Confidence: medium.

This combines verified sources: dbt's depth operators, van Ham and Perer's model, and the adapter's anchor and hints. That an attention budget beats layout tuning for comprehension is an inference that has not been tested.

Citations:

- [r13a](https://docs.getdbt.com/reference/node-selection/graph-operators): "its ancestors up to the 3rd degree, and its descendants down to the 4th degree"
- [r13b](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:19834159%20AND%20SRC:MED&resultType=core&format=json): "In this paper, we advocate an interaction model that allows users to remotely browse the immediate context graph around a specific node of interest."

### 14. Offer transitive reduction as a reversible edge filter, off by default. It keeps the fewest edges with the same reachability. Removed shortcut edges create long spans and crossings. A direct ref can still carry meaning, though, so removed edges should stay available as a dim hint, not disappear. It needs a new layout, because the ranking edges change

Verdict: new. Confidence: medium.

The definition is verified. That it helps readers of lineage graphs is untested.

Citations:

- [r14a](https://en.wikipedia.org/wiki/Transitive_reduction): "is a graph with the fewest possible edges that has the same reachability relation as the original graph."

### 15. Hub or utility nodes (for example normalize_timestamp) need three distinct treatments, offered from a list of nodes ranked by degree, as in Kiali. The treatments are: hide the node (new layout); keep it but make its edges `routed: false` or low-weight, so it no longer drags the ranking (new layout, soft attraction); or just de-emphasise it (restyle only). A degree threshold that marks candidates can be adjusted live, because it only restyles until the user applies a treatment

Verdict: new. Confidence: medium.

Kiali's ranking with find/hide and the engine's edge policy are verified. The three-way split is a design inference.

Citations:

- [r15a](https://kiali.io/docs/features/topology/): "Combined with the find/hide feature, this allows you to quickly highlight or filter for important workloads, services, and applications."
- [r15b](../../packages/graph-layout/src/types.ts): "The edge is routed and returned. Defaults to true; `false` makes a pure layout constraint."

### 16. Deal with the 55:1 aspect ratio structurally, not with spacing sliders. ELK's wrapping splits a layered drawing into chunks placed side by side, and it is off by default. The repo engine has no wrapping, so this is new engine work, not a toggle. Until that exists, scope limits (point 13) are the practical remedy

Verdict: new. Confidence: medium.

The ELK page is verified. That wrapping improves comprehension of a lineage graph is not evidenced.

Citations:

- [r16a](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-wrapping-strategy.html): "For certain graphs and certain prescribed drawing areas it may be desirable to split the laid out graph into chunks that are placed side by side."
- [r16b](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-wrapping-strategy.html): "WrappingStrategy.OFF"

### 17. Keep strict dbt-layer bands off by default, and let the engine's ranks set where the bands fall. In the spike, strict partitions cost about 40% of density, seven times the dummy nodes and a third more crossings. They also defeat stability: with strict partitions rank changes stay at 8 whatever the hint weight. The adapter's current soft default is right, and a strict option should be labelled as costly

Verdict: new. Confidence: high.

The figures are verified in the spike README. Soft partitions themselves were not prototyped in the spike, so their cost relative to none is not measured.

Citations:

- [r17a](../../scripts/spikes/graph-layout/README.md): "Strict dbt-layer partitions cost about 40% of the density, seven times the dummies and a third more crossings, and"
- [r17b](../../scripts/spikes/graph-layout/README.md): "With strict partitions rank changes stay at 8 whatever the hint weight: a revealed upstream source forces every card"

### 18. Treat 'does this control help' as a measurement the panel can make. Every layout result already reports crossings, bends, edge length, area, density and overlaps. Show a compact readout of these next to presets, and choose defaults by running the presets on real projects. The literature does not cover lineage graphs of this size

Verdict: new. Confidence: high.

The metrics exist, per types.ts. Purchase links crossings and bends to comprehension, so the readout measures factors with evidence behind them.

Citations:

- [r18a](../../packages/graph-layout/src/types.ts): "Total node area over `area`, between 0 and 1."

## Alternatives the thesis missed

Treat 'which control helps' as a measurement problem inside the extension. `LayoutResult.metrics` already reports crossings, bends, edge length, area, density and overlaps for every layout. The panel can show those next to each control and evaluate presets on real projects, instead of importing literature that does not cover lineage. Defaults should be chosen from those measurements, with the spike harness as the starting point.

- [m1](../../packages/graph-layout/src/types.ts): "Total node area over `area`, between 0 and 1."

Make scope the main control, and layout parameters secondary. Depth-limited upstream/downstream focus is the established idiom in dbt (`3+my_model+4`). Degree-of-interest subgraph extraction around a node of interest (Furnas, adapted to graphs by van Ham and Perer) is the research version of the same idea; I could not quote that paper, so its support is speculative. For a 1,000+ model project, choosing what is drawn plausibly matters more than how layers are placed. An attention budget (a maximum number of cards) with focus-neighbourhood expansion is a better top-level control than any layout slider.

- [m2](https://docs.getdbt.com/reference/node-selection/graph-operators): "its ancestors up to the 3rd degree, and its descendants down to the 4th degree"

Transitive reduction as an explicit, reversible edge filter. A dependency that is also implied by a longer path adds a long edge and often a crossing without adding reachability. Transitive reduction keeps the fewest edges that give the same reachability. For lineage there is a catch: a direct edge may carry meaning (a model that really selects from both a source and its staging model). It should be shown as a dim hint, not silently dropped.

- [m4](https://en.wikipedia.org/wiki/Transitive_reduction): "is a graph with the fewest possible edges that has the same reachability relation as the original graph."

Rank hub nodes by degree and offer them as a filter or emphasis, as Kiali does with find/hide. A utility node such as a `normalize_timestamp` function is an obvious candidate: high in-degree, low information. Offer three treatments for it: hide it, keep it but with `weight` low or `routed: false` so it does not distort ranking ('soft attraction'), or de-emphasise it. These are different operations with different costs.

- [m5](https://kiali.io/docs/features/topology/): "Combined with the find/hide feature, this allows you to quickly highlight or filter for important workloads, services, and applications."
- [m6](../../packages/graph-layout/src/types.ts): "The edge is routed and returned. Defaults to true; `false` makes a pure layout constraint."

Single-column focus is a visibility mode the thesis does not list: when the table-level view is too busy, DataHub lets the user focus lineage on one column. This matches the extension's column traces.

- [m7](https://docs.datahub.com/docs/features/feature-guides/lineage): "you can visualize lineage focused on a single column by clicking on the breadcrumb on a column"

Address the 55:1 aspect ratio structurally, not with spacing sliders. ELK's wrapping option cuts a layered drawing into chunks placed side by side with wrapped edges. That is the documented answer to a drawing that is far too wide for its viewport. A mapped equivalent for this engine would be to wrap or fold layer bands, or to fold the long layer into rows. The repo's engine has no wrapping option, so this is new work, not a toggle.

- [m8](https://www.eclipse.org/elk/reference/options/org-eclipse-elk-layered-wrapping-strategy.html): "For certain graphs and certain prescribed drawing areas it may be desirable to split the laid out graph into chunks that are placed side by side."

Keep strict dbt-layer bands off by default. Layers should be soft ranks, with the bands drawn from the ranks the engine chose. The repo's spike measured that strict partitions are expensive. The same spike measured hints as the control that most improves stability: expansion displacement fell by about two thirds. A 'keep my layout stable on expand' stability control is probably worth more to a reader than any aesthetic slider.

- [m9](../../scripts/spikes/graph-layout/README.md): "Strict dbt-layer partitions cost about 40% of the density, seven times the dummies and a third more crossings, and"
- [m10](../../scripts/spikes/graph-layout/README.md): "the lineage adapter should start with `partitions: "soft"` or `"none"` and draw bands from"

Recommended panel, from the evidence read. Layout (relayout, apply or debounced): effort (fast/balanced/thorough; default balanced), partitions (soft default, none, strict), relationship and column edge weight (default about 0.3 and 0.5, as the engine already uses), spacing preset (compact/circuit), stability on expansion (default on). Safe for live adjustment only at fast effort, since 300–600 node layouts take roughly 60–460 ms in the spike; otherwise commit on release. Visibility (relayout): upstream/downstream depth, node-type and tag filters, hide selected card, utility/hub exclusion by degree threshold, transitive-reduction edge filter (off by default), folder grouping threshold. Emphasis (restyle, always live): path highlight, dim-others-on-hover, hub de-emphasis, relationship-edge visibility, column trace. Presets: named, per-view, undoable, with the metrics readout next to each. Bundling stays off by default because of the ambiguity risk. Every number in this recommendation is a starting point to measure, not a result from a usability study.

- [m11](https://arxiv.org/abs/2108.05467): "These clusters can result in ambiguous connections that do not exist in the data."
- [m12](../../scripts/spikes/graph-layout/README.md): "Pure TypeScript is fast enough: no phase needs WASM at 600 nodes."

## Open questions

- How long does a balanced-effort layout take for a full 1,000+ model project, and for a 150-card focus view, on ordinary hardware? The spike stopped at 600 nodes on a loaded machine.
- How much do soft partitions cost in density, crossings and stability relative to none? The spike did not prototype them.
- Does a card budget filled by degree of interest beat the current neighbour cap with folder grouping on real dbt tasks, such as tracing a column to its source or assessing impact, measured by time and errors?
- Which hub treatment (hide, constraint only or de-emphasise) loses the least reachability information while cutting the most crossings on real projects with utility macros or models?
- How many of the edges in real dbt projects are transitive shortcuts, and does removing them noticeably reduce crossings and edge length?
- Can restyle-only emphasis over 1,000+ React Flow cards keep the UI responsive (for example under 16 ms per frame) without virtualisation?
- Would layer wrapping or folding improve comprehension of the 55:1 drawing, or does scope limiting make it unnecessary?
- Which dagre ranker values exist? This needs a fetched, citable source.

## Rejected citations

None.
