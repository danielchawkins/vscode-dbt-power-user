import { Disposable, Event, EventEmitter, LogOutputChannel, Uri } from "vscode";
import type { Log } from "../core/log";
import { LspLaunch, sameLspLaunch, toLspLaunch } from "../core/lsp";
import { ProjectSnapshot } from "../core/project";
import { FailedFusionClient } from "../fusion/failedFusionClient";
import {
  ConfiguredFusionExecutableResolver,
  formatFusionExecutableResolutionFailure,
  FusionExecutable,
  FusionExecutableResolver,
  isFusionExecutable,
} from "../fusion/fusionExecutable";
import {
  commandPrefixForProject,
  DefaultFusionClientFactory,
  FusionClient,
  FusionClientFactory,
  FusionClientOptions,
} from "../fusion/fusionLanguageClient";
import { onDidChangeSettings, SettingsChange } from "../settings";
import { ProjectEnvironments, sameEnv } from "./projectEnvironments";
import { DeclaredProject, ProjectRegistry } from "./projectRegistry";
import { PROJECT_SNAPSHOT_SETTINGS } from "./readProjectSnapshot";

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
export interface FusionLaunchEnvironment {
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
  /** Receives each compile's error messages from the project's client. */
  reportCompileErrors?:
    ((project: DeclaredProject, messages: string[]) => void) | undefined;
}

