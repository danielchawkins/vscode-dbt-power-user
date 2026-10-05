import { panelLogger } from "@modules/logger";
import type { ColumnType, View } from "@perspective-dev/client";
import type { HTMLPerspectiveViewerElement } from "@perspective-dev/viewer";
import OpenIcon from "./openIcon.svg?raw";

/** The part of a `regular-table` body cell's metadata the cell viewer reads. */
interface CellMeta {
  type: string;
  x?: number;
  value: unknown;
  column_header: unknown[];
}

/** The surface of the datagrid plugin's public `regular_table` the cell viewer uses. */
interface RegularTable {
  querySelectorAll(selectors: "tbody td"): NodeListOf<HTMLTableCellElement>;
  getMeta(element: HTMLElement): CellMeta | undefined;
  addStyleListener(listener: () => Promise<void>): unknown;
  draw(): Promise<void>;
}

/** @internal */
export type CellViewerKind = "json" | "string";

/** Detail of the `string-json-viewer` window event a decorated cell dispatches on click. */
export interface CellViewerDetail {
  columnName: string;
  message: string;
  type: CellViewerKind;
}

/** Approximate rendered width of one character, used to decide whether a string overflows its cell. */
const CHARACTER_WIDTH = 11;

const isJson = (text: string): boolean => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
};

/**
 * Classifies a string cell: JSON objects and arrays open as JSON, overflowing text as a string, the rest not at all.
 * @internal
 */
export function cellViewerKind(
  value: string,
  cellWidth: number,
): CellViewerKind | undefined {
  if (isJson(value)) {
    return "json";
  }
  return cellWidth < CHARACTER_WIDTH * value.length ? "string" : undefined;
}

/**
 * Resolves the source column of a view column path such as `"group|split|name"`.
 * @internal
 */
export function sourceColumn(columnPath: string): string {
  return columnPath.split("|").pop() ?? columnPath;
}

const columnName = (meta: CellMeta): string => {
  const header = meta.column_header;
  const last = header[header.length - 1];
  return typeof last === "string" ? last : "";
};

function decorate(cell: HTMLTableCellElement, detail: CellViewerDetail) {
  const td = cell;
  if (!td.querySelector(".open-icon")) {
    const span = document.createElement("span");
    span.className = "open-icon";
    span.innerHTML = OpenIcon;
    span.title = "Click to view complete value";
    td.appendChild(span);
  }
  td.style.cursor = "pointer";
  td.onclick = () =>
    window.dispatchEvent(
      new CustomEvent<CellViewerDetail>("string-json-viewer", { detail }),
    );
}

function clear(cell: HTMLTableCellElement) {
  const td = cell;
  td.querySelector(".open-icon")?.remove();
  td.style.cursor = "";
  td.onclick = null;
}

/**
 * Marks string cells of `viewer`'s datagrid that hold JSON or overflow their column; clicking one dispatches
 * `string-json-viewer` with a {@link CellViewerDetail}. Types come from the view schema, never from cell values.
 */
export async function attachCellViewer(
  viewer: HTMLPerspectiveViewerElement,
): Promise<void> {
  const datagrid = (await viewer.getPlugin("Datagrid")) as {
    regular_table: RegularTable;
  };
  const table = datagrid.regular_table;
  let schema: Record<string, ColumnType> = {};
  let columnPaths: string[] = [];
  let dirty = true;
  const refresh = async () => {
    const view = (await viewer.getView()) as View;
    schema = (await view.schema()) as Record<string, ColumnType>;
    columnPaths = (await view.column_paths()) as string[];
    dirty = false;
  };
  viewer.addEventListener("perspective-config-update", () => {
    dirty = true;
  });
  table.addStyleListener(async () => {
    try {
      if (dirty) {
        await refresh();
      }
      for (const td of table.querySelectorAll("tbody td")) {
        const meta = table.getMeta(td);
        if (
          meta?.type !== "body" ||
          meta.x === undefined ||
          typeof meta.value !== "string"
        ) {
          clear(td);
          continue;
        }
        const type = schema[sourceColumn(columnPaths[meta.x] ?? "")];
        const kind =
          type === "string"
            ? cellViewerKind(meta.value, td.offsetWidth)
            : undefined;
        if (kind) {
          decorate(td, {
            columnName: columnName(meta),
            message: meta.value,
            type: kind,
          });
        } else {
          clear(td);
        }
      }
    } catch (error) {
      panelLogger.error("Failed to decorate perspective cells", error);
    }
  });
  await table.draw();
}
