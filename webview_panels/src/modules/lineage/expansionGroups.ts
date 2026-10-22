import { drawnGraph, drawnIds, parseExpansion, prune } from "./graph";
import type { GraphState } from "./graph";
import { groupLabel, groupNodeId, parseGroupNodeId } from "./grouping";
import { layerTagOf } from "./layered";

/**
 * Opens the closed group `id`, so that its first `cap` members are drawn as ordinary cards (all of them when `cap`
 * is 0). An ID that is not a bucket of an applied expansion leaves the state as it is.
 */
export function openGroup(state: GraphState, id: string): GraphState {
  const parsed = parseGroupNodeId(id);
  if (!parsed) {
    return state;
  }
  const [expansion, key] = parsed;
  const groups = state.groups[expansion];
  const bucket = groups?.buckets.find((b) => b.key === key);
  if (!groups || !bucket) {
    return state;
  }
  const size = bucket.members.length;
  const drawn = state.cap > 0 ? Math.min(state.cap, size) : size;
  return {
    ...state,
    groups: {
      ...state.groups,
      [expansion]: { ...groups, open: { ...groups.open, [key]: drawn } },
    },
  };
}

/**
 * Draws the next `cap` members of the open group `id`, or all the rest when there is no cap. An ID that is not an
 * open group leaves the state as it is.
 */
export function showMoreInGroup(state: GraphState, id: string): GraphState {
  const parsed = parseGroupNodeId(id);
  if (!parsed) {
    return state;
  }
  const [expansion, key] = parsed;
  const groups = state.groups[expansion];
  const bucket = groups?.buckets.find((b) => b.key === key);
  const drawn = groups?.open[key];
  if (!groups || !bucket || drawn === undefined) {
    return state;
  }
  const size = bucket.members.length;
  const next = Math.min(size, drawn + (state.cap || size));
  return {
    ...state,
    groups: {
      ...state.groups,
      [expansion]: { ...groups, open: { ...groups.open, [key]: next } },
    },
  };
}

/**
 * Closes the open group `id`: its members are no longer drawn, and `prune` removes what only they drew, such as their
 * expansions, column lists and selection. An ID that is not an open group leaves the state as it is.
 */
export function closeGroup(state: GraphState, id: string): GraphState {
  const parsed = parseGroupNodeId(id);
  if (!parsed) {
    return state;
  }
  const [expansion, key] = parsed;
  const groups = state.groups[expansion];
  if (groups?.open[key] === undefined) {
    return state;
  }
  const open = Object.fromEntries(
    Object.entries(groups.open).filter(([k]) => k !== key),
  );
  return prune({
    ...state,
    groups: { ...state.groups, [expansion]: { ...groups, open } },
  });
}

/** An open group of a drawn expansion, shown as a chip on the expanded table so that it can be closed. */
export interface GroupChip {
  /** The group's node ID, which `closeGroup` takes. */
  id: string;
  /** The expanded table the chip sits on. */
  table: string;
  label: string;
  /** How many of the group's members are drawn. */
  drawn: number;
  /** How many neighbours the group stands for. */
  total: number;
}

/**
 * The open groups of applied expansions whose table is drawn. Parents' chips come first, then children's, each in
 * the order its expansion was applied.
 */
export function groupChips(state: GraphState): GroupChip[] {
  const drawn = drawnIds(state);
  const rank = (key: string) =>
    parseExpansion(key)?.[0] === "parents" ? 0 : 1;
  return state.expansions
    .toSorted((a, b) => rank(a) - rank(b))
    .flatMap((key) => {
      const parsed = parseExpansion(key);
      const groups = state.groups[key];
      if (!parsed || !groups || !drawn.has(parsed[1])) {
        return [];
      }
      const [, table] = parsed;
      return groups.buckets
        .filter((bucket) => groups.open[bucket.key] !== undefined)
        .map((bucket): GroupChip => ({
          id: groupNodeId(key, bucket.key),
          table,
          label: groupLabel(bucket.key),
          drawn: groups.open[bucket.key] ?? 0,
          total: bucket.members.length,
        }));
    });
}

/** A closed bucket of an applied expansion, drawn as one group card in place of its members. */
export interface GroupView {
  id: string;
  label: string;
  /** How many neighbours the group stands for. */
  count: number;
  /** The `[parent, child]` pair joining the group to the expansion's table. */
  edge: [string, string];
  /** The layer tag of each member, which places the group by its dominant layer in the layered layout. */
  layerTags?: readonly string[] | undefined;
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
            layerTags: bucket.members.map((member) => {
              const known = state.known[member];
              return layerTagOf(known?.nodeType ?? "", known?.layer);
            }),
          };
        });
    })
    .toSorted((a, b) => a.id.localeCompare(b.id));
}
