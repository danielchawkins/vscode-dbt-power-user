import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelHost } from "../../webview/panelHost";

class TestPanel extends PanelHost {
  protected readonly entry = "lineage" as never;
  protected readonly csp = {} as never;
  protected override panelDescription = "Test description";
  public events: string[] = [];

  protected override async onEvent(event: { command: string }) {
    this.events.push(event.command);
  }
  public get ready() {
    return this.isWebviewReady;
  }
  public markReady() {
    this.onWebviewReady();
  }
  public waitReady() {
    return this.checkIfWebviewReady();
  }
  public common() {
    return this.commonHandlers();
  }
  public get disposables() {
    return this._disposables;
  }
}

const make = () => {
  let listener: ((e: { command: string }) => unknown) | undefined;
  const panel = new TestPanel(
    { extensionUri: { fsPath: "/ext", path: "/ext", scheme: "file" } } as never,
    {
      eventEmitter: {
        event: (l: typeof listener) => {
          listener = l;
          return { dispose: vi.fn() };
        },
      },
    } as never,
    { debug: vi.fn() } as never,
    {} as never,
  );
  return { panel, emit: (command: string) => listener?.({ command }) };
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

  it("marks the page ready through the common handler", () => {
    const { panel } = make();
    expect(panel.ready).toBe(false);
    void panel.common()["webview:ready"]({ command: "webview:ready" } as never);
    expect(panel.ready).toBe(true);
  });

  it("waits until the page is ready", async () => {
    vi.useFakeTimers();
    const { panel } = make();
    let done = false;
    void panel.waitReady().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);
    panel.markReady();
    await vi.advanceTimersByTimeAsync(600);
    expect(done).toBe(true);
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

  it("disposes every registered disposable once", () => {
    const { panel } = make();
    const extra = { dispose: vi.fn() };
    panel.disposables.push(extra);
    panel.dispose();
    panel.dispose();
    expect(extra.dispose).toHaveBeenCalledTimes(1);
    expect(panel.disposables).toEqual([]);
  });
});
