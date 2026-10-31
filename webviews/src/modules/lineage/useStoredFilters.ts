import type { lineage } from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BusyControls } from "./busyCards";
import { type GraphState, visibleOf } from "./graph";
import {
  fetchHiddenCards,
  fetchLineageScope,
  persistLineageScope,
} from "./requests";
import { scopeChoices, withName } from "./scope";

/**
 * The hidden cards the host kept for the workspace, with `undefined` until they arrive. A failed read hides nothing.
 */
export const useHiddenCards = (): lineage.HiddenCard[] | undefined => {
  const [hidden, setHidden] = useState<lineage.HiddenCard[]>();
  useEffect(() => {
    fetchHiddenCards().then(setHidden, (error) => {
      panelLogger.error("lineage hidden cards", error);
      setHidden([]);
    });
  }, []);
  return hidden;
};

/** The hidden cards by id, each with the label it was hidden with; the id stands in only when no label was stored. */
export const hiddenCardsOf = (
  cards: lineage.HiddenCard[],
): { id: string; name: string }[] =>
  cards.map((card) => ({ id: card.id, name: card.label ?? card.id }));

/** No Scope filter, and no card softened or dimmed. */
const ALL_ON: lineage.LineageScope = {
  offTypes: [],
  offTags: [],
  softened: [],
  dimmed: [],
};

/**
 * The Scope settings the host kept for the workspace, with `undefined` until they arrive. A failed read filters nothing.
 * A change is applied at once and persisted, as a hidden card is; it is not a rebuild, so nothing is fetched again.
 */
export const useStoredScope = (): {
  scope: lineage.LineageScope | undefined;
  change: (scope: lineage.LineageScope) => void;
} => {
  const [stored, setStored] = useState<lineage.LineageScope>();
  useEffect(() => {
    fetchLineageScope().then(setStored, (error) => {
      panelLogger.error("lineage scope", error);
      setStored(ALL_ON);
    });
  }, []);
  const change = useCallback((scope: lineage.LineageScope) => {
    setStored(scope);
    persistLineageScope(scope);
  }, []);
  return { scope: stored, change };
};

/** The Scope control: the filters, the node types and tags the graph holds, the count they take out, and its changes. */
export interface ScopeControls {
  /** False until the stored filters arrive; the graph is held until then, and the controls are disabled. */
  ready: boolean;
  /** The Scope settings: the node types and tags switched off, and the cards softened or dimmed. */
  scope: lineage.LineageScope;
  /** The node types the graph holds, each once and sorted. */
  types: string[];
  /** The tags the graph's cards carry, each once and sorted. */
  tags: string[];
  /** The cards the filters take out of the drawn graph. */
  filteredOut: number;
  /** The busy-node list: the cards with more connections than the threshold, and their actions. */
  busy: BusyControls;
  setType: (type: string, on: boolean) => void;
  setTag: (tag: string, on: boolean) => void;
  /** Switches every type and tag back on, and leaves the busy cards as they are. */
  showAll: () => void;
}

export const useScopeControls = (
  graph: GraphState,
  stored: lineage.LineageScope | undefined,
  change: (scope: lineage.LineageScope) => void,
): Omit<ScopeControls, "busy"> => {
  const { types, tags } = useMemo(
    () => scopeChoices(Object.values(graph.known)),
    [graph.known],
  );
  const filteredOut = useMemo(() => visibleOf(graph).scopedOut, [graph]);
  const setType = useCallback(
    (type: string, on: boolean) => {
      if (stored) {
        change({ ...stored, offTypes: withName(stored.offTypes, type, on) });
      }
    },
    [stored, change],
  );
  const setTag = useCallback(
    (tag: string, on: boolean) => {
      if (stored) {
        change({ ...stored, offTags: withName(stored.offTags, tag, on) });
      }
    },
    [stored, change],
  );
  // Show all switches the types and tags on; the softened and dimmed cards keep their own undo in the busy-node list.
  const showAll = useCallback(() => {
    if (stored) {
      change({ ...stored, offTypes: [], offTags: [] });
    }
  }, [stored, change]);
  return {
    ready: stored !== undefined,
    scope: stored ?? ALL_ON,
    types,
    tags,
    filteredOut,
    setType,
    setTag,
    showAll,
  };
};
