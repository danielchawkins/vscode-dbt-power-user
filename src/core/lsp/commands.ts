import type { CurrentNodeResult, ListNodesResult } from "../lineage";

export type { CurrentNodeResult, ListNodesResult };

/** Deadline for `compileFile`, `getCurrentNode` and `listNodes`; the server answers them in under 100 ms. */
export const COMMAND_DEADLINE_MS = 5_000;

export type FusionCommandErrorKind =
  "notRunning" | "cancelled" | "timeout" | "server";

/** How a server command failed; `message` is the server's text for `server`. */
export class FusionCommandError extends Error {
  constructor(
    readonly kind: FusionCommandErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "FusionCommandError";
  }
}

export interface CompileFileResult {
  /** The compiled file the server wrote, as it returned it. */
  fileUri: string;
}

export interface ProjectInfo {
  adapterType: string | undefined;
  projectName: string | undefined;
}

/** LSP `RequestCancelled` and `ServerCancelled`. */
const CANCELLED_CODES = new Set([-32800, -32802]);

/** Maps a transport failure to a command error; an existing command error passes through. */
export function toCommandError(error: unknown): FusionCommandError {
  if (error instanceof FusionCommandError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | undefined)?.code;
  const cancelled =
    (typeof code === "number" && CANCELLED_CODES.has(code)) ||
    /\bcancell?ed\b/i.test(message);
  return new FusionCommandError(cancelled ? "cancelled" : "server", message);
}

type Raw = Record<string, unknown>;

function record(raw: unknown, command: string): Raw {
  if (typeof raw !== "object" || raw === null) {
    throw new FusionCommandError("server", `${command} returned no result`);
  }
  return raw as Raw;
}

function errorText(raw: Raw): string | undefined {
  return typeof raw.error === "string" && raw.error !== ""
    ? raw.error
    : undefined;
}

/** `No nodes found` and `lineage_query_failed` are an empty result; any other `error` is the server's. */
export function toListNodesResult(raw: unknown): ListNodesResult {
  const result = record(raw, "dbt.listNodes");
  const error = errorText(result);
  if (
    error !== undefined &&
    result.error_kind !== "lineage_query_failed" &&
    error !== "No nodes found"
  ) {
    throw new FusionCommandError("server", error);
  }
  return error !== undefined
    ? { nodes: [] }
    : { nodes: Array.isArray(result.nodes) ? result.nodes : [] };
}

/** `undefined` for a path that is not a node (a `null` answer). */
export function toCurrentNodeResult(
  raw: unknown,
): CurrentNodeResult | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const result = record(raw, "dbt.getCurrentNode");
  const error = errorText(result);
  if (error !== undefined) {
    throw new FusionCommandError("server", error);
  }
  return result;
}

export function toCompileFileResult(raw: unknown): CompileFileResult {
  const result = record(raw, "dbt.compileFile");
  const error = errorText(result);
  if (error !== undefined) {
    throw new FusionCommandError("server", error);
  }
  if (typeof result.file_uri !== "string") {
    throw new FusionCommandError("server", "dbt.compileFile returned no file");
  }
  return { fileUri: result.file_uri };
}

/** `undefined` until the first compile completes (`null` or `{}`). */
export function toProjectInfo(raw: unknown): ProjectInfo | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const result = record(raw, "dbt.getProjectInfo");
  const adapterType =
    typeof result.adapter_type === "string" ? result.adapter_type : undefined;
  const projectName =
    typeof result.project_name === "string" ? result.project_name : undefined;
  return adapterType === undefined && projectName === undefined
    ? undefined
    : { adapterType, projectName };
}
