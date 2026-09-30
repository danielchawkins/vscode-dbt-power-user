import { Disposable, window } from "vscode";
import { DocsEditViewPanel } from "./docsEditPanel";
import { LineageViewProvider } from "./lineageViewProvider";
import { QueryResultPanel } from "./queryResultPanel";

export class WebviewViewProviders implements Disposable {
  private disposables: Disposable[] = [];

  constructor(
    private queryResultPanel: QueryResultPanel,
    private docsEditPanel: DocsEditViewPanel,
    private lineageViewProvider: LineageViewProvider,
  ) {
    this.disposables.push(
      window.registerWebviewViewProvider(
        QueryResultPanel.viewType,
        this.queryResultPanel,
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
      window.registerWebviewViewProvider(
        DocsEditViewPanel.viewType,
        this.docsEditPanel,
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
      window.registerWebviewViewProvider(
        LineageViewProvider.viewType,
        this.lineageViewProvider,
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
      this.docsEditPanel,
    );
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
