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

/** The handler a quiet period ends with; a project-file change covers a source-file change in the same burst. */
type PendingKind = "projectFile" | "sourceFile";

/** The files one quiet period ended with: each changed path once, in the order its events arrived. */
export interface ChangeBurst {
  paths: string[];
}

export interface ManifestTriggerHandlers {
  /** Model, macro and seed paths; read on every event. */
  sourcePaths(): string[] | undefined;
  /** Runs after `dbt_project.yml` is created, changed or deleted. */
  onProjectFileChanged(change: ChangeBurst): Promise<void>;
  /** Runs after a `.sql`, `.yml`, `.yaml` or `.csv` file under a source path changes. */
  onSourceFileChanged(change: ChangeBurst): Promise<void>;
}
/** Debounced file events under one Declared Project root that call for a manifest rebuild. */
export class ManifestTrigger implements Disposable {
  private watcher: FileSystemWatcher | undefined;
  private subscriptions: Disposable[] = [];
  private quietTimer: ReturnType<typeof setTimeout> | undefined;
  /** The strongest kind of event since the last run; undefined while no event is pending. */
  private pendingKind: PendingKind | undefined;
  /** Every changed path since the last run, in arrival order. */
  private pendingPaths = new Set<string>();
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
    clearTimeout(this.quietTimer);
    this.quietTimer = undefined;
    this.pendingKind = undefined;
    this.pendingPaths.clear();
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
      this.arm("projectFile", fsPath);
      return;
    }
    if (!this.isUnderSourcePath(fsPath)) {
      return;
    }
    this.terminal.debug("ManifestTrigger", `Source file changed: ${fsPath}`);
    this.arm("sourceFile", fsPath);
  }

  /** Restarts the quiet period. A project-file event replaces a pending source-file event, never the reverse. */
  private arm(kind: PendingKind, fsPath: string): void {
    if (kind === "projectFile" || this.pendingKind === undefined) {
      this.pendingKind = kind;
    }
    this.pendingPaths.add(fsPath);
    clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => this.flush(), BOUNDS.fileEventQuietMs);
  }

  /** Runs the handler for the strongest pending kind, once, with every path the quiet period collected. */
  private flush(): void {
    const kind = this.pendingKind;
    const change: ChangeBurst = { paths: [...this.pendingPaths] };
    this.quietTimer = undefined;
    this.pendingKind = undefined;
    this.pendingPaths.clear();
    if (kind === "projectFile") {
      void this.run("project config refresh", () =>
        this.handlers.onProjectFileChanged(change),
      );
    } else if (kind === "sourceFile") {
      void this.run("manifest rebuild", () =>
        this.handlers.onSourceFileChanged(change),
      );
    }
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
