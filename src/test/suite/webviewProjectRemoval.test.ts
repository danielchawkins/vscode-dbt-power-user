import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter, Uri } from "vscode";
import { DocsEditViewPanel } from "../../features/docs/docsEditPanel";
import { LineageViewProvider } from "../../features/lineage/lineageViewProvider";

function projectsDouble() {
  const changed = new EventEmitter<unknown>();
  const removed = new EventEmitter<Uri>();
  return {
    changed,
    removed,
    value: {
      onDidChangeManifest: changed.event,
      onDidRemoveProject: removed.event,
      get: () => undefined,
    } as any,
  };
}

const terminal = { debug: vi.fn(), info: vi.fn(), error: vi.fn() } as any;

describe("webview panels on project removal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("LineageViewProvider tells the view the manifest is gone", () => {
    const { removed, value } = projectsDouble();
    const view = { manifestChanged: vi.fn(), dispose: vi.fn() } as any;
    const panel = new LineageViewProvider(view, value);

    removed.fire(Uri.file("/a"));

    expect(view.manifestChanged).toHaveBeenCalledWith(undefined);
    panel.dispose();
    expect(view.dispose).toHaveBeenCalledTimes(1);
    removed.fire(Uri.file("/a"));
    expect(view.manifestChanged).toHaveBeenCalledTimes(1);
  });

  it("DocsEditViewPanel reloads documentation from the manifest", () => {
    const transmit = vi
      .spyOn(DocsEditViewPanel.prototype as any, "transmitData")
      .mockImplementation(() => undefined);
    const { removed, value } = projectsDouble();
    const panel = new DocsEditViewPanel(value, {} as any, {} as any, terminal);
    (panel as any)._panel = {};

    removed.fire(Uri.file("/a"));

    expect(transmit).toHaveBeenCalledTimes(1);
    expect((panel as any).loadedFromManifest).toBe(true);
    panel.dispose();
    removed.fire(Uri.file("/a"));
    expect(transmit).toHaveBeenCalledTimes(1);
  });
});
