// E6, disk-watch scope. Decision rule (fixed before running): edit a macro, `dbt_project.yml` and `packages.yml`
// outside the editor (plus a new model as the control the spike already showed), then poll for 30 s for the server
// to reflect each edit. Run twice on fresh copies: silent (no notification) and notified (the
// `workspace/didChangeWatchedFiles` event that vscode-languageclient sends for the server's `**/*` registration).
// A file kind the server misses in the notified run gets a registry watcher that triggers a Server Producer refresh;
// the silent run is recorded for clients without the registration.
import fs from "node:fs";
import path from "node:path";
import { prepareJaffle, scratch, setup } from "./adoption.mjs";

const ctx = await setup("e6-disk-watch", { targets: ["jaffle"] });
const { lib } = ctx;
const POLL_MS = 30000;

const listHas = async (server, selector, test) => {
  const e = await server.exec("dbt.listNodes", [selector]);
  return test(e.result?.nodes ?? []);
};
const compiledHas = async (server, root, rel, marker) => {
  const e = await server.exec("dbt.compileFile", [
    lib.fileUri(path.join(root, rel)),
  ]);
  const p = e.result?.file_uri
    ? new URL(e.result.file_uri).pathname
    : undefined;
  return Boolean(
    p && fs.existsSync(p) && fs.readFileSync(p, "utf8").includes(marker),
  );
};
const cases = [
  {
    name: "model (control)",
    edit: (root) => [
      fs.writeFileSync(
        path.join(root, "models/fpu_e6_new.sql"),
        "select 1 as id\n",
      ),
      ["models/fpu_e6_new.sql", 1],
    ],
    seen: (s) =>
      listHas(s, "fpu_e6_new", (n) => n.some((x) => x.name === "fpu_e6_new")),
  },
  {
    name: "macro",
    edit: (root) => {
      const f = path.join(root, "macros/cents_to_dollars.sql");
      fs.writeFileSync(
        f,
        fs
          .readFileSync(f, "utf8")
          .replace(
            "({{ column_name }}",
            "/* fpu_e6_macro */ ({{ column_name }}",
          ),
      );
      return [null, ["macros/cents_to_dollars.sql", 2]];
    },
    seen: (s, root) =>
      compiledHas(s, root, "models/payments_dollars.sql", "fpu_e6_macro"),
  },
  {
    name: "dbt_project.yml",
    edit: (root) => {
      const f = path.join(root, "dbt_project.yml");
      fs.writeFileSync(
        f,
        fs
          .readFileSync(f, "utf8")
          .replace("+materialized: table", "+materialized: view"),
      );
      return [null, ["dbt_project.yml", 2]];
    },
    seen: (s) =>
      listHas(s, "orders", (n) =>
        n.some((x) => x.name === "orders" && x.config?.materialized === "view"),
      ),
  },
  {
    name: "packages.yml",
    edit: (root) => {
      const pkg = path.join(root, "fpu_e6_pkg");
      fs.mkdirSync(path.join(pkg, "models"), { recursive: true });
      fs.writeFileSync(
        path.join(pkg, "dbt_project.yml"),
        "name: fpu_e6_pkg\nversion: '1.0'\nconfig-version: 2\n",
      );
      fs.writeFileSync(
        path.join(pkg, "models/fpu_e6_pkg_model.sql"),
        "select 1 as id\n",
      );
      fs.writeFileSync(
        path.join(root, "packages.yml"),
        "packages:\n  - local: fpu_e6_pkg\n",
      );
      return [null, ["packages.yml", 1]];
    },
    seen: (s) =>
      listHas(s, "package:fpu_e6_pkg", (n) =>
        n.some((x) => x.name === "fpu_e6_pkg_model"),
      ),
  },
];

async function run(mode) {
  const root =
    mode === "silent"
      ? ctx.root
      : prepareJaffle(path.join(scratch, "e6-disk-watch-notified"), ctx.dbt);
  const server = await ctx.start({ root, profilesDir: root });
  await ctx.load(server, "models/orders.sql");
  await lib.sleep(1000);
  const rows = {};
  for (const c of cases) {
    const before = await c.seen(server, root);
    const compiles = server.count("dbt/lspBackgroundCompileComplete");
    const [, [rel, type]] = c.edit(root);
    if (mode === "notified") {
      server.notify("workspace/didChangeWatchedFiles", {
        changes: [{ uri: lib.fileUri(path.join(root, rel)), type }],
      });
    }
    const t0 = Date.now();
    let seen = false;
    while (!seen && Date.now() - t0 < POLL_MS) {
      await lib.sleep(1000);
      seen = await c.seen(server, root);
    }
    rows[c.name] = {
      seenBefore: before,
      seen,
      ms: seen ? Date.now() - t0 : null,
      backgroundCompiles:
        server.count("dbt/lspBackgroundCompileComplete") - compiles,
    };
  }
  const registrations = JSON.parse(
    JSON.stringify(
      server.events
        .filter((e) => e.method === "client/registerCapability")
        .map((e) => e.params),
    )
      .split(root)
      .join("<P>"),
  );
  await server.stop();
  return { rows, registrations };
}

const silent = await run("silent");
const notified = await run("notified");
const missed = Object.entries(notified.rows)
  .filter(([, r]) => !r.seen)
  .map(([k]) => k);
const decision = missed.length
  ? `the server misses ${missed.join(", ")} even when notified: the registry watcher triggers a Server Producer refresh for them`
  : "the server reflects every edit when notified: no registry-triggered refresh is needed";
const file = ctx.write({
  rule: "see header",
  pollMs: POLL_MS,
  silent,
  notified,
  missed,
  decision,
});
const silentMissed = Object.entries(silent.rows)
  .filter(([, r]) => !r.seen)
  .map(([k]) => k);
ctx.decide(
  `${decision}; silent run misses ${silentMissed.join(", ") || "none"} -> ${file}`,
);
process.exit(0);
