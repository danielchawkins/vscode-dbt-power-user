import {
  CommandProcessExecutionFactory,
  DBTConfiguration,
  DBTDetection,
  DBTTerminal,
} from "@altimateai/dbt-integration";
import { Memento } from "vscode";
import { judgeFusionVersion, parseFusionVersion } from "./fusionVersion";

const SOURCE = "FusionVersionDetection";

export class FusionVersionDetection implements DBTDetection {
  constructor(
    private commandProcessExecutionFactory: CommandProcessExecutionFactory,
    private terminal: DBTTerminal,
    private dbtConfiguration: DBTConfiguration,
    private globalState?: Memento,
  ) {}

  async detectDBT(): Promise<boolean> {
    const attemptedPath = process.platform === "win32" ? "dbt.exe" : "dbt";
    try {
      const execution =
        this.commandProcessExecutionFactory.createCommandProcessExecution({
          command: attemptedPath,
          args: ["--version"],
          cwd: this.dbtConfiguration.getWorkingDirectory(),
        });
      const { stdout, stderr } = await execution.complete();
      const verdict = judgeFusionVersion(parseFusionVersion(stdout), stdout);
      if (verdict.kind === "ok") {
        return true;
      }
      if (verdict.kind === "untestedMajor") {
        await this.warnOnce(verdict.version.major);
        return true;
      }
      if (verdict.kind === "tooOld") {
        this.terminal.warn(
          SOURCE,
          `dbt Fusion ${verdict.version.major}.${verdict.version.minor}.${verdict.version.patch} is too old`,
          false,
        );
        return false;
      }
      this.terminal.debug(
        SOURCE,
        `${attemptedPath}: not Fusion (${firstLine(stdout) || firstLine(stderr) || "empty"})`,
      );
    } catch (error) {
      this.terminal.debug(
        SOURCE,
        `${attemptedPath} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return false;
  }

  private async warnOnce(major: number): Promise<void> {
    const key = `fusionVersion.warnedMajor.${major}`;
    if (this.globalState?.get<boolean>(key)) {
      return;
    }

    try {
      await this.globalState?.update(key, true);
    } catch (error) {
      this.terminal.debug(
        SOURCE,
        `Could not persist the Fusion ${major} warning: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.terminal.warn(
      SOURCE,
      `dbt Fusion ${major} has not been tested with Fusion Power User. Continuing.`,
      false,
    );
  }
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? "";
}
