# Research

## Question

How should a layered graph layout route edges so that node bounding boxes (and cluster boxes) are impassable obstacles, efficiently enough for 1,000-10,000+ nodes interactively? Answer three things. (1) Diagnosis: from this repository's code, explain exactly which edges in the lineage panel can pass through other cards today and why: which drawings come from the graph-layout engine (rows guarantee, levels limitation), which come from React Flow bezier fallbacks, the classic gutter router, or dagre leftToRight, and whether cluster or band boxes are treated as obstacles. Quote the code. (2) Research survey: obstacle-avoiding edge routing methods and their costs: channel/track routing between layers (Sander; Eiglsperger-Siebenhaller-Kaufmann orthogonal layered drawing), orthogonal visibility graphs and connector routing (Wybrow, Marriott, Stuckey 'Orthogonal Connector Routing', libavoid), sparse orthogonal visibility graphs (MSAGL's RectilinearEdgeRouter and sparse VG, Nachmanson et al.), spline routing around obstacles (Dobkin-Gansner-Koutsofios-North 'Implementing a General-Purpose Edge Router', Graphviz pathplan; MSAGL SplineRouter with tangent visibility), grid routers (WebCola gridrouter, Lee/A*), ELK's orthogonal router and its hyperedge handling, ordered-bundle/edge-nudging (Pupyrev-Nachmanson-Kaufmann 'Improving Layered Graph Layouts with Edge Bundling', Wybrow nudging), and incremental re-routing. For each: guarantees (can an edge ever cross a box?), complexity in nodes and edges, quality (bends, length, crossings), support for ports and hyperedges, cluster-box handling, incremental update cost, and how it fits a Sugiyama pipeline (route in channels vs route after placement). Name the files in ~/references or URLs that implement each. (3) Recommendation: what this engine should do for each mode (rows, levels, wrapped sub-rows, attraction edges, relationship edges between non-adjacent ranks, cluster boxes), what the panel should do instead of bezier fallbacks, and what a Rust implementation should use for speed (spatial indexes such as R-trees or interval trees, sweep-line visibility construction, A* with bend penalties), with the tests that would prove 'no edge crosses a box' (the engine already has metrics.overlaps).

## Recommendation

Keep the rows channel router as the main path. It is the right Sugiyama fit and is exact for nodes, as in ELK and Sander: each piece lies in one band, so it runs in near O(pieces log pieces) per band and handles ports and hyperedges. Fix its real hole first: edges cross foreign cluster boxes in most clustered graphs (177/200 in my probe). Fix it in ordering and placement by keeping long-edge dummies outside opaque foreign boxes across every rank they span, then mark those box intervals as blocked in each gap channel. Pair that with a per-box policy: lineage layer bands stay transparent, and real cluster obstacles are opaque under an ancestor-of-endpoint rule. Use a hybrid for the modes with no free channel: levels' upward or occupied-midline runs, edges between wrapped sub-rows, and non-layered attraction edges. For only those flagged pieces, run a local orthogonal router on the nodes in the affected span: a sparse scanline visibility graph as in MSAGL, A* with a bend penalty, padding, then VPSC nudging with the package's existing solver. Do not run a global visibility graph or a WebCola-style grid over 10k nodes. In the panel, retire the dagre/bezier leftToRight path by calling graph-layout with direction "right". Make the engine return a checked polyline or a routeFailed flag for every edge, self-loops included, instead of a bezier or silent removal. In Rust, use per-rank sorted arrays with binary search for rows, and interval trees or an R-tree only for the hybrid regions. Re-route incrementally only the pieces whose band or obstacle set changed. Prove it with an indexed edge-vs-node and edge-vs-opaque-box oracle (strict-interior plus clearance) applied to the drawn, rounded path. Run property tests across rows/levels, both directions, nested clusters, ports, long edges and wrapped rows. Add a check that every edge is drawn or flagged, an incremental-equals-full check, and 1k/5k/10k benchmarks.

## Points

