import { sortedInInputOrder } from "../comparators.js";
import { type OrderModel, setLayer, unitsOf } from "./model.js";

/**
 * What a cluster-aware arrangement knows: each layered node's cluster chain, and the sort key of each cluster's block.
 * A block's key is the same in every rank, so sibling clusters keep one order across the drawing; that order is what
 * lets their boxes be kept apart.
 */
export interface Arrangement {
  paths: readonly (readonly number[])[];
  blockKeys: readonly number[];
}

/** A unit with its cluster chain, its sort key and its place in the input, for ties. */
interface Item {
  unit: number[];
  path: readonly number[];
  key: number;
  order: number;
}

/** A unit, or the block of one cluster's units, placed by its key. */
interface Entry {
  key: number;
  order: number;
  units: number[][];
}

/**
 * Orders units by key so that every cluster's members stay contiguous: each cluster's units form one block, placed by
 * its block key, and a nested cluster's units are arranged the same way inside it (Forster, GD 2002). `keys[i]` is the
 * key of `units[i]`. With no clusters this is a stable sort by key.
 */
function arrange(
  context: Arrangement,
  units: readonly number[][],
  keys: readonly number[],
): number[][] {
  return arrangeAt(
    context,
    units.map((unit, i) => ({
      unit,
      path: context.paths[unit[0]!]!,
      key: keys[i]!,
      order: i,
    })),
    0,
  );
}

/** Arranges items whose chains agree up to `depth`, grouping them by their cluster at `depth`. */
function arrangeAt(
  context: Arrangement,
  items: readonly Item[],
  depth: number,
): number[][] {
  const blocks = new Map<number, Item[]>();
  const entries: Entry[] = [];
  for (const item of items) {
    const cluster = item.path[depth];
    if (cluster === undefined) {
      entries.push({ key: item.key, order: item.order, units: [item.unit] });
    } else {
      const members = blocks.get(cluster);
      if (members === undefined) {
        blocks.set(cluster, [item]);
      } else {
        members.push(item);
      }
    }
  }
  for (const [cluster, members] of blocks) {
    entries.push({
      key: context.blockKeys[cluster]!,
      order: cluster,
      units: arrangeAt(context, members, depth + 1),
    });
  }
  return sortedInInputOrder(entries, [(e) => e.key, (e) => e.order]).flatMap(
    (entry) => entry.units,
  );
}

/**
 * The block key of each cluster: the mean position of its members over the whole order, so a cluster sorts the same way
 * in every rank. A cluster with no members has key 0.
 */
function clusterKeys(model: OrderModel): number[] {
  const { paths } = model.graph;
  const total: number[] = [];
  const count: number[] = [];
  paths.forEach((path, x) => {
    for (const cluster of path) {
      total[cluster] = (total[cluster] ?? 0) + model.index[x]!;
      count[cluster] = (count[cluster] ?? 0) + 1;
    }
  });
  return Array.from({ length: total.length }, (_, c) =>
    count[c] === undefined ? 0 : total[c]! / count[c],
  );
}

/**
 * Gathers each rank's clusters into contiguous blocks, keeping the order of each unit's place. Ranks that come from a
 * starting order or a shuffle need this before a search, since the search only keeps clusters contiguous from then on.
 */
export function gatherClusters(model: OrderModel): void {
  const context = arrangement(model);
  model.layers.forEach((_, rank) =>
    arrangeRank(model, rank, {
      context,
      keyOf: (unit) => model.index[unit[0]!]!,
    }),
  );
}

/** Reorders one rank by `keyOf` of its units, with its clusters gathered and placed by the block keys of `context`. */
export function arrangeRank(
  model: OrderModel,
  rank: number,
  {
    context,
    keyOf,
  }: { context: Arrangement; keyOf: (unit: readonly number[]) => number },
): void {
  const units = unitsOf(model.layers[rank]!, model.graph.block);
  setLayer(model, rank, arrange(context, units, units.map(keyOf)).flat());
}

/** The arrangement of `model`'s clusters, with their block keys as they stand. */
export function arrangement(model: OrderModel): Arrangement {
  return { paths: model.graph.paths, blockKeys: clusterKeys(model) };
}

/** Whether two units lie in the same innermost cluster, so that swapping them keeps every cluster contiguous. */
export function sameChain(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/**
 * The slots at which a unit with chain `own` may be placed among `others`, the other units' chains in order, the unit
 * now sitting at slot `here`: slot k puts the unit after the first k of them. A slot is legal when the unit can reach it
 * without passing a sibling unit, since siblings must keep their order in every rank, and it keeps every cluster
 * contiguous: each cluster of `own` that has other members is next to one of them, and no cluster the unit is not in is
 * cut by it.
 */
export function legalSlots(
  own: readonly number[],
  others: readonly (readonly number[])[],
  here: number,
): boolean[] {
  const present = new Set(others.flat());
  const reach = passable(own, others, here);
  const slots: boolean[] = [];
  for (let k = 0; k <= others.length; k++) {
    const left = k > 0 ? others[k - 1]! : [];
    const right = k < others.length ? others[k]! : [];
    slots.push(reach[k]! && legalBetween(own, [left, right], present));
  }
  return slots;
}

/** Whether a unit may reach each slot from `here` without passing a sibling of `own`. */
function passable(
  own: readonly number[],
  others: readonly (readonly number[])[],
  here: number,
): boolean[] {
  const reach = others.map(() => false);
  reach.push(false);
  reach[here] = true;
  for (let k = here + 1; k <= others.length; k++) {
    reach[k] = reach[k - 1]! && !siblings(own, others[k - 1]!);
  }
  for (let k = here - 1; k >= 0; k--) {
    reach[k] = reach[k + 1]! && !siblings(own, others[k]!);
  }
  return reach;
}

/** Whether two chains part at some depth, so that their units are siblings: passing one flips their order. */
function siblings(a: readonly number[], b: readonly number[]): boolean {
  const depth = Math.min(a.length, b.length);
  return a.slice(0, depth).some((c, i) => c !== b[i]);
}

function legalBetween(
  own: readonly number[],
  [left, right]: readonly [readonly number[], readonly number[]],
  present: ReadonlySet<number>,
): boolean {
  const beside = (c: number): boolean => left.includes(c) || right.includes(c);
  return (
    own.every((c) => !present.has(c) || beside(c)) &&
    left.every((c) => !right.includes(c) || own.includes(c))
  );
}
