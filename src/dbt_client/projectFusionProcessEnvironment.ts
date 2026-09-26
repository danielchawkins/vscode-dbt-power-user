import { EnvironmentVariables } from "../dbt_integration/domain";
import { FusionProcessEnvironment } from "../dbt_integration/fusionProcessEnvironment";
import { FusionExecutable } from "../fusion/fusionExecutable";

/** Immutable per-project host env for external Fusion CLI execution. */
export class ProjectFusionProcessEnvironment implements FusionProcessEnvironment {
  constructor(private readonly executable: FusionExecutable) {}

  getEnvironmentVariables(): EnvironmentVariables {
    return this.executable.env as EnvironmentVariables;
  }
}
