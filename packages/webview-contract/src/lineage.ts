import type {
  OpenProblemsTab,
  PanelNotice,
  PanelNoticeActionId,
  Response,
  WebviewReady,
} from "./common.js";
import {
  isPanelNotice,
  isPanelNoticeActionId,
  responseFields,
} from "./common.js";
import type { Check, CommandFields, Fields } from "./guards.js";
import {
  arrayOf,
  isAnything,
  isBoolean,
  isNumber,
  isString,
  messageGuard,
  optional,
  requestCommandsOf,
  shape,
  syncRequestId,
  tuple,
} from "./guards.js";

/** A request whose `args.params` carries `P`. */
interface Request<C extends string, P> {
  command: C;
  args: { params: P };
  syncRequestId?: string | undefined;
}

/** A request whose `args` and `params` may be absent. */
interface OptionalRequest<C extends string, P = Record<never, never>> {
  command: C;
  args?: { params?: P | undefined } | undefined;
  syncRequestId?: string | undefined;
}

/** A table as `render`, `childTables` and `parentTables` carry it. */
export interface LineageTable {
  /** The node's unique ID. */
  table: string;
  label: string;
  url?: string | undefined;
  nodeType: string;
  materialization?: string | undefined;
  description?: string | undefined;
  /** Number of dbt children. */
  childCount: number;
  /** Number of dbt parents. */
  parentCount: number;
  packageName?: string | undefined;
  /** The name `ref()` uses, when it differs from `label`. */
  refName?: string | undefined;
  /** Where the node is built: its database and schema; unset for nodes with no relation. */
  database?: string | undefined;
  schema?: string | undefined;
  /** True when the node's package is the project's own, so the card can leave the package out. */
  rootPackage?: boolean | undefined;
  /** The node's layer (staging, intermediate, marts…), from a tag, its folder or its name prefix. */
  layer?: string | undefined;
  /** True when the node sets `meta.lineage.hidden: true`: its table and column edges are not drawn. */
  hidden?: boolean | undefined;
  /** The node's configured `schema`; a card shows it in place of a schema that ends with `_<customSchema>`. */
  customSchema?: string | undefined;
  /** The node's file path, `/`-separated; folder grouping reads it. */
  path?: string | undefined;
  /** The node's data tests; `raw_sql` is the test's SQL. */
  tests: {
    key: string;
    raw_sql?: string | undefined;
    column_name?: string | undefined;
  }[];
  meta?: Record<string, unknown> | undefined;
}

/** A column in the `getColumns` body. */
export interface LineageColumn {
  table: string;
  name: string;
  datatype?: string | undefined;
  description?: string | undefined;
}

/** The `getColumns` body. */
export interface TableColumns {
  id: string;
  purpose?: string | undefined;
  columns: LineageColumn[];
  returns?: { datatype: string; description: string };
  meta?: Record<string, unknown> | undefined;
}

/** One column-level edge: `target` is computed from `source`; `indirect` when the source only filters or joins. */
export interface ColumnLineage {
  source: [table: string, column: string];
  target: [table: string, column: string];
  type: "direct" | "indirect";
  viewsType?: string | undefined;
}

/** The `getConnectedColumns` body; `errors` holds tooltip lines per table. */
export interface ConnectedColumns {
  column_lineage: ColumnLineage[];
  errors?: Record<string, string[]> | undefined;
}

/** What the lineage renderer draws: tables, table edges as `[parent, child]`, and column edges among them. */
export interface LineageData {
  start?: string | undefined;
  tables: LineageTable[];
  edges: [parent: string, child: string][];
  columnEdges: ColumnLineage[];
}

/** What the lineage panel draws first; absent when no starting node resolves. */
export interface RenderArgs {
  node?: unknown;
  missingLineageMessage?: PanelNotice | undefined;
  /** True when column lists would stay empty because the project's static analysis is not strict. */
  columnsNeedStrict?: boolean | undefined;
  /** The Current Project's manifest publication; a restored view state applies only to the same one. */
  publication?: string | undefined;
}

/** Lineage messages from the extension host to the panel. */
export type HostMessage =
  | Response
  | { command: "render"; args?: RenderArgs | undefined }
  /** The Current Project's manifest changed; the panel redraws, then sends `init`. */
  | { command: "projectSaved" };

/** The relationship sources the ERD overlay can show. */
export type RefSource = "test" | "contract" | "semantic" | "inferred";

/** A primary/foreign key relationship from `getRelationships`; `confidence` is set for inferred ones. */
export interface LineageRef {
  id: string;
  from: { table: string; columns: string[] };
  to: { table: string; columns: string[] };
  cardinality: string;
  source: RefSource;
  label?: string | undefined;
  confidence?: number | undefined;
}

