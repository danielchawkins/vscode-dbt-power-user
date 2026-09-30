import { commandParamsFor } from "../core/cli";
import { ProjectSnapshot } from "../core/project";
import { DBTCommand, DBTTerminal, RunModelParams } from "../dbt_integration";
import { FusionCli, QueuedCliCommand } from "../fusion/fusionCli";
import { CommandQueue, formatCommandStatus } from "./commandQueue";

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
