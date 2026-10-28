import type { ProjectPaths } from "../snapshot/index";

/** Project facts the manifest parsers read. */
export interface ManifestProject {
  readonly root: { readonly fsPath: string };
  getProjectName(): string;
  paths(): Pick<ProjectPaths, "targetPath" | "packagesInstallPath"> | undefined;
}
