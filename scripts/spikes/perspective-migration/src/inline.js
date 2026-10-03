// Inline variant: the WebAssembly ships inside the JavaScript, so nothing is fetched and no `init_*` call is made.
import perspective from "@perspective-dev/client/inline";
import "@perspective-dev/viewer/inline";
import "@perspective-dev/viewer-datagrid";
import "@perspective-dev/viewer/themes";

const spike = { steps: {}, errors: [], violations: [] };
window.__spike = spike;
document.addEventListener("securitypolicyviolation", (e) =>
  spike.violations.push(`${e.violatedDirective} ${e.blockedURI}`),
);
window.addEventListener("error", (e) => spike.errors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => spike.errors.push(String(e.reason?.message ?? e.reason)));

async function run() {
  await customElements.whenDefined("perspective-viewer");
  const client = await perspective.worker();
  await client.table({ n: "float", label: "string" }, { name: "t" }).then((t) => t.replace([{ n: 1, label: "one" }]));
  const viewer = document.createElement("perspective-viewer");
  document.getElementById("grid-host").appendChild(viewer);
  await viewer.load(client);
  await viewer.restore({ table: "t" });
  await viewer.flush();
  const view = await viewer.getView();
  spike.steps.rows = { ok: true, value: await view.num_rows() };
  spike.done = true;
}

run().catch((error) => {
  spike.errors.push(String(error?.message ?? error));
  spike.done = true;
});