| Point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Verdict    | Confidence |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| 1. The lineage panel cannot reach ranks "levels" today. Both graph-layout engine ids (balanced, the default, and thorough) go through optionsFor in graphLayoutEngine.ts, which fixes `ranks: "rows"` and `direction: "down"`. This depends on one literal in one adapter file. It does not make the design safe: the planned levels mode and wrapped sub-rows would expose the levels limitation by changing that one option.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | middle     | high       |
| 2. Under rows, every routed edge is a dummy chain, and each piece lies in a single inter-rank channel. That structure is why no piece can enter a non-endpoint node box, and the property test confirms it on random graphs. The guarantee is narrower than "no line through a card" in three ways. First, the metric skips the edge's own source and target boxes. Second, it uses a strict-interior test, so a piece running along a box side is not counted. Third, edges with no polyline are never measured: kinds with routed:false and self-loops. The panel also draws a post-processed path (corners rounded with radius up to 7, hop arcs), and nothing re-measures that path. The overlap check walks every box for every piece, which is O(pieces × nodes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | middle     | high       |
| 3. The levels limitation is real. Under levels, each run's horizontal part sits at the midline of the gap between its own two ends. That midline is not a shared free channel, so other nodes placed at levels inside that gap can sit on it. The README names upward runs as the failing case. The test asserts only that node-node overlaps are zero and that edge-node overlaps are above zero over 100 seeded cases; it gives no rate and no minimal case. Any fix must keep the node-node guarantee that levels already holds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | middle     | high       |
| 4. Cluster boxes are checked against nodes: the testing helper's boxViolations covers members, nesting, siblings and strangers on random clustered graphs. No check tests an edge against a cluster box. Edges do cross foreign cluster boxes today. In the panel, the layer bands are those cluster boxes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | antithesis | high       |
| 5. In the layered panel, an edge the router did not route is left out, not drawn as a bezier. So the layered failure is missing edges (self-loops, routed:false kinds, any edge without a path), not lines through cards. The bezier branch in RelationshipEdge is still live for any relationship edge that has no `routed` data. Today that is the leftToRight path, but flow.ts guards it only by the layout mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | middle     | high       |
| 6. The leftToRight layout runs dagre for node positions only. The function returns only top-left corners and drops dagre's own edge points, and no routed path is computed on that path. So its table/column edges, drawn by React Flow's default edge, and its relationship beziers ignore the cards. This is the one code path shown to draw lines through cards in the panel. The cheapest fix is to run leftToRight through graph-layout with direction "right", which the package supports, rather than to keep dagre.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | middle     | medium     |
| 7. The classic gutter router checks for obstacles on its vertical spans. It uses the corridor only when no card in the rows strictly between the two ends sits over it. Otherwise it takes the nearest clear gap between those cards (16 px margin), and otherwise an outer channel beyond the layout. Horizontal runs sit in gutters between rows, and crossings between edges are drawn as hops. It fails by omission: a column edge whose source row is below its target row is skipped. Band boxes are backgrounds, and edges cross them freely.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | antithesis | medium     |
| 8. ELK's OrthogonalRoutingGenerator, after Sander GD 2003, is a channel router between two layers. It turns hyperedges into segments, orders them with a dependency graph, assigns routing slots, and breaks critical cycles by splitting a segment. It avoids nodes because everything happens inside the inter-layer gap. It has no notion of an arbitrary obstacle such as a cluster box. The constant 16 is a crossing weight in the segment dependency graph used for slot ordering and cycle breaking, not a global quality model. Cost is per gap and grows with the segments in that gap, so it fits a Sugiyama pipeline (route in channels) and handles hyperedges and ports natively.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | antithesis | medium     |
| 9. WebCola's gridrouter builds its grid from medial axes between node centres. When routing between a and b, it treats as obstacles the siblings on the paths from a and b to their least common ancestor, so cluster (group) boxes are handled natively. It then nudges each bundle of collinear segments with a VPSC problem. Because the grid comes from the node centres, its vertex count grows with columns × rows, roughly O(n²) worst case, which rules it out at 10k nodes. Its nudging idea fits this package, which already has a VPSC constraint layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | antithesis | medium     |
| 10. Graphviz pathplan finds a shortest path inside a polygon the caller supplies. It triangulates the polygon, links triangles that share an edge, and runs a funnel. It does not search for the corridor: it is an exact smoother for a corridor someone has already computed (in dot, a corridor taken from the layered structure). In a Sugiyama pipeline it is therefore a channel method with spline output, not an independent obstacle router. The claim that dot calls routesplines once per edge is uncited.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | middle     | medium     |
| 11. libavoid (Wybrow) is a fast object-avoiding orthogonal and polyline connector router for interactive editors. It is backed by papers on orthogonal connector routing (GD 2009), incremental connector routing (GD 2005), orthogonal hyperedge routing (2012) and a faster corner-visibility method (2014). It fits route-after-placement and incremental editing. Its complexity and its ability to scale to 10k nodes are not verified here. MSAGL's rectilinear router is the better-documented reference for those properties (point 19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | middle     | medium     |
| 12. MSAGL's Routing sources are public and answer much of the survey (see points 19 and 20). The Wybrow nudging paper, Pupyrev-Nachmanson-Kaufmann ordered bundling and Dobkin et al. remain unread by either side. Claims about their exact guarantees and complexity stay speculative.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | middle     | medium     |
| 13. Per-mode plan. (a) rows: keep channel routing for nodes, and fix the cluster crossing in ordering/placement. Keep long-edge dummies out of a foreign cluster box's x-extent across every rank the box spans, using the same box-separation constraints real nodes already get. Alternatively give each box crossing a port. Then treat each opaque box's x-interval as blocked inside each gap channel. (b) levels: no shared free channel exists, so route upward runs and any run whose gap midline is occupied with a local orthogonal obstacle search (sparse visibility + A* with a bend penalty) limited to the nodes within the gap's span, and keep node-node separation unchanged. (c) wrapped sub-rows: give each sub-row a rank-like channel above and below, and send edges between sub-rows down an outer or side channel, as the classic router's outer channel does. (d) relationship edges between non-adjacent ranks: keep them as dummy chains (routed, ranks:false), as now. (e) attraction edges: give them the same dummy-chain routing; if they are not layered, give them the local obstacle search. (f) cluster boxes: an edge may enter only the boxes of ancestors of its source or target, and only boxes marked opaque. The panel's layer bands must stay transparent, because a skip edge between layers has to cross the intermediate band. | antithesis | low        |
| 14. The panel should stop using bezier fallbacks. The engine should return a polyline for every drawable edge. If no channel route exists, it should return an orthogonal fallback that is checked with the same segment-box test, plus an explicit routeFailed flag rather than silent removal. leftToRight should move to graph-layout with direction "right". Self-loops need a route, because they are currently dropped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | middle     | medium     |
| 15. Rust speed plan. Rows needs no general spatial index: a piece lies in one band, so its candidate obstacles are the nodes (and opaque box intervals) of two adjacent ranks, held as arrays sorted by x and searched by binary search, which is O(log n) per piece. A general index (R-tree, or interval trees on x for horizontal and y for vertical pieces) is needed only for levels, wrapped sub-rows and free placements. Where a visibility graph is needed, choose between exact and sparse. MSAGL's sparse scanline graph saves memory and can give suboptimal paths; a full orthogonal visibility graph can be quadratic. Build it only over the flagged region. For incremental work, re-route only pieces whose band or obstacle set changed, keyed by the existing hints.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | antithesis | medium     |
| 16. Tests. (1) Extend measureDrawing with an edge-vs-box count: an edge counts against every opaque cluster box that is not an ancestor of its source or target. That count would have caught the live rows+cluster defect. (2) Use two segment tests: a strict-interior hard check, plus a clearance check at spacing.edge for routed output. (3) Measure the drawn path after corner rounding and hops, or prove that rounding stays within the clearance. (4) Run property tests under rows, levels, both directions, nested clusters, ports, long edges and wrapped rows, plus a rows-golden check that the fix leaves the cluster-free output byte for byte. (5) Assert that every input edge is drawn or flagged. (6) Index the oracle by rank or interval tree so it can run at 10k nodes, and benchmark 1k/5k/10k. (7) Check that incremental re-routing gives the same output as a full route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | middle     | medium     |
| 17. Where users see lines through cards today: (a) leftToRight, where dagre positions nodes but the edges are default/bezier and unrouted; and (b) a latent risk in any relationship edge left without `routed` data. In the default balanced/thorough layered mode, no card crossing is shown in code or in the rows test. What does happen there is edges crossing foreign cluster/band boxes (point 4) and dropped edges (point 5). The classic engine checks vertical spans against cards (point 7). Levels would add card crossings if enabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | new        | medium     |
| 18. Cluster obstacles need a per-box policy, not one global rule. In the lineage panel, layer bands are partition-ordered clusters, so an edge from staging to marts must cross the intermediate band. Bands must be transparent, or crossable at defined ports. Only boxes the product means as walls, such as the planned cluster obstacles, should be opaque. WebCola's least-common-ancestor sibling rule is the right model for opaque nested boxes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | new        | low        |
| 19. MSAGL RectilinearEdgeRouter is a route-after-placement orthogonal router with hard obstacle avoidance and an edge-to-obstacle padding. Its bend penalty is set as a percentage of Manhattan distance. It nudges paths afterwards with ancestor sets, which is how it handles clusters, and it supports adding and removing edges for incremental work. Its sparse visibility graph is built by scanlines that follow Clarkson et al.'s O(n (log n)²) rectilinear shortest-path construction, at the cost of possibly suboptimal paths. This is the closest reference for the hybrid fallback router in a Rust port.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | new        | medium     |
| 20. MSAGL SplineRouter routes splines around shapes using a constrained Delaunay triangulation. It is a route-after-placement method for a smooth look in any mode, and a weaker fit than orthogonal channels for this engine's port/hyperedge model. Its complexity was not read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | new        | low        |

## Detail

### 1. The lineage panel cannot reach ranks "levels" today. Both graph-layout engine ids (balanced, the default, and thorough) go through optionsFor in graphLayoutEngine.ts, which fixes `ranks: "rows"` and `direction: "down"`. This depends on one literal in one adapter file. It does not make the design safe: the planned levels mode and wrapped sub-rows would expose the levels limitation by changing that one option

Verdict: middle. Confidence: high.

The conclusion is correct, but the thesis's citation (the engines.ts line) does not show the options. I read graphLayoutEngine.ts: optionsFor returns `ranks: "rows"`, and the adapter's TSDoc says it ranks on shared rows. The contract makes balanced the default engine. The antithesis is also right that this is not a safety argument, since `ranks` is an ordinary package option.

Citations:

- [r1b](../../webviews/src/modules/lineage/engine/graphLayoutEngine.ts): "The adapter's engine, ranks on shared rows, with the ordering search `effort` sets."
- [r1d](../../webviews/src/modules/lineage/engine/graphLayoutEngine.ts): "The package's options for one request: downward ranks, layers as soft partitions, the focus card as anchor."
- [r1c](../../packages/webview-contract/src/lineage.ts): "export const DEFAULT_LINEAGE_ENGINE: LineageEngine = "balanced";"

Thesis (high): The lineage panel always requests the rows rank mode from the graph-layout engine, so the levels mode is not reachable from the panel today. Both the balanced and thorough engines are built by graphLayoutEngine, which hard-codes ranks rows in its options.

Thesis citations:

- [c2](../../webviews/src/modules/lineage/engine/engines.ts): "balanced: graphLayoutEngine("balanced"),"

Antithesis: The conclusion is right, but the cited evidence does not support it. The quoted line only shows that two engine ids call graphLayoutEngine. It does not show that `ranks` is hard-coded to rows. The hard-coding is in graphLayoutEngine.ts, which the thesis never quotes.

Antithesis: 'Not reachable from the panel' holds only for this adapter. `ranks` is a normal option of the package, and the planned features (levels mode, wrapped sub-rows) would make it reachable by a one-line change. So 'the levels limitation does not reach users today' is a statement about one literal in one file. It is not a safety argument for the design.

Antithesis: c2 (`balanced: graphLayoutEngine("balanced"),`) is cited for 'hard-codes ranks rows in its options'. That line shows nothing about the options.

Counter-evidence:

- [a1](../../webviews/src/modules/lineage/engine/graphLayoutEngine.ts): "/** The adapter's engine, ranks on shared rows, with the ordering search `effort` sets. */"

### 2. Under rows, every routed edge is a dummy chain, and each piece lies in a single inter-rank channel. That structure is why no piece can enter a non-endpoint node box, and the property test confirms it on random graphs. The guarantee is narrower than "no line through a card" in three ways. First, the metric skips the edge's own source and target boxes. Second, it uses a strict-interior test, so a piece running along a box side is not counted. Third, edges with no polyline are never measured: kinds with routed:false and self-loops. The panel also draws a post-processed path (corners rounded with radius up to 7, hop arcs), and nothing re-measures that path. The overlap check walks every box for every piece, which is O(pieces × nodes)

