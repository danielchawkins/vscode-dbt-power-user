import type { lineage } from "@fusion-power-user/webview-contract";
import type { LineageViewState } from "@modules/app/viewState";
import { MAX_VIEW_STATE_STRING } from "@modules/app/viewState";
import { createContext } from "react";
import { groupChips } from "./expansionGroups";
import type { Direction, GraphState } from "./graph";

type Settings = lineage.LineageSettings;
type RefSource = lineage.RefSource;

export const REF_SOURCES: RefSource[] = [
  "test",
  "contract",
  "meta",
  "semantic",
  "inferred",
];

/** Settings with every optional field resolved to its default. */
export type ResolvedSettings = {
  [K in keyof Omit<Settings, "enabledRefSources">]-?: Exclude<
    Settings[K],
    undefined
  >;
} & {
  enabledRefSources: Record<RefSource, boolean>;
};

/** The user settings the panel only reads, each resolved to its default. */
const resolveUserSettings = (
  settings: Partial<Settings> | undefined,
): Pick<
  ResolvedSettings,
  "maxNeighbours" | "groupBy" | "semanticZoom" | "title" | "layout"
> => ({
  maxNeighbours: settings?.maxNeighbours ?? 20,
  groupBy: settings?.groupBy ?? "folder",
  semanticZoom: settings?.semanticZoom ?? true,
  title: settings?.title ?? "alias",
  layout: settings?.layout ?? "layered",
});

export const resolveSettings = (
  settings: Partial<Settings> | undefined,
): ResolvedSettings => ({
  showSelectEdges: settings?.showSelectEdges ?? true,
  showNonSelectEdges: settings?.showNonSelectEdges ?? false,
  defaultExpansion: settings?.defaultExpansion ?? 1,
  connections: settings?.connections ?? "dbt",
  enabledRefSources: {
    test: true,
    contract: true,
    meta: true,
    semantic: true,
    inferred: true,
    ...settings?.enabledRefSources,
  },
  inferenceConfidenceThreshold: settings?.inferenceConfidenceThreshold ?? 0.8,
  includeSourcesInInference: settings?.includeSourcesInInference ?? false,
  ...resolveUserSettings(settings),
});

/**
 * The relationships to draw: none under dbt dependencies; otherwise the enabled sources, inferred ones at or above
 * the threshold, with both ends drawn.
 */
export const visibleRefs = (
  refs: readonly lineage.LineageRef[],
  settings: ResolvedSettings,
  drawn: ReadonlySet<string>,
): lineage.LineageRef[] =>
  settings.connections !== "dbt"
    ? refs.filter(
        (ref) =>
          settings.enabledRefSources[ref.source] &&
          (ref.source !== "inferred" ||
            (ref.confidence ?? 0) >= settings.inferenceConfidenceThreshold) &&
          drawn.has(ref.from.table) &&
          drawn.has(ref.to.table) &&
          ref.from.table !== ref.to.table,
      )
    : [];

/**
 * The persisted view state of `graph`; `undefined` until a start table is drawn. An expansion still being fetched is
 * saved too, so hiding the view mid-fetch keeps it; a replay applies it like any other saved expansion. An open group
 * whose ID is longer than a view state string is left out, since the whole state would be refused; that group comes
 * back closed.
 */
export const viewStateOf = (
  graph: GraphState,
  publication: string | undefined,
): LineageViewState | undefined =>
  graph.start
    ? {
        panel: "lineage",
        publication,
        start: graph.start,
        expansions: [
          ...graph.expansions,
          ...graph.pending.filter((key) => !graph.expansions.includes(key)),
        ],
        columnTables: graph.columnTables,
        selectedTable: graph.selectedTable,
        selectedColumn: graph.selectedColumn,
        openGroups: groupChips(graph)
          .map((chip) => chip.id)
          .filter((id) => id.length <= MAX_VIEW_STATE_STRING),
      }
    : undefined;

/** The saved state to replay for `start` at `publication`, or `undefined` to draw at the default expansion. */
const restorableState = (
  saved: LineageViewState | undefined,
  start: string,
  publication: string | undefined,
): LineageViewState | undefined =>
  saved?.start === start && saved.publication === publication
    ? saved
    : undefined;

/**
 * What a `render` message redraws, or `undefined` when it names the drawn start table at the drawn publication.
 * After `projectSaved`, the drawn expansions replay onto the same start table; on the page's first render, the
 * state VS Code kept replays when it names the same start table and publication.
 */
export function planRender(input: {
  args: lineage.RenderArgs | undefined;
  graph: GraphState;
  publication: string | undefined;
  refresh: boolean;
  stored: () => LineageViewState | undefined;
}):
  | { start?: lineage.LineageTable; saved?: LineageViewState | undefined }
  | undefined {
  const { args, graph, publication, refresh } = input;
  const start = args?.node as lineage.LineageTable | undefined;
  const sameStart = start !== undefined && start.table === graph.start;
  if (sameStart && args?.publication === publication && !refresh) {
    return undefined;
  }
  const stored = input.stored();
  if (!start) {
    return {};
  }
  const saved =
    refresh && sameStart
      ? viewStateOf(graph, publication)
      : restorableState(stored, start.table, args?.publication);
  return { start, saved };
}

/** What a table node asks the view to do. */
export interface TableActions {
  toggleExpansion: (table: string, direction: Direction) => void;
  /** Draws the next batch of a capped expansion's neighbours. */
  showMore: (table: string, direction: Direction) => void;
  /** Draws a closed group's members as ordinary cards, by the group's node ID. */
  openGroup: (id: string) => void;
  /** Draws the next batch of an open group's members, by the group's node ID. */
  showMoreInGroup: (id: string) => void;
  /** Closes an open group, by its group node ID, and drops what only its members drew. */
  closeGroup: (id: string) => void;
  toggleColumns: (table: string) => void;
  selectColumn: (table: string, column: string) => void;
  openDetails: (table: string) => void;
  openFile: (url: string) => void;
}

const noop = (): undefined => undefined;

/** The view's table actions; memoized nodes read them from context, so they never see a stale handler. */
export const TableActionsContext = createContext<TableActions>({
  toggleExpansion: noop,
  showMore: noop,
  openGroup: noop,
  showMoreInGroup: noop,
  closeGroup: noop,
  toggleColumns: noop,
  selectColumn: noop,
  openDetails: noop,
  openFile: noop,
});
