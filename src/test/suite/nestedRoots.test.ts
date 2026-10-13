import { afterEach, describe, expect, it, vi } from "vitest";
import { type TextDocument, Uri } from "vscode";
import type { FileEvent, Middleware } from "vscode-languageclient/node";
import { URI as VsCodeUri } from "vscode-uri";
import {
  guardMiddleware,
  NestedRootGuard,
  OpenDocuments,
} from "../../fusion/nestedRoots";

const outer = Uri.file("/workspace/outer");
const inner = Uri.file("/workspace/outer/inner");
const outerModel = Uri.file("/workspace/outer/models/outer_model.sql");
const innerModel = Uri.file("/workspace/outer/inner/models/inner_model.sql");

const PROVIDER_NAMES = [
  "prepareCallHierarchy",
  "prepareRename",
  "prepareTypeHierarchy",
  "provideCodeActions",
  "provideCodeLenses",
  "provideCompletionItem",
  "provideDeclaration",
  "provideDefinition",
  "provideDiagnostics",
  "provideDocumentColors",
  "provideDocumentFormattingEdits",
  "provideDocumentHighlights",
  "provideDocumentLinks",
  "provideDocumentRangeFormattingEdits",
  "provideDocumentRangeSemanticTokens",
  "provideDocumentRangesFormattingEdits",
  "provideDocumentSemanticTokens",
  "provideDocumentSemanticTokensEdits",
  "provideDocumentSymbols",
  "provideFoldingRanges",
  "provideHover",
  "provideImplementation",
  "provideInlayHints",
  "provideInlineCompletionItems",
  "provideInlineValues",
  "provideLinkedEditingRange",
  "provideOnTypeFormattingEdits",
  "provideReferences",
  "provideRenameEdits",
  "provideSelectionRanges",
  "provideSignatureHelp",
  "provideTypeDefinition",
] as const;

const SYNC_NAMES = [
  "didOpen",
  "didChange",
  "willSave",
  "willSaveWaitUntil",
  "didSave",
  "didClose",
] as const;

type Callable = (...args: unknown[]) => unknown;

const guardFor = (roots: readonly Uri[] = [outer, inner]) =>
  new NestedRootGuard(outer, () => roots);

const documentAt = (uri: Uri) => ({ uri }) as unknown as TextDocument;

const hookOf = (middleware: Middleware, name: string): Callable =>
  (middleware as unknown as Record<string, Callable>)[name];

const fileEventAt = (fsPath: string) => ({
  uri: `file://${fsPath}`,
  type: 2 as FileEvent["type"],
});

afterEach(() => {
  vi.mocked(Uri.parse).mockReset();
});

describe("NestedRootGuard", () => {
  it("excludes a file under a root declared strictly below the outer root", () => {
    const guard = guardFor();
    expect(guard.excludes(innerModel)).toBe(true);
    expect(guard.excludes(outerModel)).toBe(false);
  });

  it("does not exclude the outer root itself or a root above it", () => {
    const guard = new NestedRootGuard(inner, () => [outer, inner]);
    expect(guard.excludes(innerModel)).toBe(false);
    expect(
      new NestedRootGuard(outer, () => [outer, inner]).excludes(outerModel),
    ).toBe(false);
  });

  it("matches by path segments, so a sibling sharing a prefix is not excluded", () => {
    const sibling = Uri.file("/workspace/outer/inner_extra/a.sql");
    expect(guardFor().excludes(sibling)).toBe(false);
  });

  it("excludes is false for non-file URIs", () => {
    const guard = guardFor();
    for (const value of [
      "untitled:/workspace/outer/inner/scratch.sql",
      "git:/workspace/outer/inner/models/inner_model.sql",
      "vscode-notebook-cell:/workspace/outer/inner/nb.ipynb#W0sZmlsZQ%3D%3D",
    ]) {
      expect(guard.excludes(VsCodeUri.parse(value))).toBe(false);
    }
  });

  it("reads the roots on each call, so a root declared later applies at once", () => {
    const roots: Uri[] = [outer];
    const guard = new NestedRootGuard(outer, () => roots);
    expect(guard.excludes(innerModel)).toBe(false);
    roots.push(inner);
    expect(guard.excludes(innerModel)).toBe(true);
  });
});

