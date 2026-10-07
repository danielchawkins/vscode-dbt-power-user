import { CustomExecution, Task } from "vscode";
import type { Log } from "../core/log";
import type { CommandProcessResult } from "../core/types";
import type { RunModelParams } from "../dbt_integration/domain";
import type { QueuedCliCommand } from "../fusion/fusionCli";
import {
  cliCommandOf,
  dbtTask,
  DbtTaskDefinition,
  DbtTaskTerminal,
  definitionOf,
  executeTask,
  taskName,
} from "./dbtTask";
import { ProjectCommandDeps, queueCli, selection } from "./projectCommands";

const LOG_SOURCE = "Project";

/** What a project's dbt tasks need from the project. */
export interface ProjectTaskDeps {
  root: string;
  projectName: () => string;
  projectCount: () => number;
  commandDeps: ProjectCommandDeps;
  terminal: Log;
}

/** A started task: its queued run once its terminal opens, and when its execution ends. */
export interface StartedTask {
  started: Promise<() => Promise<CommandProcessResult | undefined>>;
  ended: Promise<void>;
}

/** The dbt tasks of one project: VS Code tasks whose terminals queue their command on the project's CLI. */
export class ProjectTasks {
  private warnedTasksUnavailable = false;

  constructor(private readonly deps: ProjectTaskDeps) {}

  /**
   * Executes the dbt task for `cli` outside the command queue, after any active task with the same definition ends.
   * `started` resolves with its queued run once its terminal opens; `ended` resolves when its execution ends. When
   * VS Code cannot execute tasks, the command is queued without a terminal and `ended` resolves once it has run.
   */
  async start(cli: QueuedCliCommand): Promise<StartedTask> {
    const definition = definitionOf(cli, this.deps.root);
    let onStart!: (run: Promise<CommandProcessResult | undefined>) => void;
    const started = new Promise<
      () => Promise<CommandProcessResult | undefined>
    >((resolve) => (onStart = (run) => resolve(() => run)));
    const task = dbtTask(
      definition,
      this.deps.root,
      this.taskName(cli),
      this.execution(onStart),
    );
    try {
      const { ended } = await executeTask(task);
      return { started, ended };
    } catch (error) {
      this.warnUnavailable(error);
      const run = this.run(definition, new DbtTaskTerminal(() => undefined));
      return {
        started: Promise.resolve(() => run),
        ended: run.then(
          () => undefined,
          () => undefined,
        ),
      };
    }
  }

  async runModel(params: RunModelParams): Promise<void> {
    await this.start({ kind: "run", select: selection(params) });
  }
  async buildModel(params: RunModelParams): Promise<void> {
    await this.start({ kind: "build", select: selection(params) });
  }
  async buildProject(): Promise<void> {
    await this.start({ kind: "build" });
  }
  async runTest(testName: string): Promise<void> {
    await this.start({ kind: "test", select: testName });
  }
  async runModelTest(modelName: string): Promise<void> {
    await this.start({ kind: "test", select: modelName });
  }
  async compileModel(params: RunModelParams): Promise<void> {
    await this.start({ kind: "compile", select: selection(params) });
  }

  /** Runs `dbt deps` as a task; rejects when it fails or exits non-zero. */
  async installDeps(): Promise<void> {
    const { started, ended } = await this.start({ kind: "deps" });
    const run = await Promise.race([started, ended.then(() => undefined)]);
    const result = await run?.();
    if (result && result.exitCode !== undefined && result.exitCode !== 0) {
      throw new Error(`dbt deps exited with code ${result.exitCode}`);
    }
  }

  /** The name of the task that runs `cli` in this project. */
  taskName(cli: QueuedCliCommand): string {
    return taskName(cli, this.deps.projectName(), this.deps.projectCount());
  }

  /** A task named `name` that runs `definition` in this project. */
  task(definition: DbtTaskDefinition, name: string): Task {
    return dbtTask(definition, this.deps.root, name, this.execution());
  }

  /**
   * Queues the command `definition` names to run in `terminal`, settling with that run; an unknown command closes
   * it as failed.
   */
  async run(
    definition: DbtTaskDefinition,
    terminal: DbtTaskTerminal,
  ): Promise<CommandProcessResult | undefined> {
    const cli = cliCommandOf(definition);
    if (!cli) {
      terminal.fail(`Unknown dbt task command: ${definition.command}`);
      return undefined;
    }
    return queueCli(this.deps.commandDeps, cli, terminal);
  }

  private warnUnavailable(error: unknown): void {
    if (this.warnedTasksUnavailable) {
      return;
    }
    this.warnedTasksUnavailable = true;
    this.deps.terminal.warn(
      LOG_SOURCE,
      `Running dbt commands without a task terminal: VS Code could not execute the dbt task: ${error}`,
    );
  }

  /**
   * Every terminal it creates, including one for each Rerun, queues its task definition through `run` and passes
   * the run to `onStart`.
   */
  private execution(
    onStart?: (run: Promise<CommandProcessResult | undefined>) => void,
  ): CustomExecution {
    return new CustomExecution(
      async (definition) =>
        new DbtTaskTerminal((terminal) => {
          const run = this.run(definition as DbtTaskDefinition, terminal);
          run.catch(() => undefined);
          onStart?.(run);
        }),
    );
  }
}
