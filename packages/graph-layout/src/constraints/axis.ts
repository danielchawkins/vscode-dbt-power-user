import { solveSeparations } from "../place/vpsc.js";
import { reduceEqualities } from "./equalities.js";
import type { AxisProblem } from "./types.js";

/**
 * The positions nearest the desired ones, by weighted squared distance, that satisfy every separation and equality of
 * the axis. Equalities are reduced first; the separations are then solved by VPSC's block merging, which reports a
 * separation cycle by name. Without equalities the solver is given the problem unchanged.
 */
export function projectAxis(problem: AxisProblem): number[] {
  const reduction = reduceEqualities(problem);
  const { desired, weight, separations } = reduction.problem;
  return reduction.expand(solveSeparations(desired, weight, separations));
}
