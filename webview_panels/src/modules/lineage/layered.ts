/**
 * Layered lineage layout: rows run from the start node outwards (parents above, children below), each generation
 * is split into one sub-row per layer, and a central corridor keeps the start node's bubbles clear.
 *
 * Pure functions only. Card sizes come in with the input, so the layout never reads the DOM.
 */

import {
  BAND_PAD,
  GUTTER,
  type LayeredNode,
  type Point,
  SAME_ROW,
  type Side,
  SIDE_MARGIN,
  TOP_MARGIN,
} from "./layeredMetrics";
import { generations } from "./layeredRanks";
import {
  centreFocus,
  clearOf,
  nearCentre,
  otherColumn,
  sideXs,
  splitSides,
  type SubRow,
  subRows,
  throughCentres,
} from "./layeredRows";
import { OTHER_TAG } from "./layerTags";

export * from "./layeredMetrics";
export * from "./layerTags";

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
  const xs = Array.from(positions.values(), (p) => p.x);
  const rights = Array.from(positions.entries(), ([id, p]) => p.x + width(id));
  const reach = Math.max(-Math.min(...xs), Math.max(...rights));
  const shiftX = reach + SIDE_MARGIN;
  const minY = Math.min(...Array.from(positions.values(), (p) => p.y));
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
