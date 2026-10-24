/**
 * Import rules for the webview panels. Paths are relative to `webview_panels/`.
 * @type {import("dependency-cruiser").IConfiguration}
 */
// The lineage modules that hold plain data and pure functions: graph state, grouping, the card model, and both
// layouts with the gutter router. Their tests run without React, so they import no React, React Flow, CSS, UI kit,
// panel messaging, or a lineage module outside this list.
const LINEAGE_PURE =
  "^src/modules/lineage/(card|channels|columnTrace|edgeIds|expansionBatch|expansionCap|expansionGroups|graph|" +
  "groupEdges|grouping|gutterPlan|gutterRouter|hiddenNodes|layerTags|layered|layeredFlow|layeredInput|" +
  "layeredMetrics|layeredRanks|layeredRows|layout|minimap|routeDrawing|routeGeometry|routeTypes)\\.ts$";

module.exports = {
  forbidden: [
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
