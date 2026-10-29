/**
 * The owned layout engine: the layered layout and the gutter router, behind the layout-engine port. It answers with
 * the routed points of every edge; the panel draws them (routeDrawing.ts).
 */
import {
  type LayeredFlow,
  type LayeredFlowInput,
  layeredFlow,
} from "../layeredFlow";
import { geometry } from "../layout";
import type {
  LayoutCard,
  LayoutEngine,
  LayoutRequest,
  LayoutResponse,
  RoutedGeometry,
} from "./layoutEngine";

export const ownedEngine: LayoutEngine = {
  id: "owned",
  layout(request: LayoutRequest): LayoutResponse {
    const flow = layoutOwned(request);
    const edges = new Map<string, RoutedGeometry>();
    for (const [id, path] of flow.paths) {
      edges.set(id, { points: path.points, startsAt: path.startsAt });
    }
    return {
      positions: flow.positions,
      bands: flow.bands,
      edges,
      hints: { engine: "owned", data: { crossings: flow.crossings } },
    };
  },
};

/** The owned layout with its crossing count, which the port does not carry; the parity tests read it. */
function layoutOwned(request: LayoutRequest): LayeredFlow {
  return layeredFlow(toLayeredFlowInput(request));
}

/** The owned engine's input, built from the port's request. Edges keep the request's order within each kind. */
function toLayeredFlowInput(request: LayoutRequest): LayeredFlowInput {
  const cards = new Map<string, LayoutCard>(
    request.cards.map((card) => [card.id, card]),
  );
  // A column end without a listed row sits at the header's midline, as the card had no row to point at.
  const offsetOf = (card: string, row: string | undefined) =>
    cards.get(card)?.rows?.find((r) => r.id === row)?.offset ??
    geometry.headerHeight / 2;
  const edgesOf = (role: string) =>
    request.edges.filter((edge) => edge.role === role);
  return {
    start: request.focus,
    nodes: request.cards.map((card) => ({
      id: card.id,
      width: card.width,
      height: card.height,
      tag: card.tag,
    })),
    tableRoutes: [...edgesOf("table"), ...edgesOf("group")].map((edge) => ({
      id: edge.id,
      parent: edge.from,
      child: edge.to,
    })),
    rankEdges: request.rankPairs,
    columnRoutes: edgesOf("column").map((edge) => ({
      id: edge.id,
      from: edge.from,
      fromOffset: offsetOf(edge.from, edge.fromRow),
      to: edge.to,
      toOffset: offsetOf(edge.to, edge.toRow),
    })),
    relationshipRoutes: edgesOf("relationship").map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
    })),
    traceOn: request.traceOn,
  };
}
