import { Disposable, workspace } from "vscode";
import { SqlPreviewContentProvider } from "./sqlPreviewContentProvider";

export class ContentProviders implements Disposable {
  private disposables: Disposable[] = [];

  constructor(private sqlPreviewContentProvider: SqlPreviewContentProvider) {
    this.disposables.push(
      this.sqlPreviewContentProvider,
      workspace.registerTextDocumentContentProvider(
        SqlPreviewContentProvider.SCHEME,
        this.sqlPreviewContentProvider,
      ),
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
