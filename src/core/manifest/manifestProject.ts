import type { ProjectPaths } from "../snapshot/index";

/** Project facts the manifest parsers read. */
export interface ManifestProject {
  getProjectRoot(): string;
  getProjectName(): string;
  paths(): Pick<ProjectPaths, "targetPath" | "packagesInstallPath"> | undefined;
}
