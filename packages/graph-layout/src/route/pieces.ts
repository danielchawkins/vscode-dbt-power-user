import type { OrderResult } from "../order/index.js";
import type { Placement } from "../place/index.js";
import type {
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutOptions,
  Side,
} from "../types.js";

/** One member edge's run through the band below `rank`, from its upper end to its lower end. */
export interface Run {
  /** The band: the rank of the upper end. */
  rank: number;
  /** Layered node indices of the upper and lower ends. */
  upper: number;
  lower: number;
  /** In-rank coordinates of the two ends. */
  from: number;
  to: number;
  /** Both ends sit on the band's upper edge: a flat edge, routed beneath its rank. */
  flat: boolean;
  /** The track the band gave the run, counted from the band's upper edge; -1 for a straight run. */
  track: number;
  /** The edge's source port as a key, shared by every edge from that port; undefined without one. */
  trunk: string | undefined;
  /**
   * The in-rank coordinate of the owner's side that the stub from a lateral port leaves, when the upper (lower) end is a
   * port dummy; undefined at any other end. The stub runs from there to the dummy, at the port's offset.
   */
  upperStub: number | undefined;
  lowerStub: number | undefined;
}

/** The phases routing reads: the ordering the layers come from, and the placement the in-rank coordinates come from. */
export interface Phases {
  ordering: OrderResult;
  placement: Placement;
}

/** A routed edge: its runs in drawing order from the source end, and whether ranks run against the edge. */
export interface Member {
  edge: string;
  reversed: boolean;
  runs: Run[];
}

/** What the run builder reads from the layered graph, with each node's in-rank centre. */
interface Context {
  nodes: readonly LayoutNode[];
  layered: OrderResult["layered"];
  inRank: readonly number[];
  down: boolean;
}

type Bundle = OrderResult["layered"]["bundles"][number];

/** Where a member's runs are measured: its context, its bundle, and its slot among the bundle's edges. */
interface Site {
  context: Context;
  bundle: Bundle;
  slot: number;
}

/**
 * The runs of every routed edge, in input order of their bundles. A dummy is at its member's slot inside the dummy;
 * a real end is at its port when the port sits on the side that faces the band, else at the facing side's centre.
 * Edges of kinds that are not routed take no runs.
 */
export function membersOf(
  graph: LayoutGraph,
  options: LayoutOptions,
  phases: Phases,
): Member[] {
  const { ordering, placement } = phases;
  const down = options.direction === "down";
  const context: Context = {
    nodes: graph.nodes,
    layered: ordering.layered,
    inRank: placement.points.map((p) => (down ? p.x : p.y)),
    down,
  };
  const edges = new Map(graph.edges.map((e) => [e.id, e] as const));
  return ordering.layered.bundles
    .filter((bundle) => options.edgeKinds[bundle.kind]?.routed !== false)
    .flatMap((bundle) =>
      bundle.edges.flatMap((id, slot) => {
        const edge = edges.get(id);
        return edge === undefined
          ? []
          : [memberOf({ context, bundle, slot }, edge)];
      }),
    );
}

/** The runs of one member edge of a bundle. */
function memberOf(site: Site, edge: LayoutEdge): Member {
  const { bundle } = site;
  const runs = bundle.flat
    ? flatRuns(site, edge)
    : chainRuns(site, edge, bundle.reversed);
  return { edge: edge.id, reversed: bundle.reversed, runs };
}

/** The key of an edge's source port: every edge from one port shares it. Undefined without a port. */
function trunkOf(edge: LayoutEdge): string | undefined {
  return edge.sourcePort === undefined
    ? undefined
    : JSON.stringify([edge.source, edge.sourcePort]);
}

/**
 * The in-rank coordinate of an end: its port on `side` when the port is there, else the node's centre. A dummy has no
 * port, and sits at its member's slot inside its breadth.
 */
function inRankEnd(
  site: Site,
  end: { node: number; side: Side; port: string | undefined },
): number {
  const { context, bundle, slot } = site;
  const { layered, inRank, nodes } = context;
  const { node, side, port } = end;
  const extent = layered.nodes[node]?.breadth ?? 0;
  const left = (inRank[node] ?? 0) - extent / 2;
  if (layered.nodes[node]?.id === undefined) {
    return left + ((slot + 0.5) * extent) / bundle.edges.length;
  }
  const at = nodes[node]?.ports?.find((p) => p.id === port);
  return at?.side === side ? left + at.offset : (inRank[node] ?? 0);
}

/** The single run of a flat edge: both ends on the upper rank's band, routed beneath it. */
function flatRuns(site: Site, edge: LayoutEdge): Run[] {
  const { context, bundle } = site;
  const [source, target] = bundle.chain;
  if (source === undefined || target === undefined) {
    return [];
  }
  const towardLower: Side = context.down ? "south" : "east";
  return [
    {
      rank: context.layered.nodes[source]?.rank ?? 0,
      upper: source,
      lower: target,
      from: inRankEnd(site, {
        node: source,
        side: towardLower,
        port: edge.sourcePort,
      }),
      to: inRankEnd(site, {
        node: target,
        side: towardLower,
        port: edge.targetPort,
      }),
      flat: true,
      track: -1,
      trunk: trunkOf(edge),
      upperStub: stubOf(site, source),
      lowerStub: stubOf(site, target),
    },
  ];
}

/**
 * The in-rank coordinate where a lateral port's stub leaves its owner's side: the owner's centre moved by half its
 * in-rank extent, on the side the port sits on. Undefined for a node that is not a port dummy.
 */
function stubOf(site: Site, node: number): number | undefined {
  const { context } = site;
  const port = context.layered.nodes[node]?.port;
  if (port === undefined) {
    return undefined;
  }
  const half = (context.layered.nodes[port.owner]?.breadth ?? 0) / 2;
  const centre = context.inRank[port.owner] ?? 0;
  return port.after ? centre + half : centre - half;
}

/** The runs of a chain of dummies, from the member's source end to its target end, against the edge when reversed. */
function chainRuns(site: Site, edge: LayoutEdge, reversed: boolean): Run[] {
  const { context, bundle } = site;
  const { chain } = bundle;
  const towardLower: Side = context.down ? "south" : "east";
  const towardUpper: Side = context.down ? "north" : "west";
  const upperPort = reversed ? edge.targetPort : edge.sourcePort;
  const lowerPort = reversed ? edge.sourcePort : edge.targetPort;
  const runs: Run[] = [];
  for (let k = 0; k + 1 < chain.length; k++) {
    const upper = chain[k] ?? 0;
    const lower = chain[k + 1] ?? 0;
    runs.push({
      rank: context.layered.nodes[upper]?.rank ?? 0,
      upper,
      lower,
      from: inRankEnd(site, {
        node: upper,
        side: towardLower,
        port: k === 0 ? upperPort : undefined,
      }),
      to: inRankEnd(site, {
        node: lower,
        side: towardUpper,
        port: k + 2 === chain.length ? lowerPort : undefined,
      }),
      flat: false,
      track: -1,
      trunk: trunkOf(edge),
      upperStub: k === 0 ? stubOf(site, upper) : undefined,
      lowerStub: k + 2 === chain.length ? stubOf(site, lower) : undefined,
    });
  }
  return runs;
}
