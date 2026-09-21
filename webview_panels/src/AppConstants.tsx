import DocumentationProvider from "@modules/documentationEditor/DocumentationProvider";
import LineageView from "@modules/lineage/LineageView";
import QueryPanelProvider from "@modules/queryPanel/QueryPanelProvider";

// Routes available in the webview bundle. Keys must match each panel's viewPath.
export const AvailableRoutes = {
  "/docs-generator": {
    component: <DocumentationProvider />,
  },
  "/query-panel": { component: <QueryPanelProvider /> },
  "/lineage": { component: <LineageView /> },
};
