import type { LayeredGraph } from "../layeredGraph.js";
import type { LayoutGraph } from "../types.js";

/** The side of an opaque box a layered node is on: -1 above it in the rank, 1 below it, 0 inside, undefined unknown. */
type Side = -1 | 0 | 1;

/** One opaque box being kept clear, and the ordering it works on. */
interface Wall {
  layered: LayeredGraph;
  /** Each rank's order, changed in place. */
  out: number[][];
  /** The box's cluster index. */
  ci: number;
  /** Nodes that are alone in their block, so that they can move without taking a port dummy with them. */
  alone: ReadonlySet<number>;
}

/** Passes over the boxes and bundles: a move for one bundle can undo one for another, so the pass repeats. */
const PASSES = 3;

/**
 * Keeps each foreign edge on one side of every opaque box it does not belong to, across the ranks the box spans. A
 * chain that changes side of a box between two ranks must cross the box's interior in the gap between them, which the
 * router cannot draw, and a chain whose two ends lie on opposite sides of a box must do so in some gap. So, for each
 * run of a chain inside the span of a foreign box, the run takes one side: the side of a fixed end (a port dummy, or
 * a real node with lateral ports), else the side most of its nodes already take. Nodes on the other side move beside
 * the box's block in that rank: chain dummies, and real ends of the chain, which keep their rank. A node moves only
 * when every cluster it or its neighbours belong to stays contiguous in the rank. A run that cannot be fixed is left
 * as it is, and routing flags its edge.
 *
 * Returns a reordered copy of `layers`; a layout with no opaque cluster is returned unchanged.
 */
export function keepOutside(
  graph: LayoutGraph,
  layered: LayeredGraph,
  layers: number[][],
): number[][] {
  const boxes = (graph.clusters ?? []).flatMap((cluster, ci) =>
    cluster.opaque === true ? [ci] : [],
  );
  if (boxes.length === 0) {
    return layers;
  }
  const out = layers.map((layer) => [...layer]);
  const alone = aloneNodes(layered);
  for (let pass = 0; pass < PASSES; pass++) {
    const before = JSON.stringify(out);
    for (const ci of boxes) {
      keepBoxClear({ layered, out, ci, alone });
    }
    if (JSON.stringify(out) === before) {
      break;
    }
  }
  return out;
}

/** One opaque box's pass: every foreign bundle that enters its span is fixed to one side. */
function keepBoxClear(wall: Wall): void {
  const { layered, ci } = wall;
  const span = spanOf(layered, ci);
  if (span === undefined) {
    return;
  }
  for (const bundle of layered.bundles) {
    const chain = bundle.chain;
    if (
      !bundle.flat &&
      !owns(layered, chain[0]!, ci) &&
      !owns(layered, chain.at(-1)!, ci)
    ) {
      fixChain(wall, span, chain);
    }
  }
}

/** The nodes whose block holds no other node: a real node without lateral ports, or a dummy. */
function aloneNodes(layered: LayeredGraph): Set<number> {
  const size = new Map<number, number>();
  for (const block of layered.block) {
    size.set(block, (size.get(block) ?? 0) + 1);
  }
  const alone = new Set<number>();
  layered.block.forEach((block, x) => {
    if (block === x && size.get(block) === 1) {
      alone.add(x);
    }
  });
  return alone;
}

/** Fixes each maximal run of a chain that lies in the box's span. */
function fixChain(
  wall: Wall,
  span: { top: number; bottom: number },
  chain: readonly number[],
): void {
  const { layered } = wall;
  let k = 0;
  while (k < chain.length) {
    if (!inSpan(layered, chain[k]!, span)) {
      k += 1;
      continue;
    }
    let end = k;
    while (end + 1 < chain.length && inSpan(layered, chain[end + 1]!, span)) {
      end += 1;
    }
    fixRun(wall, chain.slice(k, end + 1));
    k = end + 1;
  }
}

