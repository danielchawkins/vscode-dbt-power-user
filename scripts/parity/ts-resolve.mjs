// Intent: a resolve hook for the parity tooling only. Node's type stripping runs the TypeScript sources of
// packages/graph-layout directly, but it does not map an import of `./x.js` to the source `./x.ts`, which those
// sources use. This hook maps it, and leaves every other specifier to Node. print-fixtures.mjs registers it.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
    const source = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(source))) {
      return nextResolve(source.href, context);
    }
  }
  return nextResolve(specifier, context);
}
