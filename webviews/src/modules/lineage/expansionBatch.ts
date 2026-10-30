import { restoreGroupId } from "./expansionGroups";
import type { FetchNeighbours, GraphStore } from "./graph";
import { drawnIds, expand, fetchExpansion, parseExpansion } from "./graph";

/**
 * Expands the start table: `depths.parents` levels of parents and `depths.children` levels of children, each level
 * the neighbours of the one before. A card an expansion already covers is not fetched again.
 */
export async function expandDepths(
  store: GraphStore,
  depths: { parents: number; children: number },
  fetch: FetchNeighbours,
): Promise<void> {
  const start = store.get().start;
  if (!start) {
    return;
  }
  for (const direction of ["parents", "children"] as const) {
    let frontier = [start];
    for (
      let level = 0;
      level < depths[direction] && frontier.length > 0;
      level++
    ) {
      const added = await Promise.all(
        frontier.map((table) => expand(store, [direction, table], fetch)),
      );
      frontier = [...new Set(added.flat())];
    }
  }
}

/**
 * Applies saved expansion keys in order; a key whose table is not drawn by then is skipped. Right after each applied
 * key, every saved open group ID goes through `restoreGroupId` with that key, in a single `store.update`, so only the
 * closed buckets of that key reopen and any other ID leaves the state as it is. A member's own saved expansion, which
 * comes later, then finds its table drawn.
 */
export async function replayExpansions(
  store: GraphStore,
  {
    expansions,
    openGroups = [],
  }: { expansions: readonly string[]; openGroups?: readonly string[] },
  fetch: FetchNeighbours,
): Promise<void> {
  for (const key of expansions) {
    const parsed = parseExpansion(key);
    if (parsed && drawnIds(store.get()).has(parsed[1])) {
      await fetchExpansion(store, key, fetch);
      store.update((s) =>
        openGroups.reduce((state, id) => restoreGroupId(state, key, id), s),
      );
    }
  }
}
