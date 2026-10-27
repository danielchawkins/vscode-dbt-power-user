import type { Disposable, Event, LogOutputChannel, Uri } from "vscode";
import { EventEmitter } from "vscode";
import type { Log } from "../../core/log";
import type { LspLaunch } from "../../core/lsp/index";
import { sameLspLaunch, toLspLaunch } from "../../core/lsp/index";
import {
  hasDbtProjectFile,
  type ProjectSnapshot,
} from "../../core/snapshot/index";
import { type FusionClient } from "../../fusion/fusionClient";
import type {
  FusionExecutable,
  FusionExecutableResolver,
} from "../../fusion/fusionExecutable";
import { isFusionExecutable } from "../../fusion/fusionExecutable";
import type { SettingsChange } from "../../settings/index";
import { onDidChangeSettings } from "../../settings/index";
import type {
  DeclaredProject,
  ProjectRegistry,
} from "../registry/projectRegistry";
import { launchClient } from "./clientLaunch";
import type { FusionClientFactory } from "./fusionClientFactory";
import type { ProjectEnvironments } from "./projectEnvironments";
import { sameEnv } from "./projectEnvironments";
import { PROJECT_SNAPSHOT_SETTINGS } from "./readProjectSnapshot";

/** Registry changes that arrive within this window reconcile once, so a burst of folder changes starts no extra client. */
const RECONCILE_DEBOUNCE_MS = 500;

export interface FusionClientPool extends Disposable {
  /** One client per Declared Project, created and torn down with the registry. */
  get(project: DeclaredProject): FusionClient | undefined;
  /** The launch the project's current client was started with. */
  getLaunch(project: DeclaredProject): LspLaunch | undefined;
  readonly onDidChangeClients: Event<void>;
  /** Starts client lifecycle after activation gates and registry initialization. */
  initialize(): void;
  /** Awaitable shutdown that drains in-flight pool work and client processes. */
  stop(): Promise<void>;
}

type ManagedClient = {
  projectKey: string;
  project: DeclaredProject;
  client: FusionClient;
  launch: LspLaunch;
  env: Record<string, string>;
  /** Undefined for a client that failed to resolve an executable. */
  executable: FusionExecutable | undefined;
};

/** Environment a project's language server launches with, beyond the extension host's. */
interface FusionLaunchEnvironment {
  resolve(project: DeclaredProject): Record<string, string>;
  /** Fires when `resolve` may answer differently; clients whose environment changed are relaunched. */
  readonly onDidChange: Event<unknown>;
}

/** Per-project launch inputs the pool reads before each client start. */
export interface FusionLaunchSources {
  readSnapshot: (
    root: Uri,
    environment?: Readonly<Record<string, string>>,
  ) => ProjectSnapshot;
  /** Resolves each project's environment before its client launches; a change relaunches that client only. */
  environments: Pick<ProjectEnvironments, "ensure" | "peek" | "onDidChange">;
  /** The Declared Project's log channel, shared by every client the pool starts for it. */
  outputChannel: (project: DeclaredProject) => LogOutputChannel;
  launchEnv?: FusionLaunchEnvironment | undefined;
  /** Whether the root still holds a project file; a root without one gets no client. Defaults to the file system. */
  rootExists?: ((root: Uri) => boolean) | undefined;
}

export class FusionClientPoolImpl implements FusionClientPool {
  private readonly clients = new Map<string, ManagedClient>();
  private readonly subscriptions: Disposable[] = [];
  private readonly _onDidChangeClients = new EventEmitter<void>();
  private operationChain: Promise<void> = Promise.resolve();
  private stopPromise: Promise<void> | undefined;
  private initialized = false;
  private disposed = false;
  private reconcileTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly registry: ProjectRegistry;
  private readonly terminal: Log;
  private readonly deps: FusionClientPoolDependencies;

