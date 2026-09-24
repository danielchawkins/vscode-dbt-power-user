import { DBTTerminal } from "@altimateai/dbt-integration";
import {
  ConfigurationChangeEvent,
  Disposable,
  Event,
  EventEmitter,
  workspace,
} from "vscode";
import {
  ConfiguredFusionExecutableResolver,
  formatFusionExecutableResolutionFailure,
  FusionExecutableResolver,
  isFusionExecutable,
} from "../fusion/fusionExecutable";
import { DeclaredProject, ProjectRegistry } from "../projects/projectRegistry";
import {
  affectsFusionLaunchConfiguration,
  resolveFusionLaunchSettings,
} from "./fusionClientSettings";
import {
  commandPrefixForProject,
  DefaultFusionClientFactory,
  FailedFusionClient,
  FusionClient,
  FusionClientFactory,
  FusionClientOptions,
} from "./fusionLanguageClient";

export interface FusionClientPool extends Disposable {
  /** One client per Declared Project, created and torn down with the registry. */
  get(project: DeclaredProject): FusionClient | undefined;
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
};

export class FusionClientPoolImpl implements FusionClientPool {
  private readonly clients = new Map<string, ManagedClient>();
  private readonly subscriptions: Disposable[] = [];
  private readonly _onDidChangeClients = new EventEmitter<void>();
  private operationChain: Promise<void> = Promise.resolve();
  private stopPromise: Promise<void> | undefined;
  private initialized = false;
  private disposed = false;

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly terminal: DBTTerminal,
    private readonly resolver: FusionExecutableResolver,
    private readonly factory: FusionClientFactory,
  ) {
    this.subscriptions.push(
      this.registry.onDidChangeProjects(() => {
        void this.enqueue(() => this.reconcile());
      }),
      workspace.onDidChangeConfiguration((event) => {
        void this.enqueue(() => this.handleConfigurationChange(event));
      }),
    );
  }

  get onDidChangeClients(): Event<void> {
    return this._onDidChangeClients.event;
  }

  get(project: DeclaredProject): FusionClient | undefined {
    return this.clients.get(projectKey(project))?.client;
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
    event: ConfigurationChangeEvent,
  ): Promise<void> {
    if (!this.initialized || this.disposed) {
      return;
    }

    let changed = false;
    for (const project of this.registry.projects) {
      if (!affectsFusionLaunchConfiguration(event, project.root)) {
        continue;
      }
      const key = projectKey(project);
      if (!this.clients.has(key)) {
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

    const verdict = await this.resolver.resolve(project.root);
    if (this.disposed) {
      return;
    }
    if (this.findDesiredProject(key) !== project) {
      return;
    }

    const launch = resolveFusionLaunchSettings(project.root);
    const client = isFusionExecutable(verdict)
      ? this.factory.create({
          project,
          executable: verdict,
          lintEnabled: launch.lintEnabled,
          commandPrefix: commandPrefixForProject(project),
        } satisfies FusionClientOptions)
      : new FailedFusionClient(
          project,
          formatFusionExecutableResolutionFailure(project.name, verdict),
          this.terminal,
        );

    if (this.disposed || this.findDesiredProject(key) !== project) {
      client.dispose();
      await client.stop();
      return;
    }

    this.clients.set(key, { projectKey: key, project, client });
  }
}

function projectKey(project: DeclaredProject): string {
  return project.root.fsPath;
}

export type FusionClientPoolDependencies = {
  resolver?: FusionExecutableResolver;
  factory?: FusionClientFactory;
};

export function createFusionClientPool(
  registry: ProjectRegistry,
  terminal: DBTTerminal,
  deps: FusionClientPoolDependencies = {},
): FusionClientPoolImpl {
  const resolver = deps.resolver ?? new ConfiguredFusionExecutableResolver();
  const factory = deps.factory ?? new DefaultFusionClientFactory(terminal);
  return new FusionClientPoolImpl(registry, terminal, resolver, factory);
}
