import type { Manifest } from "../projects/manifestTypes";
import { Project } from "../projects/project";
import { DeclaredProject } from "../projects/projectRegistry";
import { ProjectMetadataSource } from "./projectMetadataSource";

/** Thin adapter over Project.manifest and Project.rebuildManifest. */
export class ManifestMetadataSource implements ProjectMetadataSource {
  constructor(
    readonly project: DeclaredProject,
    private dbtProject: Project,
  ) {}

  current(): Manifest | undefined {
    return this.dbtProject.manifest;
  }

  async refresh(): Promise<void> {
    return this.dbtProject.rebuildManifest();
  }

  dispose(): void {}
}
