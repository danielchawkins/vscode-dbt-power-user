import { openGroup } from "./expansionGroups";
import type { FetchNeighbours, GraphStore } from "./graph";
import { drawnIds, expand, parseExpansion } from "./graph";
import { parseGroupNodeId } from "./grouping";

/** Expands the start table `levels` levels of parents and of children. */
export async function expandLevels(
  store: GraphStore,
  levels: number,
  fetch: FetchNeighbours,
): Promise<void> {
  const start = store.get().start;
  if (!start) {
    return;
  }
  for (const direction of ["parents", "children"] as const) {
    let frontier = [start];
    for (let level = 0; level < levels && frontier.length > 0; level++) {
      const added = await Promise.all(
        frontier.map((table) => expand(store, direction, table, fetch)),
      );
      frontier = [...new Set(added.flat())];
    }
  }
}

/**
 * Applies saved expansion keys in order; a key whose table is not drawn by then is skipped. Each applied key's saved
 * groups open right after it, so that a member's own saved expansion, which comes later, finds its table drawn.
 * A saved group ID that is not an applied group leaves the state as it is.
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
      await expand(store, parsed[0], parsed[1], fetch);
      for (const id of openGroups) {
        if (parseGroupNodeId(id)?.[0] === key) {
          store.update((s) => openGroup(s, id));
        }
      }
    }
  }
}