describe("guardMiddleware sync hooks", () => {
  it.each(SYNC_NAMES)(
    "%s skips next for an excluded document and forwards others",
    async (name) => {
      const middleware = guardMiddleware(guardFor(), {});
      const next = vi.fn();
      const hook = hookOf(middleware, name);

      await hook(documentAt(innerModel), next);
      expect(next).not.toHaveBeenCalled();

      await hook(documentAt(outerModel), next);
      expect(next).toHaveBeenCalledTimes(1);
    },
  );

  it("unwraps a change or save event to its document", async () => {
    const middleware = guardMiddleware(guardFor(), {});
    const next = vi.fn();
    await hookOf(middleware, "didChange")(
      { document: documentAt(innerModel) },
      next,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("calls the inner sync hook instead of next, and skips it when excluded", async () => {
    const innerHook = vi.fn(() => Promise.resolve("inner"));
    const middleware = guardMiddleware(guardFor(), {
      didSave: innerHook as never,
    });
    const next = vi.fn();
    expect(
      await hookOf(middleware, "didSave")(documentAt(outerModel), next),
    ).toBe("inner");
    expect(next).not.toHaveBeenCalled();
    await hookOf(middleware, "didSave")(documentAt(innerModel), next);
    expect(innerHook).toHaveBeenCalledTimes(1);
  });
});

describe("guardMiddleware provider hooks", () => {
  it.each(PROVIDER_NAMES)(
    "%s returns undefined for an excluded document and calls next otherwise",
    async (name) => {
      const middleware = guardMiddleware(guardFor(), {});
      const next = vi.fn(() => "outer");
      const hook = hookOf(middleware, name);

      expect(await hook(documentAt(innerModel), {}, next)).toBeUndefined();
      expect(next).not.toHaveBeenCalled();

      expect(await hook(documentAt(outerModel), {}, next)).toBe("outer");
      expect(next).toHaveBeenCalledWith(documentAt(outerModel), {});
    },
  );

  it("passes the arguments to the inner provider hook for a document it keeps", () => {
    const provide = vi.fn(() => "inner");
    const middleware = guardMiddleware(guardFor(), {
      provideHover: provide as never,
    });
    const next = vi.fn();
    expect(
      hookOf(middleware, "provideHover")(documentAt(outerModel), {}, next),
    ).toBe("inner");
    expect(provide).toHaveBeenCalledWith(documentAt(outerModel), {}, next);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("guardMiddleware diagnostics and watched files", () => {
  it("drops diagnostics for an excluded URI before the inner handler", () => {
    const innerHandler = vi.fn();
    const middleware = guardMiddleware(guardFor(), {
      handleDiagnostics: innerHandler as never,
    });
    const next = vi.fn();
    const handle = middleware.handleDiagnostics!;
    handle(innerModel, [], next);
    expect(innerHandler).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();

    handle(outerModel, [], next);
    expect(innerHandler).toHaveBeenCalledTimes(1);
  });

  it("a didChangeWatchedFile event under a nested root is not passed to next", async () => {
    vi.mocked(Uri.parse).mockImplementation((value: string) =>
      VsCodeUri.parse(value),
    );
    const middleware = guardMiddleware(guardFor(), {});
    const watched = middleware.workspace!.didChangeWatchedFile!;
    const next = vi.fn(() => Promise.resolve());

    await watched(fileEventAt(innerModel.fsPath), next);
    expect(next).not.toHaveBeenCalled();

    await watched(fileEventAt(outerModel.fsPath), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("a batch with one outer and one nested event passes only the outer event", async () => {
    vi.mocked(Uri.parse).mockImplementation((value: string) =>
      VsCodeUri.parse(value),
    );
    const middleware = guardMiddleware(guardFor(), {});
    const watched = middleware.workspace!.didChangeWatchedFile!;
    const next = vi.fn(() => Promise.resolve());
    const outerEvent = fileEventAt(outerModel.fsPath);
    const nestedEvent = fileEventAt(innerModel.fsPath);

    await watched(outerEvent, next);
    await watched(nestedEvent, next);
    expect(next.mock.calls).toEqual([[outerEvent]]);
  });
});

describe("OpenDocuments and releaseNewlyExcluded", () => {
  it("tracks a document from didOpen to didClose, and skips excluded ones", async () => {
    const open = new OpenDocuments();
    const middleware = guardMiddleware(guardFor(), {}, open);
    const next = vi.fn();
    await hookOf(middleware, "didOpen")(documentAt(outerModel), next);
    await hookOf(middleware, "didOpen")(documentAt(innerModel), next);
    expect(open.uris).toEqual([outerModel]);

    await hookOf(middleware, "didClose")(documentAt(outerModel), next);
    expect(open.uris).toEqual([]);
  });
});
