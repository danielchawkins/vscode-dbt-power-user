import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter, Uri } from "vscode";
import { ColumnProposalRequests } from "../../features/docs/columnProposals";
import { DocsEditViewPanel } from "../../features/docs/docsEditPanel";
import type * as panelHtmlModule from "../../webview/panelHtml";
import { fakeView } from "../panelHarness";
import { isDocumentationEditorHostMessage } from "./hostMessageOracle";

vi.mock("../../webview/panelHtml", async (importOriginal) => ({
  ...(await importOriginal<typeof panelHtmlModule>()),
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
async function draftPanel() {
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
  const panel = new DocsEditViewPanel({
    projects,
    extensionContext: { extensionUri: Uri.file("/ext") } as any,
    services: {
      docGenService,
      dbtTestService,
      queryManifestService: { manifestFor: () => undefined },
      emitterService: { eventEmitter: { event: vi.fn() } },
      columnProposalRequests: new ColumnProposalRequests(),
    } as any,
    terminal,
  });
  const view = fakeView();
  await panel.resolveWebviewView(view.page, {} as any, {} as any);
  const { send } = view;
  const rendered = async () => {
    await send({ command: "getCurrentModelDocumentation" });
    const message = view.posted().at(-1) as any;
    expect(isDocumentationEditorHostMessage(message)).toBe(true);
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
    const { send, rendered } = await draftPanel();
    expect((await rendered()).draft).toBeUndefined();

    await send({ command: "saveDraft", model: "/p/models/orders.sql", draft });

    const message = await rendered();
    expect(message.docs.description).toBe("saved");
    expect(message.draft).toEqual(draft);
  });

  it("keeps a column's replaceType in the draft unchanged", async () => {
    const { send, rendered } = await draftPanel();
    const replacing = {
      docs: {
        ...docs("/p/models/orders.sql", "unsaved edit"),
        columns: [{ name: "id", type: "integer", replaceType: true }],
      },
    };

    await send({
      command: "saveDraft",
      model: "/p/models/orders.sql",
      draft: replacing,
    });

    expect((await rendered()).draft).toEqual(replacing);
  });

  it("forgets the drafts of a removed project only", async () => {
    const { panel, removed, send } = await draftPanel();
    vi.spyOn(panel as any, "transmitData").mockResolvedValue(undefined);
    await send({ command: "saveDraft", model: "/p/models/orders.sql", draft });
    await send({
      command: "saveDraft",
      model: "/q/models/orders.sql",
      draft: { docs: docs("/q/models/orders.sql", "kept") },
    });

    removed.fire(Uri.file("/p"));

    expect((panel as any).drafts.held()).toEqual(["/q/models/orders.sql"]);
  });
});

describe("documentation editor view resolution", () => {
  async function resolved() {
    const panel = new DocsEditViewPanel({
      projects: {
        onDidChangeManifest: new EventEmitter<unknown>().event,
        onDidRemoveProject: new EventEmitter<Uri>().event,
        get: () => undefined,
      } as any,
      extensionContext: { extensionUri: Uri.file("/ext") } as any,
      services: {
        docGenService: {},
        dbtTestService: {},
        queryManifestService: { manifestFor: () => undefined },
        emitterService: { eventEmitter: { event: vi.fn() } },
        columnProposalRequests: new ColumnProposalRequests(),
      } as any,
      terminal,
    });
    const transmit = vi
      .spyOn(panel as any, "transmitData")
      .mockResolvedValue(undefined);
    const view = fakeView();
    await panel.resolveWebviewView(view.page, {} as any, {} as any);
    return { panel, view: view.page, transmit, send: view.send };
  }

  it("titles the view, describes it and renders the page", async () => {
    const { view } = await resolved();
    expect(view.title).toBe("");
    expect(view.description).toBe("Edit model documentation");
    expect(view.webview.html).toBe("<html>docs</html>");
  });

  it("sends the documentation when the view resolves", async () => {
    expect((await resolved()).transmit).toHaveBeenCalledTimes(1);
  });
});
