/**
 * Sub-row placement for the layered layout: each generation is split into one sub-row per layer, adjacent sub-rows
 * merge where no edge joins them, and each row's cards are placed either side of the central corridor.
 */
import {
  CARD_GAP,
  CORRIDOR,
  type LayeredNode,
  type Point,
  type Side,
} from "./layeredMetrics";
import { OTHER_TAG, tagRank } from "./layerTags";

export interface SubRow {
  tag: string;
  ids: string[];
}

/**
 * The sub-rows of one generation, one per layer. The layer the row above used comes first, and the untagged
 * cards join the first sub-row.
 */
function splitGeneration(
  here: readonly string[],
  tagOf: ReadonlyMap<string, string>,
  start: string,
  previous: string | undefined,
): SubRow[] {
  const isOther = (id: string): boolean =>
    tagOf.get(id) === OTHER_TAG && id !== start;
  const others = here.filter(isOther);
  const tagged = here.filter((id) => !isOther(id));
  const tags = [
    ...new Set(tagged.map((id) => tagOf.get(id) ?? OTHER_TAG)),
  ].sort(
    (p, q) =>
      Number(q === previous) - Number(p === previous) ||
      tagRank(p) - tagRank(q),
  );
  if (tags.length === 0) {
    return [{ tag: OTHER_TAG, ids: others }];
  }
  return tags.map((tag, index) => {
    const ids = tagged.filter((id) => tagOf.get(id) === tag);
    return { tag, ids: index === 0 ? [...ids, ...others] : ids };
  });
}

/** Whether two adjacent sub-rows may merge: the same tag, no edge joining them, and neither holding the start node. */
function canMerge(
  upper: SubRow,
  lower: SubRow,
  start: string,
  edges: readonly (readonly [string, string])[],
): boolean {
  const holdsStart = upper.ids.includes(start) || lower.ids.includes(start);
  const linked = edges.some(
    ([parent, child]) =>
      (upper.ids.includes(parent) && lower.ids.includes(child)) ||
      (lower.ids.includes(parent) && upper.ids.includes(child)),
  );
  return upper.tag === lower.tag && !holdsStart && !linked;
}

/** Merges adjacent sub-rows in place wherever `canMerge` allows it. */
function mergeAdjacentRows(
  rows: SubRow[],
  start: string,
  edges: readonly (readonly [string, string])[],
): void {
  let index = 0;
  while (index + 1 < rows.length) {
    const upper = rows[index];
    const lower = rows[index + 1];
    if (!upper || !lower) {
      break;
    }
    if (canMerge(upper, lower, start, edges)) {
      upper.ids.push(...lower.ids);
      rows.splice(index + 1, 1);
    } else {
      index++;
    }
  }
}

/**
 * One sub-row per layer inside each generation, top to bottom. Adjacent same-tag sub-rows merge when no edge joins
 * them and neither holds the start node.
 */
export function subRows(
  start: string,
  nodes: readonly LayeredNode[],
  gen: ReadonlyMap<string, number>,
  edges: readonly (readonly [string, string])[],
): SubRow[] {
  const tagOf = new Map(nodes.map((node) => [node.id, node.tag] as const));
  const generationsPresent = [
    ...new Set(nodes.map((node) => gen.get(node.id) ?? 0)),
  ].sort((p, q) => p - q);

  const rows: SubRow[] = [];
  for (const generation of generationsPresent) {
    const here = nodes
      .map((node) => node.id)
      .filter((id) => (gen.get(id) ?? 0) === generation);
    rows.push(...splitGeneration(here, tagOf, start, rows.at(-1)?.tag));
  }
  mergeAdjacentRows(rows, start, edges);
  return rows;
}

