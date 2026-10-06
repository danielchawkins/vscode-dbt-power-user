import type { Log } from "../core/log";
import type { ManifestProject } from "../core/manifest";
import type { ParsedManifest } from "../dbt_integration/domain";
import type { ExecutableLifecycle } from "../fusion/executableLifecycle";
import type { FusionCli } from "../fusion/fusionCli";
import { buildManifest, type ManifestParsers } from "./manifest";

/** Hooks through which a `ManifestRebuild` reports progress to its project. */
export interface ManifestRebuildCallbacks {
  /** Refreshes project config against a candidate before its manifest is built. */
  refreshConfig(candidate: FusionCli): Promise<void>;
  onStatus(inProgress: boolean): void;
  onParsed(parsed: ParsedManifest): void;
}

/** Rebuilds and parses a project's manifest for the committed executable or an activation candidate. */
export class ManifestRebuild {
  /** A candidate being parsed before commit; parsers read project paths through it. */
  private parsingCandidate: FusionCli | undefined;
  private readonly readFailures = { count: 0 };
  private _adapterType = "unknown";

  constructor(
    private readonly lifecycle: ExecutableLifecycle,
    private readonly parsers: ManifestParsers,
    private readonly project: ManifestProject,
    private readonly terminal: Log,
    private readonly callbacks: ManifestRebuildCallbacks,
  ) {}

  /** The last `metadata.adapter_type` a manifest carried; `"unknown"` until one has. */
  get adapterType(): string {
    return this._adapterType;
  }

  /** The candidate currently being parsed, if any. */
  candidate(): FusionCli | undefined {
    return this.parsingCandidate;
  }

  /** Refreshes config and builds the manifest for a candidate; the returned step publishes it. */
  async prepareCandidate(
    candidate: FusionCli,
    generation: number,
  ): Promise<(() => void) | undefined> {
    await this.callbacks.refreshConfig(candidate);
    if (!this.lifecycle.isCurrent(generation)) {
      return undefined;
    }
    let parsed: ParsedManifest | undefined;
    await this.runManifestRebuild(candidate, generation, async () => {
      parsed = await this.buildParsedManifest(candidate, generation);
    });
    const result = parsed;
    return result ? () => this.callbacks.onParsed(result) : undefined;
  }

  /** Rebuilds the manifest with `delegate` and publishes the parse if still current. */
  async rebuild(delegate: FusionCli): Promise<void> {
    const generation = this.lifecycle.generation;
    await this.runManifestRebuild(delegate, generation, async () => {
      const parsed = await this.buildParsedManifest(delegate, generation);
      if (parsed) {
        this.callbacks.onParsed(parsed);
      }
    });
  }

  /** Parses the existing manifest with `delegate`, publishing it if still current. */
  async parse(delegate: FusionCli): Promise<ParsedManifest | undefined> {
    const generation = this.lifecycle.generation;
    const parsed = await this.buildParsedManifest(delegate, generation);
    if (parsed && this.lifecycle.isCurrent(generation)) {
      this.callbacks.onParsed(parsed);
    }
    return parsed;
  }

  private async runManifestRebuild(
    delegate: FusionCli,
    generation: number,
    afterRebuild: () => Promise<void>,
  ): Promise<void> {
    this.callbacks.onStatus(true);
    try {
      await delegate.rebuildManifest();
      if (!this.lifecycle.isCurrent(generation)) {
        return;
      }
      this.terminal.debug(
        "Project",
        `Finished rebuilding the manifest for project at ${this.project.getProjectRoot()}`,
      );
      await afterRebuild();
    } catch (error) {
      if (this.lifecycle.isCurrent(generation)) {
        this.terminal.error("Project", "Error rebuilding manifest", error);
        throw error;
      }
    } finally {
      this.callbacks.onStatus(false);
    }
  }

  private async buildParsedManifest(
    delegate: FusionCli,
    generation: number,
  ): Promise<ParsedManifest | undefined> {
    const targetPath = delegate.getTargetPath();
    if (!targetPath) {
      this.terminal.debug(
        "Project",
        "targetPath should be defined at this stage for project " +
          this.project.getProjectRoot(),
      );
      return;
    }
    const previous = this.parsingCandidate;
    const isCandidate = delegate !== this.lifecycle.current();
    if (isCandidate) {
      this.parsingCandidate = delegate;
    }
    try {
      const built = await buildManifest(
        this.parsers,
        this.project,
        targetPath,
        this.terminal,
        this.readFailures,
      );
      if (!built || !this.lifecycle.isCurrent(generation)) {
        return;
      }
      this._adapterType = built.adapterType ?? this._adapterType;
      return built.parsed;
    } finally {
      if (isCandidate && this.parsingCandidate === delegate) {
        this.parsingCandidate = previous;
      }
    }
  }
}
