import { cyclicClasses } from "./cycles.js";
import type { AxisProblem, Separation } from "./types.js";

/** Offsets that differ by no more than this are the same offset: a float sum, not a tolerance on the layout. */
const TOLERANCE = 1e-9;

/** The problem over equality classes: one variable per class, numbered in order of the class's lowest member. */
interface Reduction {
  problem: {
    desired: number[];
    weight: number[];
    separations: Separation[];
  };
  /** The value of each original variable, given the value of each class: its class's value plus its offset. */
  expand(values: readonly number[]): number[];
}

/** A link of an equality graph: the other end, and the offset it sits from this end. */
interface Link {
  to: number;
  offset: number;
}

/** Each variable's class, by its number in the reduction, and its offset from the class's root. */
interface Classes {
  classOf: number[];
  offset: number[];
  count: number;
}

/** The state of the walk that finds the classes: the equality links, and each variable's root and offset so far. */
interface Walk {
  problem: AxisProblem;
  links: readonly Link[][];
  root: number[];
  offset: number[];
}

/**
 * Reduces an axis problem so that its separations alone solve it. Each class of variables held equal by equalities
 * becomes one variable, at the least-squares point of its members (the weighted mean of their desired positions less
 * their offsets), and each separation is rewritten between classes. Throws, naming the variables, when equalities
 * contradict one another, or when a separation inside one class cannot hold.
 */
export function reduceEqualities(problem: AxisProblem): Reduction {
  checkIndices(problem);
  if (!problem.separations.some((s) => s.equality)) {
    return unchanged(problem);
  }
  const classes = classesOf(problem);
  const { classOf, offset, count } = classes;
  const separations = rewritten(problem, classes);
  assertNoClassCycle(problem, classes, separations);
  return {
    problem: {
      desired: classMeans(problem, classes),
      weight: classWeights(problem, classOf, count),
      separations,
    },
    expand: (values) =>
      problem.desired.map((_, v) => values[classOf[v]!]! + offset[v]!),
  };
}

function unchanged(problem: AxisProblem): Reduction {
  return {
    problem: {
      desired: [...problem.desired],
      weight: [...problem.weight],
      separations: problem.separations.filter((s) => !s.equality),
    },
    expand: (values) => [...values],
  };
}

function checkIndices(problem: AxisProblem): void {
  const n = problem.desired.length;
  for (const s of problem.separations) {
    for (const v of [s.from, s.to]) {
      if (!Number.isInteger(v) || v < 0 || v >= n) {
        throw new RangeError(`variable index ${v} is outside 0..${n - 1}`);
      }
    }
  }
}

function nameOf(problem: AxisProblem, v: number): string {
  return problem.names?.[v] ?? String(v);
}

/** The class of each variable, numbered by its lowest member, and each variable's offset from that member. */
function classesOf(problem: AxisProblem): Classes {
  const n = problem.desired.length;
  const walk: Walk = {
    problem,
    links: equalityLinks(problem),
    root: Array.from({ length: n }, () => -1),
    offset: Array.from({ length: n }, () => 0),
  };
  for (let v = 0; v < n; v++) {
    if (walk.root[v] === -1) {
      spread(walk, v);
    }
  }
  const { root, offset } = walk;
  const number = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    if (root[v] === v) {
      number.set(v, number.size);
    }
  }
  return {
    classOf: root.map((r) => number.get(r)!),
    offset,
    count: number.size,
  };
}

function equalityLinks(problem: AxisProblem): Link[][] {
  const links = problem.desired.map((): Link[] => []);
  for (const s of problem.separations) {
    if (s.equality) {
      links[s.from]!.push({ to: s.to, offset: s.gap });
      links[s.to]!.push({ to: s.from, offset: -s.gap });
    }
  }
  return links;
}

/**
 * Breadth-first over one class from `start`, recording each member's root and offset. A member reached again by a
 * different offset is a contradiction, and is reported by the two variables where it closes.
 */
function spread(walk: Walk, start: number): void {
  const { problem, links, root, offset } = walk;
  root[start] = start;
  const queue = [start];
  for (const u of queue) {
    for (const { to, offset: step } of links[u]!) {
      const want = offset[u]! + step;
      if (root[to] === -1) {
        root[to] = start;
        offset[to] = want;
        queue.push(to);
      } else if (Math.abs(offset[to]! - want) > TOLERANCE) {
        throw new Error(
          `equalities contradict each other: ${nameOf(problem, to)} is forced ${want} from ${nameOf(problem, start)} through ${nameOf(problem, u)}, and ${offset[to]} through another chain`,
        );
      }
    }
  }
}

/** Each class's least-squares desired position; a class of one variable keeps that variable's position exactly. */
function classMeans(problem: AxisProblem, classes: Classes): number[] {
  const { classOf, offset, count } = classes;
  const sum = Array.from({ length: count }, () => 0);
  const size = Array.from({ length: count }, () => 0);
  const only = Array.from({ length: count }, () => 0);
  const weight = classWeights(problem, classOf, count);
  problem.desired.forEach((d, v) => {
    const c = classOf[v]!;
    sum[c]! += problem.weight[v]! * (d - offset[v]!);
    size[c]! += 1;
    only[c] = v;
  });
  return sum.map((s, c) =>
    size[c] === 1 ? problem.desired[only[c]!]! : s / weight[c]!,
  );
}

function classWeights(
  problem: AxisProblem,
  classOf: readonly number[],
  count: number,
): number[] {
  const weight = Array.from({ length: count }, () => 0);
  problem.weight.forEach((w, v) => {
    weight[classOf[v]!]! += w;
  });
  return weight;
}

/**
 * Throws, naming the variables, when the separations between classes form a cycle. Merging a DAG's classes can close
 * such a cycle; the solver takes only DAGs, so the case is reported instead of failing inside it.
 */
function assertNoClassCycle(
  problem: AxisProblem,
  classes: Classes,
  separations: readonly Separation[],
): void {
  const stuck = new Set(cyclicClasses(classes.count, separations));
  if (stuck.size === 0) {
    return;
  }
  const names = problem.desired
    .flatMap((_, v) =>
      stuck.has(classes.classOf[v]!) ? [nameOf(problem, v)] : [],
    )
    .join(", ");
  throw new Error(
    `separations form a cycle once equal variables are merged, which the solver cannot take: ${names}`,
  );
}

/**
 * Each inequality between two classes, with its gap corrected for the offsets. An inequality inside one class must
 * already hold, or it is a contradiction.
 */
function rewritten(problem: AxisProblem, classes: Classes): Separation[] {
  const { classOf, offset } = classes;
  const out: Separation[] = [];
  for (const s of problem.separations) {
    if (s.equality) {
      continue;
    }
    const from = classOf[s.from]!;
    const to = classOf[s.to]!;
    const gap = s.gap - offset[s.to]! + offset[s.from]!;
    if (from !== to) {
      out.push({ from, to, gap });
    } else if (gap > TOLERANCE) {
      throw new Error(
        `separation of ${s.gap} from ${nameOf(problem, s.from)} to ${nameOf(problem, s.to)} cannot hold: they are forced ${offset[s.to]! - offset[s.from]!} apart`,
      );
    }
  }
  return out;
}
