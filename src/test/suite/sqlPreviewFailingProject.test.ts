import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeApi from "vscode";
import { EventEmitter, workspace } from "vscode";
import { URI } from "vscode-uri";
import { FusionCommandError } from "../../core/lsp";
import { SqlPreviewContentProvider } from "../../features/compiledSql/sqlPreviewContentProvider";
import { previewUriFor } from "../../projects/registry/previewUri";

/*
 * A failed compileFile starts compiles, and their reports re-render the preview. Each failed render must count
 * against the bounded waits, so a preview of a model in a failing project stops re-rendering.
 */

vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<typeof vscodeApi>()),
  Uri: (await import("vscode-uri")).URI,
}));

const model = URI.file("/p/models/orders.sql");

describe("SqlPreviewContentProvider in a failing project", () => {
  let compileListener: (() => void) | undefined;
  const queries = {
    compiledSql: vi.fn(() =>
      Promise.reject<string | undefined>(
        new FusionCommandError("server", "Compiled file path not found."),
      ),
    ),
    unsafeCompileQuery: vi.fn(() => Promise.resolve("")),
  };
  const project = {
    queries,
    onDidCompile: vi.fn((listener: () => void) => {
      compileListener = listener;
      return { dispose: vi.fn() };
    }),
  };
  let provider: SqlPreviewContentProvider;

  beforeEach(() => {
    (workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
    queries.compiledSql.mockClear();
    provider = new SqlPreviewContentProvider({
      get: () => project,
      onDidInitialize: new EventEmitter<void>().event,
    });
  });

  afterEach(() => provider.dispose());

  it("stops re-rendering on compile reports after its compileFile failed", async () => {
    const preview = previewUriFor(model);
    const onChange = vi.fn();
    provider.onDidChange(onChange);
    expect(await provider.provideTextDocumentContent(preview)).toContain(
      "Could not compile",
    );

    // VS Code calls provideTextDocumentContent again for each onDidChange event.
    let rendered = 0;
    for (let i = 0; i < 10; i += 1) {
      compileListener?.();
      compileListener?.();
      while (rendered < onChange.mock.calls.length) {
        rendered += 1;
        await provider.provideTextDocumentContent(preview);
      }
    }
    expect(queries.compiledSql.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
