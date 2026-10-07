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
import type { Log } from "../core/log";
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

/** The only place a host message leaves for a webview; `H` is the panel's `HostMessage`. */
export function postToWebview<H extends { command: string }>(
  target: { readonly webview: Webview } | undefined,
  message: H,
): Thenable<boolean> | undefined {
  // eslint-disable-next-line no-restricted-syntax -- the one outbound path
  return target?.webview.postMessage(message);
}

/** Which posted commands a panel replays to a rebuilt page. */
export interface ReplayRules<H extends { command: string }> {
  /** Slot names in the order their messages replay. */
  order: readonly string[];
  /** The slot a command fills; a later message in the slot replaces the earlier one. */
  slotOf: Partial<Record<H["command"], string>>;
  /** Commands after which `clearSlot` is empty. */
  clears: readonly H["command"][];
  clearSlot: string;
}

/** A page of a panel: the view VS Code resolved last, or one `WebviewPanel`. */
export type Page = "bottom" | WebviewPanel;

/**
 * The last message of each slot posted to each page, keyed by the page's role, so a page VS Code rebuilt
 * after hiding it shows what it showed before. Rows stay in host memory, never in webview state.
 */
export class PanelReplay<K, H extends { command: string }> {
  private readonly pages = new Map<
    K,
    { slots: Map<string, H>; tabData?: unknown }
  >();

  public constructor(private readonly rules: ReplayRules<H>) {}

  private page(key: K) {
    let page = this.pages.get(key);
    if (!page) {
      page = { slots: new Map() };
      this.pages.set(key, page);
    }
    return page;
  }

  /** Records `message` as posted to the page at `key`. */
  record(key: K, message: H): void {
    const { slots } = this.page(key);
    if (this.rules.clears.includes(message.command)) {
      slots.delete(this.rules.clearSlot);
    }
    const slot = this.rules.slotOf[message.command as H["command"]];
    if (slot) {
      slots.set(slot, message);
    }
  }

  /** The messages that bring a rebuilt page back to its last state, in posting order. */
  messagesFor(key: K): H[] {
    const slots = this.pages.get(key)?.slots;
    return slots
      ? this.rules.order.flatMap((slot) => slots.get(slot) ?? [])
      : [];
  }

  /** Binds the data a results tab renders to its page, which asks for it again after each rebuild. */
  setTabData(key: K, data: unknown): void {
    this.page(key).tabData = data;
  }

  tabDataFor(key: K): unknown {
    return this.pages.get(key)?.tabData;
  }

  /** Forgets a closed page. */
  delete(key: K): void {
    this.pages.delete(key);
  }

  /** Forgets every page's state and tab data. */
  clear(): void {
    this.pages.clear();
  }
}

/** Renders a panel's Vite entry and routes the commands every panel sends; each panel subclasses it. */
export abstract class PanelHost<
  H extends { command: string },
> implements WebviewViewProvider {
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
  private _replay?: PanelReplay<Page, H>;

  public constructor(
    protected extensionContext: ExtensionContextStore,
    protected emitterService: SharedStateService,
    protected dbtTerminal: Log,
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

  /** Posts to the page the host currently targets. */
  protected post(message: H): Thenable<boolean> | undefined {
    return this._panel && this.postTo(this._panel, message);
  }

  /** Posts to `panel` after recording it, so a rebuilt page can replay its last state. */
  protected postTo(
    panel: WebviewView | WebviewPanel,
    message: H,
  ): Thenable<boolean> {
    this.replay.record(this.pageOf(panel), message);
    return postToWebview(panel, message) as Thenable<boolean>;
  }

  /** A panel that replays state to rebuilt pages overrides this. */
  protected replayRules(): ReplayRules<H> {
    return { order: [], slotOf: {}, clears: [], clearSlot: "" };
  }

  protected get replay(): PanelReplay<Page, H> {
    return (this._replay ??= new PanelReplay<Page, H>(this.replayRules()));
  }

  protected pageOf(panel: WebviewView | WebviewPanel): Page {
    return this.isWebviewView(panel) ? "bottom" : panel;
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
