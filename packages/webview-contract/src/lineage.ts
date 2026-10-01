import {
  isPanelNotice,
  OpenProblemsTab,
  PanelNotice,
  Response,
  responseFields,
  WebviewReady,
} from "./common.js";
import {
  arrayOf,
  Check,
  CommandFields,
  Fields,
  isAnything,
  isBoolean,
  isNumber,
  isString,
  messageGuard,
  optional,
  shape,
  syncRequestId,
  tuple,
} from "./guards.js";

/** A request whose `args.params` carries `P`. */
interface Request<C extends string, P> {
  command: C;
  args: { params: P };
  syncRequestId?: string;
}

/** A request whose `args` and `params` may be absent. */
interface OptionalRequest<C extends string, P = Record<never, never>> {
  command: C;
  args?: { params?: P };
  syncRequestId?: string;
}

/** What the lineage panel draws first; absent when no starting node resolves. */
export interface RenderArgs {
  node?: unknown;
  aiEnabled: boolean;
  missingLineageMessage?: PanelNotice;
}

/** Lineage messages from the extension host to the panel. */
export type HostMessage =
  | Response
  | { command: "render"; args?: RenderArgs }
  /** The Current Project's manifest changed; the panel redraws, then sends `init`. */
  | { command: "projectSaved" };

/** The relationship sources the ERD overlay can show. */
export type RefSource = "test" | "contract" | "semantic" | "inferred";

/** The lineage component's view settings; `getLineageSettings` answers with them. */
export interface LineageSettings {
  showSelectEdges: boolean;
  showNonSelectEdges: boolean;
  defaultExpansion: number;
  /** The ERD overlay toggle; absent means on. */
  showRefs?: boolean;
  enabledRefSources?: Partial<Record<RefSource, boolean>>;
  /** The inferred-relationship confidence floor, 0 to 1. */
  inferenceConfidenceThreshold?: number;
  includeSourcesInInference?: boolean;
}

/** The `getConnectedColumns` request; the host reads `targets` and `upstreamExpansion`. */
export interface ConnectedColumnsParams {
  /** `[table unique ID, column]` pairs. */
  targets: [string, string][];
  /** True asks for the targets' children, false for their parents. */
  upstreamExpansion: boolean;
  /** The drawn tables and their one-hop neighbours. */
  currAnd1HopTables?: string[];
  selectedColumn?: { name: string; table: string };
  showIndirectEdges?: boolean;
}

/** Lineage messages from the panel to the extension host. */
export type PanelMessage =
  | WebviewReady
  | OpenProblemsTab
  | OptionalRequest<"init">
  | Request<"openFile", { url: string }>
  /** The tables `table` feeds (its dbt children). */
  | Request<"childTables", { table: string }>
  /** The tables `table` depends on (its dbt parents). */
  | Request<"parentTables", { table: string }>
  | Request<"getColumns", { table: string; refresh?: boolean }>
  | Request<"getExposureDetails", { name: string }>
  | Request<"getFunctionDetails", { name: string }>
  | OptionalRequest<
      "getRelationships",
      { includeSources?: boolean; allowSelfReference?: boolean }
    >
  | Request<"getConnectedColumns", ConnectedColumnsParams>
  | Request<"showInfoNotification", { message: string }>
  | OptionalRequest<"getLineageSettings">
  | Request<"persistLineageSettings", Partial<LineageSettings>>;

const request = <P>(params: Fields<NoInfer<P>>) => ({
  args: shape<{ params: P }>({ params: shape<P>(params) }),
  syncRequestId,
});

const optionalRequest = <P>(params: Fields<NoInfer<P>>) => ({
  args: optional(shape<{ params?: P }>({ params: optional(shape<P>(params)) })),
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
        aiEnabled: isBoolean,
        missingLineageMessage: optional(isPanelNotice),
      }),
    ),
  },
  projectSaved: {},
};

const panelFields: CommandFields<PanelMessage> = {
  "webview:ready": {},
  openProblemsTab: {},
  init: optionalRequest({}),
  openFile: request({ url: isString }),
  childTables: request({ table: isString }),
  parentTables: request({ table: isString }),
  getColumns: request({ table: isString, refresh: optionalBoolean }),
  getExposureDetails: request({ name: isString }),
  getFunctionDetails: request({ name: isString }),
  getRelationships: optionalRequest({
    includeSources: optionalBoolean,
    allowSelfReference: optionalBoolean,
  }),
  getConnectedColumns: request<ConnectedColumnsParams>({
    targets: arrayOf(tuple<[string, string]>(isString, isString)),
    upstreamExpansion: isBoolean,
    currAnd1HopTables: optional(arrayOf(isString)),
    selectedColumn: optional(shape({ name: isString, table: isString })),
    showIndirectEdges: optionalBoolean,
  }),
  showInfoNotification: request({ message: isString }),
  getLineageSettings: optionalRequest({}),
  persistLineageSettings: request<Partial<LineageSettings>>({
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
