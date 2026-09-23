import {
  CLIDBTCommandExecutionStrategy,
  CommandProcessExecutionFactory,
  DBTCommandExecutionInfrastructure,
  DBTCommandFactory,
  DBTDiagnosticData,
  DBTFusionCommandProjectIntegration,
  DBTTerminal,
  DeferConfig,
} from "@altimateai/dbt-integration";
import { FusionExecutable } from "../fusion/fusionExecutable";
import { FusionCommandIntegrationFactory } from "./fusionProjectIntegration";
import { ProjectFusionProcessEnvironment } from "./projectFusionProcessEnvironment";

/** Fusion CLI integration that assigns the resolved executable path directly. */
export class ConfiguredFusionCommandProjectIntegration extends DBTFusionCommandProjectIntegration {
  override async initializeProject(): Promise<void> {
    this.dbtPath = this.pythonEnvironment.pythonPath;
  }
}

export function createFusionCommandIntegrationFactory(
  commandProcessExecutionFactory: CommandProcessExecutionFactory,
  dbtCommandFactory: DBTCommandFactory,
  terminal: DBTTerminal,
): FusionCommandIntegrationFactory {
  return (
    executable: FusionExecutable,
    projectRoot: string,
    projectConfigDiagnostics: DBTDiagnosticData[],
    deferConfig: DeferConfig,
    onDiagnosticsChanged: () => void,
  ) => {
    const projectEnv = new ProjectFusionProcessEnvironment(executable);
    const infrastructure = new DBTCommandExecutionInfrastructure(
      projectEnv,
      terminal,
    );
    return new ConfiguredFusionCommandProjectIntegration(
      infrastructure,
      dbtCommandFactory,
      (cwd, dbtPath) =>
        new CLIDBTCommandExecutionStrategy(
          commandProcessExecutionFactory,
          projectEnv,
          terminal,
          cwd,
          dbtPath,
        ),
      projectEnv,
      projectEnv,
      terminal,
      projectRoot,
      projectConfigDiagnostics,
      deferConfig,
      onDiagnosticsChanged,
    );
  };
}