  constructor(
    registry: ProjectRegistry,
    terminal: Log,
    deps: FusionClientPoolDependencies,
  ) {
    this.registry = registry;
    this.terminal = terminal;
    this.deps = deps;
    this.subscriptions.push(
      this.registry.onDidChangeProjects(() => {
        this.scheduleReconcile();
      }),
      onDidChangeSettings(PROJECT_SNAPSHOT_SETTINGS, (change) => {
        void this.enqueue(() => this.handleConfigurationChange(change));
      }),
      this.deps.environments.onDidChange((project) => {
        void this.enqueue(() => this.handleEnvironmentChange(project));
      }),
    );
    if (this.deps.launchEnv) {
      this.subscriptions.push(
        this.deps.launchEnv.onDidChange(() => {
          void this.enqueue(() => this.handleLaunchEnvChange());
        }),
      );
    }
  }

  get onDidChangeClients(): Event<void> {
    return this._onDidChangeClients.event;
  }

  get(project: DeclaredProject): FusionClient | undefined {
    return this.clients.get(projectKey(project))?.client;
  }

  getLaunch(project: DeclaredProject): LspLaunch | undefined {
    return this.clients.get(projectKey(project))?.launch;
  }

  initialize(): void {
    if (this.initialized || this.disposed) {
      return;
    }
    this.initialized = true;
    void this.enqueue(() => this.reconcile());
  }

