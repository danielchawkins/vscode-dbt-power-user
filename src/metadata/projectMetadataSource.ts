import { Disposable } from "vscode";
import type { Manifest } from "../projects/manifestTypes";
import { DeclaredProject } from "../projects/projectRegistry";

/** Reads and rebuilds one declared project's manifest; publication goes through `onDidChangeManifest`. */
export interface ProjectMetadataSource extends Disposable {
  readonly project: DeclaredProject;
  /** Latest snapshot, or undefined before the first successful build. */
  current(): Manifest | undefined;
  refresh(): Promise<void>;
}
