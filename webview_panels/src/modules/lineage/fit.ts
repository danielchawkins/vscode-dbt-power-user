/**
 * Fitting the drawn graph to the canvas: the padding the controls, legend, minimap and any notice take, and the fit
 * itself.
 */
import {
  type FitViewOptions,
  getNodesBounds,
  type Node,
  type useReactFlow,
  type Viewport,
} from "@xyflow/react";
import { OTHER_TAG } from "./layered";
import { type Box, type FitPadding, focusedViewport, geometry } from "./layout";
import { ZOOM_OUT_BELOW } from "./semanticZoom";

/** The zoom range of the canvas. A fit never draws a graph larger than 100%, so a small graph keeps its size. */
export const MIN_ZOOM = 0.05;
const FIT_MAX_ZOOM = 1;
/**
 * The lowest zoom a layered fit goes to. Below it cards switch to the zoomed-out form, so a graph taller than the
 * canvas is panned to rather than shrunk.
 */
const FIT_MIN_ZOOM = ZOOM_OUT_BELOW;
/** The space, in flow units, that a layered fit leaves around the cards' box. */
const FIT_MARGIN = 24;

/** The canvas space a fit keeps clear above the graph, in pixels, besides a notice's overlap. */
const FIT_TOP = 16;

/** A node's size: its measured size, else the size it was created with. */
const sizeOf = (node: Node): { width: number; height: number } => ({
  width: node.measured?.width ?? node.width ?? geometry.tableWidth,
  height: node.measured?.height ?? node.height ?? 0,
});

/** The box of `nodes` with `FIT_MARGIN` around it. */
const framed = (nodes: readonly Node[]): Box => {
  const box = getNodesBounds([...nodes]);
  return {
    x: box.x - FIT_MARGIN,
    y: box.y - FIT_MARGIN,
    width: box.width + 2 * FIT_MARGIN,
    height: box.height + 2 * FIT_MARGIN,
  };
};

/**
 * The boxes a layered fit frames: every card, and when the graph has an Other column, the main bands' cards and the
 * Other column's cards on their own. Band nodes span whole rows, so they are left out; they would stretch the box and
 * draw the cards smaller than they need to be. A card is in the Other column when its centre lies in the Other band.
 */
const fitBoxes = (
  nodes: readonly Node[],
): { bounds: Box; columns: { main: Box; other: Box } | undefined } => {
  const cards = nodes.filter((node) => node.type !== "band");
  const band = nodes.find(
    (node) => node.type === "band" && node.data.tag === OTHER_TAG,
  );
  const inOther = (node: Node): boolean => {
    if (!band) {
      return false;
    }
    const { width, height } = sizeOf(node);
    const x = node.position.x + width / 2;
    const y = node.position.y + height / 2;
    const area = { ...band.position, ...sizeOf(band) };
    return (
      x >= area.x &&
      x <= area.x + area.width &&
      y >= area.y &&
      y <= area.y + area.height
    );
  };
  const other = cards.filter(inOther);
  const main = cards.filter((node) => !inOther(node));
  return {
    bounds: framed(cards),
    columns:
      other.length > 0 && main.length > 0
        ? { main: framed(main), other: framed(other) }
        : undefined,
  };
};

/** The canvas space a fit keeps clear: the controls and legend, the minimap when shown, and a notice's overlap. */
export const fitPadding = (
  minimap?: {
    width: number;
    height: number;
  },
  notice = 0,
): FitPadding => ({
  top: FIT_TOP + notice,
  right: (minimap?.width ?? 0) + 16,
  bottom: Math.max(40, (minimap?.height ?? 0) + 16),
  left: 56,
});

/**
 * How far a notice reaches over the canvas's top edge, in pixels. The notice sits in the top bar above the canvas, so
 * this is 0 in the panel's layout, and a fit adds it to the top padding only when it really covers the graph.
 */
export const noticeOverlap = (
  notice: { bottom: number },
  canvas: { top: number },
): number => Math.max(0, notice.bottom - canvas.top);

/** The fit options for `fitView`: the padding of `fitPadding` in pixels, and zoom capped at 100%. */
export const fitOptions = (
  minimap?: {
    width: number;
    height: number;
  },
  notice = 0,
): FitViewOptions => {
  const padding = fitPadding(minimap, notice);
  return {
    maxZoom: FIT_MAX_ZOOM,
    padding: {
      top: `${padding.top}px`,
      right: `${padding.right}px`,
      bottom: `${padding.bottom}px`,
      left: `${padding.left}px`,
    },
  };
};

/** What a fit needs: the canvas size, the padding and options to fit with, and the focused card. */
interface FitRequest {
  flow: ReturnType<typeof useReactFlow>;
  options: FitViewOptions;
  padding: FitPadding;
  width: number;
  height: number;
  layered: boolean;
  focusId: string | undefined;
}

/**
 * Fits the drawn graph to the canvas. `fitView` waits until React Flow has measured the nodes, so the bounds read after
 * it are the drawn ones. A layered graph is then centred on its focused card, which the layout places off the middle of
 * its cards, framing the cards and not the bands, and never zoomed below `FIT_MIN_ZOOM`. See `focusedViewport` for
 * how the Other column is kept on screen.
 */
export const fitGraph = async ({
  flow,
  options,
  padding,
  width,
  height,
  layered,
  focusId,
}: FitRequest): Promise<void> => {
  await flow.fitView(options);
  const focus = focusId === undefined ? undefined : flow.getNode(focusId);
  if (!layered || !focus || width <= 0 || height <= 0) {
    return;
  }
  const focusX =
    focus.position.x + (focus.measured?.width ?? geometry.tableWidth) / 2;
  const focusY = focus.position.y + (focus.measured?.height ?? 0) / 2;
  const { bounds, columns } = fitBoxes(flow.getNodes());
  await flow.setViewport(
    focusedViewport({
      bounds,
      columns,
      focusX,
      focusY,
      width,
      height,
      padding,
      minZoom: FIT_MIN_ZOOM,
      maxZoom: FIT_MAX_ZOOM,
    }),
  );
};

/** The last fit: the nodes it framed, by `nodeKey`, and the viewport it left. */
export interface Fitted {
  nodeKey: string;
  viewport: Viewport;
}

/** Whether two viewports are the same view, to within a fraction of a pixel. */
const sameViewport = (a: Viewport, b: Viewport): boolean =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.zoom - b.zoom) < 1e-6;

/**
 * Whether a change to the graph refits the view. A change to the drawn nodes always does. A change of layout or
 * Connections does only when the user has not panned or zoomed since the last fit, so their view is kept.
 */
export const refitsGraph = (
  last: Fitted | undefined,
  nodeKey: string,
  current: Viewport,
): boolean =>
  last === undefined ||
  last.nodeKey !== nodeKey ||
  sameViewport(last.viewport, current);
