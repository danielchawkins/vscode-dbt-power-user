import {
  Disposable,
  Event,
  EventEmitter,
  ProgressLocation,
  TextDocumentContentProvider,
  Uri,
  window,
  workspace,
} from "vscode";
import { modelUriOf, PREVIEW_SCHEME } from "../../projects/previewUri";
import { Projects } from "../../projects/projects";

const DIRTY_MARKER = "-- Unsaved changes: showing the last saved version.";
const WAITING = "Waiting for the first compile";
const LOADING = "Still loading dbt project, please try again later...";
const MAX_WAITS = 3;

interface Preview {
  uri: Uri;
  /** Whether the model was dirty when the preview last rendered. */
  dirty: boolean;
  /** The last render found no project yet; it renders again when projects appear. */
  loading: boolean;
  /** Renders that found the file not yet compiled; bounded so a server that never compiles it cannot loop. */
  waits: number;
  compileSubscription?: Disposable;
}

/**
 * The compiled preview of a model. A saved model shows the file `dbt.compileFile` returns and follows the project's
 * compile-complete notifications; unsaved edits do not recompile. Untitled text compiles through the CLI.
 */
export class SqlPreviewContentProvider
  implements TextDocumentContentProvider, Disposable
{
  static readonly SCHEME = PREVIEW_SCHEME;

  private _onDidChange = new EventEmitter<Uri>();
  private previews = new Map<string, Preview>();
  private subscriptions: Disposable[] = [];

  constructor(private projects: Projects) {
    this.subscriptions.push(
      projects.onDidInitialize(() => this.renderLoadingPreviews()),
      workspace.onDidChangeTextDocument((e) => {
        const changed = e.document.uri.toString();
        for (const preview of this.previews.values()) {
          if (
            modelUriOf(preview.uri)?.toString() === changed &&
            e.document.isDirty !== preview.dirty
          ) {
            this._onDidChange.fire(preview.uri);
          }
        }
      }),
      window.onDidChangeVisibleTextEditors(() => {
        const visible = new Set(
          window.visibleTextEditors
            .filter(
              (editor) =>
                editor.document.uri.scheme === SqlPreviewContentProvider.SCHEME,
            )
            .map((editor) => editor.document.uri.toString()),
        );
        for (const [key, preview] of this.previews) {
          if (!visible.has(key)) {
            preview.compileSubscription?.dispose();
            this.previews.delete(key);
          }
        }
      }),
    );
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.subscriptions.forEach((s) => s.dispose());
    this.previews.forEach((p) => p.compileSubscription?.dispose());
    this.previews.clear();
  }

  get onDidChange(): Event<Uri> {
    return this._onDidChange.event;
  }

  /** A preview restored before the projects exist renders again once they do. */
  private renderLoadingPreviews(): void {
    for (const preview of this.previews.values()) {
      if (preview.loading) {
        this._onDidChange.fire(preview.uri);
      }
    }
  }

  provideTextDocumentContent(uri: Uri): string | Thenable<string> {
    const key = uri.toString();
    const preview = this.previews.get(key) ?? {
      uri,
      dirty: false,
      loading: false,
      waits: 0,
    };
    this.previews.set(key, preview);
    return window.withProgress(
      { location: ProgressLocation.Window, title: "Compiling dbt model..." },
      async () => await this.render(preview),
    );
  }

  private async render(preview: Preview): Promise<string> {
    try {
      const modelUri = modelUriOf(preview.uri);
      if (modelUri === undefined) {
        return `Not a compiled preview: ${preview.uri.toString()}`;
      }
      const project = this.projects.get(modelUri);
      preview.loading = project === undefined;
      if (project === undefined) {
        return LOADING;
      }
      const document = workspace.textDocuments.find(
        (doc) => doc.uri.toString() === modelUri.toString(),
      );
      preview.dirty = document?.isDirty ?? false;
      if (modelUri.scheme === "untitled") {
        return await project.unsafeCompileQuery(document?.getText() ?? "");
      }
      // `compileFile` on a compiled file sends no report, so a report is never this preview's own echo.
      preview.compileSubscription ??= project.onDidCompile(() => {
        if (preview.waits <= MAX_WAITS) {
          this._onDidChange.fire(preview.uri);
        }
      });
      const sql = await project.compiledSql(modelUri);
      if (sql === undefined) {
        // Not compiled yet: the next compile-complete renders again, at most MAX_WAITS times.
        preview.waits = Math.min(preview.waits + 1, MAX_WAITS + 1);
        return WAITING;
      }
      preview.waits = 0;
      return preview.dirty ? `${DIRTY_MARKER}\n${sql}` : sql;
    } catch (error) {
      // A model that does not compile shows the server's error in the preview, not as a notification.
      return `-- Could not compile: ${(error as Error).message}`;
    }
  }
}
