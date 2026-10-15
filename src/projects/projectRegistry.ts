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
import type { Log } from "../core/log";
import {
  DBT_PROJECT_FILE_GLOB,
  declaredProjectName,
  readDbtProjectFile,
} from "../core/snapshot";
import { onDidChangeSettings, readSetting } from "../settings";
import { activeModelUri } from "./previewUri";
import {
  ENABLED_SETTING,
  PROJECTS_SETTING,
  resolveDeclaredProjectRoots,
} from "./projectConfiguration";
import { findProjectRootForFile } from "./projectDiscovery";

/** How a Declared Project came to be declared. */
export type DeclaredProjectOrigin = "explicit" | "folderRoot" | "openedFile";

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

/** Resolves and tracks the workspace's Declared Projects. */
export class ProjectRegistry implements Disposable {
  private _projects: DeclaredProjectImpl[] = [];
  private lookupOrder: DeclaredProjectImpl[] = [];
  private watchers = new Map<string, FileSystemWatcher>();
  /** Roots declared from opened files, keyed by canonical path. Held in memory until the window reloads. */
  private openedRoots = new Map<string, OpenedRoot>();
  private readonly _onDidChangeProjects = new EventEmitter<void>();
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
      const opened = openedRootOf(document);
      if (!opened) {
        continue;
      }
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
      if (resolved.problems.length > 0) {
        resolved.problems.forEach((problem) => {
          const message =
            problem.reason === "missingProjectFile"
              ? `Declared Project entry ${problem.entry} has no dbt_project.yml or dbt_project.yaml at ${problem.root}`
              : `Invalid Declared Project entry: ${problem.entry}`;
          this.terminal.warn("projectRegistry", message);
        });
      }
      for (const root of resolved.roots) {
        this.addCandidate(candidates, {
          folder,
          root,
          origin: resolved.source,
        });
      }
    }
    // Opened-file roots come last, so a root that is also configured keeps its configured origin.
    for (const opened of this.openedRoots.values()) {
      this.addCandidate(candidates, { ...opened, origin: "openedFile" });
    }

    const byRealpath = new Map<string, DesiredProject>();
    for (const candidate of candidates) {
      const existing = byRealpath.get(candidate.realpathKey);
      if (existing) {
        if (!existing.aliases.includes(candidate.root.fsPath)) {
          existing.aliases.push(candidate.root.fsPath);
        }
      } else {
        byRealpath.set(candidate.realpathKey, {
          ...candidate,
          aliases: [...new Set([candidate.root.fsPath, candidate.realpathKey])],
        });
      }
    }

    const next: DeclaredProjectImpl[] = [];
    const nextWatchers = new Map<string, FileSystemWatcher>();
    for (const d of byRealpath.values()) {
      const existing = this._projects.find(
        (p) =>
          p.realpathKey === d.realpathKey &&
          p.root.fsPath === d.root.fsPath &&
          p.folder.uri.fsPath === d.folder.uri.fsPath &&
          p.name === d.name &&
          p.origin === d.origin &&
          samePaths(p.aliases, d.aliases),
      );
      if (existing) {
        next.push(existing);
      } else {
        next.push(new DeclaredProjectImpl(d));
      }
      let watcher = this.watchers.get(d.realpathKey);
      if (!watcher) {
        watcher = workspace.createFileSystemWatcher(
          new RelativePattern(d.root, DBT_PROJECT_FILE_GLOB),
        );
        watcher.onDidCreate(() => this.reconcile());
        watcher.onDidChange(() => this.reconcile());
        watcher.onDidDelete(() => this.reconcile());
      }
      nextWatchers.set(d.realpathKey, watcher);
    }

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

    const changed =
      this._projects.length !== next.length ||
      this._projects.some((p, i) => next[i] !== p);
    this._projects = next;
    this.lookupOrder = next.toSorted((a, b) => {
      const depth =
        b.root.fsPath.split(path.sep).length -
        a.root.fsPath.split(path.sep).length;
      return depth || b.root.fsPath.localeCompare(a.root.fsPath);
    });
    this.watchers = nextWatchers;
    if (changed) {
      this._onDidChangeProjects.fire();
    }
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

  /** Drops opened-file roots whose folder left the workspace or was disabled; re-enabling does not restore them. */
  private pruneOpenedRoots(): void {
    const folders = new Set(
      (workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
    );
    for (const [key, { folder }] of this.openedRoots) {
      if (
        !folders.has(folder.uri.fsPath) ||
        readSetting(ENABLED_SETTING, folder.uri) === false
      ) {
        this.openedRoots.delete(key);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    while (this.subscriptions.length) {
      this.subscriptions.pop()?.dispose();
    }
    for (const p of this._projects) {
      p.dispose();
    }
    for (const w of this.watchers.values()) {
      w.dispose();
    }
    this._projects = [];
    this.lookupOrder = [];
    this.watchers.clear();
    this.openedRoots.clear();
    this._onDidChangeProjects.dispose();
  }
}

class DeclaredProjectImpl implements DeclaredProject {
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
    return this.aliases.some(
      (alias) =>
        uri.fsPath === alias || uri.fsPath.startsWith(alias + path.sep),
    );
  }

  dispose(): void {}
}

interface Candidate {
  folder: WorkspaceFolder;
  root: Uri;
  name: string;
  realpathKey: string;
  origin: DeclaredProjectOrigin;
}

interface DesiredProject extends Candidate {
  aliases: string[];
}

/** The nearest project root of an eligible document, or undefined when the document cannot declare one. */
function openedRootOf(document: TextDocument): OpenedRoot | undefined {
  if (
    document.uri.scheme !== "file" ||
    !DECLARING_LANGUAGES.has(document.languageId) ||
    !workspace.isTrusted
  ) {
    return undefined;
  }
  const folder = workspace.getWorkspaceFolder(document.uri);
  if (!folder || readSetting(ENABLED_SETTING, folder.uri) === false) {
    return undefined;
  }
  const root = findProjectRootForFile(document.uri, folder);
  return root ? { folder, root } : undefined;
}

function canonicalPath(fsPath: string): string {
  try {
    return realpathSync.native(fsPath);
  } catch {
    return fsPath;
  }
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
