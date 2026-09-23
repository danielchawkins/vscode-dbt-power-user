import {
  DBTConfiguration,
  DEFAULT_CONFIGURATION_VALUES,
} from "@altimateai/dbt-integration";
import { injectable } from "inversify";
import { workspace } from "vscode";
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
      .getConfiguration("dbt")
      .get<string[]>(
        "runModelCommandAdditionalParams",
        DEFAULT_CONFIGURATION_VALUES.runModelCommandAdditionalParams,
      );
    return params.map((p) => resolveSettingsVariables(p));
  }

  getBuildModelCommandAdditionalParams(): string[] {
    const params = workspace
      .getConfiguration("dbt")
      .get<string[]>(
        "buildModelCommandAdditionalParams",
        DEFAULT_CONFIGURATION_VALUES.buildModelCommandAdditionalParams,
      );
    return params.map((p) => resolveSettingsVariables(p));
  }

  getTestModelCommandAdditionalParams(): string[] {
    const params = workspace
      .getConfiguration("dbt")
      .get<string[]>(
        "testModelCommandAdditionalParams",
        DEFAULT_CONFIGURATION_VALUES.testModelCommandAdditionalParams,
      );
    return params.map((p) => resolveSettingsVariables(p));
  }

  getQueryTemplate(): string {
    return workspace
      .getConfiguration("dbt")
      .get<string>("queryTemplate", DEFAULT_CONFIGURATION_VALUES.queryTemplate);
  }

  getQueryLimit(): number {
    return workspace
      .getConfiguration("dbt")
      .get<number>("queryLimit", DEFAULT_CONFIGURATION_VALUES.queryLimit);
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
    return workspace
      .getConfiguration("dbt")
      .get<boolean>(
        "disableDepthsCalculation",
        DEFAULT_CONFIGURATION_VALUES.disableDepthsCalculation,
      );
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