/** The mean centre a card is pulled towards by its neighbours, with each past neighbour counted three times. */
export function nearCentre(
  id: string,
  r: number,
  edges: readonly (readonly [string, string])[],
  rel: (id: string) => number,
  centres: ReadonlyMap<string, number>,
): number {
  const neighbours = nearerNeighbours(id, r, edges, rel);
  const past = pastNeighbours(id, r, edges, rel);
  const xs = [
    ...neighbours.map((other) => centres.get(other) ?? 0),
    ...past.flatMap((other) => {
      const centre = centres.get(other);
      return centre === undefined ? [] : [centre, centre, centre];
    }),
  ];
  return xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

/** The neighbours of `id` that sit nearer the centre line than row offset `r`, on the same side of it. */
function nearerNeighbours(
  id: string,
  r: number,
  edges: readonly (readonly [string, string])[],
  rel: (id: string) => number,
): string[] {
  const closer = (other: string): boolean =>
    Math.abs(rel(other)) < Math.abs(r) &&
    Math.sign(rel(other)) !== -Math.sign(r);
  return edges.flatMap(([parent, child]): string[] => {
    if (parent === id && closer(child)) {
      return [child];
    }
    if (child === id && closer(parent)) {
      return [parent];
    }
    return [];
  });
}

/** The neighbours of `id` that sit past the centre line, on the far side from row offset `r`. */
function pastNeighbours(
  id: string,
  r: number,
  edges: readonly (readonly [string, string])[],
  rel: (id: string) => number,
): string[] {
  return edges.flatMap(([parent, child]): string[] => {
    if (parent === id && rel(child) > 0 && r < 0) {
      return [child];
    }
    if (child === id && rel(parent) < 0 && r > 0) {
      return [parent];
    }
    return [];
  });
}

/** The centres of the nearer cards that an edge from beyond row offset `r` ends on. */
export function throughCentres(
  r: number,
  edges: readonly (readonly [string, string])[],
  rel: (id: string) => number,
  centres: ReadonlyMap<string, number>,
  focus: string,
): number[] {
  const out = (other: string): boolean =>
    Math.abs(rel(other)) > Math.abs(r) &&
    Math.sign(rel(other)) === Math.sign(r);
  const nearer = (other: string): boolean =>
    centres.has(other) && other !== focus && Math.abs(rel(other)) < Math.abs(r);
  return edges.flatMap(([parent, child]): number[] => {
    if (out(parent) && nearer(child)) {
      return [centres.get(child) ?? 0];
    }
    if (out(child) && nearer(parent)) {
      return [centres.get(parent) ?? 0];
    }
    return [];
  });
}

/** A card whose target column runs through a nearer card's column moves to the far side of the centre line. */
export function clearOf(
  x: number,
  width: number,
  crossed: readonly number[],
): number {
  const blocker = crossed.find((t) => Math.abs(t - x) < width / 2 + CARD_GAP);
  if (blocker === undefined) {
    return x;
  }
  const away = Math.max(Math.abs(x), 1);
  return blocker >= 0 ? -away : away;
}

/**
 * Splits a row's cards either side of the centre line. Cards with no neighbour information sit on the centre line;
 * they fill the lighter side, nearest the corridor.
 */
export function splitSides(sorted: readonly (readonly [string, number])[]): {
  left: string[];
  right: string[];
} {
  const left: string[] = [];
  const right: string[] = [];
  const undecided: string[] = [];
  for (const [id, x] of sorted) {
    if (x < 0) {
      left.push(id);
    } else if (x > 0) {
      right.push(id);
    } else {
      undecided.push(id);
    }
  }
  for (const id of undecided) {
    if (left.length <= right.length) {
      left.push(id);
    } else {
      right.unshift(id);
    }
  }
  return { left, right };
}

/**
 * Moves the focused card so its centre is midway between the outer edges of the layered cards on either side, the
 * centre of the corridor between the left and right groups. The row stacks are laid out from the corridor, so a
 * group wider on one side pulls the focus off the middle; the focus alone moves. A focus with other layered cards in
 * its row keeps its place, since they would overlap it.
 */
export function centreFocus(
  focus: string,
  focusRowIds: readonly string[],
  positions: Map<string, Point>,
  width: (id: string) => number,
  isOtherNode: (id: string) => boolean,
): void {
  const others = focusRowIds.filter((id) => id !== focus && !isOtherNode(id));
  const sides = [...positions.keys()].filter(
    (id) => id !== focus && !isOtherNode(id),
  );
  if (others.length > 0 || sides.length === 0) {
    return;
  }
  const left = Math.min(...sides.map((id) => positions.get(id)?.x ?? 0));
  const right = Math.max(
    ...sides.map((id) => (positions.get(id)?.x ?? 0) + width(id)),
  );
  positions.set(focus, { x: (left + right - width(focus)) / 2, y: 0 });
}

/** The left x of every card on one side pair, stacked outwards from the corridor in placement order. */
export function sideXs(
  sides: { left: string[]; right: string[] },
  width: (id: string) => number,
): [string, number][] {
  const xs: [string, number][] = [];
  let x = -CORRIDOR / 2;
  for (const id of [...sides.left].reverse()) {
    x -= width(id);
    xs.push([id, x]);
    x -= CARD_GAP;
  }
  x = CORRIDOR / 2;
  for (const id of sides.right) {
    xs.push([id, x]);
    x += width(id) + CARD_GAP;
  }
  return xs;
}

/**
 * Side stacks for the Other cards, one per sub-row, beyond the layered cards.
 * Returns each card's left x, and the outer edge of the stacks.
 */
export function otherColumn(
  rows: readonly SubRow[],
  columnStart: number,
  otherSide: Side,
  isOtherNode: (id: string) => boolean,
  width: (id: string) => number,
): { slots: [string, number][]; far: number } {
  const slots: [string, number][] = [];
  let far = columnStart;
  for (const row of rows) {
    let x = columnStart;
    for (const id of row.ids.filter(isOtherNode)) {
      const left = otherSide > 0 ? x : x - width(id);
      slots.push([id, left]);
      x += otherSide * (width(id) + CARD_GAP);
      far =
        otherSide > 0
          ? Math.max(far, x - CARD_GAP)
          : Math.min(far, x + CARD_GAP);
    }
  }
  return { slots, far };
}
