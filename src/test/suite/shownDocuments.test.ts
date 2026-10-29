import { describe, expect, it, vi } from "vitest";
import { type TextDocument, Uri } from "vscode";
import type { Middleware } from "vscode-languageclient/node";
import { ShownDocuments } from "../../fusion/shownDocuments";

const documentAt = (path: string) =>
  ({ uri: Uri.file(path) }) as unknown as TextDocument;

/** A gate whose shown set the test controls, and a way to fire the workbench's change event. */
function gate(shown: string[] = []) {
  let fire = () => {};
  const documents = new ShownDocuments({
    isShown: (uri) => shown.includes(uri.fsPath),
    onDidChangeShown: (listener) => {
      fire = listener;
      return { dispose: vi.fn() };
    },
  });
  const middleware = documents.wrap({}) as Required<
    Pick<Middleware, "didOpen" | "didChange" | "didSave" | "didClose">
  >;
  return {
    documents,
    middleware,
    shown,
    changed: async () => {
      fire();
      await Promise.resolve();
    },
  };
}

describe("ShownDocuments", () => {
  it("opens a client's first document even when no editor shows it", async () => {
    const { middleware } = gate();
    const next = vi.fn();
    await middleware.didOpen(documentAt("/p/models/a.sql"), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("holds the open of a later document no editor shows, and opens a shown one", async () => {
    const { documents, middleware } = gate(["/p/models/shown.sql"]);
    await middleware.didOpen(documentAt("/p/models/first.sql"), vi.fn());
    const background = vi.fn();
    const shown = vi.fn();
    await middleware.didOpen(documentAt("/p/models/edited.sql"), background);
    await middleware.didOpen(documentAt("/p/models/shown.sql"), shown);
    expect(background).not.toHaveBeenCalled();
    expect(shown).toHaveBeenCalledTimes(1);
    expect(documents.heldDocuments.map((uri) => uri.fsPath)).toEqual([
      "/p/models/edited.sql",
    ]);
  });

  it("opens a held document once an editor shows it", async () => {
    const { middleware, shown, changed } = gate();
    await middleware.didOpen(documentAt("/p/models/first.sql"), vi.fn());
    const next = vi.fn();
    await middleware.didOpen(documentAt("/p/models/later.sql"), next);
    shown.push("/p/models/later.sql");
    await changed();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("sends change, save and close only for documents the server opened", async () => {
    const { middleware } = gate();
    const opened = documentAt("/p/models/first.sql");
    const held = documentAt("/p/models/held.sql");
    await middleware.didOpen(opened, vi.fn());
    await middleware.didOpen(held, vi.fn());
    const sent = vi.fn();
    for (const document of [opened, held]) {
      await middleware.didChange(
        { document, contentChanges: [], reason: undefined },
        sent,
      );
      await middleware.didSave(document, sent);
      await middleware.didClose(document, sent);
    }
    expect(sent).toHaveBeenCalledTimes(3);
  });

  it("drops a held document that closes, so a later show does not open it", async () => {
    const { documents, middleware, shown, changed } = gate();
    await middleware.didOpen(documentAt("/p/models/first.sql"), vi.fn());
    const next = vi.fn();
    const held = documentAt("/p/models/held.sql");
    await middleware.didOpen(held, next);
    await middleware.didClose(held, vi.fn());
    shown.push("/p/models/held.sql");
    await changed();
    expect(next).not.toHaveBeenCalled();
    expect(documents.heldDocuments).toEqual([]);
  });

  it("starts over after clear: the next server's first document opens", async () => {
    const { documents, middleware } = gate();
    await middleware.didOpen(documentAt("/p/models/first.sql"), vi.fn());
    documents.clear();
    const next = vi.fn();
    await middleware.didOpen(documentAt("/p/models/edited.sql"), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("runs the wrapped middleware's own hooks", async () => {
    const inner = vi.fn(
      async (
        document: TextDocument,
        next: (data: TextDocument) => Promise<void>,
      ) => next(document),
    );
    const documents = new ShownDocuments({
      isShown: () => true,
      onDidChangeShown: () => ({ dispose: vi.fn() }),
    });
    const next = vi.fn();
    await documents.wrap({ didOpen: inner }).didOpen!(
      documentAt("/p/models/a.sql"),
      next,
    );
    expect(inner).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
