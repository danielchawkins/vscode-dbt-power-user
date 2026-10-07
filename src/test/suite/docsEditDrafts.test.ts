import { documentationEditor } from "@fusion-power-user/webview-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter, Uri } from "vscode";
import { DocsEditViewPanel } from "../../features/docs/docsEditPanel";

vi.mock("../../webview/panelHtml", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../webview/panelHtml")>()),
  panelHtml: () => "<html>docs</html>",
}));

const terminal = { debug: vi.fn(), info: vi.fn(), error: vi.fn() } as any;
const docs = (filePath: string, description: string) => ({
  name: "orders",
  description,
  columns: [],
  filePath,
});

/** A documentation editor whose active model is `/p/models/orders.sql`; `posted` collects host messages. */
function draftPanel() {
  const removed = new EventEmitter<Uri>();
  const projects = {
    onDidChangeManifest: new EventEmitter<unknown>().event,
    onDidRemoveProject: removed.event,
    get: () => undefined,
  } as any;
  const docGenService = {
    getUncompiledDocumentationForCurrentActiveFile: vi.fn(async () => ({
      documentation: docs("/p/models/orders.sql", "saved"),
    })),
  };
  const dbtTestService = {
    getTestsForCurrentModel: vi.fn(async () => []),
    getUnitTestsForCurrentModel: vi.fn(async () => []),
  };
  const panel = new DocsEditViewPanel(
    projects,
    {} as any,
    {
      docGenService,
      dbtTestService,
      queryManifestService: { manifestFor: () => undefined },
      emitterService: { eventEmitter: { event: vi.fn() } },
    } as any,
    terminal,
  );
  const postMessage = vi.fn();
  (panel as any)._panel = { webview: { postMessage } };
  const send = (message: unknown) =>
    (panel as any).handleCommand(message) as Promise<void>;
  const rendered = async () => {
    postMessage.mockClear();
    await send({ command: "getCurrentModelDocumentation" });
    const message = postMessage.mock.calls[0][0];
    expect(documentationEditor.isHostMessage(message)).toBe(true);
    return message;
  };
  return { panel, removed, send, rendered };
}

describe("documentation editor drafts", () => {
  afterEach(() => vi.restoreAllMocks());

  const draft = {
    docs: docs("/p/models/orders.sql", "unsaved edit"),
    tests: [{ key: "not_null_orders_id", column_name: "id" }],
  };

  it("sends a rebuilt page the draft it held for the model", async () => {
    const { send, rendered } = draftPanel();
    expect((await rendered()).draft).toBeUndefined();

    await send({ command: "saveDraft", model: "/p/models/orders.sql", draft });

    const message = await rendered();
    expect(message.docs.description).toBe("saved");
    expect(message.draft).toEqual(draft);
  });

  it("forgets a draft the page clears, after a save, discard or revert", async () => {
    const { send, rendered } = draftPanel();
    await send({ command: "saveDraft", model: "/p/models/orders.sql", draft });

    await send({ command: "saveDraft", model: "/p/models/orders.sql" });

    expect((await rendered()).draft).toBeUndefined();
  });

  it("keeps drafts of other models apart", async () => {
    const { send, rendered } = draftPanel();
    await send({
      command: "saveDraft",
      model: "/p/models/customers.sql",
      draft: { docs: docs("/p/models/customers.sql", "other") },
    });

    expect((await rendered()).draft).toBeUndefined();
  });

  it("forgets the drafts of a removed project only", async () => {
    const { panel, removed, send } = draftPanel();
    vi.spyOn(panel as any, "transmitData").mockResolvedValue(undefined);
    await send({ command: "saveDraft", model: "/p/models/orders.sql", draft });
    await send({
      command: "saveDraft",
      model: "/q/models/orders.sql",
      draft: { docs: docs("/q/models/orders.sql", "kept") },
    });

    removed.fire(Uri.file("/p"));

    const drafts = (panel as any).drafts as Map<string, unknown>;
    expect([...drafts.keys()]).toEqual(["/q/models/orders.sql"]);
  });
});

describe("documentation editor view resolution", () => {
  function resolved() {
    const panel = new DocsEditViewPanel(
      {
        onDidChangeManifest: new EventEmitter<unknown>().event,
        onDidRemoveProject: new EventEmitter<Uri>().event,
        get: () => undefined,
      } as any,
      { extensionUri: Uri.file("/ext") } as any,
      {
        docGenService: {},
        dbtTestService: {},
        queryManifestService: { manifestFor: () => undefined },
        emitterService: { eventEmitter: { event: vi.fn() } },
      } as any,
      terminal,
    );
    const transmit = vi
      .spyOn(panel as any, "transmitData")
      .mockResolvedValue(undefined);
    let onMessage: (message: unknown) => unknown = () => undefined;
    const view = {
      title: "x",
      description: undefined as string | undefined,
      visible: true,
      show: vi.fn(),
      onDidChangeVisibility: vi.fn(),
      onDidDispose: vi.fn(),
      webview: {
        options: {} as any,
        html: "",
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((listener) => {
          onMessage = listener;
          return { dispose: vi.fn() };
        }),
      },
    };
    void panel.resolveWebviewView(view as any, {} as any, {} as any);
    return { panel, view, transmit, send: (m: unknown) => onMessage(m) };
  }

  it("sets scripts on and limits local resources to the built assets", () => {
    const { view } = resolved();
    expect(view.webview.options.enableScripts).toBe(true);
    expect(
      view.webview.options.localResourceRoots.map((u: Uri) => u.path),
    ).toEqual(["/ext/webview_panels/dist/assets"]);
  });

  it("titles the view, describes it and renders the page", () => {
    const { view } = resolved();
    expect(view.title).toBe("");
    expect(view.description).toBe("Edit model documentation");
    expect(view.webview.html).toBe("<html>docs</html>");
  });

  it("sends the documentation when the view resolves", () => {
    expect(resolved().transmit).toHaveBeenCalledTimes(1);
  });

  it("marks the page ready on webview:ready and replays on request", async () => {
    const { panel, send, transmit } = resolved();
    expect((panel as any).isWebviewReady).toBe(false);
    await send({ command: "webview:ready" });
    expect((panel as any).isWebviewReady).toBe(true);

    transmit.mockClear();
    await send({ command: "getCurrentModelDocumentation" });
    expect(transmit).toHaveBeenCalledTimes(1);
  });
});
