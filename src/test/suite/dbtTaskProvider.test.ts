import { describe, expect, it, vi } from "vitest";
import { Task, tasks, Uri } from "vscode";
import {
  DbtTaskProvider,
  registerDbtTaskProvider,
} from "../../features/tasks/dbtTaskProvider";
import { QueuedCliCommand } from "../../fusion/fusionCli";
import { taskName } from "../../projects/dbtTask";
import { Project } from "../../projects/project";
import { Projects } from "../../projects/projects";

function project(root: string, name: string) {
  return {
    projectRoot: Uri.file(root),
    getProjectName: () => name,
    taskName: (_cli: QueuedCliCommand): string => name,
    task: vi.fn((definition, taskName) => ({ definition, name: taskName })),
  };
}

function providerOf(...all: ReturnType<typeof project>[]) {
  all.forEach((p) => {
    p.taskName = (cli) => taskName(cli, p.getProjectName(), all.length);
  });
  const projects = {
    all: () => all as unknown as Project[],
    get: (uri: Uri) => all.find((p) => p.projectRoot.fsPath === uri.fsPath),
  } as unknown as Projects;
  return new DbtTaskProvider(projects);
}

describe("DbtTaskProvider", () => {
  it("lists run, build, test, compile and deps for one project without its name", () => {
    const only = project("/a", "alpha");
    const provided = providerOf(only).provideTasks();
    expect(provided.map((t) => t.name)).toEqual([
      "run",
      "build",
      "test",
      "compile",
      "deps",
    ]);
    expect(provided[0].definition).toEqual({
      type: "dbt",
      command: "run",
      project: Uri.file("/a").fsPath,
    });
  });

  it("names each task after its project when there are several", () => {
    const provided = providerOf(
      project("/a", "alpha"),
      project("/b", "beta"),
    ).provideTasks();
    expect(provided.map((t) => t.name)).toContain("build (beta)");
    expect(provided).toHaveLength(10);
  });

  it("resolves a tasks.json task in the project it names", () => {
    const alpha = project("/a", "alpha");
    const beta = project("/b", "beta");
    const definition = { type: "dbt", command: "build", project: "/b" };
    providerOf(alpha, beta).resolveTask({
      definition,
      name: "nightly",
    } as unknown as Task);
    expect(beta.task).toHaveBeenCalledWith(definition, "nightly");
    expect(alpha.task).not.toHaveBeenCalled();
  });

  it("resolves a relative project against the task's workspace folder", () => {
    const alpha = project("/ws/a", "alpha");
    const beta = project("/ws/b", "beta");
    const provider = providerOf(alpha, beta);
    const scope = { uri: Uri.file("/ws") };
    for (const relative of ["b", "./b", "a/../b"]) {
      const definition = { type: "dbt", command: "build", project: relative };
      provider.resolveTask({ definition, name: "n", scope } as unknown as Task);
    }
    const only = project("/ws", "root");
    const definition = { type: "dbt", command: "deps", project: "." };
    providerOf(only).resolveTask({
      definition,
      name: "n",
      scope,
    } as unknown as Task);
    expect(beta.task).toHaveBeenCalledTimes(3);
    expect(alpha.task).not.toHaveBeenCalled();
    expect(only.task).toHaveBeenCalledWith(definition, "n");
  });

  it("resolves a task without a project only when there is one project", () => {
    const task = {
      definition: { type: "dbt", command: "deps" },
      name: "deps",
    } as unknown as Task;
    expect(providerOf(project("/a", "alpha")).resolveTask(task)).toBeDefined();
    expect(
      providerOf(project("/a", "alpha"), project("/b", "beta")).resolveTask(
        task,
      ),
    ).toBeUndefined();
  });

  it("registers under the dbt type and unregisters on dispose", () => {
    const registration = { dispose: vi.fn() };
    vi.mocked(tasks.registerTaskProvider).mockReturnValueOnce(registration);
    const disposable = registerDbtTaskProvider({} as Projects);
    expect(tasks.registerTaskProvider).toHaveBeenCalledWith(
      "dbt",
      expect.any(DbtTaskProvider),
    );
    disposable.dispose();
    expect(registration.dispose).toHaveBeenCalledTimes(1);
  });
});
