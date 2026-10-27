import type { Disposable, Event } from "vscode";
import type { Manifest } from "../manifest/manifestTypes";
import type { DeclaredProject } from "../registry/projectRegistry";

/**
 * Reads and rebuilds one declared project's manifest. Every publication goes through `onDidPublish`.
 * @port
 */
export interface ProjectMetadataSource extends Disposable {
  readonly project: DeclaredProject;
  /** Latest snapshot, or undefined before the first successful build. */
  current(): Manifest | undefined;
  refresh(): Promise<void>;
  /**
   * Brings the snapshot up to date for a reader that holds no demand: rebuilds a stale parse and fetches a due
   * server graph, and resolves once both are done.
   */
  ensureFresh(): Promise<void>;
  /** Fires once per publication epoch, with the manifest `current()` now returns. */
  readonly onDidPublish: Event<Manifest>;
}
