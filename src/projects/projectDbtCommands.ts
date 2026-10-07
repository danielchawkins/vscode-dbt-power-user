import type { Task } from "vscode";
import type { CommandProcessResult } from "../core/types";
import type { RunModelParams } from "../dbt_integration/domain";
import type { QueuedCliCommand } from "../fusion/fusionCli";
import type { DbtTaskDefinition, DbtTaskTerminal } from "./dbtTask";
import { ProjectQueries } from "./projectQueries";
import type { ProjectTasks } from "./projectTasks";

/** The dbt commands of a project: each starts a task; see {@link ProjectTasks}. */
export abstract class ProjectDbtCommands extends ProjectQueries {
  protected abstract readonly tasks: ProjectTasks;
  protected abstract withRunResults<T>(
    run: () => Promise<T>,
    launched?: readonly string[],
  ): Promise<T>;

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
    return this.withRunResults(() =>
      this.getFusionCli().run({ kind: "clean" }),
    );
  }
  debug() {
    return this.getFusionCli().run({ kind: "debug" });
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
