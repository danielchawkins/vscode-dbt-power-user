import { describe, expect, it } from "@jest/globals";
import fc from "fast-check";
import { ChildrenParentParser } from "../../dbt_integration";
import { NUM_RUNS, nodeDag } from "../arbitraries";

const edges = (graph: Record<string, string[]>, reverse = false) =>
  Object.entries(graph)
    .flatMap(([from, tos]) =>
      tos.map((to) => (reverse ? `${to}->${from}` : `${from}->${to}`)),
    )
    .sort();

describe("ChildrenParentParser properties", () => {
  it("keeps every node's parents and makes the child map their transpose", async () => {
    await fc.assert(
      fc.asyncProperty(nodeDag, async (nodes) => {
        const { parentMetaMap, childMetaMap } =
          await new ChildrenParentParser().createChildrenParentMetaMap(nodes);

        expect(Object.keys(parentMetaMap).sort()).toEqual(
          Object.keys(nodes).sort(),
        );
        for (const [child, parents] of Object.entries(parentMetaMap)) {
          expect(parents).toEqual(nodes[child].depends_on.nodes);
        }
        for (const id of [
          ...edges(parentMetaMap).flatMap((e) => e.split("->")),
          ...Object.keys(childMetaMap),
        ]) {
          expect(nodes).toHaveProperty([id]);
        }
        expect(edges(childMetaMap)).toEqual(edges(parentMetaMap, true));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
