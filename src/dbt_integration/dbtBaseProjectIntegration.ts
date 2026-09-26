import * as crypto from "crypto";
import { readFileSync } from "fs";
import * as path from "path";

import { parse } from "yaml";

import { DBTCommand, DeferConfig } from "./dbtIntegration";
import { DBTDiagnosticData, DBTDiagnosticResult } from "./diagnostics";
import { DBTTerminal } from "./terminal";

/** State and helpers shared by the Fusion command integration. */
export abstract class DBTBaseProjectIntegration {
  protected dbtPath: string = "dbt";
  protected projectName: string = "unknown_" + crypto.randomUUID();
  protected adapterType: string = "unknown";
  protected targetPath?: string;
  protected modelPaths?: string[];
  protected seedPaths?: string[];
  protected macroPaths?: string[];
  protected packagesInstallPath?: string;
  protected version: number[] | undefined;

  protected rebuildManifestDiagnosticsData: DBTDiagnosticData[] = [];
  protected rebuildManifestAbortController: AbortController | undefined;

  protected disposables: { dispose: () => any }[] = [];

  constructor(
    protected projectRoot: string,
    protected projectConfigDiagnostics: DBTDiagnosticData[],
    protected deferConfig: DeferConfig,
    protected onDiagnosticsChanged: () => void,
    protected terminal: DBTTerminal,
  ) {}

  // ---------- simple getters ----------

  getProjectName(): string {
    return this.projectName;
  }

  getAdapterType(): string {
    return this.adapterType;
  }

  getTargetPath(): string | undefined {
    return this.targetPath;
  }

  getModelPaths(): string[] | undefined {
    return this.modelPaths;
  }

  getSeedPaths(): string[] | undefined {
    return this.seedPaths;
  }

  getMacroPaths(): string[] | undefined {
    return this.macroPaths;
  }

  getPackageInstallPath(): string | undefined {
    return this.packagesInstallPath;
  }

  getVersion(): number[] {
    return this.version || [0, 0, 0];
  }

  getDebounceForRebuildManifest() {
    return 500;
  }

  getDiagnostics(): DBTDiagnosticResult {
    return {
      rebuildManifestDiagnostics: this.rebuildManifestDiagnosticsData,
      projectConfigDiagnostics: this.projectConfigDiagnostics,
    };
  }

  // ---------- defer-flag plumbing ----------

  async applyDeferConfig(deferConfig: DeferConfig): Promise<void> {
    this.deferConfig = deferConfig;
  }

  protected async getDeferParams(): Promise<string[]> {
    const { deferToProduction } = this.deferConfig;
    if (!deferToProduction) {
      this.terminal.debug("Defer to Prod", "defer to prod not enabled");
      return ["--no-defer"];
    }
    return [];
  }

  protected async addDeferParams(command: DBTCommand) {
    const deferParams = await this.getDeferParams();
    deferParams.forEach((param) => command.addArgument(param));
    return command;
  }

  // ---------- JSON utilities ----------

  protected processJSONErrors(jsonErrors: string): Error | undefined {
    if (!jsonErrors) {
      return;
    }
    try {
      const errorLines: string[] = [];
      // eslint-disable-next-line prefer-spread
      errorLines.push.apply(
        errorLines,
        jsonErrors
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line.trim()))
          .filter(
            (line) =>
              line.info.level === "error" || line.info.level === "fatal",
          )
          .map((line) => line.info.msg),
      );
      if (errorLines.length) {
        return new Error(errorLines.join(", "));
      }
    } catch (error) {
      return new Error("Could not process " + jsonErrors + ": " + error);
    }
    return;
  }

  protected parseJSON(
    contextName: string,
    json: string,
    throw_: boolean = true,
  ): any {
    try {
      return JSON.parse(json);
    } catch (error) {
      this.terminal.error(
        contextName + "Error",
        "An error occured while parsing following json: " + json,
        error,
      );
      if (throw_) {
        throw error;
      }
    }
  }

  // ---------- package-version helper ----------

  private getYamlContent(uri: string): string | undefined {
    try {
      return readFileSync(uri, "utf-8");
    } catch (error) {
      this.terminal.error(
        "getYamlContent",
        "Error occured while reading file: " + uri,
        error,
      );
      return undefined;
    }
  }

  findPackageVersion(packageName: string) {
    const packagesYmlPath = path.join(this.projectRoot, "packages.yml");
    const dependenciesYmlPath = path.join(this.projectRoot, "dependencies.yml");

    const fileContents =
      this.getYamlContent(packagesYmlPath) ||
      this.getYamlContent(dependenciesYmlPath);
    if (!fileContents) {
      return undefined;
    }

    const packages = parse(fileContents) as
      { packages: { package: string; version: string }[] } | undefined;
    if (packages?.packages?.length) {
      const packageObject = packages.packages.find(
        (p) => p.package.indexOf(packageName) > -1,
      );
      return packageObject?.version as string;
    }
    return undefined;
  }

  // ---------- defaults ----------

  async cleanupConnections(): Promise<void> {}

  async applySelectedTarget(): Promise<void> {}

  async dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
