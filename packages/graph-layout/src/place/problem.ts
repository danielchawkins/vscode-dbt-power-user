import type { Separation } from "./vpsc.js";

/** A segment between adjacent ranks, pulling its two ends together. */
export interface Link {
  /** The node at the upper end (the smaller rank). */
  top: number;
  /** The node at the lower end. */
  bottom: number;
  /** Straightening weight of the segment, already scaled for dummies. */
  weight: number;
  /** Port offset of each end from its node's centre along the in-rank axis. */
  topOffset: number;
  bottomOffset: number;
}

/** A soft pull of one node towards a target coordinate, weighted against the links. */
export interface Pull {
  node: number;
  weight: number;
  target: number;
}

/**
 * The in-rank placement problem: each node's coordinate p is its centre along the in-rank axis. Links and pulls give
 * the objective; the ranks give the separation constraints.
 */
export interface Problem {
  /** Nodes of each rank, from left to right: the order that placement must keep. */
  layers: readonly (readonly number[])[];
  /** Least distance between each node's centre and its left neighbour's, by node; 0 for a rank's leftmost node. */
  gapLeft: readonly number[];
  /** Whether each node is a dummy. */
  dummy: readonly boolean[];
  links: readonly Link[];
  pulls: readonly Pull[];
  /**
   * Cluster boxes: variables after the nodes, and every separation among all variables. Absent when there are no
   * clusters, and then the rank chains alone are the separations.
   */
  extra?: Extension;
}

/** Variables beyond the layered nodes, and the separations among all of them. */
interface Extension {
  count: number;
  separations: Separation[];
}
