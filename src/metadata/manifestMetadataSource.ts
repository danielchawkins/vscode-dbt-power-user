import { DBTProject } from "../dbt_client/dbtProject";
import type { Manifest } from "../projects/manifestTypes";
import { DeclaredProject } from "../projects/projectRegistry";
import { ProjectMetadataSource } from "./projectMetadataSource";

/** Thin adapter over DBTProject.manifest and DBTProject.rebuildManifest. */
export class ManifestMetadataSource implements ProjectMetadataSource {
  constructor(
    readonly project: DeclaredProject,
    private dbtProject: DBTProject,
  ) {}

  current(): Manifest | undefined {
    return this.dbtProject.manifest;
  }

  async refresh(): Promise<void> {
    return this.dbtProject.rebuildManifest();
  }

  dispose(): void {}
}
