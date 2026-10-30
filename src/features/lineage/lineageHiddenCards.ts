import type { lineage } from "@fusion-power-user/webview-contract";
import type { ExtensionContextStore } from "../../extensionContext";

/** The workspace-state key of the hidden cards. One list for the workspace, whatever the start model. */
const HIDDEN_CARDS_KEY = "lineage.hiddenCards";

type Store = Pick<
  ExtensionContextStore,
  "getFromWorkspaceState" | "setToWorkspaceState"
>;

/** One card per ID, the last label given wins; an ID's position is that of its first card. */
const byId = (cards: readonly lineage.HiddenCard[]): lineage.HiddenCard[] => [
  ...new Map(cards.map((card) => [card.id, card])).values(),
];

/**
 * The hidden cards in workspace state. Anything that is not a card with a string ID is dropped; a bare string, as an
 * older list stored it, is a card with no label.
 */
export function readHiddenCards(store: Store): lineage.HiddenCard[] {
  const stored = store.getFromWorkspaceState<unknown>(HIDDEN_CARDS_KEY);
  if (!Array.isArray(stored)) {
    return [];
  }
  return byId(
    stored.flatMap((entry): lineage.HiddenCard[] => {
      if (typeof entry === "string") {
        return [{ id: entry }];
      }
      const { id, label } = (entry ?? {}) as Partial<lineage.HiddenCard>;
      if (typeof id !== "string") {
        return [];
      }
      return [typeof label === "string" ? { id, label } : { id }];
    }),
  );
}

/** Saves `cards` as the hidden cards of the workspace, one per ID. */
export function persistHiddenCards(
  store: Store,
  cards: readonly lineage.HiddenCard[],
): void {
  store.setToWorkspaceState(HIDDEN_CARDS_KEY, byId(cards));
}
