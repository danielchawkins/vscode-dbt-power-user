import type { lineage } from "@fusion-power-user/webview-contract";
import { useMemo } from "react";
import { useBusyCards } from "./busyCards";
import type { GraphScope, GraphState } from "./graph";
import {
  type ScopeControls,
  type useStoredScope,
  useScopeControls,
} from "./useStoredFilters";

/**
 * The Scope settings the graph reads: the filters and the softened cards. The dimmed cards are left out, so a dim
 * restyles the flow without a new graph, and its identity changes only when one of these lists does.
 */
export const useGraphScope = (
  stored: lineage.LineageScope | undefined,
): GraphScope | undefined => {
  const offTypes = stored?.offTypes;
  const offTags = stored?.offTags;
  const softened = stored?.softened;
  return useMemo(
    () =>
      offTypes && offTags && softened
        ? { offTypes, offTags, softened }
        : undefined,
    [offTypes, offTags, softened],
  );
};

/**
 * The Scope control with its busy-node list: the filters, and the cards with more connections than `threshold`, each
 * with Hide, Soften and Dim. The stored Scope is the one `useStoredScope` returns.
 */
export const useBusyControls = ({
  graph,
  threshold,
  stored,
  hide,
}: {
  graph: GraphState;
  threshold: number;
  stored: ReturnType<typeof useStoredScope>;
  hide: (table: string, label: string) => void;
}): ScopeControls => {
  const filters = useScopeControls(graph, stored.scope, stored.change);
  const busy = useBusyCards({
    graph,
    threshold,
    scope: stored.scope,
    change: stored.change,
    hide,
  });
  return { ...filters, busy };
};
