import type { OrderResult } from "../order/index.js";
import type { LayoutOptions, Spacing } from "../types.js";
import { gapsLeft } from "./gaps.js";
import type { Link, Problem, Pull } from "./problem.js";

/** Link weight factor by the number of dummy ends: real-real, real-dummy and dummy-dummy. */
const DUMMY_FACTOR = [1, 2, 8];

/** Pull weight that holds the anchor at the origin before the translation that makes it exact. */
const ANCHOR_WEIGHT = 100;

/** Weight of a cluster spine's link before the dummy factor: it keeps a spine straight without moving its members much. */
const SPINE_WEIGHT = 1;

/** One link between each two consecutive nodes of every cluster spine, weighted as the dummies at its ends. */
function spineLinks(
  spines: readonly (readonly number[])[],
  dummy: readonly boolean[],
): Link[] {
  return spines.flatMap((run) =>
    run.slice(1).map((bottom, k) => {
      const top = run[k]!;
      const ends = [top, bottom].filter((i) => dummy[i]).length;
      return {
        top,
        bottom,
        weight: SPINE_WEIGHT * DUMMY_FACTOR[ends]!,
        topOffset: 0,
        bottomOffset: 0,
      } satisfies Link;
    }),
  );
}

/** The problem of an ordering: the rank chains, the links of its segments and spines, and the pulls of its hints. */
export function problemOf(
  ordering: OrderResult,
  options: LayoutOptions,
  spacing: Pick<Spacing, "node" | "edge">,
): Problem {
  const { layered, layers } = ordering;
  const dummy = layered.nodes.map((node) => node.id === undefined);
  return {
    layers,
    gapLeft: gapsLeft(layers, layered, spacing),
    dummy,
    links: [
      ...layered.segments.map((segment) => {
        const ends = [segment.top, segment.bottom].filter(
          (i) => dummy[i],
        ).length;
        return {
          top: segment.top,
          bottom: segment.bottom,
          weight: segment.weight * DUMMY_FACTOR[ends]!,
          topOffset: segment.topOffset,
          bottomOffset: segment.bottomOffset,
        } satisfies Link;
      }),
      ...spineLinks(layered.spines, dummy),
    ],
    pulls: pullsOf(layered.nodes, options),
  };
}

/**
 * The pulls: the anchor is held at zero; each hinted real node is drawn to its previous in-rank centre, weighted by
 * `stability`. A hint gives the top-left corner, so the centre adds half the node's breadth.
 */
function pullsOf(
  nodes: readonly {
    id: string | undefined;
    breadth: number;
  }[],
  options: LayoutOptions,
): Pull[] {
  const stability = options.stability ?? 1;
  const pulls: Pull[] = [];
  nodes.forEach((node, i) => {
    if (node.id === undefined) {
      return;
    }
    if (node.id === options.anchor) {
      pulls.push({ node: i, weight: ANCHOR_WEIGHT, target: 0 });
      return;
    }
    const hint = options.hints?.nodes.get(node.id);
    if (hint !== undefined && stability > 0) {
      const corner = options.direction === "down" ? hint.x : hint.y;
      pulls.push({
        node: i,
        weight: stability,
        target: corner + node.breadth / 2,
      });
    }
  });
  return pulls;
}
