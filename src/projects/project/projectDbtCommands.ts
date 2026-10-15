import type { Task } from "vscode";
import type { RunModelParams } from "../../core/dbt/domain";
import type { CommandProcessResult } from "../../core/types";
import type { FusionCli, QueuedCliCommand } from "../../fusion/fusionCli";
import type { DbtTaskDefinition, DbtTaskTerminal } from "./dbtTask";
import type { ProjectTasks } from "./projectTasks";

/** What the commands read from their project. */
export interface CommandedProject {
  getFusionCli(): FusionCli;
  /** Runs `run`, then reads `run_results.json` if the command wrote one. */
  withRunResults<T>(
    run: () => Promise<T>,
    launched?: readonly string[],
  ): Promise<T>;
}

/** The dbt commands of a project: each starts a task; see {@link ProjectTasks}. */
export class ProjectDbtCommands {
  private readonly project: CommandedProject;
  private readonly tasks: ProjectTasks;

  constructor(project: CommandedProject, tasks: ProjectTasks) {
    this.project = project;
    this.tasks = tasks;
  }

  runModel(params: RunModelParams) {
    return this.tasks.runModel(params);
  }
  buildModel(params: RunModelParams) {
    return this.tasks.buildModel(params);
  }
  buildProject() {
    return this.tasks.buildProject();
  }
  runTest(testName: string) {
    return this.tasks.runTest(testName);
  }
  runModelTest(modelName: string) {
    return this.tasks.runModelTest(modelName);
  }
  compileModel(params: RunModelParams) {
    return this.tasks.compileModel(params);
  }

  clean() {
    return this.project.withRunResults(() =>
      this.project.getFusionCli().run({ kind: "clean" }),
    );
  }
  debug() {
    return this.project.getFusionCli().run({ kind: "debug" });
  }

  /** Runs `dbt deps` as a task; rejects when it fails or exits non-zero. */
  installDeps() {
    return this.tasks.installDeps();
  }

  /** The name of the task that runs `cli` in this project. */
  taskName(cli: QueuedCliCommand): string {
    return this.tasks.taskName(cli);
  }

  /** A task named `name` that runs `definition` in this project. */
  task(definition: DbtTaskDefinition, name: string): Task {
    return this.tasks.task(definition, name);
  }

  /** Queues the command `definition` names to run in `terminal`; see `ProjectTasks.run`. */
  runTask(
    definition: DbtTaskDefinition,
    terminal: DbtTaskTerminal,
  ): Promise<CommandProcessResult | undefined> {
    return this.tasks.run(definition, terminal);
  }
}
