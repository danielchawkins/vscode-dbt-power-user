import { inject } from "inversify";
import { TextDocument, Uri, window } from "vscode";
import { DBTProject } from "../dbt_client/dbtProject";
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import {
  ManifestCacheChangedEvent,
  ManifestCacheProjectAddedEvent,
} from "../dbt_client/event/manifestCacheChangedEvent";
import { DBTTerminal } from "../dbt_integration";
import { ProjectContext } from "../projects/projectContext";
import { DeclaredProject } from "../projects/projectRegistry";

export class QueryManifestService {
  private eventMap: Map<string, ManifestCacheProjectAddedEvent> = new Map();

  public constructor(
    private dbtProjectContainer: DBTProjectContainer,
    @inject("DBTTerminal")
    private dbtTerminal: DBTTerminal,
    private projectContext: ProjectContext,
  ) {
    dbtProjectContainer.onManifestChanged((event) =>
      this.onManifestCacheChanged(event),
    );
  }

  private async onManifestCacheChanged(event: ManifestCacheChangedEvent) {
    event.added?.forEach((added) => {
      this.eventMap.set(added.project.projectRoot.fsPath, added);
    });
    event.removed?.forEach((removed) => {
      this.eventMap.delete(removed.projectRoot.fsPath);
    });
  }

  /** Maps the Declared Project owning `uri` to the DBTProject the discovery path already built. */
  private resolveProject(uri?: Uri): DBTProject | undefined {
    if (!uri) {
      return undefined;
    }
    const declared = this.projectContext.forResource(uri);
    return declared ? this.mapDeclaredProject(declared) : undefined;
  }

  public getProject(): DBTProject | undefined {
    const current = this.projectContext.current;
    if (current) {
      return this.mapDeclaredProject(current);
    }
    return undefined;
  }

  public getProjectByUri(uri?: Uri): DBTProject | undefined {
    return this.resolveProject(uri);
  }

  public getProjectNamesInWorkspace(): string[] | undefined {
    // remove duplicates
    return [
      ...new Set(
        this.dbtProjectContainer
          .getProjects()
          .map((project) => project.getProjectName()),
      ),
    ];
  }

  public getProjectByName(projectName: string) {
    const projects = this.dbtProjectContainer.getProjects();
    return projects.find((project) => project.getProjectName() === projectName);
  }

  public getEventByCurrentProject():
    | {
        event: ManifestCacheProjectAddedEvent | undefined;
        currentDocument: TextDocument;
      }
    | undefined {
    if (window.activeTextEditor === undefined || this.eventMap === undefined) {
      return;
    }

    const currentDocument = window.activeTextEditor.document;
    const currentFilePath = currentDocument.uri;
    return { event: this.getEventByDocument(currentFilePath), currentDocument };
  }

  public getEventByDocument(currentFilePath: Uri) {
    this.dbtTerminal.debug(
      "getting event for project, currentFilePath: ",
      currentFilePath.fsPath,
    );
    const projectRootpath = this.resolveProject(currentFilePath)?.projectRoot;
    if (projectRootpath === undefined) {
      this.dbtTerminal.debug(
        "no project for currentFilePath: ",
        currentFilePath.fsPath,
      );
      return;
    }

    const event = this.eventMap.get(projectRootpath.fsPath);
    if (event === undefined) {
      this.dbtTerminal.debug("no event for project: ", projectRootpath.fsPath);
      return;
    }
    return event;
  }

  public getSourcesInProject(currentFilePath?: Uri) {
    if (!currentFilePath) {
      return;
    }

    const projectRootpath = this.resolveProject(currentFilePath)?.projectRoot;
    if (projectRootpath === undefined) {
      return;
    }

    const event = this.eventMap.get(projectRootpath.fsPath);
    if (!event) {
      return;
    }

    const sources = event.sourceMetaMap.entries();
    console.log(event.sourceMetaMap.size, sources);
    const items = Array.from(sources).map(([key, source]) => ({
      name: key,
      tables: source.tables.map((t) => t.name),
    }));

    return items;
  }

  public getModelsInProject(
    currentFilePath?: Uri,
  ): Iterable<string> | undefined {
    if (!currentFilePath) {
      return;
    }

    const projectRootpath = this.resolveProject(currentFilePath)?.projectRoot;
    if (projectRootpath === undefined) {
      return;
    }

    const event = this.eventMap.get(projectRootpath.fsPath);
    if (!event) {
      return;
    }

    // TODO: fix for model versions
    return Array.from(event.nodeMetaMap.nodes()).map((node) => node.name);
  }

  public async getOrPickProjectFromWorkspace() {
    const uri = window.activeTextEditor?.document.uri;
    const declared = await this.projectContext.requireForCommand(uri);

    if (!declared) {
      this.dbtTerminal.debug(
        "getOrPickProjectFromWorkspace",
        "no project selected",
      );
      return;
    }

    this.dbtTerminal.debug(
      "getOrPickProjectFromWorkspace",
      `project selected: ${declared.root.fsPath}`,
    );
    return this.mapDeclaredProject(declared);
  }

  private mapDeclaredProject(
    declared: DeclaredProject,
  ): DBTProject | undefined {
    return this.dbtProjectContainer.findDBTProject(declared.root);
  }
}
