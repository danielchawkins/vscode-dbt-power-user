import { Disposable, EventEmitter } from "vscode";
import { DBTProject } from "../dbt_client/dbtProject";
import { ManifestCacheProjectAddedEvent } from "../dbt_client/event/manifestCacheChangedEvent";
import { DeclaredProject } from "../projects/projectRegistry";
import { ProjectMetadataSource } from "./projectMetadataSource";

/** Thin adapter over DBTProject.rebuildManifest and manifest publication. */
export class ManifestMetadataSource implements ProjectMetadataSource {
  private _onDidChangeMetadata =
    new EventEmitter<ManifestCacheProjectAddedEvent>();
  readonly onDidChangeMetadata = this._onDidChangeMetadata.event;

  private subscriptions: Disposable[] = [];
  private disposed = false;

  constructor(
    readonly project: DeclaredProject,
    private dbtProject: DBTProject,
  ) {
    this.subscriptions.push(
      dbtProject.onManifestChanged((event) => {
        for (const added of event.added ?? []) {
          this._onDidChangeMetadata.fire(added);
        }
      }),
    );
  }

  current(): ManifestCacheProjectAddedEvent | undefined {
    return this.dbtProject.getMetadataSnapshot();
  }

  async refresh(): Promise<void> {
    return this.dbtProject.rebuildManifest();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    while (this.subscriptions.length > 0) {
      this.subscriptions.pop()?.dispose();
    }
    this._onDidChangeMetadata.dispose();
  }
}
