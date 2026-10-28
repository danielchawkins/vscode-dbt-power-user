import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type { Uri } from "vscode";
import { commandParamsFor, fullRefreshArgs } from "../../core/cli/index";
import type { RunModelParams } from "../../core/dbt/domain";
import { RunModelType } from "../../core/dbt/domain";
import type { DbtCommand } from "../../core/dbtCommand";
import type { Log } from "../../core/log";
import type { ProjectSnapshot } from "../../core/snapshot/index";
import { errorText } from "../../core/text";
import type { CommandProcessResult } from "../../core/types";
import type { FusionCli, QueuedCliCommand } from "../../fusion/fusionCli";
import type { CommandQueue } from "./commandQueue";
import { formatCommandStatus } from "./commandQueue";
import type { DbtTaskTerminal } from "./dbtTask";

const LOG_SOURCE = "Project";

/** The project collaborators that queueing a dbt command reads from and reports to. */
export interface ProjectCommandDeps {
  commandQueue: CommandQueue;
  cli(): FusionCli;
  snapshot(): ProjectSnapshot;
  withRunResults<T>(
    run: () => Promise<T>,
    launched?: readonly string[],
  ): Promise<T>;
  notifyFailed(statusMessage: string, error: string): void;
  /** Receives every queued command's result once it has run. */
  onCommandOutput?(result: CommandProcessResult | undefined): void;
  terminal: Log;
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
function formatCliStatus(
  cli: QueuedCliCommand,
  params: readonly string[],
): string {
  const body = ["dbt", cli.kind];
  if (cli.kind !== "deps" && cli.select !== undefined) {
    body.push("--select", cli.select);
  }
  return [...body, ...fullRefreshArgs(cli, params), ...params].join(" ");
}

/**
 * Refreshes `cli`'s project config for the project `label` names; returns whether it succeeded.
 * `sourcePaths`, when given, is read afterwards to report whether the paths resolved.
 */
export async function refreshCliConfig({
  cli,
  terminal,
  label,
  sourcePaths,
}: {
  cli: FusionCli;
  terminal: Log;
  label: string;
  sourcePaths?: (() => string[] | undefined) | undefined;
}): Promise<boolean> {
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

/**
 * Prepares a CLI command and queues it to run in the task `terminal`, settling with the queued run. A preparation
 * failure is reported, closes `terminal`, and rejects.
 */
export async function queueCli(
  deps: ProjectCommandDeps,
  cli: QueuedCliCommand,
  terminal: DbtTaskTerminal,
): Promise<CommandProcessResult | undefined> {
  let command: DbtCommand;
  try {
    command = deps.cli().prepare(cli);
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
    terminal.fail(`Unable to prepare ${statusMessage}: ${errorText(error)}`);
    throw error;
  }
  return enqueueCommand(deps, command, terminal);
}

/**
 * Queues a prepared command to run in the task `terminal`, recording its run results and failing on a reported dbt
 * error; settles once it has run. It is skipped when the terminal closed while it waited.
 */
function enqueueCommand(
  deps: ProjectCommandDeps,
  command: DbtCommand,
  terminal: DbtTaskTerminal,
): Promise<CommandProcessResult | undefined> {
  if (deps.commandQueue.busy) {
    terminal.writeLine("Waiting for the previous dbt command to finish…");
  }
  return deps.commandQueue.enqueue(
    async (signal) => {
      if (terminal.closed) {
        return undefined;
      }
      const result = await deps.withRunResults(
        () => terminal.run(command, signal),
        command.args,
      );
      deps.onCommandOutput?.(result);
      // dbt CLI resolves normally even on failure (CommandProcessExecution.complete()
      // never rejects for non-zero exit). Detect pre-execution failures (compilation
      // errors, config errors) by checking stdout.
      if (result?.stdout?.includes("Encountered an error:")) {
        throw new Error(result.stdout.trim());
      }
      return result;
    },
    { statusMessage: formatCommandStatus(command) },
  );
}
