import * as fs from "fs";

/** Environment variable naming the log the integration runner's `dbt` wrapper appends to. */
export const DBT_SPY_LOG_ENV = "FPU_DBT_SPY_LOG";

const POLL_MS = 250;

/**
 * A `dbt` invocation the wrapper logged at its start. `id` pairs it with its exit line; `subcommand` is the first
 * argument.
 */
export interface DbtInvocation {
  id: string;
  subcommand: string;
}

/** One record of the spy log: a start, or the exit that closes the start with the same id. */
export type SpyRecord =
  | { kind: "start"; invocation: DbtInvocation }
  | { kind: "exit"; id: string };

const START_LINE = /^\d+ start (\S+) (.*)$/;
const EXIT_LINE = /^\d+ exit (\S+) \d+$/;

/**
 * Parses one line of the spy log, `<epoch ms> start <id> <subcommand>` or `<epoch ms> exit <id> <code>`. Any other
 * line is undefined, such as a continuation line of an argument that was not flattened onto one line.
 */
export function parseSpyLine(line: string): SpyRecord | undefined {
  const start = START_LINE.exec(line);
  if (start) {
    return {
      kind: "start",
      invocation: { id: start[1], subcommand: start[2] },
    };
  }
  const exit = EXIT_LINE.exec(line);
  return exit ? { kind: "exit", id: exit[1] } : undefined;
}

function spyRecords(): SpyRecord[] {
  const log = process.env[DBT_SPY_LOG_ENV];
  if (!log || !fs.existsSync(log)) {
    return [];
  }
  return fs
    .readFileSync(log, "utf-8")
    .split("\n")
    .flatMap((line) => parseSpyLine(line) ?? []);
}

function startsIn(records: SpyRecord[]): DbtInvocation[] {
  return records.flatMap((record) =>
    record.kind === "start" ? [record.invocation] : [],
  );
}

/** Every `dbt` invocation since the run started, in the order they started; empty when no wrapper is installed. */
export function dbtInvocations(): DbtInvocation[] {
  return startsIn(spyRecords());
}

/** Invocations after the first `since` ones whose subcommand is `command`. */
export function dbtInvocationsSince(
  since: number,
  command: string,
): DbtInvocation[] {
  return dbtInvocations()
    .slice(since)
    .filter((invocation) => invocation.subcommand === command);
}

/**
 * Subcommands that run until the editor stops them. The language server is one, and the runner points `dbtPath` at
 * the wrapper, so its launches reach the log. Waiting on them would wait for the whole session, so they never count
 * as open.
 */
const LONG_RUNNING_SUBCOMMANDS = ["lsp"];

/**
 * The invocations at or after index `since` of `dbtInvocations()` that have no exit line yet, leaving out the
 * long-running subcommands. Each exit names the id of its start, so overlapping invocations never swap exits.
 */
function runningSince(records: SpyRecord[], since: number): DbtInvocation[] {
  const exited = new Set(
    records.flatMap((record) => (record.kind === "exit" ? [record.id] : [])),
  );
  return startsIn(records)
    .slice(since)
    .filter(
      (invocation) =>
        !exited.has(invocation.id) &&
        !LONG_RUNNING_SUBCOMMANDS.includes(invocation.subcommand),
    );
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits until every `dbt` invocation started since `since` (a count from `dbtInvocations()`) has exited, except the
 * long-running subcommands, or until `timeoutMs` passes. Resolves with the invocations still running, so an empty
 * array means all exited.
 */
export async function waitForDbtExits(
  since: number,
  timeoutMs: number,
): Promise<DbtInvocation[]> {
  const deadline = Date.now() + timeoutMs;
  let running = runningSince(spyRecords(), since);
  while (running.length > 0 && Date.now() < deadline) {
    await pause(POLL_MS);
    running = runningSince(spyRecords(), since);
  }
  return running;
}

/**
 * Waits until no `dbt` invocation since `since` is running and the spy log has seen no start or exit for `quietMs`,
 * or until `timeoutMs` passes. Resolves with the invocations still running, so an empty array means the run went
 * quiet. A dbt the editor starts a moment later, such as a rebuild after a debounced file change, is caught here
 * and not by `waitForDbtExits`, which only sees invocations that have already started.
 */
export async function waitForDbtQuiet(
  since: number,
  quietMs: number,
  timeoutMs: number,
): Promise<DbtInvocation[]> {
  const deadline = Date.now() + timeoutMs;
  let records = spyRecords();
  let running = runningSince(records, since);
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (running.length === 0 && Date.now() - quietSince >= quietMs) {
      break;
    }
    await pause(POLL_MS);
    const latest = spyRecords();
    running = runningSince(latest, since);
    if (latest.length !== records.length || running.length > 0) {
      quietSince = Date.now();
    }
    records = latest;
  }
  return running;
}
