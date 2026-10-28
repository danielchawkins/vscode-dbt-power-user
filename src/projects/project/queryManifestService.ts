import type { Uri } from "vscode";
import type { Manifest } from "../manifest/manifestTypes";
import type { CurrentProject } from "./currentProject";

/** Reads manifests of the Project owning a resource; which Project that is comes from CurrentProject. */
export class QueryManifestService {
  private currentProject: CurrentProject;

  public constructor(currentProject: CurrentProject) {
    this.currentProject = currentProject;
  }

  /** The latest manifest of the project owning `uri`, or of the Current Project when `uri` is omitted. */
  public manifestFor(uri?: Uri): Manifest | undefined {
    return this.projectFor(uri)?.manifest;
  }

  /** Like {@link manifestFor}, after rebuilding a parse that a source change left stale. */
  public async freshManifest(uri?: Uri): Promise<Manifest | undefined> {
    await this.projectFor(uri)?.ensureParsed();
    return this.manifestFor(uri);
  }

  public getSourcesInProject(currentFilePath?: Uri) {
    const event = currentFilePath && this.manifestFor(currentFilePath);
    if (!event) {
      return;
    }

    const sources = event.sourceMetaMap.entries();
    const items = Array.from(sources, ([key, source]) => ({
      name: key,
      tables: source.tables.map((t) => t.name),
    }));

    return items;
  }

  public getModelsInProject(currentFilePath?: Uri): string[] | undefined {
    const event = currentFilePath && this.manifestFor(currentFilePath);
    if (!event) {
      return;
    }

    // TODO: fix for model versions
    return Array.from(event.nodeMetaMap.nodes(), (node) => node.name);
  }

  private projectFor(uri?: Uri) {
    return this.currentProject.forResource(uri);
  }
}
