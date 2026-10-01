import {
  documentationEditor,
  queryResults,
} from "@fusion-power-user/webview-contract";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { Uri, window } from "vscode";
import { DocsEditViewPanel } from "../../features/docs/docsEditPanel";
import { QueryResultPanel } from "../../features/queryResults/queryResultPanel";
import { NUM_RUNS } from "../arbitraries";

interface Panel {
  name: string;
  guard: (value: unknown) => boolean;
  commands: readonly string[];
  /** Field names the panel's messages use, so generated values sometimes pass the guard. */
  keys: readonly string[];
  /** Messages with a known command and a missing or mistyped field. */
  malformed: readonly unknown[];
  /** A panel whose handler map is one spy per command, and its log. */
  withSpies: () => {
    send: (message: unknown) => Promise<void>;
    spies: Record<string, ReturnType<typeof vi.fn>>;
    log: { warn: ReturnType<typeof vi.fn> };
  };
}

const terminal = () => ({
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
});

/** An instance of `ctor` with no constructor run, its handler map replaced by spies. */
function spiedPanel(
  ctor: { prototype: object },
  commands: readonly string[],
  logField: string,
) {
  const panel = Object.create(ctor.prototype);
  const log = terminal();
  const spies = Object.fromEntries(commands.map((c) => [c, vi.fn()]));
  panel[logField] = log;
  panel.handlers = () => spies;
  return {
    send: (message: unknown) => panel.handleCommand(message) as Promise<void>,
    spies,
    log,
  };
}

const panels: Panel[] = [
  {
    name: "query results",
    guard: queryResults.isPanelMessage,
    commands: queryResults.panelCommands,
    keys: [
      "text",
      "limit",
      "perspectiveTheme",
      "query",
      "projectName",
      "editorName",
      "queryHistory",
      "code",
      "queryTabData",
      "syncRequestId",
    ],
    malformed: [
      { command: "executeQuery" },
      { command: "executeQuery", query: 1 },
      { command: "error", text: ["boom"] },
      { command: "updateConfig", limit: "10" },
      { command: "executeQueryFromActiveWindow" },
      { command: "viewResultSet", queryHistory: { rawSql: "select 1" } },
      { command: "getQueryTabData", syncRequestId: 7 },
      { command: "queryResultTab:render", queryTabData: [] },
    ],
    withSpies: () =>
      spiedPanel(QueryResultPanel, queryResults.panelCommands, "dbtTerminal"),
  },
  {
    name: "documentation editor",
    guard: documentationEditor.isPanelMessage,
    commands: documentationEditor.panelCommands,
    keys: [
      "infoMessage",
      "items",
      "test",
      "model",
      "path",
      "name",
      "column",
      "source",
      "table",
      "columns",
      "filePath",
      "dialogType",
      "syncRequestId",
    ],
    malformed: [
      { command: "showWarningMessage" },
      { command: "showInformationMessage", infoMessage: "?", items: [1] },
      { command: "getTestCode", model: "orders" },
      { command: "getColumnsOfSources", source: "raw" },
      { command: "getColumnsOfModel", model: "orders", syncRequestId: 7 },
      { command: "saveDocumentation", name: "orders", columns: [] },
      {
        command: "saveDocumentation",
        name: "orders",
        columns: [{ name: "id", source: "FILE" }],
        filePath: "/m.sql",
      },
      {
        command: "saveDocumentation",
        name: "orders",
        columns: [],
        filePath: "/m.sql",
        dialogType: "Other file",
      },
    ],
    withSpies: () =>
      spiedPanel(
        DocsEditViewPanel,
        documentationEditor.panelCommands,
        "terminal",
      ),
  },
];

const messages = (panel: Panel) =>
  fc.oneof(
    fc.jsonValue(),
    fc
      .tuple(
        fc.constantFrom(...panel.commands),
        fc.dictionary(fc.constantFrom(...panel.keys), fc.jsonValue(), {
          maxKeys: 4,
        }),
      )
      .map(([command, rest]) => ({ ...rest, command })),
  );

describe.each(panels)("$name host messages", (panel) => {
  it("drops and logs a malformed message without calling any handler", async () => {
    const { send, spies, log } = panel.withSpies();
    const rejected = [
      ...panel.malformed,
      { command: "notACommand" },
      null,
      "x",
    ];
    for (const message of rejected) {
      expect(panel.guard(message), JSON.stringify(message)).toBe(false);
      await send(message);
    }
    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(log.warn).toHaveBeenCalledTimes(rejected.length);
  });

  it("hands arbitrary JSON to a handler only when it passes the guard", async () => {
    await fc.assert(
      fc.asyncProperty(messages(panel), async (message) => {
        const { send, spies, log } = panel.withSpies();
        await send(message);
        const called = Object.entries(spies).filter(
          ([, spy]) => spy.mock.calls.length > 0,
        );
        if (panel.guard(message)) {
          const { command } = message as { command: string };
          expect(called.map(([c]) => c)).toEqual([command]);
          expect(spies[command]).toHaveBeenCalledWith(message);
          expect(log.warn).not.toHaveBeenCalled();
        } else {
          expect(called).toEqual([]);
          expect(log.warn).toHaveBeenCalledTimes(1);
        }
      }),
      { numRuns: NUM_RUNS * 5 },
    );
  });
});

