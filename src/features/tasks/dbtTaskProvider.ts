import * as path from "path";
import { Disposable, Task, TaskProvider, tasks, Uri } from "vscode";
import {
  cliCommandOf,
  DBT_TASK_COMMANDS,
  DBT_TASK_TYPE,
  DbtTaskDefinition,
} from "../../projects/dbtTask";
import { Project } from "../../projects/project";
import { Projects } from "../../projects/projects";

/** Lists each Declared Project's dbt tasks and resolves `dbt` tasks from tasks.json. */
export class DbtTaskProvider implements TaskProvider {
  constructor(private readonly projects: Projects) {}

  provideTasks(): Task[] {
    return this.projects.all().flatMap((project) =>
      DBT_TASK_COMMANDS.map((command) => {
        const definition: DbtTaskDefinition = {
          type: DBT_TASK_TYPE,
          command,
          project: project.projectRoot.fsPath,
        };
        return project.task(
          definition,
          project.taskName(cliCommandOf(definition)!),
        );
      }),
    );
  }

  /**
   * A tasks.json `dbt` task in the project its `project` root names, relative to the task's workspace folder, or the
   * only project when it names none.
   */
  resolveTask(task: Task): Task | undefined {
    const definition = task.definition as DbtTaskDefinition;
    const project = this.projectOf(definition, task.scope);
    return project?.task(definition, task.name);
  }

  private projectOf(
    { project }: DbtTaskDefinition,
    scope: Task["scope"],
  ): Project | undefined {
    if (project !== undefined) {
      const folder = typeof scope === "object" ? scope.uri.fsPath : undefined;
      const root =
        folder === undefined || path.isAbsolute(project)
          ? project
          : path.resolve(folder, project);
      return this.projects.get(Uri.file(root));
    }
    const all = this.projects.all();
    return all.length === 1 ? all[0] : undefined;
  }
}

/** Registers the `dbt` task provider; disposing unregisters it. */
export function registerDbtTaskProvider(projects: Projects): Disposable {
  return tasks.registerTaskProvider(
    DBT_TASK_TYPE,
    new DbtTaskProvider(projects),
  );
}
