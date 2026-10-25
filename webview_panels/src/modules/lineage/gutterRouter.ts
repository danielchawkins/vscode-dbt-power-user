/**
 * Gutter router for the layered lineage layout. Every edge is routed at once through channels: a horizontal gutter
 * between each pair of rows, the corridor above and below the start node, a narrow lane beside each card for column
 * edges, and an outer channel on each side for an edge that must pass the start node's row without touching it.
 *
 * Each channel hands its edges evenly spaced tracks, in list order. The list order is improved greedily to remove
 * crossings. Crossings that remain are drawn as hops: the horizontal run arcs over the vertical one.
 *
 * Pure functions: boxes in, SVG path strings out.
 */
import { GutterPlan } from "./gutterPlan";
import { drawPath, labelPoint } from "./routeDrawing";
import { segmentsOf } from "./routeGeometry";
import type { RoutedPath, RouteInput, RouteResult } from "./routeTypes";

export type {
  RelationshipRoute,
  RoutedPath,
  RouteInput,
  RouteResult,
  TableRoute,
} from "./routeTypes";

/** Routes every edge in one run: channels first, then the greedy order, then the rounded paths with hops. */
export function routeGutters(input: RouteInput): RouteResult {
  const { traceOn } = input;
  const plan = new GutterPlan(input);
  for (const edge of input.tableRoutes) {
    plan.addTableRoute(edge);
  }
  for (const relationship of input.relationshipRoutes) {
    plan.addRelationshipRoute(relationship);
  }
  for (const column of input.columnRoutes) {
    plan.addColumnRoute(column);
  }

  const { channels } = plan;
  channels.optimise(traceOn);
  const crossings = channels.crossings(traceOn);

  const { routes } = channels;
  const resolved = routes.map((route) => channels.resolve(route));
  const verticals = resolved.map((points) =>
    segmentsOf(points).filter(([p, q]) => p.x === q.x),
  );
  const paths = new Map<string, RoutedPath>();
  let hops = 0;
  routes.forEach((route, index) => {
    const drawn = drawPath({ index, routes, resolved, verticals, traceOn });
    hops += drawn.hops;
    // Every route has at least two stops, so its first and last points are both set.
    const points = resolved[index] ?? [];
    paths.set(route.id, {
      d: drawn.d,
      labelAt: labelPoint(points),
      start: points[0] ?? { x: 0, y: 0 },
      end: points.at(-1) ?? { x: 0, y: 0 },
      startsAt: route.startsAt,
    });
  });
  return { paths, crossings, hops };
}
