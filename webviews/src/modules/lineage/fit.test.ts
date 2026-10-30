import type { Node, Viewport, useReactFlow } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { fitGraph, fitPadding, noticeOverlap, refitsGraph } from "./fit";
import { geometry } from "./layout";
import { ZOOM_OUT_BELOW, isZoomedOut } from "./semanticZoom";

const card = (id: string, x: number, y: number, height = 100): Node => ({
  id,
  type: "table",
  position: { x, y },
  data: {},
  measured: { width: geometry.tableWidth, height },
});

const band = (id: string, x: number, y: number): Node => ({
  id,
  type: "band",
  position: { x, y },
  data: {},
  measured: { width: 5000, height: 5000 },
});

/** A React Flow instance with just the calls `fitGraph` makes; it records the viewport a fit sets. */
const fakeFlow = (nodes: Node[]) => {
  const views: Viewport[] = [];
  const flow = {
    fitView: async () => undefined,
    getNode: (id: string) => nodes.find((node) => node.id === id),
    getNodes: () => nodes,
    setViewport: async (viewport: Viewport) => {
      views.push(viewport);
    },
  };
  return { flow: flow as unknown as ReturnType<typeof useReactFlow>, views };
};

const fitFlow = async (
  nodes: Node[],
  height: number,
  focusId = "c0",
): Promise<Viewport> => {
  const { flow, views } = fakeFlow(nodes);
  await fitGraph({
    flow,
    options: {},
    padding: fitPadding(),
    width: 800,
    height,
    focusId,
  });
  const view = views.at(-1);
  if (view === undefined) {
    throw new Error("a fit sets the viewport");
  }
  return view;
};

describe("the fit's bounds", () => {
  it("leaves the bands out of the box it frames", async () => {
    // Four 300-unit rows of cards fill about 1100 units; the 5000-unit band would draw them far smaller.
    const cards = [0, 1, 2, 3].map((index) =>
      card(`c${index}`, 0, index * 300, 200),
    );
    const withoutBand = await fitFlow(cards, 1200);
    const withBand = await fitFlow([band("band:0", 0, 0), ...cards], 1200);
    expect(withBand.zoom).toBeCloseTo(withoutBand.zoom, 6);
    expect(withoutBand.zoom).toBeGreaterThan(ZOOM_OUT_BELOW);
    expect(withoutBand.zoom).toBeLessThan(1);
  });
});

describe("the fit's zoom", () => {
  it("pans a tall graph at the minimum zoom rather than shrinking the cards below it", async () => {
    const nodes = Array.from({ length: 40 }, (_, index) =>
      card(`c${index}`, 0, index * 300, 200),
    );
    const view = await fitFlow(nodes, 600);
    expect(view.zoom).toBe(ZOOM_OUT_BELOW);
    expect(isZoomedOut(view.zoom, true)).toBe(false);
  });

  it("keeps a small graph at 100% rather than enlarging it", async () => {
    const nodes = [card("c0", 0, 0, 200), card("c1", 0, 260, 200)];
    const view = await fitFlow(nodes, 900);
    expect(view.zoom).toBe(1);
  });
});

describe("the refit after a change to the graph", () => {
  const view = { x: 10, y: 20, zoom: 0.8 };
  const fitted = { nodeKey: "a\nb", viewport: view };

  it("refits on the first fit, when nothing has been fitted yet", () => {
    expect(refitsGraph(undefined, "a", view)).toBe(true);
  });

  it("refits a change of engine or Connections when the user has not moved the view", () => {
    expect(refitsGraph(fitted, "a\nb", view)).toBe(true);
  });

  it("keeps the user's pan or zoom on a change of engine or Connections", () => {
    expect(refitsGraph(fitted, "a\nb", { ...view, x: 300 })).toBe(false);
    expect(refitsGraph(fitted, "a\nb", { ...view, zoom: 0.5 })).toBe(false);
  });

  it("refits a change of the drawn nodes, even after the user has moved the view", () => {
    expect(refitsGraph(fitted, "a\nb\nc", { ...view, x: 300 })).toBe(true);
  });
});

describe("the fit's top padding", () => {
  it("counts only the part of a notice that covers the canvas", () => {
    // In the panel's layout the notice sits in the top bar, above the canvas's top edge.
    expect(noticeOverlap({ bottom: 40 }, { top: 60 })).toBe(0);
    expect(noticeOverlap({ bottom: 90 }, { top: 60 })).toBe(30);
  });

  it("pads the top by exactly the notice's overlap, and by nothing for a notice above the canvas", async () => {
    const aboveCanvas = noticeOverlap({ bottom: 40 }, { top: 60 });
    expect(fitPadding(undefined, aboveCanvas).top).toBe(fitPadding().top);
    const overlap = noticeOverlap({ bottom: 90 }, { top: 60 });
    expect(fitPadding(undefined, overlap).top).toBe(fitPadding().top + 30);
    expect(fitPadding().top).toBe(16);
  });

  it("keeps the top card's expander bubble inside the top padding of a fitted view", async () => {
    // The bubble sits `bubbleOverhang` above the card's top edge; a graph that fits leaves the padding clear of it.
    const top = card("c0", 0, 0, 200);
    const cards = [top, card("c1", 0, 300, 200), card("c2", 0, 600, 200)];
    const padding = fitPadding();
    const view = await fitFlow(cards, 1200);
    expect(view.zoom).toBeGreaterThan(ZOOM_OUT_BELOW);
    const bubbleTop =
      view.y + (top.position.y - geometry.bubbleOverhang) * view.zoom;
    expect(bubbleTop).toBeGreaterThanOrEqual(padding.top);
  });
});

describe("the whole-project fit", () => {
  it("opens at the zoom and centre of the neighbourhood it frames", async () => {
    // The open model c0 and its two neighbours are framed; the rest of the project lies far below them.
    const framed = [
      card("c0", 0, 0, 200),
      card("c1", 0, 260, 200),
      card("c2", 0, 520, 200),
    ];
    const rest = Array.from({ length: 30 }, (_, index) =>
      card(`far${index}`, 0, 2000 + index * 300, 200),
    );
    const { flow, views } = fakeFlow([...framed, ...rest]);
    await fitGraph({
      flow,
      options: {},
      padding: fitPadding(),
      width: 800,
      height: 600,
      focusId: "c0",
      frame: framed.map((node) => node.id),
    });
    const { flow: neighbourhood, views: neighbourhoodViews } = fakeFlow(framed);
    await fitGraph({
      flow: neighbourhood,
      options: {},
      padding: fitPadding(),
      width: 800,
      height: 600,
      focusId: "c0",
    });
    expect(views.at(-1)).toEqual(neighbourhoodViews.at(-1));
    expect(views.at(-1)?.zoom).toBeGreaterThan(ZOOM_OUT_BELOW);
  });
});
