/** Project facts the manifest parsers read. */
export interface ManifestProject {
  getProjectRoot(): string;
  getProjectName(): string;
  getPackageInstallPath(): string | undefined;
  getTargetPath(): string | undefined;
}
