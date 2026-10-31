import { PANELS } from "./panels";
import {
  clickInWebview,
  expectWebviewDom,
  pressKeyInWebview,
} from "./webviewInteractions";

/**
 * The lineage view mode is kept in the panel's global state, not in a setting, so a test changes it the way a person
 * does: the View radios in the Settings popover. The default is the whole project.
 */
export type LineageViewMode = "whole" | "neighbourhood";

const VIEW_LABELS: Record<LineageViewMode, string> = {
  whole: "Whole project",
  neighbourhood: "Neighbourhood",
};

/** Opens Settings, selects `mode` among the View radios, and closes the popover again. The lineage panel must be shown. */
export async function setLineageViewMode(mode: LineageViewMode): Promise<void> {
  const panel = PANELS.lineage;
  const name = VIEW_LABELS[mode];
  await clickInWebview(panel, { role: "button", name: "Settings" });
  await expectWebviewDom(panel, { role: "dialog" });
  await clickInWebview(panel, { role: "radio", name });
  await expectWebviewDom(panel, { role: "radio", name, checked: true });
  await pressKeyInWebview(panel, "Escape");
  await expectWebviewDom(panel, { absent: "[role=dialog]" });
}
