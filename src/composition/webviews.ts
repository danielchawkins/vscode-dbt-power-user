import type { ColumnProposalRequests } from "../features/docs/columnProposals";
import { ColumnProposalService } from "../features/docs/columnProposals";
import { DbtTestService } from "../features/docs/dbtTestService";
import { DocGenService } from "../features/docs/docGenService";
import { DocsEditViewPanel } from "../features/docs/docsEditPanel";
import type { LineageService } from "../features/lineage/dbtLineageService";
import { LineagePanel } from "../features/lineage/lineagePanel";
import { LineageViewProvider } from "../features/lineage/lineageViewProvider";
import { WebviewViewProviders } from "../features/panels";
import { QueryResultPanel } from "../features/queryResults/queryResultPanel";
import { onCurrentClientChange } from "../projects/clients/clientChange";
import type { ProjectsGraph } from "./projects";

export function composeWebviews(
  graph: ProjectsGraph,
  dbtLineageService: LineageService,
  columnProposalRequests: ColumnProposalRequests,
): WebviewViewProviders {
  const {
    extensionContextStore,
    terminal,
    sharedState,
    projects,
    queryManifestService,
  } = graph;
  const lineagePanel = new LineagePanel({
    extensionContext: extensionContextStore,
    terminal,
    dbtLineageService,
    eventEmitterService: sharedState,
    queryManifestService,
    currentProject: graph.currentProject,
    metadataDemand: graph.metadataDemand,
  });
  if (graph.clients.pool) {
    lineagePanel.renderOn(
      onCurrentClientChange(graph.clients.pool, graph.currentProject),
    );
  }
  return new WebviewViewProviders(
    new QueryResultPanel({
      extensionContext: extensionContextStore,
      eventEmitterService: sharedState,
      log: terminal,
      queryManifestService,
      currentProject: graph.currentProject,
      onDidRemoveProject: projects.onDidRemoveProject,
    }),
    new DocsEditViewPanel({
      projects,
      extensionContext: extensionContextStore,
      services: {
        docGenService: new DocGenService(projects, graph.currentProject),
        dbtTestService: new DbtTestService(graph.currentProject),
        queryManifestService,
        sharedState,
        columnProposals: new ColumnProposalService({
          log: terminal,
          columnsNeedStrict: () => dbtLineageService.columnsNeedStrict(),
        }),
        columnProposalRequests,
      },
      terminal,
      metadataDemand: graph.metadataDemand,
    }),
    new LineageViewProvider(lineagePanel, projects),
  );
}
