import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  DBTTerminal,
  RUN_RESULTS_FILE,
  type RunResultsEventData,
} from "../dbt_integration";

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

/** Converts parsed run_results.json into a run history entry; throws when required fields are missing. */
export function parseRunResultsJson(
  raw: unknown,
  projectName: string,
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
  const args = normalizeStringOrArray(data.args.select);
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
    command: formatRunCommand(data.args as RunArgs),
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
    private readonly terminal: DBTTerminal,
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
  readIfChanged(before: RunResultsObservation): RunResultsEventData | null {
    const after = this.observe();
    if (after === null) {
      this.terminal.trace("Run results file does not exist after command");
      return null;
    }
    if (after === before) {
      this.terminal.trace("Ignoring unchanged run_results.json after command");
      return null;
    }
    try {
      const event = parseRunResultsJson(JSON.parse(after), this.projectName());
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

/** Runs `run`, then records any run_results.json it wrote. A rejected run records nothing. */
export async function withRunResults<T>(
  reader: RunResultsReader,
  history: RunResultsHistory,
  run: () => Promise<T>,
): Promise<T> {
  const before = reader.observe();
  const result = await run();
  const entry = reader.readIfChanged(before);
  if (entry) {
    history.addEntry(entry);
  }
  return result;
}
