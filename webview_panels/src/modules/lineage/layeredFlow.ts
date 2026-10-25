/**
 * The layered lineage drawing: the layout, then the gutter router over every edge at once. When a node sits in the
 * Other column, the column is tried on both sides and the side with fewer crossings is kept.
 */
import {
  type RelationshipRoute,
  type RoutedPath,
  routeGutters,
  type TableRoute,
} from "./gutterRouter";
import { type LayerBand, layoutLayered } from "./layered";
import { type LayeredNode, type Point, type Side } from "./layeredMetrics";
import { OTHER_TAG } from "./layerTags";

/** A column edge, with each end's offset from its card's top. */
export interface LayeredColumnEdge {
  id: string;
  from: string;
  fromOffset: number;
  to: string;
  toOffset: number;
}

export interface LayeredFlowInput {
  start: string;
  nodes: readonly LayeredNode[];
  tableRoutes: readonly TableRoute[];
  /** The `[parent, child]` pairs that rank the cards; absent means the table routes' pairs. */
  rankEdges?: readonly (readonly [string, string])[] | undefined;
  columnRoutes: readonly LayeredColumnEdge[];
  relationshipRoutes: readonly RelationshipRoute[];
  traceOn: boolean;
}

export interface LayeredFlow {
  positions: Map<string, Point>;
  bands: LayerBand[];
  paths: Map<string, RoutedPath>;
  crossings: number;
  hops: number;
}

export function layeredFlow(input: LayeredFlowInput): LayeredFlow {
  const edges =
    input.rankEdges ??
    input.tableRoutes.map((edge) => [edge.parent, edge.child] as const);
  const attempt = (otherSide: Side) => {
    const plan = layoutLayered(input.start, input.nodes, edges, otherSide);
    const boxes = new Map(
      input.nodes.map((node) => {
        const position = plan.positions.get(node.id) ?? { x: 0, y: 0 };
        return [
          node.id,
          {
            x: position.x,
            y: position.y,
            width: node.width,
            height: node.height,
          },
        ] as const;
      }),
    );
    const routed = routeGutters({
      focus: input.start,
      boxes,
      rowOf: plan.rowOf,
      generation: plan.generation,
      layeredBounds: plan.layeredBounds,
      tableRoutes: input.tableRoutes,
      columnRoutes: input.columnRoutes.map((column) => ({
        id: column.id,
        from: column.from,
        fromY: (boxes.get(column.from)?.y ?? 0) + column.fromOffset,
        to: column.to,
        toY: (boxes.get(column.to)?.y ?? 0) + column.toOffset,
      })),
      relationshipRoutes: input.relationshipRoutes,
      traceOn: input.traceOn,
    });
    return { plan, routed };
  };

  const left = attempt(-1);
  // Without an Other column the two sides draw the same picture, so the second attempt is skipped.
  const hasOther = input.nodes.some(
    (node) => node.tag === OTHER_TAG && node.id !== input.start,
  );
  const right = hasOther ? attempt(1) : left;
  const keep = left.routed.crossings <= right.routed.crossings ? left : right;
  return {
    positions: keep.plan.positions,
    bands: keep.plan.otherBand
      ? [...keep.plan.bands, keep.plan.otherBand]
      : keep.plan.bands,
    paths: keep.routed.paths,
    crossings: keep.routed.crossings,
    hops: keep.routed.hops,
  };
}