/** The ranks from the top member's rank down to the bottom member's. */
function spanOf(
  layered: LayeredGraph,
  ci: number,
): { top: number; bottom: number } | undefined {
  let top: number | undefined;
  let bottom: number | undefined;
  layered.nodes.forEach((node, x) => {
    if (owns(layered, x, ci)) {
      top = Math.min(top ?? node.rank, node.rank);
      bottom = Math.max(bottom ?? node.rank, node.rank);
    }
  });
  return top === undefined || bottom === undefined
    ? undefined
    : { top, bottom };
}

function owns(layered: LayeredGraph, x: number, ci: number): boolean {
  return layered.paths[x]?.includes(ci) === true;
}

function inSpan(
  layered: LayeredGraph,
  x: number,
  span: { top: number; bottom: number },
): boolean {
  const rank = layered.nodes[x]!.rank;
  return rank >= span.top && rank <= span.bottom;
}

/**
 * Whether a run node may move: alone in its block, without a lateral port, and in no cluster. A clustered node moves
 * the order between boxes, which placement must keep acyclic, so only unclustered nodes move.
 */
function movable(wall: Wall, x: number): boolean {
  const { layered, alone } = wall;
  return (
    alone.has(x) &&
    layered.nodes[x]!.port === undefined &&
    (layered.paths[x]?.length ?? 0) === 0
  );
}

/** The side of the box that `x` is on in its rank, from the block of the box's members in that rank. */
function sideOf(wall: Wall, x: number): Side | undefined {
  const layer = wall.out[wall.layered.nodes[x]!.rank]!;
  const members = membersIn(wall, layer);
  if (members.length === 0) {
    return undefined;
  }
  const first = members[0]!;
  const last = members.at(-1)!;
  if (last - first + 1 !== members.length) {
    return undefined;
  }
  const at = layer.indexOf(x);
  if (at < first) {
    return -1;
  }
  return at > last ? 1 : 0;
}

/** The positions in `layer` of the box's members. */
function membersIn(wall: Wall, layer: readonly number[]): number[] {
  return layer.flatMap((m, i) => (owns(wall.layered, m, wall.ci) ? [i] : []));
}

/** Puts the run on one side of the box; leaves it alone when no single side is possible. */
function fixRun(wall: Wall, run: readonly number[]): void {
  const sides = run.map((x) => sideOf(wall, x));
  if (sides.some((side) => side === undefined || side === 0)) {
    return;
  }
  const fixed = run.flatMap((x, i) => (movable(wall, x) ? [] : [sides[i]!]));
  if (new Set(fixed).size > 1) {
    return;
  }
  const target: Side =
    fixed[0] ??
    (sides.filter((side) => side === 1).length >
    sides.filter((side) => side === -1).length
      ? 1
      : -1);
  run.forEach((x, i) => {
    if (sides[i] !== target && movable(wall, x)) {
      moveBeside(wall, x, target);
    }
  });
}

/**
 * Moves node `x` to the boundary of the box's block on `side`. The move is kept only if every cluster a node at the
 * new place or the node itself belongs to stays contiguous in the rank; otherwise `x` returns to its place.
 */
function moveBeside(wall: Wall, x: number, side: Side): void {
  const { layered, out } = wall;
  const layer = out[layered.nodes[x]!.rank]!;
  const before = [...layer];
  layer.splice(layer.indexOf(x), 1);
  const members = membersIn(wall, layer);
  const boundary = side < 0 ? members[0]! : members.at(-1)! + 1;
  layer.splice(boundary, 0, x);
  const touched = new Set<number>(layered.paths[x] ?? []);
  for (const neighbour of [layer[boundary - 1], layer[boundary + 1]]) {
    for (const c of layered.paths[neighbour ?? -1] ?? []) {
      touched.add(c);
    }
  }
  if (!contiguous(layered, layer, touched)) {
    layer.splice(0, layer.length, ...before);
  }
}

/** Whether, for each cluster in `clusters`, its members in `layer` are adjacent. */
function contiguous(
  layered: LayeredGraph,
  layer: readonly number[],
  clusters: ReadonlySet<number>,
): boolean {
  for (const c of clusters) {
    const at = layer.flatMap((m, i) => (owns(layered, m, c) ? [i] : []));
    if (at.length > 0 && at.at(-1)! - at[0]! + 1 !== at.length) {
      return false;
    }
  }
  return true;
}
