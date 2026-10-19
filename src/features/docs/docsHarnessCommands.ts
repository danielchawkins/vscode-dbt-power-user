import type { Disposable } from "vscode";
import { commands, Uri, window } from "vscode";
import { readHarnessSwitch } from "../../settings";
import type { ColumnProposalService, ProposalTarget } from "./columnProposals";

/** Test-only: answers with the column proposals for the active documentation after opening `file`. */
const DOCS_COLUMN_PROPOSALS_COMMAND = "fusionPowerUser.test.columnProposals";

/** Registers {@link DOCS_COLUMN_PROPOSALS_COMMAND} when the integration harness asks for it. */
export function registerDocsHarnessCommands(deps: {
  columnProposals: ColumnProposalService;
  proposalTarget(): Promise<ProposalTarget | undefined>;
}): Disposable | undefined {
  if (readHarnessSwitch("integrationCommands") !== "1") {
    return undefined;
  }
  return commands.registerCommand(
    DOCS_COLUMN_PROPOSALS_COMMAND,
    async (kind: "types", file: string) => {
      await window.showTextDocument(Uri.file(file));
      const target = await deps.proposalTarget();
      return target && deps.columnProposals.propose(kind, target);
    },
  );
}
