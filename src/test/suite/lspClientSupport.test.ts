import { describe, expect, it, vi } from "vitest";
import { CodeLens, Position, Range, type TextDocument, Uri } from "vscode";
import type { Middleware } from "vscode-languageclient/node";
import { URI as VsCodeUri } from "vscode-uri";
import { ProjectDiagnosticsFilter } from "../../fusion/fusionDiagnostics";
import {
  buildWorkspaceConfigurationResponse,
  languageClientOptions,
  mapCteLenses,
} from "../../fusion/lspClientSupport";
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
    targetPath: "/workspace/outer/target",
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
      targetPath: "/workspace/outer/target",
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
    vi.mocked(Uri.parse).mockImplementation((value: string) =>
      VsCodeUri.parse(value),
    );
    const { middleware, outputChannel } = inactiveSetup(() => false);
    const next = vi.fn();
    const watched = {
      uri: "file:///workspace/outer/models/outer_model.sql",
      type: 2,
    };

    await middleware.didOpen?.(documentAt(outerModel), next);
    await middleware.workspace?.didChangeWatchedFile?.(watched as never, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(outputChannel.debug).not.toHaveBeenCalled();
  });
});

describe("fusionLanguageClient helpers", () => {
  it("builds workspace/configuration response for dbt section with linter", () => {
    expect(buildWorkspaceConfigurationResponse("dbt", true)).toEqual({
      lsp: { linter: { enabled: true } },
    });
    expect(buildWorkspaceConfigurationResponse("dbt", false)).toEqual({
      lsp: { linter: { enabled: false } },
    });
  });

  it("adds maxErrorReporting to the dbt section only when it is set", () => {
    expect(buildWorkspaceConfigurationResponse("dbt", true, 250)).toEqual({
      lsp: { linter: { enabled: true }, maxErrorReporting: 250 },
    });
    expect(
      buildWorkspaceConfigurationResponse("dbt", true, undefined),
    ).not.toHaveProperty("lsp.maxErrorReporting");
    expect(buildWorkspaceConfigurationResponse("python", true, 250)).toBeNull();
  });

  it("returns null for non-dbt sections", () => {
    expect(buildWorkspaceConfigurationResponse("python", true)).toBeNull();
    expect(buildWorkspaceConfigurationResponse("vscode", false)).toBeNull();
    expect(buildWorkspaceConfigurationResponse("", true)).toBeNull();
  });
});

describe("mapCteLenses", () => {
  const uri = Uri.file("/p/models/orders.sql");
  const lens = (name: string, line: number) =>
    new CodeLens(new Range(new Position(line, 0), new Position(line, 0)), {
      command: "dbt.previewCte",
      title: "Preview CTE",
      arguments: [
        "/p/models/orders.sql",
        {
          name,
          compiled_path: "/p/target/compiled/orders.sql",
          compiled_start: 2,
          compiled_stop: 20,
        },
      ],
    });

  it("maps each CTE lens to an execute action and adds one profile action", () => {
    const other = new CodeLens(
      new Range(new Position(0, 0), new Position(0, 0)),
      {
        command: "fusionPowerUser.other",
        title: "Other",
      },
    );
    const result = mapCteLenses([other, lens("a", 3), lens("b", 9)], uri)!;
    expect(result.map((l) => l.command?.title)).toEqual([
      "Other",
      "$(play) Execute CTE: a",
      "⏱ Profile CTEs",
      "$(play) Execute CTE: b",
    ]);
    expect(result[1].command?.command).toBe(
      "fusionPowerUser.runCteWithDependencies",
    );
    const target = result[1].command?.arguments?.[0] as {
      uri: unknown;
      cte: unknown;
    };
    expect(target.uri).toBe(uri);
    expect(target.cte).toMatchObject({
      name: "a",
      compiledStart: 2,
      compiledStop: 20,
      line: 3,
    });
    expect(result[2].command?.arguments?.[1]).toHaveLength(2);
  });

  it("drops a lens with an unexpected argument and passes null through", () => {
    const bad = new CodeLens(
      new Range(new Position(1, 0), new Position(1, 0)),
      {
        command: "dbt.previewCte",
        title: "Preview CTE",
        arguments: ["/p/models/orders.sql", {}],
      },
    );
    expect(mapCteLenses([bad], uri)).toEqual([]);
    expect(mapCteLenses(null, uri)).toBeNull();
  });
});
