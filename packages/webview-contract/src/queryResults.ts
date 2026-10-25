import type { Response, WebviewReady } from "./common.js";
import { responseFields } from "./common.js";
import type { CommandFields } from "./guards.js";
import {
  arrayOf,
  isAnything,
  isNumber,
  isRecord,
  isString,
  messageGuard,
  nullable,
  oneOf,
  optional,
  shape,
  syncRequestId,
} from "./guards.js";

/** Which preview of a model a result shows: what its SQL computes now, or what its relation holds. */
export interface ModelPreview {
  mode: "computed" | "materialized";
  /** The model file's path, so the panel can ask for the other mode. */
  model: string;
}

/** A query result as the host renders it; row values are what the warehouse returned. */
export interface RenderQuery {
  command: "renderQuery";
  columnNames: string[];
  columnTypes: (string | null)[];
  rows: Record<string, unknown>[];
  raw_sql: string;
  compiled_sql: string;
  /** Set when the query previews one model. */
  preview?: ModelPreview | undefined;
}

/** A failed query; `data` is diagnostic detail the panel shows verbatim. */
export interface RenderError {
  command: "renderError";
  error: { code: number; message: string; data?: unknown };
  raw_sql: string;
  compiled_sql: string;
  preview?: ModelPreview | undefined;
}

/** The editor context the panel shows beside its results. */
export interface QueryContext {
  command: "getContext";
  limit: number;
  activeEditor: { query?: string | undefined; filepath?: string | undefined };
  /** The Current Project's manifest publication; the panel's saved view state names it. */
  publication?: string | undefined;
}

/** `type` is the panel's view type: 0 the bottom panel, 1 a results tab, 2 a history or bookmark run. */
export type ViewType = 0 | 1 | 2;

/** Query-results messages from the extension host to the panel. */
export type HostMessage =
  | Response
  | RenderQuery
  | RenderError
  | { command: "renderLoading" }
  | { command: "resetState" }
  | QueryContext
  /** The session's query history, sent as a response body without `syncRequestId`. */
  | { command: "queryHistory"; args: { body: QueryHistoryEntry[] } }
  | { command: "updateViewType"; args: { body: { type: ViewType } } };

/** One entry in the panel's session query history. */
export interface QueryHistoryEntry {
  rawSql: string;
  compiledSql: string;
  timestamp: number;
  duration: number;
  adapter: string;
  projectName: string;
  data?: Record<string, unknown>[] | undefined;
  columnNames: string[];
  columnTypes: (string | null)[];
  modelName: string;
}

/**
 * What a results tab renders. The host sends it for a history entry; "Open in Tab" sends the panel's whole state.
 * Both senders may leave any field out, and the tab reads each one only when it is there.
 */
export interface QueryTabData {
  queryResults?:
    | {
        data?: Record<string, unknown>[] | undefined;
        columnNames: string[];
        columnTypes: (string | null)[];
      }
    | undefined;
  compiledCodeMarkup?: string | undefined;
  rawSql?: string | undefined;
  queryExecutionInfo?: { elapsedTime: number } | undefined;
  preview?: ModelPreview | undefined;
}

/** Query-results messages from the panel to the extension host. */
export type PanelMessage =
  | WebviewReady
  | { command: "error"; text: string }
  | { command: "updateConfig"; limit?: number | undefined }
  | { command: "cancelQuery" }
  /** Asks the host to send `getContext`; there is no `response`. */
  | { command: "getQueryPanelContext" }
  | { command: "getQueryHistory" }
  /** With `projectName`, re-runs a history entry against that Declared Project. */
  | {
      command: "executeQuery";
      query: string;
      projectName?: string | undefined;
      editorName?: string | undefined;
      limit?: number | undefined;
    }
  | { command: "executeQueryFromActiveWindow"; limit: number }
  /** Re-runs the model a result previewed, in the other mode. */
  | ({ command: "switchPreview" } & ModelPreview)
  | { command: "getQueryTabData"; syncRequestId?: string | undefined }
  | { command: "runAdhocQuery" }
  | {
      command: "viewResultSet";
      queryHistory: QueryHistoryEntry;
      editorName?: string | undefined;
    }
  | { command: "openCodeInEditor"; code?: string | undefined }
  /** `error` is the rendering error that made the panel clear its history. */
  | {
      command: "clearQueryHistory";
      syncRequestId?: string | undefined;
      error?: unknown;
    }
  /** Opens the current results in an editor tab; `queryTabData` is the panel's result state. */
  | { command: "queryResultTab:render"; queryTabData: QueryTabData };

const columnTypes = arrayOf(nullable(isString));

const previewFields = {
  mode: oneOf("computed", "materialized"),
  model: isString,
};
const preview = optional(shape<ModelPreview>(previewFields));

const isHistoryEntry = shape<QueryHistoryEntry>({
  rawSql: isString,
  compiledSql: isString,
  timestamp: isNumber,
  duration: isNumber,
  adapter: isString,
  projectName: isString,
  data: optional(arrayOf(isRecord)),
  columnNames: arrayOf(isString),
  columnTypes,
  modelName: isString,
});

const isQueryTabData = shape<QueryTabData>({
  queryResults: optional(
    shape<NonNullable<QueryTabData["queryResults"]>>({
      data: optional(arrayOf(isRecord)),
      columnNames: arrayOf(isString),
      columnTypes,
    }),
  ),
  compiledCodeMarkup: optional(isString),
  rawSql: optional(isString),
  queryExecutionInfo: optional(
    shape<{ elapsedTime: number }>({ elapsedTime: isNumber }),
  ),
  preview,
});

const hostFields: CommandFields<HostMessage> = {
  response: responseFields,
  renderQuery: {
    columnNames: arrayOf(isString),
    columnTypes,
    rows: arrayOf(isRecord),
    raw_sql: isString,
    compiled_sql: isString,
    preview,
  },
  renderError: {
    error: shape({ code: isNumber, message: isString, data: isAnything }),
    raw_sql: isString,
    compiled_sql: isString,
    preview,
  },
  renderLoading: {},
  resetState: {},
  getContext: {
    limit: isNumber,
    activeEditor: shape({
      query: optional(isString),
      filepath: optional(isString),
    }),
    publication: optional(isString),
  },
  queryHistory: { args: shape({ body: arrayOf(isHistoryEntry) }) },
  updateViewType: {
    args: shape({ body: shape({ type: oneOf(0, 1, 2) }) }),
  },
};

const panelFields: CommandFields<PanelMessage> = {
  "webview:ready": {},
  error: { text: isString },
  updateConfig: { limit: optional(isNumber) },
  cancelQuery: {},
  getQueryPanelContext: {},
  getQueryHistory: {},
  executeQuery: {
    query: isString,
    projectName: optional(isString),
    editorName: optional(isString),
    limit: optional(isNumber),
  },
  executeQueryFromActiveWindow: { limit: isNumber },
  switchPreview: previewFields,
  getQueryTabData: { syncRequestId },
  runAdhocQuery: {},
  viewResultSet: {
    queryHistory: isHistoryEntry,
    editorName: optional(isString),
  },
  openCodeInEditor: { code: optional(isString) },
  clearQueryHistory: { syncRequestId, error: isAnything },
  "queryResultTab:render": { queryTabData: isQueryTabData },
};

export const isHostMessage = messageGuard<HostMessage>(hostFields);
export const isPanelMessage = messageGuard<PanelMessage>(panelFields);

export const hostCommands = Object.keys(hostFields) as HostMessage["command"][];
export const panelCommands = Object.keys(
  panelFields,
) as PanelMessage["command"][];
