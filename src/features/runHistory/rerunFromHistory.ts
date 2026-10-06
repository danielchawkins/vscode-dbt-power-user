import { window } from "vscode";
import { extractDbtSubcommand } from "../../core/text";
import type {
  RunModelParams,
  RunResultsEventData,
} from "../../dbt_integration/domain";
import { notifyErrorWithoutProject } from "../../projects/notifications";
import type { Project } from "../../projects/project";

/** Project operations a run-history replay can dispatch to. */
export type ReplayProject = Pick<
  Project,
  "runModel" | "buildModel" | "buildProject" | "runTest" | "compileModel"
>;

/**
 * Converts a history entry's selection arguments into model run parameters.
 * @internal
 */
export function parseHistoryArgs(args: string[]): RunModelParams {
  if (args.length === 0) {
    return { plusOperatorLeft: "", modelName: "", plusOperatorRight: "" };
  }
  const selector = args[0] ?? "";
  const plusOperatorLeft = selector.startsWith("+") ? "+" : "";
  const plusOperatorRight = selector.endsWith("+") ? "+" : "";
  const modelName = selector.replace(/^\+/, "").replace(/\+$/, "");
  return { plusOperatorLeft, modelName, plusOperatorRight };
}

/** Replays a run-history entry against the loaded project with the entry's name. */
export function rerunFromHistory(
  entry: RunResultsEventData,
  findProjectByName: (projectName: string) => ReplayProject | undefined,
): void {
  const project = findProjectByName(entry.projectName);
  if (!project) {
    void notifyErrorWithoutProject(
      `Project "${entry.projectName}" is not currently loaded`,
    );
    return;
  }

  const runModelParams = parseHistoryArgs(entry.args);

  switch (extractDbtSubcommand(entry.command)) {
    case "run":
      if (runModelParams.modelName) {
        void project.runModel(runModelParams);
      } else {
        window.showWarningMessage(
          "Re-running project-wide dbt run is not currently supported. " +
            "Please run from the terminal.",
        );
      }
      break;
    case "build":
      if (runModelParams.modelName) {
        void project.buildModel(runModelParams);
      } else {
        void project.buildProject();
      }
      break;
    case "test": {
      const [first] = entry.args;
      if (first !== undefined) {
        void project.runTest(first);
      } else {
        window.showWarningMessage(
          "Re-running project-wide dbt test is not currently supported. " +
            "Please run tests from the terminal.",
        );
      }
      break;
    }
    case "compile":
      if (runModelParams.modelName) {
        void project.compileModel(runModelParams);
      } else {
        window.showWarningMessage(
          "Re-running project-wide dbt compile is not currently supported. " +
            "Please run from the terminal.",
        );
      }
      break;
    default:
      window.showWarningMessage(
        `Re-run is not supported for command: ${entry.command}`,
      );
  }
}
