# Research

## Question

Which open-source repositories contain code worth studying for making a layered (Sugiyama-style) graph layout fast on large graphs (1,000 to 10,000+ nodes) and for drawing such graphs interactively in a browser? Cover: (a) layered layout engines and their performance techniques: crossing minimisation at scale (sifting, multilevel, layer-sweep variants), network-simplex ranking, Brandes-Köpf or quadratic placement, orthogonal or channel edge routing, compound/cluster handling, and incremental or hint-driven relayout that reuses a previous result; (b) native or WASM implementations (Rust, C++, Zig) usable from TypeScript/Node/VS Code webviews; (c) ways to keep huge layered drawings readable: grouping/collapsing, edge bundling, de-emphasising high-degree nodes, overview-plus-detail, viewport culling and level-of-detail rendering (React Flow, Sigma.js, Cytoscape.js, WebGL renderers); (d) existing dbt or data-lineage viewers that handle large projects. For each repository give: URL, licence, language, the specific files or modules that implement the relevant technique, and why it is worth reading here. Rank by relevance to this package (packages/graph-layout, a TypeScript layered layout with ports, partitions, clusters and hints, and a possible Rust port). Do not weight options by who suggested them. After the report, the orchestrator will clone the top repositories into ~/references, so give a clone command for each recommended one.

## Recommendation

I checked the disputed evidence against the sources, but I benchmarked nothing, so every speed figure here is unmeasured. Before any work with external engines, compare ranks "rows" with ranks "levels" on the 1,122-node graph, and add grouping or semantic zoom, because none of these engines fixes the width by itself. Study the repositories in this order, by relevance to packages/graph-layout. (1) ELK (Java, EPL-2.0 OR GPL-3.0-or-later): read p3order/, intermediate/greedyswitch/, p2layers/NetworkSimplexLayerer.java, p4nodes/bk/BKNodePlacer.java and p5edges/orthogonal/. It is the design reference for ports and hierarchy, but its interactive mode only keeps node order, and its layered plugin has no sifting or multilevel ordering. (2) elkjs (EPL) and elk-rs (Rust, native Node addon with WASM fallback, EPL-2.0 OR GPL-3.0-or-later): use them as benchmarks on the same input and as possible optional backends, not as code to copy. Marquez's useLayout.ts shows a working pattern for running elkjs in a worker for lineage. (3) MSAGL (MIT, C#): RecoveryLayeredLayoutEngine.cs and the incremental Sugiyama path are the main permissive lead for relayout, though the test I read covers resizing only. (4) Current dagre (MIT, TypeScript): lib/layout.ts now has recursive cluster layout and reuses the previous layout (useDynamic); lib/position/bk.ts and lib/order/index.ts cover Brandes-Köpf and the sweeps. Audit it at a pinned commit, because the file changed between two of my fetches. (5) d3-dag (MIT, TypeScript): layering/simplex.ts, with rank and group constraints, and coord/quad.ts. Avoid decross/opt.ts at this scale. (6) OGDF (GPL): read SiftingHeuristic.cpp only. (7) Graphviz (EPL): lib/dotgen/mincross.c for crossing reduction with clusters; run it through hpcc-js-wasm for benchmarking. (8) WebCola (MIT): src/vpsc.ts, src/powergraph.ts and src/gridrouter.ts. (9) rust-sugiyama and rust-dagre (MIT): a skeleton for a Rust port, and a pattern for shipping a Rust engine as both a Node addon and WASI. (10) Rendering: React Flow (onlyRenderVisibleElements), the Cytoscape.js performance guide's advice on labels and edges, Sigma.js (WebGL), G6, and cosmos.gl for a GPU overview only. (11) Lineage viewers: DataHub lineageV3 (bounding boxes, filters, expansion), Marquez (elkjs layered in a web worker), dbt-docs (cytoscape-dagre). Clone commands: git clone --depth 1 <https://github.com/eclipse-elk/elk.git> ~/references/elk; git clone <https://github.com/kieler/elkjs.git> ~/references/elkjs; git clone <https://github.com/openedges/elk-rs.git> ~/references/elk-rs; git clone --depth 1 <https://github.com/microsoft/automatic-graph-layout.git> ~/references/msagl; git clone <https://github.com/dagrejs/dagre.git> ~/references/dagre; git clone <https://github.com/erikbrinkman/d3-dag.git> ~/references/d3-dag; git clone --depth 1 <https://github.com/ogdf/ogdf.git> ~/references/ogdf; git clone --depth 1 <https://gitlab.com/graphviz/graphviz.git> ~/references/graphviz; git clone <https://github.com/hpcc-systems/hpcc-js-wasm.git> ~/references/hpcc-js-wasm; git clone <https://github.com/tgdwyer/WebCola.git> ~/references/WebCola; git clone <https://github.com/paddison/rust-sugiyama.git> ~/references/rust-sugiyama; git clone <https://github.com/libnare/rust-dagre.git> ~/references/rust-dagre; git clone <https://github.com/xyflow/xyflow.git> ~/references/xyflow; git clone <https://github.com/cytoscape/cytoscape.js.git> ~/references/cytoscape.js; git clone <https://github.com/jacomyal/sigma.js.git> ~/references/sigma.js; git clone --depth 1 <https://github.com/antvis/G6.git> ~/references/G6; git clone <https://github.com/cosmograph-org/cosmos.git> ~/references/cosmos; git clone --depth 1 <https://github.com/datahub-project/datahub.git> ~/references/datahub; git clone <https://github.com/MarquezProject/marquez.git> ~/references/marquez; git clone <https://github.com/dbt-labs/dbt-docs.git> ~/references/dbt-docs

## Points

