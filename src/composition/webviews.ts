import type { ColumnProposalRequests } from "../features/docs/columnProposals";
import { ColumnProposalService } from "../features/docs/columnProposals";
import { DbtTestService } from "../features/docs/dbtTestService";
import { DocGenService } from "../features/docs/docGenService";
import { DocsEditViewPanel } from "../features/docs/docsEditPanel";
import type { DbtLineageService } from "../features/lineage/dbtLineageService";
import { LineagePanel } from "../features/lineage/lineagePanel";
import { LineageViewProvider } from "../features/lineage/lineageViewProvider";
import { WebviewViewProviders } from "../features/panels";
import { QueryResultPanel } from "../features/queryResults/queryResultPanel";
import { onCurrentClientChange } from "../projects/clients/clientChange";
import type { ProjectsGraph } from "./projects";

export function composeWebviews(
  graph: ProjectsGraph,
  dbtLineageService: DbtLineageService,
  columnProposalRequests: ColumnProposalRequests,
): WebviewViewProviders {
  const {
    extensionContextStore,
    terminal,
    sharedState,
    projects,
    queryManifestService,
  } = graph;
  const lineagePanel = new LineagePanel(
    extensionContextStore,
    terminal,
    dbtLineageService,
    sharedState,
    queryManifestService,
  );
  if (graph.clients.pool) {
    lineagePanel.renderOn(
      onCurrentClientChange(graph.clients.pool, graph.currentProject),
    );
  }
  return new WebviewViewProviders(
    new QueryResultPanel(
      extensionContextStore,
      sharedState,
      terminal,
      queryManifestService,
      projects.onDidRemoveProject,
    ),
    new DocsEditViewPanel(
      projects,
      extensionContextStore,
      {
        docGenService: new DocGenService(projects, queryManifestService),
        dbtTestService: new DbtTestService(queryManifestService),
        queryManifestService,
        emitterService: sharedState,
        columnProposals: new ColumnProposalService({
          log: terminal,
          columnsNeedStrict: () => dbtLineageService.columnsNeedStrict(),
        }),
        columnProposalRequests,
      },
      terminal,
      graph.parseDemand,
    ),
    new LineageViewProvider(lineagePanel, projects, graph.parseDemand),
  );
}
