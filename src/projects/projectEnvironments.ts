import { dirname, isAbsolute, relative } from "path";
import {
  Disposable,
  Event,
  EventEmitter,
  RelativePattern,
  Uri,
  workspace,
  WorkspaceFolder,
} from "vscode";
import type { Log } from "../core/log";
import { projectDirVariable } from "../core/project/dbtEnvironment";
import {
  applyOverlay,
  resolveToolEnvironment,
  ToolEnvironment,
} from "../fusion/toolEnvironment";
import { onDidChangeSettings, readEnvironment, readSetting } from "../settings";
import { notifyWarning } from "./notifications";
import { DeclaredProject } from "./projectRegistry";

/** The environment a Declared Project's dbt processes launch with, and where it came from. */
export interface ProjectEnvironment {
  readonly env: Readonly<Record<string, string>>;
  readonly source: "host" | "mise" | "direnv";
  readonly result: ToolEnvironment;
  /** Set when the environment names a project directory other than the root; the extension's flag wins. */
  readonly projectDirNotice?: string;
}

type Resolve = (
  root: string,
  host: Readonly<Record<string, string>>,
) => Promise<ToolEnvironment>;

/** Files whose change can change a directory's environment; the governed directory is the file's parent. */
const TOOL_FILES =
  "**/{mise.toml,.mise.toml,mise.local.toml,.mise.local.toml,.tool-versions,.envrc}";
/** The user-level mise config of a directory; the governed directory is the parent of `.config`. */
const MISE_CONFIG = "**/.config/mise/config.toml";

type Entry = {
  project: DeclaredProject;
  probe: Promise<ProjectEnvironment>;
  value: ProjectEnvironment | undefined;
};

export const sameEnv = (
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
  );
};

