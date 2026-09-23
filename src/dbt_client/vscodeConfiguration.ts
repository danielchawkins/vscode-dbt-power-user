import {
  DBTConfiguration,
  DEFAULT_CONFIGURATION_VALUES,
} from "@altimateai/dbt-integration";
import { injectable } from "inversify";
import { workspace } from "vscode";
import { CONFIGURATION_SECTION } from "../projects/projectConfiguration";
import { getFirstWorkspacePath, resolveSettingsVariables } from "../utils";

@injectable()
export class VSCodeDBTConfiguration implements DBTConfiguration {
  getDbtCustomRunnerImport(): string {
    throw new Error("Python execution is unsupported");
  }

  getDbtIntegration(): string {
    return "fusion";
  }

  getRunModelCommandAdditionalParams(): string[] {
    const params = workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .get<string[]>(
        "run.additionalParams",
        DEFAULT_CONFIGURATION_VALUES.runModelCommandAdditionalParams,
      );
    return params.map((p) => resolveSettingsVariables(p));
  }

  getBuildModelCommandAdditionalParams(): string[] {
    const params = workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .get<string[]>(
        "build.additionalParams",
        DEFAULT_CONFIGURATION_VALUES.buildModelCommandAdditionalParams,
      );
    return params.map((p) => resolveSettingsVariables(p));
  }

  getTestModelCommandAdditionalParams(): string[] {
    const params = workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .get<string[]>(
        "test.additionalParams",
        DEFAULT_CONFIGURATION_VALUES.testModelCommandAdditionalParams,
      );
    return params.map((p) => resolveSettingsVariables(p));
  }

  getQueryTemplate(): string {
    return workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .get<string>(
        "query.template",
        DEFAULT_CONFIGURATION_VALUES.queryTemplate,
      );
  }

  getQueryLimit(): number {
    return workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .get<number>("query.limit", DEFAULT_CONFIGURATION_VALUES.queryLimit);
  }

  getEnableNotebooks(): boolean {
    return false;
  }

  getDisableQueryHistory(): boolean {
    return false;
  }

  getInstallDepsOnProjectInitialization(): boolean {
    return false;
  }

  getDisableDepthsCalculation(): boolean {
    return false;
  }

  getWorkingDirectory(): string {
    return getFirstWorkspacePath();
  }

  getAltimateUrl(): string {
    return "";
  }

  getIsLocalMode(): boolean {
    return true;
  }

  getAltimateInstanceName(): string | undefined {
    return undefined;
  }

  getAltimateAiKey(): string | undefined {
    return undefined;
  }
}
