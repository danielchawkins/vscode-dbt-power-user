/**
 * Layered lineage layout: rows run from the start node outwards (parents above, children below), each generation
 * is split into one sub-row per layer, and a central corridor keeps the start node's bubbles clear.
 *
 * Pure functions only. Card sizes come in with the input, so the layout never reads the DOM.
 */

export type Side = 1 | -1;

/** A band reaches this far past its cards on every side. */
export const BAND_PAD = 22;
/** The gap between two sub-rows that share one band. */
const SAME_ROW = 58;
/** Bare canvas between two bands, and around the Other column. */
export const GUTTER = 36;
/** Width of the clear strip between the cards on either side of the start node. */
export const CORRIDOR = 64;
/** The gap between two cards in one sub-row. */
export const CARD_GAP = 28;

/** Canvas margin above the first row, and beside the outermost band. */
const TOP_MARGIN = 40;
const SIDE_MARGIN = BAND_PAD + GUTTER + 8;

const SOURCE_TAG = "source";
export const OTHER_TAG = "other";
const LAYER_ORDER = ["source", "staging", "intermediate", "marts"];

/** The band tag for a node: sources and seeds share the source band, untagged nodes go to Other. */
export function layerTagOf(
  nodeType: string,
  layer: string | undefined,
): string {
  if (nodeType === "source" || nodeType === "seed") {
    return SOURCE_TAG;
  }
  return layer && layer.length > 0 ? layer : OTHER_TAG;
}

/** A theme colour id such as `charts.red` or `terminal.ansiCyan`: dotted words, as VS Code names its colours. */
const THEME_COLOUR = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
/** A CSS colour this setting accepts: hex, or an rgb/hsl/oklch-style function. Anything else is ignored. */
const CSS_COLOUR =
  /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([^;{}]*\))$/;

/**
 * The CSS colour of one `lineage.layerColors` entry: a theme colour id becomes its `--vscode-*` variable, so it
 * follows the theme; a hex or colour function is used as written. `undefined` for anything else.
 */
function layerColourValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (THEME_COLOUR.test(trimmed)) {
    return `var(--vscode-${trimmed.replaceAll(".", "-")})`;
  }
  return CSS_COLOUR.test(trimmed) ? trimmed : undefined;
}

/**
 * The CSS colour a band and card stripe of this tag use: the `overrides` entry for the tag when it is a usable
 * colour, else the theme's charts palette. Tags compare case-insensitively.
 */
export function bandColour(
  tag: string,
  overrides?: Readonly<Record<string, string>>,
): string {
  const key = tag.toLowerCase();
  const entry = Object.entries(overrides ?? {}).find(
    ([name]) => name.toLowerCase() === key,
  )?.[1];
  const custom = entry === undefined ? undefined : layerColourValue(entry);
  return custom ?? defaultBandColour(tag);
}

/** The theme charts colour of each well-known layer; other layers use yellow and Other the muted foreground. */
function defaultBandColour(tag: string): string {
  switch (tag) {
    case "source":
      return "var(--vscode-charts-orange)";
    case "staging":
      return "var(--vscode-charts-blue)";
    case "intermediate":
      return "var(--vscode-charts-purple)";
    case "marts":
      return "var(--vscode-charts-green)";
    case OTHER_TAG:
      return "var(--vscode-descriptionForeground)";
    default:
      return "var(--vscode-charts-yellow)";
  }
}

