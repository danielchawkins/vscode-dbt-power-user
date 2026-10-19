import { drawnGraph, parseExpansion } from "./graph";
import type { GraphState } from "./graph";
import { groupLabel, groupNodeId } from "./grouping";

/** A closed bucket of an applied expansion, drawn as one group card in place of its members. */
export interface GroupView {
  id: string;
  label: string;
  /** How many neighbours the group stands for. */
  count: number;
  /** The `[parent, child]` pair joining the group to the expansion's table. */
  edge: [string, string];
}

/**
 * The closed buckets of applied expansions whose table is drawn, sorted by ID. An open bucket's members are drawn,
 * so only closed buckets become groups.
 */
export function collapsedGroups(state: GraphState): GroupView[] {
  const drawn = new Set(drawnGraph(state).tables.map((t) => t.table));
  return state.expansions
    .flatMap((key) => {
      const parsed = parseExpansion(key);
      const groups = state.groups[key];
      if (!parsed || !groups || !drawn.has(parsed[1])) {
        return [];
      }
      const [direction, table] = parsed;
      return groups.buckets
        .filter((bucket) => !groups.open[bucket.key])
        .map((bucket): GroupView => {
          const id = groupNodeId(key, bucket.key);
          return {
            id,
            label: groupLabel(bucket.key),
            count: bucket.members.length,
            edge: direction === "children" ? [table, id] : [id, table],
          };
        });
    })
    .toSorted((a, b) => a.id.localeCompare(b.id));
}
