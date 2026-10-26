import type { WebviewReady } from "@fusion-power-user/webview-contract";
import type {
  CancellationToken,
  Disposable,
  Event,
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
import type { ExtensionContextStore } from "../extensionContext";
import type { QueryManifestService } from "../projects/project/queryManifestService";
import type {
  SharedStateEventEmitterProps,
  SharedStateService,
} from "../projects/project/sharedStateService";
import type { Handlers } from "./messageRouter";
import { dispatchMessage } from "./messageRouter";
import { PageReadiness } from "./pageReadiness";
import type { PanelCsp, PanelEntry } from "./panelHtml";
import { panelHtml, panelWebviewOptions } from "./panelHtml";

/** The commands every panel on `PanelHost` sends. */
export type CommonPanelMessage = WebviewReady;

/** The only place a host message leaves for a webview; `H` is the panel's `HostMessage`. */
export function postToWebview<H extends { command: string }>(
  target: { readonly webview: Webview } | undefined,
  message: H,
  log?: Log,
): Thenable<boolean> | undefined {
  try {
    // eslint-disable-next-line no-restricted-syntax -- the one outbound path
    return target?.webview.postMessage(message).then(undefined, () => false);
  } catch (error) {
    // The view was disposed (reading `webview` throws then): nothing is left to deliver to.
    log?.debug("postToWebview", "dropped a post to a disposed view", error);
    return undefined;
  }
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
  private readonly rules: ReplayRules<H>;

  public constructor(rules: ReplayRules<H>) {
    this.rules = rules;
  }

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

/** What a view needs from a parse demand: a follow that holds the parse while `isVisible` is true. */
export interface DemandFollow {
  follow(isVisible: () => boolean, onDidChange: Event<unknown>): Disposable;
}

/** Renders a panel's Vite entry, subscribes to its messages and tracks each page's readiness; each panel subclasses it. */
export abstract class PanelHost<
  H extends { command: string },
  I extends { command: string },
> implements WebviewViewProvider {
  public viewType = "fusionPowerUser.Default";
  /** The panel's file in `webview_panels/src/entries`. */
  protected abstract readonly entry: PanelEntry;
  /** What the entry's page needs beyond the shared policy in `contentSecurityPolicy`. */
  protected abstract readonly csp: PanelCsp;
  /** Accepts the incoming commands the panel handles; a rejected message is logged and dropped. */
  protected abstract readonly guard: (message: unknown) => message is I;
  protected panelDescription = "Webview panel";

  protected _panel: WebviewView | WebviewPanel | undefined = undefined;
  protected _disposables: Disposable[] = [];
  protected extensionContext: ExtensionContextStore;
  protected emitterService: SharedStateService;
  protected dbtTerminal: Log;
  protected queryManifestService: QueryManifestService;
  private _replay?: PanelReplay<Page, H>;
  private readonly readiness = new PageReadiness<Page>();
  /** The subscriptions of each page `listen` attached to; they end with the page. */
  private readonly listening = new Map<
    WebviewView | WebviewPanel,
    Disposable[]
  >();
  /** The parse demand each view follows; it ends with the view. */
  private readonly demands = new Map<WebviewView | WebviewPanel, Disposable>();

  public constructor(
    extensionContext: ExtensionContextStore,
    emitterService: SharedStateService,
    dbtTerminal: Log,
    queryManifestService: QueryManifestService,
  ) {
    this.extensionContext = extensionContext;
    this.emitterService = emitterService;
    this.dbtTerminal = dbtTerminal;
    this.queryManifestService = queryManifestService;
    this._disposables.push(
      emitterService.eventEmitter.event((d) => this.onEvent(d)),
    );
  }

  public isWebviewView(
    panel: WebviewPanel | WebviewView,
  ): panel is WebviewView {
    return (panel as WebviewView).show !== undefined;
  }

  protected async onEvent({ command }: SharedStateEventEmitterProps) {
    switch (command) {
      default:
        break;
    }
  }

  /** Renders the panel's HTML; `listen` subscribes to the webview's messages once the page is attached. */
  protected renderWebviewView(webview: Webview) {
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
  ): Thenable<boolean> | undefined {
    this.replay.record(this.pageOf(panel), message);
    return postToWebview(panel, message, this.dbtTerminal);
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

  /** A page reports ready on first load and after VS Code rebuilds it. */
  protected onWebviewReady(page: WebviewView | WebviewPanel) {
    completeWebviewReady(this.entry);
    this.readiness.markReady(this.pageOf(page));
  }

  protected beginWebviewResolve() {
    recordWebviewResolveStart(this.entry);
  }

  /** Handlers for the commands every panel on `PanelHost` sends; each panel spreads them into its own map. */
  protected commonHandlers(
    page: WebviewView | WebviewPanel,
  ): Handlers<CommonPanelMessage> {
    return {
      "webview:ready": () => this.onWebviewReady(page),
    };
  }

  /** One handler per incoming command the panel accepts, for the page `page`. */
  protected abstract handlers(page: WebviewView | WebviewPanel): Handlers<I>;

  /** Whether `page` has reported ready since it was last reset. */
  protected isReady(page: Page): boolean {
    return this.readiness.isReady(page);
  }

  /** Resolves true once `page` is ready, or false after `deadlineMs` when one is given, or when the page is disposed. */
  protected whenReady(page: Page, deadlineMs?: number): Promise<boolean> {
    return this.readiness.whenReady(page, deadlineMs);
  }

  /**
   * Subscribes to the messages of `page` once. Each message goes through the guard and the handler map, and the
   * page's readiness resets now and each time a view is hidden. The subscription ends with the page, or with the host.
   */
  protected listen(page: WebviewView | WebviewPanel): void {
    this.readiness.reset(this.pageOf(page));
    if (this.listening.has(page)) {
      return;
    }
    const ends: Disposable[] = [
      page.webview.onDidReceiveMessage((message: unknown) =>
        dispatchMessage({
          source: this.viewType,
          message,
          guard: this.guard,
          handlers: this.handlers(page),
          sink: {
            log: this.dbtTerminal,
            // A reply records no replay slot, so it goes straight out rather than through `postTo`.
            reply: (response) =>
              postToWebview(page, response, this.dbtTerminal),
          },
        }),
      ),
    ];
    if (this.isWebviewView(page)) {
      ends.push(
        page.onDidChangeVisibility(() => {
          if (!page.visible) {
            // A hidden view's page is discarded, so the page shown next must report ready again.
            this.readiness.reset(this.pageOf(page));
          }
        }),
      );
    }
    ends.push(page.onDidDispose(() => this.endPage(page)));
    this.listening.set(page, ends);
  }

  /**
   * Keeps a parse demand while `view` is visible: a documentation or lineage view reads parse-owned fields, so a
   * visible view keeps the parse current. A later call for `view` replaces the earlier follow; the view ends it.
   */
  protected followDemand(
    view: WebviewView,
    parseDemand: DemandFollow | undefined,
  ): void {
    this.demands.get(view)?.dispose();
    this.demands.delete(view);
    if (parseDemand) {
      this.demands.set(
        view,
        parseDemand.follow(() => view.visible, view.onDidChangeVisibility),
      );
    }
  }

  /** Ends a page's subscription and demand, and forgets its readiness. */
  private endPage(page: WebviewView | WebviewPanel) {
    for (const end of this.listening.get(page) ?? []) {
      end.dispose();
    }
    this.listening.delete(page);
    this.demands.get(page)?.dispose();
    this.demands.delete(page);
    this.readiness.dispose(this.pageOf(page));
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
    this.listen(panel);
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
    for (const page of this.listening.keys()) {
      this.endPage(page);
    }
    for (const page of this.demands.keys()) {
      this.endPage(page);
    }
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