Verdict: middle. Confidence: high.

The antithesis adds the structural reason, which the README states when it rejects grid/A* routing, and it adds the real exemptions. I verified each exemption in metrics.ts, drawingSegments.ts and types.ts. The 209 ms and 448 ms timings are the antithesis's own measurements and I did not reproduce them. The quadratic loop shape is visible in the code.

Citations:

- [r2a](../../packages/graph-layout/src/layoutResult.test.ts): "expect(result.metrics.overlaps).toBe(0);"
- [r2b](../../packages/graph-layout/README.md): "every edge here follows a dummy chain through the ranks, so each piece lies in one channel and channel routing is exact for it."
- [r2c](../../packages/graph-layout/src/metrics.ts): "id !== path.target &&"
- [r2d](../../packages/graph-layout/src/metrics.ts): "return [...drawing.boxes].filter("
- [r2e](../../packages/graph-layout/src/drawingSegments.ts): "/** Whether a segment runs through the interior of an axis-aligned box; touching its edges does not count. */"
- [r2f](../../packages/graph-layout/src/types.ts): "Absent: the edges of a kind with `routed: false`, and self-loops, which are not drawn yet."
- [r2g](../../webviews/src/modules/lineage/routeDrawing.ts): "const CORNER_RADIUS = 7;"

Thesis (medium): Under rows, edges are routed in the channels between adjacent ranks, and the rows zero-overlap guarantee is backed by a property test over random graphs. The test checks the rows overlap count against zero. I have not run it and have not proven the guarantee for all inputs, so confidence is medium.

Thesis citations:

- [c3](../../packages/graph-layout/src/layoutResult.test.ts): "expect(result.metrics.overlaps).toBe(0);"
- [c4](../../packages/graph-layout/src/route/index.ts): "Routes every routed edge through the bands between ranks."

Antithesis: 'Rows is property-tested to zero overlaps' is weaker than it sounds. `overlaps` only tests a strict-interior intersection of the polyline with every node box other than the edge's own endpoints. An edge that runs back through its own source or target box is never counted. An edge that runs exactly along a box side is never counted.

Antithesis: The metric tests the engine's raw polyline. The panel draws something else. `drawLayout` rounds corners (radius up to 7) and adds hop arcs afterwards, and nothing re-measures that output against the boxes.

Antithesis: Some edges are not in the measured set at all. Self-loops and the unrouted `rank` kind have no polyline, so they cannot violate the property. The router header says so.

Antithesis: The measurement is O(edge pieces x all nodes) because it spreads the whole box map for every piece. In my own run it took 209 ms at 1,000 nodes and 448 ms at 2,000. That is acceptable now, but it is quadratic. It cannot be the test oracle for a 10k-node Rust router without a spatial index.

Antithesis: The thesis calls the guarantee 'tested, not proven' and stops there. The better explanation is structural. Every polyline is a dummy chain with each piece inside one inter-rank band, so a piece can only touch nodes of the two adjacent ranks plus lateral stubs. The README states this and gives it as the reason for rejecting A*/grid routing. The thesis misses it. That structure is the real basis for the guarantee, and it is also why the guarantee does not extend to cluster boxes (see point 4).

Antithesis: c4 (`Routes every routed edge through the bands between ranks.`) says 'routed edge'. Edges of unrouted kinds are excluded by design, and the thesis does not note this.

Counter-evidence:

- [a2](../../packages/graph-layout/src/metrics.ts): "id !== path.target &&"
- [a3](../../packages/graph-layout/src/route/index.ts): "have no entry: self-loops are not drawn yet."
- [a4](../../packages/graph-layout/README.md): "A grid router is for free-placed nodes, which this engine does not produce."

### 3. The levels limitation is real. Under levels, each run's horizontal part sits at the midline of the gap between its own two ends. That midline is not a shared free channel, so other nodes placed at levels inside that gap can sit on it. The README names upward runs as the failing case. The test asserts only that node-node overlaps are zero and that edge-node overlaps are above zero over 100 seeded cases; it gives no rate and no minimal case. Any fix must keep the node-node guarantee that levels already holds

Verdict: middle. Confidence: high.

The thesis is accurate. The antithesis adds two things: the test asserts only a count above zero, and levels still keeps the no-node-overlap invariant. The mechanism comes from the README's description of the route: under levels there are no shared rank rows, so a gap midline is not an empty band.

Citations:

- [r3a](../../packages/graph-layout/README.md): "Routing under levels draws each run in the gap between its two ends, with its horizontal part at the gap's midline."
- [r3b](../../packages/graph-layout/README.md): "Under `ranks: "levels"` no two nodes overlap, but an edge can pass through a node it does not end at: a run that goes upward can cross other nodes."
- [r3c](../../packages/graph-layout/src/layoutResult.test.ts): "expect(edgeNode).toBeGreaterThan(0);"

Thesis (high): The levels limitation is real and documented. Under levels a run is drawn in the gap between its two ends, and a run whose lower end is not below its upper end can have a horizontal part that passes through other nodes. The package README and the test both record it. Because the panel never selects levels (point 1), this limitation does not reach users today.

Thesis citations:

- [c5](../../packages/graph-layout/README.md): "a run that goes upward can cross other nodes"
- [c6](../../packages/graph-layout/src/route/levelRoutes.ts): "A run whose lower end is not below its upper end leaves both ends from the bottom"
- [c7](../../packages/graph-layout/src/layoutResult.test.ts): "documents the levels limitation: a run can pass through a node it does not end at"

Antithesis: This point is accurate. Its gap is that it stops at 'documented'. The test asserts only that the count is greater than 0 over 100 seeded graphs. It gives no rate, no cause, and no minimal case. The question asks 'exactly which edges', and the thesis does not say which upward runs fail.

Antithesis: It does not mention that the README itself says levels still guarantees no node-node overlaps. So any fix for levels (lanes outside the rows, or a local A*) has to keep that invariant.

Counter-evidence:

- [a5](../../packages/graph-layout/README.md): "Under `ranks: "levels"` no two nodes overlap, but an edge can pass through a node it does not end at: a run that goes upward can cross other nodes."

### 4. Cluster boxes are checked against nodes: the testing helper's boxViolations covers members, nesting, siblings and strangers on random clustered graphs. No check tests an edge against a cluster box. Edges do cross foreign cluster boxes today. In the panel, the layer bands are those cluster boxes

Verdict: antithesis. Confidence: high.

I reproduced the antithesis's finding on its main point with my own probe. I ran layout() from packages/graph-layout/dist on 200 random graphs (8-37 nodes, 2-4 flat clusters, effort fast) and applied a strict-interior segment test to each cluster box that neither endpoint belongs to. Node overlaps were 0. 177 of 200 graphs had at least one edge entering a foreign cluster box: 1,703 edge-box pairs among 5,859 edges. In the sample case, a long vertical piece passed straight through a cluster box, which suggests that long-edge dummies are kept out of the member block per rank but not out of the box's rectangle. That is my inference and is not cited. This is my own measurement, not a quotable source. The thesis's "never measured" is wrong about node-vs-box checks. The adapter header confirms that the panel's bands are clusters.

Citations:

- [r4a](../../packages/graph-layout/src/testing/boxes.ts): "Pairs of a node and a box it is outside of, that overlap."
- [r4b](../../packages/graph-layout/src/metrics.ts): "overlaps: nodeOverlaps(drawing.boxes) + edgeNodeOverlaps(drawing, pieces),"
- [r4c](../../webviews/src/modules/lineage/engine/graphLayoutEngine.ts): "partition, which orders the ranks, and a cluster, whose box is the band."

Thesis (high): Obstacles are node boxes only. The overlap metric is computed over drawing.boxes, which holds the nodes, so cluster and band boxes are never counted as obstacles and are neither routed around nor measured.

Thesis citations:

- [c8](../../packages/graph-layout/src/metrics.ts): "overlaps: nodeOverlaps(drawing.boxes) + edgeNodeOverlaps(drawing, pieces),"

Antithesis: The headline 'cluster and band boxes are never measured' is false as stated. Cluster boxes are measured against nodes. `boxViolations` checks nodes against boxes they do not belong to, plus siblings, nesting and members. It runs in `route/clusters.test.ts` on random clustered graphs. What is unmeasured is edge against cluster box.

Antithesis: The thesis misses that in the lineage panel the bands ARE clusters. `toGraph` builds one cluster per layer tag, with BAND_PAD padding. So 'bands are not obstacles' is the same gap as 'clusters are not obstacles'. They are not two separate problems.

