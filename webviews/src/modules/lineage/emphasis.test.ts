import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  connectionCounts,
  type Emphasis,
  emphasisOf,
  type Pair,
} from "./emphasis";

// `a` feeds `b` and `d`; `b` feeds `c`. `d` sits on a branch that `c` never reaches.
const EDGES: Pair[] = [
  ["a", "b"],
  ["a", "d"],
  ["b", "c"],
];

const on: Emphasis = {
  focus: "c",
  pathHighlight: true,
  dimOffPath: true,
  hubDeemphasis: true,
  maxNeighbours: 20,
};

describe("emphasisOf", () => {
  it("puts the focus and every card upstream or downstream of it on the path, and dims the rest", () => {
    const view = emphasisOf(EDGES, connectionCounts(EDGES), on);
    expect(["a", "b", "c"].map(view.pathCard)).toEqual([true, true, true]);
    expect(view.pathCard("d")).toBe(false);
    expect(view.dimmedCard("d")).toBe(true);
    expect(view.dimmedCard("c")).toBe(false);
  });

  it("marks the edges on the path and dims the others", () => {
    const view = emphasisOf(EDGES, connectionCounts(EDGES), on);
    expect(view.pathEdge("a", "b")).toBe(true);
    expect(view.pathEdge("b", "c")).toBe(true);
    expect(view.pathEdge("a", "d")).toBe(false);
    expect(view.dimmedEdge("a", "d")).toBe(true);
    expect(view.dimmedEdge("b", "c")).toBe(false);
  });

  it("highlights nothing and dims nothing with no focus or with the settings off", () => {
    const counts = connectionCounts(EDGES);
    const off = emphasisOf(EDGES, counts, { ...on, focus: undefined });
    expect(off.pathCard("c")).toBe(false);
    expect(off.dimmedCard("d")).toBe(false);
    expect(off.pathEdge("b", "c")).toBe(false);
    const settingsOff = emphasisOf(EDGES, counts, {
      ...on,
      pathHighlight: false,
      dimOffPath: false,
    });
    expect(settingsOff.pathCard("c")).toBe(false);
    expect(settingsOff.dimmedCard("d")).toBe(false);
    expect(settingsOff.dimmedEdge("a", "d")).toBe(false);
  });

  it("marks the edges of a card with more connections than maxNeighbours as hub edges", () => {
    // `a` has two connections, `b` two, `c` and `d` one.
    const counts = connectionCounts(EDGES);
    const view = emphasisOf(EDGES, counts, { ...on, maxNeighbours: 1 });
    expect(view.hubEdge("a", "b")).toBe(true);
    expect(view.hubEdge("b", "c")).toBe(true);
    expect(view.hubEdge("a", "d")).toBe(true);
    const none = emphasisOf(EDGES, counts, { ...on, maxNeighbours: 2 });
    expect(none.hubEdge("a", "b")).toBe(false);
    const off = emphasisOf(EDGES, counts, {
      ...on,
      maxNeighbours: 1,
      hubDeemphasis: false,
    });
    expect(off.hubEdge("a", "b")).toBe(false);
  });

  it("counts a hub by its known connections, capped ones included, not by the drawn edges", () => {
    // `hub` has four known children, but only `h1` and `p` are drawn: the expansion's cap left the rest out.
    const known: Pair[] = [
      ["hub", "h1"],
      ["hub", "h2"],
      ["hub", "h3"],
      ["hub", "h4"],
      ["p", "hub"],
    ];
    const drawn: Pair[] = [
      ["hub", "h1"],
      ["p", "hub"],
    ];
    const emphasis = { ...on, focus: undefined, maxNeighbours: 2 };
    const fromKnown = emphasisOf(drawn, connectionCounts(known), emphasis);
    expect(fromKnown.hubEdge("hub", "h1")).toBe(true);
    expect(fromKnown.hubEdge("p", "hub")).toBe(true);
    const fromDrawn = emphasisOf(drawn, connectionCounts(drawn), emphasis);
    expect(fromDrawn.hubEdge("hub", "h1")).toBe(false);
  });

  it("puts a relationship on the path: its two ends are connected through it", () => {
    // `x` is joined to `c` only by a relationship, which is drawn, so the path reaches it.
    const drawn: Pair[] = [
      ["a", "b"],
      ["b", "c"],
      ["x", "c"],
    ];
    const view = emphasisOf(drawn, connectionCounts(drawn), on);
    expect(view.pathCard("x")).toBe(true);
    expect(view.pathEdge("x", "c")).toBe(true);
    expect(view.dimmedCard("x")).toBe(false);
    const withoutRelationship = emphasisOf(EDGES, connectionCounts(EDGES), on);
    expect(withoutRelationship.pathCard("x")).toBe(false);
  });
});

describe("the stylesheet", () => {
  // A highlighted path through a hub draws as a path: no hub rule applies to a path edge.
  it("leaves path edges out of every hub edge rule", () => {
    const css = readFileSync(
      join(import.meta.dirname, "lineageGraph.module.css"),
      "utf8",
    );
    const selectors = Array.from(css.matchAll(/([^{}]+)\{/g), ([, selector]) =>
      selector.trim(),
    ).filter((selector) => selector.includes("lineage-hub-edge"));
    expect(selectors).not.toHaveLength(0);
    for (const selector of selectors) {
      expect(selector).toContain(":not(.lineage-path-edge)");
    }
  });
});
