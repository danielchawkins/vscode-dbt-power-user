import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter, window, workspace } from "vscode";
import { URI } from "vscode-uri";
import { SqlPreviewContentProvider } from "../../features/compiledSql/sqlPreviewContentProvider";
import { previewUriFor } from "../../projects/previewUri";
import { Projects } from "../../projects/projects";

vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vscode")>()),
  Uri: (await import("vscode-uri")).URI,
}));

const model = URI.file("/p/models/stg orders#1.sql");

describe("SqlPreviewContentProvider", () => {
  let compileListener: (() => void) | undefined;
  const project = {
    compiledSql: vi.fn(() => Promise.resolve<string | undefined>("select 1")),
    unsafeCompileQuery: vi.fn((query: string) =>
      Promise.resolve(`cli: ${query}`),
    ),
    onDidCompile: vi.fn((listener: () => void) => {
      compileListener = listener;
      return { dispose: vi.fn() };
    }),
  };
  const get = vi.fn((_uri: unknown) => project);
  let initialized: EventEmitter<void>;
  let provider: SqlPreviewContentProvider;
  let documents: unknown[];

  beforeEach(() => {
    documents = [];
    (workspace as unknown as { textDocuments: unknown[] }).textDocuments =
      documents;
    project.compiledSql.mockClear();
    project.unsafeCompileQuery.mockClear();
    vi.mocked(workspace.onDidChangeTextDocument).mockClear();
    initialized = new EventEmitter<void>();
    provider = new SqlPreviewContentProvider({
      get,
      onDidInitialize: initialized.event,
    } as unknown as Projects);
  });

  afterEach(() => {
    provider.dispose();
    vi.useRealTimers();
  });

  it("shows the server's compiled file for a saved model, without a CLI process", async () => {
    const content = await provider.provideTextDocumentContent(
      previewUriFor(model),
    );
    expect(content).toBe("select 1");
    expect(project.compiledSql).toHaveBeenCalledWith(
      expect.objectContaining({ path: model.path }),
    );
    expect(project.unsafeCompileQuery).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("waits for the first compile", async () => {
    project.compiledSql.mockResolvedValueOnce(undefined);
    expect(
      await provider.provideTextDocumentContent(previewUriFor(model)),
    ).toBe("Waiting for the first compile");
  });

  it("marks a dirty model as the last saved version", async () => {
    documents.push({ uri: model, isDirty: true, getText: () => "select 2" });
    const content = await provider.provideTextDocumentContent(
      previewUriFor(model),
    );
    expect(content).toBe(
      "-- Unsaved changes: showing the last saved version.\nselect 1",
    );
  });

  it("compiles untitled text through the CLI", async () => {
    const untitled = URI.parse("untitled:Untitled-1");
    documents.push({ uri: untitled, isDirty: true, getText: () => "select 3" });
    const content = await provider.provideTextDocumentContent(
      previewUriFor(untitled),
    );
    expect(content).toBe("cli: select 3");
    expect(project.compiledSql).not.toHaveBeenCalled();
  });

  it("refreshes on every compile report, at any delay after a render", async () => {
    vi.useFakeTimers();
    const preview = previewUriFor(model);
    await provider.provideTextDocumentContent(preview);
    const fired = vi.fn();
    provider.onDidChange(fired);

    compileListener?.();
    expect(fired).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_500);
    compileListener?.();
    expect(fired).toHaveBeenCalledTimes(2);
  });

  it("renders a preview that found no project once the projects exist", async () => {
    get.mockReturnValueOnce(undefined as never);
    const preview = previewUriFor(model);
    expect(await provider.provideTextDocumentContent(preview)).toContain(
      "Still loading",
    );
    const fired = vi.fn();
    provider.onDidChange(fired);

    initialized.fire();

    expect(fired).toHaveBeenCalledWith(preview);
  });

  it("does not re-render a loaded preview when the projects initialize", async () => {
    await provider.provideTextDocumentContent(previewUriFor(model));
    const fired = vi.fn();
    provider.onDidChange(fired);
    initialized.fire();
    expect(fired).not.toHaveBeenCalled();
  });

  it("renders again on the next compile after a wait, a bounded number of times", async () => {
    project.compiledSql.mockResolvedValue(undefined);
    const preview = previewUriFor(model);
    const fired = vi.fn();
    provider.onDidChange(fired);
    await provider.provideTextDocumentContent(preview);
    for (let i = 0; i < 6; i += 1) {
      compileListener?.();
      await provider.provideTextDocumentContent(preview);
    }
    expect(fired.mock.calls.length).toBeGreaterThan(0);
    expect(fired.mock.calls.length).toBeLessThanOrEqual(3);
    project.compiledSql.mockResolvedValue("select 1");
  });

  it("does not refresh on keystrokes, only when the dirty state flips", async () => {
    const preview = previewUriFor(model);
    await provider.provideTextDocumentContent(preview);
    const fired = vi.fn();
    provider.onDidChange(fired);
    const onChange = vi.mocked(workspace.onDidChangeTextDocument).mock
      .calls[0][0] as (e: unknown) => void;

    onChange({ document: { uri: model, isDirty: false } });
    expect(fired).not.toHaveBeenCalled();
    onChange({ document: { uri: model, isDirty: true } });
    expect(fired).toHaveBeenCalledTimes(1);
  });
});
