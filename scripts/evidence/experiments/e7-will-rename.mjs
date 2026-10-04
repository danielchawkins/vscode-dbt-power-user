// E7, `workspace/willRenameFiles`. Decision rule (fixed before running): the protocol half checks whether the server
// advertises `workspace.fileOperations.willRename` with a filter that covers model files, and whether
// `willRenameFiles` for a model rename returns edits to the `ref()` calls of its children. The client half (whether
// vscode-languageclient forwards the request from VS Code and from Cursor) is "not established" by this script; it
// records the static evidence instead: the installed vscode-languageclient registers WillRenameFilesFeature, and the
// extension's client options carry no middleware or option that disables it. If the server edits `ref()` calls and
// both clients forward, docs/lsp-coverage.md records coverage and nothing is added; otherwise it records the gap.
import fs from "node:fs";
import path from "node:path";
import { repo, setup } from "./adoption.mjs";

const ctx = await setup("e7-will-rename", { targets: ["jaffle"] });
const { lib, root } = ctx;
const server = await ctx.start();
await ctx.load(server, "models/staging/stg_orders.sql");
await lib.sleep(1000);
const willRename =
  server.init.result?.capabilities?.workspace?.fileOperations?.willRename ??
  null;
const oldPath = path.join(root, "models/staging/stg_orders.sql");
const newPath = path.join(root, "models/staging/stg_orders_renamed.sql");
const e = await server.request("workspace/willRenameFiles", {
  files: [{ oldUri: lib.fileUri(oldPath), newUri: lib.fileUri(newPath) }],
});
await server.stop();

const edit = e.result ?? null;
const changes =
  edit?.changes ??
  Object.fromEntries(
    (edit?.documentChanges ?? []).map((d) => [d.textDocument?.uri, d.edits]),
  );
const editedFiles = Object.keys(changes)
  .map((u) => path.relative(root, new URL(u).pathname))
  .sort();
const newTexts = Object.values(changes)
  .flat()
  .map((t) => t.newText);
const refEdits = newTexts.filter((t) =>
  t.includes("stg_orders_renamed"),
).length;
const children = fs
  .readdirSync(path.join(root, "models"), { recursive: true })
  .filter(
    (f) =>
      f.endsWith(".sql") &&
      fs
        .readFileSync(path.join(root, "models", f), "utf8")
        .includes("ref('stg_orders')"),
  )
  .map((f) => `models/${f}`);
const coversSql = JSON.stringify(willRename ?? {}).includes("sql");

const clientJs = fs.readFileSync(
  path.join(repo, "node_modules/vscode-languageclient/lib/common/client.js"),
  "utf8",
);
const clientSrc = fs.readFileSync(
  path.join(repo, "src/fusion/fusionLanguageClient.ts"),
  "utf8",
);
const client = {
  established: false,
  reason:
    "needs a rename in a running VS Code and Cursor with the extension; not run by this script",
  languageClientRegistersWillRename: clientJs.includes(
    "WillRenameFilesFeature",
  ),
  extensionMiddlewareTouchesRename: /willRename|fileOperations/.test(clientSrc),
};
const serverEdits =
  Boolean(willRename) &&
  coversSql &&
  refEdits > 0 &&
  children.every((c) => editedFiles.includes(c));
const decision = serverEdits
  ? "server half passes: it advertises willRename for model files and edits every ref() to the renamed model; " +
    "client half not established"
  : "server half fails: record a Fusion gap in docs/lsp-coverage.md";
const file = ctx.write({
  rule: "see header",
  advertised: willRename,
  result: edit,
  editedFiles,
  refEdits,
  childrenWithRef: children,
  client,
  decision,
});
ctx.decide(`${decision} -> ${file}`);
process.exit(0);
