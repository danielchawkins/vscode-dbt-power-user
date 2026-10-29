import type { Disposable } from "vscode";
import { workspace } from "vscode";
import { disposeAll } from "../core/disposables";
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
    disposeAll(this.disposables);
  }
}
