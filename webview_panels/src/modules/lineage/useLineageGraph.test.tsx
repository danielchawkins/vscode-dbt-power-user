import type { lineage } from "@fusion-power-user/webview-contract";
import { handleIncomingResponse } from "@modules/app/requestExecutor";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getVsCodeApiMock } from "../../test/setup";
import { useLineageGraph } from "./useLineageGraph";

const table = (
  id: string,
  childCount: number,
  parentCount: number,
): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  childCount,
  parentCount,
  isExternalProject: false,
  tests: [],
});

const TABLES = {
  a: table("a", 1, 0),
  b: table("b", 1, 1),
  c: table("c", 0, 1),
};
const ANSWERS: Record<string, (params: never) => unknown> = {
  childTables: ({ table: t }: { table: string }) => ({
    tables: t === "a" ? [TABLES.b] : t === "b" ? [TABLES.c] : [],
  }),
  parentTables: ({ table: t }: { table: string }) => ({
    tables: t === "b" ? [TABLES.a] : t === "c" ? [TABLES.b] : [],
  }),
  getColumns: ({ table: t }: { table: string }) => ({
    id: t,
    columns: [{ table: t, name: "id" }],
  }),
  // `b.id` feeds `c.id`.
  getConnectedColumns: ({
    targets,
    upstreamExpansion,
  }: lineage.ConnectedColumnsParams) => ({
    column_lineage: targets.some(([t]) => t === (upstreamExpansion ? "b" : "c"))
      ? [{ source: ["b", "id"], target: ["c", "id"], type: "direct" }]
      : [],
  }),
};

type Posted = {
  command: string;
  syncRequestId?: string;
  args?: { params: never };
};

/** Answers each request the hook posts as the host would. */
const answerRequests = () =>
  getVsCodeApiMock().postMessage.mockImplementation((message: unknown) => {
    const { command, syncRequestId, args } = message as Posted;
    const answer = ANSWERS[command];
    if (answer && syncRequestId) {
      queueMicrotask(() =>
        handleIncomingResponse({
          syncRequestId,
          status: true,
          body: answer(args!.params),
        }),
      );
    }
  });

const postRender = (start: string, publication = "s:1") =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "render",
          args: { node: TABLES[start as "a"], publication },
        },
      }),
    );
  });

const commands = () =>
  getVsCodeApiMock().postMessage.mock.calls.map(([m]) => (m as Posted).command);

afterEach(() => {
  getVsCodeApiMock().postMessage.mockReset();
  getVsCodeApiMock().getState.mockReset();
});

describe("useLineageGraph", () => {
  it("asks for init, expands the default levels through childTables and parentTables, and saves view state", async () => {
    answerRequests();
    const { result } = renderHook(() => useLineageGraph(() => 1, vi.fn()));
    expect(commands()).toContain("init");
    await postRender("b");
    await waitFor(() => expect(result.current.drawnKey).toBe(1));
    expect(result.current.graph.expansions).toEqual(["p:b", "c:b"]);
    expect(commands()).toEqual(
      expect.arrayContaining(["parentTables", "childTables"]),
    );
    expect(getVsCodeApiMock().setState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        panel: "lineage",
        publication: "s:1",
        start: "b",
        expansions: ["p:b", "c:b"],
      }),
    );
  });

  it("restores expansion, column lists, selection and the traced column after VS Code rebuilds the page", async () => {
    answerRequests();
    getVsCodeApiMock().getState.mockReturnValue({
      panel: "lineage",
      publication: "s:1",
      start: "a",
      expansions: ["c:a", "c:b"],
      columnTables: ["c"],
      selectedTable: "c",
      selectedColumn: ["c", "id"],
    } as never);
    const { result } = renderHook(() => useLineageGraph(() => 0, vi.fn()));
    await postRender("a");
    await waitFor(() => expect(result.current.drawnKey).toBe(1));
    expect(result.current.graph.expansions).toEqual(["c:a", "c:b"]);
    expect(result.current.graph.columnTables).toEqual(["c"]);
    expect(result.current.graph.selectedTable).toBe("c");
    expect(result.current.graph.selectedColumn).toEqual(["c", "id"]);
    expect(result.current.graph.columnEdges).toEqual([
      { source: ["b", "id"], target: ["c", "id"], type: "direct" },
    ]);
  });

  it("collapses an expansion and lists columns through the table actions", async () => {
    answerRequests();
    const { result } = renderHook(() => useLineageGraph(() => 1, vi.fn()));
    await postRender("a");
    await waitFor(() => expect(result.current.drawnKey).toBe(1));
    act(() => result.current.actions.toggleColumns("b"));
    await waitFor(() =>
      expect(result.current.graph.columnTables).toEqual(["b"]),
    );
    act(() => result.current.actions.toggleExpansion("a", "children"));
    expect(result.current.graph.expansions).toEqual([]);
    expect(result.current.graph.columnTables).toEqual([]);
  });
});
