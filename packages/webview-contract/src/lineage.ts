import type {
  OpenProblemsTab,
  PanelNotice,
  PanelNoticeActionId,
  Response,
  WebviewReady,
} from "./common.js";
import { isPanelNoticeActionId } from "./common.js";
import type { Check, CommandFields, Fields } from "./guards.js";
import {
  arrayOf,
  isBoolean,
  isNumber,
  isString,
  messageGuard,
  oneOf,
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
  /** The source table's own name, when it differs from `label`. */
  identifier?: string | undefined;
  /** Where the node is built: its database and schema; unset for nodes with no relation. */
  database?: string | undefined;
  schema?: string | undefined;
  /** True when the node's package is the project's own, so the card can leave the package out. */
  rootPackage?: boolean | undefined;
  /** The node's layer (staging, intermediate, marts…), from a tag, its folder or its name prefix. */
  layer?: string | undefined;
  /** The node's dbt tags, which the Scope filter keeps or removes by; absent when it has none. */
  tags?: string[] | undefined;
  /** True when the node sets `meta.lineage.hidden: true`: its table and column edges are not drawn. */
  hidden?: boolean | undefined;
  /** The node's configured `schema`; a card shows it in place of a schema that ends with `_<customSchema>`. */
  customSchema?: string | undefined;
  /** The node's file path, `/`-separated; folder grouping reads it. */
  path?: string | undefined;
  /** The node's data tests; `raw_sql` is the test's SQL. */
  tests: {
    key: string;
    raw_sql?: string | null | undefined;
    column_name?: string | null | undefined;
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
  returns?: { datatype: string; description: string } | undefined;
  meta?: Record<string, unknown> | undefined;
}

/** One column-level edge: `target` is computed from `source`; `indirect` when the source only filters or joins. */
export interface ColumnLineage {
  source: [table: string, column: string];
  target: [table: string, column: string];
  type: "direct" | "indirect";
  viewsType?: string | undefined;
}

/**
 * The `getConnectedColumns` body; `errors` holds tooltip lines per table. `cancelled` answers a trace the host
 * stopped, either superseded by another trace or cancelled by the panel.
 */
export interface ConnectedColumns {
  column_lineage: ColumnLineage[];
  errors?: Record<string, string[]> | undefined;
  cancelled?: true | undefined;
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

/**
 * Source of a relationship ref.
 * - `test`: derived from a dbt `relationships` data test
 * - `contract`: derived from a `foreign_key` model contract constraint
 * - `meta`: declared in `meta.relationships` on a node or source table
 * - `semantic`: derived from paired semantic-layer primary/foreign entities
 * - `inferred`: derived from naming-convention inference
 */
export type RefSource = "test" | "contract" | "meta" | "semantic" | "inferred";

/**
 * Which connections the lineage canvas draws: dbt table and column edges (`dbt`), declared relationship edges
 * (`declared`, with column edges only while a column trace is active), or both.
 */
export type Connections = "dbt" | "declared" | "both";

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

/**
 * Which engine places and routes the lineage cards: `balanced` and `thorough` are @fusion-power-user/graph-layout
 * with that ordering effort, `thorough` searching harder for fewer crossings.
 */
export type LineageEngine = "balanced" | "thorough";

/** The engine an unset `lineage.engine` gives. */
export const DEFAULT_LINEAGE_ENGINE: LineageEngine = "balanced";

/** The lineage component's view settings; `getLineageSettings` answers with them. */
export interface LineageSettings {
  showSelectEdges: boolean;
  showNonSelectEdges: boolean;
  defaultExpansion: number;
  /** Which connections are drawn; absent means dbt dependencies. */
  connections?: Connections | undefined;
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
  /** Titles cards by alias (`label`, the default) or by dbt name (`refName`). A user setting. */
  title?: "alias" | "name" | undefined;
  /** The engine that places and routes the cards; absent means `balanced`. A user setting, read-only here. */
  engine?: LineageEngine | undefined;
  /**
   * A colour per layer tag (`source`, `staging`, `intermediate`, `marts`, `other`, or any custom layer) for its band
   * and card stripe: a theme colour id such as `charts.red`, or a CSS hex or colour function. A user setting.
   */
  layerColors?: Readonly<Record<string, string>> | undefined;
  /** Highlights the upstream and downstream paths of the hovered or selected card. A view setting. */
  pathHighlight?: boolean | undefined;
  /** Fades the cards and edges that are not on the highlighted path. A view setting. */
  dimOffPath?: boolean | undefined;
  /** Draws the edges of a card with more connections than `lineage.maxNeighbours` thinner and lighter. A view setting. */
  hubDeemphasis?: boolean | undefined;
  /** The opacity of every edge, from 0.1 to 1. A view setting. */
  edgeOpacity?: number | undefined;
  /** The whole project, centred on the open model, or the open model's neighbourhood. A view setting. */
  viewMode?: ViewMode | undefined;
  /** How many dbt parent steps a neighbourhood draws, 0 to `MAX_VIEW_DEPTH`. A view setting. */
  upstreamDepth?: number | undefined;
  /** How many dbt child steps a neighbourhood draws, 0 to `MAX_VIEW_DEPTH`. A view setting. */
  downstreamDepth?: number | undefined;
  /** The most cards a neighbourhood draws, the start card included, up to `MAX_CARD_BUDGET`. A view setting. */
  cardBudget?: number | undefined;
}

/** The views the lineage panel draws: every table of the project, or the neighbourhood of the open model. */
export type ViewMode = "whole" | "neighbourhood";

/** The deepest a neighbourhood's upstream or downstream depth goes. */
export const MAX_VIEW_DEPTH = 10;

/** The most cards a neighbourhood's card budget allows. */
export const MAX_CARD_BUDGET = 1000;

/**
 * The settings `persistLineageSettings` may change. `maxNeighbours`, `groupBy`, `semanticZoom`, `title`,
 * `engine` and `layerColors` are user settings the panel only reads.
 */
export type PersistedLineageSettings = Partial<
  Omit<
    LineageSettings,
    | "maxNeighbours"
    | "groupBy"
    | "semanticZoom"
    | "title"
    | "engine"
    | "layerColors"
  >
>;

/** The `getConnectedColumns` request; the host reads `targets`, `upstreamExpansion` and `trace`. */
export interface ConnectedColumnsParams {
  /** `[table unique ID, column]` pairs. */
  targets: [string, string][];
  /** True asks for the targets' children, false for their parents. */
  upstreamExpansion: boolean;
  /** The selected column's key; a request with a new trace supersedes the previous trace's requests. */
  trace: string;
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
  /** Stops the column trace named by `trace`; its pending `getConnectedColumns` answers `cancelled`. */
  | { command: "cancelColumnTrace"; trace: string }
  | OptionalRequest<"getLineageSettings">
  /** Every table of the project's lineage graph, and the data-flow pairs among them, for the whole-project view. */
  | OptionalRequest<"getProjectGraph">
  | Request<"persistLineageSettings", PersistedLineageSettings>
  /** The unique IDs of the cards the user hid in this workspace, for every start model. */
  | OptionalRequest<"getHiddenCards">
  | Request<"persistHiddenCards", { cards: HiddenCard[] }>
  /** The node types and tags the workspace has switched off in the Scope control, for every start model. */
  | OptionalRequest<"getLineageScope">
  | Request<"persistLineageScope", { scope: LineageScope }>;

/**
 * A card the user hid: its unique ID, and the title the panel showed it by when it was hidden (`label`, absent when none
 * was stored). The workspace keeps these for every start model.
 */
export interface HiddenCard {
  id: string;
  label?: string | undefined;
}

/**
 * What the Scope control keeps out of the panel. A card is removed when its node type is off, or when it has tags and
 * every one of them is off; untagged cards follow their type only. `softened` cards keep their card but their edges
 * rank nothing in the layout, and `dimmed` cards and their edges are drawn faded; both are card IDs from the busy-node
 * list. The workspace keeps this for every start model.
 */
export interface LineageScope {
  offTypes: string[];
  offTags: string[];
  softened: string[];
  dimmed: string[];
}

/**
 * The body the host answers each request with, by request command. `getExposureDetails` and `getFunctionDetails`
 * answer with manifest metadata this contract does not model, so they stay `unknown`.
 */
export interface ResponseBodies {
  childTables: { tables?: LineageTable[] | undefined };
  parentTables: { tables?: LineageTable[] | undefined };
  tableEdges: { edges: [string, string][] };
  getColumns: TableColumns | undefined;
  getExposureDetails: unknown;
  getFunctionDetails: unknown;
  getRelationships: { refs: LineageRef[] };
  getConnectedColumns: ConnectedColumns;
  getLineageSettings: LineageSettings;
  persistLineageSettings: { ok: true };
  getHiddenCards: { cards: HiddenCard[] };
  persistHiddenCards: { ok: true };
  getLineageScope: { scope: LineageScope };
  persistLineageScope: { ok: true };
  getProjectGraph: { tables: LineageTable[]; edges: [string, string][] };
}

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

const isConnections = oneOf("dbt", "declared", "both");

const isViewMode = oneOf("whole", "neighbourhood");

const isRefSources: Check<Partial<Record<RefSource, boolean>>> = shape({
  test: optionalBoolean,
  contract: optionalBoolean,
  meta: optionalBoolean,
  semantic: optionalBoolean,
  inferred: optionalBoolean,
});

const isHiddenCard = shape<HiddenCard>({
  id: isString,
  label: optional(isString),
});

const isLineageScope = shape<LineageScope>({
  offTypes: arrayOf(isString),
  offTags: arrayOf(isString),
  softened: arrayOf(isString),
  dimmed: arrayOf(isString),
});

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
    trace: isString,
  }),
  cancelColumnTrace: { trace: isString },
  getLineageSettings: optionalRequest({}),
  getProjectGraph: optionalRequest({}),
  persistLineageSettings: request<PersistedLineageSettings>({
    showSelectEdges: optionalBoolean,
    showNonSelectEdges: optionalBoolean,
    defaultExpansion: optional(isNumber),
    connections: optional(isConnections),
    enabledRefSources: optional(isRefSources),
    inferenceConfidenceThreshold: optional(isNumber),
    includeSourcesInInference: optionalBoolean,
    pathHighlight: optionalBoolean,
    dimOffPath: optionalBoolean,
    hubDeemphasis: optionalBoolean,
    edgeOpacity: optional(isNumber),
    viewMode: optional(isViewMode),
    upstreamDepth: optional(isNumber),
    downstreamDepth: optional(isNumber),
    cardBudget: optional(isNumber),
  }),
  getHiddenCards: optionalRequest({}),
  persistHiddenCards: request<{ cards: HiddenCard[] }>({
    cards: arrayOf(isHiddenCard),
  }),
  getLineageScope: optionalRequest({}),
  persistLineageScope: request<{ scope: LineageScope }>({
    scope: isLineageScope,
  }),
};

export const isPanelMessage = messageGuard<PanelMessage>(panelFields);

export const panelCommands = Object.keys(
  panelFields,
) as PanelMessage["command"][];
/** The panel commands the host answers with a `response`. */
export const requestCommands = requestCommandsOf(panelFields);
