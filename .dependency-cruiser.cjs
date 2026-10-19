/**
 * Import rules for the extension host and the webview contract. Layers, lowest first: core, settings, fusion,
 * projects; features and the roots sit above them.
 * @type {import("dependency-cruiser").IConfiguration}
 */
const ENTRY_ROOTS =
  "^src/(extension|compositionRoot|composeFusionCli|dbtPowerUserExtension)\\.ts$";
const SUPPORT =
  "^src/(commandRegistry|startupGate|extensionContext|extensionRoot)\\.ts$";
const layer = (from, to) => ({
  from: { path: `^src/${from}/` },
  to: { path: to },
});

module.exports = {
  // A dependency matching no entry is an error, so a new top-level folder has to be placed here before it imports
  // or is imported by anything.
  allowedSeverity: "error",
  allowed: [
    {
      comment: "Packages, Node built-ins and the webview contract.",
      from: {},
      to: { pathNot: "^src/" },
    },
    {
      comment:
        "Within one top-level folder; projects/ has its own sub-layers below.",
      from: { path: "^src/([^/]+)/", pathNot: "^src/projects/" },
      to: { path: "^src/$1/" },
    },
    {
      comment: "The roots compose everything.",
      from: { path: ENTRY_ROOTS },
      to: { path: "^src/" },
    },
    {
      comment: "Root support modules use only each other.",
      from: { path: SUPPORT },
      to: { path: SUPPORT },
    },
    layer("settings", "^src/core/"),
    layer("benchmark", "^src/settings/"),
    layer("fusion", "^src/(core|settings)/"),
    layer("executable", "^src/(core|settings|fusion)/"),
    layer("metadata", "^src/(core|fusion|projects)/"),
    layer("languageClient", "^src/(fusion|projects/clients)/"),
    layer("projects", "^src/(core|settings|fusion)/"),
    // Inside projects/, lowest first: registry, output, clients, manifest, project.
    {
      from: {
        path: "^src/projects/(registry|output|clients|manifest|project)/",
      },
      to: { path: "^src/projects/$1/" },
    },
    layer("projects/output", "^src/projects/registry/"),
    layer("projects/clients", "^src/projects/(registry|output)/"),
    layer(
      "projects/project",
      "^src/projects/(registry|output|clients|manifest)/",
    ),
    layer("webview", `^src/(core|benchmark|projects/project)/|${SUPPORT}`),
    layer(
      "features",
      // The manifest/ modules a feature reads: the Manifest type, a publication's id, and parse demand.
      `^src/(core|settings|fusion|projects/(registry|output|project)|webview|features)/|${SUPPORT}|` +
        "^src/projects/manifest/(manifestTypes|manifest|parseDemand)\\.ts$",
    ),
  ],
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
      name: "snapshot-reader-reads-only",
      severity: "error",
      comment:
        "readProjectSnapshot gathers inputs through settings/ and resolves them in core/.",
      from: { path: "^src/projects/clients/readProjectSnapshot\\.ts$" },
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
      name: "column-proposals-never-write",
      severity: "error",
      comment:
        "Type and description proposals are read-only: a file changes only when the user saves the documentation.",
      from: {
        path: "^src/(core/columns/|core/lineage/upstreamDescriptions|features/docs/(columnTypeSource|upstreamDescriptionSource|columnProposals))",
      },
      to: {
        path: "^src/projects/project/userFiles\\.ts$|^src/features/docs/(docsEditSave|docsYaml)\\.ts$|^(node:)?fs(/promises)?$",
      },
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