describe("query results handlers", () => {
  it("clears the session history and answers the request", async () => {
    const panel = Object.create(QueryResultPanel.prototype);
    const postMessage = vi.fn();
    panel._panel = { webview: { postMessage } };
    panel._queryHistory = [{}];
    panel.dbtTerminal = terminal();

    await panel.handleCommand({
      command: "clearQueryHistory",
      syncRequestId: "r",
    });

    expect(panel._queryHistory).toEqual([]);
    expect(postMessage).toHaveBeenCalledWith({
      command: "response",
      args: { syncRequestId: "r", body: {}, status: true },
    });
    for (const [message] of postMessage.mock.calls) {
      expect(queryResults.isHostMessage(message)).toBe(true);
    }
  });

  it("answers a malformed request so the panel's promise settles", async () => {
    const panel = Object.create(QueryResultPanel.prototype);
    const postMessage = vi.fn();
    panel._panel = { webview: { postMessage } };
    panel.dbtTerminal = terminal();

    await panel.handleCommand({
      command: "executeQuery",
      query: 1,
      syncRequestId: "r",
    });
    await panel.handleCommand({ command: "nope", syncRequestId: "s" });

    expect(postMessage.mock.calls.map(([m]) => m)).toEqual(
      ["r", "s"].map((syncRequestId) => ({
        command: "response",
        args: {
          syncRequestId,
          body: undefined,
          status: false,
          error: "Malformed request",
        },
      })),
    );
    expect(queryResults.isHostMessage(postMessage.mock.calls[0][0])).toBe(true);
  });
});

describe("documentation editor handlers", () => {
  it("answers a project request without an active editor with an error response", async () => {
    const panel = Object.create(DocsEditViewPanel.prototype);
    const postMessage = vi.fn();
    panel._panel = { webview: { postMessage } };
    panel.terminal = terminal();

    await panel.handleCommand({
      command: "getColumnsOfModel",
      model: "orders",
      syncRequestId: "r",
    });

    expect(postMessage).toHaveBeenCalledWith({
      command: "response",
      args: {
        syncRequestId: "r",
        body: undefined,
        status: false,
        error: "No active editor",
      },
    });
    expect(
      documentationEditor.isHostMessage(postMessage.mock.calls[0][0]),
    ).toBe(true);
  });

  /** A panel with an active model editor and a project; `post` captures replies. */
  const docsPanel = () => {
    const panel = Object.create(DocsEditViewPanel.prototype);
    const postMessage = vi.fn();
    const project = { projectRoot: { fsPath: "/p" }, getColumnValues: vi.fn() };
    panel._panel = { webview: { postMessage } };
    panel.terminal = terminal();
    panel.projects = { get: () => project };
    panel.dbtTestService = {
      getTestsForCurrentModel: vi.fn(),
      getUnitTestsForCurrentModel: vi.fn(),
    };
    panel.reloadDocumentationFromManifest = vi.fn();
    return { panel, postMessage, project };
  };

  const withEditor = async (run: () => Promise<void>) => {
    const editor = { document: { uri: Uri.file("/p/models/orders.sql") } };
    const mockWindow = window as unknown as Record<string, unknown>;
    const previous = mockWindow.activeTextEditor;
    mockWindow.activeTextEditor = editor;
    mockWindow.showSaveDialog = vi.fn().mockResolvedValue(undefined);
    try {
      await run();
    } finally {
      mockWindow.activeTextEditor = previous;
      delete mockWindow.showSaveDialog;
    }
  };

  it("answers saved: false when the save dialog is cancelled, so the panel stays dirty", async () => {
    const { panel, postMessage } = docsPanel();
    await withEditor(() =>
      panel.handleCommand({
        command: "saveDocumentation",
        name: "orders",
        columns: [],
        filePath: "/p/models/orders.sql",
        patchPath: null,
        dialogType: "New file",
        syncRequestId: "s",
      }),
    );

    expect(panel.reloadDocumentationFromManifest).not.toHaveBeenCalled();
    expect(postMessage.mock.calls.map(([m]) => m)).toEqual([
      {
        command: "response",
        args: { syncRequestId: "s", body: { saved: false }, status: true },
      },
    ]);
  });

  it("answers getDistinctColumnValues without a model with an error", async () => {
    const { panel, postMessage, project } = docsPanel();
    await withEditor(() =>
      panel.handleCommand({
        command: "getDistinctColumnValues",
        model: null,
        column: "id",
        syncRequestId: "d",
      }),
    );

    expect(project.getColumnValues).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({ syncRequestId: "d", status: false }),
      }),
    );
  });

  it("answers a request whose handler throws with the error", async () => {
    const { panel, postMessage } = docsPanel();
    panel.projects = {
      get: () => {
        throw new Error("registry gone");
      },
    };
    await withEditor(() =>
      panel.handleCommand({
        command: "getModelsInProject",
        syncRequestId: "m",
      }),
    );

    expect(postMessage).toHaveBeenCalledWith({
      command: "response",
      args: {
        syncRequestId: "m",
        body: undefined,
        status: false,
        error: "registry gone",
      },
    });
  });
});
