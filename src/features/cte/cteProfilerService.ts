import { readFileSync } from "fs";
import {
  CancellationTokenSource,
  Disposable,
  Event,
  EventEmitter,
  Uri,
  window,
} from "vscode";
import { countSql, type FusionCte } from "../../core/cte/ctePreview";
import type { Log } from "../../core/log";
import { Projects } from "../../projects/projects";
import { CteProfileEntry, CteProfileResult } from "./cteProfilerTypes";

/** Reads a compiled file once per profiling run, so every CTE is sliced from the same version. */
function readOnce(files: Map<string, Buffer>, filePath: string): Buffer {
  let bytes = files.get(filePath);
  if (!bytes) {
    bytes = readFileSync(filePath);
    files.set(filePath, bytes);
  }
  return bytes;
}

export class CteProfilerService implements Disposable {
  private results: Map<string, CteProfileResult> = new Map();
  private cancellationTokenSource: CancellationTokenSource | undefined;

  private _onResultChanged = new EventEmitter<CteProfileResult | undefined>();
  readonly onResultChanged: Event<CteProfileResult | undefined> =
    this._onResultChanged.event;

  private disposables: Disposable[] = [this._onResultChanged];

  /** The log of the Project being profiled. */
  private runningLog: Log | undefined;

  constructor(private projects: Projects) {}

