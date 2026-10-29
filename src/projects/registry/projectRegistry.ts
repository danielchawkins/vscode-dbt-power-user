import { realpathSync } from "node:fs";
import * as path from "node:path";
import type {
  Disposable,
  Event,
  FileSystemWatcher,
  TextDocument,
  Uri,
  WorkspaceFolder,
} from "vscode";
import { EventEmitter, RelativePattern, workspace } from "vscode";
import { disposeAll } from "../../core/disposables";
import type { Log } from "../../core/log";
import { isAtOrBelow } from "../../core/paths";
import {
  declaredProjectName,
  hasDbtProjectFile,
  readDbtProjectFile,
} from "../../core/snapshot/index";
import { onDidChangeSettings, readSetting } from "../../settings/index";
import { activeModelUri } from "./previewUri";
import {
  ENABLED_SETTING,
  PROJECTS_SETTING,
  resolveDeclaredProjectRoots,
  type DeclaredProjectRoots,
} from "./projectConfiguration";
import { findProjectRootForFile } from "./projectDiscovery";
import {
  type Candidate,
  type DeclaredProjectOrigin,
  type DesiredProject,
  keepUnchanged,
  lookupOrder,
  mergeByRealpath,
  sameOrder,
} from "./projectSet";

/** Both project file names; a simple, non-recursive glob, so VS Code does not filter it with `files.watcherExclude`. */
const PROJECT_FILE_GLOB = "dbt_project.{yml,yaml}";

/** Languages whose open documents can declare a project. */
const DECLARING_LANGUAGES: ReadonlySet<string> = new Set([
  "jinja-sql",
  "sql",
  "yaml",
]);

/** One configured dbt project that receives independent editor services. */
export interface DeclaredProject extends Disposable {
  readonly root: Uri;
  readonly name: string;
  readonly folder: WorkspaceFolder;
  readonly origin: DeclaredProjectOrigin;
  contains(uri: Uri): boolean;
}

interface OpenedRoot {
  folder: WorkspaceFolder;
  root: Uri;
}

/** A project root an opened file or a `projects` entry points at, which the registry does not serve, and why. */
export type UnservedRoot =
  | { reason: "disabled"; folder: WorkspaceFolder; root: Uri }
  | { reason: "untrusted"; folder: WorkspaceFolder; root: Uri }
  | {
      reason: "missingProjectFile";
      folder: WorkspaceFolder;
      entry: string;
      root: string;
    }
  | { reason: "invalidEntry"; folder: WorkspaceFolder; entry: string };

/** Resolves and tracks the workspace's Declared Projects. */
export class ProjectRegistry implements Disposable {
  private _projects: RegisteredProject[] = [];
  private lookupOrder: RegisteredProject[] = [];
  private watchers = new Map<string, FileSystemWatcher>();
  /** Roots declared from opened files, keyed by canonical path. Held in memory until the window reloads. */
  private openedRoots = new Map<string, OpenedRoot>();
  private readonly _onDidChangeProjects = new EventEmitter<void>();
  private readonly _onDidFindUnservedRoot = new EventEmitter<UnservedRoot>();
  private readonly subscriptions: Disposable[] = [];
  private initialized = false;
  private disposed = false;
  private terminal: Log;

  constructor(terminal: Log) {
    this.terminal = terminal;
  }

  get projects(): readonly DeclaredProject[] {
    return this._projects;
  }

  get onDidChangeProjects(): Event<void> {
    return this._onDidChangeProjects.event;
  }

  /** Fires for each root that is found but not served; listeners decide how often to tell the user. */
  get onDidFindUnservedRoot(): Event<UnservedRoot> {
    return this._onDidFindUnservedRoot.event;
  }

  /** Returns the deepest Declared Project containing the resource; a compiled preview resolves through its model. */
  findProject(uri: Uri): DeclaredProject | undefined {
    if (!uri?.fsPath) {
      return undefined;
    }
    const resource = activeModelUri(uri);
    return this.lookupOrder.find((project) => project.contains(resource));
  }

