/**
 * Import rules for the webview panels. Paths are relative to `webview_panels/`.
 * @type {import("dependency-cruiser").IConfiguration}
 */
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
