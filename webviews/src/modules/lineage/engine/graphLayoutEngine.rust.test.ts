import {
  decodeGraph,
  encodeLayout,
  layout,
} from "@fusion-power-user/graph-layout";
import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { graphLayoutEngine, rustLayoutEngine } from "./graphLayoutEngine";
import {
  type LayoutRequest,
  type LayoutResponse,
  nextGeneration,
} from "./layoutEngine";

/** A small lineage: a model in Other above two staging cards and a mart, as the panel draws it. */
const REQUEST: LayoutRequest = {
  focus: "hub",
  cards: [
    { id: "hub", width: 280, height: 112, tag: "other" },
    { id: "a", width: 280, height: 56, tag: "staging" },
    { id: "b", width: 280, height: 56, tag: "staging" },
    { id: "summary_mart", width: 280, height: 66, tag: "marts" },
  ],
  edges: [
    { id: "hub>a", from: "hub", to: "a", role: "group" },
    { id: "hub>b", from: "hub", to: "b", role: "group" },
    { id: "hub>summary_mart", from: "hub", to: "summary_mart", role: "table" },
  ],
  rankPairs: [
    ["hub", "a"],
    ["hub", "b"],
    ["hub", "summary_mart"],
  ],
  traceOn: false,
};

/**
 * A host that answers as the Worker does, with the TypeScript layout standing in for the WASM binding: it decodes the
 * graph frame it was sent, lays it out with the options it was sent, and answers with the layout frame.
 */
const standInHost =
  (
    seen: lineage.LayoutParams[] = [],
  ): ((params: lineage.LayoutParams) => Promise<lineage.LayoutBody>) =>
  async (params) => {
    seen.push(params);
    const graph = decodeGraph(Buffer.from(params.frame, "base64"));
    const options = JSON.parse(params.options);
    const result = layout(graph, options);
    return {
      superseded: false,
      frame: Buffer.from(encodeLayout(result)).toString("base64"),
    };
  };

const responseOf = async (
  answer: Awaited<ReturnType<ReturnType<typeof graphLayoutEngine>["layout"]>>,
): Promise<LayoutResponse> => {
  if (answer.superseded) {
    throw new Error("the layout was superseded");
  }
  return answer.response;
};

describe("rustLayoutEngine", () => {
  it("sends the graph and options to the host, and decodes the frame it answers with the same response as the TypeScript engine", async () => {
    const seen: lineage.LayoutParams[] = [];
    const generation = nextGeneration();
    const rust = await responseOf(
      await rustLayoutEngine("balanced", standInHost(seen)).layout(
        REQUEST,
        generation,
      ),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.generation).toBe(generation);
    expect(JSON.parse(seen[0]?.options ?? "{}")).toMatchObject({
      direction: "down",
      effort: "balanced",
      anchor: "hub",
    });
    const typescript = await responseOf(
      await graphLayoutEngine("balanced").layout(REQUEST, nextGeneration()),
    );
    expect(rust.positions).toEqual(typescript.positions);
    expect(rust.bands).toEqual(typescript.bands);
    expect(rust.edges).toEqual(typescript.edges);
    expect(rust.metrics).toEqual(typescript.metrics);
  });

  it("drops an answer the host gives as superseded", async () => {
    const engine = rustLayoutEngine("balanced", async () => ({
      superseded: true,
    }));
    await expect(engine.layout(REQUEST, nextGeneration())).resolves.toEqual({
      superseded: true,
    });
  });

  it("drops an answer that a newer generation overtook while it ran", async () => {
    const generation = nextGeneration();
    const engine = rustLayoutEngine("balanced", async (params) => {
      nextGeneration();
      return standInHost()(params);
    });
    await expect(engine.layout(REQUEST, generation)).resolves.toEqual({
      superseded: true,
    });
  });

  it("answers the hints of a previous layout to the host as columns", async () => {
    const seen: lineage.LayoutParams[] = [];
    const first = await responseOf(
      await rustLayoutEngine("balanced", standInHost()).layout(
        REQUEST,
        nextGeneration(),
      ),
    );
    await rustLayoutEngine("balanced", async (params) => {
      seen.push(params);
      return { superseded: true };
    }).layout({ ...REQUEST, previous: first.hints }, nextGeneration());
    const options = JSON.parse(seen[0]?.options ?? "{}");
    expect(options.hints.id).toEqual(["hub", "a", "b", "summary_mart"]);
    expect(options.hints.rank).toHaveLength(4);
    expect(options.hints.x).toHaveLength(4);
  });
});

describe("the graph frame, through the engine", () => {
  it("round-trips the graph frame: the host decodes the cards and edges the engine sent", async () => {
    let sent = "";
    await rustLayoutEngine("balanced", async (params) => {
      sent = params.frame;
      return { superseded: true };
    }).layout(REQUEST, nextGeneration());
    const graph = decodeGraph(Buffer.from(sent, "base64"));
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(
      REQUEST.cards.map((card) => card.id).sort(),
    );
    expect(graph.edges).toHaveLength(REQUEST.edges.length);
  });
});
