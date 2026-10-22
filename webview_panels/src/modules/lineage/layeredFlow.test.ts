import { describe, expect, it, vi } from "vitest";
import * as layered from "./layered";
import type { LayeredNode } from "./layered";
import { type LayeredFlowInput, layeredFlow } from "./layeredFlow";

vi.mock("./layered", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./layered")>();
  return { ...actual, layoutLayered: vi.fn(actual.layoutLayered) };
});

const node = (id: string, tag: string): LayeredNode => ({
  id,
  width: 280,
  height: 100,
  tag,
});

const input = (
  nodes: LayeredNode[],
  pairs: [string, string][],
): LayeredFlowInput => ({
  start: "s",
  nodes,
  tableRoutes: pairs.map(([parent, child]) => ({
    id: `t:${parent}->${child}`,
    parent,
    child,
  })),
  columnRoutes: [],
  relationshipRoutes: [],
  traceOn: false,
});

const xOf = (flow: ReturnType<typeof layeredFlow>, id: string): number =>
  flow.positions.get(id)?.x ?? NaN;

describe("layeredFlow Other column side", () => {
  it("puts the Other column on the left when the left side crosses less", () => {
    // n1 feeds both o and n2, so the right-hand column has to cross n1's edge to n2.
    const flow = layeredFlow(
      input(
        [
          node("s", "intermediate"),
          node("n0", "marts"),
          node("n1", "staging"),
          node("n2", "source"),
          node("o", "other"),
        ],
        [
          ["s", "n0"],
          ["n1", "o"],
          ["n1", "n2"],
        ],
      ),
    );
    expect(xOf(flow, "o")).toBeLessThan(xOf(flow, "s"));
    expect(flow.crossings).toBe(1);
  });

  it("puts the Other column on the right when the right side crosses less", () => {
    const flow = layeredFlow(
      input(
        [
          node("s", "intermediate"),
          node("n0", "intermediate"),
          node("n1", "intermediate"),
          node("n2", "intermediate"),
          node("n3", "staging"),
          node("o", "other"),
        ],
        [
          ["n1", "s"],
          ["o", "n1"],
          ["o", "s"],
        ],
      ),
    );
    expect(xOf(flow, "o")).toBeGreaterThan(xOf(flow, "s"));
    expect(flow.crossings).toBe(0);
  });
});

describe("layeredFlow layout attempts", () => {
  it("lays out once when no node is in the Other column", () => {
    vi.mocked(layered.layoutLayered).mockClear();
    layeredFlow(
      input([node("s", "intermediate"), node("m", "marts")], [["s", "m"]]),
    );
    expect(layered.layoutLayered).toHaveBeenCalledTimes(1);
  });

  it("tries both sides when a node is in the Other column", () => {
    vi.mocked(layered.layoutLayered).mockClear();
    layeredFlow(
      input([node("s", "intermediate"), node("o", "other")], [["s", "o"]]),
    );
    expect(layered.layoutLayered).toHaveBeenCalledTimes(2);
  });
});

describe("layeredFlow at scale", () => {
  it("draws every edge of a 60-node, 120-edge graph", () => {
    // Four layers of 10, 15, 20 and 15 cards, each child fed by two parents in the layer above, then random
    // edges between adjacent layers up to 120. Every seventh card is in the Other column.
    const sizes = [10, 15, 20, 15];
    const tags = ["source", "staging", "intermediate", "marts"];
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const layers: string[][] = [];
    const nodes: LayeredNode[] = [];
    sizes.forEach((size, layer) => {
      const ids: string[] = [];
      for (let i = 0; i < size; i++) {
        const id = `n${nodes.length}`;
        ids.push(id);
        const tag = nodes.length % 7 === 6 ? "other" : (tags[layer] ?? "other");
        nodes.push(node(id, tag));
      }
      layers.push(ids);
    });
    const pairs: [string, string][] = [];
    const seen = new Set<string>();
    const connect = (parent: string, child: string): void => {
      const key = `${parent}>${child}`;
      if (parent !== child && !seen.has(key)) {
        seen.add(key);
        pairs.push([parent, child]);
      }
    };
    const pick = (ids: string[]): string =>
      ids[Math.floor(random() * ids.length)] ?? "";
    for (let layer = 1; layer < layers.length; layer++) {
      for (const child of layers[layer] ?? []) {
        connect(pick(layers[layer - 1] ?? []), child);
        connect(pick(layers[layer - 1] ?? []), child);
      }
    }
    while (pairs.length < 120) {
      const layer = Math.floor(random() * (layers.length - 1));
      connect(pick(layers[layer] ?? []), pick(layers[layer + 1] ?? []));
    }
    const flow = { ...input(nodes, pairs), start: layers[1]?.[0] ?? "" };
    const result = layeredFlow(flow);
    // Wall-clock time is not asserted: coverage instrumentation slows this loop by about 3x, so a fixed bound is
    // unreliable in the gate. The check is that every edge is drawn and the layout is finite.
    expect(result.paths.size).toBe(pairs.length);
    expect(result.positions.size).toBe(nodes.length);
    expect(Number.isFinite(result.crossings)).toBe(true);
  });
});
