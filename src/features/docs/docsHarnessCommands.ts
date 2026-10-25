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
import type { DocsDrafts } from "./docsDrafts";

/** Test-only: answers with the column proposals for the active documentation after opening `file`. */
const DOCS_COLUMN_PROPOSALS_COMMAND = "fusionPowerUser.test.columnProposals";

/** Test-only: applies every column proposal of `kind` for the model in `file` and saves it through the panel's save; answers the outcome. */
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
  drafts: DocsDrafts;
  proposalTarget(): Promise<ProposalTarget | undefined>;
  save(message: SaveMessage): Promise<void>;
}

/** What accept-all did: `saved`, or the reason it wrote nothing. */
type AcceptAllOutcome = "saved" | "noDocumentation" | "noPayload";

/**
 * Applies every proposal of `kind` for the active model and saves the result. No choices are passed, so an unticked
 * overwrite stays pending and keeps its YAML type. The model's tests go with the save: a save without them would delete
 * the column tests from the YAML.
 */
async function acceptAllProposals(
  deps: DocsHarnessDeps,
  kind: ProposalKind,
): Promise<AcceptAllOutcome> {
  const { documentation } =
    await deps.docGenService.getUncompiledDocumentationForCurrentActiveFile();
  if (!documentation) {
    return "noDocumentation";
  }
  const target = await deps.proposalTarget();
  const payload = target && (await deps.columnProposals.propose(kind, target));
  if (!payload) {
    return "noPayload";
  }
  const draft = deps.drafts.get(documentation.filePath);
  const columns = deps.drafts.columnsFor(documentation);
  await deps.save({
    ...(draft?.docs ?? documentation),
    command: "saveDocumentation",
    columns:
      payload.kind === "types"
        ? columnProposals.applyProposals(columns, payload.proposals)
        : columnProposals.applyDescriptionProposals(columns, payload.proposals),
    updatedTests:
      draft?.tests ?? (await deps.dbtTestService.getTestsForCurrentModel()),
  });
  return "saved";
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
        return acceptAllProposals(deps, kind);
      },
    ),
  ];
}
