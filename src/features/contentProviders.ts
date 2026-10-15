import type { Disposable } from "vscode";
import { workspace } from "vscode";
import { SqlPreviewContentProvider } from "./compiledSql/sqlPreviewContentProvider";

export class ContentProviders implements Disposable {
  private disposables: Disposable[] = [];
  private sqlPreviewContentProvider: SqlPreviewContentProvider;

  constructor(sqlPreviewContentProvider: SqlPreviewContentProvider) {
    this.sqlPreviewContentProvider = sqlPreviewContentProvider;
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
