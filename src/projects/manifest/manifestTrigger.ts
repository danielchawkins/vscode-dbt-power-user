import { join, resolve } from "node:path/posix";
import {
  type Disposable,
  type FileSystemWatcher,
  workspace,
  RelativePattern,
  type Uri,
} from "vscode";
import type { Log } from "../../core/log";
import { isStrictlyBelow } from "../../core/paths";
import { isDbtProjectFilePath, DBT_PROJECT_FILE } from "../../core/snapshot";
import { BOUNDS } from "../../core/timing";

/** Files at the project root whose change always calls for a config refresh and a parse. */
const PROJECT_LEVEL_FILES = [
  "profiles.yml",
  "packages.yml",
  "dependencies.yml",
  "selectors.yml",
];

export interface ManifestTriggerHandlers {
  /** Model, macro and seed paths; read on every event. */
  sourcePaths(): string[] | undefined;
  /** Runs after `dbt_project.yml` is created, changed or deleted. */
  onProjectFileChanged(): Promise<void>;
  /** Runs after a `.sql`, `.yml`, `.yaml` or `.csv` file under a source path changes. */
  onSourceFileChanged(): Promise<void>;
}
/** Debounced file events under one Declared Project root that call for a manifest rebuild. */
export class ManifestTrigger implements Disposable {
  private watcher: FileSystemWatcher | undefined;
  private subscriptions: Disposable[] = [];
  private projectFileTimer: ReturnType<typeof setTimeout> | undefined;
  private sourceFileTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly projectRoot: string;
  private readonly terminal: Log;
  private readonly handlers: ManifestTriggerHandlers;

  constructor(
    projectRoot: string,
    terminal: Log,
    handlers: ManifestTriggerHandlers,
  ) {
    this.projectRoot = projectRoot;
    this.terminal = terminal;
    this.handlers = handlers;
  }

  /** Starts watching; a no-op while already watching. */
  start(): void {
    if (this.watcher) {
      return;
    }
    const watcher = workspace.createFileSystemWatcher(
      new RelativePattern(this.projectRoot, "**/*.{sql,yml,yaml,csv}"),
    );
    const onEvent = (uri: Uri) => this.handle(uri.fsPath);
    this.watcher = watcher;
    this.subscriptions = [
      watcher.onDidCreate(onEvent),
      watcher.onDidChange(onEvent),
      watcher.onDidDelete(onEvent),
    ];
  }

  /** Stops watching and drops pending events. */
  stop(): void {
    clearTimeout(this.projectFileTimer);
    clearTimeout(this.sourceFileTimer);
    this.projectFileTimer = undefined;
    this.sourceFileTimer = undefined;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions = [];
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  dispose(): void {
    this.stop();
  }

  private handle(fsPath: string): void {
    if (
      isDbtProjectFilePath(this.projectRoot, fsPath) ||
      PROJECT_LEVEL_FILES.some(
        (name) => fsPath === join(this.projectRoot, name),
      )
    ) {
      this.terminal.debug(
        "ManifestTrigger",
        `${DBT_PROJECT_FILE} changed in ${this.projectRoot}`,
      );
      clearTimeout(this.projectFileTimer);
      this.projectFileTimer = setTimeout(() => {
        this.projectFileTimer = undefined;
        void this.run("project config refresh", () =>
          this.handlers.onProjectFileChanged(),
        );
      }, BOUNDS.fileEventQuietMs);
      return;
    }
    if (!this.isUnderSourcePath(fsPath)) {
      return;
    }
    this.terminal.debug("ManifestTrigger", `Source file changed: ${fsPath}`);
    clearTimeout(this.sourceFileTimer);
    this.sourceFileTimer = setTimeout(() => {
      this.sourceFileTimer = undefined;
      void this.run("manifest rebuild", () =>
        this.handlers.onSourceFileChanged(),
      );
    }, BOUNDS.fileEventQuietMs);
  }

  private isUnderSourcePath(fsPath: string): boolean {
    return (this.handlers.sourcePaths() ?? []).some((sourcePath) =>
      isStrictlyBelow(resolve(this.projectRoot, sourcePath), fsPath),
    );
  }

  private async run(label: string, handler: () => Promise<void>) {
    try {
      await handler();
    } catch (error) {
      this.terminal.error(
        "ManifestTrigger",
        `Failed ${label} after file change in ${this.projectRoot}`,
        error,
      );
    }
  }
}
