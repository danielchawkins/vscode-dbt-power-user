/**
 * Why the server-owned graph is empty, for the lineage panel and the model trees; `undefined` when the cause is not
 * the client. A running client returns the full graph in every static-analysis mode (E8), so a running client with no
 * server value only means the first compile has not landed.
 */
export function graphUnavailable(
  state: string,
  hasServerValue: boolean,
): string | undefined {
  if (hasServerValue) {
    return undefined;
  }
  if (state !== "running") {
    return `The dbt Fusion language server for this project is ${state}; the dependency graph needs it running.`;
  }
  return "Waiting for the first compile by the dbt Fusion language server; the dependency graph fills in then.";
}
