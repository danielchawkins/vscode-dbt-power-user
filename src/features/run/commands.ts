import { window } from "vscode";
import type { RegisterCommand } from "../../commandRegistry";
import type { Log } from "../../core/log";
import { RunModelType } from "../../dbt_integration/domain";
import type { Projects } from "../../projects/projects";
import type { RunModel } from "./runModel";
import type { RunTest } from "./runTest";

export interface RunCommandDeps {
  projects: Projects;
  runModel: RunModel;
  runTest: RunTest;
  log: Log;
  register: RegisterCommand;
}

/** The active editor's project, or `undefined` after logging why the command does nothing. */
function activeProject(
  { projects, log }: RunCommandDeps,
  name: string,
  verb: string,
) {
  const activeFileUri = window.activeTextEditor?.document.uri;
  if (!activeFileUri) {
    log.debug(name, `skipping ${name} without active file`);
    return undefined;
  }
  const project = projects.get(activeFileUri);
  if (!project) {
    log.debug(
      name,
      `${name} unable to find dbtproject by active file: ${activeFileUri.path}`,
    );
    return undefined;
  }
  log.debug(
    name,
    `${verb} current project: ${project.getProjectName()} with active file: ${activeFileUri.path}`,
  );
  return project;
}

/** Commands that run, test, compile and build models, projects and their neighbours. */
export function registerRunCommands(deps: RunCommandDeps) {
  return [...registerTestCommands(deps), ...registerBuildCommands(deps)];
}

function registerTestCommands(deps: RunCommandDeps) {
  const { projects, runModel, runTest, register } = deps;
  // `dbt run` or `dbt test` on a singular test file selects the test by its own name, not the surrounding model.
  const onSingularTest = () =>
    runTest.runSingularTestOnActiveWindowIfApplicable();
  const node =
    (type: RunModelType) =>
    (model?: Parameters<ReturnType<RunModel["runModelOnNodeTreeItem"]>>[0]) =>
      runModel.runModelOnNodeTreeItem(type)(model);
  return [
    register("fusionPowerUser.runCurrentModel", async () => {
      if (!(await onSingularTest())) {
        runModel.runModelOnActiveWindow();
      }
    }),
    register("fusionPowerUser.testCurrentModel", async () => {
      if (!(await onSingularTest())) {
        runModel.runTestsOnActiveWindow();
      }
    }),
    register("fusionPowerUser.compileCurrentModel", () =>
      runModel.compileModelOnActiveWindow(),
    ),
    register("fusionPowerUser.runTest", async (model) => {
      // From the test tree: run the selected generic test. From the palette: singular test files run by name,
      // otherwise the generic tests of the active model.
      if (model === undefined && (await onSingularTest())) {
        return;
      }
      node(RunModelType.TEST)(model);
    }),
    register(
      "fusionPowerUser.runChildrenModels",
      node(RunModelType.RUN_CHILDREN),
    ),
    register("fusionPowerUser.runParentModels", node(RunModelType.RUN_PARENTS)),
    register("fusionPowerUser.yamlRunModel", (uri, modelName: string) => {
      void projects.get(uri)?.runModel({
        plusOperatorLeft: "",
        modelName,
        plusOperatorRight: "",
      });
    }),
    register("fusionPowerUser.yamlTestModel", (uri, modelName: string) => {
      void projects.get(uri)?.runModelTest(modelName);
    }),
    register("fusionPowerUser.executeSQL", () =>
      runModel.executeQueryOnActiveWindow(),
    ),
    register("fusionPowerUser.createModelBasedonSourceConfig", (params) => {
      runModel.createModelBasedonSourceConfig(params);
    }),
    register("fusionPowerUser.showRunSQL", () =>
      runModel.showRunSQLOnActiveWindow(),
    ),
    register("fusionPowerUser.generateSchemaYML", () =>
      runModel.generateSchemaYMLOnActiveWindow(),
    ),
  ];
}

function registerBuildCommands(deps: RunCommandDeps) {
  const { runModel, register } = deps;
  return [
    register("fusionPowerUser.buildCurrentModel", () =>
      runModel.buildModelOnActiveWindow(),
    ),
    register("fusionPowerUser.buildChildrenModels", () =>
      runModel.buildModelOnActiveWindow(RunModelType.BUILD_CHILDREN),
    ),
    register("fusionPowerUser.buildParentModels", () =>
      runModel.buildModelOnActiveWindow(RunModelType.BUILD_PARENTS),
    ),
    register("fusionPowerUser.buildChildrenParentModels", () =>
      runModel.buildModelOnActiveWindow(RunModelType.BUILD_CHILDREN_PARENTS),
    ),
    register(
      "fusionPowerUser.buildCurrentProject",
      () =>
        void activeProject(
          deps,
          "buildCurrentProject",
          "building",
        )?.buildProject(),
    ),
    register(
      "fusionPowerUser.cleanCurrentProject",
      () =>
        void activeProject(deps, "cleanCurrentProject", "cleaning")?.clean(),
    ),
  ];
}
