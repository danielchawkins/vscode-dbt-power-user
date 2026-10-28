import type { ColumnProposalRequests } from "../features/docs/columnProposals";
import { ColumnProposalService } from "../features/docs/columnProposals";
import { DocGenService } from "../features/docs/docGenService";
import { DocsEditViewPanel } from "../features/docs/docsEditPanel";
import { ModelTestService } from "../features/docs/modelTestService";
import { LineagePanel } from "../features/lineage/lineagePanel";
import type { LineageService } from "../features/lineage/lineageService";
import { LineageViewProvider } from "../features/lineage/lineageViewProvider";
import { WebviewViewProviders } from "../features/panels";
import { QueryResultPanel } from "../features/queryResults/queryResultPanel";
import { onCurrentClientChange } from "../projects/clients/clientChange";
import type { ProjectsGraph } from "./projects";

export function composeWebviews(
  graph: ProjectsGraph,
  lineageService: LineageService,
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
    lineageService,
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
      sharedState,
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
        modelTests: new ModelTestService(graph.currentProject),
        queryManifestService,
        sharedState,
        columnProposals: new ColumnProposalService({
          log: terminal,
          columnsNeedStrict: () => lineageService.columnsNeedStrict(),
        }),
        columnProposalRequests,
      },
      terminal,
      metadataDemand: graph.metadataDemand,
    }),
    new LineageViewProvider(lineagePanel, projects),
  );
}
