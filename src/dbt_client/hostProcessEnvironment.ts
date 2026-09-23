import {
  EnvironmentVariables,
  PythonEnvironmentProvider,
  RuntimePythonEnvironment,
} from "@altimateai/dbt-integration";
import { injectable } from "inversify";

/** Host env passed into @altimateai/dbt-integration CLI execution only. */
@injectable()
export class HostProcessEnvironment
  implements RuntimePythonEnvironment, PythonEnvironmentProvider
{
  // External Fusion integration checks truthiness and may derive sibling dbt
  // paths from this value; keep a separator-free placeholder, not a real path.
  readonly pythonPath = "unused";

  getEnvironmentVariables(_workspacePath: string): EnvironmentVariables {
    return process.env as EnvironmentVariables;
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