| Point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Verdict    | Confidence  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------- |
| 1. Eclipse ELK (eclipse-elk/elk, Java, EPL-2.0 OR GPL-3.0-or-later) covers more of this package's feature set than any other engine reviewed here: ports, compound graphs, ordering that respects a previous order, Brandes-Köpf, network simplex and orthogonal routing. The files to read are p3order/InteractiveCrossingMinimizer.java, p3order/LayerSweepCrossingMinimizer.java, p4nodes/bk/BKNodePlacer.java, p5edges/orthogonal/OrthogonalRoutingGenerator.java and intermediate/HierarchicalNodeResizingProcessor.java. Its 'interactive' support covers ordering only: it keeps the node order from previous positions on a graph that already has a proper layering. It does not relayout in general after edits. Whether its hierarchy model matches this package's partitions and clusters is not shown. | middle     | high        |
| 2. ELK's NetworkSimplexLayerer.java (Gansner, minimising total edge length) and BKNodePlacer.java (Brandes-Köpf extended for ports, node sizes and margins) are the closest counterparts to this package's ranking step and its Brandes-Köpf warm start. They are good to read and to compare output against. They prove nothing about matching results, speed at 10,000 nodes, or how easily they would port to Rust.                                                                                                                                                                                                                                                                                                                                                                                              | middle     | high        |
| 3. elkjs users keep asking how to reuse a previous layout: its README lists the question among recurring issues. ELK's answer in code is an ordering-only interactive mode that needs a proper layering. It does not reuse ranks, dummy chains, routes or geometry. Compare it with the package's hints on ordering stability only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | middle     | medium      |
| 4. I made a sparse checkout of current ELK master (plugins/org.eclipse.elk.alg.layered only) and searched it case-insensitively. 'sift' matched once, by accident, inside the method name processIfTwoNorthSouthNodes. 'multilevel', 'multi-level' and 'coarsen' matched nothing. p3order contains layer-sweep, barycenter, median, model-order barycenter and Forster constraint-resolver classes. Where another engine would use sifting, ELK uses a greedy-switch post-pass (intermediate/greedyswitch/), which swaps neighbouring nodes in the way transpose does. So ELK is not the reference for sifting or multilevel ordering. I did not search the other ELK plugins.                                                                                                                                      | middle     | medium      |
| 5. elkjs (kieler/elkjs, EPL-2.0) is ELK's layered algorithm built for JavaScript. It does layout only and draws nothing. It is the obvious baseline in the same runtime for timing and crossing counts. Whether it is the right production backend depends on things not yet measured: worker transfer cost, bundle size and how the webview schedules work.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | middle     | high        |
| 6. MSAGL (microsoft/automatic-graph-layout, MIT, C#) is the main permissively licensed engine with code for incremental Sugiyama layout and layout recovery. Read Layout/Layered/RecoveryLayeredLayoutEngine.cs and the incremental path exercised by Test/MSAGLTests/Layout/Layered/IncrementalSugiyamaTests.cs. The test I read only checks that resizing nodes leaves layers and order unchanged. It says nothing about adding or removing nodes or edges, ports, clusters or scale.                                                                                                                                                                                                                                                                                                                             | middle     | medium      |
| 7. OGDF (ogdf/ogdf, C++, GPL) has a dedicated sifting implementation, src/ogdf/layered/SiftingHeuristic.cpp, next to its barycenter and median heuristics. It is the closest reference for the package's sifting pass. It does not prove that sifting scales, since each sifted vertex is moved across its whole level. The GPL forbids copying the code into an MIT package. It does not forbid reading it and reimplementing the algorithm from the papers.                                                                                                                                                                                                                                                                                                                                                       | middle     | high        |
| 8. Graphviz dot (C, EPL-2.0) is the reference for crossing reduction that respects clusters. lib/dotgen/mincross.c contains transpose() and a ReMincross flag that runs mincross again after clusters are placed. The thesis said dot is slow on large graphs but cited nothing, so that claim is removed. Whether dot is fast enough here has to be measured.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | middle     | medium      |
| 9. elk-rs (openedges/elk-rs, Rust, EPL-2.0 OR GPL-3.0-or-later) ports ELK to Rust and presents itself as a drop-in replacement for elkjs. It installs a native Node addon (NAPI) where it can and falls back to WASM elsewhere. That makes it the first native/WASM option to benchmark against this package and elkjs on the 1,122-node graph. Calling it the 'strongest' candidate is premature: it has not been benchmarked or audited for features. Its licence rules out copying its code into an MIT port.                                                                                                                                                                                                                                                                                                    | middle     | medium      |
| 10. rust-sugiyama (paddison/rust-sugiyama, MIT, Rust on petgraph) is a small Sugiyama pipeline under a permissive licence. It reduces crossings with the weighted median or barycenter heuristic and counts them with the Barth-Mutzel-Jünger bilayer method. It has no ports, clusters or hints, so it is a skeleton for a Rust port or a test oracle, not a model to follow. The thesis called it the smallest MIT Rust codebase, but nobody surveyed the alternatives, so that is dropped.                                                                                                                                                                                                                                                                                                                       | middle     | medium      |
| 11. rust-dagre (libnare/rust-dagre, MIT) is worth reading for how it ships: a single napi-rs 'Universal Package' that provides a native Node addon and a WebAssembly (WASI) build. Three things are unverified: whether the WASI build runs inside a VS Code webview, which platforms have prebuilt binaries, and what passing graph data in and out costs.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | middle     | medium      |
| 12. Current dagre (dagrejs/dagre, MIT, TypeScript) is not the plain old baseline the thesis described. lib/layout.ts lays out clusters recursively, each with its own direction (rankdir). It also keeps the previous layout for each input graph in a WeakMap and reuses it unless the useDynamic option is set to false. lib/position/bk.ts (Brandes-Köpf) and lib/order/index.ts (sweeps that stop after four rounds without improvement) remain the simplest TypeScript reference for those two steps. lib/layout.ts changed between two of my fetches, so audit its API at a pinned commit.                                                                                                                                                                                                                    | antithesis | high        |
| 13. d3-dag (erikbrinkman/d3-dag, MIT, TypeScript) is a better comparison engine than the thesis said. src/sugiyama/layering/simplex.ts is a network-simplex layering that accepts rank constraints and same-layer group constraints, close to this package's partitions and hints. src/sugiyama/coord/quad.ts places nodes by quadratic programming, like the package's quadratic in-rank objective. src/sugiyama/decross/opt.ts solves crossing minimisation exactly, an NP-complete problem, and refuses graphs that look too large, so do not use it at target scale.                                                                                                                                                                                                                                            | antithesis | high        |
| 14. WebCola (tgdwyer/WebCola, MIT, TypeScript) is the reference for the placement solver. src/vpsc.ts holds the Variable, Constraint, Block, Blocks and Solver classes: the VPSC solver that merges constraint blocks, which the package README names. Two more files matter for this question. src/powergraph.ts builds power-graph modules, a way to group nodes and compress edges (part c). src/gridrouter.ts does orthogonal routing on a grid.                                                                                                                                                                                                                                                                                                                                                                | middle     | medium      |
| 15. React Flow (xyflow/xyflow, MIT) can render only the elements inside the viewport, through the onlyRenderVisibleElements option in packages/react/src/types/component-props.ts. Its own documentation warns that this adds overhead, so it has to be measured. It does nothing for layout time, routing cost, drawing width or visual clutter; those still need grouping and semantic zoom.                                                                                                                                                                                                                                                                                                                                                                                                                      | middle     | high        |
| 16. Sigma.js (jacomyal/sigma.js, MIT) is a WebGL renderer built on graphology, aimed at graphs of thousands of nodes and edges. It is the fallback if DOM or SVG rendering of the package's output stalls. Overview-plus-detail, grouping and semantic zoom would still have to be built on top of it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | middle     | high        |
| 17. cosmos.gl (cosmograph-org/cosmos, MIT) runs force simulation and drawing on the GPU and says it handles hundreds of thousands of points in real time. It has no layered layout, so it matters here only as a GPU-rendering reference or a force-directed overview, not for views that must keep ranks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | thesis     | medium      |
| 18. Cytoscape.js (MIT) has a performance guide, documentation/md/performance.md, that is more useful than the three viewport switches alone. It names edges and labels as the expensive parts to draw. It recommends cy.batch() for bulk updates, min-zoomed-font-size so small labels are not drawn, and hideEdgesOnViewport while the user pans or zooms. Any renderer of this package's output can adopt the same idea: labels and edges shown according to zoom level.                                                                                                                                                                                                                                                                                                                                          | middle     | high        |
| 19. dbt-docs (dbt-labs/dbt-docs, Apache-2.0) loads cytoscape and cytoscape-dagre in src/app/components/graph/graph-viz.js. That only shows a dependency. It says nothing about how dagre is configured, how it copes with a large project, or whether this extension is meant to replace it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | middle     | medium      |
| 20. Marquez's web UI (Apache-2.0) runs ELK's layered algorithm at render time, in a web worker. web/libs/graph/src/layout/useLayout.ts imports elkjs, loads '/elk-worker.min.js', and sets elk.algorithm to 'layered' with Coffman-Graham layering, layer-sweep crossing minimisation and hierarchyHandling INCLUDE_CHILDREN. It also has a keepPreviousGraph prop. It is a concrete, readable example of driving ELK for lineage in a worker. Nothing shown here says how it behaves on large projects.                                                                                                                                                                                                                                                                                                            | new        | high        |
| 21. DataHub's lineage V3 UI (datahub-project/datahub, Apache-2.0, React Flow 11) shows progressive disclosure in datahub-web-react/src/app/lineageV3/useComputeGraph/boundingBoxes/computeBoundingBoxGraph.ts. It lays out grouped entities in bounding boxes and places the rest freely, hides data-process instances by default, and reveals nodes and edges through expansion state and lineage filter nodes. It is a strong example for part (c). It is not established that it collapses groups into single proxy nodes, or that it is the best example.                                                                                                                                                                                                                                                       | middle     | medium      |
| 22. The package shares one dummy chain per bundle (one bundle per edge kind and node pair), following Pupyrev, Nachmanson and Kaufmann. That is how long edges are represented internally. It does not show that users see bundled edges or that the drawing is readable. The open problems go beyond width: when to show labels, simplifying edges, merging ranks, and semantic zoom.                                                                                                                                                                                                                                                                                                                                                                                                                              | middle     | high        |
| 23. Licences, for an MIT package. ELK, elkjs and elk-rs (EPL-2.0, with GPL-3.0-or-later as an option for ELK and elk-rs), Graphviz (EPL-2.0) and OGDF (GPL) can be read, and their algorithms reimplemented from the papers, but their code should not be copied in. EPL-2.0 has a narrower rule for software that only links to the program, so calling elkjs or elk-rs as a separate benchmark or optional backend is a different question from copying. The permissive sources to study closely are MSAGL, dagre, d3-dag, WebCola, rust-sugiyama and rust-dagre; credit them and record where any copied code came from. This is an engineering note, not legal advice.                                                                                                                                          | middle     | medium      |
| 24. None of these repositories was benchmarked. The benchmark should use the package's own 1,122-node graph plus synthetic graphs of 5,000 and 10,000 nodes. Compare against elkjs, elk-rs, current dagre and d3-dag, and optionally Graphviz through hpcc-js-wasm. Record layout time, memory, worker transfer time, cancellation latency, crossings, width, and stability after edits that add nodes and edges, not just resizes. Measure frame rate and time to first paint in the webview separately.                                                                                                                                                                                                                                                                                                           | middle     | speculative |
| 25. antvis/G6 (MIT, TypeScript) is a graph visualisation engine that combines rendering, layout, interaction and animation. Add it to the rendering candidates next to React Flow, Sigma.js and Cytoscape.js. Whether its group ('combo') collapsing and level-of-detail code hold up at this scale has not been checked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | new        | low         |
| 26. hpcc-systems/hpcc-js-wasm (packages/graphviz; an Apache-2.0 wrapper around EPL-licensed Graphviz) runs Graphviz in the browser and in Node through WASM. It is the practical way to put dot into the same benchmark harness as the TypeScript package. It also shows how to ship a C/C++ layout engine into a webview.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | new        | medium      |
| 27. Part of the 366,858 px width probably comes from the package's own setting for placing ranks, not from a missing technique. The README makes stacked rows (ranks: "rows") the default and offers ranks: "levels" as an alternative. Compare the two modes on the 1,122-node graph before doing any work with external engines. None of the repositories surveyed shows a way to keep a graph this size narrow without grouping or merging nodes.                                                                                                                                                                                                                                                                                                                                                                | new        | low         |

## Detail

### 1. Eclipse ELK (eclipse-elk/elk, Java, EPL-2.0 OR GPL-3.0-or-later) covers more of this package's feature set than any other engine reviewed here: ports, compound graphs, ordering that respects a previous order, Brandes-Köpf, network simplex and orthogonal routing. The files to read are p3order/InteractiveCrossingMinimizer.java, p3order/LayerSweepCrossingMinimizer.java, p4nodes/bk/BKNodePlacer.java, p5edges/orthogonal/OrthogonalRoutingGenerator.java and intermediate/HierarchicalNodeResizingProcessor.java. Its 'interactive' support covers ordering only: it keeps the node order from previous positions on a graph that already has a proper layering. It does not relayout in general after edits. Whether its hierarchy model matches this package's partitions and clusters is not shown

Verdict: middle. Confidence: high.

I checked the file contents. The interactive minimizer lists a proper layering as a precondition, so the antithesis is right that it reorders and does not reuse a whole layout. The thesis's claim that ELK is the 'only' complete codebase was never audited and is dropped. ELK stays at the top because no other engine reviewed has all these pieces.

Citations:

- [r1-elk-interactive](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p3order/InteractiveCrossingMinimizer.java): "A crossing minimizer that allows user interaction by respecting previous node positions."
- [r1-elk-precond](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p3order/InteractiveCrossingMinimizer.java): "The graph has a proper layering"
- [r1-elk-lic](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p3order/InteractiveCrossingMinimizer.java): "SPDX-License-Identifier: EPL-2.0 OR GPL-3.0-or-later"

Thesis (high): eclipse-elk/elk (Java, EPL-2.0 OR GPL-3.0-or-later) is the most complete reference for this package's feature set. Its layered plugin contains a crossing minimiser that respects previous positions (p3order/InteractiveCrossingMinimizer.java), a Brandes-Köpf placer (p4nodes/bk/BKNodePlacer.java), an orthogonal router (p5edges/orthogonal/OrthogonalRoutingGenerator.java), and a hierarchical resizing processor (intermediate/HierarchicalNodeResizingProcessor.java). Read these first for ports, compound nodes, and hint-driven ordering.

Thesis citations:

- [elk-interactive](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p3order/InteractiveCrossingMinimizer.java): "A crossing minimizer that allows user interaction by respecting previous node positions."
- [elk-bk](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p4nodes/bk/BKNodePlacer.java): "The original algorithm was extended to be able to cope with ports, node sizes, and node margins,"
- [elk-ortho](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal/OrthogonalRoutingGenerator.java): "public final class OrthogonalRoutingGenerator {"
- [elk-hier](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/intermediate/HierarchicalNodeResizingProcessor.java): "public class HierarchicalNodeResizingProcessor implements ILayoutProcessor<LGraph> {"

Antithesis: high: “Only surveyed codebase” is an unsupported exclusivity claim; no comparable feature matrix or source audit is supplied.

Antithesis: medium: A hierarchical resizing processor does not prove equivalent semantics for this package's partitions and clusters.

Antithesis: high: The interactive minimizer preserves ordering from previous positions; it is not evidence of general incremental relayout after graph edits.

Counter-evidence:

- [elk-interactive-order-scope](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p3order/InteractiveCrossingMinimizer.java): "The order of nodes in each layer is rearranged according to previous positions give * by the input graph."

### 2. ELK's NetworkSimplexLayerer.java (Gansner, minimising total edge length) and BKNodePlacer.java (Brandes-Köpf extended for ports, node sizes and margins) are the closest counterparts to this package's ranking step and its Brandes-Köpf warm start. They are good to read and to compare output against. They prove nothing about matching results, speed at 10,000 nodes, or how easily they would port to Rust

Verdict: middle. Confidence: high.

Both quotes check out. The antithesis is right that they show the algorithms are relevant, not that they are fast. The claim is narrowed to reading and comparison.

Citations:

- [r2-nsl](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p2layers/NetworkSimplexLayerer.java): "The main class of the network simplex layerer component. It offers an algorithm to determine an"
- [r2-bk](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p4nodes/bk/BKNodePlacer.java): "The original algorithm was extended to be able to cope with ports, node sizes, and node margins,"

Thesis (high): ELK's layering uses network simplex (p2layers/NetworkSimplexLayerer.java, citing Gansner et al.), and its node placement offers Brandes-Köpf (p4nodes/bk/BKNodePlacer.java) extended for ports, node sizes and margins. This is the closest code to the package's Gansner ranking and BK warm start, so it is a direct comparison for correctness and for a Rust port.

Thesis citations:

- [elk-nsl](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p2layers/NetworkSimplexLayerer.java): "The main class of the network simplex layerer component. It offers an algorithm to determine an"
- [elk-bk-2](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p4nodes/bk/BKNodePlacer.java): "The original algorithm was extended to be able to cope with ports, node sizes, and node margins,"

Antithesis: high: Network simplex establishes algorithmic relevance, not correctness equivalence, Rust-port suitability, or performance on the package's graph.

Antithesis: medium: No profiling, allocation analysis, or benchmark supports the implied implementation priority.

Antithesis: medium: The source documents a minimum-total-edge-length objective, not incremental behavior or large-graph throughput.

Counter-evidence:

- [elk-network-simplex-objective](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p2layers/NetworkSimplexLayerer.java): "The main class of the network simplex layerer component. It offers an algorithm to determine an *optimal layering of all nodes in the graph concerning a minimal length of all edges using the* network simplex algorithm described in"

### 3. elkjs users keep asking how to reuse a previous layout: its README lists the question among recurring issues. ELK's answer in code is an ordering-only interactive mode that needs a proper layering. It does not reuse ranks, dummy chains, routes or geometry. Compare it with the package's hints on ordering stability only

Verdict: middle. Confidence: medium.

The README line and the minimizer's precondition are both verified. The thesis read too much into them, so the claim is limited to ordering.

Citations:

- [r3-elkjs-readme](https://raw.githubusercontent.com/kieler/elkjs/master/README.md): "How to consider previous layout results, including"
- [r3-precond](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p3order/InteractiveCrossingMinimizer.java): "The graph has a proper layering"

Thesis (medium): Hint-driven relayout is a documented need in the elkjs ecosystem: elkjs's README lists 'How to consider previous layout results' as a recurring issue, and ELK answers it with the interactive crossing minimiser, which keeps previous node order. This matches the package's hints feature and suggests comparing its stability against ELK's interactive mode on the same graph.

Thesis citations:

- [elkjs-readme-incr](https://raw.githubusercontent.com/kieler/elkjs/master/README.md): "How to consider previous layout results, including"
- [elk-interactive-b](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p3order/InteractiveCrossingMinimizer.java): "A crossing minimizer that allows user interaction by respecting previous node positions."

Antithesis: high: A recurring README question is not proof of an elkjs incremental-layout API.

Antithesis: high: The evidence does not establish reuse of ranks, dummy chains, routes, or geometry.

Antithesis: high: It turns a constrained ordering feature into general hint-driven relayout.

Counter-evidence:

- [elk-interactive-preconditions](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p3order/InteractiveCrossingMinimizer.java): "`<dt>Preconditions:</dt> *<dd>The graph has a proper layering</dd>* <dd>All nodes have at least fixed port sides.</dd>`"

### 4. I made a sparse checkout of current ELK master (plugins/org.eclipse.elk.alg.layered only) and searched it case-insensitively. 'sift' matched once, by accident, inside the method name processIfTwoNorthSouthNodes. 'multilevel', 'multi-level' and 'coarsen' matched nothing. p3order contains layer-sweep, barycenter, median, model-order barycenter and Forster constraint-resolver classes. Where another engine would use sifting, ELK uses a greedy-switch post-pass (intermediate/greedyswitch/), which swaps neighbouring nodes in the way transpose does. So ELK is not the reference for sifting or multilevel ordering. I did not search the other ELK plugins

Verdict: middle. Confidence: medium.

I reran the search at a known revision and path, which raises this from speculative. The single match was a false positive. Greedy switch is the closest heuristic ELK has.

Citations:

- [r4-greedy](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/intermediate/greedyswitch/GreedySwitchHeuristic.java): "Implements the greedy switch heuristic: For two neighboring nodes, check to see if by exchanging their positions"

Thesis (speculative): ELK's layered plugin appears to have no sifting heuristic and no multilevel coarsening. A grep of its Java sources found no 'sift' match and no 'multilevel' match. Its sweeps are median/barycenter based, with a Forster constraint resolver. So ELK does not answer the sifting or multilevel question; OGDF and Graphviz do (points 7 and 8).

Antithesis: speculative: A literal grep with no reported revision, paths, aliases, or generated-source coverage is not proof of feature absence.

Antithesis: high: The conclusion still steers readers toward other engines despite being explicitly speculative.

Antithesis: medium: No textual “multilevel” match is not equivalent to no multilevel strategy.

### 5. elkjs (kieler/elkjs, EPL-2.0) is ELK's layered algorithm built for JavaScript. It does layout only and draws nothing. It is the obvious baseline in the same runtime for timing and crossing counts. Whether it is the right production backend depends on things not yet measured: worker transfer cost, bundle size and how the webview schedules work

Verdict: middle. Confidence: high.

The README and licence quotes are verified. The antithesis is right that calling it the natural baseline is a choice of benchmark, not a result.

Citations:

- [r5-flagship](https://raw.githubusercontent.com/kieler/elkjs/master/README.md): "ELK's flagship is a layer-based layout algorithm that is particularly suited for node-link diagrams with an inherent direction and ports"
- [r5-only](https://raw.githubusercontent.com/kieler/elkjs/master/README.md): "elkjs itself is a graph layout engine *only*."
- [r5-lic](https://raw.githubusercontent.com/kieler/elkjs/master/LICENSE.md): "Eclipse Public License - v 2.0"

Thesis (high): elkjs (kieler/elkjs) is the JavaScript build of ELK's layout algorithms. It is the natural in-process baseline for this package, since it runs in the same runtimes (browser, Node, webview). It is EPL-2.0, and the README says it is a layout engine only, with no rendering.

Thesis citations:

- [elkjs-readme-flagship](https://raw.githubusercontent.com/kieler/elkjs/master/README.md): "ELK's flagship is a layer-based layout algorithm that is particularly suited for node-link diagrams with an inherent direction and ports"
- [elkjs-readme-engine](https://raw.githubusercontent.com/kieler/elkjs/master/README.md): "elkjs itself is a graph layout engine *only*."
- [elkjs-lic](https://raw.githubusercontent.com/kieler/elkjs/master/LICENSE.md): "Eclipse Public License - v 2.0"

Antithesis: medium: “Natural in-process baseline” ignores worker transfer cost, package size, and webview scheduling.

Antithesis: high: A layout-only engine is not a complete answer to the interactive-drawing part of the question.

Antithesis: high: ELK describes elkjs as transpiled Java, which needs an explicit performance and delivery comparison against native TypeScript.

Counter-evidence:

- [elk-readme-elkjs-transpiled](https://raw.githubusercontent.com/eclipse-elk/elk/master/README.md): "* [elkjs](https://github.com/kieler/elkjs) (JavaScript library transpiled from ELK's Java sources)"

### 6. MSAGL (microsoft/automatic-graph-layout, MIT, C#) is the main permissively licensed engine with code for incremental Sugiyama layout and layout recovery. Read Layout/Layered/RecoveryLayeredLayoutEngine.cs and the incremental path exercised by Test/MSAGLTests/Layout/Layered/IncrementalSugiyamaTests.cs. The test I read only checks that resizing nodes leaves layers and order unchanged. It says nothing about adding or removing nodes or edges, ports, clusters or scale

Verdict: middle. Confidence: medium.

The antithesis is correct that the test is narrow: it only scales node outlines. MSAGL is still the strongest MIT lead, so 'best reference' becomes 'main lead'.

Citations:

- [r6-test](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/Test/MSAGLTests/Layout/Layered/IncrementalSugiyamaTests.cs): "Verifies that updating shapes and calling incremental sugiyama does not affect the ordering of nodes and layers."
- [r6-recovery](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Layout/Layered/RecoveryLayeredLayoutEngine.cs): "internal class RecoveryLayeredLayoutEngine {"
- [r6-lic](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/LICENSE): "without limitation the rights to use, copy, modify, merge, publish,"

Thesis (high): Microsoft MSAGL (MIT, C#) is the best permissive reference for incremental Sugiyama relayout. Its test suite has an IncrementalSugiyamaTests.cs file that checks that updating shapes and re-running incremental layout does not change node order or layers. RecoveryLayeredLayoutEngine.cs recovers a previous layered layout. Both are directly relevant to the package's hints and stability weighting.

Thesis citations:

- [msagl-incr](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/Test/MSAGLTests/Layout/Layered/IncrementalSugiyamaTests.cs): "Verifies that incremental sugiyama layout works correctly."
- [msagl-recovery](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/MSAGL/Layout/Layered/RecoveryLayeredLayoutEngine.cs): "internal class RecoveryLayeredLayoutEngine {"
- [msagl-lic](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/LICENSE): "without limitation the rights to use, copy, modify, merge, publish,"

Antithesis: high: “Best permissive reference” is not established. The cited test covers only resizing existing nodes in one graph.

Antithesis: high: It does not test node or edge addition/removal, ports, clusters, reranking, routing, or large-graph performance.

Antithesis: high: The test enforces unchanged layer/order after shape updates, a much narrower property than general incremental Sugiyama layout.

Counter-evidence:

- [msagl-test-description](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/Test/MSAGLTests/Layout/Layered/IncrementalSugiyamaTests.cs): "[Description("Verifies that updating shapes and calling incremental sugiyama does not affect the ordering of nodes and layers.")]"
- [msagl-test-resize-operation](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/GraphLayout/Test/MSAGLTests/Layout/Layered/IncrementalSugiyamaTests.cs): "node.BoundaryCurve = node.BoundaryCurve.ScaleFromOrigin(2.0, 2.0);"

### 7. OGDF (ogdf/ogdf, C++, GPL) has a dedicated sifting implementation, src/ogdf/layered/SiftingHeuristic.cpp, next to its barycenter and median heuristics. It is the closest reference for the package's sifting pass. It does not prove that sifting scales, since each sifted vertex is moved across its whole level. The GPL forbids copying the code into an MIT package. It does not forbid reading it and reimplementing the algorithm from the papers

Verdict: middle. Confidence: high.

The file and licence are verified. Both of the antithesis's corrections, on scale and on what the GPL covers, are accepted.

Citations:

- [r7-sift](https://raw.githubusercontent.com/ogdf/ogdf/master/src/ogdf/layered/SiftingHeuristic.cpp): "Implementation of SiftingHeuristic"
- [r7-lic](https://raw.githubusercontent.com/ogdf/ogdf/master/LICENSE.txt): "modify it under the terms of the GNU General Public License"

Thesis (high): OGDF (C++, GPL v2/v3) contains a dedicated SiftingHeuristic.cpp in src/ogdf/layered, alongside BarycenterHeuristic, MedianHeuristic and FastHierarchyLayout. It is the reference for the sifting pass the package already uses. Because it is GPL, it is a design reference only and cannot be ported into this MIT package.

Thesis citations:

- [ogdf-sift](https://raw.githubusercontent.com/ogdf/ogdf/master/src/ogdf/layered/SiftingHeuristic.cpp): "Implementation of SiftingHeuristic"
- [ogdf-lic](https://raw.githubusercontent.com/ogdf/ogdf/master/LICENSE.txt): "modify it under the terms of the GNU General Public License"

Antithesis: high: A dedicated sifting implementation is relevant but does not prove scalability to 10,000 nodes.

Antithesis: medium: GPL affects copying and linking choices, but does not prohibit studying an algorithm and independently implementing it.

Antithesis: high: The implementation moves selected vertices across an entire level; no measured time or complexity result justifies describing it as a scale solution.

Counter-evidence:

- [ogdf-sifting-left-pass](https://raw.githubusercontent.com/ogdf/ogdf/master/src/ogdf/layered/SiftingHeuristic.cpp): "// sifting left for (; i > 0; --i) {"
- [ogdf-sifting-right-pass](https://raw.githubusercontent.com/ogdf/ogdf/master/src/ogdf/layered/SiftingHeuristic.cpp): "// sifting right and searching optimal position int opt = dev, opt_pos = 0; for (; i < n - 1; ++i) {"

### 8. Graphviz dot (C, EPL-2.0) is the reference for crossing reduction that respects clusters. lib/dotgen/mincross.c contains transpose() and a ReMincross flag that runs mincross again after clusters are placed. The thesis said dot is slow on large graphs but cited nothing, so that claim is removed. Whether dot is fast enough here has to be measured

Verdict: middle. Confidence: medium.

I fetched mincross.c myself and both declarations are there. The speed claim had no support.

Citations:

- [r8-transpose](https://gitlab.com/graphviz/graphviz/-/raw/main/lib/dotgen/mincross.c): "static void transpose(graph_t *g, bool reverse) {"
- [r8-remin](https://gitlab.com/graphviz/graphviz/-/raw/main/lib/dotgen/mincross.c): "static bool ReMincross;"
- [r8-lic](https://gitlab.com/graphviz/graphviz/-/raw/main/COPYING): "Eclipse Public License - v 2.0"

Thesis (high): Graphviz dot (C, EPL-2.0) is the reference for cluster-aware crossing reduction. lib/dotgen/mincross.c defines transpose and reorder passes and a ReMincross flag that re-runs mincross after clusters are placed. Graphviz is slow on very large graphs, so it is a reference for cluster handling, not for speed.

Thesis citations:

- [gv-mincross](https://gitlab.com/graphviz/graphviz/-/raw/main/lib/dotgen/mincross.c): "static void transpose(graph_t *g, bool reverse) {"
- [gv-remincross](https://gitlab.com/graphviz/graphviz/-/raw/main/lib/dotgen/mincross.c): "static bool ReMincross;"
- [gv-lic](https://gitlab.com/graphviz/graphviz/-/raw/main/COPYING): "Eclipse Public License - v 2.0"

Antithesis: high: “Graphviz is slow on very large graphs” is uncited and unmeasured.

Antithesis: medium: Declarations of transpose and ReMincross do not prove scalable cluster handling.

Antithesis: speculative: Restricting dot to a reference role is a recommendation unsupported by the provided source evidence.

### 9. elk-rs (openedges/elk-rs, Rust, EPL-2.0 OR GPL-3.0-or-later) ports ELK to Rust and presents itself as a drop-in replacement for elkjs. It installs a native Node addon (NAPI) where it can and falls back to WASM elsewhere. That makes it the first native/WASM option to benchmark against this package and elkjs on the 1,122-node graph. Calling it the 'strongest' candidate is premature: it has not been benchmarked or audited for features. Its licence rules out copying its code into an MIT port

Verdict: middle. Confidence: medium.

The packaging and licence are verified. I found no benchmark numbers in its README, so the ranking is softened.

Citations:

- [r9-napi](https://raw.githubusercontent.com/openedges/elk-rs/main/README.md): "On supported platforms, a native NAPI addon is automatically installed for best performance. Falls back to WASM on other platforms."
- [r9-lic](https://raw.githubusercontent.com/openedges/elk-rs/main/Cargo.toml): "license = "EPL-2.0 OR GPL-3.0-or-later""

Thesis (medium): elk-rs (openedges/elk-rs) is a pure-Rust port of ELK, published as a drop-in replacement for elkjs. It ships a native NAPI addon with a WASM fallback, so it is the strongest candidate for both a Rust port and a native/WASM backend for the TypeScript package. Its licence is EPL-2.0 OR GPL-3.0-or-later, which limits copying. Performance claims are the project's own and I did not benchmark them.

Thesis citations:

- [elkrs-readme](https://raw.githubusercontent.com/openedges/elk-rs/main/README.md): "On supported platforms, a native NAPI addon is automatically installed for best performance. Falls back to WASM on other platforms."
- [elkrs-readme-drop](https://raw.githubusercontent.com/openedges/elk-rs/main/README.md): "a drop-in replacement for [elkjs]"
- [elkrs-cargo](https://raw.githubusercontent.com/openedges/elk-rs/main/Cargo.toml): "license = "EPL-2.0 OR GPL-3.0-or-later""

Antithesis: high: “Strongest candidate” is unsupported by benchmarks, feature-coverage auditing, maintenance evidence, or deployment testing.

Antithesis: medium: N-API plus WASM fallback is a packaging property, not a performance result.

Antithesis: high: The thesis concedes it did not benchmark performance, so it cannot credibly rank elk-rs above competing native or WASM options.

### 10. rust-sugiyama (paddison/rust-sugiyama, MIT, Rust on petgraph) is a small Sugiyama pipeline under a permissive licence. It reduces crossings with the weighted median or barycenter heuristic and counts them with the Barth-Mutzel-Jünger bilayer method. It has no ports, clusters or hints, so it is a skeleton for a Rust port or a test oracle, not a model to follow. The thesis called it the smallest MIT Rust codebase, but nobody surveyed the alternatives, so that is dropped

Verdict: middle. Confidence: medium.

The README and licence are verified. The superlative had no support.

Citations:

- [r10-readme](https://raw.githubusercontent.com/paddison/rust-sugiyama/master/README.md): "Crossing Reduction follows the weighted median heuristic"
- [r10-lic](https://raw.githubusercontent.com/paddison/rust-sugiyama/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Thesis (medium): rust-sugiyama (paddison/rust-sugiyama, MIT, Rust, petgraph-based) is the smallest MIT-licensed Rust codebase for the Sugiyama pipeline. It uses greedy feedback arc set for cycle removal, Gansner-style ranking, weighted median crossing reduction with transpose, and Brandes-Köpf coordinates. It has no ports, clusters or hints, so it is a starting skeleton for a Rust port rather than a complete model.

Thesis citations:

- [rs-readme](https://raw.githubusercontent.com/paddison/rust-sugiyama/master/README.md): "Crossing Reduction follows the weighted median heuristic"
- [rs-lic](https://raw.githubusercontent.com/paddison/rust-sugiyama/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Antithesis: medium: “Smallest MIT-licensed Rust codebase” is a broad survey claim with no search methodology.

Antithesis: high: Named algorithms do not establish maintained status, correctness, ports, clusters, hints, or 10,000-node viability.

Antithesis: speculative: Calling it a suitable Rust-port skeleton is plausible but unverified.

### 11. rust-dagre (libnare/rust-dagre, MIT) is worth reading for how it ships: a single napi-rs 'Universal Package' that provides a native Node addon and a WebAssembly (WASI) build. Three things are unverified: whether the WASI build runs inside a VS Code webview, which platforms have prebuilt binaries, and what passing graph data in and out costs

Verdict: middle. Confidence: medium.

The README line is verified. The antithesis is right that a packaging claim does not prove it works in a browser webview.

Citations:

- [r11-readme](https://raw.githubusercontent.com/libnare/rust-dagre/master/README.md): "This project uses [napi-rs](https://napi.rs) to provide a **Universal Package** supporting both Node.js Native Addons and WebAssembly (WASI)."
- [r11-lic](https://raw.githubusercontent.com/libnare/rust-dagre/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Thesis (medium): rust-dagre (libnare/rust-dagre, MIT, Rust) is a dagre port built with napi-rs, which produces both a Node native addon and a WASI/WebAssembly build. It is a delivery-pattern reference: how a Rust layout engine can be shipped to a TypeScript or VS Code extension without a native toolchain on the user side.

Thesis citations:

- [rdagre-readme](https://raw.githubusercontent.com/libnare/rust-dagre/master/README.md): "This project uses [napi-rs](https://napi.rs) to provide a **Universal Package** supporting both Node.js Native Addons and WebAssembly (WASI)."
- [rdagre-lic](https://raw.githubusercontent.com/libnare/rust-dagre/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Antithesis: medium: NAPI/WASI packaging does not prove compatibility with the target browser webview.

Antithesis: high: It says nothing about prebuilt binary availability, data serialization cost, or browser execution.

Antithesis: medium: Universal-package marketing is treated as verified deployment behavior.

### 12. Current dagre (dagrejs/dagre, MIT, TypeScript) is not the plain old baseline the thesis described. lib/layout.ts lays out clusters recursively, each with its own direction (rankdir). It also keeps the previous layout for each input graph in a WeakMap and reuses it unless the useDynamic option is set to false. lib/position/bk.ts (Brandes-Köpf) and lib/order/index.ts (sweeps that stop after four rounds without improvement) remain the simplest TypeScript reference for those two steps. lib/layout.ts changed between two of my fetches, so audit its API at a pinned commit

Verdict: antithesis. Confidence: high.

I fetched lib/layout.ts and confirmed the recursive cluster layout, the previousLayouts map and the useDynamic flag. On current master, the thesis's 'no clusters or incremental mode' is wrong.

Citations:

- [r12-prev](https://raw.githubusercontent.com/dagrejs/dagre/master/lib/layout.ts): "Remember layout state per input graph so unrelated callers cannot affect each other."
- [r12-dyn](https://raw.githubusercontent.com/dagrejs/dagre/master/lib/layout.ts): "const dynamic = opts?.useDynamic !== false;"
- [r12-clusters](https://raw.githubusercontent.com/dagrejs/dagre/master/lib/layout.ts): "First, recursively layout all clusters with their own rankdir"
- [r12-order](https://raw.githubusercontent.com/dagrejs/dagre/master/lib/order/index.ts): "for (let i = 0, lastBest = 0; lastBest < 4; ++i, ++lastBest) {"

Thesis (medium): dagre (dagrejs/dagre, MIT, TypeScript) is a small JavaScript layered layout with a Brandes-Köpf position module (lib/position/bk.ts) and a sweep loop in lib/order/index.ts that stops after four sweeps without improvement. It is the simplest TypeScript reference for the sweep and BK pieces, but it has no ports, clusters or incremental mode, and it is not designed for 10,000 nodes.

Thesis citations:

- [dagre-bk](https://raw.githubusercontent.com/dagrejs/dagre/master/lib/position/bk.ts): "This module provides coordinate assignment based on Brandes and"
- [dagre-order](https://raw.githubusercontent.com/dagrejs/dagre/master/lib/order/index.ts): "for (let i = 0, lastBest = 0; lastBest < 4; ++i, ++lastBest) {"
- [dagre-lic](https://raw.githubusercontent.com/dagrejs/dagre/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Antithesis: high: The claim that current dagre has no clusters or incremental mode is contradicted by the repository's current layout source.

Antithesis: medium: The assertion that dagre is not designed for 10,000 nodes remains unbenchmarked.

Antithesis: high: Current dagre stores previous layout state and recursively lays out clusters.

Counter-evidence:

- [dagre-previous-layout](https://raw.githubusercontent.com/dagrejs/dagre/master/lib/layout.ts): "// Remember layout state per input graph so unrelated callers cannot affect each other. const previousLayouts = new WeakMap<Graph<GraphLabel, NodeLabel, EdgeLabel>, PreviousLayout>();"
- [dagre-recursive-clusters](https://raw.githubusercontent.com/dagrejs/dagre/master/lib/layout.ts): "// First, recursively layout all clusters with their own rankdir clusterNodes.forEach(v => {"

### 13. d3-dag (erikbrinkman/d3-dag, MIT, TypeScript) is a better comparison engine than the thesis said. src/sugiyama/layering/simplex.ts is a network-simplex layering that accepts rank constraints and same-layer group constraints, close to this package's partitions and hints. src/sugiyama/coord/quad.ts places nodes by quadratic programming, like the package's quadratic in-rank objective. src/sugiyama/decross/opt.ts solves crossing minimisation exactly, an NP-complete problem, and refuses graphs that look too large, so do not use it at target scale

Verdict: antithesis. Confidence: high.

All three files are verified. The thesis admitted it had not read the internals, and the antithesis's additions hold.

Citations:

- [r13-simplex](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/src/sugiyama/layering/simplex.ts): "constraints that indicate which nodes should be above other nodes, or"
- [r13-quad](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/src/sugiyama/coord/quad.ts): "This operators generally takes the longest of all built-in operators but"
- [r13-opt](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/src/sugiyama/decross/opt.ts): "This method brute forces an NP-Complete problem, and as such may run for an"
- [r13-lic](https://raw.githubusercontent.com/erikbrinkman/d3-dag/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Thesis (low): d3-dag (erikbrinkman/d3-dag, MIT, TypeScript) provides a general layered 'sugiyama' layout in TypeScript. It is a permissively licensed TS alternative to dagre for comparing layering and crossing results, though I did not read its ordering internals.

Thesis citations:

- [d3dag-index](https://raw.githubusercontent.com/erikbrinkman/d3-dag/master/src/index.ts): "- {@link sugiyama} - for a general layered representation."
- [d3dag-lic](https://raw.githubusercontent.com/erikbrinkman/d3-dag/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Antithesis: high: It admits not reading ordering internals, then gives d3-dag only a generic recommendation.

Antithesis: high: Exact crossing minimization is specifically inappropriate for target-scale graphs.

Antithesis: high: It misses d3-dag's network-simplex-style layerer with rank and same-layer grouping constraints.

Counter-evidence:

- [d3dag-decrossopt-scale-warning](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/src/sugiyama/decross/opt.ts): "This method brute forces an NP-Complete problem, and as such may run for an *exceedingly long time on large graphs. As a result, any graph that is* probably too large will throw an error instead of running. Use with care."
- [d3dag-simplex-rank-group](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/src/sugiyama/layering/simplex.ts): "The current implementation allows specifying {@link rank} *constraints that indicate which nodes should be above other nodes, or* {@link group} constraints that say which nodes should be on the same layer."

### 14. WebCola (tgdwyer/WebCola, MIT, TypeScript) is the reference for the placement solver. src/vpsc.ts holds the Variable, Constraint, Block, Blocks and Solver classes: the VPSC solver that merges constraint blocks, which the package README names. Two more files matter for this question. src/powergraph.ts builds power-graph modules, a way to group nodes and compress edges (part c). src/gridrouter.ts does orthogonal routing on a grid

Verdict: middle. Confidence: medium.

The antithesis asked for specific modules. I listed the src directory and checked the class declarations. The package README credits WebCola's directed edge constraints.

Citations:

- [r14-solver](https://raw.githubusercontent.com/tgdwyer/WebCola/master/src/vpsc.ts): "export class Solver {"
- [r14-power](https://raw.githubusercontent.com/tgdwyer/WebCola/master/src/powergraph.ts): "export class ModuleSet {"
- [r14-grid](https://raw.githubusercontent.com/tgdwyer/WebCola/master/src/gridrouter.ts): "export class NodeWrapper {"
- [r14-local](../../packages/graph-layout/README.md): "WebCola's directed edge constraints (MIT), which the directed separations follow"

Thesis (medium): WebCola (tgdwyer/WebCola, MIT, TypeScript) is a constraint-based layout engine with alignment and separation constraints. It is the code family behind the package's VPSC/IPSep-CoLa placement, so it is the reference for the placement step, not for layering.

Thesis citations:

- [webcola-readme](https://raw.githubusercontent.com/tgdwyer/WebCola/master/README.md): "JavaScript constraint based layout for high-quality graph visualization and exploration"
- [webcola-lic](https://raw.githubusercontent.com/tgdwyer/WebCola/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Antithesis: medium: The connection to VPSC/IPSep-CoLa is asserted without identifying the relevant WebCola solver modules.

Antithesis: high: “Reference for the placement step” does not identify the exact integration boundary, constraints, or rank-preservation mechanism.

Antithesis: speculative: A generic constraint-layout description does not establish suitability as the package's placement backend.

### 15. React Flow (xyflow/xyflow, MIT) can render only the elements inside the viewport, through the onlyRenderVisibleElements option in packages/react/src/types/component-props.ts. Its own documentation warns that this adds overhead, so it has to be measured. It does nothing for layout time, routing cost, drawing width or visual clutter; those still need grouping and semantic zoom

Verdict: middle. Confidence: high.

Both quotes are verified. Culling speeds up rendering; it does not make the drawing readable.

Citations:

- [r15-prop](https://raw.githubusercontent.com/xyflow/xyflow/main/packages/react/src/types/component-props.ts): "onlyRenderVisibleElements?: boolean;"
- [r15-overhead](https://raw.githubusercontent.com/xyflow/xyflow/main/packages/react/src/types/component-props.ts): "This might improve performance when you have a large number of nodes and edges but also adds an overhead."
- [r15-lic](https://raw.githubusercontent.com/xyflow/xyflow/main/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Thesis (high): React Flow (xyflow/xyflow, MIT) implements viewport culling through an onlyRenderVisibleElements option, documented as improving performance for large node and edge counts at a cost of overhead. This is the most direct browser-side technique for keeping a 1,122-node lineage responsive, and it works with the package's output as a plain node and edge list.

Thesis citations:

- [xy-culling](https://raw.githubusercontent.com/xyflow/xyflow/main/packages/react/src/types/component-props.ts): "This might improve performance when you have a large number of nodes and edges but also adds an overhead."
- [xy-prop](https://raw.githubusercontent.com/xyflow/xyflow/main/packages/react/src/types/component-props.ts): "onlyRenderVisibleElements?: boolean;"
- [xy-lic](https://raw.githubusercontent.com/xyflow/xyflow/main/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Antithesis: high: Viewport culling does not reduce layout time, routing cost, global drawing width, or semantic density.

Antithesis: medium: The cited option warns of overhead, so it must be measured rather than declared the most direct solution.

Antithesis: high: It treats DOM culling as a sufficient readability strategy while omitting aggregation, high-degree suppression, and semantic zoom.

### 16. Sigma.js (jacomyal/sigma.js, MIT) is a WebGL renderer built on graphology, aimed at graphs of thousands of nodes and edges. It is the fallback if DOM or SVG rendering of the package's output stalls. Overview-plus-detail, grouping and semantic zoom would still have to be built on top of it

Verdict: middle. Confidence: high.

The README is verified. The antithesis is right that a renderer is not a navigation design.

Citations:

- [r16-readme](https://raw.githubusercontent.com/jacomyal/sigma.js/main/README.md): "nodes and edges using WebGL, and built on top of [graphology]"
- [r16-lic](https://raw.githubusercontent.com/jacomyal/sigma.js/main/LICENSE.txt): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Thesis (high): Sigma.js (jacomyal/sigma.js, MIT, TypeScript) is a WebGL renderer built for graphs of thousands of nodes and edges, on top of graphology. It is the best candidate for a WebGL drawing layer if the React Flow DOM rendering stalls, and its viewport and camera code (packages/sigma/src/sigma.ts) is the reference for overview-plus-detail navigation.

Thesis citations:

- [sigma-readme](https://raw.githubusercontent.com/jacomyal/sigma.js/main/README.md): "nodes and edges using WebGL, and built on top of [graphology]"
- [sigma-lic](https://raw.githubusercontent.com/jacomyal/sigma.js/main/LICENSE.txt): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Antithesis: high: Sigma claims graphs of thousands, not 10,000+ dense layered lineage graphs.

Antithesis: medium: WebGL rendering does not itself provide overview-plus-detail, aggregation, a minimap, or semantic zoom.

Antithesis: high: The README describes a renderer, not a layered-layout or lineage-navigation implementation.

Counter-evidence:

- [sigma-thousands-webgl](https://raw.githubusercontent.com/jacomyal/sigma.js/main/README.md): "Sigma.js](<https://www.sigmajs.org>) is an open-source JavaScript library aimed at visualizing graphs of thousands of nodes and edges using WebGL, and built on top of [graphology](https://graphology.github.io/)."

### 17. cosmos.gl (cosmograph-org/cosmos, MIT) runs force simulation and drawing on the GPU and says it handles hundreds of thousands of points in real time. It has no layered layout, so it matters here only as a GPU-rendering reference or a force-directed overview, not for views that must keep ranks

Verdict: thesis. Confidence: medium.

The antithesis said the capacity claim had no evidence. The README states it, though it is the project's own claim and I have not benchmarked it.

Citations:

- [r17-readme](https://raw.githubusercontent.com/cosmograph-org/cosmos/main/README.md): "It enables the real-time simulation of network graphs consisting of hundreds of thousands of points and links on modern hardware."

Thesis (medium): cosmos.gl (cosmograph-org/cosmos, MIT) is a GPU force-graph engine that handles hundreds of thousands of nodes. It does no layered layout, so it is relevant only for an overview view or a force-directed comparison, not for ranks.

Thesis citations:

- [cosmos-readme](https://raw.githubusercontent.com/cosmograph-org/cosmos/main/README.md): "**cosmos.gl** is a high-performance WebGL Force Graph algorithm and rendering engine."
- [cosmos-lic](https://raw.githubusercontent.com/cosmograph-org/cosmos/main/LICENCE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Antithesis: medium: Force-graph coordinates are not a substitute for rank-preserving overview coordinates.

Antithesis: high: The thesis supplies no evidence for the claimed hundreds-of-thousands capacity.

Antithesis: high: A high-performance force renderer is not automatically useful for preserving the meaning of a layered lineage drawing.

### 18. Cytoscape.js (MIT) has a performance guide, documentation/md/performance.md, that is more useful than the three viewport switches alone. It names edges and labels as the expensive parts to draw. It recommends cy.batch() for bulk updates, min-zoomed-font-size so small labels are not drawn, and hideEdgesOnViewport while the user pans or zooms. Any renderer of this package's output can adopt the same idea: labels and edges shown according to zoom level

Verdict: middle. Confidence: high.

I verified the guide. The antithesis's extension is correct and makes the point stronger.

Citations:

- [r18-edges](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/md/performance.md): "Edges are particularly expensive to render."
- [r18-labels](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/md/performance.md): "Consider setting `min-zoomed-font-size` in your style so that when labels are small --- and hard to read anyway --- they are not rendered."
- [r18-batch](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/md/performance.md): "Use ``[`cy.batch()`](#core/graph-manipulation/cy.batch)`` to modify many elements at once."
- [r18-lic](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Thesis (medium): Cytoscape.js (cytoscape/cytoscape.js, MIT) documents performance-tuning switches for interaction: textureOnViewport, hideEdgesOnViewport and hideLabelsOnViewport. These are cheap level-of-detail controls for panning and zooming a dense lineage drawing, and they work with any precomputed positions.

Thesis citations:

- [cyto-perf](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/snippets/performance-tuning.js): "textureOnViewport: true,"
- [cyto-lic](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

Antithesis: high: The three interaction switches omit Cytoscape's more fundamental guidance on batching, labels, and edge simplification.

Antithesis: medium: Precomputed positions do not by themselves guarantee interactive rendering of many long routed edges.

Antithesis: high: The repository explicitly identifies edges and labels as expensive, which makes zoom-dependent label policy and edge simplification core requirements.

Counter-evidence:

- [cytoscape-edges-cost](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/md/performance.md): "* Edges are particularly expensive to render. Multigraphs become even more expensive with the need for bezier curve edges."
- [cytoscape-labels-cost](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/md/performance.md): "* **Labels** : Drawing labels is expensive."

### 19. dbt-docs (dbt-labs/dbt-docs, Apache-2.0) loads cytoscape and cytoscape-dagre in src/app/components/graph/graph-viz.js. That only shows a dependency. It says nothing about how dagre is configured, how it copes with a large project, or whether this extension is meant to replace it

Verdict: middle. Confidence: medium.

The imports are verified. The antithesis is right that no conclusion about performance or replacement follows from them.

Citations:

- [r19-dagre](https://raw.githubusercontent.com/dbt-labs/dbt-docs/main/src/app/components/graph/graph-viz.js): "const dagre = require('cytoscape-dagre');"
- [r19-lic](https://raw.githubusercontent.com/dbt-labs/dbt-docs/main/LICENSE): "Version 2.0, January 2004"

Thesis (medium): dbt's own docs lineage (dbt-labs/dbt-docs, Apache-2.0) draws with cytoscape and the cytoscape-dagre extension, so the dbt-native lineage uses dagre layout. This is the baseline the extension is replacing; I did not measure its behaviour at 1,000+ nodes.

Thesis citations:

- [dbtdocs-cyto](https://raw.githubusercontent.com/dbt-labs/dbt-docs/main/src/app/components/graph/graph-viz.js): "const cytoscape = require('cytoscape');"
- [dbtdocs-dagre](https://raw.githubusercontent.com/dbt-labs/dbt-docs/main/src/app/components/graph/graph-viz.js): "const dagre = require('cytoscape-dagre');"
- [dbtdocs-lic](https://raw.githubusercontent.com/dbt-labs/dbt-docs/main/LICENSE): "Version 2.0, January 2004"

Antithesis: medium: Imports identify dependencies, not actual dagre configuration, graph-size behavior, or all rendering paths.

Antithesis: high: “The baseline the extension is replacing” is not established by repository evidence.

Antithesis: speculative: No performance conclusion follows from require statements.

### 20. Marquez's web UI (Apache-2.0) runs ELK's layered algorithm at render time, in a web worker. web/libs/graph/src/layout/useLayout.ts imports elkjs, loads '/elk-worker.min.js', and sets elk.algorithm to 'layered' with Coffman-Graham layering, layer-sweep crossing minimisation and hierarchyHandling INCLUDE_CHILDREN. It also has a keepPreviousGraph prop. It is a concrete, readable example of driving ELK for lineage in a worker. Nothing shown here says how it behaves on large projects

Verdict: new. Confidence: high.

The thesis did not confirm which engine runs, and the antithesis rightly said an ElkNode type proves nothing. Reading useLayout.ts settles it: elkjs's layered algorithm runs in a worker.

Citations:

- [r20-import](https://raw.githubusercontent.com/MarquezProject/marquez/main/web/libs/graph/src/layout/useLayout.ts): "import ELK, { ElkNode } from 'elkjs'"
- [r20-worker](https://raw.githubusercontent.com/MarquezProject/marquez/main/web/libs/graph/src/layout/useLayout.ts): "webWorkerUrl = '/elk-worker.min.js',"
- [r20-layering](https://raw.githubusercontent.com/MarquezProject/marquez/main/web/libs/graph/src/layout/useLayout.ts): "'layered.layering.strategy': 'COFFMAN_GRAHAM',"
- [r20-type](https://raw.githubusercontent.com/MarquezProject/marquez/main/web/src/routes/table-level/layout.ts): "import { Edge, Node as ElkNode } from '../../../libs/graph'"

Thesis (medium): Marquez's web UI (MarquezProject/marquez, Apache-2.0) builds ELK-typed graph nodes for its table-level lineage (web/src/routes/table-level/layout.ts, with createElkNodes), so it is a data-lineage viewer that shapes its graph for ELK-style layout. Its README declares Apache-2.0. I did not confirm which layout engine runs at render time.

Thesis citations:

- [marquez-elk](https://raw.githubusercontent.com/MarquezProject/marquez/main/web/src/routes/table-level/layout.ts): "const nodes: ElkNode<JobOrDataset, TableLevelNodeData>[] = []"
- [marquez-lic](https://raw.githubusercontent.com/MarquezProject/marquez/main/README.md): "[![license](https://img.shields.io/badge/license-Apache_2.0-blue.svg)]"

Antithesis: high: An ElkNode-typed array is an input-model detail, not proof that Marquez runs ELK at render time.

Antithesis: high: The thesis admits it did not confirm the crucial layout-engine fact.

Antithesis: high: ELK-shaped TypeScript types are conflated with ELK layout use and large-project capability.

### 21. DataHub's lineage V3 UI (datahub-project/datahub, Apache-2.0, React Flow 11) shows progressive disclosure in datahub-web-react/src/app/lineageV3/useComputeGraph/boundingBoxes/computeBoundingBoxGraph.ts. It lays out grouped entities in bounding boxes and places the rest freely, hides data-process instances by default, and reveals nodes and edges through expansion state and lineage filter nodes. It is a strong example for part (c). It is not established that it collapses groups into single proxy nodes, or that it is the best example

Verdict: middle. Confidence: medium.

The file is verified. The antithesis is correct that what the file shows is expansion and filtering, not collapsing.

Citations:

- [r21-bb](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/src/app/lineageV3/useComputeGraph/boundingBoxes/computeBoundingBoxGraph.ts): "Bounding boxes and free entities (displayed entities not rendered in a box) are positioned"
- [r21-exp](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/src/app/lineageV3/useComputeGraph/boundingBoxes/computeBoundingBoxGraph.ts): "expansion state, lineage filter nodes)."
- [r21-rf](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/package.json): ""reactflow": "^11.10.1","
- [r21-lic](https://raw.githubusercontent.com/datahub-project/datahub/master/LICENSE): "Licensed under the Apache License, Version 2.0 (the "License");"

Thesis (medium): DataHub's lineage V3 UI (datahub-project/datahub, Apache-2.0) uses React Flow and computes bounding boxes for grouping, placing grouped entities into boxes and free entities separately. This is the best surveyed example of grouping and collapsing for a large lineage graph, relevant to point (c) of the question.

Thesis citations:

- [datahub-bb](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/src/app/lineageV3/useComputeGraph/boundingBoxes/computeBoundingBoxGraph.ts): "Bounding boxes and free entities (displayed entities not rendered in a box) are positioned"
- [datahub-rf](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/package.json): ""reactflow": "^11.10.1","
- [datahub-lic](https://raw.githubusercontent.com/datahub-project/datahub/master/LICENSE): "Licensed under the Apache License, Version 2.0 (the "License");"

Antithesis: high: “Best surveyed example” is unsupported.

Antithesis: high: Bounding boxes do not establish that the viewer implements user-controlled collapsing.

Antithesis: high: The fetched source describes filters and expansion state; those are useful progressive-disclosure mechanisms but not proof of collapsed group proxy nodes.

Counter-evidence:

- [datahub-hidden-processes](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/src/app/lineageV3/useComputeGraph/boundingBoxes/computeBoundingBoxGraph.ts): "Builds the node filter for the bounding-box graph. Data process instances are hidden unless * `showDataProcessInstances` is set."
- [datahub-expansion-state](https://raw.githubusercontent.com/datahub-project/datahub/master/datahub-web-react/src/app/lineageV3/useComputeGraph/boundingBoxes/computeBoundingBoxGraph.ts): "1. Displayed nodes are computed globally via `computeLineageGraph`, seeded by the home *box's members (up to the home box's `boundingBoxLimit`, since the home entity has no* lineage of its own), using the standard impact analysis display rules (per-node filters, * expansion state, lineage filter nodes)."

### 22. The package shares one dummy chain per bundle (one bundle per edge kind and node pair), following Pupyrev, Nachmanson and Kaufmann. That is how long edges are represented internally. It does not show that users see bundled edges or that the drawing is readable. The open problems go beyond width: when to show labels, simplifying edges, merging ranks, and semantic zoom

Verdict: middle. Confidence: high.

The README line is verified. The thesis's conclusion that only width remained does not follow from it.

Citations:

- [r22-readme](../../packages/graph-layout/README.md): "Dummy chains per bundle (one bundle per kind and node pair); lateral ports through port dummies"

Thesis (high): The package already uses Pupyrev-Nachmanson-Kaufmann style bundling for long-edge dummy chains, one bundle per kind and node pair. Edge bundling is therefore partly present, so the open gap is at the layout level (the 366,858 px width), not the bundling itself. The package README is the source for this.

Thesis citations:

- [local-bundles](../../packages/graph-layout/README.md): "Dummy chains per bundle (one bundle per kind and node pair); lateral ports through port dummies"

Antithesis: high: Bundled dummy chains are not evidence of user-visible edge bundling.

Antithesis: high: The conclusion that width is the sole remaining problem ignores label policy, interaction filtering, rank aggregation, edge rendering, and semantic zoom.

Antithesis: medium: An internal long-edge representation is treated as a proven readability outcome.

### 23. Licences, for an MIT package. ELK, elkjs and elk-rs (EPL-2.0, with GPL-3.0-or-later as an option for ELK and elk-rs), Graphviz (EPL-2.0) and OGDF (GPL) can be read, and their algorithms reimplemented from the papers, but their code should not be copied in. EPL-2.0 has a narrower rule for software that only links to the program, so calling elkjs or elk-rs as a separate benchmark or optional backend is a different question from copying. The permissive sources to study closely are MSAGL, dagre, d3-dag, WebCola, rust-sugiyama and rust-dagre; credit them and record where any copied code came from. This is an engineering note, not legal advice

Verdict: middle. Confidence: medium.

The antithesis is right that the thesis treated copying, linking and reimplementation as one thing. The EPL text excludes works that only link to or bind by name to the program from 'Modified Works'.

Citations:

- [r23-epl](https://raw.githubusercontent.com/eclipse-elk/elk/master/LICENSE.md): "Modified Works shall not include works that contain only declarations,"
- [r23-ogdf](https://raw.githubusercontent.com/ogdf/ogdf/master/LICENSE.txt): "modify it under the terms of the GNU General Public License"

Thesis (medium): Licence: the package is MIT. ELK, elk-rs, elkjs (EPL-2.0), OGDF (GPL) and Graphviz (EPL-2.0) are not MIT-compatible in the same way. The safe path is to study algorithms and reimplement from papers, and to copy only MIT sources (MSAGL, dagre, rust-sugiyama, rust-dagre). This is an engineering note, not legal advice.

Thesis citations:

- [lic-elk](https://raw.githubusercontent.com/eclipse-elk/elk/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p3order/InteractiveCrossingMinimizer.java): "SPDX-License-Identifier: EPL-2.0 OR GPL-3.0-or-later"
- [lic-ogdf](https://raw.githubusercontent.com/ogdf/ogdf/master/LICENSE.txt): "modify it under the terms of the GNU General Public License"
- [lic-msagl](https://raw.githubusercontent.com/microsoft/automatic-graph-layout/master/LICENSE): "without limitation the rights to use, copy, modify, merge, publish,"

Antithesis: high: The license guidance is too categorical. EPL-2.0 distinguishes Modified Works containing program contents from work containing only declarations/interfaces used to link or bind.

Antithesis: medium: “Copy only MIT sources” is not a sufficient provenance policy; copied tests, dependencies, papers, and integration architecture also matter.

Antithesis: high: It collapses copying, independent reimplementation, process isolation, and linking into one compatibility statement.

Counter-evidence:

- [epl-modified-work-exclusion](https://raw.githubusercontent.com/eclipse-elk/elk/master/LICENSE.md): "Modified Works shall not include works that contain only declarations, interfaces, types, classes, structures, or files of the Program solely in each case in order to link to, bind by name, or subclass the Program or Modified Works thereof."

### 24. None of these repositories was benchmarked. The benchmark should use the package's own 1,122-node graph plus synthetic graphs of 5,000 and 10,000 nodes. Compare against elkjs, elk-rs, current dagre and d3-dag, and optionally Graphviz through hpcc-js-wasm. Record layout time, memory, worker transfer time, cancellation latency, crossings, width, and stability after edits that add nodes and edges, not just resizes. Measure frame rate and time to first paint in the webview separately

Verdict: middle. Confidence: speculative.

This is a recommendation about method, so it has no citation. The antithesis's extra metrics are adopted.

Thesis (speculative): Gaps: none of the surveyed repositories was benchmarked here, so no speed claim for 1,000-10,000+ nodes is verified. The benchmark that matters is the package's own 1,122-node baseline, rerun with elk-rs and elkjs as the same-input comparison, plus OGDF or Graphviz if their licences are acceptable for a study harness.

Antithesis: high: The proposed benchmark omits memory, worker transfer time, cancellation latency, frame rate, time to first paint, and stability under edits.

Antithesis: medium: Comparing layout engines alone cannot determine whether width comes from ranking, dimensions, routing, or visualization policy.

Antithesis: high: Same-input layout timing cannot validate interactive browser rendering or readability.

### 25. antvis/G6 (MIT, TypeScript) is a graph visualisation engine that combines rendering, layout, interaction and animation. Add it to the rendering candidates next to React Flow, Sigma.js and Cytoscape.js. Whether its group ('combo') collapsing and level-of-detail code hold up at this scale has not been checked

Verdict: new. Confidence: low.

I verified only the README and licence, not the source.

Citations:

- [r25-readme](https://raw.githubusercontent.com/antvis/G6/master/README.md): "is a graph visualization engine, which provides a set of basic mechanisms"
- [r25-lic](https://raw.githubusercontent.com/antvis/G6/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy"

### 26. hpcc-systems/hpcc-js-wasm (packages/graphviz; an Apache-2.0 wrapper around EPL-licensed Graphviz) runs Graphviz in the browser and in Node through WASM. It is the practical way to put dot into the same benchmark harness as the TypeScript package. It also shows how to ship a C/C++ layout engine into a webview

Verdict: new. Confidence: medium.

I verified the README. How it performs on large graphs is unmeasured.

Citations:

- [r26-readme](https://raw.githubusercontent.com/hpcc-systems/hpcc-js-wasm/trunk/packages/graphviz/README.md): "This package provides a WebAssembly wrapper around the"

### 27. Part of the 366,858 px width probably comes from the package's own setting for placing ranks, not from a missing technique. The README makes stacked rows (ranks: "rows") the default and offers ranks: "levels" as an alternative. Compare the two modes on the 1,122-node graph before doing any work with external engines. None of the repositories surveyed shows a way to keep a graph this size narrow without grouping or merging nodes

Verdict: new. Confidence: low.

The option is verified in the package README. Its effect on this graph is my untested inference.

Citations:

- [r27-ranks](../../packages/graph-layout/README.md): "Across: stacked rows (`ranks: "rows"`, the default), or levels (`ranks: "levels"`)"

## Alternatives the thesis missed

high: Re-rank current dagre instead of treating it as a no-cluster, no-incremental historical baseline. Its current TypeScript source includes recursive cluster layout and remembers prior state per input graph, so it warrants a current API and benchmark audit.

- [dagre-cluster-nodes](https://raw.githubusercontent.com/dagrejs/dagre/master/lib/layout.ts): "const clusterNodes: string[] = g.nodes().filter(v => g.children(v).length);"

high: Study d3-dag as a permissively licensed TypeScript comparison engine, but do not use decrossOpt at target scale. It exposes rank and same-layer group constraints in its simplex layerer and offers quadratic optimization placement, making it a useful comparison for partitions and hints even though it is not a full ports-and-routing engine.

- [d3dag-quadratic-cost](https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/src/sugiyama/coord/quad.ts): "*This operators generally takes the longest of all built-in operators but* produces a pleasing layout."

high: Add antvis/G6 to the rendering survey. It is MIT-licensed TypeScript and explicitly combines rendering, layout, interaction, animation, and auxiliary tools, making it a more integrated candidate than treating React Flow, Sigma, and Cytoscape as the only browser-rendering choices. Its current combo-collapse and LOD implementation still needs direct source review before claiming scale fitness.

- [g6-integrated-surface](https://raw.githubusercontent.com/antvis/G6/master/README.md): "G6](<https://github.com/antvis/g6>) is a graph visualization engine, which provides a set of basic mechanisms, including rendering, layout, analysis, interaction, animation, and other auxiliary tools."
- [g6-mit-permission](https://raw.githubusercontent.com/antvis/G6/master/LICENSE): "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction"

medium: Add hpcc-systems/hpcc-js-wasm as a concrete Graphviz browser/Node delivery reference. It supplies a WASM Graphviz wrapper and mutable programmatic graphs with cluster attributes, so it is useful for integration and test-harness design even if dot should not be selected as a production large-graph engine without measurements.

- [hpcc-graphviz-wasm](https://raw.githubusercontent.com/hpcc-systems/hpcc-js-wasm/trunk/packages/graphviz/README.md): "This package provides a WebAssembly wrapper around the [Graphviz](https://www.graphviz.org/) library. This allows for the rendering of DOT language graphs directly within a browser or NodeJS type environment."
- [hpcc-graphviz-cluster-attributes](https://raw.githubusercontent.com/hpcc-systems/hpcc-js-wasm/trunk/packages/graphviz/README.md): "Attribute names and values follow Graphviz itself; see the official Graphviz [attribute reference](https://graphviz.org/docs/attrs/) for the supported graph, node, edge, and cluster attributes."

high: Treat Cytoscape's label and edge policy as a first-class readability alternative rather than relying only on pan/zoom toggles. Batching updates and suppressing labels until a useful zoom level directly address known rendering costs in dense lineage drawings.

- [cytoscape-batch-updates](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/md/performance.md): "* **Batch element modifications** : Use ``[`cy.batch()`](#core/graph-manipulation/cy.batch)`` to modify many elements at once."
- [cytoscape-zoom-label-threshold](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/documentation/md/performance.md): "* Consider setting `min-zoomed-font-size` in your style so that when labels are small --- and hard to read anyway --- they are not rendered. When the labels are at least the size you set (i.e. the user zooms in), they will be visible."

## Open questions

- On the 1,122-node graph and on synthetic graphs of 5,000 and 10,000 nodes, how do elkjs, elk-rs, current dagre, d3-dag and Graphviz (through hpcc-js-wasm) compare with the package for time, memory, crossings and width?
- How much of the 366,858 px width disappears with ranks "levels" instead of "rows", and how much needs ranks to be merged or nodes grouped?
- Does dagre's useDynamic mode keep node order and positions stable when nodes and edges are added or removed, and what does it cost?
- Does MSAGL's incremental Sugiyama path handle edits to the graph (not just resizes), ports and clusters?
- Does any ELK plugin outside the layered algorithm implement sifting or multilevel crossing minimisation?
- Do elk-rs's WASM build and rust-dagre's WASI build run inside a VS Code webview, and what does it cost to pass 10,000 nodes in and out?
- Do DataHub or G6 collapse groups into single proxy nodes with merged edges, and how do they perform with more than 1,000 visible entities?
- How does Marquez's elkjs configuration (Coffman-Graham layering, INCLUDE_CHILDREN, keepPreviousGraph) behave on lineage graphs of 1,000 or more nodes?

## Rejected citations

- antithesis d3dag-quadratic-placement-fixed (<https://raw.githubusercontent.com/erikbrinkman/d3-dag/main/src/sugiyama/coord/quad.ts>): quote not found in the source: "* A {@link CoordQuad} that places nodes to minimize a quadratic function"
