import { inject } from "inversify";
import {
  CancellationToken,
  commands,
  Disposable,
  TextEditor,
  Uri,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window,
} from "vscode";
import { DBTProject } from "../dbt_client/dbtProject";
import { DBTTerminal } from "../dbt_integration";
import { Projects } from "../projects/projects";
import { NewLineagePanel } from "./newLineagePanel";

export interface LineagePanelView extends WebviewViewProvider {
  init(): void;
  /** Called with the project whose manifest changed, or `undefined` on project removal and panel init. */
  manifestChanged(project: DBTProject | undefined): void;
  changedActiveTextEditor(event: TextEditor | undefined): void;
  changedTextEditorSelection(editor: TextEditor): void;
  handleCommand(message: { command: string; args: any }): Promise<void> | void;
}

export class LineagePanel implements WebviewViewProvider, Disposable {
  public static readonly viewType = "fusionPowerUser.Lineage";

  private panel: WebviewView | undefined;
  private context: WebviewViewResolveContext<unknown> | undefined;
  private token: CancellationToken | undefined;
  private disposables: Disposable[] = [];

  public constructor(
    private lineagePanel: NewLineagePanel,
    private projects: Projects,
    @inject("DBTTerminal")
    private dbtTerminal: DBTTerminal,
  ) {
    this.disposables.push(
      projects.onDidChangeManifest((project) =>
        this.getPanel().manifestChanged(project),
      ),
      projects.onDidRemoveProject(() =>
        this.getPanel().manifestChanged(undefined),
      ),
    );
    window.onDidChangeActiveTextEditor((event: TextEditor | undefined) => {
      this.getPanel().changedActiveTextEditor(event);
    });
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

    this.init();
    panel.webview.onDidReceiveMessage(this.handleWebviewMessage, null, []);
  }

  private handleWebviewMessage = async (message: {
    command: string;
    args: any;
  }) => {
    this.dbtTerminal.debug(
      "lineagePanel:handleWebviewMessage",
      "message",
      message,
    );
    const { command, args } = message;
    // common commands
    if (command === "openFile") {
      const url = args.params?.url;
      if (!url) {
        return;
      }
      await commands.executeCommand("vscode.open", Uri.file(url), {
        preview: false,
        preserveFocus: true,
      });
      return;
    }

    if (command === "init") {
      this.getPanel()?.init();
      return;
    }

    this.getPanel().handleCommand(message);
  };
}
