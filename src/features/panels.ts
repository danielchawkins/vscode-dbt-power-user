import type { Disposable } from "vscode";
import { commands, window } from "vscode";
import { disposeAll } from "../core/disposables";
import { testCommandsEnabled } from "../settings";
import { DocsEditViewPanel } from "./docs/docsEditPanel";
import { LineageViewProvider } from "./lineage/lineageViewProvider";
import { QueryResultPanel } from "./queryResults/queryResultPanel";
import { registerQueryResultTestCommand } from "./queryResults/queryResultTestCommand";

/** Test-only: the model paths the documentation editor holds an unsaved draft for. */
const HELD_DRAFTS_TEST_COMMAND = "fusionPowerUser.test.heldDocDrafts";

export class WebviewViewProviders implements Disposable {
  private disposables: Disposable[] = [];
  private queryResultPanel: QueryResultPanel;
  private docsEditPanel: DocsEditViewPanel;
  private lineageViewProvider: LineageViewProvider;

  constructor(
    queryResultPanel: QueryResultPanel,
    docsEditPanel: DocsEditViewPanel,
    lineageViewProvider: LineageViewProvider,
  ) {
    this.queryResultPanel = queryResultPanel;
    this.docsEditPanel = docsEditPanel;
    this.lineageViewProvider = lineageViewProvider;
    this.disposables.push(
      this.docsEditPanel,
      this.queryResultPanel,
      this.lineageViewProvider,
      window.registerWebviewViewProvider(
        QueryResultPanel.viewType,
        this.queryResultPanel,
      ),
      window.registerWebviewViewProvider(
        DocsEditViewPanel.viewType,
        this.docsEditPanel,
      ),
      window.registerWebviewViewProvider(
        LineageViewProvider.viewType,
        this.lineageViewProvider,
      ),
    );
    const testCommand = registerQueryResultTestCommand(this.queryResultPanel);
    if (testCommand) {
      this.disposables.push(testCommand);
    }
    if (testCommandsEnabled()) {
      this.disposables.push(
        commands.registerCommand(HELD_DRAFTS_TEST_COMMAND, () =>
          this.docsEditPanel.heldDrafts(),
        ),
      );
    }
  }

  dispose() {
    disposeAll(this.disposables);
  }
}
