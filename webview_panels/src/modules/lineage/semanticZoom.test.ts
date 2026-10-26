import { renderHook } from "@testing-library/react";
import type { Edge } from "@xyflow/react";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { createElement, useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";
import {
  isZoomedOut,
  SemanticZoomContext,
  useDrawnEdges,
} from "./semanticZoom";

describe("isZoomedOut", () => {
  it("is true only below 50% zoom", () => {
    expect(isZoomedOut(0.49, true)).toBe(true);
    expect(isZoomedOut(0.5, true)).toBe(false);
    expect(isZoomedOut(0.51, true)).toBe(false);
  });

  it("is false at any zoom when the setting is off", () => {
    expect(isZoomedOut(0.1, false)).toBe(false);
  });
});

describe("useDrawnEdges", () => {
  const edges: Edge[] = [
    { id: "t:a->b", source: "a", target: "b" },
    {
      id: "c:a.id->b.id",
      source: "a",
      target: "b",
      className: "lineage-column-edge",
    },
  ];

  const ZoomTo = ({ zoom }: { zoom: number }) => {
    const store = useStoreApi();
    useLayoutEffect(() => {
      store.setState({ transform: [0, 0, zoom] });
    }, [store, zoom]);
    return null;
  };

  const drawAt = (zoom: number, enabled = true) =>
    renderHook(() => useDrawnEdges(edges), {
      wrapper: ({ children }) =>
        createElement(
          ReactFlowProvider,
          null,
          createElement(
            SemanticZoomContext,
            { value: enabled },
            createElement(ZoomTo, { zoom }),
            children,
          ),
        ),
    });

  it("leaves out column edges below the threshold", () => {
    const { result } = drawAt(0.4);
    expect(result.current).toEqual([edges[0]]);
    expect(result.current[0]).toBe(edges[0]);
  });
});
