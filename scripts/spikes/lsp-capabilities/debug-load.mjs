// Prints every server message for `seconds` after opening one file; for checking load behaviour.
//   node debug-load.mjs <root> <relFile> [seconds] [lsp args...]
import fs from "node:fs";
import path from "node:path";
import { sleep, startServer } from "./lib.mjs";

const [rootArg, rel, seconds = "30", ...extraArgs] = process.argv.slice(2);
const root = fs.realpathSync(rootArg);
const server = await startServer({ root, extraArgs });
console.log("init ms", server.init.ms, server.init.error ?? "");
server.openDoc(path.join(root, rel));
await sleep(Number(seconds) * 1000);
for (const e of server.events) {
  const p = JSON.stringify(e.params ?? null);
  console.log(e.t, e.kind, e.method, e.title ?? "", p.length > 200 ? `${p.slice(0, 200)}…` : p);
}
console.log(server.stderr().slice(-2000));
await server.stop();
process.exit(0);