export interface LayeredNode {
  id: string;
  width: number;
  height: number;
  tag: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayerBand {
  tag: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayeredPlan {
  /** Top-left corner of every node. */
  positions: Map<string, Point>;
  /** Index of each node's sub-row, counted from the top. */
  rowOf: Map<string, number>;
  /** The start node's sub-row index. */
  focusRow: number;
  /** Generation from the start node: negative above it, positive below. */
  generation: Map<string, number>;
  /** One band per run of same-tag sub-rows. */
  bands: LayerBand[];
  /** The Other column's band, when some node sits in it. */
  otherBand: LayerBand | undefined;
  /** Horizontal extent of the cards outside the Other column. */
  layeredBounds: { left: number; right: number };
}

/** The longest path from the start node to every node reachable through `next`. */
function longestPaths(
  from: string,
  next: ReadonlyMap<string, readonly string[]>,
  limit: number,
): Map<string, number> {
  const distance = new Map<string, number>([[from, 0]]);
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop() ?? from;
    const here = distance.get(id) ?? 0;
    // A cycle would otherwise grow forever; a DAG never gets past the node count.
    if (here + 1 > limit) {
      continue;
    }
    for (const following of next.get(id) ?? []) {
      if ((distance.get(following) ?? -1) < here + 1) {
        distance.set(following, here + 1);
        stack.push(following);
      }
    }
  }
  return distance;
}

function adjacency(
  pairs: readonly (readonly [string, string])[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [key, value] of pairs) {
    map.set(key, [...(map.get(key) ?? []), value]);
  }
  return map;
}

/** The generation a node starts with from its longest paths: the start itself, above, below, or none yet. */
function seededGeneration(
  id: string,
  start: string,
  up: ReadonlyMap<string, number>,
  down: ReadonlyMap<string, number>,
): number | undefined {
  if (id === start) {
    return 0;
  }
  if (up.has(id)) {
    return -(up.get(id) ?? 0);
  }
  if (down.has(id)) {
    return down.get(id) ?? 0;
  }
  return undefined;
}

/** One sweep that places each unplaced parent just above its placed child. */
function placeParentsAbove(
  edges: readonly (readonly [string, string])[],
  gen: Map<string, number>,
): void {
  for (const [parent, child] of edges) {
    const childGen = gen.get(child);
    if (!gen.has(parent) && childGen !== undefined) {
      const above = childGen - 1;
      gen.set(parent, above === 0 ? -1 : above);
    }
  }
}

/** One sweep that moves each edge's ends until the child sits below its parent. */
function orientEdges(
  start: string,
  edges: readonly (readonly [string, string])[],
  gen: Map<string, number>,
): void {
  for (const [parent, child] of edges) {
    const parentGen = gen.get(parent) ?? 0;
    const childGen = gen.get(child) ?? 0;
    if (parentGen < childGen) {
      continue;
    }
    if (child === start || parentGen < 0) {
      gen.set(parent, childGen - 1);
    } else {
      gen.set(child, parentGen + 1);
    }
  }
}

/**
 * Each node's generation from the start: its longest path up (negative) or down (positive).
 * Nodes neither above nor below the start sit just above their first placed child, never in the start's row.
 */
function generations(
  start: string,
  ids: readonly string[],
  edges: readonly (readonly [string, string])[],
): Map<string, number> {
  const limit = ids.length + 1;
  const parents = adjacency(
    edges.map(([parent, child]) => [child, parent] as const),
  );
  const children = adjacency(edges);
  const up = longestPaths(start, parents, limit);
  const down = longestPaths(start, children, limit);

  const gen = new Map<string, number>();
  for (const id of ids) {
    const seeded = seededGeneration(id, start, up, down);
    if (seeded !== undefined) {
      gen.set(id, seeded);
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    placeParentsAbove(edges, gen);
  }
  for (const id of ids) {
    if (!gen.has(id)) {
      gen.set(id, 1);
    }
  }
  // Every edge points down: push a child below its parent, or a parent above its child.
  for (let pass = 0; pass < ids.length; pass++) {
    orientEdges(start, edges, gen);
  }
  return gen;
}

interface SubRow {
  tag: string;
  ids: string[];
}

const tagRank = (tag: string): number => {
  const rank = LAYER_ORDER.indexOf(tag);
  return rank < 0 ? LAYER_ORDER.length : rank;
};

/** The tag most of `tags` carry; a tie goes to the earlier layer, so a group's band is its upstream-most layer. */
export function dominantTag(tags: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const ranked = [...counts].sort(
    ([p, a], [q, b]) => b - a || tagRank(p) - tagRank(q) || (p < q ? -1 : 1),
  );
  return ranked[0]?.[0] ?? OTHER_TAG;
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
function subRows(
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
function nearCentre(
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
function throughCentres(
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
function clearOf(x: number, width: number, crossed: readonly number[]): number {
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
function splitSides(sorted: readonly (readonly [string, number])[]): {
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
function centreFocus(
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
function sideXs(
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
function otherColumn(
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

/** Rows stack top to bottom; a change of tag costs a gutter, a repeat of the tag costs SAME_ROW. */
function stackRows(
  rows: readonly SubRow[],
  byId: ReadonlyMap<string, LayeredNode>,
  positions: Map<string, Point>,
): void {
  let y = 0;
  rows.forEach((row, index) => {
    const height = Math.max(...row.ids.map((id) => byId.get(id)?.height ?? 0));
    if (index > 0) {
      y += rows[index - 1]?.tag === row.tag ? SAME_ROW : 2 * BAND_PAD + GUTTER;
    }
    for (const id of row.ids) {
      const current = positions.get(id) ?? { x: 0, y: 0 };
      const slack = (height - (byId.get(id)?.height ?? 0)) / 2;
      positions.set(id, { x: current.x, y: y + slack });
    }
    y += height;
  });
}

/**
 * Shifts every card so the canvas starts at the margins and no card or band goes negative. Returns the x shift,
 * which the bands need too.
 */
function shiftToMargins(
  positions: Map<string, Point>,
  width: (id: string) => number,
): number {
  const xs = [...positions.values()].map((p) => p.x);
  const rights = [...positions.entries()].map(([id, p]) => p.x + width(id));
  const reach = Math.max(-Math.min(...xs), Math.max(...rights));
  const shiftX = reach + SIDE_MARGIN;
  const minY = Math.min(...[...positions.values()].map((p) => p.y));
  const shiftY = TOP_MARGIN - minY;
  for (const [id, p] of positions) {
    positions.set(id, { x: p.x + shiftX, y: p.y + shiftY });
  }
  return shiftX;
}

/** The runs of consecutive same-tag sub-rows, leaving out the Other column. */
function layerRuns(
  rows: readonly SubRow[],
): { tag: string; first: number; last: number }[] {
  const runs: { tag: string; first: number; last: number }[] = [];
  rows.forEach((row, index) => {
    if (row.tag === OTHER_TAG) {
      return;
    }
    const run = runs.at(-1);
    if (run && run.tag === row.tag && run.last === index - 1) {
      run.last = index;
    } else {
      runs.push({ tag: row.tag, first: index, last: index });
    }
  });
  return runs;
}

/** One band per layer run, spanning the layered cards from `left` to `right`. */
function layerBands(
  rows: readonly SubRow[],
  spanOf: (index: number) => [number, number],
  left: number,
  right: number,
): LayerBand[] {
  return layerRuns(rows).map((run) => {
    const [top] = spanOf(run.first);
    const [, bottom] = spanOf(run.last);
    return {
      tag: run.tag,
      x: left - BAND_PAD,
      y: top - BAND_PAD,
      width: right - left + 2 * BAND_PAD,
      height: bottom - top + 2 * BAND_PAD,
    };
  });
}

/** The band behind the Other column, from its first stack to its outer edge, over every sub-row. */
function otherBandOf(
  spanOf: (index: number) => [number, number],
  rowCount: number,
  otherSide: Side,
  shiftedStart: number,
  shiftedFar: number,
): LayerBand {
  const [top] = spanOf(0);
  const [, bottom] = spanOf(rowCount - 1);
  const bandLeft =
    otherSide > 0 ? shiftedStart - otherSide * BAND_PAD : shiftedFar - BAND_PAD;
  const bandRight =
    otherSide > 0 ? shiftedFar + BAND_PAD : shiftedStart - otherSide * BAND_PAD;
  return {
    tag: OTHER_TAG,
    x: bandLeft,
    y: top - BAND_PAD,
    width: bandRight - bandLeft,
    height: bottom - top + 2 * BAND_PAD,
  };
}

/**
 * Lays out the graph. `otherSide` picks the side of the start node the Other column sits on; callers try both and
 * keep the one with fewer crossings.
 */
export function layoutLayered(
  start: string,
  nodes: readonly LayeredNode[],
  edges: readonly (readonly [string, string])[],
  otherSide: Side,
): LayeredPlan {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  if (nodes.length === 0) {
    return {
      positions: new Map(),
      rowOf: new Map(),
      focusRow: 0,
      generation: new Map(),
      bands: [],
      otherBand: undefined,
      layeredBounds: { left: 0, right: 0 },
    };
  }
  const focus = byId.has(start) ? start : (nodes[0]?.id ?? start);
  const generation = generations(
    focus,
    nodes.map((node) => node.id),
    edges,
  );
  const rowsInfo = subRows(focus, nodes, generation, edges);
  const focusRow = Math.max(
    0,
    rowsInfo.findIndex((row) => row.ids.includes(focus)),
  );
  const rowOf = new Map<string, number>();
  rowsInfo.forEach((row, index) =>
    row.ids.forEach((id) => rowOf.set(id, index)),
  );
  const rel = (id: string): number => (rowOf.get(id) ?? focusRow) - focusRow;
  const isOtherNode = (id: string): boolean =>
    byId.get(id)?.tag === OTHER_TAG && id !== focus;
  const width = (id: string): number => byId.get(id)?.width ?? 0;

  const positions = new Map<string, Point>();
  const centres = new Map<string, number>();
  const place = (id: string, x: number): void => {
    positions.set(id, { x, y: 0 });
    centres.set(id, x + width(id) / 2);
  };

  // The start node sits alone on the centre line; every other row splits either side of the corridor.
  place(focus, -width(focus) / 2);
  const rowOrder = [
    ...rowsInfo.map((_, index) => index).filter((index) => index > focusRow),
    ...rowsInfo
      .map((_, index) => index)
      .filter((index) => index < focusRow)
      .reverse(),
  ];

  for (const index of rowOrder) {
    const r = index - focusRow;
    const crossed = throughCentres(r, edges, rel, centres, focus);
    const sorted = (rowsInfo[index]?.ids ?? [])
      .filter((id) => !isOtherNode(id))
      .map(
        (id) =>
          [
            id,
            clearOf(nearCentre(id, r, edges, rel, centres), width(id), crossed),
          ] as const,
      )
      .sort(([p, px], [q, qx]) => px - qx || (p < q ? -1 : 1));
    for (const [id, x] of sideXs(splitSides(sorted), width)) {
      place(id, x);
    }
  }

  centreFocus(
    focus,
    rowsInfo[focusRow]?.ids ?? [],
    positions,
    width,
    isOtherNode,
  );

  // The Other column: a side stack per sub-row, beyond the layered cards on the chosen side.
  const layeredIds = [...positions.keys()].filter((id) => !isOtherNode(id));
  const edgeX =
    otherSide > 0
      ? Math.max(
          ...layeredIds.map((id) => (positions.get(id)?.x ?? 0) + width(id)),
        )
      : Math.min(...layeredIds.map((id) => positions.get(id)?.x ?? 0));
  const columnStart = edgeX + otherSide * (2 * BAND_PAD + GUTTER);
  const otherStacks = otherColumn(
    rowsInfo,
    columnStart,
    otherSide,
    isOtherNode,
    width,
  );
  for (const [id, x] of otherStacks.slots) {
    place(id, x);
  }

  stackRows(rowsInfo, byId, positions);
  const shiftX = shiftToMargins(positions, width);

  const spanOf = (index: number): [number, number] => {
    const members = rowsInfo[index]?.ids ?? [];
    const tops = members.map((id) => positions.get(id)?.y ?? 0);
    const bottoms = members.map(
      (id) => (positions.get(id)?.y ?? 0) + (byId.get(id)?.height ?? 0),
    );
    return [Math.min(...tops), Math.max(...bottoms)];
  };
  const layered = [...positions.keys()].filter((id) => !isOtherNode(id));
  const left = Math.min(...layered.map((id) => positions.get(id)?.x ?? 0));
  const right = Math.max(
    ...layered.map((id) => (positions.get(id)?.x ?? 0) + width(id)),
  );

  const bands = layerBands(rowsInfo, spanOf, left, right);

  let otherBand: LayerBand | undefined;
  const otherIds = [...positions.keys()].filter(isOtherNode);
  if (otherIds.length > 0 && rowsInfo.length > 0) {
    otherBand = otherBandOf(
      spanOf,
      rowsInfo.length,
      otherSide,
      columnStart + shiftX,
      otherStacks.far + shiftX,
    );
  }

  return {
    positions,
    rowOf,
    focusRow,
    generation,
    bands,
    otherBand,
    layeredBounds: { left, right },
  };
}