/** The lineage component's view settings; `getLineageSettings` answers with them. */
export interface LineageSettings {
  showSelectEdges: boolean;
  showNonSelectEdges: boolean;
  defaultExpansion: number;
  /** The ERD overlay toggle; absent means on. */
  showRefs?: boolean | undefined;
  enabledRefSources?: Partial<Record<RefSource, boolean>> | undefined;
  /** The inferred-relationship confidence floor, 0 to 1. */
  inferenceConfidenceThreshold?: number | undefined;
  includeSourcesInInference?: boolean | undefined;
  /** The most nodes one expansion draws before a `+N more` marker; 0 draws all. A user setting, read-only here. */
  maxNeighbours?: number | undefined;
  /** How an over-cap expansion's new neighbours are drawn: by folder as group nodes, or `none`. A user setting. */
  groupBy?: "none" | "folder" | undefined;
  /** Below 50% zoom, cards keep their size and show only a larger badge and title. A user setting. */
  semanticZoom?: boolean | undefined;
}

/**
 * The settings `persistLineageSettings` may change. `maxNeighbours`, `groupBy` and `semanticZoom` are user settings
 * the panel only reads.
 */
export type PersistedLineageSettings = Partial<
  Omit<LineageSettings, "maxNeighbours" | "groupBy" | "semanticZoom">
>;

/** The `getConnectedColumns` request; the host reads `targets` and `upstreamExpansion`. */
export interface ConnectedColumnsParams {
  /** `[table unique ID, column]` pairs. */
  targets: [string, string][];
  /** True asks for the targets' children, false for their parents. */
  upstreamExpansion: boolean;
}

/** Lineage messages from the panel to the extension host. */
export type PanelMessage =
  | WebviewReady
  | OpenProblemsTab
  /** A button of the panel's notice was clicked. */
  | { command: "runNoticeAction"; action: PanelNoticeActionId }
  | OptionalRequest<"init">
  | Request<"openFile", { url: string }>
  /** The tables `table` feeds (its dbt children). */
  | Request<"childTables", { table: string }>
  /** The tables `table` depends on (its dbt parents). */
  | Request<"parentTables", { table: string }>
  /** The data-flow `[parent, child]` pairs among `tables`. */
  | Request<"tableEdges", { tables: string[] }>
  | Request<"getColumns", { table: string; refresh?: boolean | undefined }>
  | Request<"getExposureDetails", { name: string }>
  | Request<"getFunctionDetails", { name: string }>
  | OptionalRequest<
      "getRelationships",
      { includeSources?: boolean | undefined }
    >
  | Request<"getConnectedColumns", ConnectedColumnsParams>
  | OptionalRequest<"getLineageSettings">
  | Request<"persistLineageSettings", PersistedLineageSettings>;

const request = <P>(params: Fields<NoInfer<P>>) => ({
  args: shape<{ params: P }>({ params: shape<P>(params) }),
  syncRequestId,
});

const optionalRequest = <P>(params: Fields<NoInfer<P>>) => ({
  args: optional(
    shape<{ params?: P | undefined }>({ params: optional(shape<P>(params)) }),
  ),
  syncRequestId,
});

const optionalBoolean = optional(isBoolean);

const isRefSources: Check<Partial<Record<RefSource, boolean>>> = shape({
  test: optionalBoolean,
  contract: optionalBoolean,
  semantic: optionalBoolean,
  inferred: optionalBoolean,
});

const hostFields: CommandFields<HostMessage> = {
  response: responseFields,
  render: {
    args: optional(
      shape<RenderArgs>({
        node: isAnything,
        missingLineageMessage: optional(isPanelNotice),
        columnsNeedStrict: optional(isBoolean),
        publication: optional(isString),
      }),
    ),
  },
  projectSaved: {},
};

const panelFields: CommandFields<PanelMessage> = {
  "webview:ready": {},
  openProblemsTab: {},
  runNoticeAction: { action: isPanelNoticeActionId },
  init: optionalRequest({}),
  openFile: request({ url: isString }),
  childTables: request({ table: isString }),
  parentTables: request({ table: isString }),
  tableEdges: request({ tables: arrayOf(isString) }),
  getColumns: request({ table: isString, refresh: optionalBoolean }),
  getExposureDetails: request({ name: isString }),
  getFunctionDetails: request({ name: isString }),
  getRelationships: optionalRequest({
    includeSources: optionalBoolean,
  }),
  getConnectedColumns: request<ConnectedColumnsParams>({
    targets: arrayOf(tuple<[string, string]>(isString, isString)),
    upstreamExpansion: isBoolean,
  }),
  getLineageSettings: optionalRequest({}),
  persistLineageSettings: request<PersistedLineageSettings>({
    showSelectEdges: optionalBoolean,
    showNonSelectEdges: optionalBoolean,
    defaultExpansion: optional(isNumber),
    showRefs: optionalBoolean,
    enabledRefSources: optional(isRefSources),
    inferenceConfidenceThreshold: optional(isNumber),
    includeSourcesInInference: optionalBoolean,
  }),
};

export const isHostMessage = messageGuard<HostMessage>(hostFields);
export const isPanelMessage = messageGuard<PanelMessage>(panelFields);

export const hostCommands = Object.keys(hostFields) as HostMessage["command"][];
export const panelCommands = Object.keys(
  panelFields,
) as PanelMessage["command"][];
/** The panel commands the host answers with a `response`. */
export const requestCommands = requestCommandsOf(panelFields);
