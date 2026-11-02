import type { lineage } from "@fusion-power-user/webview-contract";
import type { Handlers } from "../../webview/messageRouter";
import type { GraphLayoutWorker, LayoutSession } from "./graphLayoutWorker";
import type { Respond } from "./lineageDetailHandlers";

type PanelMessage = lineage.PanelMessage;

/**
 * A lineage panel's layout requests: one session in the host's layout Worker, which holds the panel's engine handle
 * there. The panel registers it for disposal, which releases the handle.
 */
export class LayoutRequests {
  readonly #session: LayoutSession;

  constructor(layouts: GraphLayoutWorker) {
    this.#session = layouts.session();
  }

  /** The handler that answers a `layout` request; its answer is the frame, or `superseded` when a newer generation overtook it. */
  handlers(respond: Respond): Pick<Handlers<PanelMessage>, "layout"> {
    return {
      layout: async ({ args, syncRequestId }) => {
        const { frame, options, generation } = args.params;
        const answer = await this.#session.layout(
          Buffer.from(frame, "base64"),
          options,
          generation,
        );
        return respond(
          "layout",
          syncRequestId,
          answer === undefined
            ? { superseded: true }
            : {
                superseded: false,
                frame: Buffer.from(answer).toString("base64"),
              },
        );
      },
    };
  }

  dispose(): void {
    this.#session.dispose();
  }
}
