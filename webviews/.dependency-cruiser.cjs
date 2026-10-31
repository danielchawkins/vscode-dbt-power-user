/**
 * Import rules for the webview panels. Paths are relative to `webviews/`.
 * @type {import("dependency-cruiser").IConfiguration}
 */
// The lineage modules that hold plain data and pure functions: graph state, grouping, the card model, and both
// layouts with the gutter router. Their tests run without React, so they import no React, React Flow, CSS, UI kit,
// panel messaging, or a lineage module outside this list.
// The documentation-editor and query-results state: reducers, their types and the pure helpers they call. Their
// tests run without React, so they import no React, CSS, UI kit or panel messaging, and no module outside this list.
const PANEL_STATE_PURE =
  "^src/modules/(app/typedReducer|" +
  "documentationEditor/(state/(documentationReducer|entityType|types|incomingDocs)|proposals/proposalsReducer|utils|" +
  "types|components/tests/(testEdits|types))|" +
  "queryPanel/(constants|context/(queryPanelReducer|types)|components/QueryPanelContents/types))\\.ts$";

const LINEAGE_PURE =
  "^src/modules/lineage/(card|channels|columnTrace|edgeIds|expansionBatch|expansionCap|expansionGroups|graph|graphState|" +
  "groupEdges|grouping|gutterPlan|gutterRouter|filteredOut|layerTags|layered|layeredFlow|" +
  "layeredMetrics|layeredRanks|layeredRows|layout|minimap|projection|routeDrawing|routeGeometry|routeTypes|scope|visibility|" +
  "engine/[A-Za-z]+)\\.ts$";

// The lineage layout-engine port (engine/layoutEngine.ts), the registry that picks an engine (engine/engines.ts),
// and the adapters behind the port. The owned engine's own modules are listed so that, outside the adapter, nothing
// reaches around the port to them; retiring the engine is then a deletion.
const LAYOUT_PORT = "^src/modules/lineage/engine/layoutEngine\\.ts$";
const LAYOUT_REGISTRY = "^src/modules/lineage/engine/engines\\.ts$";
const LAYOUT_ADAPTERS =
  "^src/modules/lineage/engine/(ownedEngine|graphLayoutEngine)\\.ts$";
const OWNED_ENGINE =
  "^src/modules/lineage/(layered|layeredFlow|layeredMetrics|layeredRanks|layeredRows|gutterPlan|gutterRouter|" +
  "channels|routeTypes)\\.ts$";
// The panel modules, one per webview entry.
const PANELS = "documentationEditor|lineage|queryPanel";
const GRAPH_LAYOUT =
  "(^|/)packages/graph-layout/|(^|/)node_modules/@fusion-power-user/graph-layout/|^@fusion-power-user/graph-layout$";

module.exports = {
  forbidden: [
    {
      name: "panel-state-is-pure",
      severity: "error",
      comment:
        "Panel state (PANEL_STATE_PURE) imports only itself, the contract and plain packages; never React or CSS. Type-only imports erase at build time, so they are allowed.",
      from: { path: PANEL_STATE_PURE },
      to: {
        path: "^src/|node_modules/(react|react-dom)/|\\.css$",
        pathNot: PANEL_STATE_PURE,
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle means two modules are one concept or one of them is in the wrong layer.",
      from: {},
      to: { circular: true },
    },
    {
      name: "webview-imports-contract-only",
      severity: "error",
      comment:
        "Outside its own tree, the webview imports only packages and the webview contract, never host code.",
      from: { path: "^src/" },
      to: {
        path: "^\\.\\./",
        pathNot: "^\\.\\./packages/webview-contract/|node_modules/",
      },
    },
    {
      name: "lineage-core-is-pure",
      severity: "error",
      comment:
        "The lineage core (LINEAGE_PURE) imports only itself, the contract and plain packages; never React or CSS.",
      from: { path: LINEAGE_PURE },
      to: {
        path: "^src/|node_modules/(react|react-dom|@xyflow/react)/|\\.css$",
        pathNot: LINEAGE_PURE,
      },
    },
    {
      name: "lineage-layout-port-is-plain",
      severity: "error",
      comment:
        "The layout-engine port declares plain data and the LayoutEngine interface; it imports nothing, so no engine leaks into it.",
      from: { path: LAYOUT_PORT },
      to: {},
    },
    {
      name: "lineage-layout-adapters-from-registry",
      severity: "error",
      comment:
        "Only engines.ts imports an engine adapter; the panel asks for an engine through the registry and talks to the port.",
      from: { pathNot: `${LAYOUT_REGISTRY}|${LAYOUT_ADAPTERS}` },
      to: { path: LAYOUT_ADAPTERS },
    },
    {
      name: "lineage-owned-engine-behind-its-adapter",
      severity: "error",
      comment:
        "The owned layered layout and gutter router are reached only through engine/ownedEngine.ts, so retiring them deletes files and nothing else.",
      from: {
        pathNot: `${OWNED_ENGINE}|^src/modules/lineage/engine/ownedEngine\\.ts$`,
      },
      to: { path: OWNED_ENGINE },
    },
    {
      name: "graph-layout-behind-its-adapter",
      severity: "error",
      comment:
        "The webview uses @fusion-power-user/graph-layout only in engine/graphLayoutEngine.ts, the adapter that maps a LayoutRequest to the package's graph.",
      from: {
        pathNot: `^src/modules/lineage/engine/graphLayoutEngine\\.ts$|${GRAPH_LAYOUT}`,
      },
      to: { path: GRAPH_LAYOUT },
    },
    {
      name: "panels-are-independent",
      severity: "error",
      comment:
        "A panel module (documentationEditor, lineage, queryPanel) imports no other panel; what two panels share lives in uiCore/ or a shared module.",
      from: { path: `^src/modules/(${PANELS})/` },
      to: { path: `^src/modules/(${PANELS})/`, pathNot: "^src/modules/$1/" },
    },
    {
      name: "shared-modules-import-no-panel",
      severity: "error",
      comment:
        "A module outside the panels imports no panel: one that does belongs to that panel.",
      from: {
        path: "^src/(uiCore|modules)/",
        pathNot: `^src/modules/(${PANELS})/`,
      },
      to: { path: `^src/modules/(${PANELS})/` },
    },
    {
      name: "ui-core-imports-no-module",
      severity: "error",
      comment:
        "uiCore/ holds the primitives every panel uses, so it imports no module; a primitive takes what it needs (a theme, a callback) as a prop.",
      from: { path: "^src/uiCore/" },
      to: { path: "^src/modules/" },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["^src/test/", "\\.test\\.tsx?$"] },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".d.ts"],
    },
  },
};
