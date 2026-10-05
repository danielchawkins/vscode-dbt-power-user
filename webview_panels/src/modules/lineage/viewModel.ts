import type { lineage } from "@fusion-power-user/webview-contract";
import type { LineageViewState } from "@modules/app/viewState";
import type { Direction, GraphState } from "./graph";

type Settings = lineage.LineageSettings;
type RefSource = lineage.RefSource;

export const REF_SOURCES: RefSource[] = [
  "test",
  "contract",
  "semantic",
  "inferred",
];

/** Settings with every optional field resolved to its default. */
export type ResolvedSettings = Required<Omit<Settings, "enabledRefSources">> & {
  enabledRefSources: Record<RefSource, boolean>;
};

export const resolveSettings = (
  settings: Partial<Settings> | undefined,
): ResolvedSettings => ({
  showSelectEdges: settings?.showSelectEdges ?? true,
  showNonSelectEdges: settings?.showNonSelectEdges ?? false,
  defaultExpansion: settings?.defaultExpansion ?? 1,
  showRefs: settings?.showRefs ?? true,
  enabledRefSources: {
    test: true,
    contract: true,
    semantic: true,
    inferred: true,
    ...settings?.enabledRefSources,
  },
  inferenceConfidenceThreshold: settings?.inferenceConfidenceThreshold ?? 0.8,
  includeSourcesInInference: settings?.includeSourcesInInference ?? false,
});

/** The relationships to draw: enabled sources, inferred ones at or above the threshold, both ends drawn. */
export const visibleRefs = (
  refs: readonly lineage.LineageRef[],
  settings: ResolvedSettings,
  drawn: ReadonlySet<string>,
): lineage.LineageRef[] =>
  settings.showRefs
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

/** The persisted view state of `graph`; `undefined` until a start table is drawn. */
export const viewStateOf = (
  graph: GraphState,
  publication: string | undefined,
): LineageViewState | undefined =>
  graph.start
    ? {
        panel: "lineage",
        publication,
        start: graph.start,
        expansions: graph.expansions,
        columnTables: graph.columnTables,
        selectedTable: graph.selectedTable,
        selectedColumn: graph.selectedColumn,
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
}): { start?: lineage.LineageTable; saved?: LineageViewState } | undefined {
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
  toggleColumns: (table: string) => void;
  selectColumn: (table: string, column: string) => void;
  openDetails: (table: string) => void;
  openFile: (url: string) => void;
}

const noop = (): undefined => undefined;

/** The view assigns `current` on every render, so memoized nodes always call its latest handlers. */
export const tableActions: { current: TableActions } = {
  current: {
    toggleExpansion: noop,
    toggleColumns: noop,
    selectColumn: noop,
    openDetails: noop,
    openFile: noop,
  },
};
