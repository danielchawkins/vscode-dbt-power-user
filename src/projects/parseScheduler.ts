import type { Disposable } from "vscode";
import type { Log } from "../core/log";
import type { ParseDemand } from "./parseDemand";

/** What a `ParseScheduler` runs and reads from its project. */
export interface ParseSchedulerDeps {
  log: Log;
  root: string;
  /** Builds the manifest once with the committed CLI. */
  rebuildOnce(): Promise<void>;
  /** Refreshes the project configuration after `dbt_project.yml` changed. */
  refreshConfig(): Promise<void>;
  onSourceChanged(): void;
  isDisposed(): boolean;
  /** Views reading parse-owned fields; without it every source change rebuilds. */
  demand?: ParseDemand | undefined;
}

/** Decides when a project rebuilds its manifest: one parse at a time, deferred while no view needs the result. */
export class ParseScheduler implements Disposable {
  /** A source file changed since the last parse and no consumer was showing to need it. */
  private stale = false;
  /** Counts source-file changes; a parse records the count it started at. */
  private generation = 0;
  private startedAtGeneration = 0;
  private rebuilding: Promise<void> | undefined;
  private rebuildAgain = false;
  private readonly subscription: Disposable | undefined;

  constructor(private readonly deps: ParseSchedulerDeps) {
    this.subscription = deps.demand?.onDidBecomeActive(() => {
      if (this.stale) {
        void this.rebuild();
      }
    });
  }

  /** Records that a parse starts now, against the current source files. */
  markParseStarted(): void {
    this.startedAtGeneration = this.generation;
  }

  /** Marks the parse current, unless a source file changed after the parse read the files. */
  markParsed(): void {
    if (this.startedAtGeneration === this.generation) {
      this.stale = false;
    }
  }

  rebuild(): Promise<void> {
    if (this.rebuilding) {
      this.rebuildAgain = true;
      return this.rebuilding;
    }
    this.rebuilding = this.rebuildLoop().finally(() => {
      this.rebuilding = undefined;
    });
    return this.rebuilding;
  }

  /** Runs one parse at a time, and one more for every request made while a parse ran. */
  private async rebuildLoop(): Promise<void> {
    do {
      this.rebuildAgain = false;
      this.markParseStarted();
      this.deps.log.debug(
        "Project",
        `Going to rebuild the manifest for project at ${this.deps.root}`,
      );
      await this.deps.rebuildOnce();
    } while (this.rebuildAgain && !this.deps.isDisposed());
  }

  async projectFileChanged(): Promise<void> {
    this.generation += 1;
    this.deps.onSourceChanged();
    await this.deps.refreshConfig();
    await this.rebuild();
  }

  async sourceFileChanged(): Promise<void> {
    this.generation += 1;
    this.deps.onSourceChanged();
    if (this.deps.demand && !this.deps.demand.active) {
      this.stale = true;
      return;
    }
    await this.rebuild();
  }

  /** Rebuilds a stale parse; resolves once the manifest is current. */
  async ensureParsed(): Promise<void> {
    if (this.stale && !this.deps.isDisposed()) {
      await this.rebuild();
    }
  }

  dispose(): void {
    this.subscription?.dispose();
  }
}
