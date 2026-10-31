import type { lineage } from "@fusion-power-user/webview-contract";
import { useCallback, useMemo } from "react";
import { connectionCounts, type Pair } from "./emphasis";
import { drawnGraph, type GraphState, knownPairs } from "./graph";
import { withName } from "./scope";

/** Nothing softened or dimmed, for a scope that has not arrived. */
const NOTHING: Pick<lineage.LineageScope, "softened" | "dimmed"> = {
  softened: [],
  dimmed: [],
};

/**
 * The busy-node list: the drawn cards with more connections than `lineage.maxNeighbours`, ranked by degree, each with
 * Hide, Soften and Dim. Soften and Dim are kept per workspace; Hide is the card's own hide, listed with the hidden cards.
 */

/** A card in the busy-node list, with its connection count and what is set on it. */
interface BusyCard {
  id: string;
  label: string;
  /** The connections the card has in the known data: its parents and its children. */
  degree: number;
  /** False on the start card, which cannot be hidden. */
  hideable: boolean;
  softened: boolean;
  dimmed: boolean;
}

/** The busy-node list the Scope control shows, and its actions. */
export interface BusyControls {
  /** `lineage.maxNeighbours`: a card with more connections than this is busy. 0 means no cap, so none is busy. */
  threshold: number;
  /** False until the stored scope arrives; Soften and Dim are disabled until then. */
  ready: boolean;
  cards: BusyCard[];
  hide: (card: BusyCard) => void;
  setSoftened: (id: string, on: boolean) => void;
  setDimmed: (id: string, on: boolean) => void;
}

/** How many connections each card has in `pairs`: its parents and its children together. */
const connectionDegrees = (pairs: readonly Pair[]): Map<string, number> =>
  new Map(
    Array.from(connectionCounts(pairs), ([table, { parents, children }]) => [
      table,
      parents + children,
    ]),
  );

/**
 * The busy cards among `tables`, the drawn ones: those with more than `threshold` connections, ranked by degree, most
 * first and then by ID. A softened or dimmed card stays listed whatever its degree, so its undo is always in the list.
 */
const busyCardsOf = ({
  tables,
  degrees,
  threshold,
  stored,
  start,
}: {
  tables: readonly Pick<lineage.LineageTable, "table" | "label">[];
  degrees: ReadonlyMap<string, number>;
  threshold: number;
  stored: Pick<lineage.LineageScope, "softened" | "dimmed">;
  start: string | undefined;
}): BusyCard[] =>
  tables
    .map((table): BusyCard => ({
      id: table.table,
      label: table.label,
      degree: degrees.get(table.table) ?? 0,
      hideable: table.table !== start,
      softened: stored.softened.includes(table.table),
      dimmed: stored.dimmed.includes(table.table),
    }))
    .filter(
      (card) =>
        (threshold > 0 && card.degree > threshold) ||
        card.softened ||
        card.dimmed,
    )
    .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));

/**
 * The busy-node list for the graph: the drawn cards and their connections in the known data, which count the cards a
 * cap or a group leaves out. `change` persists the stored scope the way the Scope filters do.
 */
export const useBusyCards = ({
  graph,
  threshold,
  scope,
  change,
  hide,
}: {
  graph: GraphState;
  threshold: number;
  scope: lineage.LineageScope | undefined;
  change: (scope: lineage.LineageScope) => void;
  hide: (table: string, label: string) => void;
}): BusyControls => {
  const degrees = useMemo(() => connectionDegrees(knownPairs(graph)), [graph]);
  const tables = useMemo(() => drawnGraph(graph).tables, [graph]);
  const cards = useMemo(
    () =>
      busyCardsOf({
        tables,
        degrees,
        threshold,
        stored: scope ?? NOTHING,
        start: graph.start,
      }),
    [tables, degrees, threshold, scope, graph.start],
  );
  const setSoftened = useCallback(
    (id: string, on: boolean) => {
      if (scope) {
        // withName keeps a name listed while its flag is on, so a set card is the one withName is asked to leave out.
        change({ ...scope, softened: withName(scope.softened, id, !on) });
      }
    },
    [scope, change],
  );
  const setDimmed = useCallback(
    (id: string, on: boolean) => {
      if (scope) {
        change({ ...scope, dimmed: withName(scope.dimmed, id, !on) });
      }
    },
    [scope, change],
  );
  return {
    threshold,
    ready: scope !== undefined,
    cards,
    hide: (card) => hide(card.id, card.label),
    setSoftened,
    setDimmed,
  };
};
