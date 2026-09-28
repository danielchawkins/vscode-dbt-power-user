import {
  commands,
  Disposable,
  languages,
  TextDocument,
  window,
  workspace,
} from "vscode";
import { DBTTerminal } from "../dbt_integration";
import {
  associatedLanguage,
  dbtTemplateAssociations,
} from "../dbt_integration/dbtAssociations";
import {
  isDbtTemplateFile,
  ProjectPaths,
  resolveProjectPaths,
} from "../dbt_integration/projectPaths";
import { ProjectContext } from "../projects/projectContext";
import { ProjectRegistry } from "../projects/projectRegistry";
import {
  readFileAssociations,
  readFolderFileAssociations,
  writeFolderFileAssociations,
} from "../settings";

/**
 * Language for dbt `.sql` files, in precedence order: the user's `files.associations`; the `filenamePatterns` this
 * extension contributes for dbt's standard layout; then, on open, the paths a project's `dbt_project.yml` declares.
 * A file a user association names, compiled output under the target path, and ad-hoc SQL are never changed.
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
      commands.registerCommand(
        "fusionPowerUser.configureFileAssociations",
        () => this.writeFolderAssociations(),
      ),
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
    if (
      associatedLanguage(
        readFileAssociations(doc.uri),
        project.folder.uri.fsPath,
        doc.uri.fsPath,
      )
    ) {
      return;
    }
    const root = project.root.fsPath;
    const paths = this.pathsFor(root);
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

  private pathsFor(root: string): ProjectPaths {
    let paths = this.pathsByRoot.get(root);
    if (!paths) {
      paths = resolveProjectPaths(root);
      this.pathsByRoot.set(root, paths);
    }
    return paths;
  }

  /**
   * Adds workspace-folder `files.associations` for every Declared Project's template paths, so files outside dbt's
   * standard layout get `jinja-sql` in the explorer before they are opened. Existing entries are kept unchanged.
   */
  async writeFolderAssociations(): Promise<number> {
    let added = 0;
    for (const project of this.registry.projects) {
      const current = readFolderFileAssociations(project.folder.uri);
      const wanted = dbtTemplateAssociations(
        project.folder.uri.fsPath,
        this.pathsFor(project.root.fsPath),
      );
      const missing = Object.entries(wanted).filter(
        ([pattern]) => !(pattern in current),
      );
      if (missing.length === 0) {
        continue;
      }
      await writeFolderFileAssociations(project.folder.uri, {
        ...current,
        ...Object.fromEntries(missing),
      });
      added += missing.length;
    }
    void window.showInformationMessage(
      added === 0
        ? "dbt file associations are already configured."
        : `Added ${added} dbt file association${added === 1 ? "" : "s"} to workspace folder settings.`,
    );
    return added;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}
