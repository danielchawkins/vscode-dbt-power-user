import { DBTTerminal } from "@altimateai/dbt-integration";
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
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import {
  ManifestCacheChangedEvent,
  ManifestCacheProjectAddedEvent,
} from "../dbt_client/event/manifestCacheChangedEvent";
import { NewLineagePanel } from "./newLineagePanel";

export interface LineagePanelView extends WebviewViewProvider {
  init(): void;
  eventMapChanged(eventMap: Map<string, ManifestCacheProjectAddedEvent>): void;
  changedActiveTextEditor(event: TextEditor | undefined): void;
  changedTextEditorSelection(editor: TextEditor): void;
  handleCommand(message: { command: string; args: any }): Promise<void> | void;
}

export class LineagePanel implements WebviewViewProvider, Disposable {
  public static readonly viewType = "fusionPowerUser.Lineage";

  private panel: WebviewView | undefined;
  private context: WebviewViewResolveContext<unknown> | undefined;
  private token: CancellationToken | undefined;
  private eventMap: Map<string, ManifestCacheProjectAddedEvent> = new Map();
  private disposables: Disposable[] = [];

  public constructor(
    private lineagePanel: NewLineagePanel,
    private dbtProjectContainer: DBTProjectContainer,
    @inject("DBTTerminal")
    private dbtTerminal: DBTTerminal,
  ) {
    this.disposables.push(
      dbtProjectContainer.onManifestChanged((event) =>
        this.onManifestCacheChanged(event),
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

  private onManifestCacheChanged(event: ManifestCacheChangedEvent): void {
    event.added?.forEach((added) => {
      this.eventMap.set(added.project.projectRoot.fsPath, added);
    });
    event.removed?.forEach((removed) => {
      this.eventMap.delete(removed.projectRoot.fsPath);
    });
    this.getPanel().eventMapChanged(this.eventMap);
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
    this.getPanel().eventMapChanged(this.eventMap);
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
