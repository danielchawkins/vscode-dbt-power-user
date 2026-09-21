import {
  DBT_PROJECT_FILE,
  DBTTerminal,
  readAndParseProjectConfig,
} from "@altimateai/dbt-integration";
import { realpathSync } from "fs";
import * as path from "path";
import {
  Disposable,
  Event,
  EventEmitter,
  FileSystemWatcher,
  RelativePattern,
  Uri,
  workspace,
  WorkspaceFolder,
} from "vscode";
import {
  CONFIGURATION_SECTION,
  PROJECTS_SETTING,
  resolveDeclaredProjectRoots,
} from "./projectConfiguration";

/** One configured dbt project that receives independent editor services. */
export interface DeclaredProject extends Disposable {
  readonly root: Uri;
  readonly name: string;
  readonly folder: WorkspaceFolder;
  contains(uri: Uri): boolean;
}

/** Resolves and tracks the workspace's Declared Projects. */
export class ProjectRegistry implements Disposable {
  private _projects: DeclaredProjectImpl[] = [];
  private lookupOrder: DeclaredProjectImpl[] = [];
  private watchers = new Map<string, FileSystemWatcher>();
  private readonly _onDidChangeProjects = new EventEmitter<void>();
  private readonly subscriptions: Disposable[] = [];
  private initialized = false;
  private disposed = false;

  constructor(private terminal: DBTTerminal) {}

  get projects(): readonly DeclaredProject[] {
    return this._projects;
  }

  get onDidChangeProjects(): Event<void> {
    return this._onDidChangeProjects.event;
  }

  /** Returns the deepest Declared Project containing the resource. */
  findProject(uri: Uri): DeclaredProject | undefined {
    if (!uri?.fsPath) {
      return undefined;
    }
    return this.lookupOrder.find((project) => project.contains(uri));
  }

  /** Resolves the initial registry and subscribes to its configuration inputs. */
  async initialize(): Promise<void> {
    if (this.initialized || this.disposed) {
      return;
    }
    this.initialized = true;
    this.reconcile();
    this.subscriptions.push(
      workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(
            `${CONFIGURATION_SECTION}.${PROJECTS_SETTING}`,
          )
        ) {
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
    const candidates: Candidate[] = [];
    for (const folder of workspace.workspaceFolders ?? []) {
      const resolved = resolveDeclaredProjectRoots(folder);
      if (resolved.problems.length > 0) {
        resolved.problems.forEach((problem) => {
          const message =
            problem.reason === "missingProjectFile"
              ? `Declared Project entry ${problem.entry} has no ${DBT_PROJECT_FILE} at ${problem.root}`
              : `Invalid Declared Project entry: ${problem.entry}`;
          this.terminal.warn("projectRegistry", message);
        });
      }
      for (const root of resolved.roots) {
        let name = path.basename(root.fsPath);
        try {
          const cfg = readAndParseProjectConfig(root.fsPath);
          if (cfg?.name) {
            name = cfg.name;
          }
        } catch (error) {
          this.terminal.warn(
            "projectRegistry",
            `Parse error at ${root.fsPath}: ${error}`,
          );
          continue;
        }
        candidates.push({
          folder,
          root,
          name,
          realpathKey: canonicalPath(root.fsPath),
        });
      }
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
          samePaths(p.aliases, d.aliases),
      );
      if (existing) {
        next.push(existing);
      } else {
        const proj = new DeclaredProjectImpl(
          d.folder,
          d.root,
          d.name,
          d.realpathKey,
          d.aliases,
        );
        next.push(proj);
      }
      let watcher = this.watchers.get(d.realpathKey);
      if (!watcher) {
        watcher = workspace.createFileSystemWatcher(
          new RelativePattern(d.root, DBT_PROJECT_FILE),
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
    this.lookupOrder = [...next].sort((a, b) => {
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
    this._onDidChangeProjects.dispose();
  }
}

class DeclaredProjectImpl implements DeclaredProject {
  constructor(
    readonly folder: WorkspaceFolder,
    readonly root: Uri,
    readonly name: string,
    readonly realpathKey: string,
    readonly aliases: readonly string[],
  ) {}

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
}

interface DesiredProject extends Candidate {
  aliases: string[];
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
