import { Disposable, Event, EventEmitter, Uri } from "vscode";
import { type DBTDiagnosticData } from "../core/diagnostics";
import type { Log } from "../core/log";
import { dbtProjectFilePath } from "../core/project";
import { onDidChangeSettings, SettingsChange } from "../settings";
import { FusionCli } from "./fusionCli";
import {
  DBT_PATH_SETTING,
  formatFusionExecutableResolutionFailure,
  FusionExecutable,
  FusionExecutableResolver,
  isFusionExecutable,
  ResolverEnvironment,
} from "./fusionExecutable";
import { FusionVersion } from "./fusionVersion";

export type FusionCommandIntegrationFactory = (
  executable: FusionExecutable,
  projectRoot: string,
) => FusionCli;

export const EXECUTABLE_DIAGNOSTIC_SOURCE = "fusion-executable";
const LOG_SOURCE = "Project";

export interface ExecutableLifecycleHooks {
  /** The project's resolved environment, which the executable is looked up on; the host's when absent. */
  environment?: (() => Promise<ResolverEnvironment>) | undefined;
  /**
   * Prepares `candidate` before commit. Resolves to a step that runs after the commit while
   * `generation` is still current. Returning early when `generation` is stale abandons the candidate.
   */
  activate(
    candidate: FusionCli,
    generation: number,
  ): Promise<(() => void) | undefined>;
  /** Runs before the committed CLI is disposed, on an executable refresh or on dispose. */
  deactivate(): void;
}

/**
 * Resolves one project's Fusion executable, re-resolves when `dbtPath` changes for the project,
 * and commits a `FusionCli` per resolution. Refreshes run one at a time; a refresh or dispose
 * makes every earlier generation stale, and a stale candidate is disposed instead of committed.
 */
export class ExecutableLifecycle {
  private committed: FusionCli | undefined;
  private committedVersion?: FusionVersion;
  private failure: DBTDiagnosticData | undefined;
  private configurationSubscription: Disposable | undefined;
  private refreshChain: Promise<void> = Promise.resolve();
  private refreshGeneration = 0;
  private disposed = false;
  private readonly commitEmitter = new EventEmitter<void>();
  private readonly failureEmitter = new EventEmitter<
    DBTDiagnosticData | undefined
  >();

  /** Fires after a candidate is committed and the previous CLI is disposed. */
  readonly onDidCommit: Event<void> = this.commitEmitter.event;
  /** Fires with the diagnostic when resolution fails, and with `undefined` when a later resolution clears it. */
  readonly onDidFailResolution: Event<DBTDiagnosticData | undefined> =
    this.failureEmitter.event;

  constructor(
    private readonly resolver: FusionExecutableResolver,
    private readonly factory: FusionCommandIntegrationFactory,
    private readonly projectRoot: string,
    private readonly terminal: Log,
    private readonly hooks: ExecutableLifecycleHooks,
  ) {}

  /** The committed CLI, if any. */
  current(): FusionCli | undefined {
    return this.committed;
  }

  /** Version of the most recently committed executable; kept after that CLI is disposed. */
  get version(): FusionVersion | undefined {
    return this.committedVersion;
  }

  get generation(): number {
    return this.refreshGeneration;
  }

  isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.refreshGeneration;
  }

  /** Subscribes to `dbtPath` changes and runs the first resolution. */
  async initialize(): Promise<void> {
    this.startConfigurationWatcher();
    await this.enqueueRefresh(async () => {
      await this.activateFromResolvedExecutable(this.refreshGeneration);
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.refreshGeneration++;
    this.configurationSubscription?.dispose();
    this.configurationSubscription = undefined;
    this.hooks.deactivate();
    await this.disposeCommitted();
    this.commitEmitter.dispose();
    this.failureEmitter.dispose();
  }

  private async activateFromResolvedExecutable(
    generation: number,
  ): Promise<void> {
    const executable = await this.resolveExecutable(generation);
    if (!executable) {
      return;
    }
    await this.activateWithExecutable(executable, generation);
  }

  private async resolveExecutable(
    generation: number,
  ): Promise<FusionExecutable | undefined> {
    let environment: ResolverEnvironment | undefined;
    try {
      environment = await this.hooks.environment?.();
    } catch (error) {
      this.terminal.error(
        LOG_SOURCE,
        `Could not read the project environment, using the host's: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const verdict = await this.resolver.resolve(
      Uri.file(this.projectRoot),
      environment,
    );
    if (generation !== this.refreshGeneration) {
      return undefined;
    }
    if (isFusionExecutable(verdict)) {
      this.clearFailure();
      return verdict;
    }
    const message = formatFusionExecutableResolutionFailure(
      this.projectRoot,
      verdict,
    );
    this.terminal.error(LOG_SOURCE, message);
    this.setFailure(message);
    return undefined;
  }

  private setFailure(message: string): void {
    this.failure = {
      filePath: dbtProjectFilePath(this.projectRoot),
      message,
      severity: "error",
      range: {
        startLine: 0,
        startColumn: 0,
        endLine: 999,
        endColumn: 999,
      },
      source: EXECUTABLE_DIAGNOSTIC_SOURCE,
      category: "project-config",
    };
    this.failureEmitter.fire(this.failure);
  }

  private clearFailure(): void {
    if (!this.failure) {
      return;
    }
    this.failure = undefined;
    this.failureEmitter.fire(undefined);
  }

  private async abandonIfStale(
    generation: number,
    candidate: FusionCli,
  ): Promise<boolean> {
    if (this.isCurrent(generation)) {
      return true;
    }
    candidate.dispose();
    return false;
  }

  private async activateWithExecutable(
    executable: FusionExecutable,
    generation: number,
  ): Promise<void> {
    const candidate = this.factory(executable, this.projectRoot);
    const afterCommit = await this.hooks.activate(candidate, generation);
    if (!(await this.abandonIfStale(generation, candidate))) {
      return;
    }
    await this.commitCandidate(generation, candidate);
    if (this.committed === candidate) {
      this.committedVersion = executable.version;
    }
    if (afterCommit && this.isCurrent(generation)) {
      afterCommit();
    }
  }

  private async commitCandidate(
    generation: number,
    candidate: FusionCli,
  ): Promise<void> {
    if (!(await this.abandonIfStale(generation, candidate))) {
      return;
    }
    const previous = this.committed;
    this.committed = candidate;
    if (previous && previous !== candidate) {
      previous.dispose();
    }
    this.commitEmitter.fire();
  }

  private startConfigurationWatcher(): void {
    if (this.configurationSubscription) {
      return;
    }
    this.configurationSubscription = onDidChangeSettings(
      [DBT_PATH_SETTING],
      (change) => {
        void this.enqueueExecutableRefresh(change).catch(() => undefined);
      },
    );
  }

  private enqueueExecutableRefresh(change: SettingsChange): Promise<void> {
    if (!change.affects(Uri.file(this.projectRoot))) {
      return this.refreshChain;
    }
    if (this.disposed) {
      return Promise.resolve();
    }
    const generation = ++this.refreshGeneration;
    return this.enqueueRefresh(async () => {
      this.hooks.deactivate();
      await this.disposeCommitted();
      await this.activateFromResolvedExecutable(generation);
    });
  }

  private enqueueRefresh(task: () => Promise<void>): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const run = this.refreshChain.then(async () => {
      if (this.disposed) {
        return;
      }
      await task();
    });
    this.refreshChain = run.catch((error: unknown) => {
      this.terminal.error(
        LOG_SOURCE,
        "Fusion executable refresh failed",
        error,
      );
    });
    return run;
  }

  private async disposeCommitted(): Promise<void> {
    const committed = this.committed;
    this.committed = undefined;
    if (!committed) {
      return;
    }
    committed.dispose();
  }
}
