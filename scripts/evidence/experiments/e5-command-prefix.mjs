// E5, two Declared Projects with command prefixes. Decision rule (fixed before running): start one server per
// project of a copy of the multi-root fixture, each with the prefix the extension sends
// (`fusionPowerUser:<projectRootDigest>:`), and record the advertised command names, the CTE lens command id and
// whether prefixed and unprefixed names execute. The 2.9 lens mapping matches whatever is observed. Jaffle only.
import fs from "node:fs";
import path from "node:path";
import { repo, rootDigest, scratch, setup } from "./adoption.mjs";

const ctx = await setup("e5-command-prefix", { targets: ["multi-root"] });
const { lib } = ctx;
const copy = path.join(scratch, "e5-multi-root");
fs.rmSync(copy, { recursive: true, force: true });
fs.cpSync(path.join(repo, "src/test/fixtures/multi-root"), copy, {
  recursive: true,
});
const projects = [
  {
    name: "general",
    root: path.join(copy, "projects/general"),
    profilesDir: path.join(copy, "projects/general"),
  },
  {
    name: "sox",
    root: path.join(copy, "projects/sox"),
    profilesDir: path.join(copy, "projects/sox/profiles"),
  },
];
const cteSql =
  "with first_cte as (\n  select 1 as id\n),\nsecond_cte as (\n  select id from first_cte\n)\n" +
  "select * from second_cte\n";
for (const p of projects) {
  fs.rmSync(path.join(p.root, "target"), { recursive: true, force: true });
  fs.writeFileSync(path.join(p.root, "models", `${p.name}_ctes.sql`), cteSql);
  p.root = fs.realpathSync(p.root);
}

const servers = [];
for (const p of projects) {
  const prefix = `fusionPowerUser:${rootDigest(p.root)}:`;
  const server = await lib.startServer({
    root: p.root,
    profilesDir: p.profilesDir,
    extraArgs: ["--static-analysis", "strict"],
    commandPrefix: prefix,
  });
  servers.push({ ...p, prefix, server });
}
const rows = [];
for (const s of servers) {
  const model = path.join(s.root, "models", `${s.name}_ctes.sql`);
  s.server.openDoc(model);
  const loaded = await s.server.waitNotification(
    "dbt/lspBackgroundCompileComplete",
    { timeoutMs: 120000 },
  );
  await lib.sleep(1000);
  const lenses = await s.server.request("textDocument/codeLens", {
    textDocument: { uri: lib.fileUri(model) },
  });
  const advertised =
    s.server.init.result?.capabilities?.executeCommandProvider?.commands ?? [];
  const prefixed = await s.server.exec(`${s.prefix}dbt.getProjectInfo`, []);
  const bare = await s.server.exec("dbt.getProjectInfo", []);
  const other = servers.find((o) => o !== s);
  const crossPrefix = await s.server.exec(
    `${other.prefix}dbt.getProjectInfo`,
    [],
  );
  rows.push({
    project: s.name,
    prefix: s.prefix.replace(rootDigest(s.root), "<digest>"),
    loaded: !loaded.timeout,
    advertised: advertised.map((c) =>
      c.replace(rootDigest(s.root), "<digest>"),
    ),
    lensCommands: [
      ...new Set(
        (lenses.result ?? []).map((l) =>
          l.command?.command.replace(rootDigest(s.root), "<digest>"),
        ),
      ),
    ],
    lensCount: lenses.result?.length ?? 0,
    lensArguments: lenses.result?.[0]?.command?.arguments ?? null,
    prefixedExecutes: {
      result: prefixed.result ?? null,
      error: prefixed.error ?? null,
    },
    bareExecutes: { result: bare.result ?? null, error: bare.error ?? null },
    otherPrefixExecutes: {
      result: crossPrefix.result ?? null,
      error: crossPrefix.error ?? null,
    },
  });
}
for (const s of servers) await s.server.stop();

const redact = (v) => {
  let text = JSON.stringify(v);
  for (const s of servers) text = text.split(s.root).join(`<${s.name}>`);
  return JSON.parse(text.split(copy).join("<copy>"));
};
const lensIds = [...new Set(rows.flatMap((r) => r.lensCommands))];
const advertisedPrefixed = rows.every((r) =>
  r.advertised.every((c) => c.startsWith(r.prefix)),
);
const decision =
  `lens command ${JSON.stringify(lensIds)}; executeCommandProvider names ` +
  `${advertisedPrefixed ? "carry the prefix" : "do not all carry the prefix"}; prefixed call ` +
  `${rows.every((r) => r.prefixedExecutes.result) ? "answers" : "does not answer"}, bare call ` +
  `${rows.every((r) => r.bareExecutes.result) ? "answers" : "does not answer"}`;
const file = ctx.write(
  redact({ rule: "observe; 2.9 matches it", projects: rows, decision }),
);
ctx.decide(`${decision} -> ${file}`);
process.exit(0);
