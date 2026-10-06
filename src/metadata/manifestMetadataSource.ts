import { Disposable, Event, EventEmitter } from "vscode";
import type { Manifest } from "../projects/manifestTypes";
import { Project } from "../projects/project";
import { DeclaredProject } from "../projects/projectRegistry";
import { ProjectMetadataSource } from "./projectMetadataSource";

/** Publishes the manifest `Project` parses and rebuilds. */
export class ManifestMetadataSource implements ProjectMetadataSource {
  private readonly emitter = new EventEmitter<Manifest>();
  readonly onDidPublish: Event<Manifest> = this.emitter.event;
  private readonly subscription: Disposable;
  private lastEpoch: number | undefined;

  constructor(
    readonly project: DeclaredProject,
    private dbtProject: Project,
  ) {
    this.subscription = dbtProject.onDidChangeManifest(() => {
      const manifest = dbtProject.manifest;
      if (manifest && manifest.publicationEpoch !== this.lastEpoch) {
        this.lastEpoch = manifest.publicationEpoch;
        this.emitter.fire(manifest);
      }
    });
  }

  current(): Manifest | undefined {
    return this.dbtProject.manifest;
  }

  async refresh(): Promise<void> {
    return this.dbtProject.rebuildManifest();
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
