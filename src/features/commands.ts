import { Disposable } from "vscode";
import { gatedRegister } from "../commandRegistry";
import type { Log } from "../core/log";
import type { ExtensionContextStore } from "../extensionContext";
import type { Projects } from "../projects/projects";
import type { RunHistoryService } from "../projects/runHistoryService";
import type { StartupGate } from "../startupGate";
import { registerCompiledSqlCommands } from "./compiledSql/commands";
import { registerCteCommands } from "./cte/commands";
import type { CteProfilerDecorationProvider } from "./cte/cteProfilerDecorationProvider";
import type { CteProfilerService } from "./cte/cteProfilerService";
import { registerDeferCommands } from "./defer/commands";
import type { DeferToProductionStatusBar } from "./defer/deferToProductionStatusBar";
import { registerDiagnosticsCommands } from "./diagnostics/commands";
import type { DiagnosticsOutputChannel } from "./diagnostics/diagnosticsOutputChannel";
import { registerDocsCommands } from "./docs/commands";
import { registerModelTreeCommands } from "./modelTree/commands";
import { registerProjectSetupCommands } from "./projectSetup/commands";
import type { ProjectSetupCommands } from "./projectSetup/projectSetupCommands";
import { registerRunCommands } from "./run/commands";
import type { RunModel } from "./run/runModel";
import type { RunTest } from "./run/runTest";
import { registerRunHistoryCommands } from "./runHistory/commands";

/** The collaborators the features' commands run against. */
export interface CommandDeps {
  projects: Projects;
  extensionContext: ExtensionContextStore;
  runModel: RunModel;
  runTest: RunTest;
  projectSetupCommands: ProjectSetupCommands;
  log: Log;
  diagnosticsOutputChannel: DiagnosticsOutputChannel;
  runHistoryService: RunHistoryService;
  cteProfilerService: CteProfilerService;
  cteProfilerDecorationProvider: CteProfilerDecorationProvider;
  deferToProductionStatusBar: DeferToProductionStatusBar;
  startupGate: Pick<StartupGate, "whenSettled">;
}

/** Composes the commands each feature registers; owns their disposal. */
export class VSCodeCommands implements Disposable {
  private disposables: Disposable[] = [];

  constructor(deps: CommandDeps) {
    const register = gatedRegister(deps.startupGate);
    const { projects, runModel, runTest, log } = deps;
    const { cteProfilerService, cteProfilerDecorationProvider } = deps;
    this.disposables.push(
      deps.diagnosticsOutputChannel,
      cteProfilerService,
      cteProfilerDecorationProvider,
      ...registerRunCommands({ projects, runModel, runTest, log, register }),
      ...registerRunHistoryCommands(projects, deps.runHistoryService, register),
      ...registerCteCommands({
        projects,
        runModel,
        cteProfilerService,
        cteProfilerDecorationProvider,
        log,
        register,
      }),
      ...registerCompiledSqlCommands(register),
      ...registerDocsCommands(register),
      ...registerModelTreeCommands(register),
      ...registerProjectSetupCommands(
        deps.extensionContext,
        deps.projectSetupCommands,
        register,
      ),
      ...registerDiagnosticsCommands(
        projects,
        deps.diagnosticsOutputChannel,
        register,
      ),
      ...registerDeferCommands(deps.deferToProductionStatusBar, register),
    );
  }

  dispose() {
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
