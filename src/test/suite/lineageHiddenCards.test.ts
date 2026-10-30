import { describe, expect, it } from "vitest";
import { detailRequestHandlers } from "../../features/lineage/lineageDetailHandlers";
import type { LineageDetails } from "../../features/lineage/lineageDetails";
import * as hiddenCards from "../../features/lineage/lineageHiddenCards";

type Store = Parameters<typeof hiddenCards.readHiddenCards>[0];

/** A workspace-state store over `initial`, which `update` writes and `get` reads back. */
const workspaceWith = (initial?: unknown) => {
  const state = new Map<string, unknown>(
    initial === undefined ? [] : [["lineage.hiddenCards", initial]],
  );
  const store: Store = {
    getFromWorkspaceState: <T>(key: string) => state.get(key) as T | undefined,
    setToWorkspaceState: (key, value) => {
      state.set(key, value);
    },
  };
  return { store, state };
};

describe("hidden cards in workspace state", () => {
  it("reads nothing when the workspace holds no hidden cards", () => {
    expect(hiddenCards.readHiddenCards(workspaceWith().store)).toEqual([]);
  });

  it("stores the cards under one workspace key, with their labels, and reads them back", () => {
    const { store, state } = workspaceWith();
    hiddenCards.persistHiddenCards(store, [
      { id: "model.p.a", label: "a" },
      { id: "model.p.b" },
    ]);
    expect(state.get("lineage.hiddenCards")).toEqual([
      { id: "model.p.a", label: "a" },
      { id: "model.p.b" },
    ]);
    expect(hiddenCards.readHiddenCards(store)).toEqual([
      { id: "model.p.a", label: "a" },
      { id: "model.p.b" },
    ]);
  });

  it("keeps one card per id when it stores or reads, the last label given winning", () => {
    const { store } = workspaceWith([
      { id: "model.p.a", label: "a" },
      { id: "model.p.a", label: "a again" },
    ]);
    expect(hiddenCards.readHiddenCards(store)).toEqual([
      { id: "model.p.a", label: "a again" },
    ]);
    hiddenCards.persistHiddenCards(store, [
      { id: "model.p.b", label: "b" },
      { id: "model.p.b", label: "b" },
    ]);
    expect(hiddenCards.readHiddenCards(store)).toEqual([
      { id: "model.p.b", label: "b" },
    ]);
  });

  it("reads a bare id an older list stored as a card with no label", () => {
    const { store } = workspaceWith(["model.p.a"]);
    expect(hiddenCards.readHiddenCards(store)).toEqual([{ id: "model.p.a" }]);
  });

  it("drops what is not a card with a string id from a value it did not write", () => {
    const { store } = workspaceWith([
      "model.p.a",
      3,
      null,
      { label: "no id" },
      { id: "model.p.x", label: "x" },
    ]);
    expect(hiddenCards.readHiddenCards(store)).toEqual([
      { id: "model.p.a" },
      { id: "model.p.x", label: "x" },
    ]);
  });

  it("reads nothing from a value that is not a list", () => {
    expect(
      hiddenCards.readHiddenCards(workspaceWith("model.p.a").store),
    ).toEqual([]);
  });
});

describe("the hidden-card requests", () => {
  const handlersOver = (store: Store) => {
    const replies: { command: string; body: unknown }[] = [];
    const handlers = detailRequestHandlers({
      details: {} as LineageDetails,
      extensionContext: store as never,
      respond: (command, _id, body) => {
        replies.push({ command, body });
      },
    });
    return { handlers, replies };
  };

  it("restores the cards, with their labels, the webview persisted, whichever start model is open", async () => {
    const { store } = workspaceWith();
    const { handlers, replies } = handlersOver(store);

    await handlers.persistHiddenCards({
      command: "persistHiddenCards",
      args: {
        params: {
          cards: [
            { id: "model.p.a", label: "a" },
            { id: "model.p.c", label: "orders" },
          ],
        },
      },
      syncRequestId: "1",
    } as never);
    expect(replies.at(-1)).toEqual({
      command: "persistHiddenCards",
      body: { ok: true },
    });

    // A panel opened later, on another start model, is answered with the same workspace list.
    await handlers.getHiddenCards({
      command: "getHiddenCards",
      syncRequestId: "2",
    } as never);
    expect(replies.at(-1)).toEqual({
      command: "getHiddenCards",
      body: {
        cards: [
          { id: "model.p.a", label: "a" },
          { id: "model.p.c", label: "orders" },
        ],
      },
    });
  });

  it("answers an empty list when nothing was hidden", async () => {
    const { handlers, replies } = handlersOver(workspaceWith().store);
    await handlers.getHiddenCards({
      command: "getHiddenCards",
      syncRequestId: "1",
    } as never);
    expect(replies).toEqual([
      { command: "getHiddenCards", body: { cards: [] } },
    ]);
  });

  it("clears the workspace list when it is persisted empty", async () => {
    const { store } = workspaceWith([{ id: "model.p.a" }]);
    const { handlers, replies } = handlersOver(store);
    await handlers.persistHiddenCards({
      command: "persistHiddenCards",
      args: { params: { cards: [] } },
      syncRequestId: "1",
    } as never);
    await handlers.getHiddenCards({
      command: "getHiddenCards",
      syncRequestId: "2",
    } as never);
    expect(replies.at(-1)).toEqual({
      command: "getHiddenCards",
      body: { cards: [] },
    });
  });
});
