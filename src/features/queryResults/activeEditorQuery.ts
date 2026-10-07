import * as path from "path";
import { Range, window } from "vscode";
import { notifyErrorWithoutProject } from "../../projects/notifications";

/** What running the active editor's query needs from a project. */
interface QueryProject {
  executeSQLWithLimitOnQueryPanel(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<void>;
}

/**
 * Runs the active editor's selection, or its whole text, on the query panel. `getProject` picks the project; it
 * resolves `undefined` when there is none.
 */
export async function executeActiveEditorQuery(
  limit: number,
  getProject: () => Promise<QueryProject | undefined>,
): Promise<void> {
  const activeEditor = window.activeTextEditor;
  if (!activeEditor) {
    void notifyErrorWithoutProject("No active editor found");
    return;
  }
  const project = await getProject();
  if (!project) {
    void notifyErrorWithoutProject(
      "Unable to find dbt project for executing query",
    );
    return;
  }
  const { document, selection } = activeEditor;
  const query =
    selection && !selection.isEmpty
      ? document.getText(
          new Range(
            selection.start.line,
            selection.start.character,
            selection.end.line,
            selection.end.character,
          ),
        )
      : document.getText();
  await project.executeSQLWithLimitOnQueryPanel(
    query,
    path.basename(document.uri.fsPath, ".sql"),
    limit,
  );
}
