import { type Drawing, type DrawnPath, measureDrawing } from "../metrics.js";
import type {
  LayoutGraph,
  LayoutOptions,
  Point,
  Rect,
} from "../types.js";
import { membersOf, type Member, type Phases, type Run } from "./pieces.js";
import { framePoint } from "./polylines.js";

/** The routed edge spacing when `LayoutOptions.spacing` leaves it out; the same default as routing's. */
const DEFAULT_EDGE = 4;

/**
 * What routing returns under `ranks: "levels"`. It has no bands, so `pairs` and `tracks` are zero; `crossings` is the
 * count measureDrawing makes over the polylines returned.
 */
export interface LevelRouting {
  nodes: ReadonlyMap<string, Point>;
  edges: ReadonlyMap<string, Point[]>;
  clusters: ReadonlyMap<string, Rect>;
  work: { pairs: number; tracks: number; crossings: number; capped: boolean };
}

/** Each layered node's centre across the ranks, and the half of its extent across them. */
interface Across {
  centre: readonly number[];
  half: readonly number[];
}

/**
 * Routes every edge under `ranks: "levels"`, where a rank is not a row and bands have nothing to re-stack. Nodes and
 * cluster boxes stay where placement put them. A run is drawn in the gap between its two ends: down from the upper
 * end, across at the middle of the gap, and down to the lower end. Runs in one gap share its midline, so their
 * horizontal parts may coincide. A run whose lower end is not below its upper end leaves both ends from the bottom,
 * beneath both, so it does not cross either node; its horizontal part can still pass through other nodes.
 */
export function routeLevels(
  graph: LayoutGraph,
  options: LayoutOptions,
  phases: Phases,
): LevelRouting {
  const down = options.direction === "down";
  const edge = options.spacing?.edge ?? DEFAULT_EDGE;
  const across = acrossOf(graph, phases, down);
  const edges = new Map(
    membersOf(graph, options, phases).map((member) => [
      member.edge,
      pathOf(member, { across, down, edge }),
    ]),
  );
  const { nodes, clusters } = phases.placement;
  return {
    nodes,
    edges,
    clusters,
    work: {
      pairs: 0,
      tracks: 0,
      crossings: crossingsOf(graph, nodes, edges),
      capped: false,
    },
  };
}

/** The across centre and half-extent of every layered node: placement's positions, and each real node's size. */
function acrossOf(graph: LayoutGraph, phases: Phases, down: boolean): Across {
  const { layered } = phases.ordering;
  return {
    centre: phases.placement.points.map((p) => (down ? p.y : p.x)),
    half: layered.nodes.map((node, i) => {
      const real = node.id === undefined ? undefined : graph.nodes[i];
      return real === undefined ? 0 : (down ? real.height : real.width) / 2;
    }),
  };
}

interface Frame {
  across: Across;
  down: boolean;
  edge: number;
}

/** The polyline of a member: its runs in order, with repeated and straight-through points dropped. */
function pathOf(member: Member, frame: Frame): Point[] {
  return bendsOf(member.runs.flatMap((run) => runPoints(run, frame)));
}

/**
 * The four corners of a run: from the upper end down to the middle of the gap, across, and to the lower end. A run
 * whose lower end is not below the upper end goes beneath both, from the bottom of the lower end.
 */
function runPoints(run: Run, frame: Frame): Point[] {
  const { across, down, edge } = frame;
  const top = sideOf(across, run.upper, 1);
  const lowerTop = sideOf(across, run.lower, -1);
  const pointsDown = lowerTop > top;
  const bottom = pointsDown ? lowerTop : sideOf(across, run.lower, 1);
  const mid = pointsDown ? (top + bottom) / 2 : Math.max(top, bottom) + edge;
  return [
    framePoint(down, run.from, top),
    framePoint(down, run.from, mid),
    framePoint(down, run.to, mid),
    framePoint(down, run.to, bottom),
  ];
}

/** The across coordinate of a layered node's side: `sign` 1 is the side below it, -1 the side above it. */
function sideOf(across: Across, node: number, sign: 1 | -1): number {
  return (
    (across.centre[node] ?? 0) + sign * (across.half[node] ?? 0)
  );
}

/** Drops each point equal to its predecessor, then each point that lies straight between its neighbours. */
function bendsOf(points: readonly Point[]): Point[] {
  const dense: Point[] = [];
  for (const point of points) {
    const last = dense[dense.length - 1];
    if (last === undefined || last.x !== point.x || last.y !== point.y) {
      dense.push(point);
    }
  }
  return dense.filter((point, i) => {
    const prev = dense[i - 1];
    const next = dense[i + 1];
    return prev === undefined || next === undefined || !straight(prev, point, next);
  });
}

function straight(a: Point, b: Point, c: Point): boolean {
  return (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
}

/** The crossings measureDrawing counts over the drawing that the nodes and polylines make. */
function crossingsOf(
  graph: LayoutGraph,
  nodes: ReadonlyMap<string, Point>,
  edges: ReadonlyMap<string, Point[]>,
): number {
  const byId = new Map(graph.edges.map((e) => [e.id, e] as const));
  const boxes = new Map<string, Rect>();
  for (const node of graph.nodes) {
    const c = nodes.get(node.id);
    if (c !== undefined) {
      boxes.set(node.id, {
        x: c.x - node.width / 2,
        y: c.y - node.height / 2,
        width: node.width,
        height: node.height,
      });
    }
  }
  const paths = new Map<string, DrawnPath>();
  for (const [id, points] of edges) {
    const edge = byId.get(id);
    if (edge !== undefined) {
      paths.set(id, { points, source: edge.source, target: edge.target });
    }
  }
  const drawing: Drawing = {
    boxes,
    paths,
    trunkOf: (id) => {
      const edge = byId.get(id);
      return edge?.sourcePort === undefined
        ? undefined
        : `${edge.source}:${edge.sourcePort}`;
    },
  };
  return measureDrawing(drawing).crossings;
}
