/** An edge as the cycle breaking sees it: only its two ends and its id matter. */
export interface AcyclicEdge {
  id: string;
  source: string;
  target: string;
}

interface Arc {
  from: number;
  to: number;
}

/**
 * The edges that point backwards in a node order chosen by Eades, Lin and Smyth's greedy heuristic (Information
 * Processing Letters 47(6), 1993). Removing them leaves an acyclic graph, so ranking can run on it. Reversing them
 * is a choice of ranking direction only: the caller still draws each edge from its source to its target. Self-loops
 * never point backwards in any order, so they are never reported.
 */
export function reversedEdges(edges: readonly AcyclicEdge[]): string[] {
  const names = new Map<string, number>();
  const nodeOf = (name: string): number => {
    const seen = names.get(name);
    if (seen !== undefined) {
      return seen;
    }
    names.set(name, names.size);
    return names.size - 1;
  };
  const arcs: Arc[] = edges.map((e) => ({
    from: nodeOf(e.source),
    to: nodeOf(e.target),
  }));
  const position = greedyOrder(names.size, arcs);
  return edges
    .filter((_, i) => {
      const arc = arcs[i]!;
      return arc.from !== arc.to && position[arc.from]! > position[arc.to]!;
    })
    .map((e) => e.id);
}

/**
 * Orders the nodes: sinks are moved to the back, sources to the front, and otherwise the node with the largest
 * out-degree minus in-degree goes to the front. Ties go to the lowest index, so the order is deterministic.
 */
function greedyOrder(count: number, arcs: readonly Arc[]): number[] {
  const outArcs: number[][] = Array.from({ length: count }, () => []);
  const inArcs: number[][] = Array.from({ length: count }, () => []);
  arcs.forEach((arc, i) => {
    if (arc.from === arc.to) {
      return;
    }
    outArcs[arc.from]!.push(i);
    inArcs[arc.to]!.push(i);
  });
  const outDegree = outArcs.map((list) => list.length);
  const inDegree = inArcs.map((list) => list.length);
  const alive = Array.from({ length: count }, () => true);
  const front: number[] = [];
  const back: number[] = [];
  let remaining = count;

  const remove = (v: number): void => {
    alive[v] = false;
    remaining--;
    for (const i of outArcs[v]!) {
      inDegree[arcs[i]!.to]! -= 1;
    }
    for (const i of inArcs[v]!) {
      outDegree[arcs[i]!.from]! -= 1;
    }
  };
  const removeSinksAndSources = (): void => {
    let found = true;
    while (found) {
      found = false;
      for (let v = 0; v < count; v++) {
        if (!alive[v]) {
          continue;
        }
        if (outDegree[v] === 0) {
          back.push(v);
        } else if (inDegree[v] === 0) {
          front.push(v);
        } else {
          continue;
        }
        remove(v);
        found = true;
      }
    }
  };
  const bestRemaining = (): number => {
    let best = -1;
    for (let v = 0; v < count; v++) {
      if (!alive[v]) {
        continue;
      }
      const score = outDegree[v]! - inDegree[v]!;
      if (best < 0 || score > outDegree[best]! - inDegree[best]!) {
        best = v;
      }
    }
    return best;
  };

  removeSinksAndSources();
  while (remaining > 0) {
    const v = bestRemaining();
    front.push(v);
    remove(v);
    removeSinksAndSources();
  }
  const sequence = [...front, ...back.reverse()];
  const position: number[] = [];
  sequence.forEach((v, p) => {
    position[v] = p;
  });
  return position;
}
