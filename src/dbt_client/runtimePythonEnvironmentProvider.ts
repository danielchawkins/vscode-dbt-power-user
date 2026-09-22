import {
  EnvironmentVariables,
  PythonEnvironmentProvider,
  RuntimePythonEnvironment,
} from "@altimateai/dbt-integration";
import { inject, injectable } from "inversify";
import { Uri, workspace } from "vscode";
import { PythonEnvironment } from "./pythonEnvironment";

@injectable()
export class VSCodeRuntimePythonEnvironmentProvider implements PythonEnvironmentProvider {
  private callbacks: ((environment: RuntimePythonEnvironment) => void)[] = [];

  constructor(
    @inject(PythonEnvironment)
    private vscodeEnvironment: PythonEnvironment,
  ) {
    // Set up python environment change handling
    // Initialize environment and listen for changes
    this.vscodeEnvironment.initialize().then(() => {
      this.vscodeEnvironment.onPythonEnvironmentChanged(() => {
        const currentEnvironment = this.getCurrentEnvironment();
        this.callbacks.forEach((callback) => callback(currentEnvironment));
      });
    });
  }

  getCurrentEnvironment(): RuntimePythonEnvironment {
    return {
      pythonPath: this.vscodeEnvironment.pythonPath,
      getEnvironmentVariables: (
        workspacePath: string,
      ): EnvironmentVariables => {
        // dbt-integration can omit workspacePath.
        const folder = workspacePath
          ? workspace.getWorkspaceFolder(Uri.file(workspacePath))
          : undefined;
        return this.vscodeEnvironment.getEnvironmentVariables(folder);
      },
    };
  }

  onEnvironmentChanged(
    callback: (environment: RuntimePythonEnvironment) => void,
  ): () => void {
    this.callbacks.push(callback);

    // Return cleanup function
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }
}

@injectable()
export class StaticRuntimePythonEnvironment implements RuntimePythonEnvironment {
  constructor(
    @inject(PythonEnvironment)
    private vscodeEnvironment: PythonEnvironment,
  ) {}

  get pythonPath(): string {
    return this.vscodeEnvironment.pythonPath;
  }

  getEnvironmentVariables(workspacePath: string): EnvironmentVariables {
    // dbt-integration can omit workspacePath.
    const folder = workspacePath
      ? workspace.getWorkspaceFolder(Uri.file(workspacePath))
      : undefined;
    return this.vscodeEnvironment.getEnvironmentVariables(folder);
  }
}
