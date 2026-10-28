import {
  documentationEditor,
  lineage,
  queryResults,
} from "@fusion-power-user/webview-contract";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { Uri, window } from "vscode";
import type * as panelHtmlModule from "../../webview/panelHtml";
import { NUM_RUNS } from "../arbitraries";
import {
  docsEditPanel,
  fakeView,
  lineagePanel,
  listenTo,
  queryResultPanel,
} from "../panelHarness";
import { spyLog } from "../testLog";
import {
  isDocumentationEditorHostMessage,
  isQueryResultsHostMessage,
} from "./hostMessageOracle";

vi.mock("../../webview/panelHtml", async (importOriginal) => ({
  ...(await importOriginal<typeof panelHtmlModule>()),
  panelHtml: () => "<html>docs</html>",
}));

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
    send: (message: unknown) => Promise<unknown>;
    spies: Record<string, ReturnType<typeof vi.fn>>;
    log: { warn: ReturnType<typeof vi.fn> };
  };
}

/** A panel built by `make` with its handler map replaced by spies; messages reach it through a fake view. */
function spiedPanel(
  make: (log: ReturnType<typeof spyLog>) => object,
  commands: readonly string[],
) {
  const log = spyLog();
  const panel = make(log) as { handlers: () => unknown };
  const spies = Object.fromEntries(commands.map((c) => [c, vi.fn()]));
  panel.handlers = () => spies;
  const view = fakeView();
  listenTo(panel, view.page);
  return { send: view.send, spies, log };
}

const panels: Panel[] = [
  {
    name: "query results",
    guard: queryResults.isPanelMessage,
    commands: queryResults.panelCommands,
    keys: [
      "text",
      "limit",
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
      spiedPanel((log) => queryResultPanel(log), queryResults.panelCommands),
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
        columns: [{ name: "id", replaceType: "yes" }],
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
        (log) => docsEditPanel(log),
        documentationEditor.panelCommands,
      ),
  },
  {
    name: "lineage",
    guard: lineage.isPanelMessage,
    commands: lineage.panelCommands,
    keys: ["table", "name", "url", "message", "refresh", "targets"],
    malformed: [
      { command: "openFile" },
      { command: "openFile", args: { params: {} } },
      { command: "childTables", args: { params: { table: 1 } } },
      { command: "getColumns", args: { params: { table: "t", refresh: 1 } } },
      {
        command: "getConnectedColumns",
        args: { params: { targets: [["model.a"]], upstreamExpansion: true } },
      },
      {
        command: "getConnectedColumns",
        args: {
          params: {
            targets: [],
            upstreamExpansion: "yes",
          },
        },
      },
      {
        command: "persistLineageSettings",
        args: { params: { showSelectEdges: "yes" } },
      },
      { command: "init", args: { params: 1 } },
    ],
    withSpies: () =>
      spiedPanel((log) => lineagePanel(log), lineage.panelCommands),
  },
];

const messages = (panel: Panel) => {
  const fields = fc.dictionary(fc.constantFrom(...panel.keys), fc.jsonValue(), {
    maxKeys: 4,
  });
  const command = fc.constantFrom(...panel.commands);
  return fc.oneof(
    fc.jsonValue(),
    fc.tuple(command, fields).map(([c, rest]) => ({ ...rest, command: c })),
    fc
      .tuple(command, fields, fc.option(fc.string(), { nil: undefined }))
      .map(([c, params, syncRequestId]) => ({
        command: c,
        args: { params },
        ...(syncRequestId === undefined ? {} : { syncRequestId }),
      })),
  );
};

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
    let accepted = 0;
    await fc.assert(
      fc.asyncProperty(messages(panel), async (message) => {
        const { send, spies, log } = panel.withSpies();
        await send(message);
        const called = Object.entries(spies).filter(
          ([, spy]) => spy.mock.calls.length > 0,
        );
        if (panel.guard(message)) {
          accepted++;
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
    // Both branches must be exercised for the property to mean anything.
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(NUM_RUNS * 5);
  });
});

describe("query results handlers", () => {
  it("answers a malformed request so the panel's promise settles", async () => {
    const panel = queryResultPanel();
    const view = fakeView();
    listenTo(panel, view.page);

    await view.send({
      command: "executeQuery",
      query: 1,
      syncRequestId: "r",
    });
    await view.send({ command: "nope", syncRequestId: "s" });

    expect(view.posted()).toEqual(
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
    expect(isQueryResultsHostMessage(view.posted()[0])).toBe(true);
  });
});

describe("documentation editor handlers", () => {
  /** A documentation editor resolved into a fake view, as VS Code resolves it, and reporting ready as its page does. */
  async function resolvedDocs(panel = docsEditPanel()) {
    const view = fakeView();
    await panel.resolveWebviewView(view.page, {} as never, {} as never);
    await view.send({ command: "webview:ready" });
    return { panel, view };
  }

  it("answers a project request without an active editor with an error response", async () => {
    const { view } = await resolvedDocs();

    await view.send({
      command: "getColumnsOfModel",
      model: "orders",
      syncRequestId: "r",
    });

    expect(view.posted()).toContainEqual({
      command: "response",
      args: {
        syncRequestId: "r",
        body: undefined,
        status: false,
        error: "No active editor",
      },
    });
    expect(isDocumentationEditorHostMessage(view.posted()[0])).toBe(true);
  });

  /** A panel with an active model editor and a project; the view's posts are the replies. */
  const docsPanel = async () => {
    const { panel, view } = await resolvedDocs();
    const project = {
      root: { fsPath: "/p" },
      getProjectName: () => "p",
      getColumnValues: vi.fn(),
    };
    const reloadDocumentationFromManifest = vi.fn();
    Object.assign(panel, {
      projects: { get: () => project },
      dbtTestService: {
        getTestsForCurrentModel: vi.fn(),
        getUnitTestsForCurrentModel: vi.fn(),
      },
      reloadDocumentationFromManifest,
    });
    return { panel, view, project, reloadDocumentationFromManifest };
  };

  const withEditor = async (run: () => Promise<unknown>) => {
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
    const { view, reloadDocumentationFromManifest } = await docsPanel();
    const rendered = view.posted().length;
    await withEditor(() =>
      view.send({
        command: "saveDocumentation",
        name: "orders",
        columns: [],
        filePath: "/p/models/orders.sql",
        patchPath: null,
        dialogType: "New file",
        syncRequestId: "s",
      }),
    );

    expect(reloadDocumentationFromManifest).not.toHaveBeenCalled();
    // Only what the save posted: resolving the page posts its first render before the save.
    expect(view.posted().slice(rendered)).toEqual([
      {
        command: "response",
        args: { syncRequestId: "s", body: { saved: false }, status: true },
      },
    ]);
  });

  it("answers getDistinctColumnValues without a model with an error", async () => {
    const { view, project } = await docsPanel();
    await withEditor(() =>
      view.send({
        command: "getDistinctColumnValues",
        model: null,
        column: "id",
        syncRequestId: "d",
      }),
    );

    expect(project.getColumnValues).not.toHaveBeenCalled();
    expect(view.posted()).toContainEqual(
      expect.objectContaining({
        args: expect.objectContaining({ syncRequestId: "d", status: false }),
      }),
    );
  });

  it("answers a request whose handler throws with the error", async () => {
    const { panel, view } = await docsPanel();
    Object.assign(panel, {
      projects: {
        get: () => {
          throw new Error("registry gone");
        },
      },
    });
    await withEditor(() =>
      view.send({
        command: "getModelsInProject",
        syncRequestId: "m",
      }),
    );

    expect(view.posted()).toContainEqual({
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
