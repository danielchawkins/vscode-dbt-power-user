import { SourceModelCreationCodeLensProvider } from "../features/codegen/sourceModelCreationCodeLensProvider";
import { CodeLensProviders } from "../features/codeLenses";
import { SqlPreviewContentProvider } from "../features/compiledSql/sqlPreviewContentProvider";
import { ContentProviders } from "../features/contentProviders";
import { DocumentationTreeview } from "../features/modelTree/documentationTreeview";
import {
  ChildrenModelTreeview,
  ModelTestTreeview,
  ParentModelTreeview,
} from "../features/modelTree/modelTreeviewProvider";
import { RunHistoryTreeviewProvider } from "../features/runHistory/runHistoryTreeviewProvider";
import { SqlActionsCodeLensProvider } from "../features/sqlActions/sqlActionsCodeLensProvider";
import { VirtualSqlCodeLensProvider } from "../features/sqlActions/virtualSqlCodeLensProvider";
import { TreeviewProviders } from "../features/treeViews";
import type { ProjectsGraph } from "./projects";

export function composeEditorProviders(graph: ProjectsGraph) {
  const { projects } = graph;
  return {
    treeviewProviders: new TreeviewProviders(
      new ChildrenModelTreeview(projects),
      new ParentModelTreeview(projects),
      {
        test: new ModelTestTreeview(projects),
        documentation: new DocumentationTreeview(projects),
        parseDemand: graph.parseDemand,
      },
      new RunHistoryTreeviewProvider(graph.runHistoryService),
    ),
    contentProviders: new ContentProviders(
      new SqlPreviewContentProvider(projects),
    ),
    codeLensProviders: new CodeLensProviders(
      projects,
      new SourceModelCreationCodeLensProvider(),
      new VirtualSqlCodeLensProvider(graph.queryManifestService),
      new SqlActionsCodeLensProvider(),
    ),
  };
}
