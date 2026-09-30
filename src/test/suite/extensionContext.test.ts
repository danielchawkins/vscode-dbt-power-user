import { describe, expect, it, vi } from "vitest";
import { ExtensionContext, Uri } from "vscode";
import { ExtensionContextStore } from "../../extensionContext";

describe("ExtensionContextStore", () => {
  function createStore() {
    const workspaceState = {
      get: vi.fn().mockReturnValue("workspace-value"),
      update: vi.fn(),
    };
    const globalState = {
      get: vi.fn().mockReturnValue("global-value"),
      update: vi.fn(),
    };
    const context = {
      extensionUri: Uri.file("/extension"),
      workspaceState,
      globalState,
    } as unknown as ExtensionContext;
    return {
      store: new ExtensionContextStore(context),
      context,
      workspaceState,
      globalState,
    };
  }

  it("exposes extension identity", () => {
    const { store, context } = createStore();

    expect(store.extensionUri).toBe(context.extensionUri);
  });

  it("reads and writes workspace and global state", () => {
    const { store, workspaceState, globalState } = createStore();

    store.setToWorkspaceState("key", "value");
    store.setToGlobalState("key", "value");

    expect(store.getFromWorkspaceState("key")).toBe("workspace-value");
    expect(store.getFromGlobalState("key")).toBe("global-value");
    expect(workspaceState.update).toHaveBeenCalledWith("key", "value");
    expect(globalState.update).toHaveBeenCalledWith("key", "value");
  });
});
