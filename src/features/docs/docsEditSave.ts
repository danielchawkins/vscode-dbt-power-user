import type { documentationEditor } from "@fusion-power-user/webview-contract";
import * as path from "path";
import { Uri, window } from "vscode";
import type { Log } from "../../core/log";
import { removeProtocol } from "../../core/text";
import type { Project } from "../../projects/project";
import type { Projects } from "../../projects/projects";
import { writeUserFile } from "../../projects/userFiles";
import type { MessageOf } from "../../webview/messageRouter";
import type { TestDataDeps } from "./docsTestData";
import { withDocumentation } from "./docsYaml";

type SaveMessage = MessageOf<
  documentationEditor.PanelMessage,
  "saveDocumentation"
>;

export interface SaveDeps {
  projects: Pick<Projects, "get">;
  terminal: Log;
  testData: TestDataDeps;
}

/** The schema file to write: the manifest's location, or one the user picks; `undefined` when they cancel. */
async function chooseSchemaFile(
  message: SaveMessage,
  project: Project,
): Promise<string | undefined> {
  if (message.patchPath) {
    // the location comes from the manifest, parse it
    return path.join(
      project.projectRoot.fsPath,
      removeProtocol(message.patchPath),
    );
  }
  switch (message.dialogType) {
    case "Existing file": {
      const chosen = await window.showOpenDialog({
        filters: { Yaml: ["yml"] },
        canSelectMany: false,
      });
      return chosen?.[0]?.fsPath;
    }
    case "New file":
      return (await window.showSaveDialog({ filters: { Yaml: ["yml"] } }))
        ?.fsPath;
    case undefined:
      throw new Error("No schema file chosen for the documentation");
  }
}

/**
 * Writes `message` to its schema YAML. Resolves false when the user cancels the file dialog, there is no active
 * project, or the write fails; `onFailure` runs for a failure, not a cancel.
 */
export async function saveDocumentation(
  message: SaveMessage,
  activeProject: Project | undefined,
  deps: SaveDeps,
  onFailure: (error: unknown, patchPath: string | undefined) => void,
): Promise<boolean> {
  let patchPath = message.patchPath ?? undefined;
  try {
    const projectByFilePath = deps.projects.get(Uri.file(message.filePath));
    if (!projectByFilePath) {
      throw new Error("Unable to find project for saving documentation");
    }
    if (activeProject === undefined) {
      return false;
    }
    patchPath = await chooseSchemaFile(message, projectByFilePath);
    if (patchPath === undefined) {
      return false;
    }
    const target = patchPath;
    const written = await writeUserFile(Uri.file(target), (docFile) =>
      withDocumentation(
        docFile,
        message,
        projectByFilePath.getAdapterType(),
        deps.testData,
      ),
    );
    if (written === "rejected") {
      throw new Error("the editor rejected the change");
    }
    if (written === "applied-unsaved") {
      void window.showWarningMessage(
        `${path.basename(target)} has unsaved changes; your documentation was applied but not saved`,
      );
    }
    return true;
  } catch (error) {
    onFailure(error, patchPath);
    return false;
  }
}
