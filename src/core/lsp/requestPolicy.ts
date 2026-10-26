/** What a Fusion request is for. The purpose picks its RequestPolicy; a call site passes a purpose, never a number. */
export type RequestPurpose =
  | "columnLineage"
  | "graph"
  | "columns"
  | "compiledSql"
  | "projectInfo"
  | "format";

/** How a request is scheduled and bounded. Every purpose has a ceiling, so no request waits without a bound. */
export interface RequestPolicy {
  /** Starts the message of a ceiling timeout, e.g. "Column lineage did not answer within 5 min". */
  readonly label: string;
  readonly priority: "interactive" | "background";
  readonly whenNotRunning: "fail" | "waitForRunning";
  /** The longest a request may wait for the server's answer, in milliseconds. */
  readonly ceilingMs: number;
  /** How many times a superseded request (the server's `Operation cancelled` answer) is sent again. */
  readonly serverCancelRetries: 0 | 1;
}

export const REQUEST_POLICIES: Readonly<Record<RequestPurpose, RequestPolicy>> =
  {
    /** Measured at about 11 s per target on a 995-model project, and about 21 s when superseded. */
    columnLineage: {
      label: "Column lineage",
      priority: "interactive",
      whenNotRunning: "waitForRunning",
      ceilingMs: 5 * 60_000,
      serverCancelRetries: 1,
    },
    /** A single-node lookup; the ceiling only bounds a server that has stopped answering. */
    columns: {
      label: "Column lookup",
      priority: "interactive",
      whenNotRunning: "waitForRunning",
      ceilingMs: 2 * 60_000,
      serverCancelRetries: 0,
    },
    /** An incremental compile of 0.1 to 2.3 s on a 995-model project; the ceiling only bounds a stuck server. */
    compiledSql: {
      label: "Compiled SQL",
      priority: "interactive",
      whenNotRunning: "waitForRunning",
      ceilingMs: 2 * 60_000,
      serverCancelRetries: 0,
    },
    /** Background package graph; nothing waits on it in the foreground, so the ceiling only bounds a stuck server. */
    graph: {
      label: "Package graph",
      priority: "background",
      whenNotRunning: "fail",
      ceilingMs: 2 * 60_000,
      serverCancelRetries: 0,
    },
    /** Background project info; nothing waits on it in the foreground, so the ceiling only bounds a stuck server. */
    projectInfo: {
      label: "Project info",
      priority: "background",
      whenNotRunning: "fail",
      ceilingMs: 2 * 60_000,
      serverCancelRetries: 0,
    },
    /** Format-on-save blocks the save, so a format waits at most this long. */
    format: {
      label: "Format",
      priority: "interactive",
      whenNotRunning: "fail",
      ceilingMs: 5_000,
      serverCancelRetries: 0,
    },
  };

/** The timeout message for a purpose: its label and its ceiling in minutes or seconds, never the command name. */
export function ceilingMessage(purpose: RequestPurpose): string {
  const { label, ceilingMs } = REQUEST_POLICIES[purpose];
  const ceiling =
    ceilingMs % 60_000 === 0
      ? `${ceilingMs / 60_000} min`
      : `${ceilingMs / 1_000} s`;
  return `${label} did not answer within ${ceiling}`;
}
