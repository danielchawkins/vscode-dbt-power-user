import type { lineage } from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import { columnKey, traceColumn } from "./columnTrace";
import { showMore } from "./expansionCap";
import { closeGroup, openGroup, showMoreInGroup } from "./expansionGroups";
import type { Direction, GraphStore, TableColumn } from "./graph";
import {
  clearColumn,
  collapse,
  columnClick,
  drawnNeighbours,
  expand,
  expansionClick,
  expansionKey,
  hideColumns,
  linkDrawn,
  showColumns,
  visibleOf,
  withHidden,
} from "./graph";
import {
  executeRequestInAsync,
  fetchColumns,
  fetchConnected,
  fetchEdges,
  fetchNeighbours,
  openFile,
  persistHiddenCards,
} from "./requests";
import type { TableActions } from "./viewModel";

export const logError =
  (what: string) =>
  (error: unknown): void =>
    panelLogger.error(`lineage ${what}`, error);

/** Traces `column` and then draws the tables its traced edges touch. */
const traceSelected = (store: GraphStore, column: TableColumn): void => {
  traceColumn(store, column, fetchConnected)
    .then((touched) => showColumns(store, touched, fetchColumns))
    .catch(logError("column trace"));
};

/** Cancels the trace in flight on the host and ends it here, so none of its later hops is posted. */
const stopTrace = (store: GraphStore): void => {
  const tracing = store.get().tracing;
  if (tracing) {
    executeRequestInAsync("cancelColumnTrace", {
      trace: columnKey(tracing.column),
    });
    store.update((s) => ({ ...s, tracing: undefined }));
  }
};

/** Sets the hidden cards of the graph to `hidden`, and posts the whole list: the host keeps it for the workspace. */
export const setHidden = (
  store: GraphStore,
  hidden: lineage.HiddenCard[],
): void => {
  store.update((s) => withHidden(s, hidden));
  persistHiddenCards(store.get().hiddenCards);
};

/** The column actions: toggling a column list, selecting a column to trace, and the trace's retry and cancel. */
const columnActionsFor = (store: () => GraphStore) => ({
  toggleColumns: (table: string) => {
    const s = store();
    if (s.get().columnTables.includes(table)) {
      if (s.get().selectedColumn?.[0] === table) {
        stopTrace(s);
      }
      s.update((g) => hideColumns(g, table));
      return;
    }
    showColumns(s, [table], fetchColumns).catch(logError("columns"));
  },
  selectColumn: (table: string, column: string) => {
    const s = store();
    const ref: TableColumn = [table, column];
    if (columnClick(s.get(), ref) === "clear") {
      stopTrace(s);
      s.update(clearColumn);
      return;
    }
    traceSelected(s, ref);
  },
  retryTrace: () => {
    const s = store();
    const column = s.get().selectedColumn;
    if (column) {
      traceSelected(s, column);
    }
  },
  cancelTrace: () => stopTrace(store()),
});

/**
 * The table actions over `store`. `raiseBudget` is what "more" does in the neighbourhood when the card budget, not an
 * expansion's cap, is what left the cards out.
 */
export const actionsFor = (
  store: () => GraphStore,
  openDetails: (table: string) => void,
  raiseBudget: ((by: number) => void) | undefined,
): TableActions => ({
  ...columnActionsFor(store),
  hide: (table: string, label: string) => {
    const s = store();
    setHidden(s, [...s.get().hiddenCards, { id: table, label }]);
  },
  toggleExpansion: (table: string, direction: Direction) => {
    const s = store();
    // The whole project draws every card, so an expander has nothing to open there.
    if (s.get().view.viewMode === "whole") {
      return;
    }
    // A click on an expander that is still loading cancels it, as a click on an open one closes it.
    if (expansionClick(s.get(), direction, table) === "collapse") {
      s.update((g) => collapse(g, direction, table));
      return;
    }
    expand(s, [direction, table], fetchNeighbours)
      .then(() => linkDrawn(s, fetchEdges))
      .catch(logError("expand"));
  },
  showMore: (table: string, direction: Direction) => {
    const s = store();
    const key = expansionKey(direction, table);
    const before = s.get();
    if (before.view.viewMode === "neighbourhood") {
      // The label counts the cards the budget withholds from what is drawn, and the cards this click moves into the
      // expansion's drawn slice; the budget has to rise by both, or one click draws fewer than the label says.
      const withheld = visibleOf(before).capped[key] ?? 0;
      const added =
        drawnNeighbours(showMore(before, direction, table), key).length -
        drawnNeighbours(before, key).length;
      if (withheld + added > 0) {
        raiseBudget?.(withheld + added);
      }
    }
    s.update((g) => showMore(g, direction, table));
    linkDrawn(s, fetchEdges).catch(logError("show more"));
  },
  openGroup: (id: string) => {
    const s = store();
    s.update((g) => openGroup(g, id));
    linkDrawn(s, fetchEdges).catch(logError("open group"));
  },
  showMoreInGroup: (id: string) => {
    const s = store();
    s.update((g) => showMoreInGroup(g, id));
    linkDrawn(s, fetchEdges).catch(logError("show more in group"));
  },
  // Closing only removes tables, so there are no new pairs to fetch.
  closeGroup: (id: string) => {
    store().update((g) => closeGroup(g, id));
  },
  openDetails,
  openFile,
});
