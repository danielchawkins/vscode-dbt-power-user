import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Log } from "../core/log";
import { RUN_RESULTS_FILE, type RunResultsEventData } from "../dbt_integration";

/** Snapshot of run_results.json content before a command; null when absent. */
export type RunResultsObservation = string | null;

/** Receives each run a command produced. */
export interface RunResultsHistory {
  addEntry(entry: RunResultsEventData): unknown;
}

interface RawRunResults {
  metadata?: { invocation_id?: string; generated_at?: string };
  args?: {
    which?: string;
    select?: string | string[];
    exclude?: string | string[];
    selector?: string | string[];
    full_refresh?: boolean;
    defer?: boolean;
    state?: string;
    target?: string;
  };
  results?: Array<{
    unique_id: string;
    status: string;
    execution_time?: number | null;
    message?: string;
  }>;
  elapsed_time?: number;
}

function normalizeStringOrArray(
  value: string | string[] | undefined,
): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

type RunArgs = NonNullable<RawRunResults["args"]> & { which: string };

/** The subcommand, selection lists, and full-refresh flag in a dbt CLI argv. */
interface CliSelection {
  which: string;
  select: string[];
  exclude: string[];
  selector: string[];
  fullRefresh: boolean;
}

const SELECTION_FLAGS = {
  "--select": "select",
  "-s": "select",
  "--exclude": "exclude",
  "--selector": "selector",
} as const;

type SelectionFlag = keyof typeof SELECTION_FLAGS;

const isSelectionFlag = (flag: string): flag is SelectionFlag =>
  flag in SELECTION_FLAGS;

/**
 * Reads the subcommand, `--select`/`--exclude`/`--selector` lists, and `--full-refresh` from dbt CLI args.
 * @internal
 */
export function selectionFromCliArgs(args: readonly string[]): CliSelection {
  const selection: CliSelection = {
    which: args[0] !== undefined && !args[0].startsWith("-") ? args[0] : "",
    select: [],
    exclude: [],
    selector: [],
    fullRefresh: false,
  };
  let list: string[] | undefined;
  for (const arg of args) {
    if (!arg.startsWith("-")) {
      list?.push(arg);
      continue;
    }
    list = undefined;
    const [flag, inline] = arg.split(/=(.*)/s, 2);
    if (flag === "--full-refresh") {
      selection.fullRefresh = true;
    } else if (isSelectionFlag(flag)) {
      list = selection[SELECTION_FLAGS[flag]];
      if (inline !== undefined) {
        list.push(inline);
        list = undefined;
      }
    }
  }
  return selection;
}

function fillSelection(
  runArgs: RunArgs,
  launched: readonly string[] | undefined,
): RunArgs {
  const selected = [runArgs.select, runArgs.exclude, runArgs.selector].some(
    (value) => normalizeStringOrArray(value).length > 0,
  );
  if (selected || !launched) {
    return runArgs;
  }
  const cli = selectionFromCliArgs(launched);
  return {
    ...runArgs,
    select: cli.select,
    exclude: cli.exclude,
    selector: cli.selector,
    // Fusion records `full_refresh: false` even for a `--full-refresh` launch.
    full_refresh: runArgs.full_refresh === true || cli.fullRefresh,
  };
}

function formatRunCommand(runArgs: RunArgs): string {
  const parts = [`dbt ${runArgs.which}`];
  const lists = [
    ["--select", runArgs.select],
    ["--exclude", runArgs.exclude],
    ["--selector", runArgs.selector],
  ] as const;
  for (const [flag, value] of lists) {
    const items = normalizeStringOrArray(value);
    if (items.length > 0) {
      parts.push(`${flag} ${items.join(" ")}`);
    }
  }
  if (runArgs.full_refresh === true) {
    parts.push("--full-refresh");
  }
  if (runArgs.defer === true) {
    parts.push("--defer");
  }
  if (runArgs.state) {
    parts.push(`--state ${runArgs.state}`);
  }
  if (runArgs.target) {
    parts.push(`--target ${runArgs.target}`);
  }
  return parts.join(" ");
}

