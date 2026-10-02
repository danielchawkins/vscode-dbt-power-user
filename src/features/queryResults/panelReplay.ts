import type { queryResults } from "@fusion-power-user/webview-contract";

type HostMessage = queryResults.HostMessage;
type Slot = "viewType" | "result";

const SLOT_OF: Partial<Record<HostMessage["command"], Slot>> = {
  updateViewType: "viewType",
  renderQuery: "result",
  renderError: "result",
};
/** Commands after which a rebuilt page shows no result. */
const CLEARS_RESULT: HostMessage["command"][] = ["renderLoading", "resetState"];

/**
 * The last view type, result and tab data posted to each query results page, keyed by the page's role (the
 * bottom view, or one results tab), so a page VS Code rebuilt after hiding it shows what it showed before.
 * Rows stay in host memory, never in webview state.
 */
export class PanelReplay<K> {
  private readonly pages = new Map<
    K,
    { slots: Map<Slot, HostMessage>; tabData?: unknown }
  >();

  private page(key: K) {
    let page = this.pages.get(key);
    if (!page) {
      page = { slots: new Map() };
      this.pages.set(key, page);
    }
    return page;
  }

  /** Records `message` as posted to the page at `key`. */
  record(key: K, message: HostMessage): void {
    const { slots } = this.page(key);
    if (CLEARS_RESULT.includes(message.command)) {
      slots.delete("result");
    }
    const slot = SLOT_OF[message.command];
    if (slot) {
      slots.set(slot, message);
    }
  }

  /** The messages that bring a rebuilt page back to its last view type and result, in posting order. */
  messagesFor(key: K): HostMessage[] {
    const slots = this.pages.get(key)?.slots;
    return slots
      ? (["viewType", "result"] as const).flatMap(
          (slot) => slots.get(slot) ?? [],
        )
      : [];
  }

  /** Binds the data a results tab renders to its page, which asks for it again after each rebuild. */
  setTabData(key: K, data: unknown): void {
    this.page(key).tabData = data;
  }

  tabDataFor(key: K): unknown {
    return this.pages.get(key)?.tabData;
  }

  /** Forgets a closed page. */
  delete(key: K): void {
    this.pages.delete(key);
  }

  /** Forgets every page's view type, result and tab data. */
  clear(): void {
    this.pages.clear();
  }
}
