import type { Separation } from "./types.js";

/**
 * The classes that lie on or between directed cycles of the separations: those left after repeatedly removing a class
 * with no incoming separation. Empty when the separations form a DAG.
 */
export function cyclicClasses(
  count: number,
  separations: readonly Separation[],
): number[] {
  const indegree = Array.from({ length: count }, () => 0);
  const succ = Array.from({ length: count }, (): number[] => []);
  for (const { from, to } of separations) {
    succ[from]!.push(to);
    indegree[to]! += 1;
  }
  const queue = indegree.flatMap((d, c) => (d === 0 ? [c] : []));
  for (const c of queue) {
    for (const to of succ[c]!) {
      indegree[to]! -= 1;
      if (indegree[to] === 0) {
        queue.push(to);
      }
    }
  }
  return indegree.flatMap((d, c) => (d > 0 ? [c] : []));
}