/** @internal */
export function resolveRunStatus(
  status: string,
): RunResultsEventData["results"][0]["status"] {
  switch (status) {
    case "success":
    case "pass":
      return "success";
    case "error":
    case "fail":
      return "error";
    case "warn":
      return "warn";
    default:
      return "skipped";
  }
}

/**
 * Builds a history entry from run_results.json, selection falling back to `launched`; throws on missing fields.
 * @internal
 */
export function parseRunResultsJson(
  raw: unknown,
  projectName: string,
  launched?: readonly string[],
): RunResultsEventData {
  const data = raw as RawRunResults;
  if (
    !data.metadata?.invocation_id ||
    !data.metadata?.generated_at ||
    !data.args?.which
  ) {
    throw new Error(
      "Malformed run_results.json: missing required fields (metadata.invocation_id, metadata.generated_at, or args.which)",
    );
  }
  const runArgs = fillSelection(data.args as RunArgs, launched);
  const args = normalizeStringOrArray(runArgs.select);
  const results = Array.isArray(data.results)
    ? data.results.map((entry) => ({
        name: entry.unique_id.split(".").pop() ?? entry.unique_id,
        uniqueId: entry.unique_id,
        status: resolveRunStatus(entry.status),
        executionTime: entry.execution_time ?? null,
        message: entry.message,
        resourceType: entry.unique_id.split(
          ".",
        )[0] as RunResultsEventData["results"][0]["resourceType"],
      }))
    : [];
  return {
    id: data.metadata.invocation_id,
    command: formatRunCommand(runArgs),
    args,
    completedAt: new Date(data.metadata.generated_at),
    projectName,
    results,
    elapsedTime: data.elapsed_time ?? 0,
  };
}

/** Reads the run_results.json a command wrote under the current target path. */
export class RunResultsReader {
  constructor(
    private readonly targetPath: () => string | undefined,
    private readonly projectName: () => string,
    private readonly terminal: Log,
  ) {}

  observe(): RunResultsObservation {
    const targetPath = this.targetPath();
    if (!targetPath) {
      return null;
    }
    const runResultsPath = join(targetPath, RUN_RESULTS_FILE);
    if (!existsSync(runResultsPath)) {
      return null;
    }
    try {
      const raw = readFileSync(runResultsPath, "utf8");
      return raw || null;
    } catch {
      return null;
    }
  }

  /** The run recorded since `before`; null when the file is absent, unchanged or malformed. */
  readIfChanged(
    before: RunResultsObservation,
    launched?: readonly string[],
  ): RunResultsEventData | null {
    const after = this.observe();
    if (after === null) {
      this.terminal.debug(
        "runResults",
        "Run results file does not exist after command",
      );
      return null;
    }
    if (after === before) {
      this.terminal.debug(
        "runResults",
        "Ignoring unchanged run_results.json after command",
      );
      return null;
    }
    try {
      const event = parseRunResultsJson(
        JSON.parse(after),
        this.projectName(),
        launched,
      );
      this.terminal.debug(
        "runResultsParsed",
        "Run results successfully parsed",
        event,
      );
      return event;
    } catch (error) {
      this.terminal.error(
        "RunResultsReader",
        `Unable to parse run_results.json: ${(error as Error).message}`,
        error,
      );
      return null;
    }
  }
}

/** Runs `run`, then records any run_results.json it wrote, using `launched` args as the fallback selection. */
export async function withRunResults<T>(
  reader: RunResultsReader,
  history: RunResultsHistory,
  run: () => Promise<T>,
  launched?: readonly string[],
): Promise<T> {
  const before = reader.observe();
  const result = await run();
  const entry = reader.readIfChanged(before, launched);
  if (entry) {
    history.addEntry(entry);
  }
  return result;
}
