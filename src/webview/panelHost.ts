import type { WebviewReady } from "@fusion-power-user/webview-contract";
import {
  CancellationToken,
  Disposable,
  Webview,
  WebviewPanel,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
} from "vscode";
import {
  completeWebviewReady,
  beginWebviewResolve as recordWebviewResolveStart,
} from "../benchmark/runtimeTimings";
import { DBTTerminal } from "../dbt_integration";
import { ExtensionContextStore } from "../extensionContext";
import { QueryManifestService } from "../projects/queryManifestService";
import {
  SharedStateEventEmitterProps,
  SharedStateService,
} from "../projects/sharedStateService";
import { Handlers } from "./messageRouter";
import {
  PanelCsp,
  PanelEntry,
  panelHtml,
  panelWebviewOptions,
} from "./panelHtml";

/** The commands every panel on `PanelHost` sends. */
export type CommonPanelMessage = WebviewReady;

/** Renders a panel's Vite entry and routes the commands every panel sends; each panel subclasses it. */
export abstract class PanelHost implements WebviewViewProvider {
  public viewType = "fusionPowerUser.Default";
  /** The panel's file in `webview_panels/src/entries`. */
  protected abstract readonly entry: PanelEntry;
  /** What the entry's page needs beyond the shared policy in `contentSecurityPolicy`. */
  protected abstract readonly csp: PanelCsp;
  protected panelDescription = "Webview panel";

  protected _panel: WebviewView | WebviewPanel | undefined = undefined;
  protected _webview: Webview | undefined = undefined;
  protected _disposables: Disposable[] = [];
  // Flag to know if panel's webview is rendered and ready to receive message
  protected isWebviewReady = false;

  public constructor(
    protected extensionContext: ExtensionContextStore,
    protected emitterService: SharedStateService,
    protected dbtTerminal: DBTTerminal,
    protected queryManifestService: QueryManifestService,
  ) {
    const t = this;
    this._disposables.push(
      emitterService.eventEmitter.event((d) => t.onEvent(d)),
    );
  }

  public isWebviewView(
    panel: WebviewPanel | WebviewView,
  ): panel is WebviewView {
    return (<WebviewView>panel).show !== undefined;
  }

  protected async onEvent({ command }: SharedStateEventEmitterProps) {
    switch (command) {
      default:
        break;
    }
  }

  /** Renders the panel's HTML; each panel subscribes to the webview's messages with its own guard and handlers. */
  protected renderWebviewView(webview: Webview) {
    this._webview = webview;
    webview.html = panelHtml(webview, this.extensionContext.extensionUri, {
      entry: this.entry,
      csp: this.csp,
    });
  }

  protected onWebviewReady() {
    completeWebviewReady(this.entry);
    this.isWebviewReady = true;
  }

  protected beginWebviewResolve() {
    recordWebviewResolveStart(this.entry);
  }

  /** Handlers for the commands every panel on `PanelHost` sends; each panel spreads them into its own map. */
  protected commonHandlers(): Handlers<CommonPanelMessage> {
    return {
      "webview:ready": () => this.onWebviewReady(),
    };
  }

  protected async checkIfWebviewReady() {
    return new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (this.isWebviewReady) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
  }

  resolveWebviewView(
    panel: WebviewView,
    _context: WebviewViewResolveContext<unknown>,
    _token: CancellationToken,
  ): void | Thenable<void> {
    this.beginWebviewResolve();
    this._panel = panel;
    this.setupWebviewOptions();
    this.renderWebviewView(this._panel.webview);
  }

  private setupWebviewOptions() {
    if (this._panel && "description" in this._panel) {
      this._panel.description = this.panelDescription;
    }
    this._panel!.webview.options = panelWebviewOptions(
      this.extensionContext.extensionUri,
    );
  }

  dispose() {
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
