import { describe, expect, it, jest } from "@jest/globals";
import { ExtensionContext, Uri } from "vscode";
import { ExtensionContextStore } from "../../extensionContext";

describe("ExtensionContextStore", () => {
  function createStore() {
    const workspaceState = {
      get: jest.fn().mockReturnValue("workspace-value"),
      update: jest.fn(),
    };
    const globalState = {
      get: jest.fn().mockReturnValue("global-value"),
      update: jest.fn(),
    };
    const context = {
      extensionUri: Uri.file("/extension"),
      extension: { id: "publisher.extension", packageJSON: { version: "1" } },
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
    expect(store.extensionVersion).toBe("1");
    expect(store.extensionId).toBe("publisher.extension");
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
