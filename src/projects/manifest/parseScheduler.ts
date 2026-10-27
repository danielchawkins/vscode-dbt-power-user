import type { Disposable } from "vscode";
import type { Log } from "../../core/log";
import type { ChangeBurst } from "./manifestTrigger";
import type { MetadataDemand } from "./metadataDemand";
import { ParseFingerprints, type ReadFile } from "./parseFingerprints";

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
  demand?: MetadataDemand | undefined;
  /** Reads a source file's bytes for the identical-rewrite check; defaults to a plain read. */
  readFile?: ReadFile | undefined;
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
  /** Set by a request whose reason the fingerprints did not see; the next parse forgets their records. */
  private unseenRequest = false;
  private readonly subscription: Disposable | undefined;
  private readonly deps: ParseSchedulerDeps;
  private readonly fingerprints: ParseFingerprints;

  constructor(deps: ParseSchedulerDeps) {
    this.deps = deps;
    this.fingerprints = new ParseFingerprints(deps.readFile);
    this.subscription = deps.demand?.onDidBecomeActive(() => {
      if (this.stale) {
        void this.requestRebuild();
      }
    });
  }

  /** Records that a parse starts now for a reason the fingerprints did not see, so they are forgotten. */
  markParseStarted(): void {
    this.fingerprints.forget();
    this.recordStart();
  }

  /** Marks the parse current, unless a source file changed after the parse read the files. */
  markParsed(): void {
    this.fingerprints.commit();
    if (this.startedAtGeneration === this.generation) {
      this.stale = false;
    }
  }

  /** Rebuilds for an explicit request, which the fingerprints do not see. */
  rebuild(): Promise<void> {
    this.unseenRequest = true;
    return this.requestRebuild();
  }

  private requestRebuild(): Promise<void> {
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
      const sourceDriven = !this.unseenRequest;
      this.unseenRequest = false;
      this.recordStart();
      this.deps.log.debug(
        "Project",
        `Going to rebuild the manifest for project at ${this.deps.root}`,
      );
      await this.fingerprints.begin(sourceDriven);
      try {
        // Hashing reads the disk, so the project may have been disposed while it ran.
        if (!this.deps.isDisposed()) {
          await this.deps.rebuildOnce();
        }
      } finally {
        this.fingerprints.finish();
      }
    } while (this.rebuildAgain && !this.deps.isDisposed());
  }

  private recordStart(): void {
    this.startedAtGeneration = this.generation;
  }

  async projectFileChanged(): Promise<void> {
    this.generation += 1;
    this.deps.onSourceChanged();
    await this.deps.refreshConfig();
    await this.rebuild();
  }

  async sourceFileChanged(change: ChangeBurst): Promise<void> {
    this.generation += 1;
    this.deps.onSourceChanged();
    const unchanged = await this.fingerprints.unchanged(change);
    // A parse that started while the hashes were read may not have seen this burst, so the burst parses.
    if (unchanged && !this.rebuilding) {
      this.deps.log.debug(
        "Project",
        `Skipped the manifest rebuild: ${change.paths.length} file(s) rewritten with identical content`,
      );
      return;
    }
    this.fingerprints.report(change.paths);
    if (this.deps.demand && !this.deps.demand.active) {
      this.stale = true;
      return;
    }
    await this.requestRebuild();
  }

  /** Rebuilds a stale parse; resolves once the manifest is current. */
  async ensureParsed(): Promise<void> {
    if (this.stale && !this.deps.isDisposed()) {
      await this.requestRebuild();
    }
  }

  dispose(): void {
    this.subscription?.dispose();
  }
}
