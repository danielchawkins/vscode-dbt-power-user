import type { Uri } from "vscode";
import { commands, window } from "vscode";
import type { RegisterCommand } from "../../commandRegistry";
import type { ColumnProposalRequests, ProposalKind } from "./columnProposals";

export function registerDocsCommands(
  register: RegisterCommand,
  requests: ColumnProposalRequests,
) {
  return [
    register("fusionPowerUser.goToDocumentationEditor", () =>
      commands.executeCommand("workbench.view.extension.docs_edit_view"),
    ),
    register("fusionPowerUser.viewInDocEditor", () =>
      commands.executeCommand("fusionPowerUser.DocsEdit.focus"),
    ),
    register("fusionPowerUser.recordColumnTypes", (uri?: Uri) =>
      requestProposals(requests, "types", uri),
    ),
    register("fusionPowerUser.pullUpstreamDescriptions", (uri?: Uri) =>
      requestProposals(requests, "descriptions", uri),
    ),
  ];
}

/** Shows `uri` when it is not the active editor's, focuses the documentation editor and asks it for `kind`. */
async function requestProposals(
  requests: ColumnProposalRequests,
  kind: ProposalKind,
  uri: Uri | undefined,
) {
  if (
    uri &&
    uri.toString() !== window.activeTextEditor?.document.uri.toString()
  ) {
    await window.showTextDocument(uri);
  }
  await commands.executeCommand("fusionPowerUser.DocsEdit.focus");
  requests.request(kind);
}
