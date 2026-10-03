// The `PerspectivePlugins.ts` feature without a subclassed plugin: a style listener on the stock datagrid's
// `<regular-table>` marks string cells that hold JSON or overflow, and a click dispatches `string-json-viewer`.
const isJson = (text) => {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
};

const columnName = (meta) => {
  const header = meta.column_header;
  return Array.isArray(header) ? header[header.length - 1] : header;
};

function decorate(td, meta, type) {
  if (!td.querySelector(".open-icon")) {
    const span = document.createElement("span");
    span.className = "open-icon";
    span.textContent = "↗";
    span.title = "Click to view complete value";
    td.appendChild(span);
  }
  td.style.cursor = "pointer";
  td.onclick = () =>
    window.dispatchEvent(
      new CustomEvent("string-json-viewer", { detail: { columnName: columnName(meta), message: meta.value, type } }),
    );
}

function clear(td) {
  td.querySelector(".open-icon")?.remove();
  td.style.cursor = "";
  td.onclick = null;
}

/** Attaches the cell viewer to `viewer`'s datagrid; resolves to the listener count it attached. */
export async function attachCellViewer(viewer) {
  const datagrid = await viewer.getPlugin("Datagrid");
  const table = datagrid.regular_table;
  let schema = {};
  let columnPaths = [];
  let dirty = true;
  const refresh = async () => {
    const view = await viewer.getView();
    schema = await view.schema();
    columnPaths = await view.column_paths();
    dirty = false;
  };
  viewer.addEventListener("perspective-config-update", () => {
    dirty = true;
  });
  table.addStyleListener(async () => {
    if (dirty) {
      await refresh();
    }
    for (const td of table.querySelectorAll("tbody td")) {
      const meta = table.getMeta(td);
      if (!meta || meta.x === undefined || typeof meta.value !== "string") {
        clear(td);
        continue;
      }
      const path = columnPaths[meta.x] ?? "";
      const type = schema[path.split("|").pop()];
      if (type !== "string") {
        clear(td);
      } else if (isJson(meta.value)) {
        decorate(td, meta, "json");
      } else if (td.offsetWidth < 11 * meta.value.length) {
        decorate(td, meta, "string");
      } else {
        clear(td);
      }
    }
  });
  await table.draw();
  return 1;
}
