import { describe, expect, it } from "vitest";
import { focusedViewport, geometry, inlineChips, tableHeight } from "./layout";

const padding = { top: 16, right: 216, bottom: 40, left: 56 };
const limits = { minZoom: 0.05, maxZoom: 1 };

describe("focusedViewport", () => {
  it("zooms to fit the whole graph, then slides it as close to centring the focus as keeps it on screen", () => {
    // The graph runs from x = -100 to 400, so the focus at 0 is nearer its left edge.
    const bounds = { x: -100, y: 0, width: 500, height: 200 };
    const view = focusedViewport({
      bounds,
      focusX: 0,
      width: 800,
      height: 600,
      padding,
      ...limits,
    });
    // The padded canvas is 528 px wide, so the 500-unit graph fits it whole; the zoom is capped at 100%.
    expect(view.zoom).toBe(1);
    const right = view.x + (bounds.x + bounds.width) * view.zoom;
    const left = view.x + bounds.x * view.zoom;
    expect(right).toBeLessThanOrEqual(800 - padding.right + 1e-9);
    expect(left).toBeGreaterThanOrEqual(padding.left - 1e-9);
  });

  it("centres the focus when the graph has room to slide", () => {
    // The graph runs from -100 to 100 around a focus at 0, so centring it leaves the whole graph on screen.
    const bounds = { x: -100, y: 0, width: 200, height: 200 };
    const view = focusedViewport({
      bounds,
      focusX: 0,
      width: 800,
      height: 600,
      padding,
      minZoom: 0.05,
      maxZoom: 1,
    });
    // The padded canvas runs from 56 to 584, so its middle is 320.
    expect(view.zoom).toBe(1);
    expect(view.x).toBeCloseTo(320, 6);
  });

  it("stops short of centring the focus when that would push the graph off screen", () => {
    // The graph runs from -300 to 100, so centring the focus at 0 would push its left part off the canvas.
    const bounds = { x: -300, y: 0, width: 400, height: 200 };
    const view = focusedViewport({
      bounds,
      focusX: 0,
      width: 800,
      height: 600,
      padding,
      minZoom: 0.05,
      maxZoom: 1,
    });
    // At 100% the graph's left edge stops at the canvas's left edge, 56, so the focus sits at 356, not 320.
    expect(view.x + bounds.x * view.zoom).toBeCloseTo(padding.left, 6);
    expect(view.x).toBeCloseTo(356, 6);
  });

  it("centres the graph's height in the padded canvas", () => {
    const bounds = { x: 0, y: 100, width: 200, height: 100 };
    const view = focusedViewport({
      bounds,
      focusX: 100,
      width: 800,
      height: 600,
      padding,
      ...limits,
    });
    // The padded height runs from 16 to 560, so its middle is 288.
    expect(view.y + (bounds.y + bounds.height / 2) * view.zoom).toBeCloseTo(
      288,
      6,
    );
  });

  it("caps the zoom at 100%, so a small graph draws at full size", () => {
    const view = focusedViewport({
      bounds: { x: -140, y: 0, width: 280, height: 150 },
      focusX: 0,
      width: 1200,
      height: 900,
      padding,
      ...limits,
    });
    expect(view.zoom).toBe(1);
  });

  it("never zooms out past the minimum zoom", () => {
    const view = focusedViewport({
      bounds: { x: -50000, y: 0, width: 100000, height: 100 },
      focusX: 0,
      width: 800,
      height: 600,
      padding,
      ...limits,
    });
    expect(view.zoom).toBe(0.05);
  });

  it("keeps a focused card at the top of a tall graph on screen when the zoom is clamped", () => {
    // A source with a deep set of descendants: the focus is in the top row of a graph far taller than the canvas.
    const bounds = { x: -140, y: 0, width: 280, height: 5000 };
    const view = focusedViewport({
      bounds,
      focusX: 0,
      focusY: 40,
      width: 800,
      height: 600,
      padding,
      minZoom: 0.5,
      maxZoom: 1,
    });
    expect(view.zoom).toBe(0.5);
    // The padded height runs from 16 to 560, so its middle is 288.
    expect(view.y + 40 * view.zoom).toBeCloseTo(288, 6);
  });

  it("pans the view so the Other column is whole when the focus and the main bands fit at the clamped zoom", () => {
    // The main bands run from 0 to 800 with the focus at 400; the Other column sits left of them, from -200 to -100.
    // At 0.5 the whole graph is 500 px wide, which the 528 px canvas holds, yet centring the focus would cut Other.
    const main = { x: 0, y: 0, width: 800, height: 200 };
    const other = { x: -200, y: 0, width: 100, height: 200 };
    const bounds = { x: -200, y: 0, width: 1000, height: 200 };
    const view = focusedViewport({
      bounds,
      columns: { main, other },
      focusX: 400,
      width: 800,
      height: 600,
      padding,
      minZoom: 0.5,
      maxZoom: 1,
    });
    expect(view.zoom).toBeCloseTo(528 / 1000, 6);
    const inside = (box: typeof main) => ({
      left: view.x + box.x * view.zoom,
      right: view.x + (box.x + box.width) * view.zoom,
    });
    expect(inside(other).left).toBeGreaterThanOrEqual(padding.left - 1e-9);
    expect(inside(main).right).toBeLessThanOrEqual(800 - padding.right + 1e-9);
    expect(inside(other).right).toBeLessThanOrEqual(800 - padding.right + 1e-9);
  });

  it("keeps the focus and the main bands on screen when the Other column cannot also fit", () => {
    const main = { x: 0, y: 0, width: 800, height: 200 };
    const other = { x: -400, y: 0, width: 200, height: 200 };
    const bounds = { x: -400, y: 0, width: 1200, height: 200 };
    const view = focusedViewport({
      bounds,
      columns: { main, other },
      focusX: 400,
      width: 800,
      height: 600,
      padding,
      minZoom: 0.5,
      maxZoom: 1,
    });
    const focus = view.x + 400 * view.zoom;
    expect(focus).toBeGreaterThanOrEqual(padding.left);
    expect(focus).toBeLessThanOrEqual(800 - padding.right);
    expect(view.x + (main.x + main.width) * view.zoom).toBeLessThanOrEqual(
      800 - padding.right + 1e-9,
    );
    expect(view.x + main.x * view.zoom).toBeGreaterThanOrEqual(
      padding.left - 1e-9,
    );
  });
});

