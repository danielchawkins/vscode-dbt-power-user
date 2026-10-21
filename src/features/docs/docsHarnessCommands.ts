import type { documentationEditor } from "@fusion-power-user/webview-contract";
import { columnProposals } from "@fusion-power-user/webview-contract";
import type { Disposable } from "vscode";
import { commands, Uri, window } from "vscode";
import { readHarnessSwitch } from "../../settings";
import type { MessageOf } from "../../webview/messageRouter";
import type {
  ColumnProposalService,
  ProposalKind,
  ProposalTarget,
} from "./columnProposals";
import type { DbtTestService } from "./dbtTestService";
import type { DocGenService } from "./docGenService";

/** Test-only: answers with the column proposals for the active documentation after opening `file`. */
const DOCS_COLUMN_PROPOSALS_COMMAND = "fusionPowerUser.test.columnProposals";

/** Test-only: applies every column proposal of `kind` for the model in `file` and saves it through the panel's save. */
const DOCS_ACCEPT_ALL_PROPOSALS_COMMAND =
  "fusionPowerUser.test.acceptAllColumnProposals";

type SaveMessage = MessageOf<
  documentationEditor.PanelMessage,
  "saveDocumentation"
>;

/** What the harness reads from the documentation editor panel, and the save it hands the result to. */
export interface DocsHarnessDeps {
  columnProposals: ColumnProposalService;
  docGenService: Pick<
    DocGenService,
    "getUncompiledDocumentationForCurrentActiveFile"
  >;
  dbtTestService: Pick<DbtTestService, "getTestsForCurrentModel">;
  drafts: ReadonlyMap<string, documentationEditor.DocumentationDraft>;
  proposalTarget(): Promise<ProposalTarget | undefined>;
  save(message: SaveMessage): Promise<void>;
}

/**
 * Applies every proposal of `kind` for the active model, ticking each type overwrite, and saves the result. The model's
 * tests go with it: a save without them would delete the column tests from the YAML.
 */
async function acceptAllProposals(
  deps: DocsHarnessDeps,
  kind: ProposalKind,
): Promise<void> {
  const { documentation } =
    await deps.docGenService.getUncompiledDocumentationForCurrentActiveFile();
  const target = await deps.proposalTarget();
  const payload = target && (await deps.columnProposals.propose(kind, target));
  if (!documentation || !payload) {
    return;
  }
  const draft = deps.drafts.get(documentation.filePath);
  const columns = draft?.docs.columns ?? documentation.columns;
  await deps.save({
    ...(draft?.docs ?? documentation),
    command: "saveDocumentation",
    columns:
      payload.kind === "types"
        ? columnProposals.applyProposals(
            columns,
            payload.proposals,
            Object.fromEntries(
              payload.proposals
                .filter((proposal) => proposal.change === "overwrite")
                .map((proposal) => [
                  proposal.column.toLowerCase(),
                  { overwrite: true },
                ]),
            ),
          )
        : columnProposals.applyDescriptionProposals(columns, payload.proposals),
    updatedTests:
      draft?.tests ?? (await deps.dbtTestService.getTestsForCurrentModel()),
  });
}

/** Registers the docs harness commands when the integration harness asks for them. */
export function registerDocsHarnessCommands(
  deps: DocsHarnessDeps,
): Disposable[] {
  if (readHarnessSwitch("integrationCommands") !== "1") {
    return [];
  }
  return [
    commands.registerCommand(
      DOCS_COLUMN_PROPOSALS_COMMAND,
      async (kind: ProposalKind, file: string) => {
        await window.showTextDocument(Uri.file(file));
        const target = await deps.proposalTarget();
        return target && deps.columnProposals.propose(kind, target);
      },
    ),
    commands.registerCommand(
      DOCS_ACCEPT_ALL_PROPOSALS_COMMAND,
      async (kind: ProposalKind, file: string) => {
        await window.showTextDocument(Uri.file(file));
        await acceptAllProposals(deps, kind);
      },
    ),
  ];
}