  /** Declares the nearest project root of each eligible document; the next reconcile registers new roots. */
  declareFromDocuments(documents: readonly TextDocument[]): void {
    if (!this.initialized || this.disposed) {
      return;
    }
    let added = false;
    for (const document of documents) {
      const found = openedRootOf(document);
      if (!found) {
        continue;
      }
      if (found.reason) {
        this._onDidFindUnservedRoot.fire({
          reason: found.reason,
          folder: found.folder,
          root: found.root,
        });
        continue;
      }
      const opened = { folder: found.folder, root: found.root };
      const key = canonicalPath(opened.root.fsPath);
      if (
        this.openedRoots.has(key) ||
        this._projects.some((project) => project.realpathKey === key)
      ) {
        continue;
      }
      this.openedRoots.set(key, opened);
      added = true;
    }
    if (added) {
      this.reconcile();
    }
  }

  /** Resolves the initial registry and subscribes to its configuration inputs. */
  async initialize(): Promise<void> {
    if (this.initialized || this.disposed) {
      return;
    }
    this.initialized = true;
    this.reconcile();
    this.subscriptions.push(
      onDidChangeSettings([PROJECTS_SETTING, ENABLED_SETTING], (change) => {
        if (change.affects()) {
          this.reconcile();
        }
      }),
      workspace.onDidChangeWorkspaceFolders(() => this.reconcile()),
    );
  }

  private reconcile(): void {
    if (this.disposed) {
      return;
    }
    this.pruneOpenedRoots();
    const candidates: Candidate[] = [];
    for (const folder of workspace.workspaceFolders ?? []) {
      const resolved = resolveDeclaredProjectRoots(folder);
      this.reportProblems(folder, resolved.problems);
      for (const root of resolved.roots) {
        this.addCandidate(candidates, {
          folder,
          root,
          origin: resolved.source,
        });
      }
    }
    for (const opened of this.openedRoots.values()) {
      this.addCandidate(candidates, { ...opened, origin: "openedFile" });
    }

    const desired = mergeByRealpath(candidates);
    const next = keepUnchanged(
      this._projects,
      desired,
      (d) => new RegisteredProject(d),
    );
    const nextWatchers = this.watchRoots(desired.map((d) => d.root.fsPath));
    for (const p of this._projects) {
      if (!next.includes(p)) {
        p.dispose();
      }
    }
    for (const [key, w] of this.watchers) {
      if (!nextWatchers.has(key)) {
        w.dispose();
      }
    }

    const changed = !sameOrder(this._projects, next);
    this._projects = next;
    this.lookupOrder = lookupOrder(next);
    this.watchers = nextWatchers;
    if (changed) {
      this._onDidChangeProjects.fire();
    }
  }

  /** Warns about each blocking configuration problem and fires it so listeners can tell the user. */
  private reportProblems(
    folder: WorkspaceFolder,
    problems: DeclaredProjectRoots["problems"],
  ): void {
    for (const problem of problems) {
      const message =
        problem.reason === "missingProjectFile"
          ? `Declared Project entry ${problem.entry} has no dbt_project.yml or dbt_project.yaml at ${problem.root}`
          : `Invalid Declared Project entry: ${problem.entry}`;
      this.terminal.warn("projectRegistry", message);
      this._onDidFindUnservedRoot.fire({ ...problem, folder });
    }
  }

  /**
   * Watches each root's project file and every ancestor folder of each root, up to the filesystem root. Each
   * watcher is a simple, non-recursive pattern, which VS Code does not filter with `files.watcherExclude`, so a
   * window that hides `.strands-*` still reports a checkout's delete. The delete arrives as one event for the
   * topmost folder removed, which is one of these ancestors, and reconciling on any of them is enough.
   * Roots outside their workspace folder (an absolute `projects` entry) are covered the same way.
   */
  private watchRoots(roots: string[]): Map<string, FileSystemWatcher> {
    const targets = new Map<string, RelativePattern>();
    for (const root of roots) {
      targets.set(
        `${root}${path.sep}${PROJECT_FILE_GLOB}`,
        new RelativePattern(root, PROJECT_FILE_GLOB),
      );
      for (let dir = root; path.dirname(dir) !== dir; dir = path.dirname(dir)) {
        targets.set(
          dir,
          new RelativePattern(path.dirname(dir), path.basename(dir)),
        );
      }
    }
    const watchers = new Map<string, FileSystemWatcher>();
    for (const [key, pattern] of targets) {
      watchers.set(
        key,
        this.watchers.get(key) ?? this.createReconcilingWatcher(pattern),
      );
    }
    return watchers;
  }

