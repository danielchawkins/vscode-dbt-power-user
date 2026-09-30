import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { window, workspace } from "vscode";
import { URI } from "vscode-uri";
import { SqlPreviewContentProvider } from "../../features/compiledSql/sqlPreviewContentProvider";
import { previewUriFor } from "../../projects/previewUri";
import { Projects } from "../../projects/projects";

vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vscode")>()),
  Uri: (await import("vscode-uri")).URI,
}));

describe("SqlPreviewContentProvider", () => {
  let root: string;
  let modelPath: string;
  const project = {
    refreshProjectConfig: vi.fn(() => Promise.resolve()),
    unsafeCompileQuery: vi.fn((query: string) =>
      Promise.resolve(`compiled: ${query}`),
    ),
  };
  const get = vi.fn((_uri: unknown) => project);
  let provider: SqlPreviewContentProvider;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fpu preview #?-"));
    modelPath = path.join(root, "models", "stg orders#1.sql");
    fs.mkdirSync(path.dirname(modelPath));
    fs.writeFileSync(modelPath, "select 1");
    (workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
    vi.mocked(workspace.onDidChangeTextDocument).mockClear();
    provider = new SqlPreviewContentProvider({ get } as unknown as Projects);
  });

  afterEach(() => {
    provider.dispose();
    fs.rmSync(root, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("compiles the model file behind the preview URI", async () => {
    const model = URI.file(modelPath);
    const content = await provider.provideTextDocumentContent(
      URI.parse(previewUriFor(model as never).toString()) as never,
    );
    expect(content).toBe("compiled: select 1");
    expect(get.mock.calls[0][0]?.toString()).toBe(model.toString());
  });

  it("prefers the open model document over the file on disk", async () => {
    const model = URI.file(modelPath);
    (workspace as unknown as { textDocuments: unknown[] }).textDocuments = [
      { uri: model, getText: () => "select 2" },
    ];
    const content = await provider.provideTextDocumentContent(
      previewUriFor(model as never),
    );
    expect(content).toBe("compiled: select 2");
  });

  it("refreshes the preview when its model changes", async () => {
    vi.useFakeTimers();
    const model = URI.file(modelPath);
    const preview = previewUriFor(model as never);
    await provider.provideTextDocumentContent(preview);
    const fired = vi.fn();
    provider.onDidChange(fired);
    const onChange = vi.mocked(workspace.onDidChangeTextDocument).mock
      .calls[0][0] as (e: unknown) => void;

    onChange({ document: { uri: URI.file(path.join(root, "other.sql")) } });
    onChange({ document: { uri: model } });
    vi.advanceTimersByTime(500);

    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0][0].toString()).toBe(preview.toString());
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });
});