Antithesis: The most important finding is not in the thesis: edges do pass through foreign cluster boxes today. I ran `layout()` from packages/graph-layout/dist on 300 random clustered graphs. Each had 8-37 nodes and 2-4 flat clusters, `effort: fast`, and I tested each polyline against each cluster rectangle with a strict-interior test. Zero graphs had node overlaps. 265 of the 300 graphs had at least one edge entering a cluster box where neither endpoint belonged to that cluster. That was 2,506 edge-box pairs among 9,057 edges. This is my own measurement and is not a citable source. The cause follows from the README: members of a cluster stay contiguous per rank, but the box also covers the inter-rank gap. A channel run between ranks can cross the box laterally when a long-edge dummy sits left of the cluster block at one rank and right of it at the next.

Antithesis: So the thesis's 'recommendation: add the clusters to the obstacle set, with the edge's own cluster excluded' is under-specified. The correct rule is that an edge may enter only clusters that are an ancestor of its source or target. Excluding only the 'own' cluster mis-flags every cross-cluster edge in a nested hierarchy.

Antithesis: Neither the `strangers` check nor `overlaps` sees this, so the 'zero overlaps' headline gives false confidence for the cluster case.

Antithesis: c8 shows that the `overlaps` metric calls `nodeOverlaps(drawing.boxes) + edgeNodeOverlaps(...)`. That supports 'edge-vs-cluster is not measured'. It does not support 'cluster boxes are never measured', which the test helper contradicts.

Counter-evidence:

- [a6](../../packages/graph-layout/src/testing/boxes.ts): "Every rule a drawing with cluster boxes keeps, checked against the node centres and the box rectangles."
- [a7](../../packages/graph-layout/README.md): "A cluster that spans a rank with no member of its own gets a dummy there, chained to its members above and below, so that its box stays contiguous across the ranks it spans (`spines.ts`)."

### 5. In the layered panel, an edge the router did not route is left out, not drawn as a bezier. So the layered failure is missing edges (self-loops, routed:false kinds, any edge without a path), not lines through cards. The bezier branch in RelationshipEdge is still live for any relationship edge that has no `routed` data. Today that is the leftToRight path, but flow.ts guards it only by the layout mode

Verdict: middle. Confidence: high.

Both sides agree, and I confirmed it in flow.ts routedEdges and RelationshipEdge. The antithesis's extra point about missing edges holds.

Citations:

- [r5a](../../webviews/src/modules/lineage/flow.ts): "// Layered edges are drawn from the router's paths; an edge the router did not route is not drawn."
- [r5b](../../webviews/src/modules/lineage/RelationshipEdge.tsx): "Without a routed path the edge is a bezier between the handles."

Thesis (medium): In the layered panel path, an edge the router did not route is dropped, not drawn. React Flow bezier curves appear only for relationship edges that have no routed path. In the code I read, that happens on the leftToRight path, where no routed path is computed. In layered mode, unrouted relationships are removed rather than bezier-drawn.

Thesis citations:

- [c10](../../webviews/src/modules/lineage/RelationshipEdge.tsx): "Without a routed path the edge is a bezier between the handles."
- [c11](../../webviews/src/modules/lineage/flow.ts): "an edge the router did not route is not drawn."

Antithesis: This is mostly right and verified against flow.ts. It is incomplete on which layered edges still never reach the user, which is a different failure from drawing through cards. A classic column edge whose source row is below its target row is silently skipped by the gutter plan. Self-loops have no polyline in the new engine. An edge with no path is dropped. The user therefore sees missing relationships, not just wrong ones.

Antithesis: The thesis says 'bezier fallbacks appear only on leftToRight'. The bezier branch in RelationshipEdge is still live code for any relationship edge that is not routed, and flow.ts only guards it for layered mode. It is a latent path, not a dead one.

Counter-evidence:

