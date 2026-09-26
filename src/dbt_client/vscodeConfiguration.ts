import { injectable } from "inversify";
import { workspace } from "vscode";
import {
  DBTConfiguration,
  DEFAULT_CONFIGURATION_VALUES,
} from "../dbt_integration";
import { CONFIGURATION_SECTION } from "../projects/projectConfiguration";
import { resolveSettingsVariables } from "../utils";

@injectable()
export class VSCodeDBTConfiguration implements DBTConfiguration {
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
}
