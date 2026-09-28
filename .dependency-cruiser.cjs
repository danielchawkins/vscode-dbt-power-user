/**
 * Import rules for the extension host. The layer rules from docs/refactor/rearchitecture-plan.md are added in the
 * PR that creates each layer; a rule lands passing.
 * @type {import("dependency-cruiser").IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A cycle means two modules are one concept or one of them is in the wrong layer.",
      from: {},
      to: { circular: true },
    },
    {
      name: "pure-modules-stay-pure",
      severity: "error",
      comment: "These modules hold logic that property tests cover without the vscode module.",
      from: {
        path: [
          "^src/dbt_integration/projectPaths\\.ts$",
          "^src/dbt_integration/dbtAssociations\\.ts$",
        ],
      },
      to: { path: "^vscode$|^src/" , pathNot: "^src/dbt_integration/(projectPaths|dbtAssociations)\\.ts$" },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^src/test" },
    tsPreCompilationDeps: true,
  },
};
