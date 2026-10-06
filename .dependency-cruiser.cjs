/**
 * Import rules for the extension host and the webview contract. Layers, lowest first: core, settings, fusion,
 * projects; features and the roots sit above them.
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
      name: "core-is-pure",
      severity: "error",
      comment: "core/ imports neither vscode nor any other layer.",
      from: { path: "^src/core/" },
      to: {
        path: "^vscode$|^node_modules/@types/vscode/|^src/",
        pathNot: "^src/core/",
      },
    },
    {
      name: "pure-modules-stay-pure",
      severity: "error",
      comment:
        "These modules hold logic that property tests cover without the vscode module.",
      from: {
        path: ["^src/dbt_integration/dbtAssociations\\.ts$"],
      },
      to: {
        path: "^vscode$|^node_modules/@types/vscode/|^src/",
        pathNot: "^src/core/",
      },
    },
    {
      name: "snapshot-reader-reads-only",
      severity: "error",
      comment:
        "readProjectSnapshot gathers inputs through settings/ and resolves them in core/.",
      from: { path: "^src/projects/readProjectSnapshot\\.ts$" },
      to: {
        path: "^src/|^node_modules/",
        pathNot: "^src/(core|settings)/|^node_modules/@types/vscode/",
      },
    },
    {
      name: "nothing-imports-features",
      severity: "error",
      comment: "Only the roots import features/.",
      from: {
        pathNot:
          "^src/(features/|extension\\.ts$|compositionRoot\\.ts$|dbtPowerUserExtension\\.ts$)",
      },
      to: { path: "^src/features/" },
    },
    {
      name: "features-are-independent",
      severity: "error",
      comment:
        "A feature imports no other feature; the aggregators directly in features/ may.",
      from: { path: "^src/features/([^/]+)/" },
      to: { path: "^src/features/", pathNot: "^src/features/$1/" },
    },
    {
      name: "settings-imports-core",
      severity: "error",
      comment: "settings/ imports only core/ and itself.",
      from: { path: "^src/settings/" },
      to: { path: "^src/", pathNot: "^src/(core|settings)/" },
    },
    {
      name: "fusion-imports-core-and-settings",
      severity: "error",
      comment: "fusion/ imports only core/, settings/ and itself.",
      from: { path: "^src/fusion/" },
      to: {
        path: "^src/",
        pathNot: "^src/(core|settings|fusion)/",
      },
    },
    {
      name: "lower-layers-skip-webview",
      severity: "error",
      comment:
        "core/, settings/, fusion/ and projects/ do not import the webview host.",
      from: { path: "^src/(core|settings|fusion|projects)/" },
      to: { path: "^src/webview/" },
    },
    {
      name: "contract-is-pure",
      severity: "error",
      comment:
        "The webview contract imports only itself, so both builds can consume it.",
      from: { path: "^packages/webview-contract/src/" },
      to: { pathNot: "^packages/webview-contract/src/" },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment:
        "A module nothing imports is dead code or a missing entry point.",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "^src/extension\\.ts$",
          "^packages/webview-contract/src/index\\.ts$",
        ],
      },
      to: {},
    },
    {
      name: "no-removed-packages",
      severity: "error",
      comment:
        "The Altimate packages were removed; the extension is local-only.",
      from: {},
      to: { path: "@altimateai/" },
    },
    {
      name: "no-deprecated-core",
      severity: "error",
      comment: "Deprecated Node core modules.",
      from: {},
      to: {
        dependencyTypes: ["core"],
        path: "^(punycode|domain|constants|sys|_linklist|_stream_wrap)$",
      },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["^src/test", "\\.test\\.ts$"] },
    tsPreCompilationDeps: true,
  },
};
