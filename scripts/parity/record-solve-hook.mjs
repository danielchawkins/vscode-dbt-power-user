// Intent: a loader hook for record-finance-solves.mjs only. It rewrites the TypeScript solver module as it loads, so
// every call to solveSeparations is logged on globalThis.__solveLog with its inputs and TypeScript's output (or its
// error). The original export is renamed; the behaviour of the solver is unchanged. Chains ts-resolve.mjs for imports.

import { resolve as tsResolve } from "./ts-resolve.mjs";

export const resolve = tsResolve;

const SOLVER = "/packages/graph-layout/src/solve/vpsc.ts";
const MARKER = "export function solveSeparations(";

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith(SOLVER)) {
    return result;
  }
  const text = String(result.source ?? "");
  if (!text.includes(MARKER)) {
    throw new Error(
      "vpsc.ts changed shape; record-solve-hook.mjs needs updating",
    );
  }
  const recorder = `
export function solveSeparations(x0, weight, separations) {
  const log = (globalThis.__solveLog ??= []);
  const entry = { x0: [...x0], weight: [...weight], seps: separations.map((s) => ({ ...s })) };
  try {
    const out = solveSeparationsRaw(x0, weight, separations);
    log.push({ ...entry, out: [...out] });
    return out;
  } catch (error) {
    log.push({ ...entry, error: String(error.message) });
    throw error;
  }
}
`;
  return {
    ...result,
    source: text.replace(MARKER, "function solveSeparationsRaw(") + recorder,
  };
}
