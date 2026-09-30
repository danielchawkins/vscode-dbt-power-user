import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { EventEmitter, Uri } from "vscode";
import { DocsEditViewPanel } from "../../webview_provider/docsEditPanel";
import { LineagePanel } from "../../webview_provider/lineagePanel";

function container() {
  const changed = new EventEmitter<unknown>();
  const removed = new EventEmitter<Uri>();
  return {
    changed,
    removed,
    value: {
      onDidChangeManifest: changed.event,
      onDidRemoveProject: removed.event,
      findDBTProject: () => undefined,
    } as any,
  };
}

const terminal = { debug: jest.fn(), info: jest.fn(), error: jest.fn() } as any;

describe("webview panels on project removal", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("LineagePanel tells the view the manifest is gone", () => {
    const { removed, value } = container();
    const view = { manifestChanged: jest.fn() } as any;
    const panel = new LineagePanel(view, value, terminal);

    removed.fire(Uri.file("/a"));

    expect(view.manifestChanged).toHaveBeenCalledWith(undefined);
    panel.dispose();
    removed.fire(Uri.file("/a"));
    expect(view.manifestChanged).toHaveBeenCalledTimes(1);
  });

  it("DocsEditViewPanel reloads documentation from the manifest", () => {
    const transmit = jest
      .spyOn(DocsEditViewPanel.prototype as any, "transmitData")
      .mockImplementation(() => undefined);
    const { removed, value } = container();
    const panel = new DocsEditViewPanel(
      value,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      terminal,
    );
    (panel as any)._panel = {};

    removed.fire(Uri.file("/a"));

    expect(transmit).toHaveBeenCalledTimes(1);
    expect((panel as any).loadedFromManifest).toBe(true);
    panel.dispose();
    removed.fire(Uri.file("/a"));
    expect(transmit).toHaveBeenCalledTimes(1);
  });
});
