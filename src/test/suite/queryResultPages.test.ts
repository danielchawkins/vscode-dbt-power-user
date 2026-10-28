import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, EventEmitter, Uri } from "vscode";
import { QueryResultPanel } from "../../features/queryResults/queryResultPanel";
import {
  registerQueryResultTestCommand,
  RENDER_TEST_RESULT_COMMAND,
} from "../../features/queryResults/queryResultTestCommand";
import type * as panelHtmlModule from "../../webview/panelHtml";
import { fakeTab, fakeView, listenTo } from "../panelHarness";
import { spyLog } from "../testLog";

vi.mock("../../webview/panelHtml", async (importOriginal) => ({
  ...(await importOriginal<typeof panelHtmlModule>()),
  panelHtml: () => "<html>query results</html>",
}));

/** A panel built as the extension builds it; the removal event is the one a test fires. */
function realPanel(removed = new EventEmitter<Uri>()) {
  return new QueryResultPanel({
    extensionContext: { extensionUri: Uri.file("/ext") } as any,
    eventEmitterService: { eventEmitter: new EventEmitter<unknown>() } as any,
    log: spyLog(),
    queryManifestService: {} as any,
    currentProject: {} as any,
    onDidRemoveProject: removed.event,
  });
}

const token = () => ({ onCancellationRequested: vi.fn() }) as never;

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
    const panel = realPanel();
    const bottom = fakeView();
    const tab = fakeTab();
    await panel.resolveWebviewView(bottom.page, {} as never, token());
    listenTo(panel, tab.page);

    await tab.send({ command: "executeQuery", syncRequestId: "r" });

    expect(tab.posted()).toContainEqual(
      expect.objectContaining({
        command: "response",
        args: expect.objectContaining({ status: false }),
      }),
    );
    expect(bottom.posted()).toEqual([]);
  });

  it("ends a results tab's message subscription with the tab, not the panel", () => {
    const panel = realPanel();
    const tab = fakeTab();
    const panelDisposables = (panel as any)._disposables.length;

    listenTo(panel, tab.page);

    expect((panel as any)._disposables).toHaveLength(panelDisposables);
    tab.close();
    expect(tab.messageSubscription.dispose).toHaveBeenCalledOnce();
  });

  it("answers a tab's tab-data request on the tab, and again with the same data", async () => {
    const panel = realPanel();
    const bottom = fakeView();
    const tab = fakeTab();
    await panel.resolveWebviewView(bottom.page, {} as never, token());
    listenTo(panel, tab.page);
    const data = { n: 1 };
    (panel as any)._queryTabData = data;

    await tab.send({ command: "getQueryTabData", syncRequestId: "t1" });
    await tab.send({ command: "getQueryTabData", syncRequestId: "t2" });

    expect(tab.posted()).toEqual([
      {
        command: "response",
        args: { syncRequestId: "t1", body: data, status: true },
      },
      {
        command: "response",
        args: { syncRequestId: "t2", body: data, status: true },
      },
    ]);
    expect(bottom.posted()).toEqual([]);
    panel.dispose();
  });

  it("forgets every tab's data when a project is removed", async () => {
    const removed = new EventEmitter<Uri>();
    const panel = realPanel(removed);
    const tab = fakeTab();
    listenTo(panel, tab.page);
    (panel as any)._queryTabData = { n: 1 };
    await tab.send({ command: "getQueryTabData", syncRequestId: "t1" });
    expect((panel as any).tabDataByPage.size).toBe(1);

    removed.fire(Uri.file("/p"));
    expect((panel as any).tabDataByPage.size).toBe(0);
    panel.dispose();
  });

  it("forgets every page's last result when a project is removed", () => {
    const removed = new EventEmitter<Uri>();
    const panel = realPanel(removed);
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
