import { act, render, waitFor } from "@testing-library/react";
import type { DrawerRef } from "@uicore";
import { type RefObject, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  answerRequests,
  FILTER,
  setHostSettings,
} from "../../test/lineageHarness";
import type * as LayoutCache from "./engine/layoutCache";
import { useGraphModel } from "./useGraphModel";

// Every layout the panel's layouter runs, with the request it was given: the hints it seeds from are on the request.
const layouts = vi.hoisted(() => ({
  runs: [] as { request: { previous?: unknown }; response: unknown }[],
}));

vi.mock("./engine/layoutCache", async (importOriginal) => {
  const actual = await importOriginal<typeof LayoutCache>();
  const { engineFor } = await import("./engine/engines");
  return {
    ...actual,
    createLayouter: (_resolve?: unknown, capacity?: number) =>
      actual.createLayouter((engine) => {
        const real = engineFor(engine);
        return {
          ...real,
          layout: (request) => {
            const response = real.layout(request);
            layouts.runs.push({ request, response });
            return response;
          },
        };
      }, capacity),
  };
});

type Model = ReturnType<typeof useGraphModel>;

/** Renders `useGraphModel` alone, and hands each render's model to `onModel`. */
const Probe = ({ onModel }: { onModel: (model: Model) => void }) => {
  const drawer: RefObject<DrawerRef | null> = useRef(null);
  onModel(useGraphModel(drawer));
  return null;
};

/** Renders the start card `FILTER` with the path highlight on, and waits for its cards to be drawn. */
const drawFilter = async () => {
  const probe: { model?: Model } = {};
  answerRequests();
  setHostSettings({ pathHighlight: true });
  render(<Probe onModel={(model) => (probe.model = model)} />);
  await act(async () => {
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "render",
          args: { node: FILTER, publication: "s:1" },
        },
      }),
    );
  });
  await waitFor(() =>
    expect(probe.model?.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["filter", "kept", "audit"]),
    ),
  );
  return probe as { model: Model };
};

describe("useGraphModel layouts", () => {
  it("restyles on hover without running the layouter, and keeps the cards the hover does not emphasise", async () => {
    const probe = await drawFilter();
    const before = probe.model.nodes;
    const runs = layouts.runs.length;

    act(() => probe.model.hover("kept"));

    expect(layouts.runs.length).toBe(runs);
    const after = probe.model.nodes;
    expect(after.find((n) => n.id === "kept")).not.toBe(
      before.find((n) => n.id === "kept"),
    );
    expect(after.find((n) => n.id === "audit")).toBe(
      before.find((n) => n.id === "audit"),
    );
  });

  it("hides a card with one relayout, seeded from the layout on screen", async () => {
    const probe = await drawFilter();
    const runs = layouts.runs.length;
    const shown = layouts.runs.at(-1)!;

    act(() => probe.model.actions.hide("audit", "audit"));

    await waitFor(() =>
      expect(probe.model.nodes.map((n) => n.id)).not.toContain("audit"),
    );
    expect(layouts.runs.length).toBe(runs + 1);
    expect(layouts.runs.at(-1)!.request.previous).toBe(
      (shown.response as { hints?: unknown }).hints,
    );
  });
});
