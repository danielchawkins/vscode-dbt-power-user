// Spike harness: the query-results Perspective path on `@perspective-dev/*`, reporting to `window.__spike`.
import perspective from "@perspective-dev/client";
import perspectiveViewer from "@perspective-dev/viewer";
import "@perspective-dev/viewer-datagrid";
import "@perspective-dev/viewer-charts";
import "@perspective-dev/viewer/themes";
import serverWasm from "@perspective-dev/server/dist/wasm/perspective-server.wasm?url";
import viewerWasm from "@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm?url";
import { panelConfig, renderQuery, savedByFinos38 } from "./payload.js";
import { buildPerspectiveTableInit } from "./columnTypeMapping.js";
import { attachCellViewer } from "./cellViewer.js";

const spike = { steps: {}, errors: [], violations: [], opened: [] };
window.__spike = spike;
document.addEventListener("securitypolicyviolation", (e) =>
  spike.violations.push(`${e.violatedDirective} ${e.blockedURI}`),
);
window.addEventListener("error", (e) => spike.errors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => spike.errors.push(String(e.reason?.message ?? e.reason)));
window.addEventListener("string-json-viewer", (e) => spike.opened.push(e.detail));

const step = async (name, fn) => {
  const start = performance.now();
  try {
    const value = await fn();
    spike.steps[name] = { ok: true, ms: Math.round(performance.now() - start), value };
    return value;
  } catch (error) {
    spike.steps[name] = { ok: false, error: String(error?.message ?? error) };
    throw error;
  }
};

async function run() {
  perspective.init_server(fetch(serverWasm));
  await step("init_client", () => perspectiveViewer.init_client(fetch(viewerWasm)));
  await customElements.whenDefined("perspective-viewer");

  const { columnNames, columnTypes, rows } = renderQuery;
  const init = buildPerspectiveTableInit(columnNames, columnTypes, rows);
  const client = await step("worker", () => perspective.worker());
  await step("table", async () => {
    const t = await client.table(init.schema, { name: "query_result" });
    await t.replace(init.rows);
    return { size: await t.size(), schema: await t.schema() };
  });

  const grid = document.createElement("perspective-viewer");
  document.getElementById("grid-host").appendChild(grid);
  await step("grid.load", async () => {
    await grid.load(client);
    await grid.restore({ table: "query_result" });
  });
  await step("grid.resetThemes", async () => {
    await grid.resetThemes();
    return (await grid.getAllThemes?.()) ?? null;
  });
  await step("grid.restore", () => grid.restore(panelConfig(columnNames, columnTypes, "Pro Dark")));
  await step("grid.cellViewer", () => attachCellViewer(grid));
  await step("grid.flush", async () => {
    await grid.flush();
    const datagrid = grid.querySelector("perspective-viewer-datagrid");
    const root = datagrid?.regular_table;
    return {
      plugin: (await grid.save()).plugin,
      firstCells: [...(root?.querySelectorAll("tbody tr:first-child td") ?? [])].map((td) => td.textContent),
      openIcons: root?.querySelectorAll(".open-icon").length ?? 0,
    };
  });

  const chart = document.createElement("perspective-viewer");
  document.getElementById("chart-host").appendChild(chart);
  await step("chart.load", () => chart.load(client));
  await step("chart.restore", async () => {
    await chart.restore({ table: "query_result", plugin: "Y Bar", group_by: ["label"], columns: ["amount"], aggregates: { amount: "sum" } });
    await chart.flush();
    const plugin = chart.querySelector("[slot]") ?? chart.children[0];
    return { plugin: (await chart.save()).plugin, element: plugin?.tagName.toLowerCase() };
  });

  await step("restore.savedByFinos38", async () => {
    await grid.restore(savedByFinos38);
    await grid.flush();
    const saved = await grid.save();
    const view = await grid.getView();
    return {
      version: saved.version,
      plugin: saved.plugin,
      group_by: saved.group_by,
      sort: saved.sort,
      filter: saved.filter,
      rows: await view.num_rows(),
    };
  });
  await step("restore.panelConfigAgain", async () => {
    await grid.restore({ ...panelConfig(columnNames, columnTypes, "Pro Light"), group_by: [], filter: [], sort: [] });
    await grid.flush();
    return (await grid.save()).theme;
  });
  spike.done = true;
}

run().catch((error) => {
  spike.errors.push(String(error?.message ?? error));
  spike.done = true;
});