  private createReconcilingWatcher(
    pattern: RelativePattern,
  ): FileSystemWatcher {
    const watcher = workspace.createFileSystemWatcher(pattern);
    const reconcile = () => this.reconcile();
    watcher.onDidCreate(reconcile);
    watcher.onDidChange(reconcile);
    watcher.onDidDelete(reconcile);
    return watcher;
  }

  /** Adds the root as a candidate unless its project file cannot be parsed. */
  private addCandidate(
    candidates: Candidate[],
    declared: Omit<Candidate, "name" | "realpathKey">,
  ): void {
    const { folder, root, origin } = declared;
    const file = readDbtProjectFile(root.fsPath);
    if (file.kind !== "parsed") {
      this.terminal.warn(
        "projectRegistry",
        `Parse error at ${root.fsPath}: ${file.kind === "missing" ? "file is missing" : file.message}`,
      );
      return;
    }
    const name = declaredProjectName(file.config) ?? path.basename(root.fsPath);
    candidates.push({
      folder,
      root,
      name,
      realpathKey: canonicalPath(root.fsPath),
      origin,
    });
  }

  /**
   * Drops opened-file roots whose folder left the workspace, was disabled, or lost its project file. Re-enabling
   * does not restore them, and a root whose file returns is declared again by an opened document.
   */
  private pruneOpenedRoots(): void {
    const folders = new Set(
      (workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
    );
    for (const [key, { folder, root }] of this.openedRoots) {
      if (
        !folders.has(folder.uri.fsPath) ||
        readSetting(ENABLED_SETTING, folder.uri) === false ||
        !hasDbtProjectFile(root.fsPath)
      ) {
        this.openedRoots.delete(key);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    disposeAll(this.subscriptions);
    disposeAll([...this._projects]);
    disposeAll([...this.watchers.values()]);
    this._projects = [];
    this.lookupOrder = [];
    this.watchers.clear();
    this.openedRoots.clear();
    this._onDidChangeProjects.dispose();
    this._onDidFindUnservedRoot.dispose();
  }
}

class RegisteredProject implements DeclaredProject {
  readonly folder: WorkspaceFolder;
  readonly root: Uri;
  readonly name: string;
  readonly realpathKey: string;
  readonly aliases: readonly string[];
  readonly origin: DeclaredProjectOrigin;

  constructor(desired: DesiredProject) {
    this.folder = desired.folder;
    this.root = desired.root;
    this.name = desired.name;
    this.realpathKey = desired.realpathKey;
    this.aliases = desired.aliases;
    this.origin = desired.origin;
  }

  contains(uri: Uri): boolean {
    if (!uri?.fsPath) {
      return false;
    }
    return this.aliases.some((alias) => isAtOrBelow(alias, uri.fsPath));
  }

  dispose(): void {}
}

/**
 * The nearest project root of an eligible document; with a `reason` when the root exists but the folder is disabled
 * or the workspace is untrusted. Undefined when the document cannot declare one.
 */
function openedRootOf(
  document: TextDocument,
): (OpenedRoot & { reason?: "disabled" | "untrusted" }) | undefined {
  if (
    document.uri.scheme !== "file" ||
    !DECLARING_LANGUAGES.has(document.languageId)
  ) {
    return undefined;
  }
  const folder = workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    return undefined;
  }
  const root = findProjectRootForFile(document.uri, folder, {
    accept: namesProfile,
  });
  if (!root) {
    return undefined;
  }
  if (readSetting(ENABLED_SETTING, folder.uri) === false) {
    return { folder, root, reason: "disabled" };
  }
  if (!workspace.isTrusted) {
    return { folder, root, reason: "untrusted" };
  }
  return { folder, root };
}

/**
 * Whether `dir`'s project file can run on its own: it names a `profile`, or it does not parse, so the parse error is
 * reported. A file with no `profile` is a package, which only the project installing it can run.
 */
function namesProfile(dir: string): boolean {
  const file = readDbtProjectFile(dir);
  if (file.kind === "missing") {
    return false;
  }
  if (file.kind !== "parsed") {
    return true;
  }
  const profile = file.config.profile;
  return typeof profile === "string" && profile.trim() !== "";
}

/** The realpath of `fsPath`, or `fsPath` itself when it cannot be resolved (for example, the file is missing). */
export function canonicalPath(fsPath: string): string {
  try {
    return realpathSync.native(fsPath);
  } catch {
    return fsPath;
  }
}
