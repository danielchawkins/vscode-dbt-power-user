import type { lineage } from "@fusion-power-user/webview-contract";
import { Position } from "@xyflow/react";

/** One end of a declared relationship: `many` draws a crow's foot, `one` a bar. */
export type RelationEnd = "many" | "one";

/** The end marks of a cardinality such as `many-to-one`: `from` is the declaring side, `to` the referenced side. */
export const relationEnds = (
  cardinality: string,
): { from: RelationEnd; to: RelationEnd } => {
  const [from = "", to = ""] = cardinality.split("-to-");
  return {
    from: from === "many" ? "many" : "one",
    to: to === "many" ? "many" : "one",
  };
};

/** Length of the crow's foot's stem along the line, in pixels. */
const FOOT_LENGTH = 9;
/** Distance of each toe from the foot's centre line, along the card side. */
const TOE_SPREAD = 6;
/** Distance of the bar from the card side, in pixels. */
const BAR_OFFSET = 6;
/** Half the bar's length, in pixels. */
const BAR_HALF_LENGTH = 6;

/** The unit vector pointing out of a card side, away from the card, for a handle at `position`. */
const outward = (position: Position): [number, number] => {
  switch (position) {
    case Position.Left:
      return [-1, 0];
    case Position.Right:
      return [1, 0];
    case Position.Top:
      return [0, -1];
    case Position.Bottom:
      return [0, 1];
  }
};

/**
 * SVG path data for the mark at one end of an edge: a crow's foot (three toes on the card side fanning in to one point
 * on the line) for `many`, or a bar across the line for `one`. `(x, y)` is where the edge meets the card.
 */
export const endMark = (
  end: RelationEnd,
  x: number,
  y: number,
  position: Position,
): string => {
  const [ox, oy] = outward(position);
  // The unit vector along the card side.
  const [px, py] = [-oy, ox];
  if (end === "one") {
    const cx = x + ox * BAR_OFFSET;
    const cy = y + oy * BAR_OFFSET;
    const first = `${cx - px * BAR_HALF_LENGTH},${cy - py * BAR_HALF_LENGTH}`;
    const last = `${cx + px * BAR_HALF_LENGTH},${cy + py * BAR_HALF_LENGTH}`;
    return `M${first} L${last}`;
  }
  const apexX = x + ox * FOOT_LENGTH;
  const apexY = y + oy * FOOT_LENGTH;
  return [
    [x + px * TOE_SPREAD, y + py * TOE_SPREAD],
    [x, y],
    [x - px * TOE_SPREAD, y - py * TOE_SPREAD],
  ]
    .map(([tx, ty]) => `M${tx},${ty} L${apexX},${apexY}`)
    .join(" ");
};

/** Where a relationship's source label says it was declared or derived. */
const SOURCE_LABEL: Record<lineage.RefSource, string> = {
  meta: "declared in meta.relationships",
  test: "relationships test",
  contract: "contract foreign key",
  semantic: "semantic entities",
  inferred: "inferred from column names",
};

/** The hover text of a relationship: `from.cols -> to.cols`, and the source that declares it. */
export const relationTitle = (
  ref: lineage.LineageRef,
): { columns: string; source: string } => ({
  columns: `${ref.from.columns.join(", ")} -> ${ref.to.columns.join(", ")}`,
  source: SOURCE_LABEL[ref.source],
});
