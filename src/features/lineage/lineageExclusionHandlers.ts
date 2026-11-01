import type { lineage } from "@fusion-power-user/webview-contract";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { Handlers } from "../../webview/messageRouter";
import type { Respond } from "./lineageDetailHandlers";
import {
  addExclusionRule,
  exclusionAnswers,
  removeExclusionRule,
} from "./lineageExclusion";
import type { LineageService } from "./lineageService";

type PanelMessage = lineage.PanelMessage;

/**
 * The handlers of the Exclusions section. The answer lists the rules the setting holds; a change writes the setting, and
 * the panel refetches the graph when the setting changes.
 */
export function exclusionRequestHandlers(deps: {
  lineageService: LineageService;
  currentProject: CurrentProject;
  respond: Respond;
}): Pick<
  Handlers<PanelMessage>,
  "getExclusions" | "addExclusion" | "removeExclusion"
> {
  const { lineageService, currentProject, respond } = deps;
  return {
    getExclusions: async ({ syncRequestId }) =>
      respond("getExclusions", syncRequestId, {
        rules: await exclusionAnswers(
          lineageService.exclusions,
          currentProject.current?.manifest,
        ),
      }),
    addExclusion: async ({ args, syncRequestId }) => {
      await addExclusionRule(args.params.rule);
      respond("addExclusion", syncRequestId, { ok: true });
    },
    removeExclusion: async ({ args, syncRequestId }) => {
      await removeExclusionRule(args.params.rule);
      respond("removeExclusion", syncRequestId, { ok: true });
    },
  };
}
