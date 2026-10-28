import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "vscode";
import { ServerCompileState } from "../../fusion/compileSignal";
import type { FusionClient } from "../../fusion/fusionClient";
import { followClientCompiles } from "../../projects/clients/clientChange";
import { ManifestState } from "../../projects/manifest/manifestState";

/** A client whose only member under test is its server compile state. */
function fakeClient() {
  return { compileState: new ServerCompileState() };
}

describe("ManifestState compile wiring", () => {
  it("reports each complete's errors and fires onDidCompile once per foreground complete", () => {
    const clientA = fakeClient();
    const changed = new EventEmitter<void>();
    let current = clientA as unknown as FusionClient;
    const reportErrors = vi.fn();
    const onCompile = vi.fn();
    const state = new ManifestState(
      { root: { fsPath: "/p" } },
      () => current,
      {
        follow: (listener) =>
          followClientCompiles(() => current, changed.event, listener),
        reportErrors,
      },
    );
    state.onDidCompile(onCompile);

    clientA.compileState.started("compiling");
    clientA.compileState.finished({ kind: "foreground", errors: ["e1"] });
    clientA.compileState.started("backgroundCompiling");
    clientA.compileState.finished({ kind: "background", errors: [] });

    expect(reportErrors.mock.calls).toEqual([[["e1"]], [[]]]);
    expect(onCompile).toHaveBeenCalledTimes(1);

    // The pool replaces the client: the old client's completes no longer arrive.
    const clientB = fakeClient();
    current = clientB as unknown as FusionClient;
    changed.fire();
    clientA.compileState.finished({ kind: "foreground", errors: ["stale"] });
    expect(reportErrors).toHaveBeenCalledTimes(2);
    expect(onCompile).toHaveBeenCalledTimes(1);

    clientB.compileState.finished({ kind: "foreground", errors: ["fresh"] });
    expect(reportErrors).toHaveBeenLastCalledWith(["fresh"]);
    expect(onCompile).toHaveBeenCalledTimes(2);

    // Disposing the state drops the subscription to the current client.
    state.dispose();
    clientB.compileState.finished({ kind: "background", errors: ["late"] });
    expect(reportErrors).toHaveBeenCalledTimes(3);
    expect(onCompile).toHaveBeenCalledTimes(2);
  });
});
