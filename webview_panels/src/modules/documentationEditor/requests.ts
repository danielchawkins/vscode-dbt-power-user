import type { documentationEditor } from "@fusion-power-user/webview-contract";
import { panelRequests } from "@modules/app/requestExecutor";

export const { executeRequestInSync, executeRequestInAsync } =
  panelRequests<documentationEditor.PanelMessage>();
