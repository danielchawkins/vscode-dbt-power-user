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
      name: "core-is-pure",
      severity: "error",
      comment: "core/ imports neither vscode nor any other layer.",
      from: { path: "^src/core/" },
      to: { path: "^vscode$|^node_modules/@types/vscode/|^src/", pathNot: "^src/core/" },
    },
    {
      name: "pure-modules-stay-pure",
      severity: "error",
      comment: "These modules hold logic that property tests cover without the vscode module.",
      from: {
        path: ["^src/dbt_integration/dbtAssociations\\.ts$"],
      },
      to: { path: "^vscode$|^node_modules/@types/vscode/|^src/", pathNot: "^src/core/" },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^src/test" },
    tsPreCompilationDeps: true,
  },
};
