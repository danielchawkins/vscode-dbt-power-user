/** A constraint `rank(head) - rank(tail) >= minLength`, with `weight` per unit of rank length. No self-loops. */
export interface NetworkEdge {
  tail: number;
  head: number;
  minLength: number;
  weight: number;
}
