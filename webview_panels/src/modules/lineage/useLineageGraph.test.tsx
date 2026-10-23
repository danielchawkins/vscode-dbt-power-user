import type { lineage } from "@fusion-power-user/webview-contract";
import { handleIncomingResponse } from "@modules/app/requestExecutor";
import { MAX_VIEW_STATE_STRING } from "@modules/app/viewState";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getVsCodeApiMock } from "../../test/setup";
import { drawnIds } from "./graph";
import { groupNodeId, shortGroupKey } from "./grouping";
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
  tableEdges: () => ({ edges: [] }),
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
const answerRequests = (
  answers: Record<string, (params: never) => unknown> = ANSWERS,
) =>
  getVsCodeApiMock().postMessage.mockImplementation((message: unknown) => {
    const { command, syncRequestId, args } = message as Posted;
    const answer = answers[command];
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

const postRender = (
  start: string,
  publication = "s:1",
  node: lineage.LineageTable = TABLES[start as "a"],
) =>
  act(() => {
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "render",
          args: { node, publication },
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

/** Four children of `a` in two folders; the first folder's name is too long for its group ID to be saved whole. */
const LONG_FOLDER = `models/${"x".repeat(MAX_VIEW_STATE_STRING)}`;
const LONG_GROUP_KEY = `pkg:${LONG_FOLDER}`;
const LONG_GROUP_ID = groupNodeId("c:a", LONG_GROUP_KEY);
const longFolderChildren = [
  { ...table("m1", 0, 1), path: `${LONG_FOLDER}/m1.sql` },
  { ...table("m2", 0, 1), path: `${LONG_FOLDER}/m2.sql` },
  { ...table("m3", 0, 1), path: "models/y/m3.sql" },
  { ...table("m4", 0, 1), path: "models/y/m4.sql" },
];

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
    expect(commands()).toContain("getConnectedColumns");
    expect(result.current.graph.columnEdges).toEqual([
      { source: ["b", "id"], target: ["c", "id"], type: "direct" },
    ]);
  });

  it("restores a saved parent expansion and column list when the start table's render count is zero", async () => {
    answerRequests();
    getVsCodeApiMock().getState.mockReturnValue({
      panel: "lineage",
      publication: "s:1",
      start: "c",
      expansions: ["p:c"],
      columnTables: ["c"],
    } as never);
    const { result } = renderHook(() => useLineageGraph(() => 0, vi.fn()));
    await postRender("c", "s:1", { ...TABLES.c, parentCount: 0 });
    await waitFor(() => expect(result.current.drawnKey).toBe(1));
    expect(result.current.graph.expansions).toEqual(["p:c"]);
    expect([...drawnIds(result.current.graph)].toSorted()).toEqual(["b", "c"]);
    expect(result.current.graph.known.c?.parentCount).toBe(1);
    expect(result.current.graph.columnTables).toEqual(["c"]);
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

  it("keeps an open group open after a project save", async () => {
    // `a` has four children in two folders; with a cap of 2 they bucket into two closed groups.
    const folderChildren = [
      { ...table("m1", 0, 1), path: "models/x/m1.sql" },
      { ...table("m2", 0, 1), path: "models/x/m2.sql" },
      { ...table("m3", 0, 1), path: "models/y/m3.sql" },
      { ...table("m4", 0, 1), path: "models/y/m4.sql" },
    ];
    answerRequests({
      ...ANSWERS,
      childTables: ({ table: t }: { table: string }) => ({
        tables: t === "a" ? folderChildren : [],
      }),
    });
    const { result } = renderHook(() =>
      useLineageGraph(() => 1, vi.fn(), {
        expansionOptions: () => ({ cap: 2, groupBy: "folder" }),
      }),
    );
    await postRender("a");
    await waitFor(() => expect(result.current.drawnKey).toBe(1));
    expect(result.current.graph.groups["c:a"]?.open).toEqual({});

    act(() =>
      result.current.actions.openGroup(groupNodeId("c:a", "pkg:models/x")),
    );
    await waitFor(() =>
      expect(result.current.graph.groups["c:a"]?.open).toEqual({
        "pkg:models/x": 2,
      }),
    );

    act(() => {
      globalThis.dispatchEvent(
        new MessageEvent("message", { data: { command: "projectSaved" } }),
      );
    });
    await postRender("a");
    await waitFor(() => expect(result.current.drawnKey).toBe(2));
    expect(result.current.graph.groups["c:a"]?.open).toEqual({
      "pkg:models/x": 2,
    });
    expect(getVsCodeApiMock().setState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        openGroups: [groupNodeId("c:a", "pkg:models/x")],
      }),
    );
  });

  it("keeps a group with a long ID open after a project save, saved by its short key", async () => {
    answerRequests({
      ...ANSWERS,
      childTables: ({ table: t }: { table: string }) => ({
        tables: t === "a" ? longFolderChildren : [],
      }),
    });
    const { result } = renderHook(() =>
      useLineageGraph(() => 1, vi.fn(), {
        expansionOptions: () => ({ cap: 2, groupBy: "folder" }),
      }),
    );
    await postRender("a");
    await waitFor(() => expect(result.current.drawnKey).toBe(1));

    act(() => result.current.actions.openGroup(LONG_GROUP_ID));
    await waitFor(() =>
      expect(result.current.graph.groups["c:a"]?.open).toEqual({
        [LONG_GROUP_KEY]: 2,
      }),
    );

    act(() => {
      globalThis.dispatchEvent(
        new MessageEvent("message", { data: { command: "projectSaved" } }),
      );
    });
    await postRender("a");
    await waitFor(() => expect(result.current.drawnKey).toBe(2));
    expect(result.current.graph.groups["c:a"]?.open).toEqual({
      [LONG_GROUP_KEY]: 2,
    });
    expect(getVsCodeApiMock().setState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        openGroups: [shortGroupKey("c:a", LONG_GROUP_KEY)],
      }),
    );
  });

  it("restores a group with a long ID open on the first render from stored state", async () => {
    answerRequests({
      ...ANSWERS,
      childTables: ({ table: t }: { table: string }) => ({
        tables: t === "a" ? longFolderChildren : [],
      }),
    });
    getVsCodeApiMock().getState.mockReturnValue({
      panel: "lineage",
      publication: "s:1",
      start: "a",
      expansions: ["c:a"],
      columnTables: [],
      openGroups: [shortGroupKey("c:a", LONG_GROUP_KEY)],
    } as never);
    const { result } = renderHook(() =>
      useLineageGraph(() => 1, vi.fn(), {
        expansionOptions: () => ({ cap: 2, groupBy: "folder" }),
      }),
    );
    await postRender("a");
    await waitFor(() => expect(result.current.drawnKey).toBe(1));
    expect(result.current.graph.groups["c:a"]?.open).toEqual({
      [LONG_GROUP_KEY]: 2,
    });
  });

  it("saves an expansion that is still pending when the view is hidden", async () => {
    answerRequests();
    const { result } = renderHook(() => useLineageGraph(() => 1, vi.fn()));
    await postRender("b");
    await waitFor(() => expect(result.current.drawnKey).toBe(1));
    // Collapse the parents, then hold the answer to the next expansion of them.
    act(() => result.current.actions.toggleExpansion("b", "parents"));
    const held: (() => void)[] = [];
    const answer = getVsCodeApiMock().postMessage.getMockImplementation()!;
    getVsCodeApiMock().postMessage.mockImplementation((message: unknown) => {
      const { command, syncRequestId, args } = message as Posted;
      if (command === "parentTables" && syncRequestId) {
        held.push(() =>
          handleIncomingResponse({
            syncRequestId,
            status: true,
            body: ANSWERS.parentTables(args!.params),
          }),
        );
        return;
      }
      answer(message);
    });
    act(() => result.current.actions.toggleExpansion("b", "parents"));
    await waitFor(() => expect(result.current.graph.pending).toEqual(["p:b"]));
    // The view is hidden here: the last state VS Code keeps must already name the pending expansion.
    expect(getVsCodeApiMock().setState).toHaveBeenLastCalledWith(
      expect.objectContaining({ expansions: expect.arrayContaining(["p:b"]) }),
    );
    await act(async () => held.forEach((release) => release()));
    await waitFor(() =>
      expect(result.current.graph.expansions).toEqual(
        expect.arrayContaining(["p:b"]),
      ),
    );
  });
});
