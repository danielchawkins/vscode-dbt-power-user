import type { lineage } from "@fusion-power-user/webview-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Disposable, WebviewPanel, WebviewView } from "vscode";
import type { Handlers } from "../../webview/messageRouter";
import type { CommonPanelMessage } from "../../webview/panelHost";
import { PanelHost, postToWebview } from "../../webview/panelHost";

type Ready = CommonPanelMessage;

const isReadyMessage = (message: unknown): message is Ready =>
  typeof message === "object" &&
  message !== null &&
  (message as { command?: unknown }).command === "webview:ready";

class TestPanel extends PanelHost<
  lineage.HostMessage,
  Ready,
  lineage.ResponseBodies
> {
  protected readonly entry = "lineage" as never;
  protected readonly csp = {} as never;
  protected readonly guard = isReadyMessage;
  protected override panelDescription = "Test description";
  public events: string[] = [];

  protected override async onEvent(event: { command: string }) {
    this.events.push(event.command);
  }

  protected override handlers(
    page: WebviewView | WebviewPanel,
  ): Handlers<Ready> {
    return this.commonHandlers(page);
  }

  public attach(page: WebviewView | WebviewPanel) {
    this.listen(page);
  }

  public isPageReady(page: WebviewView | WebviewPanel) {
    return this.isReady(this.pageOf(page));
  }

  public waitFor(page: WebviewView | WebviewPanel, deadlineMs?: number) {
    return this.whenReady(this.pageOf(page), deadlineMs);
  }

  public follow(view: WebviewView, demand: unknown) {
    this.followDemand(view, demand as never);
  }

  public track(disposable: Disposable) {
    this._disposables.push(disposable);
  }
}

const make = () => {
  let listener: ((e: { command: string }) => unknown) | undefined;
  const panel = new TestPanel({
    extensionContext: {
      extensionUri: { fsPath: "/ext", path: "/ext", scheme: "file" },
    } as never,
    sharedState: {
      eventEmitter: {
        event: (l: typeof listener) => {
          listener = l;
          return { dispose: vi.fn() };
        },
      },
    } as never,
    log: { debug: vi.fn() } as never,
    queryManifestService: {} as never,
  });
  return { panel, emit: (command: string) => listener?.({ command }) };
};

/** A fake page: a view when `kind` is "view", otherwise a panel. Its hooks fire the listeners `listen` attached. */
const fakePage = (kind: "view" | "panel") => {
  let onMessage: ((message: unknown) => unknown) | undefined;
  let onVisibility: (() => unknown) | undefined;
  let onDispose: (() => unknown) | undefined;
  const ends = { message: vi.fn(), visibility: vi.fn(), dispose: vi.fn() };
  const subscribeMessages = vi.fn((listener: (m: unknown) => unknown) => {
    onMessage = listener;
    return { dispose: ends.message };
  });
  const page = {
    show: kind === "view" ? vi.fn() : undefined,
    visible: true,
    webview: {
      postMessage: vi.fn().mockResolvedValue(true),
      onDidReceiveMessage: subscribeMessages,
    },
    onDidChangeVisibility: (listener: () => unknown) => {
      onVisibility = listener;
      return { dispose: ends.visibility };
    },
    onDidDispose: (listener: () => unknown) => {
      onDispose = listener;
      return { dispose: ends.dispose };
    },
  };
  return {
    page,
    subscribeMessages,
    ends,
    send: (command: string) => onMessage?.({ command }),
    hide: () => {
      page.visible = false;
      onVisibility?.();
    },
    close: () => onDispose?.(),
  };
};

/** Lets the dispatched message reach its handler. */
const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe("PanelHost", () => {
  afterEach(() => vi.useRealTimers());

  it("tells a view from a panel by its show method", () => {
    const { panel } = make();
    expect(panel.isWebviewView({ show: () => undefined } as never)).toBe(true);
    expect(panel.isWebviewView({} as never)).toBe(false);
  });

  it("forwards shared-state events to onEvent", () => {
    const { panel, emit } = make();
    emit("refresh");
    expect(panel.events).toEqual(["refresh"]);
  });

  it("marks the page ready when it posts webview:ready", async () => {
    const { panel } = make();
    const page = fakePage("panel");
    panel.attach(page.page as never);
    expect(panel.isPageReady(page.page as never)).toBe(false);
    page.send("webview:ready");
    await flush();
    expect(panel.isPageReady(page.page as never)).toBe(true);
  });

  it("subscribes to a page's messages once", () => {
    const { panel } = make();
    const page = fakePage("panel");
    panel.attach(page.page as never);
    panel.attach(page.page as never);
    expect(page.subscribeMessages).toHaveBeenCalledOnce();
  });

  it("resets a view's readiness when it is hidden", async () => {
    const { panel } = make();
    const page = fakePage("view");
    panel.attach(page.page as never);
    page.send("webview:ready");
    await flush();
    expect(panel.isPageReady(page.page as never)).toBe(true);
    page.hide();
    expect(panel.isPageReady(page.page as never)).toBe(false);
  });

  it("describes the view and renders its HTML on resolve", () => {
    const { panel } = make();
    const view = {
      show: vi.fn(),
      description: "",
      webview: {
        options: {},
        html: "",
        cspSource: "csp",
        asWebviewUri: (u: unknown) => u,
      },
    };
    try {
      panel.resolveWebviewView(view as never, {} as never, {} as never);
    } catch {
      // HTML rendering needs built assets; the options are set before it.
    }
    expect(view.description).toBe("Test description");
    expect(view.webview.options).toMatchObject({ enableScripts: true });
  });

  it("ends a page's subscriptions when the page is disposed", () => {
    const { panel } = make();
    const page = fakePage("panel");
    panel.attach(page.page as never);
    page.close();
    expect(page.ends.message).toHaveBeenCalledOnce();
  });

  it("ends a view's parse demand with the view", () => {
    const { panel } = make();
    const page = fakePage("view");
    const dispose = vi.fn();
    const follow = vi.fn(() => ({ dispose }));
    panel.follow(page.page as never, { follow });
    expect(follow).toHaveBeenCalledOnce();
    panel.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes every registered disposable once", () => {
    const { panel } = make();
    const extra = { dispose: vi.fn() };
    panel.track(extra);
    panel.dispose();
    panel.dispose();
    expect(extra.dispose).toHaveBeenCalledTimes(1);
  });

  it("resolves false when postMessage rejects", async () => {
    const postMessage = vi.fn().mockRejectedValue(new Error("gone"));
    const result = postToWebview(
      { webview: { postMessage } as never },
      {
        command: "x",
      },
    );
    await expect(result).resolves.toBe(false);
  });

  it("logs and returns undefined when the view is disposed", () => {
    const log = { debug: vi.fn() };
    const target = {
      get webview(): never {
        throw new Error("Webview is disposed");
      },
    };
    expect(postToWebview(target, { command: "x" }, log as never)).toBe(
      undefined,
    );
    expect(log.debug).toHaveBeenCalledOnce();
  });
});
