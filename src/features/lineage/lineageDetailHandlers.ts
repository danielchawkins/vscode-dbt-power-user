import type { lineage } from "@fusion-power-user/webview-contract";
import type { ExtensionContextStore } from "../../extensionContext";
import type { Handlers } from "../../webview/messageRouter";
import type { LineageDetails } from "./lineageDetails";
import { persistHiddenCards, readHiddenCards } from "./lineageHiddenCards";
import { persistLineageSettings, readLineageSettings } from "./lineageSettings";

type PanelMessage = lineage.PanelMessage;

/** Sends a panel request's answer; `command` types `body` by the request it answers. */
export type Respond = <C extends keyof lineage.ResponseBodies>(
  command: C,
  syncRequestId: string | undefined,
  body: lineage.ResponseBodies[C],
) => void;

/** The handlers that answer a detail or settings request; each body is typed by the command it answers. */
export function detailRequestHandlers(deps: {
  details: LineageDetails;
  extensionContext: ExtensionContextStore;
  respond: Respond;
}): Pick<
  Handlers<PanelMessage>,
  | "getExposureDetails"
  | "getFunctionDetails"
  | "getLineageSettings"
  | "persistLineageSettings"
  | "getHiddenCards"
  | "persistHiddenCards"
> {
  const { details, extensionContext, respond } = deps;
  return {
    getExposureDetails: async ({ args, syncRequestId }) =>
      respond(
        "getExposureDetails",
        syncRequestId,
        await details.getExposureDetails(args.params),
      ),
    getFunctionDetails: async ({ args, syncRequestId }) =>
      respond(
        "getFunctionDetails",
        syncRequestId,
        await details.getFunctionDetails(args.params),
      ),
    getLineageSettings: ({ syncRequestId }) =>
      respond(
        "getLineageSettings",
        syncRequestId,
        readLineageSettings(extensionContext),
      ),
    persistLineageSettings: async ({ args, syncRequestId }) => {
      await persistLineageSettings(extensionContext, args.params);
      respond("persistLineageSettings", syncRequestId, { ok: true });
    },
    getHiddenCards: ({ syncRequestId }) =>
      respond("getHiddenCards", syncRequestId, {
        cards: readHiddenCards(extensionContext),
      }),
    persistHiddenCards: ({ args, syncRequestId }) => {
      persistHiddenCards(extensionContext, args.params.cards);
      respond("persistHiddenCards", syncRequestId, { ok: true });
    },
  };
}