  dispose() {
    this.cancellationTokenSource?.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  getResult(uri: string): CteProfileResult | undefined {
    return this.results.get(uri);
  }

  get isRunning(): boolean {
    return this.cancellationTokenSource !== undefined;
  }

  async profileModel(uri: Uri, ctes: FusionCte[]): Promise<void> {
    if (this.cancellationTokenSource) {
      window.showWarningMessage(
        "A CTE profiling run is already in progress. Cancel it first.",
      );
      return;
    }

    if (ctes.length === 0) {
      window.showInformationMessage("No CTEs found in this model to profile.");
      return;
    }

    const project = this.projects.get(uri);
    if (!project) {
      window.showErrorMessage("Could not find dbt project for this file.");
      return;
    }

    const { log } = project;
    this.runningLog = log;
    const modelName = this.extractModelName(uri);
    this.cancellationTokenSource = new CancellationTokenSource();
    const token = this.cancellationTokenSource.token;

    const result: CteProfileResult = {
      uri: uri.toString(),
      modelName,
      status: "running",
      totalTimeMs: 0,
      totalRows: 0,
      totalCount: ctes.length,
      ctes: [],
      timestamp: Date.now(),
    };

    this.results.set(uri.toString(), result);
    this._onResultChanged.fire(result);

    log.debug(
      "CteProfiler",
      `Starting profiling for ${modelName} with ${ctes.length} CTEs`,
    );

    try {
      const cteEntries: CteProfileEntry[] = [];
      let previousCumulativeTime = 0;
      // One read per file, so every CTE of the run is sliced from the same version.
      const compiledFiles = new Map<string, Buffer>();

      for (const [i, targetCte] of ctes.entries()) {
        // Cancellation is intentionally checked between CTEs only — we cannot
        // abort a query that's already in flight inside
        // `immediatelyExecuteSQLWithLimit()`, which is a shared helper without
        // a `CancellationToken`. Mid-query abort is tracked as a follow-up
        // once that helper grows cancellation support across Fusion CLI paths.
        if (token.isCancellationRequested) {
          log.debug(
            "CteProfiler",
            `Profiling cancelled at CTE ${i}/${ctes.length}`,
          );
          result.status = "partial";
          break;
        }

        const query = countSql(
          readOnce(compiledFiles, targetCte.compiledPath),
          targetCte,
        );

        log.debug(
          "CteProfiler",
          `Profiling CTE ${i + 1}/${ctes.length}: ${targetCte.name}`,
        );

        const start = Date.now();
        const queryResult = await project.immediatelyExecuteSQLWithLimit(
          query,
          `cte_profiler_${targetCte.name}`,
          1,
        );
        const elapsed = Date.now() - start;

        const rowCount = this.extractRowCount(queryResult.data);
        const marginalTime = Math.max(0, elapsed - previousCumulativeTime);
        previousCumulativeTime = elapsed;

        cteEntries.push({
          name: targetCte.name,
          line: targetCte.line,
          queryTimeMs: elapsed,
          marginalTimeMs: marginalTime,
          rowCount,
          tier: "cool", // classified after all CTEs complete
        });

        log.debug(
          "CteProfiler",
          `CTE ${targetCte.name}: ${elapsed}ms cumulative, ${marginalTime}ms marginal, ${rowCount} rows`,
        );

        // Update result with partial data so decorations refresh live
        result.ctes = this.classifyTiers(cteEntries);
        result.totalTimeMs = elapsed;
        result.totalRows = rowCount;
        this._onResultChanged.fire(result);
      }

      // Final classification and status
      result.ctes = this.classifyTiers(cteEntries);
      if (result.status === "running") {
        result.status = "complete";
      }
      result.totalTimeMs =
        cteEntries.length > 0
          ? cteEntries[cteEntries.length - 1].queryTimeMs
          : 0;
      result.totalRows =
        cteEntries.length > 0 ? cteEntries[cteEntries.length - 1].rowCount : 0;

      this.results.set(uri.toString(), result);
      this._onResultChanged.fire(result);

      log.debug(
        "CteProfiler",
        `Profiling ${result.status}: ${result.totalTimeMs}ms total, ${result.ctes.length} CTEs`,
      );
    } catch (error) {
      log.error("CteProfiler", "Profiling failed", error);
      result.status = "error";
      result.error = error instanceof Error ? error.message : "Unknown error";
      this.results.set(uri.toString(), result);
      this._onResultChanged.fire(result);
      window.showErrorMessage(`CTE profiling failed: ${result.error}`);
    } finally {
      this.cancellationTokenSource?.dispose();
      this.cancellationTokenSource = undefined;
      this.runningLog = undefined;
    }
  }

  cancel(): void {
    if (this.cancellationTokenSource) {
      this.cancellationTokenSource.cancel();
      this.runningLog?.debug("CteProfiler", "Cancellation requested");
    }
  }

  clearResults(): void {
    this.results.clear();
    this._onResultChanged.fire(undefined);
  }

  private extractRowCount(data: Record<string, unknown>[]): number {
    if (data.length === 0) {
      return 0;
    }
    // Read the single COUNT(*) value by position rather than by name. The
    // profiler builds the query itself and aliases the result, but adapters
    // fold the alias according to their dialect's identifier rules — Snowflake
    // and Oracle uppercase unquoted aliases, so a lowercase key lookup
    // misses the row and the profiler reports 0 for every CTE.
    const count = Object.values(data[0])[0];
    return typeof count === "number" ? count : Number(count) || 0;
  }

  private classifyTiers(entries: CteProfileEntry[]): CteProfileEntry[] {
    if (entries.length === 0) {
      return entries;
    }

    const maxMarginal = Math.max(...entries.map((e) => e.marginalTimeMs));
    if (maxMarginal === 0) {
      return entries.map((e) => ({ ...e, tier: "cool" as const }));
    }

    return entries.map((e) => {
      const fraction = e.marginalTimeMs / maxMarginal;
      let tier: "hot" | "warm" | "cool";
      if (fraction >= 0.5) {
        tier = "hot";
      } else if (fraction >= 0.2) {
        tier = "warm";
      } else {
        tier = "cool";
      }
      return { ...e, tier };
    });
  }

  private extractModelName(uri: Uri): string {
    const path = uri.fsPath;
    const parts = path.split(/[/\\]/);
    const fileName = parts[parts.length - 1];
    return fileName.replace(/\.sql$/i, "");
  }
}
