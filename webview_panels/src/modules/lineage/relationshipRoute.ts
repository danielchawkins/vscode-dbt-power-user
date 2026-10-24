/**
 * A declared relationship's routed path, with the card end at each side of it, for the relationship edge's marks.
 */
import { type Edge, Position } from "@xyflow/react";
import type { Point } from "./layeredMetrics";

/** The routed path the gutter router gives an edge; `flow.ts` imports this module, so the type is restated here. */
interface RoutedPath {
  d: string;
  labelAt: Point;
  start: Point;
  end: Point;
  startsAt?: string | undefined;
}

/** A point where a relationship meets a card, and the card side it leaves or enters from. */
interface CardEnd extends Point {
  position: Position;
}

/** A relationship edge's routed path, with the card end at each side. */
export interface RoutedRelationshipData {
  d: string;
  labelAt: Point;
  /** The referenced (one) card's end. */
  source: CardEnd;
  /** The declaring (many) card's end. */
  target: CardEnd;
}

/**
 * A relationship's routed path with the card end at each side. The router starts a relationship at its upper card,
 * or at its declaring card when both share a row, and records that card as `startsAt`. The source end is the path's
 * start only when that card is the source; a card's top is not used, since centring makes a taller card's top smaller.
 */
export function relationshipPath(
  edge: Edge,
  path: RoutedPath,
  positions: Map<string, Point>,
): RoutedRelationshipData {
  const top = (card: string) => positions.get(card)?.y ?? 0;
  const at = (card: string, point: Point): CardEnd => ({
    x: point.x,
    y: point.y,
    position: point.y <= top(card) ? Position.Top : Position.Bottom,
  });
  const [source, target] =
    path.startsAt === edge.source
      ? [path.start, path.end]
      : [path.end, path.start];
  return {
    d: path.d,
    labelAt: path.labelAt,
    source: at(edge.source, source),
    target: at(edge.target, target),
  };
}
