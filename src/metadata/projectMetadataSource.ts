import { Disposable, Event } from "vscode";
import { ManifestCacheProjectAddedEvent } from "../dbt_client/event/manifestCacheChangedEvent";
import { DeclaredProject } from "../projects/projectRegistry";

/** Produces exactly the event every panel, tree view, and lens already consumes. */
export interface ProjectMetadataSource extends Disposable {
  readonly project: DeclaredProject;
  readonly onDidChangeMetadata: Event<ManifestCacheProjectAddedEvent>;
  /** Latest snapshot, or undefined before the first successful build. */
  current(): ManifestCacheProjectAddedEvent | undefined;
  refresh(): Promise<void>;
}
