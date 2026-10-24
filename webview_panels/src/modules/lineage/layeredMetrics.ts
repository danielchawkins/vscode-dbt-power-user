/** A band reaches this far past its cards on every side. */

export const BAND_PAD = 22;
/** Bare canvas between two bands, and around the Other column. */
export const GUTTER = 36;
/** Width of the clear strip between the cards on either side of the start node. */
export const CORRIDOR = 64;
/** The gap between two cards in one sub-row. */
export const CARD_GAP = 28;
/** The gap between two sub-rows that share one band. */
export const SAME_ROW = 58;
/** Canvas margin above the first row, and beside the outermost band. */
export const TOP_MARGIN = 40;
export const SIDE_MARGIN = BAND_PAD + GUTTER + 8;
export type Side = 1 | -1;
export interface Point {
  x: number;
  y: number;
}
export interface LayeredNode {
  id: string;
  width: number;
  height: number;
  tag: string;
}
