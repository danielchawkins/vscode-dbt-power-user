import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, EventEmitter, Uri } from "vscode";
import { QueryResultPanel } from "../../features/queryResults/queryResultPanel";
import {
  registerQueryResultTestCommand,
  RENDER_TEST_RESULT_COMMAND,
} from "../../features/queryResults/queryResultTestCommand";

const terminal = () => ({
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
});

/** A results tab: a `WebviewPanel` double whose dispose listeners run on `close`. */
function resultsTab() {
  const onDispose: (() => void)[] = [];
  const subscription = { dispose: vi.fn() };
  return {
    subscription,
    close: () => onDispose.forEach((listener) => listener()),
    value: {
      webview: {
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn(() => subscription),
      },
      onDidDispose: vi.fn((listener: () => void) => {
        onDispose.push(listener);
        return { dispose: vi.fn() };
      }),
    },
  };
}

const bottomView = () => ({
  show: vi.fn(),
  webview: {
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
  },
});

const result = {
  command: "renderQuery" as const,
  columnNames: ["n"],
  columnTypes: ["integer"],
  rows: [{ n: 1 }],
  raw_sql: "select 1",
  compiled_sql: "select 1",
};

describe("query results pages", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers a request on the page that sent it", async () => {
    const panel = Object.create(QueryResultPanel.prototype);
    const bottom = bottomView();
    const tab = resultsTab();
    panel._panel = bottom;
    panel.dbtTerminal = terminal();

    await panel.handleCommand(
      { command: "executeQuery", syncRequestId: "r" },
      tab.value,
    );

    expect(tab.value.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "response",
        args: expect.objectContaining({ status: false }),
      }),
    );
    expect(bottom.webview.postMessage).not.toHaveBeenCalled();
  });

  it("ends a results tab's message subscription with the tab, not the panel", () => {
    const panel = Object.create(QueryResultPanel.prototype);
    const tab = resultsTab();
    panel._panel = tab.value;
    panel._disposables = [];

    panel.setupWebviewHooks();

    expect(panel._disposables).toEqual([]);
    tab.close();
    expect(tab.subscription.dispose).toHaveBeenCalledOnce();
  });

  it("forgets every page's last result when a project is removed", () => {
    const removed = new EventEmitter<Uri>();
    const panel = new QueryResultPanel(
      {} as any,
      { eventEmitter: new EventEmitter<unknown>() } as any,
      terminal() as any,
      {} as any,
      removed.event,
    );
    const bottom = bottomView();
    (panel as any).postTo(bottom, result);
    expect((panel as any).replay.messagesFor("bottom")).toEqual([result]);

    removed.fire(Uri.file("/p"));

    expect((panel as any).replay.messagesFor("bottom")).toEqual([]);
    panel.dispose();
  });
});

describe("query results test command", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    vi.mocked(commands.registerCommand).mockClear();
  });

  it.each([
    [{ FPU_SMOKE_HOST: "vscode" }, true],
    [{ FPU_SMOKE_HOST: "cursor" }, true],
    [{ FPU_INTEGRATION_COMMANDS: "1" }, true],
    [{ FPU_SMOKE_HOST: "" }, false],
    [{ FPU_SMOKE_HOST: "other" }, false],
    [{}, false],
  ])("with %o registers: %s", (env, registered) => {
    delete process.env.FPU_SMOKE_HOST;
    delete process.env.FPU_INTEGRATION_COMMANDS;
    Object.assign(process.env, env);

    const disposable = registerQueryResultTestCommand({} as never);

    expect(disposable !== undefined).toBe(registered);
    expect(
      vi
        .mocked(commands.registerCommand)
        .mock.calls.some(([id]) => id === RENDER_TEST_RESULT_COMMAND),
    ).toBe(registered);
  });
});
