import {
  CLIDBTCommandExecutionStrategy,
  CommandProcessExecutionFactory,
  DBTCommandExecutionInfrastructure,
  DBTCommandFactory,
  DBTDiagnosticData,
  DBTFusionCommandProjectIntegration,
  DBTTerminal,
  DeferConfig,
  MANIFEST_FILE,
  ManifestPathType,
} from "@altimateai/dbt-integration";
import { existsSync, statSync } from "fs";
import { basename, dirname } from "path";
import { FusionExecutable } from "../fusion/fusionExecutable";
import { FusionCommandIntegrationFactory } from "./fusionProjectIntegration";
import { ProjectFusionProcessEnvironment } from "./projectFusionProcessEnvironment";

/** Assigns the resolved executable path and builds local-state defer arguments. */
export class ConfiguredFusionCommandProjectIntegration extends DBTFusionCommandProjectIntegration {
  override async initializeProject(): Promise<void> {
    this.dbtPath = this.pythonEnvironment.pythonPath;
  }

  protected override async getDeferParams(): Promise<string[]> {
    const { deferToProduction, favorState } = this.deferConfig;
    if (!deferToProduction) {
      this.terminal.debug("deferToProd", "defer to prod not enabled");
      return ["--no-defer"];
    }
    const stateDirectory = this.resolveLocalDeferStateDirectory();
    if (!stateDirectory) {
      return [];
    }
    const params = ["--defer", "--state", stateDirectory];
    if (favorState) {
      params.push("--favor-state");
    }
    this.terminal.debug(
      "deferToProd",
      "executing dbt command with defer params in local mode",
      true,
      params,
    );
    return params;
  }

  /**
   * Local-only mirror of the published `DeferConfig.getArtifactDirectory` LOCAL branch, extended
   * to also accept a path to `manifest.json` directly rather than only its containing directory.
   * An unusable path is a configuration problem, not a command failure: warn and defer nothing.
   */
  private resolveLocalDeferStateDirectory(): string | undefined {
    const { manifestPathForDeferral, manifestPathType } = this.deferConfig;
    if (
      manifestPathType !== ManifestPathType.LOCAL ||
      !manifestPathForDeferral
    ) {
      return undefined;
    }
    if (existsSync(manifestPathForDeferral)) {
      const stats = statSync(manifestPathForDeferral);
      if (stats.isDirectory()) {
        return manifestPathForDeferral;
      }
      if (
        stats.isFile() &&
        basename(manifestPathForDeferral) === MANIFEST_FILE
      ) {
        return dirname(manifestPathForDeferral);
      }
    }
    this.terminal.warn(
      "deferMissingManifestPath",
      `fusionPowerUser.defer.perProject manifestPathForDeferral "${manifestPathForDeferral}" ` +
        "is not a directory or manifest.json file; defer will not apply.",
      false,
    );
    return undefined;
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
