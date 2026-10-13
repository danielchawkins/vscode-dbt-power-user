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
    lintEnabled: false,
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
