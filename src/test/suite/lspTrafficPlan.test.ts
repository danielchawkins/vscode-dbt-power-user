import { describe, expect, it, vi } from "vitest";
import { EventEmitter, Uri } from "vscode";
import {
  ServerCompileState,
  subscribeToCompileState,
} from "../../fusion/compileSignal";
import type { FusionClient } from "../../fusion/fusionClient";
import { documentSelectorForProject } from "../../fusion/documentSelector";
import { followClientCompiles } from "../../projects/clients/clientChange";
import { ManifestState } from "../../projects/manifest/manifestState";

/** A client that records its `dbt/*` notification handlers, with the compile state fed from them. */
function harness() {
  const handlers = new Map<string, (params: unknown) => void>();
  const client = {
    compileState: new ServerCompileState(),
    onNotification: (method: string, handler: (params: unknown) => void) => {
      handlers.set(method, handler);
      return { dispose() {} };
    },
  };
  subscribeToCompileState(client as never, client.compileState);
  const reportErrors = vi.fn();
  const state = new ManifestState(
    { projectRoot: { fsPath: "/p" } },
    () => client as unknown as FusionClient,
    {
      follow: (listener) =>
        followClientCompiles(
          () => client as unknown as FusionClient,
          new EventEmitter<void>().event,
          listener,
        ),
      reportErrors,
    },
  );
  const onCompile = vi.fn();
  state.onDidCompile(onCompile);
  return {
    send: (method: string, params: unknown) => handlers.get(method)?.(params),
    reportErrors,
    onCompile,
    dispose: () => state.dispose(),
  };
}

describe("compile report kinds", () => {
  it("reports the errors of a background compile report", () => {
    const { send, reportErrors, dispose } = harness();
    send("dbt/lspBackgroundCompileComplete", {
      errors: [{ severity: "Error", message: "bad macro" }],
    });
    expect(reportErrors).toHaveBeenCalledWith(["bad macro"]);
    dispose();
  });

  it("does not fire onDidCompile for a background compile report", () => {
    const { send, onCompile, dispose } = harness();
    send("dbt/lspBackgroundCompileComplete", { errors: [] });
    expect(onCompile).not.toHaveBeenCalled();
    dispose();
  });
});

describe("Fusion document selector", () => {
  it("names the file scheme in every filter", () => {
    const selector = documentSelectorForProject(Uri.file("/workspace/general"));
    for (const filter of selector) {
      expect((filter as { scheme?: string }).scheme).toBe("file");
    }
  });
});