describe("tableHeight", () => {
  it("is the plain name block on every card: no relation line and no actions row", () => {
    // The pre-strip height: a 60px header and the 5px clearance under it, on a card with no column list.
    expect(tableHeight(undefined, 0)).toBe(65);
    expect(tableHeight(undefined, 0)).toBe(
      geometry.headerHeight + geometry.headerClearance,
    );
  });

  it("adds the column list and the chip rows, and nothing for the strip", () => {
    // 60px header, one 24px chip row, the 8px list padding and two 24px column rows.
    expect(tableHeight(["a", "b"], 2)).toBe(140);
  });
});

describe("inlineChips", () => {
  it("draws every chip up to four, then three to leave room for +N", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(inlineChips)).toEqual([
      0, 1, 2, 3, 4, 3, 3,
    ]);
  });
});

describe("tableHeight chip rows", () => {
  const base = tableHeight(undefined, 0);

  it("takes no chip row for no chips and two chips to a row", () => {
    expect(tableHeight(undefined, 1)).toBe(base + geometry.chipRowHeight);
    expect(tableHeight(undefined, 2)).toBe(base + geometry.chipRowHeight);
    expect(tableHeight(undefined, 3)).toBe(base + 2 * geometry.chipRowHeight);
  });

  it("caps chip rows at two, so 5 and 10 chips are no taller than 4", () => {
    expect(tableHeight(undefined, 4)).toBe(base + 2 * geometry.chipRowHeight);
    expect(tableHeight(undefined, 5)).toBe(tableHeight(undefined, 4));
    expect(tableHeight(undefined, 10)).toBe(tableHeight(undefined, 4));
  });
});
