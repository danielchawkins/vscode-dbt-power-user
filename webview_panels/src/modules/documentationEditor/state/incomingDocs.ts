import type { documentationEditor } from "@fusion-power-user/webview-contract";
import type { MessageOf } from "@modules/app/requestExecutor";
import { isStateDirty } from "../utils";
import type {
  EditorDocumentation,
  DocumentationStateProps,
} from "./types";

type HostMessage = documentationEditor.HostMessage;
/** `renderDocumentation` with `docs` mapped by `fromHostDocumentation`; the test types are the contract's own. */
export type RenderMessage = Omit<
  MessageOf<HostMessage, "renderDocumentation">,
  "docs" | "tests" | "unitTests" | "draft"
> & {
  docs?: EditorDocumentation | undefined;
  tests?: documentationEditor.ModelTest[] | undefined;
  unitTests?: documentationEditor.UnitTest[] | undefined;
  draft?:
    | { docs: EditorDocumentation; tests?: documentationEditor.ModelTest[] | undefined }
    | undefined;
};

export type IncomingDecision = "render" | "renderWithoutDraft" | "ask";

/**
 * What an incoming `renderDocumentation` does: unsaved edits make the page ask, unless the draft
 * is for the model already open, whose edits are newer; then the draft is left out.
 */
export const incomingDecision = (
  state: DocumentationStateProps,
  message: Pick<RenderMessage, "draft">,
): IncomingDecision => {
  if (!isStateDirty(state)) {
    return "render";
  }
  // The page's own edits are newer than the draft the host holds for the same model.
  if (state.currentDocsData?.filePath === message.draft?.docs.filePath) {
    return "renderWithoutDraft";
  }
  return "ask";
};
