import { VSCodeCommands } from "../features/commands";
import { CteProfilerDecorationProvider } from "../features/cte/cteProfilerDecorationProvider";
import { CteProfilerService } from "../features/cte/cteProfilerService";
import { DeferToProductionStatusBar } from "../features/defer/deferToProductionStatusBar";
import { DiagnosticsOutputChannel } from "../features/diagnostics/diagnosticsOutputChannel";
import type { ColumnProposalRequests } from "../features/docs/columnProposals";
import { ProjectSetupCommands } from "../features/projectSetup/projectSetupCommands";
import { RunModel } from "../features/run/runModel";
import { RunTest } from "../features/run/runTest";
import type { StartupGate } from "../startupGate";
import type { ProjectsGraph } from "./projects";

export function composeCommands(
  graph: ProjectsGraph,
  startupGate: StartupGate,
  columnProposals: ColumnProposalRequests,
) {
  const { projects, terminal } = graph;
  const cteProfilerService = new CteProfilerService(projects);
  const deferToProductionStatusBar = new DeferToProductionStatusBar(
    projects,
    terminal,
  );
  const vscodeCommands = new VSCodeCommands({
    projects,
    currentProject: graph.currentProject,
    runModel: new RunModel(projects, graph.currentProject),
    runTest: new RunTest(projects, graph.queryManifestService),
    projectSetupCommands: new ProjectSetupCommands({
      outputChannels: graph.outputChannels,
    }),
    log: terminal,
    diagnosticsOutputChannel: new DiagnosticsOutputChannel(
      graph.outputChannels.createDiagnosticsChannel(),
    ),
    runHistoryService: graph.runHistoryService,
    cteProfilerService,
    cteProfilerDecorationProvider: new CteProfilerDecorationProvider(
      cteProfilerService,
      terminal,
    ),
    deferToProductionStatusBar,
    startupGate,
    columnProposals,
  });
  return { vscodeCommands, deferToProductionStatusBar };
}
