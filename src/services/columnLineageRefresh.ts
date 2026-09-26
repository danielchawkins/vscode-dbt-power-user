import { CommandProcessResult } from "../dbt_integration/commandProcessExecution";
import { LineageRead } from "../fusion/columnLineage";
import { classifyCompile, CompileOutcome } from "../fusion/lineageDiagnostics";
import { SCHEMA_ORIGIN_ENV, SchemaOriginStatus } from "../fusion/schemaOrigin";
import { StaticAnalysisMode } from "../fusion/staticAnalysisMode";

/** The slice of DBTProject a refresh needs. */
export interface RefreshableProject {
  readonly projectRoot: { fsPath: string };
  compileColumnLineage(
    selectors: readonly string[],
    env: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<CommandProcessResult>;
  schemaOriginStatus(): SchemaOriginStatus;
  /**
   * Unique IDs of the named models that the manifest lists with at least one column; only those are expected
   * to have lineage after a strict compile.
   */
  modelsWithColumns(models: readonly string[]): string[];
  readColumnLineage(
    uniqueIds: readonly string[],
    direction: "upstream" | "downstream",
    signal?: AbortSignal,
  ): Promise<LineageRead>;
}

export type RefreshOutcome =
  | {
      kind: "completed";
      selectors: readonly string[];
      result: CommandProcessResult;
      compile: CompileOutcome;
    }
  | { kind: "aborted" }
  | { kind: "failed"; message: string };

export interface RefreshListener {
  onStart(project: RefreshableProject, selectors: readonly string[]): void;
  onEnd(project: RefreshableProject, outcome: RefreshOutcome): void;
}

export const SAVE_DEBOUNCE_MS = 1_000;

/**
 * Keeps column lineage current. Per Declared Project there is at most one compile in flight; a newer request
 * aborts the older one. Saves are debounced and coalesce into one run for every model saved in the window.
 */
export class ColumnLineageRefresh {
  private readonly inFlight = new Map<string, AbortController>();
  private readonly pendingSaves = new Map<
    string,
    {
      project: RefreshableProject;
      models: Set<string>;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly listener?: RefreshListener,
    private readonly setTimer: typeof setTimeout = setTimeout,
    private readonly clearTimer: typeof clearTimeout = clearTimeout,
  ) {}

  /**
   * Recomputes one model and its ancestors. Always `+<model>`: a bare `<model>` with an unbuilt parent
   * `DESCRIBE`s that parent and turns analysis off (evidence README sections 4 and 7).
   */
  refreshModel(
    project: RefreshableProject,
    models: readonly string[],
  ): Promise<RefreshOutcome> {
    return this.run(
      project,
      models.map((model) => `+${model}`),
    );
  }

  /** Recomputes the whole project. */
  refreshProject(project: RefreshableProject): Promise<RefreshOutcome> {
    return this.run(project, []);
  }

  /**
   * On save of a model file. Runs only when the configured mode leaves strict possible and the project is
   * warehouse-free; otherwise a save would query the warehouse, so the panel offers the button instead.
   */
  onModelSaved(
    project: RefreshableProject,
    model: string,
    mode: StaticAnalysisMode,
  ): boolean {
    if (mode === "baseline" || mode === "off") {
      return false;
    }
    if (project.schemaOriginStatus().kind !== "local") {
      return false;
    }
    const key = project.projectRoot.fsPath;
    const pending = this.pendingSaves.get(key);
    if (pending) {
      this.clearTimer(pending.timer);
      pending.models.add(model);
    }
    const models = pending?.models ?? new Set([model]);
    const timer = this.setTimer(() => {
      this.pendingSaves.delete(key);
      void this.refreshModel(project, [...models].sort());
    }, SAVE_DEBOUNCE_MS);
    this.pendingSaves.set(key, { project, models, timer });
    return true;
  }

  dispose(): void {
    for (const { timer } of this.pendingSaves.values()) {
      this.clearTimer(timer);
    }
    this.pendingSaves.clear();
    for (const controller of this.inFlight.values()) {
      controller.abort();
    }
    this.inFlight.clear();
  }

  private async run(
    project: RefreshableProject,
    selectors: readonly string[],
  ): Promise<RefreshOutcome> {
    const key = project.projectRoot.fsPath;
    this.inFlight.get(key)?.abort();
    const controller = new AbortController();
    this.inFlight.set(key, controller);
    // Only a project known to be warehouse-free gets local origin; otherwise the hook's default applies.
    const env: Record<string, string> =
      project.schemaOriginStatus().kind === "local"
        ? { [SCHEMA_ORIGIN_ENV]: "local" }
        : {};
    this.listener?.onStart(project, selectors);
    let outcome: RefreshOutcome;
    try {
      const result = await project.compileColumnLineage(
        selectors,
        env,
        controller.signal,
      );
      outcome = controller.signal.aborted
        ? { kind: "aborted" }
        : {
            kind: "completed",
            selectors,
            result,
            compile: await this.classify(
              project,
              selectors,
              result,
              controller.signal,
            ),
          };
    } catch (error) {
      outcome = controller.signal.aborted
        ? { kind: "aborted" }
        : {
            kind: "failed",
            message: error instanceof Error ? error.message : String(error),
          };
    } finally {
      if (this.inFlight.get(key) === controller) {
        this.inFlight.delete(key);
      }
    }
    this.listener?.onEnd(project, outcome);
    return outcome;
  }

  /**
   * `[]` from the view is ambiguous (evidence README section 5), so after an exit-0 model compile that the
   * output calls analysed, an empty read for models the manifest shows with columns means strict did not
   * take effect.
   */
  private async classify(
    project: RefreshableProject,
    selectors: readonly string[],
    result: CommandProcessResult,
    signal: AbortSignal,
  ): Promise<CompileOutcome> {
    const compile = classifyCompile(
      result.exitCode,
      result.stdout,
      result.stderr,
    );
    if (compile.kind !== "analyzed" || selectors.length === 0) {
      return compile;
    }
    const expected = project.modelsWithColumns(
      selectors.map((selector) => selector.replace(/^\+/, "")),
    );
    if (expected.length === 0) {
      return compile;
    }
    const read = await project.readColumnLineage(expected, "upstream", signal);
    return read.kind === "empty"
      ? { kind: "strictUnavailable", signal: "emptyAfterStrict" }
      : compile;
  }
}
