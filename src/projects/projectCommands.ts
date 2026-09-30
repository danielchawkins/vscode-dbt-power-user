import { realpathSync } from "fs";
import { basename } from "path";
import { Uri } from "vscode";
import { commandParamsFor } from "../core/cli";
import { ProjectSnapshot } from "../core/project";
import {
  DBTCommand,
  DBTTerminal,
  RunModelParams,
  RunModelType,
} from "../dbt_integration";
import { FusionCli, QueuedCliCommand } from "../fusion/fusionCli";
import { CommandQueue, formatCommandStatus } from "./commandQueue";

const LOG_SOURCE = "Project";

/** The project collaborators that queueing a dbt command reads from and reports to. */
export interface ProjectCommandDeps {
  commandQueue: CommandQueue;
  cli(): FusionCli;
  snapshot(): ProjectSnapshot;
  withRunResults<T>(run: () => Promise<T>): Promise<T>;
  notifyFailed(statusMessage: string, error: string): void;
  terminal: DBTTerminal;
}

/** The `--select` value for a model and its graph operators. */
export function selection(params: RunModelParams): string {
  return `${params.plusOperatorLeft}${params.modelName}${params.plusOperatorRight}`;
}

/** The model named by `modelPath`'s real file name, with the graph operators `type` selects. */
export function modelParamsFor(
  modelPath: Uri,
  type?: RunModelType,
): RunModelParams {
  const modelName = basename(realpathSync.native(modelPath.fsPath), ".sql");
  const plusOperatorLeft =
    type === RunModelType.RUN_PARENTS ||
    type === RunModelType.BUILD_PARENTS ||
    type === RunModelType.BUILD_CHILDREN_PARENTS
      ? "+"
      : "";
  const plusOperatorRight =
    type === RunModelType.RUN_CHILDREN ||
    type === RunModelType.BUILD_CHILDREN ||
    type === RunModelType.BUILD_CHILDREN_PARENTS
      ? "+"
      : "";
  return { plusOperatorLeft, modelName, plusOperatorRight };
}

/** The status line for a command that could not be prepared: its selection and `commandParams`. */
export function formatCliStatus(
  cli: QueuedCliCommand,
  params: readonly string[],
): string {
  const body =
    cli.kind === "build" && cli.select === undefined
      ? "dbt build"
      : `dbt ${cli.kind} --select ${cli.select}`;
  return [body, ...params].join(" ");
}

/** Queues a `kind` command that selects `params`' model and graph operators. */
export function queueSelected(
  deps: ProjectCommandDeps,
  kind: "run" | "build" | "compile",
  params: RunModelParams,
): Promise<void> {
  return queueCli(deps, { kind, select: selection(params) });
}

/**
 * Refreshes `cli`'s project config for the project `label` names; returns whether it succeeded.
 * `sourcePaths`, when given, is read afterwards to report whether the paths resolved.
 */
export async function refreshCliConfig(
  cli: FusionCli,
  terminal: DBTTerminal,
  label: string,
  sourcePaths?: () => string[] | undefined,
): Promise<boolean> {
  terminal.debug(
    LOG_SOURCE,
    `Going to refresh the project ${label} configuration`,
  );
  try {
    await cli.refreshProjectConfig();
  } catch (error) {
    terminal.debug(
      LOG_SOURCE,
      `An error occurred while trying to refresh the project ${label} configuration`,
      error,
    );
    return false;
  }
  if (!sourcePaths) {
    return true;
  }
  if (sourcePaths()) {
    terminal.debug(
      LOG_SOURCE,
      `Project config refreshed successfully for ${label}`,
    );
  } else {
    terminal.warn(
      LOG_SOURCE,
      "Could not complete project config refresh because project is not initialized properly. " +
        "dbt path settings cannot be determined",
    );
  }
  return true;
}

/** Prepares a CLI command and queues it, reporting a preparation failure instead of throwing. */
export async function queueCli(
  deps: ProjectCommandDeps,
  cli: QueuedCliCommand,
): Promise<void> {
  try {
    enqueueCommand(deps, deps.cli().prepare(cli));
  } catch (error) {
    const statusMessage = formatCliStatus(
      cli,
      commandParamsFor(deps.snapshot(), cli),
    );
    deps.notifyFailed(statusMessage, String(error));
    deps.terminal.error(
      "commandPreparationError",
      `Unable to prepare ${statusMessage}`,
      error,
    );
  }
}

/** Queues a prepared command, recording its run results and failing on a reported dbt error. */
export function enqueueCommand(
  deps: ProjectCommandDeps,
  command: DBTCommand,
): void {
  deps.commandQueue.enqueue(
    async (signal) => {
      const result = await deps.withRunResults(() => command.execute(signal));
      // dbt CLI resolves normally even on failure (CommandProcessExecution.complete()
      // never rejects for non-zero exit). Detect pre-execution failures (compilation
      // errors, config errors) by checking stdout.
      if (result?.stdout?.includes("Encountered an error:")) {
        throw new Error(result.stdout.trim());
      }
    },
    {
      statusMessage: formatCommandStatus(command),
      focus: command.focus,
      showProgress: command.showProgress,
    },
  );
}
