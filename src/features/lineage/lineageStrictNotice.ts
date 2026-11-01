import type { PanelNotice } from "@fusion-power-user/webview-contract";
import type { Uri } from "vscode";
import { commands } from "vscode";
import { USE_STRICT_ANALYSIS_COMMAND } from "../../core/snapshot/schemaOrigin";
import type { NeedsStrict } from "../../core/snapshot/strictNeeded";
import { strictNeededMessage } from "../../core/snapshot/strictNeeded";

/** The panel notice for a project whose effective static-analysis mode computes no column lineage. */
export function staticAnalysisNotice(needs: NeedsStrict): PanelNotice {
  return {
    message: strictNeededMessage(needs),
    type: "warning",
    actions: [{ title: "Use strict analysis", action: "useStrictAnalysis" }],
  };
}

/** Runs the notice button's command for the Current Project's root. */
export function useStrictAnalysis(root: Uri | undefined): Thenable<unknown> {
  return commands.executeCommand(USE_STRICT_ANALYSIS_COMMAND, root);
}