const isAtOrBelow = (dir: string, path: string): boolean => {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * Resolves each Declared Project's tool environment once and keeps it current. `ensure` is what a launch awaits, so
 * nothing launches with the host environment alone when a tool manager defines more.
 */
export class ProjectEnvironments implements Disposable {
  private readonly cache = new Map<string, Entry>();
  private readonly watchers = new Map<string, Disposable[]>();
  private readonly subscriptions: Disposable[] = [];
  private readonly _onDidChange = new EventEmitter<DeclaredProject>();
  private readonly warned = new Set<string>();
  private readonly reported = new Set<string>();
  private disposed = false;

  constructor(
    private readonly log: (project: DeclaredProject) => Log,
    private readonly resolve: Resolve = resolveToolEnvironment,
    private readonly host: () => Record<string, string> = readEnvironment,
  ) {
    this.subscriptions.push(
      this._onDidChange,
      onDidChangeSettings(["toolEnvironment"], (change) =>
        this.reresolve((project) => change.affects(project.root)),
      ),
      workspace.onDidGrantWorkspaceTrust(() => this.reresolve(() => true)),
      workspace.onDidChangeWorkspaceFolders(() => this.syncWatchers()),
    );
    this.syncWatchers();
  }

  /** Fires with a project whose environment changed after it was first resolved. */
  get onDidChange(): Event<DeclaredProject> {
    return this._onDidChange.event;
  }

  /** The project's environment, resolving it first; concurrent calls for one root share one probe. */
  ensure(project: DeclaredProject): Promise<ProjectEnvironment> {
    const key = project.root.fsPath;
    const existing = this.cache.get(key);
    if (existing) {
      return existing.probe;
    }
    const entry: Entry = {
      project,
      value: undefined,
      probe: this.probe(project).then((value) => {
        if (this.cache.get(key) === entry) {
          entry.value = value;
        }
        return value;
      }),
    };
    this.cache.set(key, entry);
    return entry.probe;
  }

  /** The environment as last resolved, for synchronous readers; undefined until `ensure` has settled. */
  peek(project: DeclaredProject): ProjectEnvironment | undefined {
    return this.cache.get(project.root.fsPath)?.value;
  }

  /**
   * A snapshot reader for `project` that reads with its resolved environment, and a wait for that environment; the
   * CLI awaits `ready` before each command.
   */
  snapshotSource<T>(
    project: DeclaredProject,
    read: (root: Uri, environment?: Readonly<Record<string, string>>) => T,
  ): { snapshot: () => T; ready: () => Promise<unknown> } {
    return {
      snapshot: () => read(project.root, this.peek(project)?.env),
      ready: () => this.ensure(project),
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const watchers of this.watchers.values()) {
      watchers.forEach((watcher) => watcher.dispose());
    }
    this.watchers.clear();
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.cache.clear();
  }

  private async probe(project: DeclaredProject): Promise<ProjectEnvironment> {
    const host = this.host();
    const root = project.root.fsPath;
    let result: ToolEnvironment = { kind: "none" };
    if (
      workspace.isTrusted &&
      readSetting("toolEnvironment", project.root) !== "off"
    ) {
      try {
        result = await this.resolve(root, host);
      } catch (error) {
        this.log(project).warn(
          "projectEnvironment",
          `Could not read the environment for ${root}: ${String(error)}`,
        );
      }
    }
    const env =
      result.kind === "resolved" ? applyOverlay(host, result.overlay) : host;
    this.report(project, result);
    const ignored = projectDirVariable(env, root);
    const projectDirNotice =
      ignored &&
      `${ignored.name}=${ignored.value} is ignored for ${root}: --project-dir takes precedence`;
    if (projectDirNotice && !this.reported.has(projectDirNotice)) {
      this.reported.add(projectDirNotice);
      this.log(project).info("projectEnvironment", projectDirNotice);
    }
    return {
      env,
      source: result.kind === "resolved" ? result.manager : "host",
      result,
      ...(projectDirNotice ? { projectDirNotice } : {}),
    };
  }

  private report(project: DeclaredProject, result: ToolEnvironment): void {
    const root = project.root.fsPath;
    if (result.kind === "failed") {
      this.log(project).warn(
        "projectEnvironment",
        `Could not read the ${result.manager} environment for ${root}: ${result.detail}`,
      );
    } else if (result.kind === "untrusted") {
      const key = `${root}\n${result.hint}`;
      this.log(project).warn("projectEnvironment", result.detail);
      if (!this.warned.has(key)) {
        this.warned.add(key);
        void notifyWarning(project, result.hint);
      }
    }
  }

  /** Probes again every cached project `affected` selects, firing `onDidChange` for those whose env changed. */
  private reresolve(affected: (project: DeclaredProject) => boolean): void {
    for (const [key, entry] of [...this.cache]) {
      if (!affected(entry.project)) {
        continue;
      }
      this.cache.delete(key);
      void Promise.all([entry.probe, this.ensure(entry.project)]).then(
        ([before, after]) => {
          if (
            !this.disposed &&
            !sameEnv(before.env, after.env) &&
            this.cache.get(key)?.value === after
          ) {
            this._onDidChange.fire(entry.project);
          }
        },
      );
    }
  }

  private syncWatchers(): void {
    const folders = workspace.workspaceFolders ?? [];
    const current = new Set(folders.map((folder) => folder.uri.fsPath));
    for (const [key, watchers] of [...this.watchers]) {
      if (!current.has(key)) {
        watchers.forEach((watcher) => watcher.dispose());
        this.watchers.delete(key);
      }
    }
    for (const folder of folders) {
      if (!this.watchers.has(folder.uri.fsPath)) {
        this.watchers.set(folder.uri.fsPath, this.watchFolder(folder));
      }
    }
  }

  private watchFolder(folder: WorkspaceFolder): Disposable[] {
    const watch = (pattern: string, governed: (file: string) => string) => {
      const watcher = workspace.createFileSystemWatcher(
        new RelativePattern(folder, pattern),
      );
      const onEvent = (uri: { fsPath: string }) => {
        const dir = governed(uri.fsPath);
        this.reresolve((project) => isAtOrBelow(dir, project.root.fsPath));
      };
      return [
        watcher,
        watcher.onDidCreate(onEvent),
        watcher.onDidChange(onEvent),
        watcher.onDidDelete(onEvent),
      ];
    };
    return [
      ...watch(TOOL_FILES, dirname),
      ...watch(MISE_CONFIG, (file) => dirname(dirname(dirname(file)))),
    ];
  }
}
