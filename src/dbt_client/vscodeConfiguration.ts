import { injectable } from "inversify";
import { DBTConfiguration } from "../dbt_integration";
import { readSetting } from "../settings";
import { resolveSettingsVariables } from "../utils";

@injectable()
export class VSCodeDBTConfiguration implements DBTConfiguration {
  getRunModelCommandAdditionalParams(): string[] {
    return readSetting("run.additionalParams").map((p) =>
      resolveSettingsVariables(p),
    );
  }

  getBuildModelCommandAdditionalParams(): string[] {
    return readSetting("build.additionalParams").map((p) =>
      resolveSettingsVariables(p),
    );
  }

  getTestModelCommandAdditionalParams(): string[] {
    return readSetting("test.additionalParams").map((p) =>
      resolveSettingsVariables(p),
    );
  }

  getQueryTemplate(): string {
    return readSetting("query.template");
  }

  getQueryLimit(): number {
    return readSetting("query.limit");
  }
}
