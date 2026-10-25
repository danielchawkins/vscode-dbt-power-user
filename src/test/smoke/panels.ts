/** The extension's id, as `vscode.extensions.getExtension` takes it. */
export const EXTENSION_ID = "danielchawkins.fusion-power-user";

/** The activity-bar view container that holds the dbt tree views. */
export const DBT_VIEW_CONTAINER = "workbench.view.extension.dbt_view";

/**
 * The webview panels the smoke suites open: the view container and focus command that show each one, and the
 * `body[data-entry]` its page sets.
 */
export const PANELS = {
  docsEdit: {
    container: "workbench.view.extension.docs_edit_view",
    command: "fusionPowerUser.DocsEdit.focus",
    entry: "documentationEditor",
  },
  queryResults: {
    container: "workbench.view.extension.dbt_preview_results",
    command: "fusionPowerUser.PreviewResults.focus",
    entry: "queryResults",
  },
  lineage: {
    container: "workbench.view.extension.lineage_view",
    command: "fusionPowerUser.Lineage.focus",
    entry: "lineage",
  },
};
