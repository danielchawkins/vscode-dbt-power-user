import { Disposable, window } from "vscode";
import { DocsEditViewPanel } from "./docs/docsEditPanel";
import { LineageViewProvider } from "./lineage/lineageViewProvider";
import { QueryResultPanel } from "./queryResults/queryResultPanel";
import { registerQueryResultTestCommand } from "./queryResults/queryResultTestCommand";

export class WebviewViewProviders implements Disposable {
  private disposables: Disposable[] = [];

  constructor(
    private queryResultPanel: QueryResultPanel,
    private docsEditPanel: DocsEditViewPanel,
    private lineageViewProvider: LineageViewProvider,
  ) {
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
  }

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