- [a8](https://github.com/danielchawkins/vscode-dbt-power-user/blob/b187a9fc7208a6de24bdc5434bc2dcba41a9dcdb/webviews/src/modules/lineage/gutterPlan.ts): "if (ia > ib || !boxes.has(column.from) || !boxes.has(column.to)) {"
- [a9](../../webviews/src/modules/lineage/flow.ts): "// Layered edges are drawn from the router's paths; an edge the router did not route is not drawn."

### 6. The leftToRight layout runs dagre for node positions only. The function returns only top-left corners and drops dagre's own edge points, and no routed path is computed on that path. So its table/column edges, drawn by React Flow's default edge, and its relationship beziers ignore the cards. This is the one code path shown to draw lines through cards in the panel. The cheapest fix is to run leftToRight through graph-layout with direction "right", which the package supports, rather than to keep dagre

Verdict: middle. Confidence: medium.

I verified that the function returns only node corners and that placeLayered runs only in layered mode. I inferred from the code, without running it, that React Flow's default edge draws the untyped edges. The package's metrics and tests take direction down|right. Whether dagre's dropped points are node-avoiding was not verified here.

Citations:

- [r6a](../../webviews/src/modules/lineage/layout.ts): "return [id, { x: n.x - n.width / 2, y: n.y - n.height / 2 }];"
- [r6b](../../webviews/src/modules/lineage/flow.ts): "const placed = layered ? placeLayered(input, listed, heightOf) : undefined;"
- [r6c](../../packages/graph-layout/src/testing/boxes.ts): "direction: fc.constantFrom("down" as const, "right" as const),"

Thesis (medium): The leftToRight layout uses dagre only for node positions, and its edges are not routed by this engine. Table and column edges are built without a type, so React Flow's default bezier draws them, and relationship edges use the bezier fallback. Those are the lines that can pass through cards in that mode. The default-type rendering is inferred from the code; I did not run it.

Thesis citations:

- [c12](../../webviews/src/modules/lineage/layout.ts): "// dagre positions node centres."
- [c13](../../webviews/src/modules/lineage/flow.ts): "const placed = layered ? placeLayered(input, listed, heightOf) : undefined;"
- [c13b](../../webviews/src/modules/lineage/RelationshipEdge.tsx): "? [routed.d, routed.labelAt.x, routed.labelAt.y]"

Antithesis: The thesis says the dagre path 'is not routed by this engine' but leaves out the useful consequence. dagre is called with only table-to-table edges and the panel keeps only node positions. It throws away dagre's own edge points, which are dummy-chain polylines that avoid nodes. So the leftToRight bezier problem comes from discarding the data, not from a lack of it.

Antithesis: The thesis also does not say that the package already supports the right direction (`down` is a branch of its router and its tests iterate over directions). The cheapest way to retire the bezier path is therefore to run leftToRight through the package with `direction: "right"`, not to port a new router. The thesis hedges with 'route through the engine or retire'.

Counter-evidence:

- [a10](../../webviews/src/modules/lineage/layout.ts): "/** Top-left corner of each node `ids`, laid out left to right from parents to children by dagre. */"

### 7. The classic gutter router checks for obstacles on its vertical spans. It uses the corridor only when no card in the rows strictly between the two ends sits over it. Otherwise it takes the nearest clear gap between those cards (16 px margin), and otherwise an outer channel beyond the layout. Horizontal runs sit in gutters between rows, and crossings between edges are drawn as hops. It fails by omission: a column edge whose source row is below its target row is skipped. Band boxes are backgrounds, and edges cross them freely

Verdict: antithesis. Confidence: medium.

The thesis read only the header. The body contains the checks (spine, gapChannel, clearIn) and the ia > ib early return. I have not measured the classic router against all boxes, so this is medium, not high.

Citations:

- [r7a](https://github.com/danielchawkins/vscode-dbt-power-user/blob/b187a9fc7208a6de24bdc5434bc2dcba41a9dcdb/webviews/src/modules/lineage/gutterPlan.ts): "// The vertical channel for a span: the corridor when no card between the two rows sits over it; else the clear"
- [r7b](https://github.com/danielchawkins/vscode-dbt-power-user/blob/b187a9fc7208a6de24bdc5434bc2dcba41a9dcdb/webviews/src/modules/lineage/gutterPlan.ts): "const margin = 16;"
- [r7c](https://github.com/danielchawkins/vscode-dbt-power-user/blob/b187a9fc7208a6de24bdc5434bc2dcba41a9dcdb/webviews/src/modules/lineage/gutterPlan.ts): "if (ia > ib || !boxes.has(column.from) || !boxes.has(column.to)) {"
- [r7d](https://github.com/danielchawkins/vscode-dbt-power-user/blob/b187a9fc7208a6de24bdc5434bc2dcba41a9dcdb/webviews/src/modules/lineage/gutterRouter.ts): "Crossings that remain are drawn as hops: the horizontal run arcs over the vertical one."

Thesis (speculative): The classic (owned) engine routes through fixed gutters and lanes, not through an obstacle check. Declared relationships join the gutter between rows, and the router header describes a lane beside each card and an outer channel for avoiding cards. Those are design intentions, not checked guarantees. Whether the classic router actually crosses cards was not measured, so this is speculative.

Thesis citations:

- [c14](https://github.com/danielchawkins/vscode-dbt-power-user/blob/b187a9fc7208a6de24bdc5434bc2dcba41a9dcdb/webviews/src/modules/lineage/gutterPlan.ts): "cards in one row join through the gutter."
- [c15](https://github.com/danielchawkins/vscode-dbt-power-user/blob/b187a9fc7208a6de24bdc5434bc2dcba41a9dcdb/webviews/src/modules/lineage/gutterRouter.ts): "an outer channel on each side for an edge that must pass the start node's row without touching it."

Antithesis: The claim of 'no obstacle check in the code I read' is wrong, and confidence is marked speculative only because the thesis did not read the file. The classic gutter plan does check obstacles for every vertical span. It takes the central corridor only if no card in the intermediate rows overlaps it. Otherwise it searches the clear x-intervals between those rows' cards, with a 16px margin, nearest to the target. Failing that, it uses the outer channel beyond the layered bounds.

Antithesis: The classic router is therefore obstacle-aware by construction, in the same sense as the new engine. It is a channel router over row gutters, lanes beside cards and outer channels. Edges are placed on evenly spaced tracks inside their channel, so tracks cannot leave the channel. A gap of only 12px is accepted, so the cost of squeezing is edge-edge crowding, not card crossings. A test, 'routes the seed's skip edge round stg_a, which sits over the corridor', pins the case.

Antithesis: Where the classic router can still go wrong is different from what the thesis implies. It is a fixed topology: horizontal runs only in gutters between rows. Any edge forced to leave the row model is unrouted. Band boxes are backgrounds, so passing across them is allowed.

Antithesis: The thesis never says whether either engine is the source of the user's 'lines through cards'. Neither the classic router nor the rows engine is shown to produce them. The code supports bezier on leftToRight (point 6), plus the levels limitation if it were enabled. The thesis leaves this open.

Antithesis: c14 and c15 are used to claim 'design intentions, not checked guarantees'. The same files contain the checks themselves, in `spine`, `gapChannel` and `clearIn`. Quoting the header while ignoring the body is a misreading.

Counter-evidence:

- [a11](https://github.com/danielchawkins/vscode-dbt-power-user/blob/b187a9fc7208a6de24bdc5434bc2dcba41a9dcdb/webviews/src/modules/lineage/gutterPlan.ts): "The vertical channel for a span: the corridor when no card between the two rows sits over it; else the clear"
- [a12](https://github.com/danielchawkins/vscode-dbt-power-user/blob/b187a9fc7208a6de24bdc5434bc2dcba41a9dcdb/webviews/src/modules/lineage/gutterPlan.ts): "const blocked = this.ids"

### 8. ELK's OrthogonalRoutingGenerator, after Sander GD 2003, is a channel router between two layers. It turns hyperedges into segments, orders them with a dependency graph, assigns routing slots, and breaks critical cycles by splitting a segment. It avoids nodes because everything happens inside the inter-layer gap. It has no notion of an arbitrary obstacle such as a cluster box. The constant 16 is a crossing weight in the segment dependency graph used for slot ordering and cycle breaking, not a global quality model. Cost is per gap and grows with the segments in that gap, so it fits a Sugiyama pipeline (route in channels) and handles hyperedges and ports natively

Verdict: antithesis. Confidence: medium.

I fetched the ELK source and found the constant, its comment, the slot assignment and the cycle splitting. The per-gap cost is read from the structure, not from a stated bound.

Citations:

- [r8a](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal/OrthogonalRoutingGenerator.java): "private static final int CROSSING_PENALTY = 16;"
- [r8b](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal/OrthogonalRoutingGenerator.java): "Finds and breaks critical cycles to avoid edge overlaps."
- [r8c](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal/OrthogonalRoutingGenerator.java): "Georg Sander. Layout of directed hypergraphs with orthogonal hyperedges."

Thesis (speculative): Channel routing between ranks (Sander, as implemented in ELK's orthogonal router) places each edge's horizontal run in the free band between ranks. It avoids boxes by construction, through the dummy chains, rather than by an obstacle-aware search. ELK weights crossings at 16 in its penalty model.

Antithesis: This point has no citation although the file was easy to quote. The claim is right and is unsupported only through the thesis's own omission.

Antithesis: 'Avoids boxes only by construction' is true in ELK for the same reason as in this engine: the router works inside the gap between layers. ELK's router is for hyperedges (segments in slots), not general-obstacle search, so it has no way to treat an arbitrary cluster box as an obstacle. The thesis does not say this, and it is the key point for the cluster question.

Antithesis: The 16 CROSSING_PENALTY is used to break cycles in the segment dependency graph, not as a global quality weight. Presenting it as 'ELK's penalty model' overstates it.

Counter-evidence:

- [a13](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal/OrthogonalRoutingGenerator.java): "private static final int CROSSING_PENALTY = 16;"
- [a14](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal/OrthogonalRoutingGenerator.java): "Georg Sander. Layout of directed hypergraphs with orthogonal hyperedges."

### 9. WebCola's gridrouter builds its grid from medial axes between node centres. When routing between a and b, it treats as obstacles the siblings on the paths from a and b to their least common ancestor, so cluster (group) boxes are handled natively. It then nudges each bundle of collinear segments with a VPSC problem. Because the grid comes from the node centres, its vertex count grows with columns × rows, roughly O(n²) worst case, which rules it out at 10k nodes. Its nudging idea fits this package, which already has a VPSC constraint layer

Verdict: antithesis. Confidence: medium.

I fetched gridrouter.ts and confirmed the medial-axis grid, the sibling-obstacle rule and the VPSC nudging. The O(n²) is inferred from how the grid is built, not stated in the source.

Citations:

- [r9a](https://raw.githubusercontent.com/tgdwyer/WebCola/master/src/gridrouter.ts): "// medial axes between node centres and also boundary lines for the grid"
- [r9b](https://raw.githubusercontent.com/tgdwyer/WebCola/master/src/gridrouter.ts): "// paths from a and b to their least common ancestor are obstacles"
- [r9c](https://raw.githubusercontent.com/tgdwyer/WebCola/master/src/gridrouter.ts): "// for all segments in this bundle create a vpsc problem such that"

Thesis (speculative): A grid router (WebCola gridrouter) is obstacle-aware on a grid built from medial axes between node centres. Its obstacles are the sibling nodes in the group hierarchy, not all nodes, and it gives hard obstacle avoidance per edge at a cost that scales with grid lines and a per-edge search. It does not fit the layered layout's port and hyperedge model without adaptation.

Antithesis: This is pure assertion with no citation. The claim that WebCola obstacles are 'the sibling nodes in the group hierarchy' is right, and the source says so in a comment. The thesis misses what that implies: WebCola's grid router handles cluster boxes natively (groups have boundary vertices and routing passes through the common ancestor), and it nudges parallel segments with a VPSC solve.

Antithesis: The thesis calls this 'a cost that scales with grid lines'. The grid is built from medial axes between all node centres, so the vertex count is roughly the number of columns times the number of rows, i.e. O(n^2) for n nodes in the worst case. That is the actual reason it is wrong for 10k nodes, and the thesis never says it.

Antithesis: The package already contains VPSC and constraint solving (`constraints/`, README placement row). The nudging idea from WebCola therefore fits this engine more cheaply than a grid router.

Counter-evidence:

- [a15](https://raw.githubusercontent.com/tgdwyer/WebCola/master/src/gridrouter.ts): "// when finding a path between two nodes a and b, siblings of a and b on the"
- [a16](https://raw.githubusercontent.com/tgdwyer/WebCola/master/src/gridrouter.ts): "// medial axes between node centres and also boundary lines for the grid"

### 10. Graphviz pathplan finds a shortest path inside a polygon the caller supplies. It triangulates the polygon, links triangles that share an edge, and runs a funnel. It does not search for the corridor: it is an exact smoother for a corridor someone has already computed (in dot, a corridor taken from the layered structure). In a Sugiyama pipeline it is therefore a channel method with spline output, not an independent obstacle router. The claim that dot calls routesplines once per edge is uncited

Verdict: middle. Confidence: medium.

I verified the shortest.c quotes. The corridor-supplied framing follows from the function's contract. I did not read dotgen's call sites.

Citations:

- [r10a](https://gitlab.com/graphviz/graphviz/-/raw/main/lib/pathplan/shortest.c): "Find a shortest path contained in the polygon polyp going between the"
- [r10b](https://gitlab.com/graphviz/graphviz/-/raw/main/lib/pathplan/shortest.c): "connect all pairs of triangles that share an edge"

Thesis (medium): Graphviz pathplan computes a shortest path inside a polygon by triangulating it, connecting triangles through shared edges, marking the strip between the endpoints, and running a funnel. This is the spline-around-obstacles method, exact for one polygon. The dot layout calls routesplines once per edge.

Thesis citations:

- [c20](https://gitlab.com/graphviz/graphviz/-/raw/main/lib/pathplan/shortest.c): "Find a shortest path contained in the polygon polyp going between the"
- [c21](https://gitlab.com/graphviz/graphviz/-/raw/main/lib/pathplan/shortest.c): "connect all pairs of triangles that share an edge"

Antithesis: Graphviz pathplan is correct but peripheral. It is a per-edge exact shortest path in a polygon (or a corridor of boxes) that the caller supplies. It does not search for the corridor. dot builds the corridor from the layered structure, so it is also a route-in-channels method with an exact smoother. The thesis presents it as an independent 'spline around obstacles' method without saying that it needs a precomputed obstacle-free polygon.

Antithesis: 'The dot layout calls routesplines once per edge' has no citation, though the two shortest.c quotes support the funnel claim.

### 11. libavoid (Wybrow) is a fast object-avoiding orthogonal and polyline connector router for interactive editors. It is backed by papers on orthogonal connector routing (GD 2009), incremental connector routing (GD 2005), orthogonal hyperedge routing (2012) and a faster corner-visibility method (2014). It fits route-after-placement and incremental editing. Its complexity and its ability to scale to 10k nodes are not verified here. MSAGL's rectilinear router is the better-documented reference for those properties (point 19)

Verdict: middle. Confidence: medium.

The thesis read only the GitHub description. I read the libavoid documentation page, which confirms its purpose and lists the incremental and hyperedge papers. I did not read the papers themselves.

Citations:

- [r11a](https://www.adaptagrams.org/documentation/libavoid.html): "libavoid is a cross-platform C++ library providing fast, object-avoiding orthogonal and polyline connector routing for use in interactive diagram editors."
- [r11b](https://www.adaptagrams.org/documentation/libavoid.html): "Incremental connector routing."

Thesis (medium): libavoid is a library for object-avoiding orthogonal connector routing and is the closest match to a box-avoiding orthogonal router with ports. Its cost model and hyperedge handling were not verified; I read only the project description.

Thesis citations:

- [c23](https://github.com/mjwybrow/adaptagrams): "a library providing high-quality object-avoiding polyline"
- [c24](https://github.com/mjwybrow/adaptagrams): "Libraries for constraint-based layout and connector routing for diagrams."

Antithesis: The thesis read only the repository's one-line description. It calls libavoid 'the closest match' without evidence about its guarantees, complexity or incremental behaviour, which are exactly what the question asks for. I could not verify them in the sources I read either. I can say, from the code I read, that MSAGL's rectilinear router offers the same capabilities (obstacle padding, bend penalty, sparse graph, nudging) and is a better documented reference. See the missed alternatives.

### 12. MSAGL's Routing sources are public and answer much of the survey (see points 19 and 20). The Wybrow nudging paper, Pupyrev-Nachmanson-Kaufmann ordered bundling and Dobkin et al. remain unread by either side. Claims about their exact guarantees and complexity stay speculative

Verdict: middle. Confidence: medium.

The antithesis is right that MSAGL did not have to stay unverified, and I fetched it as well. Neither side read the papers.

Citations:

- [r12a](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "Nudger.NudgePaths(edgePaths, EdgeSeparation, PaddedObstacles, ancestorSets, RemoveStaircases);"

Thesis (speculative): Not verified: MSAGL RectilinearEdgeRouter and its sparse visibility graph (the local MSAGL checkout is sparse and excludes the Routing folder); Wybrow's orthogonal connector routing and nudging; the Pupyrev–Nachmanson–Kaufmann bundling paper; Dobkin et al.'s general-purpose edge router; and Nachmanson's sparse visibility graph. I have no citations for their guarantees, complexity or quality, so any claim about them is speculative and must be checked before use.

Antithesis: The thesis gives up on the survey's central part: MSAGL, Wybrow and Pupyrev are left unverified. The Routing sources are public, so the claim 'the local checkout is sparse' is no reason to leave them unread. I fetched the MSAGL sources and found direct answers to the survey question (see missed alternatives).

Antithesis: I did not fetch the Wybrow, Pupyrev or Dobkin papers either, so those remain unverified in this reply too.

Counter-evidence:

- [a18](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "but may select suboptimal paths</param>"
- [a19](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "Nudger.NudgePaths(edgePaths, EdgeSeparation, PaddedObstacles, ancestorSets, RemoveStaircases);"

### 13. Per-mode plan. (a) rows: keep channel routing for nodes, and fix the cluster crossing in ordering/placement. Keep long-edge dummies out of a foreign cluster box's x-extent across every rank the box spans, using the same box-separation constraints real nodes already get. Alternatively give each box crossing a port. Then treat each opaque box's x-interval as blocked inside each gap channel. (b) levels: no shared free channel exists, so route upward runs and any run whose gap midline is occupied with a local orthogonal obstacle search (sparse visibility + A* with a bend penalty) limited to the nodes within the gap's span, and keep node-node separation unchanged. (c) wrapped sub-rows: give each sub-row a rank-like channel above and below, and send edges between sub-rows down an outer or side channel, as the classic router's outer channel does. (d) relationship edges between non-adjacent ranks: keep them as dummy chains (routed, ranks:false), as now. (e) attraction edges: give them the same dummy-chain routing; if they are not layered, give them the local obstacle search. (f) cluster boxes: an edge may enter only the boxes of ancestors of its source or target, and only boxes marked opaque. The panel's layer bands must stay transparent, because a skip edge between layers has to cross the intermediate band

Verdict: antithesis. Confidence: low.

The thesis restated the goal without a mechanism. The antithesis supplies one, and my probe confirms that the rows+cluster case is a live defect, not something that needs only measuring. The transparent/opaque split for bands is my own inference from the adapter: bands are partition-ordered clusters, so stacked layers force crossings. The design itself is untested.

Citations:

- [r13a](../../packages/graph-layout/README.md): "A cluster that spans a rank with no member of its own gets a dummy there, chained to its members above and below, so that its box stays contiguous across the ranks it spans (`spines.ts`)."
- [r13b](https://github.com/danielchawkins/vscode-dbt-power-user/blob/b187a9fc7208a6de24bdc5434bc2dcba41a9dcdb/webviews/src/modules/lineage/gutterRouter.ts): "an outer channel on each side for an edge that must pass the start node's row without touching it."

Thesis (speculative): Recommendation per mode. rows: keep channel routing, and add cluster and band boxes to the obstacle set in the metric. levels: route upward runs in lanes outside the rows rather than through them, and forbid a run's horizontal part from entering any node box. relationship edges between non-adjacent ranks: route them through channels around the dummy chain, as the layered path already does. attraction edges and cluster boxes: treat both as obstacles in the same measurement. wrapped sub-rows: give each sub-row its own channel set.

Antithesis: The per-mode recommendations are uncited and thin. 'Give each sub-row its own channel set' and 'forbid a horizontal part from entering any node box' restate the goal and give no mechanism.

Antithesis: rows with cluster boxes is the live bug (point 4), but the thesis proposes only to measure it. Measuring does not stop edges crossing a box. The fix has to be either in ordering and placement (keep long-edge dummies out of foreign blocks, or give each cluster boundary crossing a port) or a routing step that treats the box's x-extent as blocked in each gap channel.

Antithesis: For levels there is no discussion of why an upward run fails, i.e. there is no free channel: nodes occupy the rows the run needs. That is the case where a local obstacle router is justified. Rows is the case where it is not.

### 14. The panel should stop using bezier fallbacks. The engine should return a polyline for every drawable edge. If no channel route exists, it should return an orthogonal fallback that is checked with the same segment-box test, plus an explicit routeFailed flag rather than silent removal. leftToRight should move to graph-layout with direction "right". Self-loops need a route, because they are currently dropped

Verdict: middle. Confidence: medium.

The thesis's direction is right. The antithesis correctly objects that "hide" loses relationships, and the dropped-edge cases are confirmed in types.ts and flow.ts.

Citations:

- [r14a](../../webviews/src/modules/lineage/RelationshipEdge.tsx): "? [routed.d, routed.labelAt.x, routed.labelAt.y]"
- [r14b](../../packages/graph-layout/src/types.ts): "Absent: the edges of a kind with `routed: false`, and self-loops, which are not drawn yet."

Thesis (medium): The panel should stop drawing bezier fallbacks. Every drawn edge should come from the engine's routed path, and unrouted edges should be reported or hidden explicitly, not drawn as a bezier through cards. The leftToRight mode should route its edges through the same engine or be retired.

Thesis citations:

- [c25](../../webviews/src/modules/lineage/RelationshipEdge.tsx): "? [routed.d, routed.labelAt.x, routed.labelAt.y]"

Antithesis: 'Report or hide unrouted edges' is not what a user wants. With 'hide' the user simply loses a relationship (see point 5). The better rule is that the engine returns a routed polyline for every drawable edge, with a defined degraded form: a straight orthogonal fallback that is checked against the boxes with the same segment test, and a 'routeFailed' flag if even that fails.

Antithesis: c25 is the same line as c13b. It shows the fallback branch exists. It does not support 'should stop drawing bezier'.

### 15. Rust speed plan. Rows needs no general spatial index: a piece lies in one band, so its candidate obstacles are the nodes (and opaque box intervals) of two adjacent ranks, held as arrays sorted by x and searched by binary search, which is O(log n) per piece. A general index (R-tree, or interval trees on x for horizontal and y for vertical pieces) is needed only for levels, wrapped sub-rows and free placements. Where a visibility graph is needed, choose between exact and sparse. MSAGL's sparse scanline graph saves memory and can give suboptimal paths; a full orthogonal visibility graph can be quadratic. Build it only over the flagged region. For incremental work, re-route only pieces whose band or obstacle set changed, keyed by the existing hints

Verdict: antithesis. Confidence: medium.

The thesis gave a list with no cost argument. I verified MSAGL's sparse-graph trade-off and its add/remove-edge API. The quadratic size of a full visibility graph is standard but uncited here. The per-band binary search follows from the dummy-chain structure the README states.

Citations:

- [r15a](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "If true, use a sparse visibility graph, which saves memory for large graphs"
- [r15b](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "public void RemoveEdgeGeometryToRoute(EdgeGeometry edgeGeometry) {"

Thesis (speculative): For speed in a Rust port: index boxes with an R-tree or interval trees for segment-box queries, build visibility by a sweep line over obstacle edges, and run A* over the visibility graph with a bend penalty. These are standard choices, not verified against the sources above.

Antithesis: The speed recommendation is a list of buzzwords with no cost argument. For rows no R-tree is needed. A piece lies in one inter-rank band, so the candidate obstacles are the nodes of the two adjacent ranks, found by rank index and a sorted-by-x array with binary search. Only levels, wrapped sub-rows and non-layered placements (where nodes are free in both axes) need a general spatial index.

Antithesis: Where a visibility graph is needed, the real problem is size, not the index. A full orthogonal visibility graph has O(n^2) edges worst case. MSAGL says in its parameter comment that the sparse graph 'saves memory for large graphs but may select suboptimal paths'. So a Rust design has to choose between exact and sparse, and the thesis does not present that trade-off.

Antithesis: It also ignores incremental update, which the question explicitly asks about. MSAGL's router exposes add and remove of an edge geometry, and the engine already keeps `hints` between runs. The sensible rule is to re-route only the pieces whose band or obstacle set changed.

Counter-evidence:

- [a20](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "public void RemoveEdgeGeometryToRoute(EdgeGeometry edgeGeometry) {"
- [a21](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/SparseVisibilityGraphGenerator.cs): "// a. Accumulates the vertices and generates obstacle-related Steiner points."

### 16. Tests. (1) Extend measureDrawing with an edge-vs-box count: an edge counts against every opaque cluster box that is not an ancestor of its source or target. That count would have caught the live rows+cluster defect. (2) Use two segment tests: a strict-interior hard check, plus a clearance check at spacing.edge for routed output. (3) Measure the drawn path after corner rounding and hops, or prove that rounding stays within the clearance. (4) Run property tests under rows, levels, both directions, nested clusters, ports, long edges and wrapped rows, plus a rows-golden check that the fix leaves the cluster-free output byte for byte. (5) Assert that every input edge is drawn or flagged. (6) Index the oracle by rank or interval tree so it can run at 10k nodes, and benchmark 1k/5k/10k. (7) Check that incremental re-routing gives the same output as a full route

Verdict: middle. Confidence: medium.

The thesis's plan was the right base. The antithesis's corrections (ancestor rule instead of own-cluster rule, clearance, measuring the drawn output) are supported by the code I read.

Citations:

- [r16a](../../packages/graph-layout/src/metrics.ts): "interior area, plus edge and node pairs where a piece of the edge runs through a node it does not end at."
- [r16b](../../packages/graph-layout/src/drawingSegments.ts): "/** Whether a segment runs through the interior of an axis-aligned box; touching its edges does not count. */"

Thesis (medium): Tests that would prove no edge crosses a box: extend measureDrawing so that cluster and band boxes are obstacles, with the edge's own cluster excluded; add a strict-interior segment-box test; run property tests under both rows and levels, not only rows; and benchmark at 1k, 5k and 10k nodes. The existing metric already counts edge pieces that run through a node box, so it is the natural place to start.

Thesis citations:

- [c27](../../packages/graph-layout/src/metrics.ts): "plus edge and node pairs where a piece of the edge runs through a node it does not end at."

Antithesis: The test plan is the best point in the thesis, but it carries the 'own cluster excluded' error from point 4 and leaves out the tests that would actually have caught the live bug.

Antithesis: A strict-interior test does not prove 'no edge crosses a box'. A polyline that runs along a box side, or that touches a corner and then continues, passes it. Use a clearance test (padding > 0) for the routed output and keep the strict test for the hard check.

Antithesis: The measured polyline must be the one that is drawn: run the test after rounding and hopping, or prove that rounding stays inside the clearance.

Antithesis: A property test must generate clustered graphs with nested clusters, ports, long edges and wrapped rows. The existing rows test uses cases from `routeCaseArb`/`caseArb`, and I have not shown that those include enough cluster-spanning edges to catch the failure. My ad-hoc run found it in 265 of 300 graphs.

Antithesis: The benchmark gate should compare the incremental path with the full path for equivalence.

Counter-evidence:

- [a22](../../packages/graph-layout/src/metrics.ts): "interior area, plus edge and node pairs where a piece of the edge runs through a node it does not end at."
- [a23](../../packages/graph-layout/src/drawingSegments.ts): "/** Whether a segment runs through the interior of an axis-aligned box; touching its edges does not count. */"

### 17. Where users see lines through cards today: (a) leftToRight, where dagre positions nodes but the edges are default/bezier and unrouted; and (b) a latent risk in any relationship edge left without `routed` data. In the default balanced/thorough layered mode, no card crossing is shown in code or in the rows test. What does happen there is edges crossing foreign cluster/band boxes (point 4) and dropped edges (point 5). The classic engine checks vertical spans against cards (point 7). Levels would add card crossings if enabled

Verdict: new. Confidence: medium.

This combines points 1, 4, 5, 6 and 7 to answer the user's "exactly which edges" question directly. The leftToRight rendering is inferred from code, not observed.

Citations:

- [r17a](../../webviews/src/modules/lineage/layout.ts): "// dagre positions node centres."
- [r17b](../../webviews/src/modules/lineage/flow.ts): "// Layered edges are drawn from the router's paths; an edge the router did not route is not drawn."

### 18. Cluster obstacles need a per-box policy, not one global rule. In the lineage panel, layer bands are partition-ordered clusters, so an edge from staging to marts must cross the intermediate band. Bands must be transparent, or crossable at defined ports. Only boxes the product means as walls, such as the planned cluster obstacles, should be opaque. WebCola's least-common-ancestor sibling rule is the right model for opaque nested boxes

Verdict: new. Confidence: low.

I infer this from the adapter, where the layer is both the partition and the cluster, and from WebCola's obstacle rule. Neither side raised it. Treating all bands as impassable would make many lineage drawings infeasible.

Citations:

- [r18a](../../webviews/src/modules/lineage/engine/graphLayoutEngine.ts): "partition, which orders the ranks, and a cluster, whose box is the band."
- [r18b](https://raw.githubusercontent.com/tgdwyer/WebCola/master/src/gridrouter.ts): "// paths from a and b to their least common ancestor are obstacles"

### 19. MSAGL RectilinearEdgeRouter is a route-after-placement orthogonal router with hard obstacle avoidance and an edge-to-obstacle padding. Its bend penalty is set as a percentage of Manhattan distance. It nudges paths afterwards with ancestor sets, which is how it handles clusters, and it supports adding and removing edges for incremental work. Its sparse visibility graph is built by scanlines that follow Clarkson et al.'s O(n (log n)²) rectilinear shortest-path construction, at the cost of possibly suboptimal paths. This is the closest reference for the hybrid fallback router in a Rust port

Verdict: new. Confidence: medium.

I fetched RectilinearEdgeRouter.cs and SparseVisibilityGraphGenerator.cs and confirmed every quoted passage. I did not read the per-query path-search cost.

Citations:

- [r19a](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "The relative penalty of a bend, representated as a percentage of the Manhattan distance between"
- [r19b](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "If an edge does not connect to an obstacle it should stay away from it at least at the padding distance"
- [r19c](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/SparseVisibilityGraphGenerator.cs): "Rectilinear shortest paths through polygonal obstacles in O(n (log n)2) time"
- [r19d](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/SparseVisibilityGraphGenerator.cs): "// 2. Run a scanline (in each direction) that:"

### 20. MSAGL SplineRouter routes splines around shapes using a constrained Delaunay triangulation. It is a route-after-placement method for a smooth look in any mode, and a weaker fit than orthogonal channels for this engine's port/hyperedge model. Its complexity was not read

Verdict: new. Confidence: low.

I verified only the header lines.

Citations:

- [r20a](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/SplineRouter.cs): "/// routing splines around shapes"
- [r20b](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/SplineRouter.cs): "using Microsoft.Msagl.Routing.ConstrainedDelaunayTriangulation;"

## Alternatives the thesis missed

Fix cluster boxes in ordering and placement, not in the router. Cluster boxes are crossed by edges today because a cluster stays contiguous per rank but the box also covers the gaps between ranks, so a channel run can cross it. The fix is to treat every rank-crossing of a box as a node-like object: either keep long-edge dummies outside foreign blocks across consecutive ranks, or give each box boundary crossing a port. The engine already creates dummies for clusters that span ranks with no member, so the machinery exists. An edge may enter only a cluster that is an ancestor of its source or target. This keeps the channel router unchanged. (My probe over 300 clustered graphs found foreign-cluster entry in 265.)

- [m1](../../packages/graph-layout/README.md): "A cluster that spans a rank with no member of its own gets a dummy there, chained to its members above and below, so that its box stays contiguous across the ranks it spans (`spines.ts`)."

Hybrid routing: use channels for everything (cost near O(pieces log pieces) per band) and run an obstacle router only for pieces the interval index flags (levels' upward runs, wrapped sub-rows, edges entering a foreign box). MSAGL's rectilinear router supports exactly this shape: a padded obstacle set per call, a bend penalty set as a percentage of Manhattan distance, and a separate nudging step that spaces parallel segments afterwards. A Rust port can run it on the small flagged set. This avoids paying a visibility graph over 10k nodes.

- [m2](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "The relative penalty of a bend, representated as a percentage of the Manhattan distance between"
- [m3](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "If an edge does not connect to an obstacle it should stay away from it at least at the padding distance"

Sparse orthogonal visibility graph by a scanline, as in MSAGL. It enumerates obstacle vertices, runs a scanline in each direction to build ScanSegments and Steiner points, then finds the sparse intersections by binary division. The authors state the cost is memory saved at the price of possibly suboptimal paths. This is the direct answer to 'sweep-line visibility construction' for the Rust port. A full graph is the other end of the trade-off.

- [m4](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/SparseVisibilityGraphGenerator.cs): "// 2. Run a scanline (in each direction) that:"
- [m5](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs): "but may select suboptimal paths</param>"

Spline routing around shapes with a cone angle and tight/loose padding polylines: MSAGL's SplineRouter keeps two polylines per shape (a tight one and a loose one) and uses a constrained Delaunay triangulation and optional bundling settings. It routes around shapes rather than through channels, so it works after placement for any mode. It is the stronger fit for a smooth look and the weaker fit for orthogonal output. (I read its header only, not its complexity.)

- [m6](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/SplineRouter.cs): "/// routing splines around shapes"
- [m7](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Routing/SplineRouter.cs): "using Microsoft.Msagl.Routing.ConstrainedDelaunayTriangulation;"

Reuse the engine's own VPSC for nudging instead of adding an A* router everywhere: WebCola's grid router builds a VPSC problem per bundle of co-linear segments with separation constraints from a partial order over edges (the same idea as Wybrow nudging). The package already ships a VPSC solver and constraint layer. For wrapped sub-rows or attraction edges, a route-then-nudge pipeline over the placed boxes would reuse that code.

- [m8](https://raw.githubusercontent.com/tgdwyer/WebCola/master/src/gridrouter.ts): "// for all segments in this bundle create a vpsc problem such that"

Panel-side alternative to bezier: keep dagre but use its edge polylines (it computes them through dummy chains), or run leftToRight through the package with direction right. The panel today discards every dagre edge, so the bezier is a self-inflicted loss of already-computed routes.

- [m9](../../webviews/src/modules/lineage/layout.ts): "// dagre positions node centres."

A test oracle for 10k nodes that does not need a quadratic check: query only the nodes of the ranks a piece touches (rows), or an interval tree keyed on x for horizontal pieces and on y for vertical pieces (other modes). The present `measureDrawing` takes about 0.2 s at 1,000 nodes and 0.45 s at 2,000 in my run, so the oracle itself needs an index before it can serve as a Rust benchmark.

- [m10](../../packages/graph-layout/src/metrics.ts): "return [...drawing.boxes].filter("

## Open questions

- Exactly why do dummies enter foreign cluster boxes: are long-edge dummies excluded from the cluster-box separation constraints in placement, or does the box rectangle simply over-cover ranks where the cluster block is narrow? A minimal failing case from the 177/200 probe would settle it.
- Does the panel's real input (layer bands plus one cluster per Other card) produce edges through Other-card clusters, which are effectively cards, as opposed to transparent layer bands?
- Does corner rounding (radius up to 7) with spacing.edge 6 ever push a drawn path inside a box that the raw polyline cleared?
- Under levels, what fraction of edges fail, and is the failing set exactly the upward runs, or also downward runs whose gap midline is occupied?
- What do libavoid's and MSAGL's routers cost per query and per incremental move at 1k-10k obstacles, and how many paths does sparse-graph suboptimality affect? This needs a benchmark or the Wybrow and Nachmanson papers.
- Are dagre's discarded edge points node-avoiding enough to be a stopgap for leftToRight before the switch to direction "right"?
- What exact guarantees do Pupyrev-Nachmanson-Kaufmann ordered bundling and Dobkin et al.'s router give? Neither paper was read.

## Rejected citations

- thesis c1 (webviews/src/modules/lineage/engine/graphLayoutEngine.ts): quote not found in the source: "The package's options for one request: downward ranks, layers as soft partitions, the focus card as anchor. */ function optionsFor( request: LayoutRequest, effort: GraphLayoutEffort, ): LayoutOptions { ranks: "rows","
- thesis c16 (/Users/daniel/references/elk/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal/OrthogonalRoutingGenerator.java): source could not be fetched or read: "Edge routing implementation that creates orthogonal bend points."
- thesis c17 (/Users/daniel/references/elk/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal/OrthogonalRoutingGenerator.java): source could not be fetched or read: "private static final int CROSSING_PENALTY = 16;"
- thesis c18 (/Users/daniel/references/webcola/src/gridrouter.ts): source could not be fetched or read: "medial axes between node centres and also boundary lines for the grid"
- thesis c19 (/Users/daniel/references/webcola/src/gridrouter.ts): source could not be fetched or read: "paths from a and b to their least common ancestor are obstacles"
- thesis c22 (/Users/daniel/references/graphviz/lib/dotgen/dotsplines.c): source could not be fetched or read: "ps = routesplines(P, &pn);"
