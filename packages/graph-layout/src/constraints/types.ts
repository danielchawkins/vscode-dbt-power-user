/**
 * One axis of a layout: variables, each with a desired position and a weight, and the constraints among them. The only
 * constraints are separations, and an alignment is a separation that holds with equality.
 */

/** A constraint between two variables: x[to] - x[from] >= gap, or x[to] - x[from] = gap when `equality` is set. */
export interface Separation {
  from: number;
  to: number;
  gap: number;
  /** Holds exactly, as an alignment does, rather than as a least distance. */
  equality?: boolean;
}

/** The variables of one axis and the constraints among them. */
export interface AxisProblem {
  /** Each variable's desired position. */
  desired: readonly number[];
  /** Each variable's weight: the cost of moving it away from its desired position. Strictly positive. */
  weight: readonly number[];
  separations: readonly Separation[];
  /** Names for error messages, by variable; the index is used for a variable without one. */
  names?: readonly string[];
}
