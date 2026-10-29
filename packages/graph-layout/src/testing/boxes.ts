import fc from "fast-check";
import type { LayoutCluster, LayoutGraph, Point, Rect } from "../types.js";
import { clusteredGraphArb } from "./graphs.js";

/** The padding a cluster that sets none keeps, as in placement. */
const DEFAULT_PADDING = 8;

/** Slack for the rounding that the solver leaves. */
const TOLERANCE = 1e-6;

/** A clustered graph with the direction and effort it is laid out at. */
export interface Case {
  graph: LayoutGraph;
  direction: "down" | "right";
  effort: "fast" | "balanced";
}

export const caseArb: fc.Arbitrary<Case> = fc.record({
  graph: clusteredGraphArb,
  direction: fc.constantFrom("down" as const, "right" as const),
  effort: fc.constantFrom("fast" as const, "balanced" as const),
});

/** The ids that break each rule of a drawing with cluster boxes. Every list empty means the drawing holds. */
export interface BoxViolations {
  /** Nodes that are not inside the box of their cluster, with its padding. */
  members: string[];
  /** Boxes that are not inside their parent's box, with the parent's padding. */
  nested: string[];
  /** Pairs of boxes that overlap although neither contains the other. */
  siblings: string[];
  /** Pairs of real nodes that overlap. */
  nodes: string[];
  /** Pairs of a node and a box it is outside of, that overlap. */
  strangers: string[];
}

/** Every rule a drawing with cluster boxes keeps, checked against the node centres and the box rectangles. */
export function boxViolations(
  graph: LayoutGraph,
  centres: ReadonlyMap<string, Point>,
  boxes: ReadonlyMap<string, Rect>,
): BoxViolations {
  const clusters = new Map(
    (graph.clusters ?? []).map((c) => [c.id, c] as const),
  );
  const rects = nodeRects(graph, centres);
  return {
    members: graph.nodes.flatMap((node) => {
      const rect = rects.get(node.id);
      if (rect === undefined || node.cluster === undefined) {
        return [];
      }
      const box = boxes.get(node.cluster);
      const inside =
        box !== undefined &&
        contains(box, expand(rect, paddingOf(clusters, node.cluster)));
      return inside ? [] : [node.id];
    }),
    nested: [...boxes].flatMap(([id, box]) => {
      const parent = clusters.get(id)?.parent;
      const outer = parent === undefined ? undefined : boxes.get(parent);
      const inside =
        parent === undefined ||
        (outer !== undefined &&
          contains(outer, expand(box, paddingOf(clusters, parent))));
      return inside ? [] : [id];
    }),
    siblings: pairs([...boxes.keys()]).flatMap(([a, b]) => {
      const nested =
        chainOf(clusters, a).includes(b) || chainOf(clusters, b).includes(a);
      return !nested && overlaps(boxes.get(a)!, boxes.get(b)!)
        ? [`${a}|${b}`]
        : [];
    }),
    nodes: pairs([...rects.keys()]).flatMap(([a, b]) =>
      overlaps(rects.get(a)!, rects.get(b)!) ? [`${a}|${b}`] : [],
    ),
    strangers: graph.nodes.flatMap((node) => {
      const rect = rects.get(node.id);
      if (rect === undefined) {
        return [];
      }
      const own = chainOf(clusters, node.cluster);
      return [...boxes]
        .filter(([id, box]) => !own.includes(id) && overlaps(rect, box))
        .map(([id]) => `${node.id}|${id}`);
    }),
  };
}

/** Each real node's rectangle, from its centre and its size. */
function nodeRects(
  graph: LayoutGraph,
  centres: ReadonlyMap<string, Point>,
): Map<string, Rect> {
  return new Map(
    graph.nodes.flatMap((node) => {
      const p = centres.get(node.id);
      return p === undefined
        ? []
        : [
            [
              node.id,
              {
                x: p.x - node.width / 2,
                y: p.y - node.height / 2,
                width: node.width,
                height: node.height,
              },
            ] as const,
          ];
    }),
  );
}

/** A cluster and each of its ancestors, innermost first. */
function chainOf(
  clusters: ReadonlyMap<string, LayoutCluster>,
  id: string | undefined,
): string[] {
  const chain: string[] = [];
  for (let c = id; c !== undefined; c = clusters.get(c)?.parent) {
    chain.push(c);
  }
  return chain;
}

function paddingOf(
  clusters: ReadonlyMap<string, LayoutCluster>,
  id: string,
): number {
  return clusters.get(id)?.padding ?? DEFAULT_PADDING;
}

/** Each unordered pair of the ids. */
function pairs(ids: readonly string[]): [string, string][] {
  return ids.flatMap((a, i) =>
    ids.slice(i + 1).map((b) => [a, b] as [string, string]),
  );
}

function expand(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + 2 * by,
    height: rect.height + 2 * by,
  };
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - TOLERANCE &&
    inner.y >= outer.y - TOLERANCE &&
    inner.x + inner.width <= outer.x + outer.width + TOLERANCE &&
    inner.y + inner.height <= outer.y + outer.height + TOLERANCE
  );
}

/** Whether two rectangles share interior: touching edges do not count. */
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - TOLERANCE &&
    b.x < a.x + a.width - TOLERANCE &&
    a.y < b.y + b.height - TOLERANCE &&
    b.y < a.y + a.height - TOLERANCE
  );
}
