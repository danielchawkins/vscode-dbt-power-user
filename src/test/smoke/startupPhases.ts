import { extHostStartMs } from "./extHostStart";

/** One raw mark from the host's startup report: its name and its absolute start time in epoch milliseconds. */
export interface PerfMark {
  name: string;
  startTime: number;
}

/**
 * Ordered `source:mark` keys for the startup phases. Provisional: the list is fixed to marks that exist on both
 * hosts once the first trace dump has been captured.
 */
export const STARTUP_PHASE_MARKS = [
  "main:code/didStartMain",
  "renderer:code/didStartWorkbench",
  "renderer:code/willLoadExtensions",
  "localExtHost:code/extHost/willConnectToRenderer",
  "localExtHost:code/extHost/didConnectToRenderer",
  "localExtHost:code/extHost/ready",
  "renderer:code/didLoadExtensions",
] as const;

/** Whole milliseconds from the launch to each STARTUP_PHASE_MARKS key, or null when that phase cannot be measured. */
export type StartupPhases = Record<
  (typeof STARTUP_PHASE_MARKS)[number],
  number | null
>;

const RAW_MARKS_HEADING = /^## Raw Perf Marks: (.+)$/;

/**
 * Reads every raw-marks block of the startup report into a list of marks per source. A block's rows are
 * `Name`, `Timestamp`, `Delta` and `Total`, tab-separated; the header row, blank rows and extra columns are skipped.
 */
export function parseRawPerfMarks(
  reportText: string,
): Record<string, PerfMark[]> {
  const marks: Record<string, PerfMark[]> = {};
  let current: PerfMark[] | undefined;
  for (const line of reportText.split("\n")) {
    const heading = RAW_MARKS_HEADING.exec(line.trim());
    if (heading) {
      current = [];
      marks[heading[1].trim()] = current;
      continue;
    }
    if (line.startsWith("## ")) {
      current = undefined;
      continue;
    }
    if (current === undefined) {
      continue;
    }
    const cells = line.split("\t").map((cell) => cell.trim());
    const startTime = Number(cells[1]);
    if (cells[0] && Number.isFinite(startTime)) {
      current.push({ name: cells[0], startTime });
    }
  }
  return marks;
}

/**
 * Whole milliseconds from the launch to each STARTUP_PHASE_MARKS mark, with the same guards as `extHostStartMs`.
 * A missing mark, an unset, blank or malformed epoch, or a mark before the launch gives null for that key.
 */
export function startupPhasesSinceLaunch(
  marks: Record<string, PerfMark[]>,
  launchEpochMs: string | undefined,
): StartupPhases {
  const entries = STARTUP_PHASE_MARKS.map((key) => {
    const separator = key.indexOf(":");
    const source = key.slice(0, separator);
    const name = key.slice(separator + 1);
    const mark = marks[source]?.find((candidate) => candidate.name === name);
    const sinceLaunch =
      mark === undefined
        ? undefined
        : extHostStartMs(launchEpochMs, mark.startTime);
    return [key, sinceLaunch ?? null];
  });
  return Object.fromEntries(entries) as StartupPhases;
}
