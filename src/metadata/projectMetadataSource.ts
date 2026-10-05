import { Disposable, Event } from "vscode";
import type { Manifest } from "../projects/manifestTypes";
import { DeclaredProject } from "../projects/projectRegistry";

/** Reads and rebuilds one declared project's manifest. Every publication goes through `onDidPublish`. */
export interface ProjectMetadataSource extends Disposable {
  readonly project: DeclaredProject;
  /** Latest snapshot, or undefined before the first successful build. */
  current(): Manifest | undefined;
  refresh(): Promise<void>;
  /** Fires once per publication epoch, with the manifest `current()` now returns. */
  readonly onDidPublish: Event<Manifest>;
}
