import { inspect } from "util";
import { commands, Uri, window } from "vscode";
import { SHOW_OUTPUT, SHOW_OUTPUT_COMMAND } from "./projectErrors";

/** A Declared Project or a loaded `Project`; either names the project and locates its output channel. */
export type NotifiableProject =
  | { readonly root: Uri; readonly name: string }
  | { readonly projectRoot: Uri; getProjectName(): string };

let showExtensionOutput: (() => void) | undefined;

/** Sets the channel that {@link notifyErrorWithoutProject} opens. */
export function bindExtensionOutput(show: () => void): void {
  showExtensionOutput = show;
}

const describe = (error: unknown): string | undefined =>
  error === undefined
    ? undefined
    : error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : inspect(error);

const withCause = (message: string, error: unknown): string => {
  const cause = describe(error);
  return cause ? `${message}: ${cause}` : message;
};

/**
 * Shows an error notification that names `project` and offers **Show output** for its channel. Without a
 * project, it is {@link notifyErrorWithoutProject}.
 */
export async function notifyError(
  project: NotifiableProject | undefined,
  message: string,
  error?: unknown,
): Promise<void> {
  if (!project) {
    return notifyErrorWithoutProject(message, error);
  }
  const [root, name] = locate(project);
  const action = await window.showErrorMessage(
    `${name}: ${withCause(message, error)}`,
    SHOW_OUTPUT,
  );
  if (action === SHOW_OUTPUT) {
    await commands.executeCommand(SHOW_OUTPUT_COMMAND, root);
  }
}

/** Shows a warning notification that names `project` and offers **Show output** for its channel. */
export async function notifyWarning(
  project: NotifiableProject,
  message: string,
): Promise<void> {
  const [root, name] = locate(project);
  const action = await window.showWarningMessage(
    `${name}: ${message}`,
    SHOW_OUTPUT,
  );
  if (action === SHOW_OUTPUT) {
    await commands.executeCommand(SHOW_OUTPUT_COMMAND, root);
  }
}

const locate = (project: NotifiableProject): [Uri, string] =>
  "root" in project
    ? [project.root, project.name]
    : [project.projectRoot, project.getProjectName()];

/** Shows an error notification for a failure before a project is resolved; **Show output** opens the extension log. */
export async function notifyErrorWithoutProject(
  message: string,
  error?: unknown,
): Promise<void> {
  const action = await window.showErrorMessage(
    withCause(message, error),
    SHOW_OUTPUT,
  );
  if (action === SHOW_OUTPUT) {
    showExtensionOutput?.();
  }
}