export class FusionClientPoolImpl implements FusionClientPool {
  private readonly clients = new Map<string, ManagedClient>();
  private readonly subscriptions: Disposable[] = [];
  private readonly _onDidChangeClients = new EventEmitter<void>();
  private operationChain: Promise<void> = Promise.resolve();
  private stopPromise: Promise<void> | undefined;
  private initialized = false;
  private disposed = false;
  private readonly readSnapshot: FusionLaunchSources["readSnapshot"];
  private readonly environments: FusionLaunchSources["environments"];
  private readonly outputChannel: (
    project: DeclaredProject,
  ) => LogOutputChannel;
  private readonly launchEnv: FusionLaunchEnvironment | undefined;
  private readonly reportCompileErrors: FusionLaunchSources["reportCompileErrors"];

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly terminal: Log,
    private readonly resolver: FusionExecutableResolver,
    private readonly factory: FusionClientFactory,
    sources: FusionLaunchSources,
  ) {
    this.readSnapshot = sources.readSnapshot;
    this.outputChannel = sources.outputChannel;
    this.environments = sources.environments;
    this.launchEnv = sources.launchEnv;
    this.reportCompileErrors = sources.reportCompileErrors;
    this.subscriptions.push(
      this.registry.onDidChangeProjects(() => {
        void this.enqueue(() => this.reconcile());
      }),
      onDidChangeSettings(PROJECT_SNAPSHOT_SETTINGS, (change) => {
        void this.enqueue(() => this.handleConfigurationChange(change));
      }),
      this.environments.onDidChange((project) => {
        void this.enqueue(() => this.handleEnvironmentChange(project));
      }),
    );
    if (this.launchEnv) {
      this.subscriptions.push(
        this.launchEnv.onDidChange(() => {
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
    while (this.subscriptions.length) {
      this.subscriptions.pop()?.dispose();
    }
    const managed = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(
      managed.map(async (entry) => {
        entry.client.dispose();
        await entry.client.stop();
      }),
    );
    this._onDidChangeClients.dispose();
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

  private findDesiredProject(key: string): DeclaredProject | undefined {
    return this.registry.projects.find(
      (project) => projectKey(project) === key,
    );
  }

  private async handleConfigurationChange(
    change: SettingsChange,
  ): Promise<void> {
    if (!this.initialized || this.disposed) {
      return;
    }

    let changed = false;
    for (const project of this.registry.projects) {
      if (!change.affects(project.root)) {
        continue;
      }
      const key = projectKey(project);
      const managed = this.clients.get(key);
      if (!managed || (await this.isCurrentLaunch(project, managed))) {
        continue;
      }
      await this.replaceClient(project, key);
      if (this.disposed) {
        return;
      }
      changed = true;
    }

    if (changed) {
      this._onDidChangeClients.fire();
    }
  }

  /** Whether the client's launch equals one built now, with the executable resolved afresh so a switched binary counts. */
  private async isCurrentLaunch(
    project: DeclaredProject,
    managed: ManagedClient,
  ): Promise<boolean> {
    const environment = await this.environments.ensure(project);
    const verdict = await this.resolver.resolve(project.root, environment);
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
    return this.readSnapshot(
      project.root,
      this.environments.peek(project)?.env,
    );
  }

  private async handleLaunchEnvChange(): Promise<void> {
    if (!this.initialized || this.disposed) {
      return;
    }
    let changed = false;
    for (const [key, managed] of [...this.clients]) {
      if (
        managed.executable === undefined ||
        sameEnv(managed.env, this.resolveEnv(managed.project))
      ) {
        continue;
      }
      await this.replaceClient(managed.project, key);
      if (this.disposed) {
        return;
      }
      changed = true;
    }
    if (changed) {
      this._onDidChangeClients.fire();
    }
  }

  /** The resolved variables; they override the executable's own environment. */
  private resolveEnv(project: DeclaredProject): Record<string, string> {
    return this.launchEnv?.resolve(project) ?? {};
  }

  private async reconcile(): Promise<void> {
    if (!this.initialized || this.disposed) {
      return;
    }

    const nextProjects = new Map(
      this.registry.projects.map((project) => [projectKey(project), project]),
    );
    let changed = false;

    for (const [key, managed] of this.clients) {
      if (nextProjects.has(key)) {
        continue;
      }
      this.clients.delete(key);
      managed.client.dispose();
      await managed.client.stop();
      if (this.disposed) {
        return;
      }
      changed = true;
    }

    for (const [key, project] of nextProjects) {
      const managed = this.clients.get(key);
      if (managed && managed.project === project) {
        continue;
      }
      await this.replaceClient(project, key);
      if (this.disposed) {
        return;
      }
      changed = true;
    }

    if (changed) {
      this._onDidChangeClients.fire();
    }
  }

  private async replaceClient(
    project: DeclaredProject,
    key: string,
  ): Promise<void> {
    const existing = this.clients.get(key);
    if (existing) {
      this.clients.delete(key);
      existing.client.dispose();
      await existing.client.stop();
      if (this.disposed) {
        return;
      }
    }

    const environment = await this.environments.ensure(project);
    if (this.disposed || this.findDesiredProject(key) !== project) {
      return;
    }
    const verdict = await this.resolver.resolve(project.root, environment);
    if (this.disposed || this.findDesiredProject(key) !== project) {
      return;
    }

    const executable = isFusionExecutable(verdict) ? verdict : undefined;
    const launch = toLspLaunch(this.snapshot(project), executable?.path);
    const env = executable ? this.resolveEnv(project) : {};
    const client = isFusionExecutable(verdict)
      ? this.factory.create({
          project,
          executable: verdict,
          launch,
          commandPrefix: commandPrefixForProject(project),
          env,
          outputChannel: this.outputChannel(project),
          onCompileErrors: (messages) =>
            this.reportCompileErrors?.(project, messages),
        } satisfies FusionClientOptions)
      : new FailedFusionClient(
          project,
          formatFusionExecutableResolutionFailure(project.name, verdict),
          launch.staticAnalysis,
          this.outputChannel(project),
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

/** Fires when the project's client is replaced or changes state. */
export function onClientChange(
  pool: FusionClientPool,
  project: DeclaredProject,
): Event<void> {
  return (listener) => {
    let stateSubscription: Disposable | undefined;
    const follow = () => {
      stateSubscription?.dispose();
      stateSubscription = pool.get(project)?.onDidChangeState(() => listener());
    };
    follow();
    const replaced = pool.onDidChangeClients(() => {
      follow();
      listener();
    });
    return Disposable.from(replaced, {
      dispose: () => stateSubscription?.dispose(),
    });
  };
}

/** Fires when the Current Project switches, or its client is replaced or changes state. */
export function onCurrentClientChange(
  pool: FusionClientPool,
  current: {
    readonly current: DeclaredProject | undefined;
    readonly onDidChangeCurrent: Event<unknown>;
  },
): Event<void> {
  return (listener) => {
    let clientChange: Disposable | undefined;
    const follow = () => {
      clientChange?.dispose();
      const project = current.current;
      clientChange = project && onClientChange(pool, project)(listener);
    };
    follow();
    const switched = current.onDidChangeCurrent(() => {
      follow();
      listener();
    });
    return Disposable.from(switched, {
      dispose: () => clientChange?.dispose(),
    });
  };
}

export type FusionClientPoolDependencies = FusionLaunchSources & {
  resolver?: FusionExecutableResolver;
  factory?: FusionClientFactory;
};

export function createFusionClientPool(
  registry: ProjectRegistry,
  terminal: Log,
  deps: FusionClientPoolDependencies,
): FusionClientPoolImpl {
  const resolver = deps.resolver ?? new ConfiguredFusionExecutableResolver();
  const factory = deps.factory ?? new DefaultFusionClientFactory();
  return new FusionClientPoolImpl(registry, terminal, resolver, factory, {
    readSnapshot: deps.readSnapshot,
    environments: deps.environments,
    outputChannel: deps.outputChannel,
    launchEnv: deps.launchEnv,
    reportCompileErrors: deps.reportCompileErrors,
  });
}
