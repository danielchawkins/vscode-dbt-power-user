import { describe, expect, it, vi } from "vitest";
import type { TextDocument } from "vscode";
import { Uri } from "vscode";
import type { Middleware } from "vscode-languageclient/node";
import { ProjectDiagnosticsFilter } from "../../fusion/fusionDiagnostics";
import { languageClientOptions } from "../../fusion/lspClientSupport";
import { NestedRootGuard, OpenDocuments } from "../../fusion/nestedRoots";
import { createMockLogOutputChannel } from "../mock/vscode";
import { declaredProject } from "../projectHarness";

const outerRoot = "/workspace/outer";
const innerRoot = "/workspace/outer/inner";
const outerModel = Uri.file("/workspace/outer/models/outer_model.sql");
const innerModel = Uri.file("/workspace/outer/inner/models/inner_model.sql");

const folder = { uri: Uri.file(outerRoot), name: "outer", index: 0 };

function setup() {
  const filter = new ProjectDiagnosticsFilter([outerRoot], () => true);
  const shouldForward = vi.spyOn(filter, "shouldForward");
  const openDocuments = new OpenDocuments();
  const options = languageClientOptions({
    project: declaredProject("outer", outerRoot, folder),
    selector: undefined,
    uriConverters: undefined,
    outputChannel: createMockLogOutputChannel("outer"),
    diagnosticsFilter: filter,
    config: { lintEnabled: false, maxErrorReporting: undefined },
    nestedRoots: {
      guard: new NestedRootGuard(Uri.file(outerRoot), () => [
        Uri.file(innerRoot),
      ]),
      openDocuments,
    },
  });
  const middleware = options.middleware as Middleware;
  return { middleware, shouldForward, openDocuments };
}

const documentAt = (uri: Uri) => ({ uri }) as unknown as TextDocument;

describe("languageClientOptions nested-root guard", () => {
  it("does not forward didOpen for a document under a nested root", async () => {
    const { middleware, openDocuments } = setup();
    const next = vi.fn();

    await middleware.didOpen?.(documentAt(innerModel), next);

    expect(next).not.toHaveBeenCalled();
    expect(openDocuments.uris).toEqual([]);
  });

  it("forwards didOpen for an outer document and tracks it as open", async () => {
    const { middleware, openDocuments } = setup();
    const next = vi.fn();

    await middleware.didOpen?.(documentAt(outerModel), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(openDocuments.uris).toEqual([outerModel]);
  });

  it("still runs the existing code-lens middleware for an outer document", async () => {
    const { middleware } = setup();
    const lens = { range: {}, command: undefined };
    const next = vi.fn().mockResolvedValue([lens]);
    const token = {} as never;

    const lenses = await middleware.provideCodeLenses?.(
      documentAt(outerModel),
      token,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(lenses).toEqual([lens]);
  });

  it("returns no code lenses for a document under a nested root", async () => {
    const { middleware } = setup();
    const next = vi.fn().mockResolvedValue([{ range: {} }]);

    const lenses = await middleware.provideCodeLenses?.(
      documentAt(innerModel),
      {} as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(lenses).toBeUndefined();
  });

  it("drops diagnostics for a nested-root URI before the filter sees them", () => {
    const { middleware, shouldForward } = setup();
    const next = vi.fn();

    middleware.handleDiagnostics?.(innerModel, [], next);

    expect(shouldForward).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("passes outer-root diagnostics through the existing filter", () => {
    const { middleware, shouldForward } = setup();
    const next = vi.fn();

    middleware.handleDiagnostics?.(outerModel, [], next);

    expect(shouldForward).toHaveBeenCalledWith(outerModel);
    expect(next).toHaveBeenCalledWith(outerModel, []);
  });
});

describe("languageClientOptions inactive gate", () => {
  function inactiveSetup(isInactive: () => boolean) {
    const outputChannel = createMockLogOutputChannel("outer");
    const options = languageClientOptions({
      project: declaredProject("outer", outerRoot, folder),
      selector: undefined,
      uriConverters: undefined,
      outputChannel,
      diagnosticsFilter: new ProjectDiagnosticsFilter([outerRoot], () => true),
      config: { lintEnabled: false, maxErrorReporting: undefined },
      isInactive,
    });
    return { middleware: options.middleware as Middleware, outputChannel };
  }

  it("skips next for document and watched-file notifications while the client is inactive", async () => {
    const { middleware } = inactiveSetup(() => true);
    const next = vi.fn();
    const change = {} as never;

    await middleware.didOpen?.(documentAt(outerModel), next);
    await middleware.didChange?.(change, next);
    await middleware.didSave?.(documentAt(outerModel), next);
    await middleware.didClose?.(documentAt(outerModel), next);
    await middleware.workspace?.didChangeWatchedFile?.(change, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("logs one debug line for a burst of dropped notifications", async () => {
    const { middleware, outputChannel } = inactiveSetup(() => true);
    const next = vi.fn();
    const change = {} as never;

    await middleware.didOpen?.(documentAt(outerModel), next);
    await middleware.workspace?.didChangeWatchedFile?.(change, next);
    await middleware.didClose?.(documentAt(outerModel), next);

    expect(outputChannel.debug).toHaveBeenCalledTimes(1);
    expect(outputChannel.debug).toHaveBeenCalledWith(
      "Dropped textDocument/didOpen and later notifications: the client is stopping or stopped",
    );
  });

  it("forwards notifications and logs nothing while the client is active", async () => {
    const { middleware, outputChannel } = inactiveSetup(() => false);
    const next = vi.fn();

    await middleware.didOpen?.(documentAt(outerModel), next);
    await middleware.workspace?.didChangeWatchedFile?.({} as never, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(outputChannel.debug).not.toHaveBeenCalled();
  });
});
