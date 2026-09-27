import { Disposable, languages, TextDocument, workspace } from "vscode";
import { DBTTerminal } from "../dbt_integration";
import {
  isDbtTemplateFile,
  ProjectPaths,
  resolveProjectPaths,
} from "../dbt_integration/projectPaths";
import { ProjectContext } from "../projects/projectContext";
import { ProjectRegistry } from "../projects/projectRegistry";

/**
 * Opens dbt models, macros, snapshots, analyses and tests as `jinja-sql` when VS Code resolved them to plain `sql`.
 * Only files under the paths a project's `dbt_project.yml` declares, or dbt's default layout, change; compiled
 * output under the target path, ad-hoc SQL, and any language a user association chose other than `sql` stay.
 */
export class DbtTemplateLanguage implements Disposable {
  private readonly disposables: Disposable[] = [];
  private readonly pathsByRoot = new Map<string, ProjectPaths>();

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly projectContext: ProjectContext,
    private readonly terminal: DBTTerminal,
  ) {}

  /** Starts listening; call after the registry has resolved Declared Projects. */
  start(): void {
    this.disposables.push(
      workspace.onDidOpenTextDocument((doc) => void this.apply(doc)),
      this.registry.onDidChangeProjects(() => {
        this.pathsByRoot.clear();
        this.applyToOpen();
      }),
      workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.fsPath.endsWith("dbt_project.yml")) {
          this.pathsByRoot.clear();
          this.applyToOpen();
        }
      }),
    );
    this.applyToOpen();
  }

  private applyToOpen(): void {
    for (const doc of workspace.textDocuments) {
      void this.apply(doc);
    }
  }

  private async apply(doc: TextDocument): Promise<void> {
    if (doc.uri.scheme !== "file" || doc.languageId !== "sql") {
      return;
    }
    const project = this.projectContext.forResource(doc.uri);
    if (!project) {
      return;
    }
    const root = project.root.fsPath;
    let paths = this.pathsByRoot.get(root);
    if (!paths) {
      paths = resolveProjectPaths(root);
      this.pathsByRoot.set(root, paths);
    }
    if (!isDbtTemplateFile(paths, doc.uri.fsPath)) {
      return;
    }
    try {
      await languages.setTextDocumentLanguage(doc, "jinja-sql");
    } catch (error) {
      this.terminal.debug(
        "DbtTemplateLanguage",
        `could not set jinja-sql on ${doc.uri.fsPath}`,
        error,
      );
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}
