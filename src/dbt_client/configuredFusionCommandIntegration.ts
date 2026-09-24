import { existsSync, statSync } from "fs";
import { basename, dirname } from "path";
import { Uri } from "vscode";
import { CommandProcessExecutionFactory } from "../dbt_integration/commandProcessExecution";
import { DBTFusionCommandProjectIntegration } from "../dbt_integration/dbtFusionCommandIntegration";
import {
  CLIDBTCommandExecutionStrategy,
  DBTCommand,
  DBTCommandFactory,
  DeferConfig,
} from "../dbt_integration/dbtIntegration";
import { DBTDiagnosticData } from "../dbt_integration/diagnostics";
import { MANIFEST_FILE, ManifestPathType } from "../dbt_integration/domain";
import { DBTTerminal } from "../dbt_integration/terminal";
import { FusionExecutable } from "../fusion/fusionExecutable";
import { resolveFusionLaunchSettings } from "../lsp/fusionClientSettings";
import { FusionCommandIntegrationFactory } from "./fusionProjectIntegration";
import { ProjectFusionProcessEnvironment } from "./projectFusionProcessEnvironment";

const PROFILES_DIR_ARGUMENT = "--profiles-dir";

/** Builds local-state defer arguments and applies the configured profiles directory. */
export class ConfiguredFusionCommandProjectIntegration extends DBTFusionCommandProjectIntegration {
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

  /**
   * Every CLI subcommand routes through here, so it is the one place that can
   * give the configured profiles directory the same effect it already has on
   * the language server. Without the setting, nothing is added and dbt applies
   * its own cascade, which is what matches running dbt in a terminal.
   */
  protected override wrapCommand(command: DBTCommand): DBTCommand {
    const wrapped = super.wrapCommand(command);
    const { profilesDir } = resolveFusionLaunchSettings(
      Uri.file(this.projectRoot),
    );
    // Treats any occurrence as an existing flag because dbt argument arrays are unstructured.
    if (!profilesDir || wrapped.args.includes(PROFILES_DIR_ARGUMENT)) {
      return wrapped;
    }

    wrapped.addArgument(PROFILES_DIR_ARGUMENT);
    wrapped.addArgument(profilesDir);
    return wrapped;
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
    const processEnvironment = new ProjectFusionProcessEnvironment(executable);
    return new ConfiguredFusionCommandProjectIntegration(
      dbtCommandFactory,
      (cwd, dbtPath) =>
        new CLIDBTCommandExecutionStrategy(
          commandProcessExecutionFactory,
          processEnvironment,
          terminal,
          cwd,
          dbtPath,
        ),
      executable.path,
      terminal,
      projectRoot,
      projectConfigDiagnostics,
      deferConfig,
      onDiagnosticsChanged,
    );
  };
}
