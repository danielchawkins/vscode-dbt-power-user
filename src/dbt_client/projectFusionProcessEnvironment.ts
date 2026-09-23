import {
  EnvironmentVariables,
  PythonEnvironmentProvider,
  RuntimePythonEnvironment,
} from "@altimateai/dbt-integration";
import { FusionExecutable } from "../fusion/fusionExecutable";

/** Immutable per-project host env for external Fusion CLI execution. */
export class ProjectFusionProcessEnvironment
  implements RuntimePythonEnvironment, PythonEnvironmentProvider
{
  constructor(private readonly executable: FusionExecutable) {}

  get pythonPath(): string {
    return this.executable.path;
  }

  getEnvironmentVariables(_workspacePath: string): EnvironmentVariables {
    return this.executable.env as EnvironmentVariables;
  }

  getCurrentEnvironment(): RuntimePythonEnvironment {
    return this;
  }

  onEnvironmentChanged(
    _callback: (environment: RuntimePythonEnvironment) => void,
  ): () => void {
    return () => {};
  }
}