  dispose(): void {
    void this.stop();
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.disposed = true;
      this.stopPromise = this.enqueue(async () => this.doStop());
    }
    return this.stopPromise;
  }

  private async doStop(): Promise<void> {
    clearTimeout(this.reconcileTimer);
    this.reconcileTimer = undefined;
    while (this.subscriptions.length) {
      this.subscriptions.pop()?.dispose();
    }
    const managed = [...this.clients];
    await Promise.all(
      managed.map(([key, entry]) => this.stopManaged(key, entry)),
    );
    this._onDidChangeClients.dispose();
  }

  /** Drops the entry under `key` and stops its client. Callers check `disposed` after the await. */
  private async stopManaged(
    key: string,
    managed: ManagedClient,
  ): Promise<void> {
    this.clients.delete(key);
    managed.client.dispose();
    await managed.client.stop();
  }

  /**
   * Replaces each entry `isStale` names, in order. Returns whether any was replaced; stops early and
   * returns false once the pool is disposed.
   */
  private async replaceEach(
    entries: Iterable<[string, DeclaredProject]>,
    isStale: (
      key: string,
      project: DeclaredProject,
    ) => boolean | Promise<boolean>,
  ): Promise<boolean> {
    let changed = false;
    for (const [key, project] of entries) {
      if (!(await isStale(key, project))) {
        continue;
      }
      await this.replaceClient(project, key);
      if (this.disposed) {
        return false;
      }
      changed = true;
    }
    return changed;
  }

  /** Runs one reconcile after registry changes stop for {@link RECONCILE_DEBOUNCE_MS}. */
  private scheduleReconcile(): void {
    if (this.disposed) {
      return;
    }
    clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined;
      void this.enqueue(() => this.reconcile());
    }, RECONCILE_DEBOUNCE_MS);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.operationChain.then(task).catch((error: unknown) => {
      this.terminal.error(
        "fusionClientPool",
        "Fusion client pool operation failed",
        error,
      );
    });
    this.operationChain = run;
    return run;
  }

  /** The registry's project for `key`, unless its root no longer holds a project file. */
  private findDesiredProject(key: string): DeclaredProject | undefined {
    return this.registry.projects.find(
      (project) => projectKey(project) === key && this.hasRoot(project.root),
    );
  }

  private hasRoot(root: Uri): boolean {
    return this.deps.rootExists
      ? this.deps.rootExists(root)
      : hasDbtProjectFile(root.fsPath);
  }

  private async handleConfigurationChange(
    change: SettingsChange,
  ): Promise<void> {
    if (!this.initialized || this.disposed) {
      return;
    }

    const projects = this.registry.projects.map(
      (project): [string, DeclaredProject] => [projectKey(project), project],
    );
    const changed = await this.replaceEach(projects, async (key, project) => {
      if (!change.affects(project.root)) {
        return false;
      }
      const managed = this.clients.get(key);
      return (
        managed !== undefined && !(await this.isCurrentLaunch(project, managed))
      );
    });
    if (changed) {
      this._onDidChangeClients.fire();
    }
  }

  /** Whether the client's launch equals one built now, with the executable resolved afresh so a switched binary counts. */
  private async isCurrentLaunch(
    project: DeclaredProject,
    managed: ManagedClient,
  ): Promise<boolean> {
    const environment = await this.deps.environments.ensure(project);
    const verdict = await this.deps.resolver.resolve(project.root, environment);
    return sameLspLaunch(
      managed.launch,
      toLspLaunch(
        this.snapshot(project),
        isFusionExecutable(verdict) ? verdict.path : undefined,
      ),
    );
  }

  private async handleEnvironmentChange(
    project: DeclaredProject,
  ): Promise<void> {
    const key = projectKey(project);
    if (this.initialized && !this.disposed && this.clients.has(key)) {
      await this.replaceClient(project, key);
      if (!this.disposed) {
        this._onDidChangeClients.fire();
      }
    }
  }

  /** The project's snapshot read against its resolved environment, or the host's before it resolves. */
  private snapshot(project: DeclaredProject): ProjectSnapshot {
    return this.deps.readSnapshot(
      project.root,
      this.deps.environments.peek(project)?.env,
    );
  }

  private async handleLaunchEnvChange(): Promise<void> {
    if (!this.initialized || this.disposed) {
      return;
    }
    // Snapshot: replaceClient replaces entries while the loop runs.
    const entries = Array.from(
      this.clients,
      ([key, managed]): [string, DeclaredProject] => [key, managed.project],
    );
    const changed = await this.replaceEach(entries, (key) => {
      const managed = this.clients.get(key);
      return (
        managed?.executable !== undefined &&
        !sameEnv(managed.env, this.resolveEnv(managed.project))
      );
    });
    if (changed) {
      this._onDidChangeClients.fire();
    }
  }

  /** The resolved variables; they override the executable's own environment. */
  private resolveEnv(project: DeclaredProject): Record<string, string> {
    return this.deps.launchEnv?.resolve(project) ?? {};
  }

  private async reconcile(): Promise<void> {
    if (!this.initialized || this.disposed) {
      return;
    }

    const nextProjects = new Map(
      this.registry.projects
        .filter((project) => this.hasRoot(project.root))
        .map((project) => [projectKey(project), project]),
    );
    let changed = false;

    for (const [key, managed] of this.clients) {
      if (nextProjects.has(key)) {
        continue;
      }
      await this.stopManaged(key, managed);
      if (this.disposed) {
        return;
      }
      changed = true;
    }

    const replaced = await this.replaceEach(
      nextProjects,
      (key, project) => this.clients.get(key)?.project !== project,
    );
    if (this.disposed) {
      return;
    }
    if (changed || replaced) {
      this._onDidChangeClients.fire();
    }
  }

  private async replaceClient(
    project: DeclaredProject,
    key: string,
  ): Promise<void> {
    const existing = this.clients.get(key);
    if (existing) {
      await this.stopManaged(key, existing);
      if (this.disposed) {
        return;
      }
    }

    const environment = await this.deps.environments.ensure(project);
    if (this.disposed || this.findDesiredProject(key) !== project) {
      return;
    }
    const verdict = await this.deps.resolver.resolve(project.root, environment);
    if (this.disposed || this.findDesiredProject(key) !== project) {
      return;
    }

    const snapshot = this.snapshot(project);
    const executable = isFusionExecutable(verdict) ? verdict : undefined;
    const env = executable ? this.resolveEnv(project) : {};
    const { client, launch } = launchClient(
      {
        registry: this.registry,
        factory: this.deps.factory,
        outputChannel: this.deps.outputChannel,
      },
      { project, verdict, snapshot, env },
    );

    if (this.disposed || this.findDesiredProject(key) !== project) {
      client.dispose();
      await client.stop();
      return;
    }

    this.clients.set(key, {
      projectKey: key,
      project,
      client,
      launch,
      env,
      executable,
    });
  }
}

function projectKey(project: DeclaredProject): string {
  return project.root.fsPath;
}

export type FusionClientPoolDependencies = FusionLaunchSources & {
  resolver: FusionExecutableResolver;
  factory: FusionClientFactory;
};

export function createFusionClientPool(
  registry: ProjectRegistry,
  terminal: Log,
  deps: FusionClientPoolDependencies,
): FusionClientPoolImpl {
  return new FusionClientPoolImpl(registry, terminal, deps);
}
