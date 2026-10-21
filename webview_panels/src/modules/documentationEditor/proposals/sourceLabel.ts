import type { columnProposals } from "@fusion-power-user/webview-contract";

/** Where a types proposal's types came from, as the summary names it. */
export const sourceLabel = (
  source: columnProposals.ProposalSource | undefined,
): string | undefined => {
  switch (source?.kind) {
    case "target":
      return `Types from target ${source.target}, relation ${source.relation}`;
    case "deferred":
      return `Types from deferred state ${source.state} of target ${source.target}, relation ${source.relation}`;
    case "inferred":
      return "Types inferred by the language server";
    case undefined:
      return undefined;
  }
};
