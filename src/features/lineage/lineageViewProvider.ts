import type {
  CancellationToken,
  Disposable,
  TextEditor,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
} from "vscode";
import { window } from "vscode";
import type { ParseDemand } from "../../projects/manifest/parseDemand";
import type { Projects } from "../../projects/project/projects";
import type { LineagePanel } from "./lineagePanel";
import { LINEAGE_VIEW_TYPE } from "./lineagePanel";

export class LineageViewProvider implements WebviewViewProvider, Disposable {
  public static readonly viewType = LINEAGE_VIEW_TYPE;

  private panel: WebviewView | undefined;
  private context: WebviewViewResolveContext<unknown> | undefined;
  private token: CancellationToken | undefined;
  private disposables: Disposable[] = [];
  private lineagePanel: LineagePanel;
  private parseDemand: ParseDemand | undefined;

  public constructor(
    lineagePanel: LineagePanel,
    projects: Projects,
    parseDemand?: ParseDemand,
  ) {
    this.lineagePanel = lineagePanel;
    this.parseDemand = parseDemand;
    this.disposables.push(
      lineagePanel,
      projects.onDidChangeManifest((project) =>
        this.getPanel().manifestChanged(project),
      ),
      projects.onDidRemoveProject(() =>
        this.getPanel().manifestChanged(undefined),
      ),
      window.onDidChangeActiveTextEditor((event: TextEditor | undefined) => {
        this.getPanel().changedActiveTextEditor(event);
      }),
    );
    window.onDidChangeTextEditorSelection(
      (event) => {
        this.getPanel().changedTextEditorSelection(event.textEditor);
      },
      null,
      this.disposables,
    );
  }

  private getPanel() {
    return this.lineagePanel;
  }

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private init = async () => {
    await this.getPanel().resolveWebviewView(
      this.panel!,
      this.context!,
      this.token!,
    );
    this.getPanel().manifestChanged(undefined);
  };

  resolveWebviewView(
    panel: WebviewView,
    context: WebviewViewResolveContext<unknown>,
    token: CancellationToken,
  ): void | Thenable<void> {
    this.panel = panel;
    this.context = context;
    this.token = token;

    // The lineage drawer reads descriptions, tests and meta, which only the parse supplies.
    const demand = this.parseDemand?.follow(
      () => panel.visible,
      panel.onDidChangeVisibility,
    );
    if (demand) {
      this.disposables.push(demand);
      panel.onDidDispose(() => demand.dispose());
    }

    void this.init();
    panel.webview.onDidReceiveMessage(
      (message: unknown) => this.getPanel().handleCommand(message),
      null,
      this.disposables,
    );
  }
}
