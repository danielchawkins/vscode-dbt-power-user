import type { GroupView } from "./expansionGroups";
import type { GraphState } from "./graph";
import { drawnIds, knownPairs } from "./graph";
import { groupNodeId } from "./grouping";
import { hiddenTables } from "./hiddenNodes";

/** The table a group hangs off: the end of its edge that is not the group. */
const hubOf = (group: GroupView): string =>
  group.edge[0] === group.id ? group.edge[1] : group.edge[0];

/** The member IDs of each group, by group node ID, from the buckets of every expansion. */
const bucketMembers = (state: GraphState): Map<string, string[]> =>
  new Map(
    state.expansions.flatMap((key) =>
      (state.groups[key]?.buckets ?? []).map((bucket): [string, string[]] => [
        groupNodeId(key, bucket.key),
        bucket.members,
      ]),
    ),
  );

/**
 * The groups that draw edges, and for each table that a drawn group holds visibly, the IDs of those groups. A group
 * draws edges when its table is visible and at least one of its members is.
 */
function visibleGroups(
  state: GraphState,
  groups: readonly GroupView[],
  hidden: ReadonlySet<string>,
): { shown: GroupView[]; groupsOf: Map<string, string[]> } {
  const members = bucketMembers(state);
  const shown: GroupView[] = [];
  const groupsOf = new Map<string, string[]>();
  for (const group of groups) {
    const visible = (members.get(group.id) ?? []).filter(
      (member) => !hidden.has(member),
    );
    if (hidden.has(hubOf(group)) || visible.length === 0) {
      continue;
    }
    shown.push(group);
    for (const member of visible) {
      groupsOf.set(member, [...(groupsOf.get(member) ?? []), group.id]);
    }
  }
  return { shown, groupsOf };
}

/**
 * The edges that join the closed `groups` to the drawn graph, each `[parent, child]`: each group's edge to its table,
 * and each known pair with an end in a group, that end replaced by the group. A group whose table is hidden, or that
 * has no visible member, draws no edge. A hidden member draws none. A member drawn elsewhere is a drawn table, so its
 * pairs are table edges, not group edges. A pair with both ends drawn is a table edge too.
 */
export function combinedEdges(
  state: GraphState,
  groups: readonly GroupView[],
): [string, string][] {
  const hidden = hiddenTables(state);
  const drawn = drawnIds(state);
  const { shown, groupsOf } = visibleGroups(state, groups, hidden);
  const endsOf = (table: string): string[] => {
    if (hidden.has(table)) {
      return [];
    }
    return drawn.has(table) ? [table] : (groupsOf.get(table) ?? []);
  };
  const edges = new Map<string, [string, string]>();
  const add = (edge: [string, string]) => edges.set(edge.join("\u0000"), edge);
  shown.forEach((group) => add(group.edge));
  for (const [parent, child] of knownPairs(state)) {
    if (drawn.has(parent) && drawn.has(child)) {
      continue;
    }
    for (const from of endsOf(parent)) {
      for (const to of endsOf(child)) {
        if (from !== to) {
          add([from, to]);
        }
      }
    }
  }
  return [...edges.values()];
}
