import type { HTMLPerspectiveViewerElement } from "@perspective-dev/viewer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachCellViewer,
  CellViewerDetail,
  cellViewerKind,
  sourceColumn,
} from "./cellViewer";

describe("cellViewerKind", () => {
  it("opens JSON objects and arrays as JSON regardless of width", () => {
    expect(cellViewerKind('{"a":1}', 1000)).toBe("json");
    expect(cellViewerKind("[1,2]", 1000)).toBe("json");
  });

  it("opens text that overflows its cell as a string", () => {
    expect(cellViewerKind("a long note", 50)).toBe("string");
  });

  it("leaves short text and JSON scalars alone", () => {
    expect(cellViewerKind("ok", 200)).toBeUndefined();
    expect(cellViewerKind("42", 200)).toBeUndefined();
    expect(cellViewerKind("null", 200)).toBeUndefined();
  });
});

describe("sourceColumn", () => {
  it("takes the last segment of a split column path", () => {
    expect(sourceColumn("2024|amount")).toBe("amount");
    expect(sourceColumn("label")).toBe("label");
  });
});

type Meta = {
  type: "body";
  x: number;
  value: unknown;
  column_header: string[];
};

/** A viewer whose datagrid holds one row of `cells`, typed by `schema`, in view column order. */
function fakeViewer(
  schema: Record<string, string>,
  cells: [string, unknown][],
) {
  const tbody = document.createElement("tbody");
  const meta = new Map<Element, Meta>();
  cells.forEach(([column, value], x) => {
    const td = document.createElement("td");
    Object.defineProperty(td, "offsetWidth", { value: 40 });
    tbody.appendChild(td);
    meta.set(td, { type: "body", x, value, column_header: [column] });
  });
  const listeners: (() => Promise<void>)[] = [];
  const regularTable = {
    querySelectorAll: (selector: string) =>
      tbody.querySelectorAll(selector.replace("tbody ", "")),
    getMeta: (td: Element) => meta.get(td),
    addStyleListener: (listener: () => Promise<void>) =>
      listeners.push(listener),
    draw: async () => {
      for (const listener of listeners) {
        await listener();
      }
    },
  };
  const view = {
    schema: async () => schema,
    column_paths: async () => cells.map(([column]) => column),
  };
  const viewer = {
    getPlugin: async (name: string) =>
      name === "Datagrid" ? { regular_table: regularTable } : undefined,
    getView: async () => view,
    addEventListener: vi.fn(),
  } as unknown as HTMLPerspectiveViewerElement;
  return { viewer, tds: [...tbody.querySelectorAll("td")] };
}

describe("attachCellViewer", () => {
  const opened: CellViewerDetail[] = [];
  const record = (event: Event) =>
    opened.push((event as CustomEvent<CellViewerDetail>).detail);
  window.addEventListener("string-json-viewer", record);
  afterEach(() => {
    opened.length = 0;
  });

  it("decorates string cells by the view schema and dispatches their value on click", async () => {
    const payload = '{"k":[1,2]}';
    const { viewer, tds } = fakeViewer(
      { id: "float", payload: "string", note: "string", label: "string" },
      [
        ["id", 1],
        ["payload", payload],
        ["note", "a value far wider than its cell"],
        ["label", "ok"],
      ],
    );

    await attachCellViewer(viewer);

    expect(tds.map((td) => Boolean(td.querySelector(".open-icon")))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    tds[1].click();
    tds[2].click();
    expect(opened).toEqual([
      { columnName: "payload", message: payload, type: "json" },
      {
        columnName: "note",
        message: "a value far wider than its cell",
        type: "string",
      },
    ]);
  });

  it("never decorates a non-string column, even when its value reads as JSON", async () => {
    const { viewer, tds } = fakeViewer({ raw: "float" }, [
      ["raw", '{"looks":"like json"}'],
    ]);

    await attachCellViewer(viewer);

    expect(tds[0].querySelector(".open-icon")).toBeNull();
    expect(tds[0].onclick).toBeNull();
  });
});
