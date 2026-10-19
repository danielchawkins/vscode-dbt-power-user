import type { FetchNeighbours, GraphStore } from "./graph";
import { drawnIds, expand, parseExpansion } from "./graph";

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

/** Applies saved expansion keys in order; a key whose table is not drawn by then is skipped. */
export async function replayExpansions(
  store: GraphStore,
  keys: readonly string[],
  fetch: FetchNeighbours,
): Promise<void> {
  for (const key of keys) {
    const parsed = parseExpansion(key);
    if (parsed && drawnIds(store.get()).has(parsed[1])) {
      await expand(store, parsed[0], parsed[1], fetch);
    }
  }
}
