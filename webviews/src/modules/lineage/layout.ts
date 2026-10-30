/** Node geometry the layout and the stylesheet share, in pixels. */
export const geometry = {
  tableWidth: 280,
  /** The header with its name block (title, file line, chips), padding and border. */
  headerHeight: 60,
  /** The relation line a start card shows under its name block. */
  relationHeight: 16,
  /** The extra header padding on a card with no column list, which keeps the expander bubbles clear of the text. */
  headerClearance: 5,
  /** A layered card's expander bubble: its width at least, and how far it sticks out past the card's top or bottom. */
  bubbleWidth: 40,
  bubbleOverhang: 9,
  groupHeight: 56,
  actionsHeight: 28,
  chipRowHeight: 24,
  columnHeight: 24,
  listPadding: 8,
};

/** Group chips per row on a table node. */
const CHIPS_PER_ROW = 2;

/** Most chip rows a table node draws inline; the rest go in its +N popover. */
const MAX_CHIP_ROWS = 2;

/** Rows a table node's `chips` group chips take: two to a row, and no more than `MAX_CHIP_ROWS` rows. */
const chipRows = (chips: number): number =>
  Math.min(Math.ceil(chips / CHIPS_PER_ROW), MAX_CHIP_ROWS);

/**
 * The height of a table node: its header, its group chips two to a row, capped at `MAX_CHIP_ROWS` rows with the rest
 * in the +N popover, and `columns` when listed. A `pinned` card (the start or selected card) adds its relation line
 * and its actions row; an unpinned card's actions row shows only on hover or focus, so it takes no space. An empty
 * list keeps one row for its message.
 */
export const tableHeight = (
  columns: readonly unknown[] | undefined,
  chips: number,
  pinned = false,
): number =>
  geometry.headerHeight +
  (pinned ? geometry.relationHeight + geometry.actionsHeight : 0) +
  chipRows(chips) * geometry.chipRowHeight +
  (columns
    ? geometry.listPadding + Math.max(columns.length, 1) * geometry.columnHeight
    : geometry.headerClearance);

/**
 * The distance from a layered card's top to the centre of its `index`th column row: the same stack `tableHeight` sums
 * before the column list.
 */
export const columnRowOffset = (
  index: number,
  chips: number,
  pinned: boolean,
): number =>
  geometry.headerHeight +
  (pinned ? geometry.relationHeight + geometry.actionsHeight : 0) +
  chipRows(chips) * geometry.chipRowHeight +
  geometry.listPadding +
  index * geometry.columnHeight +
  geometry.columnHeight / 2;

/**
 * How many of a table node's `count` group chips it draws inline: all of them up to a full set of rows, else one slot
 * fewer, since the +N button takes one.
 */
export const inlineChips = (count: number): number =>
  count <= CHIPS_PER_ROW * MAX_CHIP_ROWS
    ? count
    : CHIPS_PER_ROW * MAX_CHIP_ROWS - 1;

/** The handle ID of `column` on the given side of its table node. */
export const columnHandle = (side: "in" | "out", column: string): string =>
  `${side}:${column}`;

/** The canvas space a fit keeps clear, in pixels: the controls, the legend and the minimap. */
export interface FitPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A rectangle in flow units. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The viewport that centres the focused card horizontally and the graph vertically, at the largest zoom in
 * `[minZoom, maxZoom]` that keeps the whole graph inside the padded canvas. `bounds` is the graph's extent in flow
 * units and `focusX`, `focusY` the focused card's centre. The layered layout puts the focus off the middle of its
 * bounds, so centring the bounds would leave it to one side. When `minZoom` leaves the graph taller than the canvas,
 * the view centres on the focus vertically too, so the focused card stays on screen.
 *
 * When `minZoom` also leaves the graph wider than the canvas, `columns` names the main bands and the Other column.
 * The view then keeps the focus and the main bands on screen, and pans so the Other column sits at its edge in full
 * if both fit; a card is never left cut in half when it could be shown whole.
 */
export const focusedViewport = ({
  bounds,
  focusX,
  focusY,
  width,
  height,
  padding,
  minZoom,
  maxZoom,
  columns,
}: {
  bounds: Box;
  focusX: number;
  focusY?: number | undefined;
  width: number;
  height: number;
  padding: FitPadding;
  minZoom: number;
  maxZoom: number;
  columns?: { main: Box; other: Box } | undefined;
}): { x: number; y: number; zoom: number } => {
  const availableWidth = width - padding.left - padding.right;
  const availableHeight = height - padding.top - padding.bottom;
  // The zoom fits the whole graph; centring the focus then only pans within what that zoom shows, so a focus
  // near one side does not halve the zoom to leave empty canvas on the other.
  const fitted = Math.min(
    maxZoom,
    availableWidth / bounds.width,
    availableHeight / bounds.height,
  );
  const zoom = Math.max(minZoom, fitted);
  const overflows = bounds.height * zoom > availableHeight;
  const centreY =
    overflows && focusY !== undefined ? focusY : bounds.y + bounds.height / 2;
  const focusCentred = padding.left + availableWidth / 2 - focusX * zoom;
  // When the graph fits across, keep it whole on screen and as close to centred on the focus as that allows.
  const low = padding.left - bounds.x * zoom;
  const high = width - padding.right - (bounds.x + bounds.width) * zoom;
  const centred =
    bounds.width * zoom <= availableWidth
      ? Math.min(high, Math.max(low, focusCentred))
      : focusCentred;
  return {
    x: columns
      ? panToColumns({ columns, bounds, focusX, centred, zoom, padding, width })
      : centred,
    y: padding.top + availableHeight / 2 - centreY * zoom,
    zoom,
  };
};

/**
 * The view's left offset when the graph is wider than the canvas at its zoom. `centred` is the offset that centres
 * the focus; it is kept when it shows the whole graph. Otherwise the offset is the nearest one that shows the main
 * bands and the Other column in full, or, when they cannot both fit, the main bands with Other at the edge it sits on.
 */
const panToColumns = ({
  columns,
  bounds,
  focusX,
  centred,
  zoom,
  padding,
  width,
}: {
  columns: { main: Box; other: Box };
  bounds: Box;
  focusX: number;
  centred: number;
  zoom: number;
  padding: FitPadding;
  width: number;
}): number => {
  // The offsets at which a box lies inside the padded canvas.
  const span = (box: Box) => ({
    low: padding.left - box.x * zoom,
    high: width - padding.right - (box.x + box.width) * zoom,
  });
  const clamp = (value: number, { low, high }: { low: number; high: number }) =>
    Math.min(high, Math.max(low, value));
  const whole = span(bounds);
  if (centred >= whole.low && centred <= whole.high) {
    return centred;
  }
  const main = span(columns.main);
  const other = span(columns.other);
  const both = {
    low: Math.max(main.low, other.low),
    high: Math.min(main.high, other.high),
  };
  if (both.low <= both.high) {
    return clamp(centred, both);
  }
  if (main.low > main.high) {
    return centred;
  }
  // The Other column sits on the left of the focus when its centre does; the view then slides to show that side.
  const otherCentre = columns.other.x + columns.other.width / 2;
  return otherCentre < focusX ? main.high : main.low;
};
