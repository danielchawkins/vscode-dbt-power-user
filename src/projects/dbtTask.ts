import {
  CustomExecution,
  EventEmitter,
  Pseudoterminal,
  Task,
  TaskDefinition,
  TaskExecution,
  TaskRevealKind,
  tasks,
  TaskScope,
  Uri,
  workspace,
} from "vscode";
import { DBTCommand } from "../dbt_integration";
import { CommandProcessResult } from "../fusion/commandProcessExecution";
import { QueuedCliCommand } from "../fusion/fusionCli";

/** The task type, task source, and `taskDefinitions` entry of dbt tasks. */
export const DBT_TASK_TYPE = "dbt";

/** The subcommands a dbt task runs, in the order Run Task lists them. */
export const DBT_TASK_COMMANDS = [
  "run",
  "build",
  "test",
  "compile",
  "deps",
] as const satisfies readonly QueuedCliCommand["kind"][];

type DbtTaskCommand = (typeof DBT_TASK_COMMANDS)[number];

/** A `dbt` task as written in tasks.json; `project` is the project root and may be omitted with one project. */
export interface DbtTaskDefinition extends TaskDefinition {
  command: DbtTaskCommand;
  select?: string;
  project?: string;
  fullRefresh?: boolean;
}

/** The queued command a task definition runs; `undefined` for an unknown `command`. */
export function cliCommandOf(
  definition: DbtTaskDefinition,
): QueuedCliCommand | undefined {
  const { command, select, fullRefresh } = definition;
  switch (command) {
    case "run":
    case "build":
      return { kind: command, select, fullRefresh: fullRefresh || undefined };
    case "test":
    case "compile":
      return { kind: command, select };
    case "deps":
      return { kind: "deps" };
    default:
      return undefined;
  }
}

/** The task definition that runs `cli` in the project rooted at `root`. */
export function definitionOf(
  cli: QueuedCliCommand,
  root: string,
): DbtTaskDefinition {
  const definition: DbtTaskDefinition = {
    type: DBT_TASK_TYPE,
    command: cli.kind,
    project: root,
  };
  if (cli.kind !== "deps" && cli.select !== undefined) {
    definition.select = cli.select;
  }
  if ((cli.kind === "run" || cli.kind === "build") && cli.fullRefresh) {
    definition.fullRefresh = true;
  }
  return definition;
}

/** The task name: the subcommand and selection, then the project name when there are several projects. */
export function taskName(
  cli: QueuedCliCommand,
  projectName: string,
  projectCount: number,
): string {
  const select = cli.kind !== "deps" ? cli.select : undefined;
  const name = select === undefined ? cli.kind : `${cli.kind} ${select}`;
  return projectCount > 1 ? `${name} (${projectName})` : name;
}

/** A dbt task scoped to `root`'s workspace folder that runs `execution`; `focus` reveals its terminal. */
export function dbtTask(
  definition: DbtTaskDefinition,
  root: string,
  name: string,
  execution: CustomExecution,
  focus = true,
): Task {
  const task = new Task(
    definition,
    workspace.getWorkspaceFolder(Uri.file(root)) ?? TaskScope.Workspace,
    name,
    DBT_TASK_TYPE,
    execution,
  );
  task.presentationOptions = {
    reveal: focus ? TaskRevealKind.Always : TaskRevealKind.Silent,
  };
  return task;
}

function sameDefinition(a: TaskDefinition, b: TaskDefinition): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

/**
 * Executes `task` as a new run once no active task has the same definition, since VS Code returns that task's
 * execution instead of starting another, including after its terminal closed but before its end is processed.
 * `ended` resolves once the new execution has ended.
 */
export async function executeTask(
  task: Task,
): Promise<{ ended: Promise<void> }> {
  const ended = new Set<TaskExecution>();
  let onEnd: ((execution: TaskExecution) => void) | undefined;
  const subscription = tasks.onDidEndTask(({ execution }) => {
    ended.add(execution);
    onEnd?.(execution);
  });
  const endOf = (execution: TaskExecution) =>
    ended.has(execution)
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          onEnd = (e) => e === execution && resolve();
        });
  let execution: TaskExecution;
  try {
    for (;;) {
      const active = tasks.taskExecutions.find(
        (e) =>
          !ended.has(e) && sameDefinition(e.task.definition, task.definition),
      );
      if (!active) {
        break;
      }
      await endOf(active);
    }
    execution = await tasks.executeTask(task);
  } catch (error) {
    subscription.dispose();
    throw error;
  }
  return { ended: endOf(execution).finally(() => subscription.dispose()) };
}

/**
 * The terminal of one dbt task run. `open` calls `start`, which calls `run` or `fail` once; the terminal closes with
 * the process exit code, and `close` (Terminate Task) aborts the process or marks a queued run `closed`.
 */
export class DbtTaskTerminal implements Pseudoterminal {
  private readonly writeEmitter = new EventEmitter<string>();
  private readonly closeEmitter = new EventEmitter<number>();
  private readonly abort = new AbortController();
  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  constructor(private readonly start: (terminal: DbtTaskTerminal) => void) {}

  open(): void {
    this.start(this);
  }

  close(): void {
    this.abort.abort();
  }

  /** Whether Terminate Task has closed this terminal. */
  get closed(): boolean {
    return this.abort.signal.aborted;
  }

  /** Writes `message` as one line. */
  writeLine(message: string): void {
    this.write(`${message}\n`);
  }

  /** Writes `> dbt <args>`, streams the output with CRLF line endings, and closes with the exit code. */
  async run(
    command: DBTCommand,
    signal?: AbortSignal,
  ): Promise<CommandProcessResult> {
    this.write(`> ${command.getCommandAsString()}\n`);
    if (signal?.aborted) {
      this.abort.abort();
    }
    signal?.addEventListener("abort", () => this.abort.abort(), { once: true });
    try {
      const result = await command.execute(this.abort.signal, (chunk) =>
        this.write(chunk),
      );
      this.finish(result.exitCode ?? 1);
      return result;
    } catch (error) {
      this.fail(String(error));
      throw error;
    }
  }

  /** Writes `message` and closes with exit code 1. */
  fail(message: string): void {
    this.writeLine(message);
    this.finish(1);
  }

  private write(text: string): void {
    this.writeEmitter.fire(text.replace(/\r?\n/g, "\r\n"));
  }

  private finish(exitCode: number): void {
    this.closeEmitter.fire(exitCode);
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}
