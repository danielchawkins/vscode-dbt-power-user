import type { Direction, GraphState } from "./graph";
import { drawnNeighbours, expansionKey, shownWithout } from "./graph";

/** How many neighbours each capped expansion does not draw yet, by expansion key; uncapped keys are absent. */
export const hiddenCounts = (state: GraphState): Record<string, number> =>
  Object.fromEntries(
    Object.keys(state.shown).map((key) => [
      key,
      (state.neighbours[key]?.length ?? 0) - drawnNeighbours(state, key).length,
    ]),
  );

/** Draws the next `cap` of `table`'s `direction` neighbours. */
export function showMore(
  state: GraphState,
  direction: Direction,
  table: string,
): GraphState {
  const key = expansionKey(direction, table);
  const total = state.neighbours[key]?.length ?? 0;
  const next = (state.shown[key] ?? total) + (state.cap || total);
  const rest = shownWithout(state, key);
  return { ...state, shown: next >= total ? rest : { ...rest, [key]: next } };
}
